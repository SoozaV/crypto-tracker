"""
Tipos de columna personalizados.

⚠️  IMPORTANTE (precisión):
SQLite NO tiene un tipo NUMERIC/DECIMAL real. Si se usa el tipo `Numeric`
estándar de SQLAlchemy sobre SQLite, los valores se guardan como FLOAT y se
PIERDE precisión (justo lo que este proyecto quiere evitar en BTC/ETH).

Solución: guardamos los Decimal como TEXTO (str exacto) y los devolvemos como
`Decimal` al leer. Así 0.1 + 0.2 sigue siendo exactamente 0.3, sin ruido de
punto flotante, tanto en memoria como en disco.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator


class DecimalText(TypeDecorator):
    """Almacena un Decimal como texto exacto en SQLite y lo recupera como Decimal."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        # Python -> BD
        if value is None:
            return None
        if not isinstance(value, Decimal):
            value = Decimal(str(value))
        # 'f' evita notación científica (ej. 1E-8), que rompería el orden textual
        return format(value, "f")

    def process_result_value(self, value, dialect):
        # BD -> Python
        if value is None:
            return None
        return Decimal(value)
