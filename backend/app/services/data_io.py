"""
Exportar / importar / resetear datos (local, sin nube).

Diseño para NO duplicar al importar:
  - Cada transacción tiene un `uid` estable (UUID). El export lo incluye y el
    import omite las transacciones cuyo uid ya existe -> idempotente (reimportar
    el mismo archivo no crea duplicados) y dos transacciones legítimamente
    idénticas pueden coexistir (uids distintos).
  - Respaldo: si una transacción del archivo no trae uid (archivo hecho a mano),
    se deduplica por HASH de contenido (wallet, activo, tipo, cantidad, precio,
    fee_usdt, fecha) para evitar duplicados igualmente.

Identidades entre bases de datos distintas:
  - wallet -> por nombre (único).   asset -> por símbolo (único).

Ámbito del export: global (todo) o una wallet concreta (`wallet_id`).
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Asset, Transaction, Wallet, PriceHistory, Holding
from ..utils.datetime_utils import to_naive_utc
from ..utils.decimal_utils import D
from .acb_engine import ACBError, get_or_create_asset, get_or_create_wallet, recalculate_holding

SCHEMA_VERSION = 1


def _s(v) -> str:
    return str(v)


def _iso(dt: datetime) -> str:
    # date_utc se guarda naive-UTC; lo emitimos con sufijo Z explícito.
    return dt.replace(microsecond=0).isoformat() + "Z"


def _content_hash(wallet_name: str, asset_symbol: str, ttype: str,
                  quantity, price, fee_usdt, date_iso: str) -> str:
    parts = [
        wallet_name.strip().lower(),
        asset_symbol.strip().upper(),
        str(ttype).upper(),
        str(D(quantity)),
        str(D(price)),
        str(D(fee_usdt)),
        date_iso,
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


# --- EXPORT -------------------------------------------------------------------
def export_data(db: Session, wallet_id: Optional[int] = None) -> dict:
    if wallet_id is not None:
        wallets = [db.get(Wallet, wallet_id)]
        if wallets[0] is None:
            raise ACBError(f"No existe la wallet con id={wallet_id}.")
        tx_stmt = select(Transaction).where(Transaction.wallet_id == wallet_id)
    else:
        wallets = list(db.execute(select(Wallet).order_by(Wallet.id)).scalars())
        tx_stmt = select(Transaction)

    txs = list(db.execute(tx_stmt.order_by(Transaction.date_utc, Transaction.id)).scalars())

    # Activos referenciados por las transacciones exportadas (para scope wallet);
    # en global exportamos todo el catálogo para conservar metadatos.
    if wallet_id is not None:
        asset_ids = {t.asset_id for t in txs}
        assets = [a for a in db.execute(select(Asset)).scalars() if a.id in asset_ids]
    else:
        assets = list(db.execute(select(Asset).order_by(Asset.id)).scalars())

    return {
        "schema_version": SCHEMA_VERSION,
        "exported_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "scope": "wallet" if wallet_id is not None else "global",
        "wallets": [{"name": w.name, "type": w.type} for w in wallets],
        "assets": [
            {
                "symbol": a.symbol, "name": a.name, "decimals": a.decimals,
                "coingecko_id": a.coingecko_id, "binance_symbol": a.binance_symbol,
            }
            for a in assets
        ],
        "transactions": [
            {
                "uid": t.uid,
                "wallet_name": t.wallet.name,
                "asset_symbol": t.asset.symbol,
                "type": t.type,
                "quantity": _s(t.quantity),
                "price": _s(t.price),
                "fee": _s(t.fee),
                "fee_currency": t.fee_currency,
                "fee_usdt": _s(t.fee_usdt),
                "date_utc": _iso(t.date_utc),
            }
            for t in txs
        ],
    }


# --- IMPORT -------------------------------------------------------------------
def import_data(db: Session, payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ACBError("El archivo no tiene el formato esperado.")
    version = payload.get("schema_version", SCHEMA_VERSION)
    if int(version) > SCHEMA_VERSION:
        raise ACBError(f"Versión de archivo no soportada: {version}.")

    wallets_in = payload.get("wallets", []) or []
    assets_in = payload.get("assets", []) or []
    txs_in = payload.get("transactions", []) or []

    existing_wallet_names = {w.name for w in db.execute(select(Wallet)).scalars()}
    existing_asset_symbols = {a.symbol for a in db.execute(select(Asset)).scalars()}

    wallets_created = 0
    for w in wallets_in:
        name = (w.get("name") or "").strip()
        if not name:
            continue
        if name not in existing_wallet_names:
            wallets_created += 1
        get_or_create_wallet(db, name, w.get("type") or "EXCHANGE")

    assets_created = 0
    for a in assets_in:
        sym = (a.get("symbol") or "").strip().upper()
        if not sym:
            continue
        if sym not in existing_asset_symbols:
            assets_created += 1
        get_or_create_asset(
            db, sym, name=a.get("name"), decimals=int(a.get("decimals", 8)),
            coingecko_id=a.get("coingecko_id"), binance_symbol=a.get("binance_symbol"),
        )
    db.flush()

    wallet_by_name = {w.name: w for w in db.execute(select(Wallet)).scalars()}
    asset_by_symbol = {a.symbol: a for a in db.execute(select(Asset)).scalars()}

    existing_uids = {t.uid for t in db.execute(select(Transaction)).scalars()}
    existing_hashes = set()
    for t in db.execute(select(Transaction)).scalars():
        existing_hashes.add(_content_hash(
            t.wallet.name, t.asset.symbol, t.type, t.quantity, t.price, t.fee_usdt, _iso(t.date_utc)
        ))

    imported = 0
    skipped = 0
    affected: set[tuple[int, int]] = set()

    for t in txs_in:
        wname = (t.get("wallet_name") or "").strip()
        asym = (t.get("asset_symbol") or "").strip().upper()
        wallet = wallet_by_name.get(wname)
        asset = asset_by_symbol.get(asym)
        if wallet is None or asset is None:
            skipped += 1
            continue

        uid = (t.get("uid") or "").strip() or None
        date_iso = t.get("date_utc")
        chash = _content_hash(
            wname, asym, t.get("type", ""), t.get("quantity", 0),
            t.get("price", 0), t.get("fee_usdt", t.get("fee", 0)), date_iso,
        )

        if (uid and uid in existing_uids) or chash in existing_hashes:
            skipped += 1
            continue

        tx = Transaction(
            uid=uid or str(uuid4()),
            wallet_id=wallet.id,
            asset_id=asset.id,
            type=str(t.get("type", "")).upper(),
            quantity=D(t.get("quantity", 0)),
            price=D(t.get("price", 0)),
            fee=D(t.get("fee", 0)),
            fee_currency=(t.get("fee_currency") or "USDT").upper(),
            fee_usdt=D(t.get("fee_usdt", t.get("fee", 0))),
            date_utc=to_naive_utc(date_iso),
        )
        db.add(tx)
        existing_uids.add(tx.uid)
        existing_hashes.add(chash)
        affected.add((wallet.id, asset.id))
        imported += 1

    db.flush()

    # Recalcula el ACB de cada par afectado. Si la secuencia combinada es
    # inválida (dejaría negativo), recalculate_holding lanza ACBError y el caller
    # hace rollback -> import atómico.
    for wid, aid in affected:
        recalculate_holding(db, wid, aid)

    db.commit()
    return {
        "wallets_created": wallets_created,
        "assets_created": assets_created,
        "transactions_imported": imported,
        "transactions_skipped": skipped,
    }


# --- RESET --------------------------------------------------------------------
def reset_all(db: Session) -> dict:
    """Borra TODOS los datos del usuario (transacciones, holdings, price_history,
    assets y wallets). Mantiene el esquema. Operación destructiva."""
    counts = {
        "transactions": db.query(Transaction).count(),
        "holdings": db.query(Holding).count(),
        "price_history": db.query(PriceHistory).count(),
        "assets": db.query(Asset).count(),
        "wallets": db.query(Wallet).count(),
    }
    # Orden por dependencias (FK): tx y holdings y precios -> assets/wallets.
    db.query(Transaction).delete()
    db.query(Holding).delete()
    db.query(PriceHistory).delete()
    db.query(Asset).delete()
    db.query(Wallet).delete()
    db.commit()
    return {"deleted": counts}
