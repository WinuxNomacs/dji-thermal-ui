"""WebODM's address and login under System Settings: checked with a login before they are written to .env, shown
masked, the password never sent back and kept encrypted, its key in the database; and the client that logs in when it needs a token"""

import base64
import io
import json
import os
import time
import urllib.error
import urllib.parse

import pytest

from dji_thermal_ui.analyzer import encryption, envfile, webodm
from dji_thermal_ui.analyzer.models import EncryptionKey

URL = "http://127.0.0.1:8001"
SETTINGS = "/api/settings/webodm"
CHECK = "/api/settings/webodm/check"
PASSWORD = "s3cret pass#'word\""
NODES = [{'id': 1, 'label': "node-odx-1", 'hostname': "node-odx-1", 'port': 3000, 'online': True},
         {'id': 2, 'label': "", 'hostname': "spare", 'port': 3001, 'online': False}]
POSIX = os.name != "nt"


def jwt(exp):
    payload = base64.urlsafe_b64encode(json.dumps({'exp': exp, 'username': "admin"}).encode()).decode().rstrip("=")
    return "eyJhbGciOiJIUzI1NiJ9." + payload + ".sig"


@pytest.fixture
def env_file(settings, tmp_path):
    path = tmp_path / ".env"
    settings.ENV_FILES = [path]
    return path


@pytest.fixture
def server(monkeypatch):
    """A WebODM taking admin and PASSWORD, its answers changed through the dict; the calls are kept"""
    fake = {'calls': [], 'logins': 0, 'token': jwt(time.time() + 6 * 3600), 'refuse': set(), 'down': False,
            'redirect': None, 'routes': {'GET /api/processingnodes/': (200, NODES)}}

    class Answer(io.BytesIO):
        status = 200

    def open_(req, timeout):
        method, url = req.get_method(), req.full_url
        path = url[len(URL):] if url.startswith(URL) else url
        fake['calls'].append((method, path, req.get_header('Authorization'), timeout))
        if fake['down']:
            raise urllib.error.URLError(ConnectionRefusedError(111, "Connection refused"))
        if fake['redirect']:
            raise urllib.error.HTTPError(url, 302, "Found", {'Location': fake['redirect']}, io.BytesIO())
        if path == "/api/token-auth/":
            form = dict(urllib.parse.parse_qsl(req.data.decode()))
            if form != {'username': "admin", 'password': PASSWORD}:
                raise urllib.error.HTTPError(url, 400, "Bad", {}, io.BytesIO(
                    b'{"non_field_errors":["Unable to log in with provided credentials."]}'))
            fake['logins'] += 1
            return Answer(json.dumps({'token': fake['token']}).encode())
        if req.get_header('Authorization') != "JWT " + fake['token'] or path in fake['refuse']:
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, io.BytesIO(b'{"detail":"Not allowed."}'))
        code, data = fake['routes'].get(method + " " + path, (404, {'detail': "Not found."}))
        if code != 200:
            raise urllib.error.HTTPError(url, code, "No", {}, io.BytesIO(json.dumps(data).encode()))
        return Answer(json.dumps(data).encode())

    monkeypatch.setattr(webodm._opener, 'open', open_)
    webodm._tokens.clear()
    yield fake
    webodm._tokens.clear()


def saved(path):
    """The password as the .env file keeps it"""
    return envfile.file_value(path, 'WEBODM_PASSWORD')


def save(api, url=URL, username="admin", password=PASSWORD):
    return api.put(SETTINGS, {'url': url, 'username': username, 'password': password}, format='json')


