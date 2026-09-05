"""
Cliente de Binance para velas OHLCV históricas (tarea 2.4) con reintentos (2.6).

Usa el endpoint público /api/v3/klines (no requiere API key). Binance devuelve
los precios como STRINGS, así que Decimal(str) es exacto por construcción.
Los timestamps vienen en milisegundos UTC -> se convierten a datetime UTC.

Nota: la API de Binance puede estar restringida geográficamente en algunos
países. Si te devuelve 451/403, revisa la guía del README (alternativa: usar el
endpoint OHLC de CoinGecko).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

BINANCE_BASE_URL = os.getenv("BINANCE_BASE_URL", "https://api.binance.com")
_TIMEOUT = (3.05, 10)


class OHLCVError(RuntimeError):
    """Fallo al obtener velas OHLCV."""


@dataclass
class Candle:
    timestamp_utc: datetime  # apertura de la vela, en UTC (naive)
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal

    def as_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp_utc.replace(tzinfo=timezone.utc).isoformat(),
            "open": str(self.open),
            "high": str(self.high),
            "low": str(self.low),
            "close": str(self.close),
        }


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
    retry=retry_if_exception_type((requests.ConnectionError, requests.Timeout)),
)
def _get_klines(symbol: str, interval: str, limit: int) -> list[list[Any]]:
    url = f"{BINANCE_BASE_URL}/api/v3/klines"
    resp = requests.get(
        url, params={"symbol": symbol, "interval": interval, "limit": limit},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def parse_klines(raw: list[list[Any]]) -> list[Candle]:
    """Convierte la respuesta cruda de Binance en una lista de Candle (Decimal/UTC)."""
    candles: list[Candle] = []
    for k in raw:
        # k = [openTime(ms), open, high, low, close, volume, closeTime, ...]
        open_ms = int(k[0])
        ts = datetime.fromtimestamp(open_ms / 1000, tz=timezone.utc).replace(tzinfo=None)
        candles.append(Candle(
            timestamp_utc=ts,
            open=Decimal(str(k[1])),
            high=Decimal(str(k[2])),
            low=Decimal(str(k[3])),
            close=Decimal(str(k[4])),
        ))
    return candles


def get_historical_ohlcv(binance_symbol: str, days: int = 200,
                         interval: str = "1d") -> list[Candle]:
    """
    Devuelve hasta `days` velas diarias (por defecto) del par indicado
    (ej. 'BTCUSDT'), ordenadas de más antigua a más reciente.
    """
    if not binance_symbol:
        raise OHLCVError("Falta binance_symbol (ej. 'BTCUSDT').")
    raw = _get_klines(binance_symbol.upper(), interval, days)
    return parse_klines(raw)
