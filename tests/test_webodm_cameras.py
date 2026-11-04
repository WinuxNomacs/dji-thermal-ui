"""The source frames of WebODM's orthophoto, from its task's cameras (webodm_cameras): a spot found in every photo of
the flight that saw it, at its pixel; the cameras brought with an import (from WebODM, or given with a file) or fetched
the first time they are needed; a thermal frame measured as the dataset its task was sent from. The cameras here look
straight down (or nearly) over the fake mosaic's place, whose DSM rises from 200 m to 206.3 m to the east."""

import json
import math

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from dji_thermal_ui.analyzer import thermal_measure, webodm_cameras
from dji_thermal_ui.analyzer.models import Finding, ThermalConversion, WebODMTask
from tests.fakes import CONVERSIONS, DATASETS, MOSAIC_ORIGIN, dataset, mosaic_lonlat, mosaic_square
from tests.test_webodm_import import browse, row  # noqa: F401 (browse: the fixture)
from tests.test_webodm_tasks import dsm_bytes, orthophoto_bytes, wo  # noqa: F401 (wo: the fixture)

IMPORTS = DATASETS + "/%d/import/"
LENS = "test 64 48 brown 1.0"
DOWN = [math.pi, 0.0, 0.0]          # looking straight down: east to the right of the photo, north up


def lonlat(e, n):
    from pyproj import Transformer
    return list(Transformer.from_crs('EPSG:32616', 'EPSG:4326', always_xy=True).transform(e, n))


def shot(name, e, n, z, rotation=DOWN):
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': lonlat(e, n) + [z]},
            'properties': {'filename': name, 'camera': "v2 " + LENS, 'focal': 1.0, 'width': 64, 'height': 48,
                           'capture_time': 1.0, 'translation': [e, n, z], 'rotation': rotation}}


def cameras_json(k1=0.0):
    return {LENS: {'projection_type': 'brown', 'width': 64, 'height': 48, 'focal_x': 1.0, 'focal_y': 1.0,
                   'c_x': 0.0, 'c_y': 0.0, 'k1': k1, 'k2': 0.0, 'p1': 0.0, 'p2': 0.0, 'k3': 0.0}}


# Over the middle of the mosaic's pixel (32, 32), where the DSM is 203.2 m: 10 m above it, and 2 m east of it; one
# far away
CENTRE = (MOSAIC_ORIGIN[0] + 32.5 * 0.05, MOSAIC_ORIGIN[1] - 32.5 * 0.05)


def shots_json():
    e, n = CENTRE
    return {'type': 'FeatureCollection', 'features': [
        shot("DJI_0001_T_temp_c.tiff", e, n, 213.2), shot("DJI_0002_T_temp_c.tiff", e + 2, n, 213.2),
        shot("DJI_0003_T_temp_c.tiff", e + 500, n, 213.2), shot("DJI_9999_T.tif", e, n, 213.2)]}


def rows(width=128, height=96):
    """The flight's photos: thermal frames twice the size WebODM was given, 10 m above where they took off"""
    lon, lat = mosaic_lonlat(32, 32)
    return [{'path': "100MEDIA/DJI_000%d_T.JPG" % i, 'kind': 'thermal', 'width': width, 'height': height,
             'alt': 10.0, 'lon': lon, 'lat': lat, 'time': "2026-11-0%dT10:00:00" % i} for i in (1, 2, 3)] + \
        [{'path': "100MEDIA/DJI_0001_V.JPG", 'kind': 'not_thermal', 'width': 256, 'height': 192, 'lon': lon, 'lat': lat}]


def models(tmp_path, dsm=True, **over):
    shots, lenses = webodm_cameras.check(over.get('shots', shots_json()), over.get('cameras', cameras_json()))
    path = None
    if dsm:
        path = tmp_path / "dsm.tif"
        path.write_bytes(dsm_bytes(tmp_path))
    return webodm_cameras.Cameras(shots, lenses, over.get('rows', rows()), path and str(path))


