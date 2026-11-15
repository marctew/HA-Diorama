"""Constants for Diorama."""

from pathlib import Path

DOMAIN = "diorama"
TITLE = "Diorama"

PANEL_URL_PATH = "diorama"
PANEL_ELEMENT = "diorama-panel"
PANEL_ICON = "mdi:home-group"

# Everything under STATIC_URL is public and unauthenticated, like /local/.
STATIC_URL = "/diorama_static"
FRONTEND_DIR = Path(__file__).parent / "frontend" / "dist"
PANEL_FILE = "diorama-panel.js"
CARD_FILE = "diorama-card.js"

# The bundled furniture catalogue, made by tools/build_catalogue.py. Public,
# like the frontend: only CC0 models are in it.
ASSETS_URL = "/diorama_assets"
ASSETS_DIR = Path(__file__).parent / "assets"
CATALOGUE_FILE = "catalogue.json"

# Plan images uploaded to trace over, under the configuration folder (not in
# the integration's own folder, which an update replaces).
TRACE_FOLDER = "diorama/trace"
TRACE_MAX_BYTES = 10 * 1024 * 1024