def test_a_login_webodm_takes_is_written_to_dotenv_and_shown_masked_without_the_password(api, env_file, server):
    assert api.get(SETTINGS).data == {'url': None, 'username': None, 'password': False, 'unreadable': False,
                                      'source': None, 'configured': False, 'file': str(env_file)}
    res = save(api, url=URL + "/")
    assert res.status_code == 200
    assert res.data == {'url': URL, 'username': "a…", 'password': True, 'unreadable': False,
                        'source': str(env_file), 'configured': True, 'file': str(env_file),
                        'nodes': [{'id': 1, 'label': "node-odx-1", 'online': True},
                                  {'id': 2, 'label': "spare:3001", 'online': False}]}
    assert PASSWORD not in res.content.decode() and "admin" not in res.content.decode()
    assert PASSWORD not in api.get(SETTINGS).content.decode()
    assert env_file.read_text() == "WEBODM_URL=%s\nWEBODM_USERNAME=admin\nWEBODM_PASSWORD=%s\n" % (URL, saved(env_file))
    assert not POSIX or env_file.stat().st_mode & 0o777 == 0o600
    assert webodm.config() == {'url': URL, 'username': "admin", 'password': PASSWORD, 'unreadable': False,
                               'source': str(env_file)}


def test_an_empty_user_name_or_password_keeps_the_one_saved(api, env_file, server):
    env_file.write_text("OTHER=1\nWEBODM_URL=http://old:8000\nWEBODM_USERNAME=admin\nWEBODM_PASSWORD='%s'\n" % PASSWORD)
    assert save(api, username="", password="").status_code == 200
    assert env_file.read_text() == "OTHER=1\nWEBODM_URL=%s\nWEBODM_USERNAME=admin\nWEBODM_PASSWORD=%s\n" % (
        URL, saved(env_file))
    assert encryption.decrypt(saved(env_file)) == PASSWORD


@pytest.mark.parametrize("url, message", [
    ("", "Type WebODM's address"),
    (None, "Type WebODM's address"),
    ("127.0.0.1:8001", "WebODM's address starts with http:// or https://, then its host"),
    ("ftp://host", "WebODM's address starts with http:// or https://, then its host"),
    ("http://admin:pw@host", "Put the user name and password in their own fields, not in the address"),
    ("http://host/?a=1", "WebODM's address has no ? or # part"),
    ("http://host:port", "That address's port is not a number"),
    ("http://" + "h" * 2050, "That address is too long"),
])
def test_an_address_that_is_not_one_is_refused_before_webodm_is_asked(api, env_file, server, url, message):
    res = save(api, url=url)
    assert (res.status_code, str(res.data['url'])) == (400, message)
    assert server['calls'] == [] and not env_file.exists()


def test_a_missing_login_or_one_with_a_line_break_is_refused(api, env_file, server):
    assert str(save(api, username="").data['username']) == "Type the WebODM account's user name"
    assert str(save(api, password="").data['password']) == "Type the WebODM account's password"
    assert str(save(api, password="a\nb").data['password']) == "A password here cannot hold a line break"
    assert server['calls'] == [] and not env_file.exists()


@pytest.mark.parametrize("change, message", [
    ({'password': "wrong"}, "WebODM refused the user name and password"),
    ({'down': True}, "WebODM could not be reached at http://127.0.0.1:8001 ([Errno 111] Connection refused): is it "
                     "running?"),
    ({'redirect': "https://webodm.example/"}, "WebODM's address sends to https://webodm.example/ instead: use that "
                                              "address"),
    ({'route': (404, {})}, "That address has no WebODM login (/api/token-auth/): is it WebODM's?"),
    ({'refuse': True}, "WebODM refused: the account lacks a permission this needs (see System Settings › WebODM): "
                       "Not allowed."),
])
def test_a_login_webodm_refuses_or_cannot_check_leaves_the_dotenv_as_it_was(api, env_file, server, monkeypatch,
                                                                           change, message):
    env_file.write_text("WEBODM_URL=http://old:8000\n")
    server['down'] = change.get('down', False)
    server['redirect'] = change.get('redirect')
    if change.get('refuse'):
        server['refuse'].add("/api/processingnodes/")
    if 'route' in change:
        def no_login(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 404, "No", {}, io.BytesIO(b"<html></html>"))
        monkeypatch.setattr(webodm._opener, 'open', no_login)
    res = save(api, password=change.get('password', PASSWORD))
    assert (res.status_code, str(res.data['error'])) == (400, message)
    assert env_file.read_text() == "WEBODM_URL=http://old:8000\n"


