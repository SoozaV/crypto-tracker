"""
Tests de la Fase 2 (integración de precios), con las APIs simuladas.

No hacen llamadas de red reales: se mockean las respuestas para validar el
parseo a Decimal/UTC, la caché con TTL, los reintentos con tenacity y la
idempotencia del histórico.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Asset, PriceHistory
from app.services import coingecko_client as cg
from app.services.binance_client import parse_klines, get_historical_ohlcv
from app.services.price_cache import TTLCache, price_cache
from app.services.price_history_service import update_price_history


# --- CACHÉ TTL (2.3) ----------------------------------------------------------
def test_ttl_cache_expires_with_injected_clock():
    now = {"t": 1000.0}
    cache = TTLCache(ttl_seconds=60, clock=lambda: now["t"])
    calls = {"n": 0}

    def producer():
        calls["n"] += 1
        return "valor"

    assert cache.get_or_set("k", producer) == "valor"  # produce
    now["t"] += 30
    assert cache.get_or_set("k", producer) == "valor"  # aún cacheado
    assert calls["n"] == 1
    now["t"] += 31                                      # supera los 60s
    assert cache.get_or_set("k", producer) == "valor"  # re-produce
    assert calls["n"] == 2


# --- COINGECKO: precio en vivo (2.1) ------------------------------------------
def test_get_live_price_parses_decimal(monkeypatch):
    price_cache.clear()
    monkeypatch.setattr(cg, "_get", lambda path, params: {"bitcoin": {"usd": Decimal("64000.55")}})
    price = cg.get_live_price("bitcoin")
    assert price == Decimal("64000.55")
    assert isinstance(price, Decimal)


def test_get_live_price_uses_cache(monkeypatch):
    price_cache.clear()
    calls = {"n": 0}

    def fake_get(path, params):
        calls["n"] += 1
        return {"bitcoin": {"usd": Decimal("64000")}}

    monkeypatch.setattr(cg, "_get", fake_get)
    cg.get_live_price("bitcoin")
    cg.get_live_price("bitcoin")     # segunda vez -> desde caché
    assert calls["n"] == 1


def test_get_live_price_unknown_id_raises(monkeypatch):
    price_cache.clear()
    monkeypatch.setattr(cg, "_get", lambda path, params: {})
    with pytest.raises(cg.MarketDataError):
        cg.get_live_price("no-existe")


# --- COINGECKO: market data (2.2) ---------------------------------------------
def test_get_market_data_parses_fields(monkeypatch):
    price_cache.clear()
    fake_row = [{
        "id": "bitcoin", "symbol": "btc",
        "current_price": Decimal("64000"),
        "price_change_percentage_24h_in_currency": Decimal("2.5"),
        "price_change_percentage_7d_in_currency": Decimal("-3.1"),
        "price_change_percentage_30d_in_currency": Decimal("10.0"),
        "high_24h": Decimal("65000"), "low_24h": Decimal("63000"),
        "market_cap": Decimal("1200000000000"), "total_volume": Decimal("30000000000"),
        "last_updated": "2026-01-15T00:00:00Z",
    }]
    monkeypatch.setattr(cg, "_get", lambda path, params: fake_row)
    data = cg.get_market_data("bitcoin")
    assert data["symbol"] == "BTC"
    assert data["price"] == Decimal("64000")
    assert data["change_24h_pct"] == Decimal("2.5")
    assert data["change_7d_pct"] == Decimal("-3.1")
    assert data["change_30d_pct"] == Decimal("10.0")


# --- REINTENTOS con tenacity (2.6) --------------------------------------------
class _FakeResp:
    def __init__(self, payload_text):
        self.text = payload_text
    def raise_for_status(self):
        return None


def test_retry_recovers_after_transient_error(monkeypatch):
    price_cache.clear()
    attempts = {"n": 0}

    def flaky_get(url, params=None, headers=None, timeout=None):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise requests.ConnectionError("fallo temporal")
        return _FakeResp('{"bitcoin": {"usd": 64000.55}}')

    monkeypatch.setattr(cg.requests, "get", flaky_get)
    # get_live_price -> _get (con retry) -> requests.get
    price = cg.get_live_price("bitcoin", use_cache=False)
    assert price == Decimal("64000.55")   # parse_float=Decimal preserva la precisión
    assert attempts["n"] == 3             # falló 2 veces y recuperó a la 3ª


# --- BINANCE: parseo de velas (2.4) -------------------------------------------
def test_parse_klines_decimal_and_utc():
    raw = [
        # openTime(ms), open, high, low, close, volume, closeTime, ...
        [1735689600000, "42000.10", "42500.00", "41800.55", "42300.20", "123.4", 0],
        [1735776000000, "42300.20", "43000.00", "42000.00", "42900.99", "98.7", 0],
    ]
    candles = parse_klines(raw)
    assert len(candles) == 2
    assert candles[0].open == Decimal("42000.10")
    assert candles[0].close == Decimal("42300.20")
    # 1735689600000 ms == 2025-01-01 00:00:00 UTC
    assert candles[0].timestamp_utc == datetime(2025, 1, 1, 0, 0, 0)
    assert isinstance(candles[0].high, Decimal)


def test_get_historical_ohlcv_calls_binance(monkeypatch):
    from app.services import binance_client as bc
    raw = [[1735689600000, "100", "110", "90", "105", "1", 0]]
    monkeypatch.setattr(bc, "_get_klines", lambda symbol, interval, limit: raw)
    candles = bc.get_historical_ohlcv("BTCUSDT", days=1)
    assert candles[0].close == Decimal("105")


# --- price_history: persistencia idempotente (2.5) ----------------------------
@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)
    s = Session()
    try:
        yield s
    finally:
        s.close()


def test_update_price_history_is_idempotent(db, monkeypatch):
    from app.services import price_history_service as ph
    from app.services.binance_client import Candle

    asset = Asset(symbol="BTC", name="Bitcoin", decimals=8, binance_symbol="BTCUSDT")
    db.add(asset)
    db.commit()

    def fake_candles(symbol, days=200, interval="1d"):
        return [
            Candle(datetime(2025, 1, 1), Decimal("100"), Decimal("110"),
                   Decimal("90"), Decimal("105")),
            Candle(datetime(2025, 1, 2), Decimal("105"), Decimal("120"),
                   Decimal("100"), Decimal("118")),
        ]

    monkeypatch.setattr(ph, "get_historical_ohlcv", fake_candles)

    ins1, upd1 = update_price_history(db, asset, days=2)
    assert (ins1, upd1) == (2, 0)
    ins2, upd2 = update_price_history(db, asset, days=2)   # otra vez
    assert (ins2, upd2) == (0, 2)                          # no duplica, actualiza

    rows = db.query(PriceHistory).filter_by(asset_id=asset.id).count()
    assert rows == 2                                        # sigue habiendo 2 filas
    close = db.query(PriceHistory).filter_by(
        asset_id=asset.id, timestamp_utc=datetime(2025, 1, 2)).one().close
    assert close == Decimal("118")


def test_prefetch_markets_batches_and_caches(monkeypatch):
    """prefetch_markets hace UNA sola petición para varios ids y los deja en caché,
    de modo que get_market_data luego no vuelve a llamar a la red."""
    price_cache.clear()
    calls = {"n": 0, "last_ids": None}

    def fake_get(url, params=None, headers=None, timeout=None):
        calls["n"] += 1
        calls["last_ids"] = params.get("ids")
        return _FakeResp(
            '[{"id":"bitcoin","symbol":"btc","current_price":64000,'
            '"price_change_percentage_24h_in_currency":1.5},'
            '{"id":"ethereum","symbol":"eth","current_price":3000,'
            '"price_change_percentage_24h_in_currency":-2.0}]'
        )

    monkeypatch.setattr(cg.requests, "get", fake_get)
    result = cg.prefetch_markets(["bitcoin", "ethereum"])
    assert calls["n"] == 1                          # UNA sola petición para 2 ids
    assert "bitcoin" in calls["last_ids"] and "ethereum" in calls["last_ids"]
    assert result["bitcoin"]["price"] == Decimal("64000")

    # get_market_data ahora sale de caché (no incrementa las llamadas de red)
    md = cg.get_market_data("ethereum")
    assert md["price"] == Decimal("3000")
    assert calls["n"] == 1                           # sigue siendo 1 -> vino de caché


def test_prefetch_only_fetches_missing(monkeypatch):
    """Si un id ya está cacheado, prefetch solo pide los que faltan (añadir un
    activo nuevo no re-pide los que ya tenías)."""
    price_cache.clear()
    calls = {"ids": []}

    def fake_get(url, params=None, headers=None, timeout=None):
        calls["ids"].append(params.get("ids"))
        # Devuelve solo lo pedido
        ids = params.get("ids").split(",")
        rows = ",".join(
            f'{{"id":"{i}","symbol":"x","current_price":10}}' for i in ids
        )
        return _FakeResp(f"[{rows}]")

    monkeypatch.setattr(cg.requests, "get", fake_get)
    cg.prefetch_markets(["bitcoin"])                 # pide bitcoin
    cg.prefetch_markets(["bitcoin", "solana"])       # solo debería pedir solana
    assert calls["ids"] == ["bitcoin", "solana"]
