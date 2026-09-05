"""
Runner de desarrollo del backend.

Arranca uvicorn con auto-recarga PERO vigilando SOLO la carpeta `app/` (el
código fuente), no la raíz de `backend/`. Así, escribir en `portfolio.db` (que
vive en `backend/`) NO dispara recargas que dejan el servidor caído un instante
— que era lo que provocaba "¿Está el backend en marcha?" al refrescar.

Además, antes de arrancar comprueba que el puerto no esté ya ocupado. En Windows
es fácil que un backend anterior quede "huérfano" escuchando el 8000; si arrancas
otro encima, tendrías DOS servidores en el mismo puerto y las peticiones caerían
a veces en el muerto. Este chequeo lo evita con un mensaje claro.

Uso:
    cd backend
    . .venv/bin/activate            # Windows: .venv\\Scripts\\activate
    python run.py

Variables de entorno:
    HOST, PORT       (por defecto 127.0.0.1:8000)
    RELOAD=1         activa la auto-recarga al editar código (solo desarrollo)
    FORCE=1          arranca aunque el puerto parezca ocupado
"""
from __future__ import annotations

import os
import socket
import sys

import uvicorn


def _port_in_use(host: str, port: int) -> bool:
    """True si algo ya está escuchando en host:port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def _preflight(host: str, port: int) -> None:
    if os.getenv("FORCE") == "1":
        return
    if _port_in_use(host, port):
        print(
            f"\n[run] ERROR: el puerto {port} ya esta en uso.\n"
            f"      Seguramente un backend anterior quedo abierto (huerfano).\n"
            f"      Cierralo antes de arrancar de nuevo:\n\n"
            f"      Windows (PowerShell):\n"
            f"        Get-NetTCPConnection -LocalPort {port} -State Listen | "
            f"ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force }}\n\n"
            f"      Windows (cmd):\n"
            f"        netstat -ano | findstr :{port}    (mira el PID de la derecha)\n"
            f"        taskkill /PID <pid> /F\n\n"
            f"      macOS/Linux:\n"
            f"        lsof -ti tcp:{port} | xargs kill -9\n\n"
            f"      (o arranca igualmente con  FORCE=1 python run.py )\n"
        )
        sys.exit(1)


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("RELOAD", "0") != "0"

    _preflight(host, port)

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        # Vigila SOLO el codigo, nunca la base de datos ni archivos de datos.
        reload_dirs=["app"],
        reload_includes=["*.py"],
        reload_excludes=["*.db", "*.db-*", "*.sqlite*", "*.json", ".env"],
    )
