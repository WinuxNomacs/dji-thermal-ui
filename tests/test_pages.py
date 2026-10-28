"""The app's pages: each is served with the CSRF cookie the scripts send back, and the scripts and styles they load are
served; an unknown id is a 404"""

import re

import pytest
from django.test import Client

from dji_thermal_ui.analyzer.models import Project, ThermalConversion
from tests.fakes import PREFERENCES, dataset


@pytest.fixture
def client(db):
    return Client()


def conversion(d, name="Conversion 1"):
    return ThermalConversion.objects.create(dataset=d, name=name, options={})


def test_each_page_is_served_with_the_csrf_cookie(client):
    d = dataset()
    c = conversion(d)
    for url, page_id in [("/", "app"), ("/preferences", "app"), ("/project/%d" % d.project_id, "app"), ("/dataset/%d" % d.id, "app"),
                         ("/dataset/%d/report" % d.id, "app"),
                         ("/conversion/%d" % c.id, "app"), ("/conversion/%d/frame" % c.id, "app"),
                         ("/conversion/%d/compare" % c.id, "app")]:
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
    for url in ["/project/999", "/dataset/999", "/dataset/999/report", "/conversion/999", "/conversion/999/frame", "/conversion/999/compare",
                "/conversion/%d/compare?b=999" % c.id, "/conversion/%d/compare?b=x" % c.id]:
        assert client.get(url).status_code == 404, url


def test_a_project_page_is_named_after_its_project(client):
    p = Project.objects.create(name="Grain silos")
    html = client.get("/project/%d" % p.id).content.decode()
    assert "<title>Grain silos · Thermal Analyzer</title>" in html and 'data-id="%d"' % p.id in html


def test_compare_takes_two_conversions_of_different_datasets(client):
    a, b = conversion(dataset(name="Roof")), conversion(dataset(name="Field"), name="Other")
    html = client.get("/conversion/%d/compare?b=%d" % (a.id, b.id)).content.decode()
    assert 'data-id="%d" data-b="%d"' % (a.id, b.id) in html
    # Without b, the conversion is compared with itself
    html = client.get("/conversion/%d/compare" % a.id).content.decode()
    assert 'data-id="%d" data-b="%d"' % (a.id, a.id) in html


def test_the_projects_project_viewer_and_compare_pages_carry_the_basemaps(client):
    c = conversion(dataset())
    for url in ["/", "/project/%d" % c.dataset.project_id, "/dataset/%d/report" % c.dataset_id, "/conversion/%d" % c.id, "/conversion/%d/compare" % c.id]:
        assert 'id="ta-basemaps"' in client.get(url).content.decode()


def test_the_pages_show_temperatures_in_the_apps_unit(client):
    from rest_framework.test import APIClient
    d = dataset()
    assert 'data-unit="F"' in client.get("/").content.decode()
    assert 'data-unit="F"' in client.get("/dataset/%d" % d.id).content.decode()
    APIClient().put(PREFERENCES, {'unit': 'K'}, format='json')
    assert 'data-unit="K"' in client.get("/").content.decode()
    assert 'data-unit="K"' in client.get("/dataset/%d" % d.id).content.decode()


def test_a_rebuilt_page_loads_its_built_script_with_its_settings(client):
    html = client.get("/").content.decode()
    assert '<div id="app" data-page="projects" data-api="/api/" data-public="/" data-unit="F"' in html
    assert '<script type="module" src="/static/dist/assets/projects-a1.js"></script>' in html
    d = dataset()
    html = client.get("/dataset/%d" % d.id).content.decode()
    assert '<div id="app" data-page="dataset" data-api="/api/"' in html and 'data-id="%d"' % d.id in html
    assert 'data-project="%d" data-project-name="Default Project"' % d.project_id in html
    assert '<script type="module" src="/static/dist/assets/dataset-f6.js"></script>' in html


def test_every_page_loads_only_its_build_and_the_icon(client):
    c = conversion(dataset())
    pages = {"/": "projects-a1", "/preferences": "preferences-f2", "/project/%d" % c.dataset.project_id: "project-b4", "/dataset/%d" % c.dataset.id: "dataset-f6", "/conversion/%d" % c.id: "viewer-a7",
             "/conversion/%d/frame" % c.id: "frame-c9", "/conversion/%d/compare" % c.id: "compare-e1"}
    for page, script in pages.items():
        urls = re.findall(r'(?:src|href)="(/static/[^"]+)"', client.get(page).content.decode())
        # The tests' build is the stub manifest (tests/settings.py)
        assert "/static/dist/assets/%s.js" % script in urls, page
        assert all(u.startswith("/static/dist/") for u in urls if u != "/static/favicon.svg"), (page, urls)


def test_the_pages_show_dates_in_the_locale_chosen_or_the_computers(client):
    from rest_framework.test import APIClient
    assert 'data-locale=""' in client.get("/").content.decode()
    APIClient().put(PREFERENCES, {'locale': 'en-GB'}, format='json')
    assert 'data-locale="en-GB"' in client.get("/preferences").content.decode()
    assert "<title>User Preferences · Thermal Analyzer</title>" in client.get("/preferences").content.decode()


def test_a_report_page_carries_its_project_and_the_author_last_typed(client):
    from rest_framework.test import APIClient
    p = Project.objects.create(name="Grain silos", location_lon=-88.0, location_lat=42.0, location_label="Farm Rd 4")
    d = dataset(name="Roof")
    d.project = p
    d.save()
    html = client.get("/dataset/%d/report" % d.id).content.decode()
    assert "<title>Roof report · Thermal Analyzer</title>" in html
    assert 'data-project-name="Grain silos" data-location="Farm Rd 4" data-author=""' in html
    APIClient().patch("/api/datasets/%d" % d.id, {'report': {'author': "A. Inspector"}}, format='json')
    assert 'data-author="A. Inspector"' in client.get("/dataset/%d/report" % dataset().id).content.decode()
