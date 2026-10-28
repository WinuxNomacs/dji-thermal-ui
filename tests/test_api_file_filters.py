"""The Files tab's favourite filters: saved under a name for every flight, deleted, never overwritten"""

from dji_thermal_ui.analyzer.models import Preferences

FILE_FILTERS = "/api/file-filters"


def test_a_filter_is_saved_under_its_name_for_every_flight_in_the_order_saved(api):
    assert api.get(FILE_FILTERS).data == {'filters': []}
    res = api.post(FILE_FILTERS, {'name': "  Warm roofs ", 'filters': ["kind.in.thermal", "tmin.gt.50"]}, format='json')
    assert res.status_code == 201
    api.post(FILE_FILTERS, {'name': "Low", 'filters': ["alt.le.20"]}, format='json')
    assert api.get(FILE_FILTERS).data['filters'] == [
        {'name': "Warm roofs", 'filters': ["kind.in.thermal", "tmin.gt.50"]}, {'name': "Low", 'filters': ["alt.le.20"]}]
    assert Preferences.load().data['file_filters'][0]['name'] == "Warm roofs"


def test_a_favourite_is_never_overwritten_by_one_of_the_same_name(api):
    api.post(FILE_FILTERS, {'name': "Low", 'filters': ["alt.le.20"]}, format='json')
    res = api.post(FILE_FILTERS, {'name': "Low ", 'filters': ["alt.le.10"]}, format='json')
    assert res.status_code == 409
    assert "already" in res.data['name'][0]
    assert api.get(FILE_FILTERS).data['filters'] == [{'name': "Low", 'filters': ["alt.le.20"]}]


def test_a_favourite_needs_a_name_and_at_least_one_condition(api):
    for body in ({'name': "", 'filters': ["alt.le.20"]}, {'name': "x" * 256, 'filters': ["alt.le.20"]},
                 {'name': 3, 'filters': ["alt.le.20"]}, {'name': "None", 'filters': []},
                 {'name': "Bad", 'filters': "alt.le.20"}, {'name': "Bad", 'filters': [{"key": "alt"}]},
                 {'name': "Long", 'filters': ["x" * 1025]}, {'name': "Many", 'filters': ["alt.le.20"] * 51}):
        assert api.post(FILE_FILTERS, body, format='json').status_code == 400, body
    assert api.get(FILE_FILTERS).data['filters'] == []


def test_a_favourite_is_deleted_by_its_name(api):
    api.post(FILE_FILTERS, {'name': "Low & wide", 'filters': ["alt.le.20"]}, format='json')
    api.post(FILE_FILTERS, {'name': "Warm", 'filters': ["tmin.gt.50"]}, format='json')
    assert api.delete(FILE_FILTERS + "?name=Nothing").status_code == 404
    res = api.delete(FILE_FILTERS + "?name=Low%20%26%20wide")
    assert res.status_code == 200
    assert res.data['filters'] == [{'name': "Warm", 'filters': ["tmin.gt.50"]}]
    api.delete(FILE_FILTERS + "?name=Warm")
    assert 'file_filters' not in Preferences.load().data
