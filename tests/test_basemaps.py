"""The basemaps the map pages offer, and the Mapbox token: saved in the app, else MAPBOX_API_TOKEN from the environment
or a .env file; only a public token is taken"""

import json
import re

import pytest
from django.test import Client

from dji_thermal_ui.analyzer import basemaps
from dji_thermal_ui.analyzer.models import ThermalConversion
from tests.fakes import PREFERENCES, dataset

TOKEN = "pk.eyJ1IjoidGVzdCJ9.abc_DEF-123"
ENV_TOKEN = "pk.eyJ1IjoiZW52In0.xyz"


@pytest.fixture
def env_file(settings, tmp_path):
    """A .env file the token is looked for in, and nothing in the environment"""
    path = tmp_path / ".env"
    settings.MAPBOX_ENV_FILES = [path]
    return path


def page_basemaps(conversion_id, page=""):
    html = Client().get("/conversion/%d%s" % (conversion_id, page)).content.decode()
    return json.loads(re.search(r'<script id="ta-basemaps" type="application/json">(.*?)</script>', html).group(1))


def test_a_public_token_is_saved_changed_and_forgotten(api, env_file):
    res = api.put(PREFERENCES, {'mapbox_token': " " + TOKEN + " "}, format='json')
    assert res.status_code == 200
    assert res.data == {'mapbox': {'token': TOKEN, 'token_source': 'saved', 'env_token': False}}
    assert basemaps.mapbox_token() == (TOKEN, 'saved')

    other = TOKEN.replace("abc", "zzz")
    assert api.put(PREFERENCES, {'mapbox_token': other}, format='json').data['mapbox']['token'] == other

    res = api.put(PREFERENCES, {'mapbox_token': None}, format='json')
    assert res.data == {'mapbox': {'token': None, 'token_source': None, 'env_token': False}}
    assert basemaps.mapbox_token() == (None, None)
    # Saving the token leaves the conversion settings unsaved
    assert not api.get(PREFERENCES).data['saved']


@pytest.mark.parametrize("token, message", [
    ("", "Paste the token"),
    ("   ", "Paste the token"),
    (12, "Paste the token"),
    ("pk." + "a" * 600 + ".b", "That is longer than a Mapbox token"),
    ("sk.eyJ1IjoidGVzdCJ9.abc", "That is a secret token: use a public one (it starts with pk.)"),
    ("eyJ1IjoidGVzdCJ9.abc", "A Mapbox public token starts with pk. and has no spaces"),
    ("pk.eyJ1 IjoidGVzdCJ9.abc", "A Mapbox public token starts with pk. and has no spaces"),
])
def test_an_empty_overlong_secret_or_malformed_token_is_refused(api, env_file, token, message):
    res = api.put(PREFERENCES, {'mapbox_token': token}, format='json')
    assert (res.status_code, str(res.data['mapbox_token'])) == (400, message)
    assert basemaps.mapbox_token() == (None, None)


def test_the_environment_token_is_used_until_one_is_saved_and_again_once_it_is_forgotten(api, env_file, monkeypatch):
    monkeypatch.setenv("MAPBOX_API_TOKEN", ENV_TOKEN)
    assert basemaps.mapbox_token() == (ENV_TOKEN, 'env')
    res = api.put(PREFERENCES, {'mapbox_token': TOKEN}, format='json')
    assert res.data['mapbox'] == {'token': TOKEN, 'token_source': 'saved', 'env_token': True}
    res = api.put(PREFERENCES, {'mapbox_token': None}, format='json')
    assert res.data['mapbox'] == {'token': ENV_TOKEN, 'token_source': 'env', 'env_token': True}


def test_the_token_is_read_from_a_dotenv_file_when_the_environment_has_none(db, env_file, settings, tmp_path):
    env_file.write_text("# keys\nOTHER=1\nexport MAPBOX_API_TOKEN = '%s'\n" % ENV_TOKEN)
    assert basemaps.mapbox_token() == (ENV_TOKEN, 'env')
    env_file.write_text("MAPBOX_API_TOKEN=%s # mine\n" % ENV_TOKEN)
    assert basemaps.env_token() == ENV_TOKEN
    env_file.write_text('MAPBOX_API_TOKEN=""\n')
    assert basemaps.env_token() is None
    # The first file that has it: the folder started from, then the data folder
    second = tmp_path / "data.env"
    second.write_text("MAPBOX_API_TOKEN=%s\n" % TOKEN)
    settings.MAPBOX_ENV_FILES = [tmp_path / "missing.env", env_file, second]
    assert basemaps.env_token() == TOKEN


def test_the_map_pages_get_the_basemaps_with_mapbox_and_its_token(api, env_file):
    c = ThermalConversion.objects.create(dataset=dataset(), name="C", options={})
    for page in ("", "/compare"):
        listed = page_basemaps(c.id, page)
        assert [b['label'] for b in listed] == ["ESRI Satellite", "OpenStreetMap", "Mapbox Satellite"]
        assert listed[0]['tilemap'].endswith("/World_Imagery/MapServer/tilemap")
        mapbox = listed[-1]
        assert (mapbox['type'], mapbox['token'], mapbox['token_source']) == ("mapbox", None, None)
        assert mapbox['logo'] == "/static/vendor/mapbox/mapbox-logo.svg"
    api.put(PREFERENCES, {'mapbox_token': TOKEN}, format='json')
    assert page_basemaps(c.id)[-1]['token'] == TOKEN


def test_the_mapbox_wordmark_is_served_with_its_licence(db):
    client = Client()
    for name, text in (("mapbox-logo.svg", b"<svg"), ("LICENSE.txt", b"Copyright (c) 2020, Mapbox")):
        res = client.get("/static/vendor/mapbox/" + name)
        assert res.status_code == 200 and text in b"".join(res.streaming_content)
        res.close()
