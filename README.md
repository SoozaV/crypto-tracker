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
- ✅ **Fase 7** — indicadores en TypeScript (SMA, RSI, Stoch y cruce de EMAs
  traducido de Pine Script), con panel de activación y osciladores en subpanel.

Tests: **38 en verde** (`pytest`) + 10 del helper de `decimal.js` en el frontend.

## Puesta en marcha

### Backend
```
cd backend
python3 -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # edita tus valores (CoinGecko key)
python run.py                   # http://127.0.0.1:8000  (auto-migra al arrancar)
```
`run.py` arranca uvicorn **sin auto-recarga por defecto** (máxima estabilidad para
usar la app). Para desarrollo con recarga al editar código: `RELOAD=1 python run.py`
(vigila **solo** `app/`, nunca la BD). Importante:
**no** uses `uvicorn app.main:app --reload` a secas, porque vigila toda la carpeta
`backend/` (incluida `portfolio.db`) y cada escritura en la BD recargaría el
servidor, dejándolo caído un instante (eso causaba "¿Está el backend en marcha?"
al refrescar). Alternativa directa: `uvicorn app.main:app --reload --reload-dir app`.
Máxima estabilidad: `RELOAD=0 python run.py`.

Windows — puerto 8000 ocupado / backend "huérfano": si tras un reinicio quedó un
backend viejo escuchando el 8000, `run.py` ahora **se niega a arrancar** con un
mensaje claro (evita tener dos servidores en el mismo puerto, que hacía que las
peticiones cayeran a veces en el proceso muerto). Para liberarlo, en PowerShell:

    Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

o por PID: `netstat -ano | findstr :8000` y luego `taskkill /PID <pid> /F`. Después,
`python run.py`.

En tests, el cron y la auto-migración están desactivados (`conftest.py`).

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
| PATCH  | `/api/wallets/{id}`                | **Renombra / cambia el tipo de una wallet** |
| GET    | `/api/export?wallet_id=`           | **Exporta datos (global o por wallet) a JSON** |
| POST   | `/api/import`                      | **Importa un JSON sin duplicar (idempotente)** |
| POST   | `/api/admin/reset`                 | **Borra todos los datos (requiere confirm:true)** |
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

## Copia de seguridad y datos

- **Migración automática:** al arrancar, el backend aplica las migraciones
  pendientes (`alembic upgrade head`) contra tu `DATABASE_URL`. Así, tras
  actualizar el código, basta con **reiniciar el backend**: la columna `uid` se
  añade sola sin perder datos. Se puede desactivar con `AUTO_MIGRATE=0` (entonces
  ejecuta la migración a mano). En los tests está desactivada.
- **Exportar / importar** (menú **Ajustes**): descarga un JSON global o por wallet
  e impórtalo cuando quieras. La importación **no duplica**: cada transacción
  lleva un `uid` estable y al importar se omiten las que ya existen (idempotente).
  Si un archivo viene sin `uid` (hecho a mano), se deduplica por hash de contenido.
  Identidades entre bases distintas: wallet por nombre, activo por símbolo.
- **Renombrar wallet** en Ajustes (nombre único).
- **Resetear todo** en Ajustes → "Zona de peligro" (hay que escribir `RESET`).

## Indicadores técnicos (Fase 7)

Todos los indicadores se calculan **en el frontend** con `technicalindicators`
(el backend solo sirve las velas OHLCV crudas). El gráfico del detalle del activo
permite elegir temporalidad **1h / 4h / 1d / 1s (semana)** y muestra bastantes más
velas (se piden directamente a Binance por intervalo). Los indicadores se activan
con checkboxes: SMA y el cruce de EMA 9/21 se dibujan **sobre el precio**; RSI y
Stoch en un **panel inferior sincronizado**.

Archivos:
- `frontend/src/indicators/types.ts` — la interfaz `Indicator`.
- `frontend/src/indicators/builtin.ts` — SMA, EMA cross, RSI, Stoch, Ichimoku OB/OS.
- `frontend/src/indicators/registry.ts` — lista de indicadores disponibles.
- `frontend/src/utils/pineAdapter.ts` — guía Pine Script → TypeScript.

Añadir un indicador nuevo (p. ej. traducido de Pine Script):
1. Impleméntalo en `builtin.ts` según la interfaz `Indicator`: extrae los precios
   de las velas, calcula con `technicalindicators`, alinea con `align()` y
   devuelve `{ lines, levels? }` indicando `pane: 'price'` (overlay) u
   `'oscillator'` (panel inferior). La tabla de equivalencias Pine→TS está en
   `pineAdapter.ts` (`ta.sma`→`SMA.calculate`, `plot`→una línea, `hline`→`levels`,
   `overlay=true`→`pane:'price'`, etc.).
2. Añádelo al array de `registry.ts`. El panel de la UI lo mostrará solo.

## Cambios recientes (Fase 5)

