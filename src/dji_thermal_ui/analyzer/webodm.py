"""WebODM, through its REST API. Its address and login are WEBODM_URL, WEBODM_USERNAME and WEBODM_PASSWORD, from the
environment or a .env file (envfile), where System Settings writes them once WebODM has taken the login; never in the
database, and the password never goes to the browser. A .env file keeps the password encrypted, its key in the database
(encryption).

The client logs in when it needs a token (WebODM's JWT lasts 6 hours and is kept in memory only), and again when the
token expires or is refused. Every call has a timeout; what goes wrong is said in plain words (WebODMError)."""

import base64
import json
import mimetypes
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

from . import encryption, envfile

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
UPLOAD_TIMEOUT = 600    # s, for a batch of images
DOWNLOAD_TIMEOUT = 120  # s, waiting for each chunk of a result
DOWNLOAD_CHUNK = 1024 * 1024

# WebODM's task statuses (nodeodm.status_codes)
TASK_STATUSES = {10: 'queued', 20: 'running', 30: 'failed', 40: 'completed', 50: 'canceled'}

UNREADABLE = "The saved password can't be read: type it again under System Settings › WebODM"

_tokens = {}            # (url, username, password) -> (token, when it expires)
_lock = threading.Lock()


class WebODMError(Exception):
    """What went wrong talking to WebODM, in words for the user (status: WebODM's answer, when it gave one)"""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def config():
    """The address and login: {url, username, password, unreadable, source ('environment', a .env file's path, or
    None)}; any of them from the environment makes it the environment's. A password the key can't open is None, and
    unreadable True"""
    found = {name: envfile.lookup(name) for name in NAMES}
    sources = [source for _, source in found.values() if source]
    source = envfile.ENVIRONMENT if envfile.ENVIRONMENT in sources else (sources[0] if sources else None)
    password, unreadable = found[PASSWORD_ENV][0], False
    try:
        password = encryption.decrypt(password)
    except encryption.Unreadable:
        password, unreadable = None, True
    return {'url': found[URL_ENV][0], 'username': found[USERNAME_ENV][0], 'password': password,
            'unreadable': unreadable, 'source': source}


def masked(username):
    """A user name as the page shows it: its first character only"""
    return username[:1] + "…" if username else None


