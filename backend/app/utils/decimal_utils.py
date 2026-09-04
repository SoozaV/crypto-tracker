"""
Utilidades de Decimal (tarea 1.0).

Por qué Decimal y no float
--------------------------
Los `float` de Python son binarios (IEEE-754) y no pueden representar de forma
exacta la mayoría de los decimales base-10. Ejemplo clásico:

    >>> 0.1 + 0.2
    0.30000000000000004

En una app de finanzas con criptos de hasta 18 decimales, ese ruido se acumula
y falsea el coste promedio (ACB), el PnL y el ROI. `Decimal` es aritmética
base-10 exacta, así que aquí está PROHIBIDO usar float en cualquier cálculo
monetario o de cantidades. Toda entrada se normaliza con `D()`.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, getcontext
from typing import Union

# Precisión global amplia: suficiente para cadenas de operaciones sobre
# cantidades de 18 decimales sin perder exactitud intermedia.
getcontext().prec = 50

Number = Union[Decimal, int, str, float]

# Cero reutilizable.
ZERO = Decimal("0")


def D(value: Number) -> Decimal:
    """
    Convierte cualquier valor a Decimal de forma segura.

    Nota: si llega un float, se pasa por `str()` primero para no arrastrar el
    error binario (Decimal(0.1) != Decimal('0.1')). Aun así, evita mandar floats.
    """
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    return Decimal(value)


def quantize_money(value: Number, places: int = 2) -> Decimal:
    """Redondea un importe en moneda base (USDT) a N decimales (por defecto 2)."""
    q = Decimal(1).scaleb(-places)  # 10^-places
    return D(value).quantize(q, rounding=ROUND_HALF_UP)


def quantize_crypto(value: Number, decimals: int = 8) -> Decimal:
    """Redondea una cantidad de cripto a los decimales del activo (por defecto 8)."""
    q = Decimal(1).scaleb(-decimals)
    return D(value).quantize(q, rounding=ROUND_HALF_UP)