def test_remove_takes_the_login_out_of_the_dotenv_keeping_the_other_lines(api, env_file, server):
    env_file.write_text("MAPBOX_API_TOKEN=pk.a.b\nWEBODM_URL=%s\nWEBODM_USERNAME=admin\nWEBODM_PASSWORD=x\n" % URL)
    res = api.delete(SETTINGS)
    assert res.status_code == 200 and res.data['configured'] is False
    assert env_file.read_text() == "MAPBOX_API_TOKEN=pk.a.b\n"
    save(api)
    assert EncryptionKey.objects.count() == 1
    api.delete(SETTINGS)
    assert EncryptionKey.objects.count() == 0


def test_the_password_is_written_encrypted_differently_each_time_and_its_key_is_kept_in_the_database(api, env_file,
                                                                                                     server):
    save(api)
    first = saved(env_file)
    save(api)
    second = saved(env_file)
    assert first.startswith("enc:") and second.startswith("enc:") and first != second
    assert PASSWORD not in env_file.read_text() and "pass" not in env_file.read_text()
    assert EncryptionKey.objects.count() == 1
    assert EncryptionKey.objects.get().key not in env_file.read_text()
    assert encryption.decrypt(first) == encryption.decrypt(second) == PASSWORD


def test_a_password_the_key_cannot_open_is_said_so_and_typing_it_again_saves_it(api, env_file, server):
    save(api)
    EncryptionKey.objects.all().delete()        # the .env file with another database
    server['calls'].clear()
    assert api.get(SETTINGS).data == {'url': URL, 'username': "a…", 'password': False, 'unreadable': True,
                                      'source': str(env_file), 'configured': False, 'file': str(env_file)}
    res = api.post(CHECK)
    assert res.status_code == 400 and res.data['error'] == webodm.UNREADABLE
    res = save(api, password="")
    assert res.status_code == 400 and res.data['password'] == webodm.UNREADABLE
    assert server['calls'] == []
    assert save(api).data['configured'] is True
    assert webodm.config()['password'] == PASSWORD


def test_a_changed_encrypted_password_cannot_be_read(api, env_file, server):
    save(api)
    value = saved(env_file)
    envfile.write({'WEBODM_PASSWORD': value[:-6] + ("AAAAAA" if not value.endswith("AAAAAA") else "BBBBBB")})
    assert webodm.config()['unreadable'] is True and webodm.config()['password'] is None


def test_a_password_kept_as_typed_in_any_dotenv_is_encrypted_in_place_and_an_encrypted_one_left(db, settings, tmp_path,
                                                                                               monkeypatch):
    first, second, third = tmp_path / "a.env", tmp_path / "b.env", tmp_path / "c.env"
    settings.ENV_FILES = [first, second, third]
    first.write_text("A=1\nWEBODM_PASSWORD='%s'\nB=2\n" % PASSWORD)
    second.write_text("WEBODM_PASSWORD=plain\n")
    if POSIX:
        second.chmod(0o640)
    third.write_text("MAPBOX_API_TOKEN=pk.a.b\n")
    assert webodm.encrypt_saved_password() == [str(first), str(second)]
    assert first.read_text() == "A=1\nWEBODM_PASSWORD=%s\nB=2\n" % saved(first)
    assert encryption.decrypt(saved(first)) == PASSWORD and encryption.decrypt(saved(second)) == "plain"
    assert not POSIX or second.stat().st_mode & 0o777 == 0o640
    assert third.read_text() == "MAPBOX_API_TOKEN=pk.a.b\n"
    before = first.read_text()
    assert webodm.encrypt_saved_password() == [] and first.read_text() == before
    monkeypatch.setenv("WEBODM_PASSWORD", "from-the-environment")
    assert webodm.config()['password'] == "from-the-environment"


