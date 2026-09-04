"""
Tests de métricas (Fase 3, tareas 3.1–3.7) con precio inyectado (sin red).
Verifica scope por wallet y global, PnL, ROI, asignación y detalle.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Asset, Wallet, TransactionType
from app.services.acb_engine import add_transaction
from app.services import metrics
from app.utils.decimal_utils import D


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)
    s = Session()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def portfolio(db):
    """
    Binance: 1 BTC @30000 y 10 ETH @2000.
    Ledger : 1 BTC @50000.
    Precios fijos: BTC=60000, ETH=3000.
    """
    binance = Wallet(name="Binance", type="EXCHANGE")
    ledger = Wallet(name="Ledger", type="COLD")
    btc = Asset(symbol="BTC", name="Bitcoin", decimals=8, coingecko_id="bitcoin")
    eth = Asset(symbol="ETH", name="Ethereum", decimals=18, coingecko_id="ethereum")
    db.add_all([binance, ledger, btc, eth])
    db.commit()

    add_transaction(db, wallet_id=binance.id, asset_id=btc.id, tx_type=TransactionType.BUY,
                    quantity="1", price="30000", date="2026-01-01T00:00:00+00:00")
    add_transaction(db, wallet_id=binance.id, asset_id=eth.id, tx_type=TransactionType.BUY,
                    quantity="10", price="2000", date="2026-01-01T00:00:00+00:00")
    add_transaction(db, wallet_id=ledger.id, asset_id=btc.id, tx_type=TransactionType.DEPOSIT,
                    quantity="1", price="50000", date="2026-01-01T00:00:00+00:00")

    prices = {"bitcoin": D("60000"), "ethereum": D("3000")}
    provider = lambda asset: prices[asset.coingecko_id]
    return binance, ledger, btc, eth, provider


def test_summary_global(db, portfolio):
    binance, ledger, btc, eth, provider = portfolio
    s = metrics.get_portfolio_summary(db, wallet_id=None, price_provider=provider)
    # BTC global: 2 uds, valor 2*60000=120000 ; ETH: 10*3000=30000 ; total=150000
    assert s["total_value"] == "150000"
    # coste global: BTC 30000+50000=80000 ; ETH 20000 -> 100000
    assert s["total_cost_basis"] == "100000"
    # unrealized: (120000-80000)+(30000-20000)=50000
    assert s["total_unrealized_pnl"] == "50000"
    # asignación BTC = 80%, ETH = 20%
    alloc = {r["symbol"]: r["allocation_pct"] for r in s["assets"]}
    assert alloc["BTC"] == "80"
    assert alloc["ETH"] == "20"


def test_summary_per_wallet(db, portfolio):
    binance, ledger, btc, eth, provider = portfolio
    s = metrics.get_portfolio_summary(db, wallet_id=ledger.id, price_provider=provider)
    # Ledger solo tiene 1 BTC @50000 -> valor 60000
    assert s["scope"] == "wallet"
    assert s["total_value"] == "60000"
    assert s["total_cost_basis"] == "50000"
    assert s["total_unrealized_pnl"] == "10000"
    assert len(s["assets"]) == 1
    assert s["assets"][0]["symbol"] == "BTC"
    assert s["assets"][0]["allocation_pct"] == "100"


def test_roi_per_wallet_differs(db, portfolio):
    binance, ledger, btc, eth, provider = portfolio
    # BTC en Binance: avg 30000, precio 60000 -> ROI 100%
    d_bin = metrics.get_asset_detail(db, btc.id, wallet_id=binance.id, price_provider=provider)
    assert d_bin["roi_pct"] == "100"
    # BTC en Ledger: avg 50000, precio 60000 -> ROI 20%
    d_led = metrics.get_asset_detail(db, btc.id, wallet_id=ledger.id, price_provider=provider)
    assert d_led["roi_pct"] == "20"


def test_asset_detail_global(db, portfolio):
    binance, ledger, btc, eth, provider = portfolio
    d = metrics.get_asset_detail(db, btc.id, wallet_id=None, price_provider=provider)
    assert d["quantity"] == "2"
    assert d["avg_price"] == "40000"       # (30000+50000)/2
    assert d["price_now"] == "60000"
    assert d["value"] == "120000"
    assert d["unrealized_pnl"] == "40000"  # (60000-40000)*2
    assert d["roi_pct"] == "50"            # (60000-40000)/40000*100
    assert d["allocation_pct"] == "80"


def test_realized_pnl_scope(db, portfolio):
    binance, ledger, btc, eth, provider = portfolio
    # Vendemos 0.5 BTC en Binance a 60000 (avg 30000) -> PnL 15000
    add_transaction(db, wallet_id=binance.id, asset_id=btc.id, tx_type=TransactionType.SELL,
                    quantity="0.5", price="60000", date="2026-02-01T00:00:00+00:00")
    assert metrics.get_realized_pnl_total(db, wallet_id=binance.id) == D("15000")
    assert metrics.get_realized_pnl_total(db, wallet_id=ledger.id) == D("0")
    assert metrics.get_realized_pnl_total(db, wallet_id=None) == D("15000")


def test_price_unavailable_degrades_gracefully(db):
    """Un activo sin precio no rompe el resumen; cuenta como valor 0."""
    w = Wallet(name="Binance", type="EXCHANGE")
    a = Asset(symbol="XYZ", name="Unknown", decimals=8, coingecko_id=None)
    db.add_all([w, a]); db.commit()
    add_transaction(db, wallet_id=w.id, asset_id=a.id, tx_type=TransactionType.BUY,
                    quantity="100", price="1", date="2026-01-01T00:00:00+00:00")

    def failing_provider(asset):
        raise ValueError("sin precio")

    s = metrics.get_portfolio_summary(db, wallet_id=None, price_provider=failing_provider)
    assert s["total_value"] == "0"
    assert s["assets"][0]["price_available"] is False
