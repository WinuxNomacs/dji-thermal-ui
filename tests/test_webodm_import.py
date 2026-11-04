"""Import from WebODM: the dialog's browser (a project's completed tasks with an orthophoto, those over the flight
first, and a preview of each: WebODM's own of a colour orthophoto, one coloured here from its tiles for temperatures),
and the orthophoto (with its DSM) imported into the flight as a dataset of its own, from a task or from a file. WebODM
is test_webodm_tasks's fake, answering the browser's calls too."""

import io
import json
import os
import re

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from dji_thermal_ui.analyzer import webodm, webodm_import
from dji_thermal_ui.analyzer.models import ThermalConversion, ThermalDataset
from tests.fakes import CONVERSIONS, DATASETS, dataset, mosaic_lonlat
from tests.test_webodm_tasks import Answer, dsm_bytes, orthophoto_bytes, wo  # noqa: F401 (wo: the fixture)

IMPORTS = DATASETS + "/%d/import/"


def png(value, size=256, alpha=255):
    """A grey tile as WebODM's tiler sends one: the value everywhere, its alpha"""
    from PIL import Image
    out = io.BytesIO()
    Image.new('LA', (size, size), (value, alpha)).save(out, 'PNG')
    return out.getvalue()


def row(tid, name, status=40, assets=('orthophoto.tif', 'all.zip'), extent=None, created="2026-11-01T10:00:00Z"):
    return {'id': tid, 'name': name, 'status': status, 'available_assets': list(assets), 'images_count': 120,
            'created_at': created, 'processing_time': 600000, 'extent': extent}


@pytest.fixture
def browse(wo, monkeypatch):  # noqa: F811
    """The fake WebODM answering the browser too: its projects' task lists, thumbnails, metadata and grey tiles"""
    wo.update(rows={}, thumbs={}, metadata={}, tiles=[])
    delegate = webodm._opener.open

    def open_(req, timeout):
        path = req.full_url[len("http://127.0.0.1:8001"):]
        m = re.match(r'^/api/projects/(\d+)/tasks/(?:\?ordering=-created_at)$', path)
        if m:
            wo['calls'].append(('GET', path))
            return Answer(json.dumps(wo['rows'].get(int(m[1]), [])).encode())
        m = re.match(r'^/api/projects/(\d+)/tasks/([\w-]+)/thumbnail\?size=(\d+)$', path)
        if m:
            wo['calls'].append(('GET', path))
            if m[2] not in wo['thumbs']:
                raise urllib_error(req.full_url, 404)
            return Answer(wo['thumbs'][m[2]])
        m = re.match(r'^/api/projects/(\d+)/tasks/([\w-]+)/orthophoto/metadata$', path)
        if m:
            return Answer(json.dumps(wo['metadata'][m[2]]).encode())
        m = re.match(r'^/api/projects/(\d+)/tasks/([\w-]+)/orthophoto/tiles/(\d+)/(\d+)/(\d+)\.png\?rescale=(.*)$', path)
        if m:
            wo['tiles'].append((int(m[3]), int(m[4]), int(m[5]), m[6]))
            return Answer(png(128))
        return delegate(req, timeout)

    monkeypatch.setattr(webodm._opener, 'open', open_)
    yield wo


def urllib_error(url, code):
    import urllib.error
    return urllib.error.HTTPError(url, code, "No", {}, io.BytesIO(b'{"detail": "Not found."}'))


def flight(**over):
    """A flight whose photos were taken over the fake mosaic's place"""
    lon, lat = mosaic_lonlat(32, 32)
    return dataset(analysis={'files': [{'path': "DJI_0001_T.JPG", 'kind': 'thermal', 'lon': lon, 'lat': lat},
                                       {'path': "DJI_0001_V.JPG", 'kind': 'not_thermal', 'lon': lon, 'lat': lat}]},
                   **over)


def near(dx=0.0):
    """An extent around the fake mosaic's place, moved east by dx degrees"""
    lon, lat = mosaic_lonlat(32, 32)
    return [lon - 0.001 + dx, lat - 0.001, lon + 0.001 + dx, lat + 0.001]


