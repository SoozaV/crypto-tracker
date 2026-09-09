"""
Motor ACB (Average Cost Basis) — Fase 1 (ACB por wallet).

El coste promedio se calcula por par (wallet, activo). El estado se guarda en la
tabla `holdings`. Las funciones clave:
  * calculate_acb(wallet_id, asset_id) -> recalcula estado leyendo las tx de esa
                                          wallet+activo ordenadas por fecha UTC.
  * add_transaction(...)               -> valida, resuelve fee->USDT, inserta y
                                          recalcula el holding afectado.
  * recalculate_holding(...)           -> vuelca el estado en la fila `holdings`.

Reglas de contabilidad (todo en Decimal, precio y fees en USDT):
  COMPRA / DEPÓSITO:  cantidad += q ; coste += q*precio + fee_usdt
  VENTA:              avg = coste/cantidad (antes) ;
                      PnL_real += (precio - avg)*q - fee_usdt ;
                      coste -= avg*q ; cantidad -= q
  RETIRO:             igual que VENTA pero SIN PnL.

Fees (decisión: lo más simple sin perder precisión):
  El fee que usa el ACB es SIEMPRE `fee_usdt`, resuelto al insertar así:
    - fee == 0                         -> 0
    - se pasa fee_usdt explícito       -> se usa tal cual (para monedas exóticas,
                                          ej. BNB: el usuario mete el valor exacto
                                          en USDT que le cobraron; cero conversión).
    - fee_currency == USDT             -> fee
    - fee_currency == símbolo del activo -> fee * precio de la operación
    - otra moneda y sin fee_usdt       -> error pidiendo el fee_usdt.
  Como `fee_usdt` queda guardado, el replay es determinista y no vuelve a convertir.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import BASE_CURRENCY
from ..models import Asset, Holding, Transaction, TransactionType, Wallet
from ..utils.datetime_utils import to_naive_utc
from ..utils.decimal_utils import D, ZERO


# --- Errores de dominio (el API los mapea a HTTP 400, tarea 1.7) --------------
class ACBError(ValueError):
    """Error de negocio del motor ACB."""


class InsufficientQuantityError(ACBError):
    """Se intenta vender/retirar más de lo que se posee en esa wallet."""


class FeeConversionError(ACBError):
    """No se puede convertir el fee a USDT con los datos disponibles."""


# --- Estado acumulado del ACB -------------------------------------------------
@dataclass
class ACBState:
    total_quantity: Decimal = field(default_factory=lambda: ZERO)
    total_cost_basis: Decimal = field(default_factory=lambda: ZERO)
    realized_pnl: Decimal = field(default_factory=lambda: ZERO)

    @property
    def average_price(self) -> Decimal:
        if self.total_quantity == ZERO:
            return ZERO
        return self.total_cost_basis / self.total_quantity


def resolve_fee_usdt(
    fee: Decimal,
    fee_currency: str,
    asset_symbol: str,
    price: Decimal,
    fee_usdt_override: Optional[Decimal] = None,
) -> Decimal:
    """Determina el fee en USDT que usará el ACB (ver docstring del módulo)."""
    fee = D(fee)
    if fee == ZERO and fee_usdt_override is None:
        return ZERO
    if fee_usdt_override is not None:
        return D(fee_usdt_override)
    cur = (fee_currency or BASE_CURRENCY).upper()
    if cur == BASE_CURRENCY.upper():
        return fee
    if cur == asset_symbol.upper():
        return fee * D(price)
    raise FeeConversionError(
        f"Fee en '{cur}' no convertible automáticamente. Envía 'fee_usdt' con el "
        f"valor exacto en {BASE_CURRENCY} que te cobraron (así no se pierde "
        f"precisión), o usa '{BASE_CURRENCY}' o '{asset_symbol}' como fee_currency."
    )


def _apply(state: ACBState, tx: Transaction, asset_symbol: str) -> None:
    """Aplica UNA transacción al estado en curso (usa el fee_usdt ya guardado)."""
    q = D(tx.quantity)
    price = D(tx.price)
    fee_usdt = D(tx.fee_usdt)
    ttype = tx.type.value if isinstance(tx.type, TransactionType) else str(tx.type)

    if ttype in (TransactionType.BUY.value, TransactionType.DEPOSIT.value):
        state.total_quantity += q
        state.total_cost_basis += q * price + fee_usdt

    elif ttype in (TransactionType.SELL.value, TransactionType.WITHDRAWAL.value):
        if q > state.total_quantity:
            raise InsufficientQuantityError(
                f"No se puede {ttype.lower()} {q} de {asset_symbol}: "
                f"solo hay {state.total_quantity} en esta wallet."
            )
        avg = state.average_price
        cost_removed = avg * q
        if ttype == TransactionType.SELL.value:
            state.realized_pnl += (price - avg) * q - fee_usdt
        state.total_cost_basis -= cost_removed
        state.total_quantity -= q
        if state.total_quantity == ZERO:
            state.total_cost_basis = ZERO
    else:
        raise ACBError(f"Tipo de transacción desconocido: {ttype!r}")


def _replay(transactions: Iterable[Transaction], asset_symbol: str) -> ACBState:
    state = ACBState()
    for tx in transactions:
        _apply(state, tx, asset_symbol)
    return state


def _ordered_transactions(db: Session, wallet_id: int, asset_id: int) -> list[Transaction]:
    """Transacciones de (wallet, activo) ordenadas por fecha UTC y luego por id."""
    stmt = (
        select(Transaction)
        .where(Transaction.wallet_id == wallet_id, Transaction.asset_id == asset_id)
        .order_by(Transaction.date_utc.asc(), Transaction.id.asc())
    )
    return list(db.execute(stmt).scalars().all())


# --- API pública del motor ----------------------------------------------------
def calculate_acb(db: Session, wallet_id: int, asset_id: int) -> ACBState:
    """Recalcula el ACB del par (wallet, activo) leyendo sus tx cronológicamente."""
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise ACBError(f"No existe el activo con id={asset_id}.")
    txs = _ordered_transactions(db, wallet_id, asset_id)
    return _replay(txs, asset.symbol)


def recalculate_holding(db: Session, wallet_id: int, asset_id: int) -> ACBState:
    """Recalcula y persiste el estado en la fila `holdings` correspondiente."""
    state = calculate_acb(db, wallet_id, asset_id)
    holding = get_or_create_holding(db, wallet_id, asset_id)
    holding.total_quantity = state.total_quantity
    holding.total_cost_basis = state.total_cost_basis
    holding.realized_pnl = state.realized_pnl
    db.flush()
    return state


def add_transaction(
    db: Session,
    *,
    wallet_id: int,
    asset_id: int,
    tx_type: TransactionType | str,
    quantity,
    price=0,
    fee=0,
    fee_currency: str = BASE_CURRENCY,
    fee_usdt: Optional[Decimal] = None,
    date,
    commit: bool = True,
) -> Transaction:
    """
    Registra una transacción (tarea 1.9) para un par (wallet, activo).

    1. Valida existencia de wallet/asset y datos básicos.
    2. Resuelve el fee a USDT y lo guarda en la transacción (autoritativo).
    3. Simula el replay completo de esa wallet+activo (existentes + nueva) para
       impedir cantidades negativas (tarea 1.7, robusto ante fechas retroactivas).
    4. Inserta y recalcula el holding.
    """
    ttype = (
        tx_type if isinstance(tx_type, TransactionType)
        else TransactionType(str(tx_type).upper())
    )

    asset = db.get(Asset, asset_id)
    if asset is None:
        raise ACBError(f"No existe el activo con id={asset_id}.")
    wallet = db.get(Wallet, wallet_id)
    if wallet is None:
        raise ACBError(f"No existe la wallet con id={wallet_id}.")

    q = D(quantity)
    if q <= ZERO:
        raise ACBError("La cantidad debe ser mayor que 0.")
    if D(price) < ZERO:
        raise ACBError("El precio no puede ser negativo.")
    if D(fee) < ZERO:
        raise ACBError("El fee no puede ser negativo.")

    resolved_fee_usdt = resolve_fee_usdt(
        D(fee), fee_currency, asset.symbol, D(price), fee_usdt
    )

    tx = Transaction(
        wallet_id=wallet_id,
        asset_id=asset_id,
        type=ttype.value,
        quantity=q,
        price=D(price),
        fee=D(fee),
        fee_currency=(fee_currency or BASE_CURRENCY).upper(),
        fee_usdt=resolved_fee_usdt,
        date_utc=to_naive_utc(date),
    )

    # --- Validación por simulación (no toca la BD todavía) --------------------
    existing = _ordered_transactions(db, wallet_id, asset_id)
    simulated = existing + [tx]
    simulated.sort(key=lambda t: (t.date_utc, t.id if t.id is not None else 1 << 62))
    _replay(simulated, asset.symbol)  # lanza si algo queda negativo

    # --- Persistencia --------------------------------------------------------
    db.add(tx)
    db.flush()  # asigna tx.id
    recalculate_holding(db, wallet_id, asset_id)

    if commit:
        db.commit()
        db.refresh(tx)
    return tx


# --- Helpers de catálogo / holdings -------------------------------------------
def get_or_create_asset(
    db: Session,
    symbol: str,
    *,
    name: Optional[str] = None,
    decimals: int = 8,
    coingecko_id: Optional[str] = None,
    binance_symbol: Optional[str] = None,
    commit: bool = False,
) -> Asset:
    """Devuelve el activo por símbolo, creándolo/actualizando metadatos si procede."""
    symbol = symbol.upper()
    asset = db.execute(select(Asset).where(Asset.symbol == symbol)).scalar_one_or_none()
    if asset is None:
        asset = Asset(
            symbol=symbol, name=name, decimals=decimals,
            coingecko_id=coingecko_id,
            binance_symbol=binance_symbol or f"{symbol}USDT",
        )
        db.add(asset)
        db.flush()
    else:
        # Completa metadatos que falten sin pisar los existentes.
        if name and not asset.name:
            asset.name = name
        if coingecko_id and not asset.coingecko_id:
            asset.coingecko_id = coingecko_id
        if binance_symbol and not asset.binance_symbol:
            asset.binance_symbol = binance_symbol
    if commit:
        db.commit()
    return asset


def get_or_create_wallet(
    db: Session, name: str, wallet_type: str = "EXCHANGE", commit: bool = False
) -> Wallet:
    wallet = db.execute(select(Wallet).where(Wallet.name == name)).scalar_one_or_none()
    if wallet is None:
        wallet = Wallet(name=name, type=str(wallet_type).upper())
        db.add(wallet)
        db.flush()
    if commit:
        db.commit()
    return wallet


def get_or_create_holding(db: Session, wallet_id: int, asset_id: int) -> Holding:
    holding = db.execute(
        select(Holding).where(
            Holding.wallet_id == wallet_id, Holding.asset_id == asset_id
        )
    ).scalar_one_or_none()
    if holding is None:
        holding = Holding(
            wallet_id=wallet_id, asset_id=asset_id,
            total_quantity=ZERO, total_cost_basis=ZERO, realized_pnl=ZERO,
        )
        db.add(holding)
        db.flush()
    return holding


def get_asset_totals_all_wallets(db: Session, asset_id: int) -> ACBState:
    """
    Suma el estado de un activo a través de TODAS las wallets (vista global de
    portafolio). El coste promedio resultante es el ponderado del conjunto.
    Útil para la Fase 3 (valor total, PnL total).
    """
    holdings = db.execute(
        select(Holding).where(Holding.asset_id == asset_id)
    ).scalars().all()
    state = ACBState()
    for h in holdings:
        state.total_quantity += D(h.total_quantity)
        state.total_cost_basis += D(h.total_cost_basis)
        state.realized_pnl += D(h.realized_pnl)
    return state
