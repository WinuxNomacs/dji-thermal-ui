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
ACCOUNT = "/api/settings/webodm/account"
PASSWORD = "s3cret pass#'word\""
NEW_PASSWORD = "the app's own: Xq7#pL2"
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
    """A WebODM taking admin and PASSWORD (a staff account), its answers changed through the dict; the calls are
    kept. Users added through its admin API log in with a token of their own"""
    fake = {'calls': [], 'logins': 0, 'token': jwt(time.time() + 6 * 3600), 'refuse': set(), 'down': False,
            'redirect': None, 'routes': {'GET /api/processingnodes/': (200, NODES)},
            'users': {'admin': PASSWORD}, 'staff': {'admin'}, 'created': []}

    def token_of(name):
        return fake['token'] if name == "admin" else "token-of-" + name

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
            if set(form) != {'username', 'password'} or fake['users'].get(form['username']) != form['password']:
                raise urllib.error.HTTPError(url, 400, "Bad", {}, io.BytesIO(
                    b'{"non_field_errors":["Unable to log in with provided credentials."]}'))
            fake['logins'] += 1
            return Answer(json.dumps({'token': token_of(form['username'])}).encode())
        caller = next((name for name in fake['users'] if req.get_header('Authorization') == "JWT " + token_of(name)),
                      None)
        if caller is None or path in fake['refuse']:
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, io.BytesIO(b'{"detail":"Not allowed."}'))
        if (method, path) == ("POST", "/api/admin/users/") and "POST /api/admin/users/" not in fake['routes']:
            if caller not in fake['staff']:
                raise urllib.error.HTTPError(url, 403, "Forbidden", {}, io.BytesIO(
                    b'{"detail":"You do not have permission to perform this action."}'))
            user = json.loads(req.data)
            fake['created'].append(user)
            if user['username'] in fake['users']:
                raise urllib.error.HTTPError(url, 400, "Bad", {}, io.BytesIO(
                    b'{"username":["A user with that username already exists."]}'))
            fake['users'][user['username']] = user['password']
            return Answer(json.dumps({'id': len(fake['users']), 'username': user['username']}).encode())
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


def create(api, **change):
    return api.post(ACCOUNT, dict({'url': URL, 'admin_username': "admin", 'admin_password': PASSWORD,
                                   'username': webodm.ACCOUNT_NAME, 'password': NEW_PASSWORD}, **change), format='json')


def test_creating_the_account_adds_only_its_name_and_password_and_saves_it_not_the_admin(api, env_file, server):
    env_file.write_text("OTHER=1\nWEBODM_URL=http://old:8000\nWEBODM_USERNAME=someone\n")
    res = create(api, url=URL + "/")
    assert res.status_code == 200
    assert server['created'] == [{'username': "dji-thermal-ui-api-user", 'password': NEW_PASSWORD}]
    assert res.data == {'url': URL, 'username': "d…", 'password': True, 'unreadable': False,
                        'source': str(env_file), 'configured': True, 'file': str(env_file),
                        'nodes': [{'id': 1, 'label': "node-odx-1", 'online': True},
                                  {'id': 2, 'label': "spare:3001", 'online': False}]}
    for secret in (PASSWORD, NEW_PASSWORD, "admin"):
        assert secret not in res.content.decode() and secret not in env_file.read_text()
    assert webodm.config()['username'] == "dji-thermal-ui-api-user"
    assert webodm.config()['password'] == NEW_PASSWORD
    assert env_file.read_text().startswith("OTHER=1\n")
    assert [key[1] for key in webodm._tokens] == ["dji-thermal-ui-api-user"]   # the admin's token is not kept


