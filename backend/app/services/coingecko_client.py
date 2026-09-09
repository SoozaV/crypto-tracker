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
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from ..config import COINGECKO_API_KEY, COINGECKO_BASE_URL
from .price_cache import price_cache

VS_CURRENCY = os.getenv("MARKET_VS_CURRENCY", "usd")
# (connect, read): conexión rápida y lectura acotada. Antes era 15s únicos, que
# combinados con 4 reintentos bloqueaban ~63s por llamada.
_TIMEOUT = (3.05, 6)


class MarketDataError(RuntimeError):
    """Fallo al obtener datos de mercado."""


def _headers() -> dict[str, str]:
    h = {"accept": "application/json"}
    if COINGECKO_API_KEY:
        h["x-cg-demo-api-key"] = COINGECKO_API_KEY
    return h


def _should_retry(exc: BaseException) -> bool:
    """Reintenta solo ante problemas transitorios: caídas de conexión, timeouts
    y errores 5xx del servidor. NO reintenta ante 429 (rate limit) ni otros 4xx:
    reintentarlos empeora el rate limit y bloquea el hilo; es mejor fallar rápido
    y degradar (mostrar el precio como no disponible)."""
    if isinstance(exc, (requests.ConnectionError, requests.Timeout)):
        return True
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        return exc.response.status_code >= 500
    return False


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.4, min=0.4, max=2),
    retry=retry_if_exception(_should_retry),
)
def _get(path: str, params: dict[str, Any]) -> Any:
    """GET con reintentos SOLO en fallos transitorios. Devuelve JSON con Decimal."""
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


def _md_from_row(row: dict[str, Any]) -> dict[str, Any]:
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
        return _md_from_row(data[0])

    if use_cache:
        return price_cache.get_or_set(cache_key, _fetch)
    return _fetch()


def prefetch_markets(coingecko_ids: list[str], use_cache: bool = True) -> dict[str, dict]:
    """
    Precarga en UNA sola llamada los datos de mercado de varios activos y los deja
    en caché (misma clave que get_market_data). Solo pide a la red los ids que NO
    estén ya cacheados y frescos.

    Con esto:
      - Refrescar el portafolio dentro del TTL (5 min) no llama a la red: 0 peticiones.
      - Al expirar el TTL, se refresca TODO en 1 sola petición (no 1 por activo).
      - Al añadir un activo nuevo, solo se pide ESE (los demás siguen en caché).
    """
    ids = [c for c in dict.fromkeys(coingecko_ids) if c]  # únicos, sin vacíos
    result: dict[str, dict] = {}
    missing: list[str] = []
    for cid in ids:
        cached = price_cache.get(f"market:{cid}:{VS_CURRENCY}") if use_cache else None
        if cached is not None:
            result[cid] = cached
        else:
            missing.append(cid)

    if missing:
        # CoinGecko admite hasta 250 ids por página en /coins/markets.
        data = _get("/coins/markets", {
            "vs_currency": VS_CURRENCY,
            "ids": ",".join(missing),
            "price_change_percentage": "24h,7d,30d",
            "per_page": min(len(missing), 250),
            "page": 1,
        })
        for row in (data or []):
            md = _md_from_row(row)
            cid = md.get("id")
            if cid:
                price_cache.set(f"market:{cid}:{VS_CURRENCY}", md)
                result[cid] = md
    return result


# Lista completa de monedas de CoinGecko (id, symbol, name). Se descarga UNA vez
# y se cachea muchas horas; el buscador filtra sobre ella en local para NO llamar
# a la API por cada tecla (clave para no agotar el rate limit del plan gratuito).
_COINS_LIST_TTL = 12 * 3600


def _get_coins_list() -> list[dict]:
    return price_cache.get_or_set(
        "coingecko:coins_list",
        lambda: _get("/coins/list", {}),
        ttl_seconds=_COINS_LIST_TTL,
    )


def search_coins(query: str, use_cache: bool = True) -> list[dict]:
    """
    Autocompletar de monedas filtrando en LOCAL sobre `/coins/list` (cacheada).
    Devuelve candidatas con su coingecko_id real para que el usuario ELIJA en vez
    de escribirlo a mano (evita el caso 'símbolo BTC con id de otra moneda').
    Orden: símbolo exacto, símbolo que empieza por, nombre que empieza por, y
    finalmente coincidencias parciales.
    """
    q = (query or "").strip().lower()
    if len(q) < 2:
        return []

    coins = _get_coins_list() if use_cache else _get("/coins/list", {})

    scored: list[tuple[int, int, dict]] = []
    for c in coins:
        sym = (c.get("symbol") or "").lower()
        name = (c.get("name") or "").lower()
        cid = (c.get("id") or "").lower()
        if sym == q:
            score = 0
        elif sym.startswith(q):
            score = 1
        elif name.startswith(q):
            score = 2
        elif q in name:
            score = 3
        elif q in sym or q in cid:
            score = 4
        else:
            continue
        scored.append((score, len(name), c))

    scored.sort(key=lambda t: (t[0], t[1]))
    out = []
    for _, __, c in scored[:15]:
        out.append({
            "id": c.get("id"),
            "symbol": (c.get("symbol") or "").upper(),
            "name": c.get("name"),
            "market_cap_rank": None,
            "thumb": None,
        })
    return out