def state():
    """What the page says: the address, the user name masked, whether a password is set and whether it can be read,
    where they come from, and the file new ones are written to (None while the environment's are used)"""
    c = config()
    return {'url': c['url'], 'username': masked(c['username']), 'password': bool(c['password']),
            'unreadable': c['unreadable'],
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
        with e:                                    # its response, closed (Python 3.14 warns of one left open)
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


def _refused(status, raw, path):
    """The WebODMError for an answer that isn't a success"""
    detail = _detail(_json(raw)) if raw else ""
    if status in (401, 403):
        return WebODMError("WebODM refused: the account lacks a permission this needs (see System Settings › "
                           "WebODM)" + (": " + detail if detail else ""))
    if status == 404:
        return WebODMError("WebODM has no %s: it was removed, or the account cannot see it" % path, 404)
    if status == 400:
        return WebODMError("WebODM did not take it" + (": " + detail if detail else ""))
    return WebODMError("WebODM answered %d: try again later" % status)


class Client:
    def __init__(self, url, username, password):
        self.url, self.username, self.password = url, username, password

    @classmethod
    def from_config(cls):
        c = config()
        if c['unreadable']:
            raise WebODMError(UNREADABLE)
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

    def request(self, method, path, data=None, timeout=TIMEOUT, body=None, content_type=None):
        """WebODM's answer (JSON) to a call to its API (path from /api/, data sent as JSON, or a body of its own
        content type); a token it refuses is asked for again once"""
        token, fresh = self._token()
        if data is not None:
            body, content_type = json.dumps(data).encode(), 'application/json'
        while True:
            headers = {'Authorization': 'JWT ' + token, 'Accept': 'application/json'}
            if body is not None:
                headers['Content-Type'] = content_type
            status, raw = _send(self.url + path, method, body, headers, timeout)
            if status in (401, 403) and not fresh:
                token, fresh = self.login(), True
                continue
            break
        if 200 <= status < 300:
            return _json(raw)
        raise _refused(status, raw, path)

    def download(self, project, task, asset, path, progress=None):
        """Writes one of a task's results (asset: its name, as orthophoto.tif) to a file as it comes; progress(bytes
        read, bytes in all or None) after each chunk, which may stop it by raising"""
        url = self.url + '/api/projects/%d/tasks/%s/download/%s' % (project, task, asset)
        token, fresh = self._token()
        while True:
            req = urllib.request.Request(url, headers={'Authorization': 'JWT ' + token})
            try:
                res = _opener.open(req, timeout=DOWNLOAD_TIMEOUT)
            except urllib.error.HTTPError as e:
                with e:
                    if e.code in (401, 403) and not fresh:
                        token, fresh = self.login(), True
                        continue
                    raise _refused(e.code, e.read(), url[len(self.url):]) from None
            except (urllib.error.URLError, OSError) as e:
                raise WebODMError("WebODM could not be reached at %s (%s): is it running?"
                                  % (self.url, getattr(e, 'reason', e))) from None
            break
        with res:
            total = int(res.headers.get('Content-Length') or 0) or None
            done = 0
            try:
                with open(path, 'wb') as f:
                    while True:
                        chunk = res.read(DOWNLOAD_CHUNK)
                        if not chunk:
                            break
                        f.write(chunk)
                        done += len(chunk)
                        if progress:
                            progress(done, total)
            except (urllib.error.URLError, OSError) as e:
                raise WebODMError("The download from WebODM stopped part way (%s): try again"
                                  % getattr(e, 'reason', e)) from None
        if total and done != total:
            raise WebODMError("The download from WebODM stopped part way: try again")
        return done

    def nodes(self):
        """The processing nodes the account can see: [{id, label, online}]"""
        found = self.request('GET', '/api/processingnodes/')
        if not isinstance(found, list):
            raise WebODMError("That address answered, but not as WebODM does: is it WebODM's?")
        return [{'id': n.get('id'), 'label': n.get('label') or "%s:%s" % (n.get('hostname'), n.get('port')),
                 'online': bool(n.get('online'))} for n in found if isinstance(n, dict)]

    def _list(self, path):
        found = self.request('GET', path)
        if not isinstance(found, list):
            raise WebODMError("That address answered, but not as WebODM does: is it WebODM's?")
        return [x for x in found if isinstance(x, dict)]

    def projects(self):
        """The projects the account can see, the newest first: [{id, name, can_add}] (can_add: it may add tasks)"""
        return [{'id': p.get('id'), 'name': p.get('name') or "", 'can_add': 'change' in (p.get('permissions') or [])}
                for p in self._list('/api/projects/?ordering=-created_at')]

    def create_project(self, name):
        """A new project of the account's: its id"""
        return self.request('POST', '/api/projects/', {'name': name})['id']

    def delete_project(self, project):
        self.request('DELETE', '/api/projects/%d/' % project)

    def options(self):
        """The ODM options the account's processing nodes offer: [{name, type, value, domain, help}]"""
        return [{k: o.get(k) for k in ('name', 'type', 'value', 'domain', 'help')}
                for o in self._list('/api/processingnodes/options/') if o.get('name')]

    def presets(self):
        """The account's presets and the system ones: [{id, name, system, options}]"""
        return [{'id': p.get('id'), 'name': p.get('name') or "", 'system': bool(p.get('system')),
                 'options': p.get('options') if isinstance(p.get('options'), list) else []}
                for p in self._list('/api/presets/')]

    def save_preset(self, name, options, preset=None):
        """Makes a preset of the account's own, or changes one (preset: its id): its id"""
        if preset:
            return self.request('PATCH', '/api/presets/%d/' % preset, {'name': name, 'options': options})['id']
        return self.request('POST', '/api/presets/', {'name': name, 'options': options})['id']

    def create_task(self, project, name, options, node=None):
        """A task waiting for its images (partial): its id"""
        data = {'partial': True, 'name': name, 'options': options}
        data.update({'processing_node': node, 'auto_processing_node': False} if node else
                    {'auto_processing_node': True})
        return self.request('POST', '/api/projects/%d/tasks/' % project, data)['id']

    def upload(self, project, task, paths):
        """Sends images to a task waiting for them: [(path on disk, name in the task)]"""
        boundary = uuid.uuid4().hex
        parts = []
        for path, name in paths:
            with open(path, 'rb') as f:
                content = f.read()
            kind = mimetypes.guess_type(name)[0] or 'application/octet-stream'
            parts.append(('--%s\r\nContent-Disposition: form-data; name="images"; filename="%s"\r\n'
                          'Content-Type: %s\r\n\r\n' % (boundary, name.replace('"', '_'), kind)).encode() + content
                         + b'\r\n')
        body = b''.join(parts) + ('--%s--\r\n' % boundary).encode()
        self.request('POST', '/api/projects/%d/tasks/%s/upload/' % (project, task), body=body,
                     content_type='multipart/form-data; boundary=' + boundary, timeout=UPLOAD_TIMEOUT)

    def commit(self, project, task):
        """Starts processing a task once its images are sent: WebODM's task"""
        return self.request('POST', '/api/projects/%d/tasks/%s/commit/' % (project, task), {})

    def remove_task(self, project, task):
        self.request('POST', '/api/projects/%d/tasks/%s/remove/' % (project, task), {})

    def task(self, project, task):
        """WebODM's task: {status (TASK_STATUSES), progress, error, pending}"""
        t = self.request('GET', '/api/projects/%d/tasks/%s/' % (project, task))
        if not isinstance(t, dict):
            raise WebODMError("That address answered, but not as WebODM does: is it WebODM's?")
        return {'status': TASK_STATUSES.get(t.get('status'), 'queued'), 'progress': float(t.get('running_progress') or 0),
                'error': t.get('last_error') or "", 'pending': t.get('pending_action')}


def check(url, username, password):
    """Logs in to WebODM with a login before it is saved; the processing nodes the account can see"""
    client = Client(url, username, password)
    client.login()
    return client.nodes()


def save(url, username, password):
    """Writes the address and login to the .env file, the password encrypted"""
    return envfile.write({URL_ENV: url, USERNAME_ENV: username, PASSWORD_ENV: encryption.encrypt(password)})


def encrypt_saved_password():
    """Encrypts in place a password a .env file keeps as typed (saved by an earlier build, or put there by hand); one in the
    environment is left alone. The files changed"""
    changed = []
    for path in settings.ENV_FILES:
        value = envfile.file_value(path, PASSWORD_ENV)
        if value and not encryption.is_encrypted(value):
            changed.append(envfile.write({PASSWORD_ENV: encryption.encrypt(value)}, str(path)))
    return changed


def remove():
    """Takes the address and login out of every .env file that has them"""
    for path in settings.ENV_FILES:
        envfile.write({name: None for name in NAMES}, str(path))
    encryption.forget()
    with _lock:
        _tokens.clear()