def test_the_browser_lists_a_projects_completed_tasks_with_an_orthophoto_those_over_the_flight_first(api, browse):
    d = flight()
    browse['rows'][1] = [row("t-new", "Elsewhere", extent=near(1.0), created="2026-11-03T10:00:00Z"),
                         row("t-run", "Running", status=20),
                         row("t-pc", "Point cloud only", assets=('georeferenced_model.laz',)),
                         row("t-over", "Over the roof", assets=('orthophoto.tif', 'dsm.tif'), extent=near()),
                         row("t-old", "No extent", extent=None)]
    res = api.get("/api/webodm/projects/1/tasks?dataset=%d" % d.id)
    assert res.status_code == 200
    assert [t['id'] for t in res.data['tasks']] == ["t-over", "t-new", "t-old"] and res.data['others'] == 2
    over = res.data['tasks'][0]
    assert over == {'id': "t-over", 'name': "Over the roof", 'created_at': "2026-11-01T10:00:00Z", 'images': 120,
                    'processing_ms': 600000, 'dsm': True, 'extent': near(), 'over': True}
    assert [t['over'] for t in res.data['tasks']] == [True, False, False]
    # Without a flight, none is over it
    assert [t['over'] for t in api.get("/api/webodm/projects/1/tasks").data['tasks']] == [False] * 3


