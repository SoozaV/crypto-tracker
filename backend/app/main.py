"""
API FastAPI.

Endpoints de la Fase 3 (métricas), todos con scope seleccionable vía
`?wallet_id=` (ausente = global, presente = esa wallet):
  * GET  /api/portfolio/summary        (3.1 + 3.5)   valor total + asignación
  * GET  /api/portfolio/realized-pnl   (3.3)
  * GET  /api/asset/{asset_id}         (3.7)         detalle completo
  * GET  /api/asset/{asset_id}/changes (3.6)         cambios 24h/7d/30d

Endpoints de apoyo (para el selector y para alimentar datos por la API):
  * GET  /api/wallets                  lista de wallets (para el selector)
  * GET  /api/assets                   catálogo de activos
  * GET  /api/transactions             historial (filtros wallet_id / asset_id)
  * POST /api/transactions             registra una transacción (envuelve 1.9)
  * POST /api/setup                    onboarding: depósito inicial (1.11)

Nota: los importes viajan como STRING para no perder precisión (el frontend los
lee con decimal.js). Los errores de negocio del ACB devuelven HTTP 400 (tarea 1.7).
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import CORS_ORIGINS
from .database import get_db
from .models import Asset, Transaction, Wallet
from .services.acb_engine import ACBError, add_transaction, get_or_create_asset, get_or_create_wallet, recalculate_holding
from .services import metrics
from .services.price_history_service import ensure_ohlcv, update_all_assets
from .scripts.initial_setup import seed_initial_balance


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Arranca el cron de OHLCV al iniciar y lo detiene al cerrar (tarea 4.2)."""
    scheduler = None
    if os.getenv("ENABLE_SCHEDULER", "1") != "0":
        from .scheduler import create_scheduler
        scheduler = create_scheduler()
        scheduler.start()
        print("[scheduler] Cron diario de OHLCV activo (00:00 UTC).")
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)


# --- Rate limiting (tarea 6.3) -----------------------------------------------
# El límite se lee del entorno EN CADA request (callable), así es configurable
# sin tocar código y fácil de testear (RATE_LIMIT="100/minute" por defecto).
def _default_rate_limit() -> str:
    return os.getenv("RATE_LIMIT", "100/minute")


from fastapi.responses import JSONResponse


def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429,
                        content={"detail": "Rate limit excedido. Baja el ritmo."})


limiter = Limiter(key_func=get_remote_address, default_limits=[_default_rate_limit])

