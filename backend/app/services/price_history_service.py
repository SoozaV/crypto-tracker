"""
Servicio de histórico de precios (tarea 2.5).

`update_price_history()` obtiene velas OHLCV de Binance y las guarda/actualiza en
la tabla `price_history`. Es idempotente: volver a ejecutarlo no duplica filas
(clave única asset_id + timestamp_utc); si una vela ya existe, actualiza su OHLC.

Este servicio es el que ejecutará el cron job diario a las 00:00 UTC (tarea 4.2).
"""
from __future__ import annotations

import os
import time
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Asset, PriceHistory
from .binance_client import Candle, get_historical_ohlcv


def _upsert_candles(db: Session, asset_id: int, candles: Iterable[Candle]) -> tuple[int, int]:
    """Inserta o actualiza velas. Devuelve (insertadas, actualizadas)."""
    candles = list(candles)
    if not candles:
        return (0, 0)

    timestamps = [c.timestamp_utc for c in candles]
    existing = {
        row.timestamp_utc: row
        for row in db.execute(
            select(PriceHistory).where(
                PriceHistory.asset_id == asset_id,
                PriceHistory.timestamp_utc.in_(timestamps),
            )
        ).scalars().all()
    }

    inserted = updated = 0
    for c in candles:
        row = existing.get(c.timestamp_utc)
        if row is None:
            db.add(PriceHistory(
                asset_id=asset_id, timestamp_utc=c.timestamp_utc,
                open=c.open, high=c.high, low=c.low, close=c.close,
            ))
            inserted += 1
        else:
            row.open, row.high, row.low, row.close = c.open, c.high, c.low, c.close
            updated += 1
    db.flush()
    return (inserted, updated)


def update_price_history(
    db: Session, asset: Asset, days: int = 200, commit: bool = True
) -> tuple[int, int]:
    """
    Descarga las velas diarias del activo y las guarda en `price_history`.
    Requiere que el activo tenga `binance_symbol` (ej. 'BTCUSDT').
    """
    symbol = asset.binance_symbol or f"{asset.symbol}USDT"
    candles = get_historical_ohlcv(symbol, days=days)
    result = _upsert_candles(db, asset.id, candles)
    if commit:
        db.commit()
    return result


def update_all_assets(db: Session, days: int = 200) -> dict[str, tuple[int, int]]:
    """Actualiza el histórico de TODOS los activos del catálogo (para el cron).

    Entre activos espera un poco (BINANCE_CRON_DELAY, 0.1s por defecto) para ser
    amable con Binance y no encadenar peticiones que puedan provocar 429/418 con
    muchos activos. Un fallo en un activo no tumba al resto.
    """
    delay = float(os.getenv("BINANCE_CRON_DELAY", "0.1"))
    assets = db.execute(select(Asset)).scalars().all()
    report: dict[str, tuple[int, int]] = {}
    for i, asset in enumerate(assets):
        if i > 0 and delay > 0:
            time.sleep(delay)
        try:
            report[asset.symbol] = update_price_history(db, asset, days=days, commit=False)
        except Exception as exc:  # noqa: BLE001  -> un activo no debe tumbar el resto
            report[asset.symbol] = (-1, -1)
            print(f"[price_history] Error con {asset.symbol}: {exc}")
    db.commit()
    return report


def get_stored_ohlcv(db: Session, asset_id: int, days: int = 30) -> list[PriceHistory]:
    """Últimas `days` velas guardadas del activo, ordenadas de antigua a reciente."""
    rows = db.execute(
        select(PriceHistory)
        .where(PriceHistory.asset_id == asset_id)
        .order_by(PriceHistory.timestamp_utc.desc())
        .limit(days)
    ).scalars().all()
    return list(reversed(rows))


def ensure_ohlcv(db: Session, asset: Asset, days: int = 30) -> list[PriceHistory]:
    """
    Devuelve las velas guardadas; si no hay ninguna todavía (el cron aún no corrió),
    las descarga de Binance una vez y las guarda antes de devolverlas.
    """
    rows = get_stored_ohlcv(db, asset.id, days)
    if not rows:
        update_price_history(db, asset, days=max(days, 200))
        rows = get_stored_ohlcv(db, asset.id, days)
    return rows
