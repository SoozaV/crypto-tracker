"""
Esquema de base de datos (tarea 0.5, actualizado).

Cambios respecto a la primera versión (según decisiones acordadas):
  * ACB SEPARADO POR WALLET: el estado (cantidad, coste, PnL) ya NO vive en
    `assets`, sino en `holdings`, una fila por par (wallet, activo). Así tu BTC
    en Binance lleva un coste promedio distinto al de tu BTC en Ledger.
  * `assets` pasa a ser un CATÁLOGO: symbol, name, decimals + ids para precios.
  * `transactions.fee_usdt`: se guarda el fee YA convertido a USDT (autoritativo),
    para no depender de precios al recalcular y no perder precisión.

Tablas:
  - wallets        : carteras/exchanges (Binance, Ledger, etc.)
  - assets         : catálogo de criptos (symbol, name, decimals, ids de API)
  - holdings       : estado ACB por (wallet, activo)
  - transactions   : cada compra/venta/depósito/retiro (con wallet)
  - price_history  : velas OHLCV diarias (Fase 2)

Todos los importes/cantidades usan DecimalText -> precisión exacta.
Todas las fechas son UTC (ver utils/datetime_utils.py, tarea 1.8).
"""
from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .db_types import DecimalText


class TransactionType(str, enum.Enum):
    BUY = "BUY"                # Compra con USDT -> suma cantidad y coste
    SELL = "SELL"             # Venta a USDT     -> resta y realiza PnL
    DEPOSIT = "DEPOSIT"       # Entrada de cripto con coste conocido (= BUY)
    WITHDRAWAL = "WITHDRAWAL" # Salida de cripto (= SELL pero SIN PnL)


class WalletType(str, enum.Enum):
    EXCHANGE = "EXCHANGE"   # Binance, Kraken, ...
    COLD = "COLD"           # Ledger, Trezor, hardware wallet
    HOT = "HOT"             # Metamask, wallet de software
    OTHER = "OTHER"


class Wallet(Base):
    __tablename__ = "wallets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    type: Mapped[str] = mapped_column(
        String, nullable=False, default=WalletType.EXCHANGE.value
    )

    holdings: Mapped[list["Holding"]] = relationship(back_populates="wallet")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="wallet")


class Asset(Base):
    """Catálogo de criptomonedas. NO guarda cantidades: eso vive en `holdings`."""
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)   # ej. "Bitcoin"
    decimals: Mapped[int] = mapped_column(Integer, nullable=False, default=8)

    # Identificadores para las APIs de precios (Fase 2). Se pinean por activo
    # para evitar colisiones de ticker (varios coins comparten símbolo).
    coingecko_id: Mapped[str | None] = mapped_column(String, nullable=True)   # ej. "bitcoin"
    binance_symbol: Mapped[str | None] = mapped_column(String, nullable=True) # ej. "BTCUSDT"

    holdings: Mapped[list["Holding"]] = relationship(back_populates="asset")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="asset")
    prices: Mapped[list["PriceHistory"]] = relationship(back_populates="asset")


class Holding(Base):
    """Estado agregado del ACB para un par (wallet, activo)."""
    __tablename__ = "holdings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wallet_id: Mapped[int] = mapped_column(
        ForeignKey("wallets.id", ondelete="CASCADE"), nullable=False
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )

    total_quantity: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default="0")
    total_cost_basis: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default="0")
    realized_pnl: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default="0")

    wallet: Mapped["Wallet"] = relationship(back_populates="holdings")
    asset: Mapped["Asset"] = relationship(back_populates="holdings")

    __table_args__ = (
        UniqueConstraint("wallet_id", "asset_id", name="uq_holding_wallet_asset"),
        Index("ix_holdings_wallet_asset", "wallet_id", "asset_id"),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wallet_id: Mapped[int] = mapped_column(
        ForeignKey("wallets.id", ondelete="RESTRICT"), nullable=False
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False
    )
    type: Mapped[str] = mapped_column(String, nullable=False)

    quantity: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    # Precio en USDT por 1 unidad del activo. En DEPOSIT/WITHDRAWAL es el coste
    # unitario de referencia (en DEPOSIT es obligatorio).
    price: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default="0")

    # Fee original tal como lo cobró el exchange (para el histórico).
    fee: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default="0")
    fee_currency: Mapped[str] = mapped_column(String, nullable=False, default="USDT")
    # Fee YA convertido a USDT: es el valor autoritativo que usa el ACB.
    fee_usdt: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default="0")

    # SIEMPRE en UTC. Naive-UTC por convención (ver datetime_utils.to_naive_utc).
    date_utc: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    wallet: Mapped["Wallet"] = relationship(back_populates="transactions")
    asset: Mapped["Asset"] = relationship(back_populates="transactions")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_tx_quantity_positive"),
        CheckConstraint("fee >= 0", name="ck_tx_fee_non_negative"),
        CheckConstraint("fee_usdt >= 0", name="ck_tx_fee_usdt_non_negative"),
        # Índices para acelerar el recálculo del ACB por wallet (tarea 1.1).
        Index("ix_transactions_asset_id", "asset_id"),
        Index("ix_transactions_date_utc", "date_utc"),
        Index("ix_transactions_wallet_asset_date", "wallet_id", "asset_id", "date_utc"),
    )


class PriceHistory(Base):
    __tablename__ = "price_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    timestamp_utc: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    open: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    high: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    low: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    close: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)

    asset: Mapped["Asset"] = relationship(back_populates="prices")

    __table_args__ = (
        UniqueConstraint("asset_id", "timestamp_utc", name="uq_price_asset_ts"),
        Index("ix_price_history_asset_ts", "asset_id", "timestamp_utc"),
    )
