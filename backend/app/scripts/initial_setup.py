"""
Configuración Inicial / Onboarding (tarea 1.11).

Permite cargar un balance inicial de un activo indicando la cantidad y el COSTE
TOTAL pagado (en USDT). Genera un DEPÓSITO inicial con fecha UTC, del que se
deriva el precio unitario = coste_total / cantidad.

Uso (modo interactivo):
    python -m app.scripts.initial_setup

Uso (modo función, p. ej. desde un endpoint o test):
    from app.scripts.initial_setup import seed_initial_balance
    seed_initial_balance(db, wallet_name="Binance", symbol="BTC",
                         quantity="0.5", total_cost="20000")
"""
from __future__ import annotations

from decimal import Decimal

from ..database import SessionLocal
from ..models import TransactionType
from ..services.acb_engine import (
    add_transaction,
    get_or_create_asset,
    get_or_create_wallet,
)
from ..utils.datetime_utils import utcnow_naive
from ..utils.decimal_utils import D, ZERO


def seed_initial_balance(
    db,
    *,
    wallet_name: str,
    symbol: str,
    quantity,
    total_cost,
    decimals: int = 8,
    wallet_type: str = "EXCHANGE",
    name=None,
    coingecko_id=None,
    binance_symbol=None,
    date=None,
):
    """Crea (si hace falta) wallet y activo, y registra el DEPÓSITO inicial."""
    quantity = D(quantity)
    total_cost = D(total_cost)
    if quantity <= ZERO:
        raise ValueError("La cantidad inicial debe ser mayor que 0.")
    if total_cost < ZERO:
        raise ValueError("El coste total no puede ser negativo.")

    wallet = get_or_create_wallet(db, wallet_name, wallet_type)
    asset = get_or_create_asset(
        db, symbol, name=name, decimals=decimals,
        coingecko_id=coingecko_id, binance_symbol=binance_symbol,
    )

    unit_price = total_cost / quantity  # precio de referencia del depósito

    tx = add_transaction(
        db,
        wallet_id=wallet.id,
        asset_id=asset.id,
        tx_type=TransactionType.DEPOSIT,
        quantity=quantity,
        price=unit_price,
        fee=0,
        fee_currency="USDT",
        date=date or utcnow_naive(),
    )
    return tx


def _prompt() -> None:
    print("=== Configuración Inicial de Portafolio ===")
    wallet_name = input("Wallet (ej. Binance): ").strip()
    wallet_type = (input("Tipo [EXCHANGE/COLD/HOT/OTHER] (EXCHANGE): ").strip()
                   or "EXCHANGE")
    symbol = input("Símbolo del activo (ej. BTC): ").strip()
    decimals = int(input("Decimales del activo (8): ").strip() or "8")
    quantity = input("Cantidad que posees (ej. 0.5): ").strip()
    total_cost = input("Coste total pagado en USDT (ej. 20000): ").strip()

    db = SessionLocal()
    try:
        tx = seed_initial_balance(
            db,
            wallet_name=wallet_name,
            symbol=symbol,
            quantity=quantity,
            total_cost=total_cost,
            decimals=decimals,
            wallet_type=wallet_type,
        )
        print(f"\n✅ Depósito inicial creado (tx id={tx.id}).")
        print(f"   {quantity} {symbol.upper()} a un precio medio de "
              f"{Decimal(total_cost) / Decimal(quantity)} USDT.")
    finally:
        db.close()


if __name__ == "__main__":
    _prompt()
