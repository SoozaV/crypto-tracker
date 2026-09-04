# Crypto Portfolio Tracker (local & privado)

App local para seguimiento de inversiones en cripto **spot** con cálculo de coste
promedio ponderado (ACB) **por wallet**, fees, PnL/ROI y análisis técnico en el
frontend. Sin nube, sin autenticación, sin importar historial de exchanges: tú
registras tus movimientos y todo se guarda en SQLite en tu máquina.

## Stack

| Capa          | Tecnología                                         |
| ------------- | -------------------------------------------------- |
| Backend       | Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic     |
| Base de datos | SQLite (local, sin nube ni auth)                   |
| Frontend      | React · Vite · TypeScript · Tailwind               |
| Precisión     | `Decimal` (backend) · `decimal.js` (frontend)      |
| Precios       | CoinGecko (precio/mercado/búsqueda) · Binance (velas OHLCV) |
| Gráficos      | Lightweight Charts · Recharts                      |
| Indicadores   | `technicalindicators` (Fase 7, en el frontend)     |

## Estado

- ✅ **Fase 0–4 y 6 (backend)** — cimientos, motor ACB por wallet con fees/UTC,
  precios (CoinGecko + Binance, caché, reintentos), métricas, OHLCV crudo + cron
  diario, y seguridad (CORS, rate limiting, claves en `.env`).
- ✅ **Fase 5 (frontend)** — interfaz completa y rediseñada (ver más abajo).
- ⏳ **Fase 7** — indicadores en TypeScript (RSI/Stoch/SMA + traducción de Pine
  Script). El panel del gráfico ya está preparado para recibirlos.

Tests: **38 en verde** (`pytest`) + 10 del helper de `decimal.js` en el frontend.

## Puesta en marcha

### Backend
```
cd backend
python3 -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # edita tus valores (CoinGecko key)
alembic upgrade head            # crea portfolio.db con tablas e índices
uvicorn app.main:app --reload   # http://127.0.0.1:8000/docs
```
En tests puedes desactivar el cron con `ENABLE_SCHEDULER=0`.

### Frontend
```
cd frontend
npm install
npm run dev                     # http://127.0.0.1:5173 (proxy /api -> :8000)
npm run test:decimal            # 10 tests del helper de precisión
```

## API

Todos los endpoints de métricas aceptan `?wallet_id=` (ausente = global).
Los importes viajan como **string** para no perder precisión (el frontend los lee
con `decimal.js`). Los errores de negocio del ACB devuelven **HTTP 400**.

| Método | Ruta                               | Descripción                              |
| ------ | ---------------------------------- | ---------------------------------------- |
| GET    | `/api/portfolio/summary`           | Valor, PnL, ROI, asignación **+ cambios 24h/7d/30d por activo** |
| GET    | `/api/portfolio/realized-pnl`      | PnL realizado del scope                   |
| GET    | `/api/asset/{id}`                  | Detalle completo (incluye `decimals` y `changes`) |
| GET    | `/api/asset/{id}/changes`          | Cambios 24h/7d/30d                        |
| GET    | `/api/asset/{id}/ohlcv?days=30`    | Velas crudas (el frontend calcula indicadores) |
| GET    | `/api/wallets` · `/api/assets`     | Selector / catálogo                       |
| GET    | `/api/coins/search?q=`             | **Autocompletar de monedas (CoinGecko)**  |
| POST   | `/api/transactions`                | Registra una transacción                  |
| DELETE | `/api/transactions/{id}`           | **Elimina una transacción y recalcula el ACB** |
| POST   | `/api/setup`                       | Posición inicial (crea/reutiliza wallet + depósito) |
| POST   | `/api/admin/refresh-prices`        | Fuerza la actualización del histórico     |

## Notas de contabilidad

- Moneda base fija: **USDT**. Precios y costes en USDT.
- **ACB por wallet**: el coste promedio se lleva por par (wallet, activo). Tu BTC
  en Binance y en Ledger tienen promedios independientes. La vista global suma
  holdings.
- **Modelo de entrada simple (Cantidad + Total):** al registrar una operación
  indicas la **cantidad en cripto** y el **total en USDT** (en compras/depósitos,
  lo que pagaste con fees incluidos; en ventas, lo que recibiste neto de fees). El
  precio unitario se deriva como `total / cantidad`. Es exacto para el ACB y evita
  el campo de fee por separado. Los fees en otra moneda (p. ej. pagar en BNB) se
  pueden añadir más adelante como modo avanzado; el backend ya soporta `fee_usdt`.
