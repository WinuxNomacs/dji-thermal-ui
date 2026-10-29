"""WebODM, through its REST API. Its address and login are WEBODM_URL, WEBODM_USERNAME and WEBODM_PASSWORD, from the
environment or a .env file (envfile), where System Settings writes them once WebODM has taken the login; never in the
database, and the password never goes to the browser.

The client logs in when it needs a token (WebODM's JWT lasts 6 hours and is kept in memory only), and again when the
token expires or is refused. Every call has a timeout; what goes wrong is said in plain words (WebODMError)."""

import base64
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

from . import envfile

URL_ENV = 'WEBODM_URL'
USERNAME_ENV = 'WEBODM_USERNAME'
PASSWORD_ENV = 'WEBODM_PASSWORD'
NAMES = (URL_ENV, USERNAME_ENV, PASSWORD_ENV)
URL_MAX = 2048
USERNAME_MAX = 150      # Django's
PASSWORD_MAX = 4096
TIMEOUT = 15            # s, for each call
TOKEN_MARGIN = 300      # s: a token this close to expiring is asked for again
TOKEN_LIFE = 6 * 3600   # s: WebODM's, when the token does not say

_tokens = {}            # (url, username, password) -> (token, when it expires)
_lock = threading.Lock()


class WebODMError(Exception):
    """What went wrong talking to WebODM, in words for the user"""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def config():
    """The address and login: {url, username, password, source ('environment', a .env file's path, or None)}; any
    of them from the environment makes it the environment's"""
    found = {name: envfile.lookup(name) for name in NAMES}
    sources = [source for _, source in found.values() if source]
    source = envfile.ENVIRONMENT if envfile.ENVIRONMENT in sources else (sources[0] if sources else None)
    return {'url': found[URL_ENV][0], 'username': found[USERNAME_ENV][0], 'password': found[PASSWORD_ENV][0],
            'source': source}


def masked(username):
    """A user name as the page shows it: its first character only"""
    return username[:1] + "…" if username else None


def state():
    """What the page says: the address, the user name masked, whether a password is set, where they come from, and
    the file new ones are written to (None while the environment's are used)"""
    c = config()
    return {'url': c['url'], 'username': masked(c['username']), 'password': bool(c['password']),
            'source': c['source'], 'configured': bool(c['url'] and c['username'] and c['password']),
            'file': None if c['source'] == envfile.ENVIRONMENT else envfile.target_file(*NAMES)}


def clean_url(url):
    """WebODM's address without a trailing slash; ValueError says why one is not taken"""
    if not isinstance(url, str) or not url.strip():
        raise ValueError("Type WebODM's address")
    url = url.strip().rstrip('/')
    if len(url) > URL_MAX:
        raise ValueError("That address is too long")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        raise ValueError("WebODM's address starts with http:// or https://, then its host")
    if parts.username or parts.password:
        raise ValueError("Put the user name and password in their own fields, not in the address")
    if parts.query or parts.fragment:
        raise ValueError("WebODM's address has no ? or # part")
    try:
        _ = parts.port
    except ValueError:
        raise ValueError("That address's port is not a number") from None
    return url


def token_expiry(token):
    """When a JWT expires (its exp), else WebODM's 6 hours from now"""
    try:
        payload = token.split('.')[1]
        return float(json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))['exp'])
    except (IndexError, ValueError, KeyError, TypeError):
        return time.time() + TOKEN_LIFE


def _send(url, method='GET', data=None, headers=None, timeout=TIMEOUT):
    """(status, body) of a call; WebODMError when it cannot be made"""
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with _opener.open(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        if 300 <= e.code < 400:
            raise WebODMError("WebODM's address sends to %s instead: use that address"
                              % (e.headers.get('Location') or "another")) from None
        return e.code, e.read()
    except (urllib.error.URLError, OSError) as e:
        reason = getattr(e, 'reason', e)
        raise WebODMError("WebODM could not be reached at %s (%s): is it running?"
                          % (url.split('/api/')[0], reason)) from None


def _json(body):
    try:
        return json.loads(body.decode('utf-8')) if body else None
    except (UnicodeDecodeError, ValueError):
        raise WebODMError("That address answered, but not as WebODM does: is it WebODM's?") from None


def _detail(data):
    """WebODM's own words for an error, if any"""
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list) and value:
                return str(value[0])
            if isinstance(value, str) and value:
                return value
    return ""


