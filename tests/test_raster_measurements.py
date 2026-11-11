"""What a drawn shape measures (analyzer/raster/measurements.py), and the statistics of a
region's pixels (analyzer/raster/stats.py)"""
import math

import numpy as np
import pytest
from pyproj import Transformer

from dji_thermal_ui.analyzer.raster import measurements as m
from dji_thermal_ui.analyzer.raster.stats import region_band_stats


def square(x0, y0, size):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size],
                                                [x0, y0]]]}


def test_a_polygon_measures_itself():
    shape = m.projected(square(0, 0, 2))
    assert m.inside("Polygon", shape).area == pytest.approx(4)


def test_a_point_measures_a_small_disc_and_a_line_a_strip():
    disc = m.inside("Point", m.projected({"type": "Point", "coordinates": [5, 5]}))
    assert disc.area == pytest.approx(math.pi * m.POINT_RADIUS ** 2, rel=0.01)
    strip = m.inside("LineString", m.projected({"type": "LineString", "coordinates": [[0, 0], [4, 0]]}))
    assert strip.area == pytest.approx(4 * 2 * m.LINE_HALF_WIDTH + math.pi * m.LINE_HALF_WIDTH ** 2, rel=0.01)


def test_a_polygon_keeps_its_holes():
    geometry = square(0, 0, 4)
    geometry["coordinates"].append([[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]])
    assert m.projected(geometry).area == pytest.approx(12)


def test_lon_lat_is_projected_into_metres():
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32632", always_xy=True)
    line = m.projected({"type": "LineString", "coordinates": [[9.0, 45.0], [9.0, 45.001]]}, to_utm)
    assert line.length == pytest.approx(111.1, abs=0.5)
    assert m.projected({"type": "Point", "coordinates": [9.0, 45.0]}, to_utm).x == pytest.approx(500000, abs=1)


def test_region_statistics_skip_the_masked_pixels():
    band = np.ma.masked_array(np.array([[10.0, 20.0], [30.0, 1000.0]]), mask=[[False, False], [False, True]])
    stats = region_band_stats(band, bins=4)
    assert (stats["valid_pixels"], stats["total_pixels"]) == (3, 4)
    assert (stats["min"], stats["max"], stats["mean"], stats["median"]) == (10.0, 30.0, 20.0, 20.0)
    assert stats["std"] == pytest.approx(np.std([10, 20, 30]))
    assert stats["percentiles"] == pytest.approx([10.4, 29.6])
    assert sum(stats["histogram"][0]) == 3
    assert len(stats["histogram"][1]) == 5
    assert region_band_stats(band, scale=2.0)["max"] == 60.0


def test_region_statistics_of_a_fully_masked_band_are_empty():
    stats = region_band_stats(np.ma.masked_all((3, 3)))
    assert (stats["valid_pixels"], stats["total_pixels"]) == (0, 9)
    assert stats["mean"] is None and stats["histogram"] is None
