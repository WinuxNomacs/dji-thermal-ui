"""
Thermal palettes: the gradients themselves (checked against an independent interpolation), their registration, and
what the browser is sent of them.
"""

import numpy as np
import pytest
from django.test import RequestFactory
from rest_framework.exceptions import ValidationError

from dji_thermal_ui.analyzer.raster import tiler
from dji_thermal_ui.analyzer.raster.colormaps import THERMAL_COLORMAPS, THERMAL_STOPS, gradient_cmap


def oracle(stops):
    """numpy's own linear interpolation per channel"""
    xs = [p for p, _c in stops]
    x = np.arange(256) / 255.0
    return np.stack([np.interp(x, xs, [c[ch] for _p, c in stops]) for ch in range(3)], axis=1)


def luminance(rgb):
    return 0.299 * rgb[:, 0] + 0.587 * rgb[:, 1] + 0.114 * rgb[:, 2]


@pytest.mark.parametrize("name", THERMAL_STOPS)
def test_gradients_follow_their_stops(name):
    stops = THERMAL_STOPS[name]
    table = gradient_cmap(stops)
    assert sorted(table) == list(range(256))
    got = np.array([table[i][:3] for i in range(256)], dtype=float)
    np.testing.assert_allclose(got, oracle(stops), atol=0.5001)      # rounding only
    assert all(table[i][3] == 255 for i in range(256))
    assert table[0][:3] == stops[0][1]
    assert table[255][:3] == stops[-1][1]


@pytest.mark.parametrize("name", THERMAL_STOPS)
def test_gradients_get_brighter_with_the_temperature(name):
    lum = luminance(oracle(THERMAL_STOPS[name]))
    assert np.all(np.diff(lum) >= -1e-9)
    assert lum[0] < 30
    assert lum[-1] > 200


def test_a_gradient_with_a_single_segment():
    table = gradient_cmap([(0.0, (0, 0, 0)), (1.0, (255, 100, 0))])
    assert table[0] == (0, 0, 0, 255)
    assert table[255] == (255, 100, 0, 255)
    assert table[51][:3] == (51, 20, 0)


def test_the_palettes_and_the_difference_palettes_are_registered():
    for name in THERMAL_COLORMAPS + ["rdbu_r", "coolwarm", "bwr", "seismic"]:
        assert len(tiler.colormap.get(name)) == 256, name


def test_the_palette_tables_sent_to_the_browser_are_the_gradients():
    entries = tiler.colormap_entries(THERMAL_COLORMAPS)
    assert [e["key"] for e in entries] == THERMAL_COLORMAPS
    labels = {e["key"]: e["label"] for e in entries}
    assert (labels["ironbow"], labels["gray"], labels["gray_r"]) == ("Ironbow", "White hot", "Black hot")
    table = entries[0]["color_map"]
    rgb = np.array([[(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255] for v in table], dtype=float)
    np.testing.assert_allclose(rgb, oracle(THERMAL_STOPS["ironbow"]), atol=0.5001)


def test_rio_tilers_own_colour_maps_are_sent_as_their_colours():
    # their tables hold numpy uint8s: the colours were once lost in packing, leaving only the alpha
    gray, rdbu = tiler.colormap_entries(["gray", "rdbu_r"])
    assert (gray["color_map"][0], gray["color_map"][255]) == (0x000000FF, 0xFFFFFFFF)
    rgb = [((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255) for v in rdbu["color_map"]]
    assert rgb[0][2] > rgb[0][0] and rgb[255][0] > rgb[255][2]      # blue below, red above


def test_an_unknown_palette_is_a_validation_error():
    with pytest.raises(ValidationError):
        tiler.colormap_entries(["ironbow", "nope"])


def test_a_tile_etag_changes_with_the_raster_and_answers_304(tmp_path):
    raster = tmp_path / "r.tif"
    raster.write_bytes(b"a")
    request = RequestFactory().get("/data/1/2/3?emissivity=0.9")
    etag = tiler.raster_etag(request, str(raster))
    assert etag == tiler.raster_etag(request, str(raster))
    assert tiler.raster_etag(request, str(raster), "other") != etag
    assert tiler.not_modified(request, etag) is None
    again = RequestFactory().get("/data/1/2/3?emissivity=0.9", HTTP_IF_NONE_MATCH=etag)
    assert tiler.not_modified(again, etag).status_code == 304
    raster.write_bytes(b"bb")
    assert tiler.raster_etag(request, str(raster)) != etag


def test_rescale_is_parsed_or_refused():
    assert tiler.parse_rescale("-5,40.5") == [-5.0, 40.5]
    for bad in ["a,b", None]:
        with pytest.raises(ValidationError):
            tiler.parse_rescale(bad)