class Client:
    def __init__(self, url, username, password):
        self.url, self.username, self.password = url, username, password

    @classmethod
    def from_config(cls):
        c = config()
        if not (c['url'] and c['username'] and c['password']):
            raise WebODMError("WebODM is not set up: give its address and login under System Settings › WebODM")
        return cls(c['url'], c['username'], c['password'])

    def login(self):
        """Asks WebODM for a token, and keeps it"""
        body = urllib.parse.urlencode({'username': self.username, 'password': self.password}).encode()
        status, raw = _send(self.url + '/api/token-auth/', 'POST', body,
                            {'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'})
        if status == 400:
            raise WebODMError("WebODM refused the user name and password")
        if status in (404, 405):
            raise WebODMError("That address has no WebODM login (/api/token-auth/): is it WebODM's?")
        if status != 200:
            raise WebODMError("WebODM answered %d to the login: try again later" % status)
        data = _json(raw)
        token = data.get('token') if isinstance(data, dict) else None
        if not isinstance(token, str) or not token:
            raise WebODMError("That address answered, but not as WebODM does: is it WebODM's?")
        with _lock:
            _tokens[self._key()] = (token, token_expiry(token))
        return token

    def _key(self):
        return self.url, self.username, self.password

    def _token(self):
        with _lock:
            kept = _tokens.get(self._key())
        if kept and kept[1] - TOKEN_MARGIN > time.time():
            return kept[0], False
        return self.login(), True

    def request(self, method, path, data=None, timeout=TIMEOUT):
        """WebODM's answer (JSON) to a call to its API (path from /api/, data sent as JSON); a token it refuses is asked
        for again once"""
        token, fresh = self._token()
        body = None if data is None else json.dumps(data).encode()
        while True:
            headers = {'Authorization': 'JWT ' + token, 'Accept': 'application/json'}
            if body is not None:
                headers['Content-Type'] = 'application/json'
            status, raw = _send(self.url + path, method, body, headers, timeout)
            if status in (401, 403) and not fresh:
                token, fresh = self.login(), True
                continue
            break
        if 200 <= status < 300:
            return _json(raw)
        detail = _detail(_json(raw)) if raw else ""
        if status in (401, 403):
            raise WebODMError("WebODM refused: the account lacks a permission this needs (see System Settings › "
                              "WebODM)" + (": " + detail if detail else ""))
        if status == 404:
            raise WebODMError("WebODM has no %s: it was removed, or the account cannot see it" % path)
        if status == 400:
            raise WebODMError("WebODM did not take it" + (": " + detail if detail else ""))
        raise WebODMError("WebODM answered %d: try again later" % status)

    def nodes(self):
        """The processing nodes the account can see: [{id, label, online}]"""
        found = self.request('GET', '/api/processingnodes/')
        if not isinstance(found, list):
            raise WebODMError("That address answered, but not as WebODM does: is it WebODM's?")
        return [{'id': n.get('id'), 'label': n.get('label') or "%s:%s" % (n.get('hostname'), n.get('port')),
                 'online': bool(n.get('online'))} for n in found if isinstance(n, dict)]


def check(url, username, password):
    """Logs in to WebODM with a login before it is saved; the processing nodes the account can see"""
    client = Client(url, username, password)
    client.login()
    return client.nodes()


def save(url, username, password):
    """Writes the address and login to the .env file"""
    return envfile.write({URL_ENV: url, USERNAME_ENV: username, PASSWORD_ENV: password})


def remove():
    """Takes the address and login out of every .env file that has them"""
    for path in settings.ENV_FILES:
        envfile.write({name: None for name in NAMES}, str(path))
    with _lock:
        _tokens.clear()