def test_a_login_in_the_environment_is_shown_and_cannot_be_changed_here(api, env_file, server, monkeypatch):
    env_file.write_text("WEBODM_USERNAME=admin\nWEBODM_PASSWORD=x\n")
    monkeypatch.setenv("WEBODM_URL", URL)
    assert api.get(SETTINGS).data == {'url': URL, 'username': "a…", 'password': True, 'unreadable': False,
                                      'source': 'environment', 'configured': True, 'file': None}
    assert save(api).status_code == 409
    res = api.delete(SETTINGS)
    assert res.status_code == 409 and "set in the environment" in res.data['error']
    assert server['calls'] == [] and env_file.read_text() == "WEBODM_USERNAME=admin\nWEBODM_PASSWORD=x\n"


def test_the_check_logs_in_with_the_saved_login_and_lists_the_nodes_the_account_sees(api, env_file, server):
    res = api.post(CHECK)
    assert res.status_code == 400 and "WebODM is not set up" in res.data['error']
    envfile.write({'WEBODM_URL': URL, 'WEBODM_USERNAME': "admin", 'WEBODM_PASSWORD': PASSWORD})
    res = api.post(CHECK)
    assert res.status_code == 200 and [n['label'] for n in res.data['nodes']] == ["node-odx-1", "spare:3001"]


def test_the_client_keeps_its_token_and_logs_in_again_once_when_it_is_refused_or_expiring(server):
    client = webodm.Client(URL, "admin", PASSWORD)
    client.request('GET', '/api/processingnodes/')
    client.request('GET', '/api/processingnodes/')
    assert server['logins'] == 1
    assert [c[:2] for c in server['calls']] == [("POST", "/api/token-auth/")] + [("GET", "/api/processingnodes/")] * 2
    assert {c[3] for c in server['calls']} == {webodm.TIMEOUT}

    # WebODM no longer takes the token (another secret, a restart): a new one, once
    server['token'] = jwt(time.time() + 6 * 3600)
    assert client.nodes()[0]['label'] == "node-odx-1"
    assert server['logins'] == 2
    # A refusal with a new token is the account's permissions, not the token
    server['refuse'].add("/api/processingnodes/")
    with pytest.raises(webodm.WebODMError, match="lacks a permission"):
        client.nodes()
    assert server['logins'] == 3
    server['refuse'].clear()

    # A token about to expire is asked for again before it is used
    server['token'] = jwt(time.time() + 60)
    webodm._tokens.clear()
    client.nodes()
    client.nodes()
    assert server['logins'] == 5


def test_an_answer_that_is_not_webodms_is_said_so(server):
    server['routes']['GET /api/processingnodes/'] = (200, {'not': "a list"})
    with pytest.raises(webodm.WebODMError, match="not as WebODM does"):
        webodm.Client(URL, "admin", PASSWORD).nodes()


@pytest.mark.parametrize("value", ["plain-value_1.2:/@+=~%", "with space", "has#hash", "it's", "both ' and \"", " edge "])
def test_a_dotenv_value_reads_back_as_it_was_written(settings, tmp_path, value):
    path = tmp_path / ".env"
    settings.ENV_FILES = [path]
    envfile.write({'NAME': value})
    assert envfile.file_value(path, 'NAME') == value


def test_a_dotenv_left_as_it_was_is_not_written(settings, tmp_path):
    path = tmp_path / ".env"
    path.write_text("A=1\n")
    before = path.stat().st_mtime_ns
    time.sleep(0.01)
    envfile.write({'B': None}, str(path))
    assert path.stat().st_mtime_ns == before
    envfile.write({'B': None}, str(tmp_path / "missing.env"))
    assert not (tmp_path / "missing.env").exists()
