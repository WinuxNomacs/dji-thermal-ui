"""Exporting a flight's frames (original, TIFF, PNG and R-JPEG, each also private) and a conversion's mosaics (TIFF
and PNG) through the API: what is asked is checked, one file comes as it is, several as a zip made as it is sent, and
the images are coloured as the browser colours them"""

import io
import os
import zipfile
from pathlib import Path
from unittest import mock

import numpy as np
import pytest
from PIL import Image

from dji_thermal_ui.analyzer import colouring, exports
from dji_thermal_ui.analyzer import thermal_mosaics as mosaics
from dji_thermal_ui.analyzer.models import ThermalConversion, ThermalDataset
from tests.fakes import CONVERSIONS, DATASETS, analysed, converted, fake_measure, fake_rjpeg

FRAMES = ('100MEDIA/DJI_0001_T.JPG', '100MEDIA/DJI_0002_T.JPG')


def asked(client, c, **body):
    """An export of the conversion's flight asked for: the response"""
    return client.post("{}/{}/exports".format(DATASETS, c.dataset_id), body, format='json')


def download(client, res):
    assert res.status_code == 200, res.data
    out = client.get(res.data['url'])
    assert out.status_code == 200, getattr(out, 'data', None)
    return out


def content(res):
    return b"".join(res.streaming_content) if res.streaming else res.content


def unzipped(res):
    with zipfile.ZipFile(io.BytesIO(content(res))) as z:
        return {name: z.read(name) for name in z.namelist()}


def measured_frames():
    return mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure)


def test_what_an_export_asks_is_checked(api):
    c = analysed(converted(api)[0])
    assert asked(api, c, format='nope').status_code == 400
    assert asked(api, c, format='png', frames=['nope.JPG']).status_code == 400
    assert asked(api, c, format='png', frames='x').status_code == 400
    assert asked(api, c, format='png', frames=[]).status_code == 400
    assert asked(api, c, format='png', conversion=99999).status_code == 400
    assert asked(api, c, format='png', view={'range': [5, 5]}).status_code == 400
    assert asked(api, c, format='png', view={'gamma': 50}).status_code == 400
    assert asked(api, c, format='png', view={'isotherm': 'over,3'}).status_code == 400
    assert asked(api, c, format='rjpeg', picture='nope').status_code == 400
    assert asked(api, c, format='png', changes={'emissivity': 7}).status_code == 400
    # An export no longer kept (or never asked for)
    assert api.get('/api/exports/' + '0' * 32).status_code == 404


def test_an_r_jpeg_or_an_original_cannot_carry_normalized_or_replaced_temperatures(api):
    c = analysed(converted(api)[0])
    ThermalConversion.objects.filter(pk=c.pk).update(options=dict(c.options, normalize=True))
    for fmt in ('rjpeg', 'rjpeg_private', 'original', 'original_private'):
        res = asked(api, c, format=fmt, conversion=c.id)
        assert res.status_code == 400 and "normalized" in res.data['error'] and "TIFF" in res.data['error'], fmt
    assert asked(api, c, format='tiff', conversion=c.id).status_code == 200
    # Without the conversion, the frames' own values
    assert asked(api, c, format='rjpeg').status_code == 200
    res = asked(api, c, format='rjpeg', changes={'emissivity': 0.9})
    assert res.status_code == 200
    ThermalConversion.objects.filter(pk=c.pk).update(options=dict(c.options, replace_above=40, replace_above_value='nodata'))
    res = asked(api, c, format='rjpeg', conversion=c.id)
    assert res.status_code == 400 and "replaced" in res.data['error']


def test_an_original_is_the_file_as_it_is_and_several_are_a_zip_keeping_their_folders(api):
    c = analysed(converted(api)[0])
    source = Path(c.dataset.images_dir(), FRAMES[0]).read_bytes()
    res = download(api, asked(api, c, format='original', frames=[FRAMES[0]]))
    assert content(res) == source
    assert res['Content-Disposition'] == 'attachment; filename=DJI_0001_T.JPG'
    res = download(api, asked(api, c, format='original'))
    assert res['Content-Disposition'].endswith('-original.zip')
    files = unzipped(res)
    assert sorted(files) == sorted(FRAMES) and files[FRAMES[0]] == source


def test_a_frame_that_cannot_be_made_is_left_out_of_the_zip_and_noted(api):
    c = analysed(converted(api)[0])
    url = asked(api, c, format='original').data['url']
    os.remove(os.path.join(c.dataset.images_dir(), FRAMES[1]))
    files = unzipped(api.get(url))
    assert sorted(files) == [FRAMES[0], exports.NOTES_FILE]
    assert FRAMES[1] in files[exports.NOTES_FILE].decode()


