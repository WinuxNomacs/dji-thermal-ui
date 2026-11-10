"""The basemaps the map pages offer, and the Mapbox token: MAPBOX_API_TOKEN from the environment, else from a .env
file, where System Settings writes it once Mapbox has accepted it; only a public token is taken"""

import io
import json
import os
import re
import urllib.error

import pytest
from django.test import Client

from dji_thermal_ui.analyzer import basemaps
from dji_thermal_ui.analyzer.models import Preferences, ThermalConversion
from tests.fakes import PREFERENCES, dataset

TOKEN = "pk.eyJ1IjoidGVzdCJ9.abc_DEF-123"
ENV_TOKEN = "pk.eyJ1IjoiZW52In0.xyz"
MAPBOX = "/api/settings/mapbox"
# Windows keeps no Unix file modes
POSIX = os.name != "nt"


@pytest.fixture
def env_file(settings, tmp_path):
    """A .env file the token is looked for in, and nothing in the environment"""
    path = tmp_path / ".env"
    settings.ENV_FILES = [path]
    return path


def page_basemaps(conversion_id, page=""):
    html = Client().get("/conversion/%d%s" % (conversion_id, page)).content.decode()
    return json.loads(re.search(r'<script id="ta-basemaps" type="application/json">(.*?)</script>', html).group(1))


@pytest.fixture
def mapbox(monkeypatch):
    """Mapbox, answering with the status set (200 by default), or not at all (None); the URLs asked for are kept"""
    answer = {'status': 200, 'asked': []}

    def urlopen(url, timeout):
        answer['asked'].append((url, timeout))
        if answer['status'] is None:
            raise urllib.error.URLError("no connection")
        if answer['status'] != 200:
            raise urllib.error.HTTPError(url, answer['status'], "refused", {}, io.BytesIO())
        return io.BytesIO(b"tile")

    monkeypatch.setattr(basemaps.urllib.request, 'urlopen', urlopen)
    return answer


def test_a_token_mapbox_accepts_is_written_to_the_data_folders_dotenv_then_replaced(api, env_file, mapbox):
    assert api.get(MAPBOX).data == {'token': None, 'token_source': None, 'file': str(env_file)}
    res = api.put(MAPBOX, {'token': " " + TOKEN + " "}, format='json')
    assert res.status_code == 200
    assert res.data == {'token': TOKEN, 'token_source': str(env_file), 'file': str(env_file)}
    assert mapbox['asked'] == [("https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/0/0/0?access_token="
                                + TOKEN, 10)]
    assert env_file.read_text() == "MAPBOX_API_TOKEN=" + TOKEN + "\n"
    assert not POSIX or env_file.stat().st_mode & 0o777 == 0o600

    other = TOKEN.replace("abc", "zzz")
    assert api.put(MAPBOX, {'token': other}, format='json').data['token'] == other
    assert env_file.read_text() == "MAPBOX_API_TOKEN=" + other + "\n"
    # The token is no preference
    assert 'mapbox_token' not in Preferences.load().data


def test_the_token_replaces_the_one_in_the_dotenv_it_was_read_from_keeping_the_other_lines(api, env_file, mapbox,
                                                                                            settings, tmp_path):
    started = tmp_path / "started.env"
    started.write_text("# keys\nOTHER=1\nexport MAPBOX_API_TOKEN = '%s'\nLAST=2\n" % ENV_TOKEN)
    started.chmod(0o640)
    settings.ENV_FILES = [started, env_file]
    assert api.get(MAPBOX).data == {'token': ENV_TOKEN, 'token_source': str(started), 'file': str(started)}
    assert api.put(MAPBOX, {'token': TOKEN}, format='json').status_code == 200
    assert started.read_text() == "# keys\nOTHER=1\nMAPBOX_API_TOKEN=%s\nLAST=2\n" % TOKEN
    assert not POSIX or started.stat().st_mode & 0o777 == 0o640
    assert not env_file.exists()


