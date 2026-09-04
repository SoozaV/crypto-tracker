# Crypto Portfolio Tracker (local & privado)

App local para seguimiento de inversiones en cripto **spot** con cálculo de
coste promedio ponderado (ACB) **por wallet**, fees, PnL/ROI y análisis técnico
en frontend.

## Stack (tarea 0.1)

| Capa | Tecnología |
| :--- | :--- |
| Backend | Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic |
| Base de datos | SQLite (local, sin nube ni auth) |
| Frontend | React · Vite · TypeScript |
| Precisión | `Decimal` (backend) · `decimal.js` (frontend) |
| Precios | CoinGecko (precio/mercado) · Binance (velas OHLCV) |

## Estado: Fases 0 a 4 y 6 completas (backend terminado)

- ✅ **Fase 0** — Cimientos: esquema, migración con índices, helpers de precisión.
- ✅ **Fase 1** — Motor ACB **por wallet**: COMPRA/VENTA/DEPÓSITO/RETIRO con fees,
  PnL realizado, validaciones, UTC y onboarding.
- ✅ **Fase 2** — Precios: CoinGecko (precio en vivo + market data 24h/7d/30d),
  caché TTL 60s, Binance OHLCV, `price_history` idempotente, reintentos con backoff.
- ✅ **Fase 3** — Métricas + API FastAPI: resumen del portafolio, PnL no realizado,
  PnL realizado, ROI, % de asignación y cambios 24h/7d/30d. Todo con **scope
  seleccionable** (global o por wallet vía `?wallet_id=`).
- ✅ **Fase 4** — El backend solo sirve **OHLCV crudo** (`/api/asset/{id}/ohlcv`);
  el cálculo de indicadores es del frontend. Cron diario (APScheduler, 00:00 UTC)
  que actualiza el histórico. `pandas_ta` eliminado del proyecto (sin rastro).
- ✅ **Fase 6** — Seguridad: claves solo en `.env`, **CORS restringido** al origen
  del frontend (configurable), y **rate limiting** con `slowapi` (100 req/min).

Pendiente: **Fase 5** (frontend) y **Fase 7** (indicadores en TypeScript).

Tests: **36 en verde** (`pytest`) + 10 del helper de frontend.

## Estructura

```
crypto-portfolio/
├── backend/
│   ├── app/
│   │   ├── config.py                     # lee .env (0.8)
│   │   ├── database.py                   # engine + sesión
│   │   ├── db_types.py                   # DecimalText: precisión Decimal en SQLite
│   │   ├── models.py                     # wallets/assets/holdings/transactions/price_history
│   │   ├── utils/
│   │   │   ├── decimal_utils.py          # helper Decimal (1.0, 1.12)
│   │   │   └── datetime_utils.py         # UTC (1.8, 1.12)
│   │   ├── services/
│   │   │   ├── acb_engine.py             # motor ACB por wallet (1.2–1.9)
│   │   │   ├── price_cache.py            # caché TTL (2.3)
│   │   │   ├── coingecko_client.py       # precio en vivo + market data (2.1, 2.2)
│   │   │   ├── binance_client.py         # velas OHLCV (2.4)
│   │   │   └── price_history_service.py  # poblar price_history (2.5)
│   │   └── scripts/initial_setup.py      # onboarding (1.11)
│   ├── alembic/                          # migraciones (0.7, 1.1)
│   ├── tests/                            # test_acb.py (1.10) + test_market_data.py (Fase 2)
│   ├── requirements.txt                  # 0.3
│   └── .env.example
└── frontend/
    ├── src/utils/decimalHelper.ts        # 0.6
    ├── src/utils/decimalHelper.test.ts
    └── package.json                      # dependencias de la tarea 0.4
```

## Puesta en marcha (backend)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # y edita tus valores (CoinGecko key)
alembic upgrade head            # crea portfolio.db con tablas e índices
pytest -q                       # 24 tests deben pasar
python -m app.scripts.initial_setup   # (opcional) cargar balance inicial
```

## Puesta en marcha (frontend)

```bash
npm create vite@latest frontend -- --template react-ts
# copia src/utils/decimalHelper.ts y .test.ts a frontend/src/utils
cd frontend
npm install decimal.js lightweight-charts recharts axios technicalindicators
npm install -D tsx
npm run test:decimal            # 10 tests deben pasar
```

## API (Fase 3)

Levanta el servidor y abre la documentación interactiva en `/docs`:

```bash
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload      # http://127.0.0.1:8000/docs
```

Todos los endpoints de métricas aceptan `?wallet_id=` (ausente = global):

| Método | Ruta | Tarea |
| :--- | :--- | :--- |
| GET | `/api/portfolio/summary` | 3.1 + 3.5 (valor total + asignación) |
| GET | `/api/portfolio/realized-pnl` | 3.3 |
| GET | `/api/asset/{id}` | 3.7 (detalle completo) |
| GET | `/api/asset/{id}/changes` | 3.6 (24h/7d/30d) |
| GET | `/api/asset/{id}/ohlcv?days=30` | 4.1 (velas crudas) |
| POST | `/api/admin/refresh-prices` | fuerza la actualización del histórico |
| GET | `/api/wallets` · `/api/assets` | selector / catálogo |
| POST | `/api/setup` · `/api/transactions` | alimentar datos |

Los importes viajan como **string** (para no perder precisión; el frontend los
lee con `decimal.js`). Los errores de negocio del ACB devuelven **HTTP 400**.

Al arrancar el servidor se activa un **cron diario a las 00:00 UTC** (APScheduler)
que refresca `price_history`. Para desactivarlo (p. ej. en tests) usa
`ENABLE_SCHEDULER=0`. El backend **no calcula indicadores**: solo sirve OHLCV;
RSI/SMA/etc. se calculan en el frontend (Fase 7).

**Seguridad (Fase 6):** las claves viven solo en `.env`; CORS solo admite los
orígenes de `CORS_ORIGINS`; y hay rate limiting global (`RATE_LIMIT`, por defecto
`100/minute`) que responde **HTTP 429** al superarse.

## Notas de contabilidad

- Moneda base fija: **USDT**. Precio y fees en USDT.
- **ACB por wallet**: el coste promedio se lleva por par (wallet, activo). Tu BTC
  en Binance y tu BTC en Ledger tienen promedios independientes. La vista global
  del portafolio se obtiene sumando holdings (`get_asset_totals_all_wallets`).
- **Fees**: el ACB usa siempre `fee_usdt` (guardado en cada transacción). Se
  resuelve al insertar: USDT tal cual; en la propia cripto = fee×precio; en otra
  moneda (ej. BNB) el usuario pasa `fee_usdt` con el valor exacto que le cobraron
  (cero conversión, sin pérdida de precisión).
- Todas las fechas se guardan en **UTC** (ISO 8601 con zona horaria o Unix ts).

## Precios (Fase 2)

- **CoinGecko**: cada activo lleva su `coingecko_id` (ej. `bitcoin`) para evitar
  colisiones de ticker. Precio en vivo cacheado 60s. Cotiza en `usd` (~USDT).
- **Binance**: velas OHLCV vía par `binance_symbol` (ej. `BTCUSDT`), endpoint
  público sin key. Si Binance está restringido en tu país (HTTP 451/403), usa
  como alternativa el endpoint `/coins/{id}/ohlc` de CoinGecko.
