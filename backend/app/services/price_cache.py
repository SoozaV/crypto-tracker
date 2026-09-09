"""
Caché en memoria con TTL (tarea 2.3).

Evita machacar la API de CoinGecko (y su rate limit) repitiendo la misma consulta
en una ventana corta. Por defecto TTL=60s para el precio en vivo.

El reloj es inyectable (`clock`) para poder testear la expiración sin `sleep`.
Es thread-safe (un lock). Vive en memoria de proceso: es adecuada con UN solo
worker (como arranca `run.py`). Si algún día se despliega con `--workers N>1`,
cada worker tendría su propia caché y las llamadas a la API se multiplicarían;
en ese caso convendría una caché compartida (p. ej. Redis).
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable, Optional


class TTLCache:
    def __init__(self, ttl_seconds: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl_seconds
        self._clock = clock
        self._store: dict[str, tuple[float, Any]] = {}  # key -> (expira_en, valor)
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        now = self._clock()
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            expires_at, value = item
            if now >= expires_at:
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any, ttl_seconds: Optional[float] = None) -> None:
        ttl = self._ttl if ttl_seconds is None else ttl_seconds
        with self._lock:
            self._store[key] = (self._clock() + ttl, value)

    def get_or_set(self, key: str, producer: Callable[[], Any],
                   ttl_seconds: Optional[float] = None) -> Any:
        """Devuelve el valor cacheado o lo produce, lo guarda y lo devuelve."""
        cached = self.get(key)
        if cached is not None:
            return cached
        value = producer()
        self.set(key, value, ttl_seconds)
        return value

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


# Caché compartida para precios en vivo (60s).
import os as _os

# TTL por defecto configurable (PRICE_CACHE_TTL, en segundos). Se sube a 300s
# para que el resumen no llame a CoinGecko en cada refresco (evita el rate limit
# del plan gratuito, principal causa de que el backend se "cuelgue" al reintentar).
price_cache = TTLCache(ttl_seconds=float(_os.getenv("PRICE_CACHE_TTL", "300")))
