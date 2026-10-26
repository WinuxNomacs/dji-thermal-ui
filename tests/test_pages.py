"""The app's pages: each is served with the CSRF cookie the scripts send back, and the scripts and styles they load are
served; an unknown id is a 404"""

import re

import pytest
from django.test import Client

from dji_thermal_ui.analyzer.models import ThermalConversion
from tests.fakes import PREFERENCES, dataset


@pytest.fixture
def client(db):
    return Client()


def conversion(d, name="Conversion 1"):
    return ThermalConversion.objects.create(dataset=d, name=name, options={})


def test_each_page_is_served_with_the_csrf_cookie(client):
    d = dataset()
    c = conversion(d)
    for url, page_id in [("/", "app"), ("/dataset/%d" % d.id, "ta-dataset"),
                         ("/conversion/%d" % c.id, "ta-viewer"), ("/conversion/%d/frame" % c.id, "ta-frame"),
                         ("/conversion/%d/compare" % c.id, "ta-compare")]:
        client.cookies.clear()
        res = client.get(url)
        assert res.status_code == 200, url
        assert 'csrftoken' in res.cookies, url
        html = res.content.decode()
        assert 'id="%s"' % page_id in html
        assert 'data-api="/api/"' in html and 'data-public="/"' in html
        assert "Thermal Analyzer" in html


def test_an_unknown_dataset_or_conversion_is_a_404(client):
    c = conversion(dataset())
    for url in ["/dataset/999", "/conversion/999", "/conversion/999/frame", "/conversion/999/compare",
                "/conversion/%d/compare?b=999" % c.id, "/conversion/%d/compare?b=x" % c.id]:
        assert client.get(url).status_code == 404, url


def test_compare_takes_two_conversions_of_different_datasets(client):
    a, b = conversion(dataset(name="Roof")), conversion(dataset(name="Field"), name="Other")
    html = client.get("/conversion/%d/compare?b=%d" % (a.id, b.id)).content.decode()
    assert 'data-id="%d" data-b="%d"' % (a.id, b.id) in html
    # Without b, the conversion is compared with itself
    html = client.get("/conversion/%d/compare" % a.id).content.decode()
    assert 'data-id="%d" data-b="%d"' % (a.id, a.id) in html


def test_the_viewer_and_compare_pages_carry_the_basemaps(client):
    c = conversion(dataset())
    for url in ["/conversion/%d" % c.id, "/conversion/%d/compare" % c.id]:
        assert 'id="ta-basemaps"' in client.get(url).content.decode()


def test_the_pages_show_temperatures_in_the_apps_unit(client):
    from rest_framework.test import APIClient
    d = dataset()
    assert 'data-unit="F"' in client.get("/").content.decode()
    assert re.search(r'id="ta-unit" type="application/json">"F"<', client.get("/dataset/%d" % d.id).content.decode())
    APIClient().put(PREFERENCES, {'unit': 'K'}, format='json')
    assert 'data-unit="K"' in client.get("/").content.decode()
    html = client.get("/dataset/%d" % d.id).content.decode()
    assert re.search(r'id="ta-unit" type="application/json">"K"<', html)
    assert '<option value="K" selected>' in html


def test_a_rebuilt_page_loads_its_built_script_with_its_settings(client):
    html = client.get("/").content.decode()
    assert '<div id="app" data-page="datasets" data-api="/api/" data-public="/" data-unit="F"' in html
    assert '<script type="module" src="/static/dist/assets/datasets-a1.js"></script>' in html


def test_every_script_and_stylesheet_a_page_loads_is_served(client):
    c = conversion(dataset())
    urls = set()
    for page in ["/", "/dataset/%d" % c.dataset.id, "/conversion/%d" % c.id, "/conversion/%d/frame" % c.id,
                 "/conversion/%d/compare" % c.id]:
        urls.update(re.findall(r'(?:src|href)="(/static/[^"]+)"', client.get(page).content.decode()))
    # The tests' build is a stub (tests/settings.py): its files are not there
    urls = {u for u in urls if not u.startswith("/static/dist/")}
    assert len(urls) >= 10
    for url in sorted(urls):
        res = client.get(url)
        assert res.status_code == 200, url
        res.close()
