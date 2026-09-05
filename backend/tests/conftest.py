"""Configuración común de tests: desactiva efectos de arranque (auto-migración y
cron) para que los tests usen solo su BD en memoria, sin tocar la BD real."""
import os

os.environ["AUTO_MIGRATE"] = "0"
os.environ["ENABLE_SCHEDULER"] = "0"