- **Retiro**: reduce cantidad y coste de forma proporcional; no genera PnL.
- **Eliminar transacciones**: al borrar una, se recalcula el holding afectado
  releyendo sus transacciones. Si el borrado dejaría en negativo una venta/retiro
  posterior, se bloquea con HTTP 400 y no se borra nada.
- Todas las fechas se guardan en **UTC** (el frontend envía tu hora local en ISO
  8601 y el backend la normaliza).

## Interfaz (Fase 5)

- **Mercado vs tu rendimiento (importante):** los porcentajes **24h/7d/30d** son el
  cambio del **precio de mercado** del activo (igual para todos, fuente CoinGecko).
  Tu **ROI** es tu rendimiento personal según tu coste promedio. Están etiquetados
  por separado ("Mercado 24h" vs "Tu ROI") para no confundirlos.
- **Elegir la moneda por búsqueda:** en "Cargar posición inicial" buscas la moneda
  y la eliges de una lista real de CoinGecko, así el `coingecko_id` queda ligado a
  tu elección (no puedes poner símbolo BTC con el id de otra moneda). El par de
  Binance se propone como `{SÍMBOLO}USDT` y los decimales son solo de display.
- Tema claro/oscuro con conmutador y persistencia; tipografía con dígitos
  tabulares; el **ámbar** conecta "tu precio promedio" en la tabla con tu línea de
  coste en el gráfico de velas.
- Dashboard con valor/PnL/ROI, tabla de posiciones (con barra de asignación y chip
  de mercado 24h), donut de distribución, formulario de transacción, e historial
  con **filtro por activo** y **botón para eliminar**.
- Detalle del activo con velas + tu coste promedio, selector de periodo (7/30/90/365d),
  estadísticas completas y botón "Actualizar velas".

## Cambios recientes (Fase 5)

### Correcciones
- **DELETE bloqueado por CORS** → el middleware solo permitía GET/POST/OPTIONS;
  ahora incluye **DELETE** (y PUT/PATCH), así el borrado de transacciones funciona
  desde el navegador. Cubierto con un test de preflight.
- **Historial sin wallet** → añadida la columna **Wallet** (mapea `wallet_id`).
- **Símbolo duplicado en Posiciones** → el chip es el ticker y al lado va solo el
  nombre (antes se veía "BTC BTC Bitcoin").
- **Buscador: "Cambiar" no dejaba re-buscar** → al limpiar la selección vuelve a
  mostrarse el campo de búsqueda (el estado quedaba en un objeto vacío pero truthy).
- **502 en el buscador de monedas / menos presión sobre CoinGecko** → el resumen
  hacía 2 llamadas por activo (precio + mercado); ahora hace **1** (precio y
  cambios juntos). El buscador ya **no llama a la API por cada tecla**: descarga
  `/coins/list` una vez (cacheada 12h) y filtra en local. Esto evita agotar el
  rate limit del plan gratuito, que era lo que provocaba los 502 en `/api/coins/search`.
- **`decimals` no llegaba al frontend** → añadido a `/portfolio/summary` y
  `/asset/{id}` (antes todo se formateaba a 8 decimales).
- **Gráfico en blanco por el color del tema** → Lightweight Charts no parsea
  `rgb(15 23 42)` (sintaxis con espacios); se pasa `rgb(15, 23, 42)`.
- **Gráfico en blanco por locale del sistema** → se fija `localization.locale` en
  el chart y el formateo de fechas es tolerante a locales inválidos.

### Mejoras estructurales
- Resumen del portafolio **compartido** (1 llamada en vez de 3 por render).
- Refresco automático (5 min) **sin remonte** (sin parpadeo de skeletons).
- **Modo oscuro funcional** (antes `darkMode:'class'` estaba muerto).

### Funciones nuevas / antes ocultas
- **Cambios 24h/7d/30d** en la lista (el `summary` los incluye vía `market_provider`).
- **Eliminar transacciones** (`DELETE /api/transactions/{id}` con recálculo del ACB).
- **Buscador de monedas** (`GET /api/coins/search`) para elegir símbolo/id correctos.
- **Modelo Cantidad + Total** en el formulario (fees incluidos en el total).
- "Cargar posición inicial" reescrito y claro (wallet existente o nueva).
- Botón "Actualizar velas" que usa `/api/admin/refresh-prices`.
- Filtro por activo en el historial.