@pytest.mark.parametrize("change, message", [
    ({'admin_password': "wrong"}, "WebODM refused the admin's user name and password"),
    ({'staff': set()}, "WebODM refused: the admin account is not staff. Use one with Staff status (WebODM's "
                       "Administration › Users)"),
    ({'route': (404, {'detail': "Not found."})}, "This WebODM has no API for adding users (/api/admin/users/): set "
                                                 "the account up by hand, as below"),
    ({'route': (400, {'username': ["Enter a valid username."]})}, "WebODM did not create the account: Enter a valid "
                                                                  "username."),
    ({'route': (500, {})}, "WebODM answered 500: try again later"),
    ({'down': True}, "WebODM could not be reached at http://127.0.0.1:8001 ([Errno 111] Connection refused): is it "
                     "running?"),
    ({'refuse': True}, "WebODM created the account dji-thermal-ui-api-user, but the app could not log in as it: "
                       "WebODM refused: the account lacks a permission this needs (see System Settings › WebODM): "
                       "Not allowed."),
])
def test_an_account_webodm_does_not_create_leaves_the_dotenv_as_it_was(api, env_file, server, change, message):
    env_file.write_text("WEBODM_URL=http://old:8000\n")
    server['down'] = change.get('down', False)
    server['staff'] = change.get('staff', server['staff'])
    if 'route' in change:
        server['routes']["POST /api/admin/users/"] = change['route']
    if change.get('refuse'):
        server['refuse'].add("/api/processingnodes/")
    res = create(api, admin_password=change.get('admin_password', PASSWORD))
    assert (res.status_code, str(res.data['error'])) == (400, message)
    assert env_file.read_text() == "WEBODM_URL=http://old:8000\n"
    assert not webodm._tokens or all(key[1] != "admin" for key in webodm._tokens)


def test_a_name_already_taken_is_refused_and_that_account_is_left_as_it_was(api, env_file, server):
    server['users']["dji-thermal-ui-api-user"] = "its own"
    res = create(api)
    assert res.status_code == 400
    assert str(res.data['error']) == ("WebODM already has a user named dji-thermal-ui-api-user. Choose another name, "
                                      "or, to use that account, type its password in the login form: the app never "
                                      "changes an existing WebODM account")
    assert server['users']["dji-thermal-ui-api-user"] == "its own"
    assert [(m, p) for m, p, _, _ in server['calls'] if p.startswith("/api/admin/")] == [("POST", "/api/admin/users/")]
    assert not env_file.exists()


@pytest.mark.parametrize("change, key, message", [
    ({'url': "localhost:8000"}, 'url', "WebODM's address starts with http:// or https://, then its host"),
    ({'admin_username': " "}, 'admin_username', "Type the WebODM admin's user name"),
    ({'admin_password': ""}, 'admin_password', "Type the WebODM admin's password"),
    ({'username': None}, 'username', "Type the new account's user name"),
    ({'password': ""}, 'password', "Type the new account's password, or generate one"),
    ({'password': "a\nb"}, 'password', "A user name or password here cannot hold a line break"),
    ({'username': "dji thermal"}, 'username', "A WebODM user name is at most 150 letters, digits and @ . + - _"),
    ({'username': "u" * 151}, 'username', "A WebODM user name is at most 150 letters, digits and @ . + - _"),
])
def test_a_missing_or_unusable_field_is_refused_before_webodm_is_asked(api, env_file, server, change, key, message):
    res = create(api, **change)
    assert (res.status_code, str(res.data[key])) == (400, message)
    assert server['calls'] == []


def test_the_account_cannot_be_created_while_the_login_is_set_in_the_environment(api, env_file, server, monkeypatch):
    monkeypatch.setenv("WEBODM_URL", URL)
    res = create(api)
    assert res.status_code == 409 and "set in the environment" in res.data['error']
    assert server['calls'] == [] and not env_file.exists()


def test_the_client_keeps_its_token_and_logs_in_again_once_when_it_is_refused_or_expiring(server):
    client = webodm.Client(URL, "admin", PASSWORD)
    client.request('GET', '/api/processingnodes/')
    client.request('GET', '/api/processingnodes/')
    assert server['logins'] == 1
    assert [c[:2] for c in server['calls']] == [("POST", "/api/token-auth/")] + [("GET", "/api/processingnodes/")] * 2
    assert {c[3] for c in server['calls']} == {webodm.TIMEOUT}

    # WebODM no longer takes the token (another secret, a restart): a new one, once (a second later, as Windows'
    # clock may not have moved since the first)
    server['token'] = jwt(time.time() + 6 * 3600 + 1)
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