def test_a_frames_png_is_coloured_as_the_browser_colours_it(api):
    c = analysed(converted(api)[0])
    view = {'palette': 'gray', 'range': [20, 30], 'sharpen': 1, 'isotherm': 'above,25'}
    with measured_frames():
        res = download(api, asked(api, c, format='png', frames=[FRAMES[0]], view=view, conversion=c.id))
    assert res['Content-Type'] == 'image/png'
    png = Image.open(io.BytesIO(content(res)))
    assert (png.size, png.mode, png.info.get('exif')) == ((10, 8), 'RGBA', None)
    values = fake_measure(None).temperature.astype(np.float64)
    values[0, 0] = np.nan
    from dji_thermal_ui.analyzer.raster.tiler import colormap_entries
    want = colouring.colour(values, colormap_entries(['gray'])[0]['color_map'], (20, 30),
                            [i / 64 for i in range(65)], 1, (25, 3e38))
    assert np.array_equal(np.asarray(png), want)


def test_several_frames_pngs_share_one_range(api):
    c = analysed(converted(api)[0])
    with measured_frames():
        files = unzipped(download(api, asked(api, c, format='png', view={'palette': 'gray'}, changes={})))
    assert sorted(files) == ['100MEDIA/DJI_0001_T.png', '100MEDIA/DJI_0002_T.png']
    # Both frames are the same temperatures: the same colours, over the range of both
    a, b = (np.asarray(Image.open(io.BytesIO(files[n]))) for n in sorted(files))
    assert np.array_equal(a, b) and a[..., 0].max() > a[..., 0].min()


def test_a_frames_tiff_is_dji_thermal_clis_and_private_without_the_location(api):
    c = analysed(converted(api)[0])
    written = []

    def process_file(src, dst, root, overrides, low, high, palette, wanted, compression, adj, offset_c):
        written.append((wanted, adj.strip_location, offset_c))
        out = dst / (src.stem + '_' + wanted[0][0] + '.tiff')
        out.write_bytes(b'II*tiff')
        return mock.Mock(ok=True, outputs=[out])

    with mock.patch('dji_thermal_cli.core.process_file', side_effect=process_file):
        res = download(api, asked(api, c, format='tiff', frames=[FRAMES[0]], conversion=c.id))
        assert content(res) == b'II*tiff'
        assert res['Content-Disposition'] == 'attachment; filename=DJI_0001_T_temp_c.tiff'
        download(api, asked(api, c, format='tiff_private', frames=[FRAMES[0]]))
    assert [(w[0], private) for w, private, _ in written] == [(('temp_c', 'tiff'), False), (('temp_f', 'tiff'), True)]


def test_an_r_jpeg_has_the_view_as_its_picture_or_dji_s(api):
    c = analysed(converted(api)[0])
    copies = []

    def rjpeg_copy(path, settings, picture=None):
        copies.append((settings.strip_location, settings.emissivity, None if picture is None else picture.shape))
        return b'\xff\xd8rjpeg'

    with measured_frames(), mock.patch('dji_thermal_cli.api.rjpeg_copy', side_effect=rjpeg_copy):
        res = download(api, asked(api, c, format='rjpeg', frames=[FRAMES[0]], view={'palette': 'gray'},
                                  changes={'emissivity': 0.9}))
        assert (content(res), res['Content-Disposition']) == (b'\xff\xd8rjpeg',
                                                             'attachment; filename=DJI_0001_T_rjpeg.jpg')
        download(api, asked(api, c, format='rjpeg_private', frames=[FRAMES[0]], picture='original'))
    assert copies == [(False, 0.9, (8, 10, 3)), (True, None, None)]


def test_an_r_jpeg_dji_s_tools_cannot_take_is_refused_with_the_reason(api):
    from dji_thermal_cli import api as dji_api
    c = analysed(converted(api)[0])
    with mock.patch('dji_thermal_cli.api.rjpeg_copy', side_effect=dji_api.RJpegCopyError("no parameters here")):
        res = api.get(asked(api, c, format='rjpeg', frames=[FRAMES[0]], picture='original').data['url'])
        assert res.status_code == 400 and res.data['error'] == "no parameters here"
        files = unzipped(api.get(asked(api, c, format='rjpeg', picture='original').data['url']))
    assert list(files) == [exports.NOTES_FILE]


