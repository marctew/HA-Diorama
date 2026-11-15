"""Constants for Diorama."""

from pathlib import Path

DOMAIN = "diorama"
TITLE = "Diorama"

PANEL_URL_PATH = "diorama"
PANEL_ELEMENT = "diorama-panel"
PANEL_ICON = "mdi:home-group"

# Everything under STATIC_URL is public and unauthenticated, like /local/.
STATIC_URL = "/diorama_static"
FRONTEND_URL = f"{STATIC_URL}/frontend"
FRONTEND_DIR = Path(__file__).parent / "frontend" / "dist"
PANEL_FILE = "diorama-panel.js"
CARD_FILE = "diorama-card.js"
