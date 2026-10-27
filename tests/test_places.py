"""A project's location found by name or named from a point, through OpenStreetMap's Nominatim (a fake one here): the
app's user agent, one request a second, the browser's language, and what is answered when Nominatim fails"""

import io
import json
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

import pytest

from dji_thermal_ui.analyzer import places

PLACES = "/api/places"
FARM = {'lon': "-88.0701", 'lat': "42.1002", 'display_name': "1 Farm Road, Elgin, Illinois, United States",
        'name': "", 'category': "place", 'type': "house"}


class Nominatim:
    """Answers each request with the next answer (JSON, or an exception raised), and keeps the requests"""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests = []

    def __call__(self, req, timeout):
        self.requests.append(req)
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return io.BytesIO(a if isinstance(a, bytes) else json.dumps(a).encode())

    def query(self, i=-1):
        url = urlsplit(self.requests[i].full_url)
        return url.path, {k: v[0] for k, v in parse_qs(url.query).items()}


@pytest.fixture
def nominatim(monkeypatch, settings):
    settings.NOMINATIM_URL = "https://nominatim.example/"
    monkeypatch.setattr(places, "_last", 0.0)
    fake = Nominatim()
    monkeypatch.setattr(places, "urlopen", fake)
    return fake


def test_a_search_answers_the_places_named_with_the_service_to_credit(api, nominatim):
    nominatim.answers = [[FARM, {'lon': "1", 'lat': "2"}, {'lat': "nowhere"}]]
    res = api.get(PLACES, {'q': " 1 Farm Rd "}, HTTP_ACCEPT_LANGUAGE="fr-CA,fr;q=0.9")
    assert res.status_code == 200
    assert res.data['places'] == [{'lon': -88.0701, 'lat': 42.1002, 'label': FARM['display_name']},
                                  {'lon': 1.0, 'lat': 2.0, 'label': ""}]
    assert res.data['service'] == "OpenStreetMap Nominatim"
    assert res.data['attribution'] == "© OpenStreetMap contributors"
    path, query = nominatim.query()
    assert path == "/search"
    assert query == {'q': "1 Farm Rd", 'format': "jsonv2", 'limit': "8", 'accept-language': "fr-CA,fr;q=0.9"}
    assert nominatim.requests[0].get_header('User-agent').startswith("dji-thermal-ui/")


def test_a_point_is_named_by_its_address_and_kept_where_it_was_clicked(api, nominatim):
    nominatim.answers = [FARM, {'error': "Unable to geocode"}]
    res = api.get(PLACES, {'lon': "-88.07", 'lat': "42.1"})
    assert res.data['places'] == [{'lon': -88.07, 'lat': 42.1, 'label': FARM['display_name']}]
    path, query = nominatim.query()
    assert path == "/reverse" and (query['lon'], query['lat'], query['zoom']) == ("-88.07", "42.1", "18")
    # The middle of the sea
    assert api.get(PLACES, {'lon': "-40", 'lat': "30"}).data['places'] == []


@pytest.mark.parametrize("params, field, message", [
    ({'q': "  "}, 'q', "Type an address or a place to search for"),
    ({'q': "x" * 201}, 'q', "That is longer than 200 characters"),
    ({'lon': "x", 'lat': "1"}, 'location', "A location is a point (lon, lat) with its label"),
    ({}, 'location', "A location is a point (lon, lat) with its label"),
    ({'lon': "0", 'lat': "91"}, 'location', "That point is not on the Earth (lon -180 to 180, lat -90 to 90)"),
])
def test_a_search_or_point_that_cannot_be_asked_is_refused_without_asking(api, nominatim, params, field, message):
    res = api.get(PLACES, params)
    assert (res.status_code, str(res.data[field])) == (400, message)
    assert nominatim.requests == []


@pytest.mark.parametrize("answer, message", [
    (HTTPError("u", 429, "Too Many Requests", {}, None), "OpenStreetMap Nominatim refused the search (429)"),
    (URLError("no network"), "OpenStreetMap Nominatim could not be reached: is the computer online?"),
    (TimeoutError(), "OpenStreetMap Nominatim could not be reached: is the computer online?"),
    (b"<html>busy</html>", "OpenStreetMap Nominatim did not answer with places"),
    ({'not': "a list"}, "OpenStreetMap Nominatim did not answer with places"),
])
def test_a_failed_search_says_why_as_a_bad_gateway(api, nominatim, answer, message):
    nominatim.answers = [answer]
    res = api.get(PLACES, {'q': "silos"})
    assert res.status_code == 502 and res.data['detail'] == message


def test_requests_are_a_second_apart_at_least(nominatim, monkeypatch):
    now = [100.0]
    slept = []
    monkeypatch.setattr(places.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(places.time, "sleep", lambda s: (slept.append(s), now.__setitem__(0, now[0] + s)))
    nominatim.answers = [[], [], []]
    places.search("a")
    now[0] += 0.25
    places.search("b")
    now[0] += 5
    places.search("c")
    assert slept == [0.75]