@pytest.mark.parametrize("token, message", [
    ("", "Paste the token"),
    ("   ", "Paste the token"),
    (12, "Paste the token"),
    (None, "Paste the token"),
    ("pk." + "a" * 600 + ".b", "That is longer than a Mapbox token"),
    ("sk.eyJ1IjoidGVzdCJ9.abc", "That is a secret token: use a public one (it starts with pk.)"),
    ("eyJ1IjoidGVzdCJ9.abc", "A Mapbox public token starts with pk. and has no spaces"),
    ("pk.eyJ1 IjoidGVzdCJ9.abc", "A Mapbox public token starts with pk. and has no spaces"),
])
def test_an_empty_overlong_secret_or_malformed_token_is_refused_before_mapbox_is_asked(api, env_file, mapbox, token,
                                                                                         message):
    res = api.put(MAPBOX, {'token': token}, format='json')
    assert (res.status_code, str(res.data['token'])) == (400, message)
    assert mapbox['asked'] == [] and not env_file.exists()


@pytest.mark.parametrize("answer, message", [
    (401, "Mapbox refused the token: check that it was copied whole"),
    (403, "Mapbox refused the token (its URL restrictions, or the account)"),
    (429, "The Mapbox account's limit is reached for now: try again later"),
    (500, "Mapbox answered 500: try again later"),
    (None, "Mapbox could not be reached: is this computer online?"),
])
def test_a_token_mapbox_refuses_or_cannot_check_leaves_the_dotenv_as_it_was(api, env_file, mapbox, answer, message):
    env_file.write_text("MAPBOX_API_TOKEN=%s\n" % ENV_TOKEN)
    mapbox['status'] = answer
    res = api.put(MAPBOX, {'token': TOKEN}, format='json')
    assert (res.status_code, str(res.data['token'])) == (400, message)
    assert env_file.read_text() == "MAPBOX_API_TOKEN=%s\n" % ENV_TOKEN


def test_the_environments_token_wins_over_the_files_and_cannot_be_changed_here(api, env_file, mapbox, monkeypatch):
    env_file.write_text("MAPBOX_API_TOKEN=%s\n" % TOKEN)
    monkeypatch.setenv("MAPBOX_API_TOKEN", ENV_TOKEN)
    assert api.get(MAPBOX).data == {'token': ENV_TOKEN, 'token_source': 'environment', 'file': None}
    res = api.put(MAPBOX, {'token': TOKEN.replace("abc", "zzz")}, format='json')
    assert res.status_code == 409 and "set in the environment" in str(res.data['token'])
    assert mapbox['asked'] == [] and env_file.read_text() == "MAPBOX_API_TOKEN=%s\n" % TOKEN


def test_a_token_saved_in_the_preferences_is_moved_to_the_dotenv_unless_one_is_known(db, env_file, monkeypatch):
    def saved(token):
        prefs = Preferences.load()
        prefs.data['mapbox_token'] = token
        prefs.save()

    basemaps.move_saved_token()     # nothing saved: nothing written
    assert not env_file.exists()
    saved(TOKEN)
    basemaps.move_saved_token()
    assert env_file.read_text() == "MAPBOX_API_TOKEN=%s\n" % TOKEN
    assert 'mapbox_token' not in Preferences.load().data
    # One known already is kept, and the saved one forgotten
    saved(ENV_TOKEN)
    basemaps.move_saved_token()
    assert env_file.read_text() == "MAPBOX_API_TOKEN=%s\n" % TOKEN
    monkeypatch.setenv("MAPBOX_API_TOKEN", ENV_TOKEN)
    saved(TOKEN.replace("abc", "zzz"))
    basemaps.move_saved_token()
    assert env_file.read_text() == "MAPBOX_API_TOKEN=%s\n" % TOKEN
    assert 'mapbox_token' not in Preferences.load().data


def test_preferences_take_no_token(api, env_file):
    res = api.put(PREFERENCES, {'mapbox_token': TOKEN, 'basemap': "osm"}, format='json')
    assert res.data == {'basemap': "osm"}
    assert basemaps.mapbox_token() == (None, None)


def test_the_token_is_read_from_a_dotenv_file_when_the_environment_has_none(db, env_file, settings, tmp_path):
    env_file.write_text("# keys\nOTHER=1\nexport MAPBOX_API_TOKEN = '%s'\n" % ENV_TOKEN)
    assert basemaps.mapbox_token() == (ENV_TOKEN, str(env_file))
    env_file.write_text("MAPBOX_API_TOKEN=%s # mine\n" % ENV_TOKEN)
    assert basemaps.env_token() == ENV_TOKEN
    env_file.write_text('MAPBOX_API_TOKEN=""\n')
    assert basemaps.env_token() is None
    # The first file that has it: the folder started from, then the data folder
    second = tmp_path / "data.env"
    second.write_text("MAPBOX_API_TOKEN=%s\n" % TOKEN)
    settings.ENV_FILES = [tmp_path / "missing.env", env_file, second]
    assert basemaps.env_token() == TOKEN


