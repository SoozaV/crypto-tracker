"""
Configuración central de la aplicación.

Se lee desde variables de entorno (archivo .env en la raíz de /backend).
No se guardan secretos en el código: todo va en .env (tarea 0.8 / Fase 6.1).
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Carga el .env que está en la raíz de /backend
BASE_DIR = Path(__file__).resolve().parent.parent  # .../backend
load_dotenv(BASE_DIR / ".env")

# --- Base de datos -----------------------------------------------------------
# Por defecto un SQLite local en /backend/portfolio.db
DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(BASE_DIR / 'portfolio.db').as_posix()}",
)

# --- Moneda base -------------------------------------------------------------
# Toda la contabilidad (precios, fees, coste, PnL) está expresada en esta moneda.
# Fija en USDT según la visión del proyecto.
BASE_CURRENCY: str = os.getenv("BASE_CURRENCY", "USDT")

# --- CoinGecko (se usa a partir de la Fase 2, aquí solo se deja preparado) ----
COINGECKO_API_KEY: str = os.getenv("COINGECKO_API_KEY", "")
COINGECKO_BASE_URL: str = os.getenv(
    "COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3"
)

# --- Seguridad (Fase 6) ------------------------------------------------------
# Orígenes permitidos por CORS (coma-separados). Por defecto, el dev server de Vite.
CORS_ORIGINS: list[str] = [
    o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if o.strip()
]

# Límite de peticiones por defecto para el rate limiting (formato slowapi).
RATE_LIMIT: str = os.getenv("RATE_LIMIT", "100/minute")