def test_a_spot_is_found_in_every_photo_of_the_flight_that_saw_it_at_its_pixel_in_the_flights_file(tmp_path):
    m = models(tmp_path)
    # The shot of a photo the flight doesn't hold is left out; a TIFF sent from here is its R-JPEG
    assert m.files == ("100MEDIA/DJI_0001_T.JPG", "100MEDIA/DJI_0002_T.JPG", "100MEDIA/DJI_0003_T.JPG")
    assert m.sizes["100MEDIA/DJI_0001_T.JPG"] == (128, 96)
    under = lonlat(*CENTRE)
    pixels, angles = m.pixels(*under)[:, 0], m.view_angles(*under)[:, 0]
    # Straight under the first: the photo's centre, in the file's pixels (twice WebODM's)
    assert pixels[0] == pytest.approx([63.5, 47.5], abs=0.01) and angles[0] == pytest.approx(0, abs=0.01)
    # 2 m west of the second, 10 m below it: a fifth of its focal length (64 px) left of its centre
    assert pixels[1] == pytest.approx([(31.5 - 0.2 * 64 + 0.5) * 2 - 0.5, 47.5], abs=0.01)
    assert angles[1] == pytest.approx(math.degrees(math.atan(0.2)), abs=0.01)
    assert math.isnan(pixels[2][0]) and math.isnan(angles[2])
    # 1 m north: up in the photo, at the DSM's height there
    north = lonlat(CENTRE[0], CENTRE[1] + 1)
    assert m.pixels(*north)[0, 0] == pytest.approx([63.5, (23.5 - 0.1 * 64 + 0.5) * 2 - 0.5], abs=0.01)
    # Each footprint holds the point under its photo
    from shapely.geometry import Point, Polygon
    assert Polygon(m.footprints[0]).contains(Point(under)) and not Polygon(m.footprints[2]).contains(Point(under))


def test_without_a_dsm_the_ground_is_under_the_photos_by_their_height_above_it(tmp_path):
    m = models(tmp_path, dsm=False)
    assert m.heights.ground == pytest.approx(203.2)
    assert m.pixels(*lonlat(*CENTRE))[0, 0] == pytest.approx([63.5, 47.5], abs=0.01)
    with pytest.raises(webodm_cameras.CamerasError, match="where the ground is"):
        models(tmp_path, dsm=False, rows=[dict(r, alt=None) for r in rows()])


def test_a_lens_folding_back_beyond_the_photos_corners_sees_nothing_there(tmp_path):
    # Barrel distortion this strong brings far points back inside the frame: they are beyond its corners' angle
    m = models(tmp_path, cameras=cameras_json(k1=-0.3))
    assert not math.isnan(m.pixels(*lonlat(*CENTRE))[0, 0, 0])
    # 18.26 m east of it, 10 m below: x = 1.826, where 1 - 0.3 x² is 0, would land on the photo's middle column
    assert math.isnan(m.pixels(*lonlat(CENTRE[0] + 18.26, CENTRE[1]))[0, 0, 0])


def test_cameras_that_cant_be_read_say_why():
    with pytest.raises(webodm_cameras.CamerasError, match="FeatureCollection"):
        webodm_cameras.check([], cameras_json())
    with pytest.raises(webodm_cameras.CamerasError, match="fisheye"):
        webodm_cameras.check(shots_json(), {LENS: dict(cameras_json()[LENS], projection_type='fisheye')})
    with pytest.raises(webodm_cameras.CamerasError, match="doesn't hold"):
        webodm_cameras.check(shots_json(), {"other": cameras_json()[LENS]})
    broken = shots_json()
    del broken['features'][0]['properties']['rotation']
    with pytest.raises(webodm_cameras.CamerasError, match="rotation"):
        webodm_cameras.check(broken, cameras_json())
    far = shots_json()
    far['features'][0]['properties']['translation'][0] += 1000
    shots, lenses = webodm_cameras.check(far, cameras_json())
    assert webodm_cameras.utm_epsg(shots[1:]) == 32616
    with pytest.raises(webodm_cameras.CamerasError, match="not in UTM"):
        webodm_cameras.utm_epsg(shots)


def test_a_photo_is_matched_by_its_name_or_the_name_a_tiff_sent_from_here_was_given():
    flight = [{'path': "a/DJI_0001_T.JPG"}, {'path': "DJI_0001_V.JPG"}, {'path': "b/dji_0002_t.jpg"}]
    names = [{'filename': n} for n in ("DJI_0001_T.JPG", "DJI_0001_T_temp_c.tiff", "DJI_0002_T.tif",
                                       "DJI_0001_V.JPG", "DJI_0003_T.JPG")]
    assert [r and r['path'] for r in webodm_cameras.matched(names, flight)] == [
        "a/DJI_0001_T.JPG", "a/DJI_0001_T.JPG", "b/dji_0002_t.jpg", "DJI_0001_V.JPG", None]


