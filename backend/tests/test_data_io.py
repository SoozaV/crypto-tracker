"""Tests de export/import (sin duplicar), renombrar wallet y reset."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.services import metrics


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("ENABLE_SCHEDULER", "0")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, future=True)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(metrics, "default_price_provider", lambda a: 100)
    monkeypatch.setattr(metrics, "default_market_provider",
                        lambda a: {"price": 100, "change_24h_pct": 1, "change_7d_pct": 2, "change_30d_pct": 3})
    yield TestClient(app)
    app.dependency_overrides.clear()


def _seed(client):
    client.post("/api/setup", json={
        "wallet_name": "Binance", "symbol": "BTC", "quantity": "1",
        "total_cost": "40000", "coingecko_id": "bitcoin",
        "date": "2026-01-01T00:00:00+00:00",
    })
    wid = client.get("/api/wallets").json()[0]["id"]
    aid = client.get("/api/assets").json()[0]["id"]
    client.post("/api/transactions", json={
        "wallet_id": wid, "asset_id": aid, "type": "BUY",
        "quantity": "1", "price": "60000", "date": "2026-02-01T00:00:00+00:00",
    })
    return wid, aid


def test_export_has_uids_and_shape(client):
    _seed(client)
    data = client.get("/api/export").json()
    assert data["scope"] == "global"
    assert len(data["wallets"]) == 1 and len(data["assets"]) == 1
    assert len(data["transactions"]) == 2
    assert all(t["uid"] for t in data["transactions"])


def test_import_is_idempotent(client):
    _seed(client)
    data = client.get("/api/export").json()
    # Reimportar el mismo archivo NO debe duplicar nada.
    r = client.post("/api/import", json=data).json()
    assert r["transactions_imported"] == 0
    assert r["transactions_skipped"] == 2
    assert len(client.get("/api/transactions").json()) == 2


def test_import_into_empty_db_restores(client):
    _seed(client)
    data = client.get("/api/export").json()
    client.post("/api/admin/reset", json={"confirm": True})
    assert client.get("/api/transactions").json() == []
    r = client.post("/api/import", json=data).json()
    assert r["transactions_imported"] == 2
    assert r["wallets_created"] == 1 and r["assets_created"] == 1
    # ACB recalculado: qty 2, avg 50000
    aid = client.get("/api/assets").json()[0]["id"]
    d = client.get(f"/api/asset/{aid}").json()
    assert d["quantity"] == "2"
    assert d["avg_price"] == "50000"


def test_import_without_uid_dedupes_by_content(client):
    _seed(client)
    data = client.get("/api/export").json()
    for t in data["transactions"]:
        t.pop("uid", None)  # simular archivo hecho a mano sin uid
    r = client.post("/api/import", json=data).json()
    assert r["transactions_imported"] == 0  # dedup por hash de contenido
    assert r["transactions_skipped"] == 2


def test_export_per_wallet_scope(client):
    _seed(client)
    # Segunda wallet con otra transacción
    client.post("/api/setup", json={
        "wallet_name": "Ledger", "symbol": "ETH", "quantity": "2",
        "total_cost": "5000", "coingecko_id": "ethereum",
        "date": "2026-01-05T00:00:00+00:00",
    })
    wid_binance = next(w["id"] for w in client.get("/api/wallets").json() if w["name"] == "Binance")
    data = client.get(f"/api/export?wallet_id={wid_binance}").json()
    assert data["scope"] == "wallet"
    assert {w["name"] for w in data["wallets"]} == {"Binance"}
    assert all(t["wallet_name"] == "Binance" for t in data["transactions"])


def test_rename_wallet(client):
    _seed(client)
    wid = client.get("/api/wallets").json()[0]["id"]
    r = client.patch(f"/api/wallets/{wid}", json={"name": "Binance Spot"})
    assert r.status_code == 200
    assert r.json()["name"] == "Binance Spot"


def test_rename_wallet_conflict(client):
    _seed(client)
    client.post("/api/setup", json={
        "wallet_name": "Ledger", "symbol": "ETH", "quantity": "1",
        "total_cost": "2000", "coingecko_id": "ethereum",
        "date": "2026-01-05T00:00:00+00:00",
    })
    wids = {w["name"]: w["id"] for w in client.get("/api/wallets").json()}
    r = client.patch(f"/api/wallets/{wids['Ledger']}", json={"name": "Binance"})
    assert r.status_code == 409


def test_reset_requires_confirmation(client):
    _seed(client)
    assert client.post("/api/admin/reset", json={"confirm": False}).status_code == 400
    assert len(client.get("/api/transactions").json()) == 2
    r = client.post("/api/admin/reset", json={"confirm": True})
    assert r.status_code == 200
    assert client.get("/api/wallets").json() == []
    assert client.get("/api/transactions").json() == []