def test_the_map_pages_get_the_basemaps_with_mapbox_and_its_token(api, env_file):
    c = ThermalConversion.objects.create(dataset=dataset(), name="C", options={})
    for page in ("", "/compare"):
        listed = page_basemaps(c.id, page)
        assert [b['label'] for b in listed] == ["ESRI Satellite", "OpenStreetMap", "Mapbox Satellite"]
        assert listed[0]['tilemap'].endswith("/World_Imagery/MapServer/tilemap")
        mapbox = listed[-1]
        assert (mapbox['type'], mapbox['token']) == ("mapbox", None)
        assert mapbox['logo'] == "/static/vendor/mapbox/mapbox-logo.svg"
    env_file.write_text("MAPBOX_API_TOKEN=%s\n" % TOKEN)
    assert page_basemaps(c.id)[-1]['token'] == TOKEN


@pytest.mark.django_db
def test_the_pages_let_the_browser_send_the_referer_openstreetmap_requires():
    assert Client().get("/").headers['Referrer-Policy'] == "strict-origin-when-cross-origin"


def test_openstreetmap_is_credited_to_its_contributors_and_the_credit_stays_open(settings):
    osm = next(bm for bm in settings.BASEMAPS if bm['key'] == "osm")
    assert "OpenStreetMap</a> contributors" in osm['attribution']
    assert osm['attribution_open'] is True
    assert osm['url'] == "https://tile.openstreetmap.org/{z}/{x}/{y}.png"


def test_the_preferred_basemap_is_saved_offered_and_another_value_refused(api, env_file):
    got = api.get(PREFERENCES).data
    assert got['basemap'] == "esri"
    assert got['basemaps'] == [{'key': "esri", 'label': "ESRI Satellite"}, {'key': "osm", 'label': "OpenStreetMap"},
                               {'key': "none", 'label': "None"}]
    assert api.put(PREFERENCES, {'basemap': "osm"}, format='json').data == {'basemap': "osm"}
    assert api.get(PREFERENCES).data['basemap'] == "osm"
    for bad in ("google", "", None, 3):
        res = api.put(PREFERENCES, {'basemap': bad}, format='json')
        assert res.status_code == 400 and 'basemap' in res.data
    assert api.get(PREFERENCES).data['basemap'] == "osm"
    # Mapbox is offered once it has a token, and can be preferred without one
    assert api.put(PREFERENCES, {'basemap': "mapbox"}, format='json').status_code == 200
    env_file.write_text("MAPBOX_API_TOKEN=%s\n" % TOKEN)
    assert [b['key'] for b in api.get(PREFERENCES).data['basemaps']] == ["esri", "osm", "mapbox", "none"]


@pytest.mark.parametrize("preferred, default", [
    ("osm", "OpenStreetMap"), ("none", None), ("mapbox", "Mapbox Satellite"), ("esri", "ESRI Satellite")])
def test_the_map_pages_start_with_the_preferred_basemap_and_fall_back_to_esri(api, env_file, preferred, default):
    c = ThermalConversion.objects.create(dataset=dataset(), name="C", options={})
    env_file.write_text("MAPBOX_API_TOKEN=%s\n" % TOKEN)
    api.put(PREFERENCES, {'basemap': preferred}, format='json')
    listed = page_basemaps(c.id)
    assert [b['label'] for b in listed if b.get('default')] == ([default] if default else [])
    assert [b['label'] for b in listed if b.get('fallback')] == ["ESRI Satellite"]


def test_a_preferred_mapbox_without_a_token_leaves_esri_the_default(api, env_file):
    c = ThermalConversion.objects.create(dataset=dataset(), name="C", options={})
    api.put(PREFERENCES, {'basemap': "mapbox"}, format='json')
    assert [b['label'] for b in page_basemaps(c.id) if b.get('default')] == ["ESRI Satellite"]


def test_the_mapbox_wordmark_is_served_with_its_licence(db):
    client = Client()
    for name, text in (("mapbox-logo.svg", b"<svg"), ("LICENSE.txt", b"Copyright (c) 2020, Mapbox")):
        res = client.get("/static/vendor/mapbox/" + name)
        assert res.status_code == 200 and text in b"".join(res.streaming_content)
        res.close()