def test_a_mosaics_tiff_is_its_geotiff_and_private_without_its_place(api):
    import rasterio
    c, _ = converted(api)
    url = "{}/{}/mosaics/as_converted/exports".format(CONVERSIONS, c.id)
    raster = os.path.join(c.data_dir(), c.mosaics['kinds']['as_converted']['raster'])
    res = download(api, api.post(url, {'format': 'tiff'}, format='json'))
    assert content(res) == Path(raster).read_bytes()
    res = download(api, api.post(url, {'format': 'tiff_private'}, format='json'))
    assert res['Content-Disposition'].endswith('-as-converted-private.tif')
    with pytest.warns(rasterio.errors.NotGeoreferencedWarning), rasterio.open(io.BytesIO(content(res))) as private, \
            rasterio.open(raster) as src:
        assert private.crs is None and 'dji_thermal_mosaic' not in private.tags()
        assert private.descriptions == src.descriptions
        assert np.array_equal(private.read(), src.read(), equal_nan=True)
    assert api.post(url, {'format': 'rjpeg'}, format='json').status_code == 400
    assert api.post("{}/{}/mosaics/nope/exports".format(CONVERSIONS, c.id), {'format': 'tiff'},
                    format='json').status_code == 404


@pytest.mark.parametrize('tab', ['as_converted', 'source_frame', 'view_angle'])
def test_a_mosaics_png_is_coloured_whole_in_strips(api, monkeypatch, tab):
    import rasterio
    monkeypatch.setattr(exports, 'STRIP_ROWS', 7)
    c, _ = converted(api)
    view = {'palette': 'gray', 'range': [10, 30], 'sharpen': 2, 'equalize': True}
    res = download(api, api.post("{}/{}/mosaics/{}/exports".format(CONVERSIONS, c.id, tab),
                                 {'format': 'png', 'view': view, 'correction': {'emissivity': '0.9'}}, format='json'))
    png = np.asarray(Image.open(io.BytesIO(content(res))))
    path, band = mosaics.tab_raster(c, tab)
    with rasterio.open(path) as src:
        assert png.shape == (src.height, src.width, 4)
        values = src.read(band, masked=True).astype(np.float64).filled(np.nan)
    assert (png[..., 3] == 0).any() and (png[..., 3] == 255).any()
    if tab == 'as_converted':
        # As the browser colours the same values, with the same curve
        from dji_thermal_ui.analyzer import api as api_module
        correction = api_module.thermal_measure.mosaic_correction(c, tab, {'emissivity': '0.9'})
        shown = exports.mosaic_band_values(values, band, 'C', correction)
        curve = api_module.mosaic_curve(c, tab, path, band, correction, 10, 30, {'gamma': 1.0, 'equalize': True,
                                                                                    'sharpen': 2.0})
        shares = api_module.thermal_measure.curve_shares(10, 30, {'gamma': 1.0}, curve)
        from dji_thermal_ui.analyzer.raster.tiler import colormap_entries
        want = colouring.colour(shown, colormap_entries(['gray'])[0]['color_map'], (10, 30), shares, 2)
        assert np.array_equal(png, want)


def test_the_visual_mosaic_exports_as_it_is(api):
    c, _ = converted(api, names=FRAMES + ('100MEDIA/DJI_0001_V.JPG',))
    if not (c.mosaics or {}).get(mosaics.VISUAL):
        pytest.skip("no visual mosaic was faked")
    url = "{}/{}/mosaics/visual/exports".format(CONVERSIONS, c.id)
    png = np.asarray(Image.open(io.BytesIO(content(download(api, api.post(url, {'format': 'png'}, format='json'))))))
    import rasterio
    tif = next(f for f in c.mosaics[mosaics.VISUAL]['files'] if f.endswith('.tif'))
    with rasterio.open(os.path.join(c.data_dir(), tif)) as src:
        assert np.array_equal(png, np.moveaxis(src.read(), 0, -1))


def test_an_original_of_a_flight_takes_its_visual_images_when_asked(api):
    c = analysed(converted(api, names=FRAMES + ('100MEDIA/DJI_0001_V.JPG',))[0])
    files = c.dataset.analysis['files']
    ThermalDataset.objects.filter(pk=c.dataset_id).update(analysis={'files': files + [
        {'path': '100MEDIA/DJI_0001_V.JPG', 'kind': 'not_thermal'}]})
    assert sorted(unzipped(download(api, asked(api, c, format='original', visual=True)))) == sorted(
        FRAMES + ('100MEDIA/DJI_0001_V.JPG',))
    assert sorted(unzipped(download(api, asked(api, c, format='original')))) == sorted(FRAMES)
    # One frame with its visual image is a zip
    assert sorted(unzipped(download(api, asked(api, c, format='original', frames=[FRAMES[0]], visual=True)))) == [
        FRAMES[0], '100MEDIA/DJI_0001_V.JPG']


def test_the_dji_palettes_come_from_the_frame(api):
    c = analysed(converted(api)[0])
    with measured_frames(), mock.patch('dji_thermal_cli.tsdk.open', side_effect=fake_rjpeg):
        res = download(api, asked(api, c, format='png', frames=[FRAMES[0]],
                                  view={'palette': 'dji_ironred', 'range': [20, 29]}))
        png = np.asarray(Image.open(io.BytesIO(content(res))))
    # The fake palettes go from blue to red
    assert tuple(png[1, 0, :3]) == (0, 0, 255) and tuple(png[1, 9, :3]) == (255, 0, 0)
    assert asked(api, c, format='png', view={'palette': 7}).status_code == 400


