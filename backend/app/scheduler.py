"""
Cron job diario de actualización de OHLCV (tarea 4.2).

Usa APScheduler para ejecutar `update_all_assets()` cada día a las 00:00 UTC.
Se arranca/para desde el ciclo de vida de FastAPI (ver app/main.py).

Se puede desactivar poniendo ENABLE_SCHEDULER=0 en el entorno (útil en tests).
"""
from __future__ import annotations

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .database import SessionLocal
from .services.price_history_service import update_all_assets


def run_daily_update() -> None:
    """Job que abre una sesión y actualiza el histórico de todos los activos."""
    db = SessionLocal()
    try:
        report = update_all_assets(db, days=200)
        print(f"[scheduler] Histórico actualizado: {report}")
    finally:
        db.close()


def create_scheduler() -> BackgroundScheduler:
    """Crea el scheduler con el job diario a las 00:00 UTC."""
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        run_daily_update,
        trigger=CronTrigger(hour=0, minute=0, timezone="UTC"),
        id="daily_price_history_update",
        replace_existing=True,
        misfire_grace_time=3600,  # si el server estaba caído, lo ejecuta hasta 1h tarde
    )
    return scheduler
