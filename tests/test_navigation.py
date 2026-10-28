"""What the navigation pane lists, the locale dates and times are shown in, and the time zone a dataset was flown in
(from its frames' two clocks)"""

import pytest

from dji_thermal_ui.analyzer import thermal_analysis
from dji_thermal_ui.analyzer.models import Project, ThermalConversion
from tests.fakes import CONVERSIONS, DATASETS, PREFERENCES, dataset

NAVIGATION = "/api/navigation"


def test_the_pane_lists_the_projects_their_datasets_and_what_each_conversion_has_to_show(api):
    default = Project.default()
    silos = Project.objects.create(name="Silos")
    roof = dataset(project=silos, name="Roof")
    field = dataset(project=silos, name="Field")
    new = ThermalConversion.objects.create(dataset=roof, name="New", options={}, status='converting')
    framed = ThermalConversion.objects.create(dataset=roof, name="Framed", options={}, status='ready')
    built = ThermalConversion.objects.create(dataset=roof, name="Built", options={}, status='ready',
                                             mosaic_status='ready', mosaics={
                                                 'frames': ["a_T.JPG", "b_T.JPG", "c_T.JPG"],
                                                 'kinds': {'as_converted': {'oblique': 4, 'unusable': 1},
                                                           'harmonized': {'oblique': 4, 'unusable': 1}},
                                                 'visual': {'raster': "visual.tif"}})
    listed = api.get(NAVIGATION).data['projects']
    assert [(p['id'], p['name']) for p in listed] == [(default.id, "Default Project"), (silos.id, "Silos")]
    assert listed[0]['datasets'] == []
    # Newest first, as the pages list them
    assert [(d['id'], d['name']) for d in listed[1]['datasets']] == [(field.id, "Field"), (roof.id, "Roof")]
    assert listed[1]['datasets'][1]['conversions'] == [
        {'id': built.id, 'name': "Built", 'frames': True, 'mosaics': True,
         'tabs': ['as_converted', 'harmonized', 'source_frame', 'view_angle', 'visual'], 'in_mosaic': 3, 'oblique': 5},
        {'id': framed.id, 'name': "Framed", 'frames': True, 'mosaics': False},
        {'id': new.id, 'name': "New", 'frames': False, 'mosaics': False},
    ]


def test_the_pane_lists_only_the_mosaics_built(api):
    c = ThermalConversion.objects.create(dataset=dataset(), name="Old", options={}, status='ready',
                                         mosaic_status='ready', mosaics={'frames': [], 'kinds': {'harmonized': {'oblique': 2}}})
    listed = api.get(NAVIGATION).data['projects'][0]['datasets'][0]['conversions']
    assert listed == [{'id': c.id, 'name': "Old", 'frames': True, 'mosaics': True, 'tabs': ['harmonized'],
                       'in_mosaic': 0, 'oblique': 0}]


def test_the_pane_makes_the_default_project_when_there_is_none(api):
    Project.objects.all().delete()
    assert [p['name'] for p in api.get(NAVIGATION).data['projects']] == ["Default Project"]


def test_dates_are_shown_in_the_computers_locale_until_another_is_chosen(api):
    res = api.get(PREFERENCES)
    assert res.data['locale'] == "" and "en-GB" in res.data['locales'] and "" not in res.data['locales']
    assert api.put(PREFERENCES, {'locale': 'en-GB'}, format='json').data == {'locale': 'en-GB'}
    assert api.get(PREFERENCES).data['locale'] == "en-GB"
    for bad in ("xx-YY", None, 5):
        res = api.put(PREFERENCES, {'locale': bad}, format='json')
        assert res.status_code == 400 and str(res.data['locale']).startswith('One of "", en-US')
    # Back to the computer's
    assert api.put(PREFERENCES, {'locale': ''}, format='json').data == {'locale': ''}
    assert api.get(PREFERENCES).data['locale'] == ""


def rows(*times, kind='thermal'):
    return {'files': [{'path': "DJI_{:04d}_T.JPG".format(i), 'kind': kind, 'time': local, 'utc': utc}
                      for i, (local, utc) in enumerate(times)]}


@pytest.mark.parametrize("times, offset", [
    # The 220 M4T frames: 08:44:42 local against 13:45:01.8 UTC, the two clocks 20 seconds apart
    ([("2026:09:18 08:44:42", "2026-09-18T13:45:01.8")], -300),
    ([("2026:10:22 16:34:57", "2026-10-22T21:35:16.504449")], -300),
    # East of UTC, a half and a quarter hour, across midnight
    ([("2026:10:23 02:05:10", "2026:10:22 20:35:00")], 330),
    ([("2026:10:23 05:50:00", "2026-10-23T00:05:01")], 345),
    ([("2026:10:22 13:00:00", "2026-10-22T13:00:04")], 0),
    # The most frames' offset: a frame with a clock gone wrong is outvoted
    ([("2026:10:22 16:34:57", "2026-10-22T21:35:16"), ("2026:10:22 16:35:57", "2026-10-22T21:36:16"),
      ("2026:10:22 16:36:57", "2026-10-22T19:37:16")], -300),
])
def test_the_flight_is_in_the_time_zone_of_its_frames_two_clocks(times, offset):
    assert thermal_analysis.flight_zone(rows(*times)) == {'offset': offset}


@pytest.mark.parametrize("analysis, reason", [
    (rows(("2026:10:22 16:34:57", "")), "The images do not record the time zone they were taken in"),
    (rows(("", "2026-10-22T21:35:16")), "The images do not record the time zone they were taken in"),
    (rows(("2026:10:22 16:34:57", "not a time")), "The images do not record the time zone they were taken in"),
    # More than 14 hours apart: no time zone is
    (rows(("2026:10:22 16:34:57", "2026-10-21T21:35:16")), "The images do not record the time zone they were taken in"),
    (rows(("2026:10:22 16:34:57", "2026-10-22T21:35:16"), kind='not_thermal'),
     "The images do not record the time zone they were taken in"),
    (None, "The images do not record the time zone they were taken in"),
    # Analyzed before the UTC time was kept
    ({'files': [{'path': "DJI_0001_T.JPG", 'kind': 'thermal', 'time': "2026:10:22 16:34:57"}]},
     "Analyze the flight again to find the time zone it was flown in"),
])
def test_a_flight_without_both_clocks_has_no_time_zone_and_says_why(analysis, reason):
    assert thermal_analysis.flight_zone(analysis) == {'offset': None, 'reason': reason}


def test_a_dataset_and_its_conversions_frames_say_the_time_zone_it_was_flown_in(api):
    d = dataset(analysis=rows(("2026:10:22 16:34:57", "2026-10-22T21:35:16.5")))
    c = ThermalConversion.objects.create(dataset=d, name="C", options={}, status='ready')
    assert api.get("{}/{}".format(DATASETS, d.id)).data['flight_zone'] == {'offset': -300}
    assert api.get("{}/{}/frames".format(CONVERSIONS, c.id)).data['flight_zone'] == {'offset': -300}
    assert api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data['flight_zone'] == {'offset': -300}