@pytest.mark.flight
def test_a_real_flights_frames_export_in_every_format(api, flight_frames, flight_visual, tmp_path):
    """On real R-JPEGs: the private files hold none of the frame's identifiers, the R-JPEG measures with the settings
    asked as dji-thermal-cli measures the source with them, and the TIFF holds the temperatures"""
    import re
    import shutil

    import rasterio
    from dji_thermal_cli import api as dji_api
    from dji_thermal_cli import rjpeg, tsdk

    from dji_thermal_ui.analyzer import thermal_analysis

    frame = flight_frames[0]
    number = re.search(r"_(\d{4})_T\.JPG$", frame.name, re.IGNORECASE).group(1)
    visual = next(v for v in flight_visual if "_{}_".format(number) in v.name)
    images = tmp_path / "images"
    images.mkdir()
    for f in (frame, flight_frames[1], visual):
        shutil.copy(f, images)
    dataset = ThermalDataset.objects.create(name="flight", source="folder", folder=str(images), status="analyzing",
                                            run_id="a")
    thermal_analysis.analyze_dataset(dataset.pk, "a")
    dataset.refresh_from_db()
    assert dataset.status == "ready", dataset.error

    def export(**body):
        res = api.post("{}/{}/exports".format(DATASETS, dataset.id), dict(body, frames=[frame.name]), format='json')
        return content(download(api, res))

    found = rjpeg.identifiers(frame.read_bytes())
    assert found
    private = export(format='original_private')
    assert rjpeg.identifiers(private) == {} and not [v for v in found.values() if v in private]
    with Image.open(frame) as source, Image.open(io.BytesIO(private)) as copied:
        assert source.getexif().get_ifd(0x8825) and not copied.getexif().get_ifd(0x8825)

    copy = export(format='rjpeg', changes={'emissivity': 0.9}, view={'palette': 'gray'})
    measured = dji_api.measure(frame, dji_api.Settings(emissivity=0.9))
    assert tsdk.open(copy).get_measurement_params().emissivity == pytest.approx(0.9)
    assert np.array_equal(dji_api.measure(_saved(tmp_path, copy)).temperature,
                          measured.temperature)
    assert rjpeg.identifiers(export(format='rjpeg_private', picture='original')) == {}

    tiff = export(format='tiff', changes={'emissivity': 0.9})
    with pytest.warns(rasterio.errors.NotGeoreferencedWarning), rasterio.open(io.BytesIO(tiff)) as src:
        want = dji_api.measure(frame, dji_api.Settings(emissivity=0.9), unit='F').temperature
        assert np.allclose(src.read(1), want, atol=1e-3)

    with Image.open(io.BytesIO(export(format='png'))) as png, Image.open(frame) as source:
        assert png.size == source.size

    files = unzipped(download(api, api.post("{}/{}/exports".format(DATASETS, dataset.id),
                                            {'format': 'original_private', 'frames': [frame.name], 'visual': True},
                                            format='json')))
    assert sorted(files) == sorted([frame.name, visual.name])
    assert rjpeg.identifiers(files[visual.name]) == {}


def _saved(tmp_path, data):
    path = tmp_path / "copy.jpg"
    path.write_bytes(data)
    return path


def test_an_imported_orthophotos_curve_and_png_read_it_in_its_own_unit(api, monkeypatch):
    from dji_thermal_ui.analyzer import api as api_module
    from dji_thermal_ui.analyzer.raster.tiler import colormap_entries
    c, _ = converted(api)
    path, _band = mosaics.tab_raster(c, 'as_converted')
    # As an import leaves it: no mosaics of its own, its temperatures in the unit it was imported in
    c.orthophoto, c.mosaics = {'raster': os.path.relpath(path, c.data_dir()), 'unit': 'F'}, {}
    units = []
    monkeypatch.setattr(api_module.thermal_measure, 'mosaic_histogram', lambda _p, unit, _k: units.append(unit))
    api_module.mosaic_curve(c, 'webodm', path, 1, None, 10, 30, {'gamma': 1.0, 'equalize': True, 'sharpen': 0.0})
    shown = exports.mosaic_band_values
    monkeypatch.setattr(exports, 'mosaic_band_values',
                        lambda v, t, unit, correction: units.append(unit) or shown(v, t, unit, correction))
    adjust = {'gamma': 1.0, 'equalize': False, 'sharpen': 0.0}
    list(exports.mosaic_png(c, path, 1, {'view': {'adjust': adjust, 'isotherm': None}, 'correction': None, 'tab': 'webodm'},
                            colormap_entries(['gray'])[0]['color_map'], (10, 30), None))
    assert set(units) == {'F'}
