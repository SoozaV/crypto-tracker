"""
Métricas del portafolio (Fase 3, tareas 3.1–3.7).

Todo con scope seleccionable:
  * wallet_id = None  -> GLOBAL (suma de todas las wallets).
  * wallet_id = <id>  -> solo esa wallet.

El precio en vivo y los datos de mercado se inyectan como funciones
(`price_provider`, `market_provider`) para poder testear sin red y para no
acoplar las métricas a CoinGecko. Los proveedores por defecto usan la Fase 2.

Todo en Decimal (USDT). Al serializar en la API se convierte a string para no
perder precisión al viajar por JSON.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Callable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Asset, Holding
from ..utils.decimal_utils import D, ZERO
from .acb_engine import ACBState, get_asset_totals_all_wallets

PriceProvider = Callable[[Asset], Decimal]
MarketProvider = Callable[[Asset], dict]


# --- Proveedores por defecto (Fase 2) ----------------------------------------
def default_price_provider(asset: Asset) -> Decimal:
    from .coingecko_client import get_live_price
    if not asset.coingecko_id:
        raise ValueError(
            f"El activo {asset.symbol} no tiene coingecko_id; no se puede "
            f"obtener el precio en vivo."
        )
    return get_live_price(asset.coingecko_id)


def default_market_provider(asset: Asset) -> dict:
    from .coingecko_client import get_market_data
    if not asset.coingecko_id:
        raise ValueError(f"El activo {asset.symbol} no tiene coingecko_id.")
    return get_market_data(asset.coingecko_id)


def default_prefetch_markets(assets: "list[Asset]") -> None:
    """Precarga en UNA sola llamada los datos de mercado de todos los activos del
    scope (los que no estén ya cacheados y frescos). Así el resumen no hace una
    petición por activo: dentro del TTL no toca la red, y al añadir uno nuevo solo
    pide ese. Best-effort: si falla, cada activo caerá a su fallback individual."""
    from .coingecko_client import prefetch_markets
    ids = [a.coingecko_id for a in assets if a.coingecko_id]
    if ids:
        try:
            prefetch_markets(ids)
        except Exception:  # noqa: BLE001
            pass


# --- Estado de un activo dentro de un scope ----------------------------------
def get_asset_state(db: Session, asset_id: int, wallet_id: Optional[int] = None) -> ACBState:
    """Estado ACB del activo en el scope (una wallet o global)."""
    if wallet_id is None:
        return get_asset_totals_all_wallets(db, asset_id)
    holding = db.execute(
        select(Holding).where(
            Holding.wallet_id == wallet_id, Holding.asset_id == asset_id
        )
    ).scalar_one_or_none()
    if holding is None:
        return ACBState()
    return ACBState(
        total_quantity=D(holding.total_quantity),
        total_cost_basis=D(holding.total_cost_basis),
        realized_pnl=D(holding.realized_pnl),
    )


def _assets_in_scope(db: Session, wallet_id: Optional[int]) -> list[Asset]:
    """Activos con algún holding en el scope (incluye posiciones ya cerradas)."""
    stmt = select(Asset).join(Holding, Holding.asset_id == Asset.id)
    if wallet_id is not None:
        stmt = stmt.where(Holding.wallet_id == wallet_id)
    return list(db.execute(stmt.distinct()).scalars().all())


# --- Métricas atómicas (3.2, 3.4) --------------------------------------------
def get_unrealized_pnl(state: ACBState, price_now: Decimal) -> Decimal:
    """(precio_actual - promedio) * cantidad. 0 si no hay posición."""
    if state.total_quantity == ZERO:
        return ZERO
    return (D(price_now) - state.average_price) * state.total_quantity


def get_roi(state: ACBState, price_now: Decimal) -> Optional[Decimal]:
    """(precio_actual - promedio) / promedio * 100. None si no hay coste."""
    avg = state.average_price
    if avg == ZERO:
        return None
    return (D(price_now) - avg) / avg * D(100)


def get_asset_value(state: ACBState, price_now: Decimal) -> Decimal:
    """Valor de mercado de la posición = cantidad * precio_actual."""
    return state.total_quantity * D(price_now)


# --- Realized PnL total (3.3) ------------------------------------------------
def get_realized_pnl_total(db: Session, wallet_id: Optional[int] = None) -> Decimal:
    """Suma del PnL realizado (de ventas) en el scope."""
    stmt = select(Holding)
    if wallet_id is not None:
        stmt = stmt.where(Holding.wallet_id == wallet_id)
    total = ZERO
    for h in db.execute(stmt).scalars().all():
        total += D(h.realized_pnl)
    return total


# --- Cambios de precio 24h/7d/30d (3.6) --------------------------------------
def get_price_changes(asset: Asset, market_provider: Optional[MarketProvider] = None) -> dict:
    """Devuelve los cambios porcentuales 24h/7d/30d del activo."""
    market_provider = market_provider or default_market_provider
    data = market_provider(asset)
    return {
        "symbol": asset.symbol,
        "price": _s(data.get("price")),
        "change_24h_pct": _s(data.get("change_24h_pct")),
        "change_7d_pct": _s(data.get("change_7d_pct")),
        "change_30d_pct": _s(data.get("change_30d_pct")),
    }


# --- Resumen del portafolio (3.1) + asignación (3.5) -------------------------
def get_portfolio_summary(
    db: Session,
    wallet_id: Optional[int] = None,
    price_provider: Optional[PriceProvider] = None,
    market_provider: Optional[MarketProvider] = None,
    prefetch: Optional[Callable[["list[Asset]"], None]] = None,
) -> dict:
    """
    Valor total del portafolio en el scope, con el desglose por activo y el % de
    asignación de cada uno (3.1 + 3.5). Roll-up de PnL no realizado, realizado y ROI.

    Si un activo no tiene precio disponible (sin coingecko_id o error de API), se
    marca `price_available: false`, su valor cuenta como 0 y no rompe el resumen.

    `prefetch` (opcional) precarga los datos de mercado de TODOS los activos en una
    sola petición antes del bucle, dejándolos en caché; así el bucle no hace una
    llamada por activo. Dentro del TTL de la caché no se toca la red.
    """
    price_provider = price_provider or default_price_provider
    assets = _assets_in_scope(db, wallet_id)

    # Precarga en lote (1 sola petición) para no pedir precio por-activo.
    if prefetch is not None:
        prefetch(assets)

    rows = []
    total_value = ZERO
    total_cost = ZERO
    total_unrealized = ZERO

    for asset in assets:
        state = get_asset_state(db, asset.id, wallet_id)
        price_available = True
        price_now: Optional[Decimal] = None
        changes = None

        if market_provider is not None:
            # UNA sola llamada por activo: precio + cambios juntos (menos presión
            # sobre el rate limit de CoinGecko). Si el de mercado falla, se cae al
            # proveedor de precio simple.
            try:
                md = market_provider(asset)
                p = md.get("price")
                price_now = D(p) if p is not None else None
                if price_now is None:
                    price_available = False
                changes = {
                    "change_24h_pct": _s(md.get("change_24h_pct")),
                    "change_7d_pct": _s(md.get("change_7d_pct")),
                    "change_30d_pct": _s(md.get("change_30d_pct")),
                }
            except Exception:  # noqa: BLE001
                try:
                    price_now = D(price_provider(asset))
                except Exception:  # noqa: BLE001
                    price_available = False
        else:
            try:
                price_now = D(price_provider(asset))
            except Exception:  # noqa: BLE001
                price_available = False

        if price_available and price_now is not None and state.total_quantity != ZERO:
            value = get_asset_value(state, price_now)
            unrealized = get_unrealized_pnl(state, price_now)
            roi = get_roi(state, price_now)
        else:
            value = ZERO
            unrealized = ZERO
            roi = None

        total_value += value
        total_cost += state.total_cost_basis
        total_unrealized += unrealized

        rows.append({
            "asset_id": asset.id,
            "symbol": asset.symbol,
            "name": asset.name,
            "decimals": asset.decimals,
            "quantity": _s(state.total_quantity),
            "avg_price": _s(state.average_price),
            "price_now": _s(price_now),
            "price_available": price_available,
            "value": _s(value),
            "cost_basis": _s(state.total_cost_basis),
            "unrealized_pnl": _s(unrealized),
            "realized_pnl": _s(state.realized_pnl),
            "roi_pct": _s(roi),
            "changes": changes,
            "_value_dec": value,  # interno para calcular allocation
        })

    # Asignación (3.5): value / total_value * 100
    for r in rows:
        alloc = (r["_value_dec"] / total_value * D(100)) if total_value != ZERO else ZERO
        r["allocation_pct"] = _s(alloc)
        del r["_value_dec"]

    total_realized = get_realized_pnl_total(db, wallet_id)
    total_roi = ((total_value - total_cost) / total_cost * D(100)) if total_cost != ZERO else None

    rows.sort(key=lambda r: D(r["value"]), reverse=True)

    return {
        "scope": "wallet" if wallet_id is not None else "global",
        "wallet_id": wallet_id,
        "total_value": _s(total_value),
        "total_cost_basis": _s(total_cost),
        "total_unrealized_pnl": _s(total_unrealized),
        "total_realized_pnl": _s(total_realized),
        "total_roi_pct": _s(total_roi),
        "assets": rows,
    }


# --- Detalle completo de un activo (3.7) -------------------------------------
def get_asset_detail(
    db: Session,
    asset_id: int,
    wallet_id: Optional[int] = None,
    price_provider: Optional[PriceProvider] = None,
    market_provider: Optional[MarketProvider] = None,
) -> dict:
    """
    Junta todo para un activo en el scope: cantidad, promedio, precio actual,
    PnL no realizado, PnL realizado, ROI, % de asignación y cambios 24h/7d/30d.
    """
    price_provider = price_provider or default_price_provider
    market_provider = market_provider or default_market_provider

    asset = db.get(Asset, asset_id)
    if asset is None:
        raise ValueError(f"No existe el activo con id={asset_id}.")

    state = get_asset_state(db, asset_id, wallet_id)

    price_available = True
    price_now: Optional[Decimal] = None
    try:
        price_now = D(price_provider(asset))
    except Exception:  # noqa: BLE001
        price_available = False

    value = get_asset_value(state, price_now) if price_available else ZERO
    unrealized = get_unrealized_pnl(state, price_now) if price_available else ZERO
    roi = get_roi(state, price_now) if price_available else None

    # Asignación respecto al total del scope.
    summary = get_portfolio_summary(db, wallet_id, price_provider)
    total_value = D(summary["total_value"])
    allocation = (value / total_value * D(100)) if total_value != ZERO else ZERO

    # Cambios de precio (tolerante a fallos de la API).
    try:
        changes = get_price_changes(asset, market_provider)
    except Exception:  # noqa: BLE001
        changes = {"symbol": asset.symbol, "price": None,
                   "change_24h_pct": None, "change_7d_pct": None, "change_30d_pct": None}

    return {
        "scope": "wallet" if wallet_id is not None else "global",
        "wallet_id": wallet_id,
        "asset_id": asset.id,
        "symbol": asset.symbol,
        "name": asset.name,
        "decimals": asset.decimals,
        "quantity": _s(state.total_quantity),
        "avg_price": _s(state.average_price),
        "price_now": _s(price_now),
        "price_available": price_available,
        "value": _s(value),
        "cost_basis": _s(state.total_cost_basis),
        "unrealized_pnl": _s(unrealized),
        "realized_pnl": _s(state.realized_pnl),
        "roi_pct": _s(roi),
        "allocation_pct": _s(allocation),
        "changes": changes,
    }


# --- Serialización Decimal -> str (preserva precisión en JSON) ---------------
def _s(value) -> Optional[str]:
    if value is None:
        return None
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    # normalize() quita ceros sobrantes (50.0 -> 50); format 'f' evita que
    # normalize devuelva notación científica (5E+1) en enteros grandes.
    return format(d.normalize(), "f")
