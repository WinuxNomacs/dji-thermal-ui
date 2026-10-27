"""The basemaps under the mosaics: the settings' BASEMAPS, and Mapbox's satellite imagery with the user's own token.

The token is the one saved in the app (the `mapbox_token` preference), else MAPBOX_API_TOKEN from the environment or
from a .env file (the settings' MAPBOX_ENV_FILES). The browser sends it to Mapbox itself: only public tokens (pk.) are
taken, since anyone looking at the page can read it."""

import os
import re

from django.conf import settings
from django.templatetags.static import static

from .models import Preferences

TOKEN_KEY = 'mapbox_token'
TOKEN_ENV = 'MAPBOX_API_TOKEN'
# A public token: pk. and its two parts (Mapbox's are about 90 characters)
TOKEN_RE = re.compile(r'^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
TOKEN_MAX = 500

MAPBOX = {
    "type": "mapbox",
    "label": "Mapbox Satellite",
    "url": "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90",
    "maxzoom": 22,
    "minzoom": 0,
}


def token_error(token):
    """Why a token cannot be saved, or None"""
    if not isinstance(token, str) or not token.strip():
        return "Paste the token"
    token = token.strip()
    if len(token) > TOKEN_MAX:
        return "That is longer than a Mapbox token"
    if token.startswith('sk.'):
        return "That is a secret token: use a public one (it starts with pk.)"
    if not TOKEN_RE.match(token):
        return "A Mapbox public token starts with pk. and has no spaces"
    return None


def env_file_token(path):
    """MAPBOX_API_TOKEN in a .env file (KEY=value lines; export, quotes and comments allowed), or None"""
    try:
        with open(path, encoding='utf-8') as f:
            lines = f.read().splitlines()
    except (OSError, UnicodeDecodeError):
        return None
    for line in lines:
        m = re.match(r'^\s*(?:export\s+)?' + TOKEN_ENV + r'\s*=\s*(.*?)\s*$', line)
        if m:
            value = m.group(1)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
                return value[1:-1].strip() or None
            return value.split(' #')[0].strip() or None
    return None


def env_token():
    """MAPBOX_API_TOKEN from the environment, else from the first .env file that has it"""
    value = os.environ.get(TOKEN_ENV, '').strip()
    if value:
        return value
    for path in settings.MAPBOX_ENV_FILES:
        value = env_file_token(path)
        if value:
            return value
    return None


def mapbox_token():
    """The token in use and where it comes from: (token, 'saved' | 'env'), or (None, None)"""
    saved = Preferences.load().data.get(TOKEN_KEY)
    if isinstance(saved, str) and saved:
        return saved, 'saved'
    value = env_token()
    return (value, 'env') if value else (None, None)


def mapbox_state():
    """What the pages and the API say about the token: it, where it comes from, and whether one is in the
    environment to go back to"""
    token, source = mapbox_token()
    return {'token': token, 'token_source': source, 'env_token': source == 'env' or env_token() is not None}


def page_basemaps():
    """The basemaps a map page offers: the settings' and Mapbox's (shown in the switch once it has a token)"""
    mapbox = dict(MAPBOX, logo=static("vendor/mapbox/mapbox-logo.svg"), **mapbox_state())
    return list(settings.BASEMAPS) + [mapbox]