def flight():
    return dataset(analysis={'files': rows()})


def with_cameras(fake, task="t-over"):
    fake['assets'][(task, 'shots.geojson')] = json.dumps(shots_json()).encode()
    fake['assets'][(task, 'cameras.json')] = json.dumps(cameras_json()).encode()


def sources(api, c, geometry, tab='webodm'):
    return api.post("%s/%d/mosaics/%s/sources" % (CONVERSIONS, c.id, tab), {'geometry': geometry}, format='json')


def downloads(fake, asset):
    return [p for _, p in fake['calls'] if p.endswith("/download/" + asset)]


def test_an_imported_orthophoto_lists_the_photos_that_saw_a_spot_the_most_nadir_first_and_a_finding_keeps_them(
        api, browse, tmp_path):  # noqa: F811
    d = flight()
    browse['rows'][1] = [row("t-over", "Over the roof", assets=('orthophoto.tif', 'dsm.tif'))]
    browse['assets'][("t-over", 'orthophoto.tif')] = orthophoto_bytes(tmp_path)
    browse['assets'][("t-over", 'dsm.tif')] = dsm_bytes(tmp_path)
    with_cameras(browse)
    res = api.post(IMPORTS % d.id + "webodm", {'project': 1, 'task': "t-over", 'dsm': True}, format='json')
    c = ThermalConversion.objects.get(pk=res.data['id'])
    assert c.status == 'ready' and len(downloads(browse, 'shots.geojson')) == 1
    with open(webodm_cameras.path_of(c), encoding='utf-8') as f:
        assert json.load(f)['source'] == "task:t-over"
    spot = {'type': 'Point', 'coordinates': mosaic_lonlat(32.5, 32.5)}
    found = sources(api, c, spot).data
    assert found['models'] is True and found['reason'] is None
    assert [(f['frame'], f['used']) for f in found['frames']] == [("100MEDIA/DJI_0001_T.JPG", True),
                                                                  ("100MEDIA/DJI_0002_T.JPG", False)]
    first = found['frames'][0]
    assert first['time'] == "2026-11-01T10:00:00" and first['visual'] is None and 'width' not in first
    assert first['pixel'] == pytest.approx([63.5, 47.5], abs=0.05)
    assert found['point']['temperature'] is not None
    # An area: each photo's share of it and its outline in the photo
    area = sources(api, c, mosaic_square(20, 20, 44, 44)).data
    assert [f['frame'] for f in area['frames']][0] == "100MEDIA/DJI_0001_T.JPG"
    assert all(f['share'] > 0 and f['outline'] for f in area['frames'])
    # A finding keeps them; the cameras kept are read again, not fetched
    res = api.post("/api/datasets/%d/findings" % d.id, {'conversion': c.id, 'tab': 'webodm', 'geometry': spot,
                                                        'name': "Hot spot"}, format='json')
    assert res.status_code == 201
    assert [f['frame'] for f in Finding.objects.get(pk=res.data['id']).frames] == [
        "100MEDIA/DJI_0001_T.JPG", "100MEDIA/DJI_0002_T.JPG"]
    assert len(downloads(browse, 'shots.geojson')) == 1


def test_an_import_made_before_fetches_its_cameras_the_first_time_and_says_when_webodm_cant_give_them(
        api, browse, tmp_path):  # noqa: F811
    d = flight()
    browse['rows'][1] = [row("t-over", "Over the roof")]
    browse['assets'][("t-over", 'orthophoto.tif')] = orthophoto_bytes(tmp_path, colours=True)
    c = ThermalConversion.objects.get(pk=api.post(IMPORTS % d.id + "webodm", {'project': 1, 'task': "t-over"},
                                                  format='json').data['id'])
    assert c.status == 'ready' and len(downloads(browse, 'shots.geojson')) == 1       # tried, not there
    spot = {'type': 'Point', 'coordinates': mosaic_lonlat(32.5, 32.5)}
    found = sources(api, c, spot, 'visual').data
    assert found['frames'] == [] and found['reason'] == 'no_cameras'
    assert "WebODM couldn't give the task's cameras" in found['error']
    # Once WebODM has them: fetched at the next click, then kept
    with_cameras(browse)
    found = sources(api, c, spot, 'visual').data
    assert found['reason'] is None and found['frames'][0]['frame'] == "100MEDIA/DJI_0001_T.JPG"
    # A colour orthophoto's photos are shown as themselves: their size, for the spot's mark
    assert found['frames'][0]['width'] == 128 and found['frames'][0]['height'] == 96
    sources(api, c, spot, 'visual')
    assert len(downloads(browse, 'shots.geojson')) == 3


