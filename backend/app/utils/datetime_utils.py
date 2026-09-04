"""
Utilidades de fecha/hora en UTC (tarea 1.8).

Por qué UTC siempre
-------------------
Si se mezclan zonas horarias, el orden de las transacciones (del que depende el
ACB) se vuelve ambiguo y el PnL puede quedar mal. Regla del proyecto:

  * El frontend envía la fecha en formato ISO 8601 CON zona horaria
    (ej. "2026-01-15T18:30:00-06:00") o como timestamp Unix (segundos).
  * El backend la convierte SIEMPRE a UTC antes de tocar la BD.
  * En la BD se guarda como datetime "naive" que representa UTC (SQLite no
    almacena zona horaria). Como todo es UTC, el orden por `date_utc` es correcto.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Union

DateInput = Union[datetime, str, int, float]


def ensure_utc(value: DateInput) -> datetime:
    """
    Normaliza cualquier entrada de fecha a un datetime *aware* en UTC.

    Acepta:
      - datetime aware  -> se convierte a UTC.
      - datetime naive  -> se asume que ya es UTC (se le adjunta tz UTC).
      - str ISO 8601    -> "2026-01-15T18:30:00-06:00", "...Z", o sin tz (=UTC).
      - int/float       -> timestamp Unix en segundos.
    """
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)

    if isinstance(value, str):
        s = value.strip()
        # Python <3.11 no parsea el sufijo 'Z'; lo traducimos a +00:00.
        if s.endswith("Z") or s.endswith("z"):
            s = s[:-1] + "+00:00"
        try:
            value = datetime.fromisoformat(s)
        except ValueError as exc:
            raise ValueError(
                f"Fecha inválida: {value!r}. Usa ISO 8601 con zona horaria "
                f"(ej. 2026-01-15T18:30:00-06:00) o un timestamp Unix."
            ) from exc

    if not isinstance(value, datetime):
        raise TypeError(f"Tipo de fecha no soportado: {type(value)!r}")

    if value.tzinfo is None:
        # Naive -> se asume UTC.
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def to_naive_utc(value: DateInput) -> datetime:
    """
    Igual que ensure_utc pero devuelve el datetime SIN tzinfo (naive-UTC),
    que es lo que se persiste en la columna `date_utc`.
    """
    return ensure_utc(value).replace(tzinfo=None)


def from_db_utc(value: datetime) -> datetime:
    """Reconstruye un datetime aware-UTC a partir del naive-UTC guardado en BD."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def utcnow_naive() -> datetime:
    """`datetime.utcnow()` moderno: ahora en UTC, naive, para guardar en BD."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
