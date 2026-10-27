"""A project's location found by name, or named from a point: OpenStreetMap's Nominatim, asked by the server so that it
can say who is asking (the app's name as its user agent) and keep to one request a second, as its usage policy asks
(https://operations.osmfoundation.org/policies/nominatim/). Its answers may be kept (OpenStreetMap's data, under the
ODbL, credited where it is shown); Mapbox's geocoding is not used, since its answers may not be kept without its paid
permanent geocoding."""

import json
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings

from .._version import __version__

SERVICE = "OpenStreetMap Nominatim"
ATTRIBUTION = "© OpenStreetMap contributors"
USER_AGENT = "dji-thermal-ui/{} (+https://github.com/WinuxNomacs/dji-thermal-ui)".format(__version__)
MAX_QUERY_LENGTH = 200
MAX_RESULTS = 8
TIMEOUT = 10            # seconds
INTERVAL = 1.0          # seconds between two requests at least
MAX_LABEL_LENGTH = 255

_lock = threading.Lock()
_last = 0.0             # when the last request was sent (time.monotonic)


class PlacesError(Exception):
    """Nominatim did not answer, or not with places"""


def ask(path, params, language=""):
    """Nominatim's JSON for one request, a second after the one before at least"""
    global _last
    query = dict(params, format='jsonv2')
    if language:
        query['accept-language'] = language
    req = Request("{}/{}?{}".format(settings.NOMINATIM_URL.rstrip('/'), path, urlencode(query)),
                  headers={'User-Agent': USER_AGENT})
    with _lock:
        wait = _last + INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last = time.monotonic()
        try:
            with urlopen(req, timeout=TIMEOUT) as res:
                return json.loads(res.read().decode('utf-8'))
        except HTTPError as e:
            raise PlacesError("{} refused the search ({})".format(SERVICE, e.code)) from None
        except (URLError, TimeoutError, OSError):
            raise PlacesError("{} could not be reached: is the computer online?".format(SERVICE)) from None
        except ValueError:
            raise PlacesError("{} did not answer with places".format(SERVICE)) from None


def place(item, lon=None, lat=None):
    """A place as the API gives it: {lon, lat, label}, at the point given or at Nominatim's"""
    try:
        return {'lon': float(item['lon']) if lon is None else lon, 'lat': float(item['lat']) if lat is None else lat,
                'label': str(item.get('display_name') or "")[:MAX_LABEL_LENGTH]}
    except (KeyError, TypeError, ValueError):
        return None


def search(query, language=""):
    """The places a text names, best first"""
    found = ask('search', {'q': query, 'limit': MAX_RESULTS}, language)
    if not isinstance(found, list):
        raise PlacesError("{} did not answer with places".format(SERVICE))
    return [p for p in (place(item) for item in found if isinstance(item, dict)) if p]


def reverse(lon, lat, language=""):
    """The place at a point, named by its address (the point is kept), or None where Nominatim has nothing"""
    found = ask('reverse', {'lon': lon, 'lat': lat, 'zoom': 18}, language)
    if not isinstance(found, dict):
        raise PlacesError("{} did not answer with a place".format(SERVICE))
    if 'error' in found:
        return None
    return place(found, lon, lat)