def test_a_tasks_cameras_given_with_a_file_give_its_frames_and_one_without_the_other_is_refused(api, tmp_path):
    d = flight()

    def post(**files):
        return api.post(IMPORTS % d.id + "file", dict(
            {'orthophoto': SimpleUploadedFile("roof.tif", orthophoto_bytes(tmp_path))}, **files), format='multipart')

    shots = lambda: SimpleUploadedFile("shots.geojson", json.dumps(shots_json()).encode())  # noqa: E731
    cameras = lambda: SimpleUploadedFile("cameras.json", json.dumps(cameras_json()).encode())  # noqa: E731
    assert post(shots=shots()).status_code == 400
    res = post(shots=shots(), cameras=SimpleUploadedFile("cameras.json", b"{not json"))
    assert res.status_code == 400 and res.data['cameras'] == "cameras.json is not JSON"
    res = post(shots=SimpleUploadedFile("shots.geojson", b"[]"), cameras=cameras())
    assert res.status_code == 400 and "FeatureCollection" in res.data['cameras']
    assert d.conversions.count() == 0
    spot = {'type': 'Point', 'coordinates': mosaic_lonlat(32.5, 32.5)}
    c = ThermalConversion.objects.get(pk=post(shots=shots(), cameras=cameras()).data['id'])
    found = sources(api, c, spot).data
    assert c.status == 'ready' and [f['frame'] for f in found['frames']] == [
        "100MEDIA/DJI_0001_T.JPG", "100MEDIA/DJI_0002_T.JPG"]
    # Without them, none (as before)
    c = ThermalConversion.objects.get(pk=post().data['id'])
    assert sources(api, c, spot).data['reason'] == 'not_recorded'


def test_a_thermal_frame_of_an_import_is_measured_as_the_dataset_its_task_was_sent_from(api):
    d = flight()
    sent = ThermalConversion.objects.create(dataset=d, name="Sent", status='ready', options={'emissivity': 0.9})
    WebODMTask.objects.create(conversion=sent, project_id=1, task_id="t-sent", name="Sent")
    other = ThermalConversion.objects.create(dataset=dataset(), name="Elsewhere", status='ready')
    WebODMTask.objects.create(conversion=other, project_id=1, task_id="t-elsewhere", name="Elsewhere")

    def imported(**i):
        return ThermalConversion.objects.create(dataset=d, name="Imported", status='ready',
                                                options={'imported': dict({'from': 'webodm', 'project': 1}, **i)})

    assert thermal_measure.measured_as(imported(task="t-sent")) == sent
    # A task sent from another flight's dataset, or not from here, or a file: its own frames' parameters
    for c in (imported(task="t-elsewhere"), imported(task="t-webodm"), imported(**{'from': 'file'}), sent):
        assert thermal_measure.measured_as(c) == c


def test_the_cameras_of_an_orthophoto_brought_back_are_its_tasks_and_a_file_without_them_has_none(db):
    d = flight()
    sent = ThermalConversion.objects.create(dataset=d, name="Sent", status='ready')
    task = WebODMTask.objects.create(conversion=sent, project_id=3, task_id="t-sent", name="Sent")
    assert webodm_cameras.source_of(sent) == (None, None)
    sent.orthophoto = {'raster': "webodm/orthophoto-%d.tif" % task.pk, 'task': task.pk}
    assert webodm_cameras.source_of(sent) == ("task:t-sent", (3, "t-sent"))
    # Another dataset's task is not its own
    other = ThermalConversion.objects.create(dataset=d, name="Other", status='ready', orthophoto={'task': task.pk})
    assert webodm_cameras.source_of(other) == (None, None)
    from_file = ThermalConversion.objects.create(dataset=d, name="File", status='ready',
                                                 options={'imported': {'from': 'file', 'file': "roof.tif"}})
    assert webodm_cameras.source_of(from_file) == ("file", None) and webodm_cameras.kept(from_file) is None
