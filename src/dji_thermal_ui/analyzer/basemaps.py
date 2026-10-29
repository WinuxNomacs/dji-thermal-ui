"""The basemaps under the mosaics: the settings' BASEMAPS, and Mapbox's satellite imagery with the user's own token.

The token is MAPBOX_API_TOKEN from the environment, else from a .env file (envfile). The System
Settings page replaces it in the .env it was read from (else the data folder's) once Mapbox has accepted it. The
browser sends it to Mapbox itself: only public tokens (pk.) are taken, since anyone looking at the page can read it."""

import re
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.templatetags.static import static

from . import envfile
from .models import Preferences

TOKEN_KEY = 'mapbox_token'   # where versions before 0.9 saved the token, moved to .env at the start (move_saved_token)
BASEMAP_KEY = 'basemap'     # the basemap the maps start with (a basemap's key, or NONE): the settings' default without one
NONE = 'none'
TOKEN_ENV = 'MAPBOX_API_TOKEN'
# A public token: pk. and its two parts (Mapbox's are about 90 characters)
TOKEN_RE = re.compile(r'^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
TOKEN_MAX = 500

# Mapbox's satellite style through the Static Tiles API (512-pixel tiles): the Raster Tiles API answered an account
# without a card with 429 only
MAPBOX = {
    "key": "mapbox",
    "type": "mapbox",
    "label": "Mapbox Satellite",
    "url": "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}",
    "maxzoom": 22,
    "minzoom": 0,
}

# Asked for to check a token: the whole world, one tile; how long Mapbox gets to answer (s)
CHECK_TILE = (0, 0, 0)
CHECK_TIMEOUT = 10
REFUSED = {
    401: "Mapbox refused the token: check that it was copied whole",
    403: "Mapbox refused the token (its URL restrictions, or the account)",
    429: "The Mapbox account's limit is reached for now: try again later",
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


def mapbox_token():
    """The token in use and where it comes from: (token, 'environment' | the .env file's path), or (None, None)"""
    return envfile.lookup(TOKEN_ENV)


def env_token():
    """MAPBOX_API_TOKEN from the environment, else from the first .env file that has it"""
    return mapbox_token()[0]


def token_file():
    """The .env file a token is written to: the one it was read from, else the data folder's"""
    return envfile.target_file(TOKEN_ENV)


def write_token(token, path=None):
    """Puts the token in a .env file in place of the one there (the other lines kept)"""
    return envfile.write({TOKEN_ENV: token}, path)


def check_token(token):
    """Whether Mapbox serves its imagery with the token: None, else why not"""
    z, x, y = CHECK_TILE
    url = MAPBOX['url'].format(z=z, x=x, y=y) + '?access_token=' + urllib.parse.quote(token)
    try:
        with urllib.request.urlopen(url, timeout=CHECK_TIMEOUT) as res:
            res.read(1)
        return None
    except urllib.error.HTTPError as e:
        return REFUSED.get(e.code, "Mapbox answered %d: try again later" % e.code)
    except (urllib.error.URLError, OSError):
        return "Mapbox could not be reached: is this computer online?"


def mapbox_state():
    """What the pages and the API say about the token: it, and where it comes from ('environment', a .env file's path,
    or None); the file a new one is written to (None while the environment's is used)"""
    token, source = mapbox_token()
    return {'token': token, 'token_source': source,
            'file': None if source == 'environment' else token_file()}


def move_saved_token():
    """Moves a token saved in the preferences (before 0.9) to the data folder's .env, unless one is known already"""
    prefs = Preferences.load()
    saved = prefs.data.get(TOKEN_KEY)
    if saved is None:
        return
    if isinstance(saved, str) and saved and not mapbox_token()[0]:
        write_token(saved)
    del prefs.data[TOKEN_KEY]
    prefs.save()


def basemap_choices():
    """The basemaps the maps can start with, [{key, label}]: the settings', Mapbox's once it has a token, and none"""
    listed = list(settings.BASEMAPS) + ([MAPBOX] if mapbox_token()[0] else [])
    return [{'key': bm['key'], 'label': bm['label']} for bm in listed] + [{'key': NONE, 'label': "None"}]


def basemap_keys():
    """What the basemap preference can be: every basemap's key, Mapbox's even without a token, and none"""
    return [bm['key'] for bm in settings.BASEMAPS] + [MAPBOX['key'], NONE]


def preferred_basemap():
    """The basemap the maps start with (the preferences'), "" for the settings' default"""
    key = Preferences.load().data.get(BASEMAP_KEY)
    return key if key in basemap_keys() else ""


def starting_basemap():
    """The key of the basemap the maps start with: the preferred one, else the settings' default"""
    return preferred_basemap() or next((bm['key'] for bm in settings.BASEMAPS if bm.get('default')), NONE)


def page_basemaps():
    """The basemaps a map page offers: the settings' and Mapbox's (shown in the switch once it has a token) with its
    token. The preferred one is the default (Mapbox only while it has a
    token); the settings' default is the fallback a refused Mapbox goes back to."""
    mapbox = dict(MAPBOX, logo=static("vendor/mapbox/mapbox-logo.svg"), token=mapbox_token()[0])
    listed = [dict(bm, fallback=bool(bm.get('default'))) for bm in settings.BASEMAPS] + [mapbox]
    preferred = preferred_basemap()
    if preferred and not (preferred == MAPBOX['key'] and not mapbox['token']):
        for bm in listed:
            bm['default'] = bm['key'] == preferred
    return listed