app = FastAPI(title="Crypto Portfolio Tracker", version="0.6.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS restringido al/los origen(es) del frontend (tarea 6.2).
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(ACBError)
async def _acb_error_handler(request, exc: ACBError):  # noqa: ANN001
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# --- Modelos de entrada -------------------------------------------------------
class TransactionIn(BaseModel):
    wallet_id: int
    asset_id: int
    type: str = Field(..., description="BUY | SELL | DEPOSIT | WITHDRAWAL")
    quantity: str
    price: str = "0"
    fee: str = "0"
    fee_currency: str = "USDT"
    fee_usdt: Optional[str] = None
    date: str = Field(..., description="ISO 8601 con zona horaria o timestamp Unix")


class SetupIn(BaseModel):
    wallet_name: str
    symbol: str
    quantity: str
    total_cost: str
    decimals: int = 8
    wallet_type: str = "EXCHANGE"
    name: Optional[str] = None
    coingecko_id: Optional[str] = None
    binance_symbol: Optional[str] = None
    date: Optional[str] = None


# --- Selector / catálogo ------------------------------------------------------
@app.get("/api/wallets")
def list_wallets(db: Session = Depends(get_db)):
    wallets = db.execute(select(Wallet)).scalars().all()
    return [{"id": w.id, "name": w.name, "type": w.type} for w in wallets]


@app.get("/api/assets")
def list_assets(db: Session = Depends(get_db)):
    assets = db.execute(select(Asset)).scalars().all()
    return [{
        "id": a.id, "symbol": a.symbol, "name": a.name, "decimals": a.decimals,
        "coingecko_id": a.coingecko_id, "binance_symbol": a.binance_symbol,
    } for a in assets]


# --- Métricas (Fase 3) --------------------------------------------------------
@app.get("/api/portfolio/summary")
def portfolio_summary(
    wallet_id: Optional[int] = Query(None, description="Ausente = global"),
    db: Session = Depends(get_db),
):
    # Pasamos el market_provider para que cada activo traiga sus cambios 24h/7d/30d
    # (3.6) y la lista pueda mostrarlos sin llamadas extra por fila.
    return metrics.get_portfolio_summary(
        db, wallet_id, market_provider=metrics.default_market_provider
    )


@app.get("/api/portfolio/realized-pnl")
def realized_pnl(wallet_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    return {
        "scope": "wallet" if wallet_id is not None else "global",
        "wallet_id": wallet_id,
        "realized_pnl": str(metrics.get_realized_pnl_total(db, wallet_id)),
    }


@app.get("/api/asset/{asset_id}")
def asset_detail(
    asset_id: int,
    wallet_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    try:
        return metrics.get_asset_detail(db, asset_id, wallet_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/api/asset/{asset_id}/changes")
def asset_changes(asset_id: int, db: Session = Depends(get_db)):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Activo no encontrado.")
    try:
        return metrics.get_price_changes(asset)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Error de datos de mercado: {exc}")


# --- OHLCV crudo para el frontend (Fase 4) -----------------------------------
@app.get("/api/asset/{asset_id}/ohlcv")
def asset_ohlcv(
    asset_id: int,
    days: int = Query(30, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """
    Velas OHLCV crudas (tarea 4.1). El backend NO calcula indicadores: solo sirve
    los datos; el frontend los calcula (RSI, SMA, etc.) con `technicalindicators`.
    Si aún no hay histórico guardado, lo descarga de Binance una vez.
    """
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Activo no encontrado.")
    try:
        rows = ensure_ohlcv(db, asset, days=days)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Error obteniendo OHLCV: {exc}")
    return {
        "asset_id": asset.id,
        "symbol": asset.symbol,
        "days": days,
        "candles": [{
            "timestamp": r.timestamp_utc.replace(microsecond=0).isoformat() + "Z",
            "open": str(r.open), "high": str(r.high),
            "low": str(r.low), "close": str(r.close),
        } for r in rows],
    }


# --- Escritura / lectura de datos (apoyo) ------------------------------------
@app.get("/api/transactions")
def list_transactions(
    wallet_id: Optional[int] = Query(None),
    asset_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Lista transacciones (más recientes primero), filtrables por wallet/activo."""
    stmt = select(Transaction).order_by(Transaction.date_utc.desc(), Transaction.id.desc())
    if wallet_id is not None:
        stmt = stmt.where(Transaction.wallet_id == wallet_id)
    if asset_id is not None:
        stmt = stmt.where(Transaction.asset_id == asset_id)
    rows = db.execute(stmt).scalars().all()
    # Mapa id -> symbol para no N+1 en el frontend.
    asset_ids = {t.asset_id for t in rows}
    symbols = {}
    if asset_ids:
        for a in db.execute(select(Asset).where(Asset.id.in_(asset_ids))).scalars():
            symbols[a.id] = a.symbol
    return [{
        "id": t.id,
        "wallet_id": t.wallet_id,
        "asset_id": t.asset_id,
        "asset_symbol": symbols.get(t.asset_id),
        "type": t.type,
        "quantity": str(t.quantity),
        "price": str(t.price),
        "fee": str(t.fee),
        "fee_currency": t.fee_currency,
        "fee_usdt": str(t.fee_usdt),
        "date_utc": t.date_utc.replace(microsecond=0).isoformat() + "Z",
    } for t in rows]


@app.post("/api/transactions", status_code=201)
def create_transaction(payload: TransactionIn, db: Session = Depends(get_db)):
    tx = add_transaction(
        db,
        wallet_id=payload.wallet_id,
        asset_id=payload.asset_id,
        tx_type=payload.type,
        quantity=payload.quantity,
        price=payload.price,
        fee=payload.fee,
        fee_currency=payload.fee_currency,
        fee_usdt=payload.fee_usdt,
        date=payload.date,
    )
    return {"id": tx.id, "asset_id": tx.asset_id, "wallet_id": tx.wallet_id,
            "type": tx.type, "fee_usdt": str(tx.fee_usdt)}


@app.delete("/api/transactions/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    """
    Elimina una transacción y recalcula el ACB del par (wallet, activo) afectado.

    Si borrarla dejara en negativo una venta/retiro posterior (p. ej. eliminar la
    compra de la que dependía una venta), se aborta con HTTP 400 y no se borra nada.
    """
    tx = db.get(Transaction, tx_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="Transacción no encontrada.")
    wallet_id, asset_id = tx.wallet_id, tx.asset_id
    db.delete(tx)
    db.flush()
    try:
        recalculate_holding(db, wallet_id, asset_id)  # relee y valida la secuencia
    except ACBError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="No se puede eliminar: dejaría en negativo una venta o retiro "
                   "posterior. Elimina o ajusta esas transacciones primero.",
        )
    db.commit()
    return {"deleted": tx_id, "wallet_id": wallet_id, "asset_id": asset_id}


@app.get("/api/coins/search")
def coins_search(q: str = Query(..., min_length=2, description="Nombre o símbolo")):
    """
    Autocompletar de monedas (CoinGecko). Devuelve candidatas con su coingecko_id
    real para que el usuario ELIJA en vez de escribirlo a mano.
    """
    from .services.coingecko_client import search_coins
    try:
        return search_coins(q)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Error consultando CoinGecko: {exc}")


@app.post("/api/setup", status_code=201)
def setup_initial_balance(payload: SetupIn, db: Session = Depends(get_db)):
    tx = seed_initial_balance(
        db,
        wallet_name=payload.wallet_name,
        symbol=payload.symbol,
        quantity=payload.quantity,
        total_cost=payload.total_cost,
        decimals=payload.decimals,
        wallet_type=payload.wallet_type,
        name=payload.name,
        coingecko_id=payload.coingecko_id,
        binance_symbol=payload.binance_symbol,
        date=payload.date,
    )
    return {"transaction_id": tx.id, "wallet_id": tx.wallet_id, "asset_id": tx.asset_id}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/admin/refresh-prices")
def refresh_prices(days: int = Query(200, ge=1, le=1000), db: Session = Depends(get_db)):
    """Ejecuta manualmente la actualización del histórico (lo mismo que el cron)."""
    report = update_all_assets(db, days=days)
    return {"updated": {k: {"inserted": v[0], "updated": v[1]} for k, v in report.items()}}