def test_a_colour_orthophotos_preview_is_webodms_own_and_kept_and_one_of_temperatures_is_coloured_from_its_tiles(
        api, browse):
    from PIL import Image
    webodm_import._previews.clear()
    browse['thumbs']["t-rgb"] = b"\xff\xd8 jpeg"
    res = api.get("/api/webodm/projects/1/tasks/t-rgb/preview?size=640")
    assert res.status_code == 200 and res['Content-Type'] == 'image/jpeg' and res.content == b"\xff\xd8 jpeg"
    api.get("/api/webodm/projects/1/tasks/t-rgb/preview?size=640")
    assert [c for c in browse['calls'] if 'thumbnail' in c[1]] == [('GET', "/api/projects/1/tasks/t-rgb/thumbnail?size=640")]
    # Temperatures: WebODM refuses its thumbnail; its grey tiles over the 2nd to 98th percentiles, coloured
    browse['metadata']["t-hot"] = {'bounds': near(), 'statistics': {'1': {'min': 5, 'max': 40, 'percentiles': [12.5, 31.0]}}}
    res = api.get("/api/webodm/projects/1/tasks/t-hot/preview")
    assert res.status_code == 200
    with Image.open(io.BytesIO(res.content)) as im:
        assert im.format == 'JPEG' and max(im.size) <= 256
        r, g, b = im.convert('RGB').getpixel((im.width // 2, im.height // 2))
        assert (r, g, b) != (128, 128, 128)              # coloured, not grey
    assert browse['tiles'] and all(t[3] == "12.5,31.0" for t in browse['tiles'])
    assert len(browse['tiles']) <= webodm_import.PREVIEW_TILES ** 2
    assert api.get("/api/webodm/projects/1/tasks/t-hot/preview?size=99").status_code == 400


def test_the_preview_zoom_keeps_an_orthophoto_within_two_tiles_each_way():
    import math
    for box in (near(), [-122.5, 37.7, -122.3, 37.9], [10.0, 50.0, 10.00001, 50.00001]):
        z = webodm_import.preview_zoom(box)
        x0, y0 = webodm_import.mercator(box[0], box[3], z)
        x1, y1 = webodm_import.mercator(box[2], box[1], z)
        assert math.floor(x1 / 256) - math.floor(x0 / 256) <= 1 and math.floor(y1 / 256) - math.floor(y0 / 256) <= 1
        x0, y0 = webodm_import.mercator(box[0], box[3], z + 1)
        x1, y1 = webodm_import.mercator(box[2], box[1], z + 1)
        assert z == 22 or math.floor(x1 / 256) - math.floor(x0 / 256) > 1 or math.floor(y1 / 256) - math.floor(y0 / 256) > 1


def import_task(api, d, **over):
    return api.post(IMPORTS % d.id + "webodm", dict({'project': 1, 'task': "t-over"}, **over), format='json')


def test_a_tasks_orthophoto_of_temperatures_is_imported_with_its_dsm_as_a_dataset_of_its_own(api, browse, tmp_path):
    import rasterio
    api.put("/api/preferences", {'unit': 'F'}, format='json')
    d = flight()
    browse['rows'][1] = [row("t-over", "Over the roof", assets=('orthophoto.tif', 'dsm.tif'), extent=near())]
    browse['assets'][("t-over", 'orthophoto.tif')] = orthophoto_bytes(tmp_path)
    browse['assets'][("t-over", 'dsm.tif')] = dsm_bytes(tmp_path)
    res = import_task(api, d, dsm=True)
    assert res.status_code == 201
    c = ThermalConversion.objects.get(pk=res.data['id'])
    assert c.dataset_id == d.id and c.name == "Over the roof" and c.status == 'ready' and c.error == ""
    assert c.options['imported'] == {'from': 'webodm', 'url': "http://127.0.0.1:8001", 'project': 1,
                                     'project_name': "Roof survey", 'task': "t-over", 'task_name': "Over the roof",
                                     'dsm': True}
    # The orthophoto as the WebODM tab's temperatures, in the app's unit; the DSM as its Heights tab
    assert c.orthophoto['raster'] == "webodm/orthophoto.tif" and c.orthophoto['unit'] == 'F'
    assert c.orthophoto['temperature']['min'] == pytest.approx(50.0, abs=0.01)
    assert c.dsm['raster'] == "webodm/dsm.tif" and c.dsm['use'] is False
    with rasterio.open(os.path.join(c.data_dir(), c.dsm['heights_raster'])) as src:
        assert src.count == 1
    assert sorted(os.listdir(c.data_dir())) == ['webodm']
    summary = api.get("%s/%d" % (CONVERSIONS, c.id)).data
    assert summary['imported']['kind'] == 'thermal' and summary['orthophoto']['task_name'] == "Over the roof"
    assert summary['description'] == "from WebODM: Roof survey › Over the roof · DSM"
    assert summary['size'] > 0
    assert [t['tab'] for t in api.get("%s/%d/mosaics" % (CONVERSIONS, c.id)).data['tabs']] == ['webodm', 'heights']


def test_a_colour_orthophoto_is_imported_as_a_visual_mosaic_of_its_own(api, browse, tmp_path):
    import rasterio
    d = flight()
    browse['rows'][1] = [row("t-over", "Over the roof", extent=near())]
    browse['assets'][("t-over", 'orthophoto.tif')] = orthophoto_bytes(tmp_path, colours=True)
    c = ThermalConversion.objects.get(pk=import_task(api, d, name="RGB of the roof").data['id'])
    assert c.status == 'ready' and c.name == "RGB of the roof" and c.orthophoto == {}
    v = c.mosaics['visual']
    assert c.mosaics['visual_only'] is True and c.mosaics['imported'] is True and c.mosaic_status == 'ready'
    assert v['raster'] == "viewer/visual.tif" and v['files'] == ["mosaics/visual/orthophoto.tif"]
    assert v['gsd_m'] == pytest.approx(0.05) and v['width'] == 64
    with rasterio.open(os.path.join(c.data_dir(), v['raster'])) as src:
        assert src.count == 3 and src.dataset_mask().min() == 255
    assert api.get("%s/%d" % (CONVERSIONS, c.id)).data['imported']['kind'] == 'visual'
    assert not os.path.exists(os.path.join(c.data_dir(), webodm_import.IMPORT_DIR))


def test_a_task_not_completed_without_its_dsm_or_of_another_project_is_refused_before_any_download(api, browse):
    d = flight()
    browse['rows'][1] = [row("t-over", "Over the roof"), row("t-run", "Running", status=20)]
    assert import_task(api, d, task="t-run").status_code == 400
    assert import_task(api, d, task="t-gone").status_code == 400
    assert import_task(api, d, dsm=True).data['dsm'] == "The task has no DSM"
    assert import_task(api, d, project="1").status_code == 400
    assert not ThermalConversion.objects.exists()
    assert not [c for c in browse['calls'] if '/download/' in c[1]]


def test_an_orthophoto_that_is_neither_temperatures_nor_colours_fails_and_leaves_nothing(api, browse, tmp_path):
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    from tests.fakes import MOSAIC_ORIGIN
    path = tmp_path / "two.tif"
    with rasterio.open(path, 'w', driver='GTiff', width=8, height=8, count=2, dtype='uint16', crs='EPSG:32616',
                       transform=from_origin(*MOSAIC_ORIGIN, 0.05, 0.05)) as dst:
        dst.write(np.ones((2, 8, 8), 'uint16'))
    d = flight()
    browse['rows'][1] = [row("t-over", "Over the roof")]
    browse['assets'][("t-over", 'orthophoto.tif')] = path.read_bytes()
    c = ThermalConversion.objects.get(pk=import_task(api, d).data['id'])
    assert c.status == 'failed' and "neither temperatures" in c.error
    assert not os.path.exists(c.data_dir()) or os.listdir(c.data_dir()) == []
    # WebODM gone part way: said in its words
    browse['fail']["GET /api/projects/1/tasks/t-over/download/"] = 404
    c = ThermalConversion.objects.get(pk=import_task(api, d).data['id'])
    assert c.status == 'failed' and "WebODM has no" in c.error


def test_a_canceled_import_stops_at_its_next_progress_and_leaves_nothing(api, browse, tmp_path):
    d = flight()
    browse['rows'][1] = [row("t-over", "Over the roof")]
    browse['assets'][("t-over", 'orthophoto.tif')] = orthophoto_bytes(tmp_path)

    def cancel():
        c = ThermalConversion.objects.get(dataset=d)
        assert c.status == 'converting' and c.stage == {'step': 'download', 'asset': 'orthophoto'}
        assert api.post("%s/%d/cancel" % (CONVERSIONS, c.id)).data['status'] == 'canceled'
    browse['on_download'] = cancel
    c = ThermalConversion.objects.get(pk=import_task(api, d).data['id'])
    assert c.status == 'canceled' and c.orthophoto == {}
    assert not os.path.exists(os.path.join(c.data_dir(), webodm_import.IMPORT_DIR))


def test_a_geotiff_from_webodms_page_is_imported_with_its_dsm_named_after_the_file(api, tmp_path, settings):
    d = flight()
    res = api.post(IMPORTS % d.id + "file", {
        'orthophoto': SimpleUploadedFile("roof-orthophoto.tif", orthophoto_bytes(tmp_path, colours=True)),
        'dsm': SimpleUploadedFile("roof-dsm.tif", dsm_bytes(tmp_path))}, format='multipart')
    assert res.status_code == 201
    c = ThermalConversion.objects.get(pk=res.data['id'])
    assert c.status == 'ready' and c.name == "roof-orthophoto"
    assert c.options['imported'] == {'from': 'file', 'file': "roof-orthophoto.tif", 'dsm_file': "roof-dsm.tif"}
    assert c.mosaics['visual_only'] and c.dsm['raster'] == "webodm/dsm.tif" and c.dsm['task_name'] == "roof-orthophoto.tif"
    assert res.data['description'] == "from a file: roof-orthophoto.tif · DSM"
    # Only GeoTIFFs, and an orthophoto is needed
    assert api.post(IMPORTS % d.id + "file", {'orthophoto': SimpleUploadedFile("a.jpg", b"x")},
                    format='multipart').status_code == 400
    assert api.post(IMPORTS % d.id + "file", {'dsm': SimpleUploadedFile("d.tif", b"x")},
                    format='multipart').status_code == 400
    assert ThermalDataset.objects.get(pk=d.id).conversions.count() == 1
