"""
Tests de los endpoints de la Fase 3 con TestClient.
BD en memoria compartida (StaticPool) y precio de mercado simulado.
"""
from __future__ import annotations

from decimal import Decimal

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
    monkeypatch.setenv("ENABLE_SCHEDULER", "0")  # no arrancar el cron en tests
    monkeypatch.setenv("RATE_LIMIT", "1000000/minute")  # no limitar en estos tests
    # BD en memoria compartida entre todas las conexiones del test.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, future=True)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    # Precio de mercado simulado (sin red).
    prices = {"bitcoin": Decimal("60000")}
    monkeypatch.setattr(metrics, "default_price_provider",
                        lambda asset: prices[asset.coingecko_id])
    monkeypatch.setattr(metrics, "default_market_provider", lambda asset: {
        "price": Decimal("60000"), "change_24h_pct": Decimal("2.5"),
        "change_7d_pct": Decimal("-1.0"), "change_30d_pct": Decimal("12.0"),
    })

    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_full_flow(client):
    # 1) Onboarding vía API
    r = client.post("/api/setup", json={
        "wallet_name": "Binance", "symbol": "BTC", "quantity": "1",
        "total_cost": "40000", "name": "Bitcoin", "coingecko_id": "bitcoin",
        "date": "2026-01-01T00:00:00+00:00",
    })
    assert r.status_code == 201

    # 2) Selector: la wallet aparece
    wallets = client.get("/api/wallets").json()
    assert wallets[0]["name"] == "Binance"
    wid = wallets[0]["id"]
    aid = client.get("/api/assets").json()[0]["id"]

    # 3) Resumen global: valor 60000, ROI 50%
    s = client.get("/api/portfolio/summary").json()
    assert s["total_value"] == "60000"
    assert s["total_roi_pct"] == "50"

    # 4) Resumen por wallet (selector)
    s_w = client.get(f"/api/portfolio/summary?wallet_id={wid}").json()
    assert s_w["scope"] == "wallet"
    assert s_w["total_value"] == "60000"

    # 5) Detalle de activo (3.7) con cambios (3.6)
    d = client.get(f"/api/asset/{aid}").json()
    assert d["symbol"] == "BTC"
    assert d["unrealized_pnl"] == "20000"       # (60000-40000)*1
    assert d["changes"]["change_24h_pct"] == "2.5"

    # 6) Cambios (3.6)
    ch = client.get(f"/api/asset/{aid}/changes").json()
    assert ch["change_30d_pct"] == "12"


def test_sell_validation_returns_400(client):
    client.post("/api/setup", json={
        "wallet_name": "Binance", "symbol": "BTC", "quantity": "0.5",
        "total_cost": "20000", "coingecko_id": "bitcoin",
        "date": "2026-01-01T00:00:00+00:00",
    })
    wid = client.get("/api/wallets").json()[0]["id"]
    aid = client.get("/api/assets").json()[0]["id"]
    # Intentar vender más de lo que hay -> 400 (tarea 1.7)
    r = client.post("/api/transactions", json={
        "wallet_id": wid, "asset_id": aid, "type": "SELL",
        "quantity": "5", "price": "60000", "date": "2026-02-01T00:00:00+00:00",
    })
    assert r.status_code == 400


def test_ohlcv_endpoint_serves_raw_candles(client, monkeypatch):
    """El endpoint OHLCV (4.1) sirve velas crudas; puebla desde Binance si hace falta."""
    from datetime import datetime
    from decimal import Decimal
    from app.services import price_history_service as ph
    from app.services.binance_client import Candle

    client.post("/api/setup", json={
        "wallet_name": "Binance", "symbol": "BTC", "quantity": "1",
        "total_cost": "40000", "coingecko_id": "bitcoin", "binance_symbol": "BTCUSDT",
        "date": "2026-01-01T00:00:00+00:00",
    })
    aid = client.get("/api/assets").json()[0]["id"]

    # Binance simulado: 3 velas
    def fake_candles(symbol, days=200, interval="1d"):
        return [
            Candle(datetime(2025, 1, 1), Decimal("100"), Decimal("110"), Decimal("90"), Decimal("105")),
            Candle(datetime(2025, 1, 2), Decimal("105"), Decimal("120"), Decimal("100"), Decimal("118")),
            Candle(datetime(2025, 1, 3), Decimal("118"), Decimal("125"), Decimal("115"), Decimal("121")),
        ]
    monkeypatch.setattr(ph, "get_historical_ohlcv", fake_candles)

    r = client.get(f"/api/asset/{aid}/ohlcv?days=30")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "BTC"
    assert len(body["candles"]) == 3
    assert body["candles"][0]["close"] == "105"          # orden ascendente
    assert body["candles"][-1]["close"] == "121"
    assert body["candles"][0]["timestamp"].startswith("2025-01-01")
