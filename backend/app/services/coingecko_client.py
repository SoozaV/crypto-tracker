"""
Cliente de CoinGecko (tareas 2.1, 2.2) con caché (2.3) y reintentos (2.6).

Precisión: la respuesta JSON se parsea con `parse_float=Decimal`, así los precios
llegan como Decimal desde el primer momento (sin pasar por float y sin ruido).

Moneda: CoinGecko cotiza contra 'usd'. Como la moneda base del proyecto es USDT
(peg ~1:1 con USD), se usa 'usd' como proxy. Es configurable con MARKET_VS_CURRENCY.
"""
from __future__ import annotations

import json
import os
from decimal import Decimal
from typing import Any, Optional

import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..config import COINGECKO_API_KEY, COINGECKO_BASE_URL
from .price_cache import price_cache

VS_CURRENCY = os.getenv("MARKET_VS_CURRENCY", "usd")
_TIMEOUT = 15  # segundos


class MarketDataError(RuntimeError):
    """Fallo al obtener datos de mercado."""


def _headers() -> dict[str, str]:
    h = {"accept": "application/json"}
    if COINGECKO_API_KEY:
        h["x-cg-demo-api-key"] = COINGECKO_API_KEY
    return h


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
    retry=retry_if_exception_type(requests.RequestException),
)
def _get(path: str, params: dict[str, Any]) -> Any:
    """GET con reintentos exponenciales. Devuelve JSON parseado con Decimal."""
    url = f"{COINGECKO_BASE_URL}{path}"
    resp = requests.get(url, params=params, headers=_headers(), timeout=_TIMEOUT)
    resp.raise_for_status()
    # parse_float=Decimal -> los números del JSON son Decimal, no float.
    return json.loads(resp.text, parse_float=Decimal)


def get_live_price(coingecko_id: str, use_cache: bool = True) -> Decimal:
    """
    Precio actual del activo en USDT(~USD) como Decimal (tarea 2.1).
    Cacheado 60s por id (tarea 2.3).
    """
    cache_key = f"price:{coingecko_id}:{VS_CURRENCY}"

    def _fetch() -> Decimal:
        data = _get("/simple/price", {
            "ids": coingecko_id,
            "vs_currencies": VS_CURRENCY,
        })
        node = data.get(coingecko_id)
        if not node or VS_CURRENCY not in node:
            raise MarketDataError(
                f"CoinGecko no devolvió precio para id '{coingecko_id}'. "
                f"¿Es correcto el coingecko_id del activo?"
            )
        return Decimal(node[VS_CURRENCY])

    if use_cache:
        return price_cache.get_or_set(cache_key, _fetch)
    return _fetch()


def get_market_data(coingecko_id: str, use_cache: bool = True) -> dict[str, Any]:
    """
    Datos de mercado del activo (tarea 2.2): precio, cambios 24h/7d/30d, máx/mín 24h,
    market cap y volumen. Los porcentajes vienen listos para la Fase 3 (3.6).
    """
    cache_key = f"market:{coingecko_id}:{VS_CURRENCY}"

    def _fetch() -> dict[str, Any]:
        data = _get("/coins/markets", {
            "vs_currency": VS_CURRENCY,
            "ids": coingecko_id,
            "price_change_percentage": "24h,7d,30d",
        })
        if not data:
            raise MarketDataError(f"Sin datos de mercado para id '{coingecko_id}'.")
        row = data[0]

        def dec(v) -> Optional[Decimal]:
            return None if v is None else Decimal(str(v))

        return {
            "id": row.get("id"),
            "symbol": (row.get("symbol") or "").upper(),
            "price": dec(row.get("current_price")),
            "change_24h_pct": dec(row.get("price_change_percentage_24h_in_currency")),
            "change_7d_pct": dec(row.get("price_change_percentage_7d_in_currency")),
            "change_30d_pct": dec(row.get("price_change_percentage_30d_in_currency")),
            "high_24h": dec(row.get("high_24h")),
            "low_24h": dec(row.get("low_24h")),
            "market_cap": dec(row.get("market_cap")),
            "total_volume": dec(row.get("total_volume")),
            "last_updated": row.get("last_updated"),
        }

    if use_cache:
        return price_cache.get_or_set(cache_key, _fetch)
    return _fetch()