### Fase 7 + gráfico
- **Osciladores alineados con las velas:** además de igualar el ancho de la
  escala de precio, el panel del oscilador recibe una serie "fantasma" que cubre
  todo el rango de velas y se sincroniza el rango lógico; así ambos comparten el
  mismo dominio temporal (los indicadores empiezan más tarde por el warm-up) y
  cada fecha cae en la misma coordenada x. Verificado: diff de coordenadas = 0.
- **Líneas de indicador con color por valor:** `IndicatorLine.colorAt` permite
  colorear por tramos (traduce el `color := …` condicional de Pine). El Ichimoku
  OB/OS ahora se pinta verde (≥7), rojo (≤−7) y gris en medio.
- **Indicador "Ichimoku OB/OS"** traducido de Pine Script (oscilador ±10 con
  niveles ±7), como ejemplo de la extensibilidad.
- **Selector de temporalidad 1h / 4h / 1d / 1s** y muchas más velas (se piden por
  intervalo directamente a Binance, con caché corta; fallback a diario guardado).
- **Indicadores en TypeScript** (SMA, RSI, Stoch y cruce de EMA 9/21 traducido de
  Pine Script), con panel de activación y osciladores en subpanel sincronizado.
  Infra extensible: `indicators/{types,builtin,registry}.ts` + `utils/pineAdapter.ts`.

### Rendimiento y correcciones (esta ronda)
- **Precios en lote y desde caché (clave con muchos activos):** el resumen ya no
  hace una petición por activo. Un *prefetch* pide en **UNA sola llamada** a
  CoinGecko (`/coins/markets?ids=…`) todos los activos del scope y los cachea 5
  min. Así, al refrescar dentro de esos 5 min **no se toca la red** (precio
  cacheado); al expirar, se refresca todo en 1 petición; y al **añadir un activo
  nuevo** solo se pide ese (los demás siguen cacheados). Esto elimina el rate
  limit que aparecía con ~30 símbolos.
- **Historial: columna "Costo"** (cantidad × precio), además del precio unitario.
- **Decimales de precio adaptativos:** tokens muy baratos (SHIB, PEPE) ya no se
  ven como `0.00`; se muestran con cifras significativas (`0.00000535`). Nuevo
  `formatPrice()` usado en precio promedio, precio actual y precio del historial.

### Correcciones (estabilidad / rate limit)
- **El frontend fallaba "después de un rato" sin ningún mensaje** → el resumen
  llamaba a CoinGecko por cada activo en cada refresco (caché de solo 60s) y, al
  llegar el rate limit del plan gratuito (429), cada llamada reintentaba 4 veces
  con timeout de 15s → hasta **~63s bloqueada por activo**, sin log. axios cortaba
  a los 10s y mostraba "¿Está el backend en marcha?". Arreglado:
  - Timeouts cortos `(conexión 3s, lectura 6s)` en vez de 15s.
  - **No se reintentan** los 429/4xx (reintentar empeora el rate limit); se falla
    rápido y se degrada (el precio se muestra como no disponible), en vez de colgar.
  - **Caché de precios subida a 300s** (configurable con `PRICE_CACHE_TTL`), así el
    resumen casi nunca llama a CoinGecko.
  - Menos reintentos en Binance; timeout de axios a 20s con reintentos en el front.
  - `run.py` ahora arranca **sin reload** por defecto (evita recargas y huérfanos).
  - **Recomendado:** pon tu `COINGECKO_API_KEY` (demo, gratis) en `backend/.env`;
    sube muchísimo el límite de peticiones y evita los 429.

### Correcciones (arranque / errores)
- **El backend parecía "morir" al refrescar (F5)** → `uvicorn --reload` vigilaba
  toda la carpeta `backend/`, así que escribir en `portfolio.db` disparaba una
  recarga y tumbaba el puerto un instante (en Windows el worker viejo quedaba
  huérfano reteniendo el puerto). Solución: nuevo `backend/run.py` que vigila solo
  `app/` (probado: escribir en la BD ya no recarga; cambiar código sí). El frontend
  además reintenta la carga ante un blip y muestra un botón "Reintentar".
- **Errores 500 que parecían de CORS** → tras añadir `uid`, una BD sin migrar
  hacía fallar toda consulta a `transactions` con 500, y el navegador lo mostraba
  como "No 'Access-Control-Allow-Origin'". Ahora: (a) el backend **auto-migra al
  arrancar**, así que el problema desaparece al reiniciar; y (b) un middleware
  añade cabeceras CORS también a los errores 500, para que se vea el mensaje real
  en vez de un críptico error de CORS.

### Funciones (entrada)
- **Cost Price / precio unitario**: el formulario y "Cargar posición inicial"
  permiten introducir el importe como **Total (USDT)** o como **Precio por unidad**
  (el "Cost Price" de Binance). Se convierte automáticamente; el ACB no cambia.

### Funciones (datos)
- **Exportar/Importar** (global o por wallet) con dedupe por `uid` + hash de
  contenido; **renombrar wallet**; **reset total** con confirmación. Migración
  `a1b2c3d4e5f6` añade `transactions.uid`.

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
