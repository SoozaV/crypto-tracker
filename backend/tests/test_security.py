"""
Tests de seguridad (Fase 6): CORS restringido (6.2) y rate limiting (6.3).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app


@pytest.fixture()
def make_client(monkeypatch):
    """Fábrica de TestClient con BD en memoria; permite fijar el RATE_LIMIT."""
    monkeypatch.setenv("ENABLE_SCHEDULER", "0")

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

    def _factory(rate_limit: str = "1000000/minute"):
        monkeypatch.setenv("RATE_LIMIT", rate_limit)
        return TestClient(app)

    yield _factory
    app.dependency_overrides.clear()


# --- CORS (6.2) ---------------------------------------------------------------
def test_cors_allows_configured_origin(make_client):
    client = make_client()
    r = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_blocks_unknown_origin(make_client):
    client = make_client()
    r = client.get("/api/health", headers={"Origin": "http://evil.example.com"})
    # La petición responde, pero SIN cabecera que autorice al origen no permitido.
    assert r.headers.get("access-control-allow-origin") is None


# --- Rate limiting (6.3) ------------------------------------------------------
def test_rate_limit_returns_429(make_client):
    client = make_client(rate_limit="3/minute")
    codes = [client.get("/api/health").status_code for _ in range(4)]
    assert codes[:3] == [200, 200, 200]   # las 3 primeras pasan
    assert codes[3] == 429                 # la 4ª supera el límite
