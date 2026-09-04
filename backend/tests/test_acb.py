"""
Tests unitarios del motor ACB (tarea 1.10) — versión ACB por wallet.

Cubre: los 4 tipos de transacción, fees (USDT, en el activo, y override en USDT),
separación por wallet, validaciones (1.7) y precisión Decimal.
BD SQLite en memoria, aislada por test.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Asset, Holding, Wallet, TransactionType
from app.services.acb_engine import (
    InsufficientQuantityError,
    add_transaction,
    calculate_acb,
    get_asset_totals_all_wallets,
    resolve_fee_usdt,
)
from app.utils.decimal_utils import D


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def env(db):
    """Dos wallets (Binance, Ledger) y el activo BTC (8 decimales)."""
    binance = Wallet(name="Binance", type="EXCHANGE")
    ledger = Wallet(name="Ledger", type="COLD")
    btc = Asset(symbol="BTC", name="Bitcoin", decimals=8)
    db.add_all([binance, ledger, btc])
    db.commit()
    return binance, ledger, btc


def _tx(db, wallet, asset, ttype, qty, price, fee=0, fee_currency="USDT",
        fee_usdt=None, date=None):
    return add_transaction(
        db, wallet_id=wallet.id, asset_id=asset.id, tx_type=ttype,
        quantity=qty, price=price, fee=fee, fee_currency=fee_currency,
        fee_usdt=fee_usdt, date=date or "2026-01-01T00:00:00+00:00",
    )


# --- COMPRA -------------------------------------------------------------------
def test_buy_with_fee(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "0.5", "40000", fee="10")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.total_quantity == D("0.5")
    assert st.total_cost_basis == D("20010")   # 0.5*40000 + 10
    assert st.average_price == D("40020")


def test_two_buys_weighted_average(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "0.5", "40000", date="2026-01-01T00:00:00+00:00")
    _tx(db, binance, btc, TransactionType.BUY, "0.5", "60000", date="2026-01-02T00:00:00+00:00")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.total_quantity == D("1")
    assert st.total_cost_basis == D("50000")
    assert st.average_price == D("50000")


# --- DEPÓSITO -----------------------------------------------------------------
def test_deposit_like_buy(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.DEPOSIT, "1", "30000")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.total_quantity == D("1")
    assert st.total_cost_basis == D("30000")


# --- VENTA (PnL) --------------------------------------------------------------
def test_sell_realized_pnl(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "1", "40000", date="2026-01-01T00:00:00+00:00")
    _tx(db, binance, btc, TransactionType.SELL, "0.5", "50000", fee="5", date="2026-01-02T00:00:00+00:00")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.realized_pnl == D("4995")        # (50000-40000)*0.5 - 5
    assert st.total_quantity == D("0.5")
    assert st.total_cost_basis == D("20000")
    assert st.average_price == D("40000")      # el promedio no cambia al vender


def test_sell_entire_position_zeroes_out(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "0.3", "40000", date="2026-01-01T00:00:00+00:00")
    _tx(db, binance, btc, TransactionType.SELL, "0.3", "45000", date="2026-01-02T00:00:00+00:00")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.total_quantity == D("0")
    assert st.total_cost_basis == D("0")


# --- RETIRO (sin PnL) ---------------------------------------------------------
def test_withdrawal_no_pnl(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "1", "40000", date="2026-01-01T00:00:00+00:00")
    _tx(db, binance, btc, TransactionType.WITHDRAWAL, "0.4", "99999", date="2026-01-02T00:00:00+00:00")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.realized_pnl == D("0")
    assert st.total_quantity == D("0.6")
    assert st.total_cost_basis == D("24000")   # 0.6 * 40000


# --- SEPARACIÓN POR WALLET ----------------------------------------------------
def test_acb_is_separate_per_wallet(db, env):
    binance, ledger, btc = env
    # Mismo activo, distinto coste en cada wallet
    _tx(db, binance, btc, TransactionType.BUY, "1", "30000")
    _tx(db, ledger, btc, TransactionType.DEPOSIT, "1", "50000")

    st_bin = calculate_acb(db, binance.id, btc.id)
    st_led = calculate_acb(db, ledger.id, btc.id)
    assert st_bin.average_price == D("30000")
    assert st_led.average_price == D("50000")

    # Vista global (Fase 3): 2 BTC con coste 80000 -> promedio 40000
    total = get_asset_totals_all_wallets(db, btc.id)
    assert total.total_quantity == D("2")
    assert total.total_cost_basis == D("80000")
    assert total.average_price == D("40000")


def test_holdings_row_persisted(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "0.12345678", "42000.55")
    h = db.query(Holding).filter_by(wallet_id=binance.id, asset_id=btc.id).one()
    st = calculate_acb(db, binance.id, btc.id)
    assert h.total_quantity == st.total_quantity
    assert h.total_cost_basis == st.total_cost_basis


# --- VALIDACIÓN (1.7) — el límite es POR WALLET -------------------------------
def test_cannot_sell_more_than_owned_in_that_wallet(db, env):
    binance, ledger, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "0.5", "40000")
    _tx(db, ledger, btc, TransactionType.BUY, "5", "40000")   # otra wallet no cuenta
    with pytest.raises(InsufficientQuantityError):
        _tx(db, binance, btc, TransactionType.SELL, "1", "50000", date="2026-01-03T00:00:00+00:00")


# --- PRECISIÓN Decimal --------------------------------------------------------
def test_decimal_precision_8_decimals(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "0.1", "10000", date="2026-01-01T00:00:00+00:00")
    _tx(db, binance, btc, TransactionType.BUY, "0.2", "10000", date="2026-01-02T00:00:00+00:00")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.total_quantity == D("0.3")       # exacto, no 0.30000000000000004
    assert st.total_cost_basis == D("3000")


# --- FEES ---------------------------------------------------------------------
def test_fee_paid_in_asset(db, env):
    binance, _, btc = env
    # 1 BTC a 40000, fee 0.001 BTC => fee_usdt = 0.001*40000 = 40
    _tx(db, binance, btc, TransactionType.BUY, "1", "40000", fee="0.001", fee_currency="BTC")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.total_cost_basis == D("40040")


def test_fee_usdt_override_for_exotic_currency(db, env):
    binance, _, btc = env
    # Fee pagado en BNB; el usuario indica su valor exacto en USDT (3.20)
    _tx(db, binance, btc, TransactionType.BUY, "1", "40000",
        fee="0.01", fee_currency="BNB", fee_usdt="3.20")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.total_cost_basis == D("40003.20")


def test_exotic_fee_without_override_raises(db, env):
    binance, _, btc = env
    with pytest.raises(Exception):
        _tx(db, binance, btc, TransactionType.BUY, "1", "40000",
            fee="0.01", fee_currency="BNB")


def test_resolve_fee_unit():
    assert resolve_fee_usdt(D("5"), "USDT", "BTC", D("40000")) == D("5")
    assert resolve_fee_usdt(D("0.001"), "BTC", "BTC", D("40000")) == D("40")
    assert resolve_fee_usdt(D("0.01"), "BNB", "BTC", D("40000"), D("3.20")) == D("3.20")


# --- BACKDATING ---------------------------------------------------------------
def test_backdated_insert_recomputes_correctly(db, env):
    binance, _, btc = env
    _tx(db, binance, btc, TransactionType.BUY, "1", "50000", date="2026-01-10T00:00:00+00:00")
    _tx(db, binance, btc, TransactionType.BUY, "1", "30000", date="2026-01-05T00:00:00+00:00")
    st = calculate_acb(db, binance.id, btc.id)
    assert st.total_quantity == D("2")
    assert st.total_cost_basis == D("80000")
