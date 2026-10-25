# Copied from WebODM, as forked in LuxODM (commit a2a81052): the shapes measured of app/measurements.py, on shapely
# instead of GEOS (the inspections' measurements left out).
# Copyright (C) the WebODM authors (OpenDroneMap) and the LuxODM authors.
# Licensed under the GNU Affero General Public License v3.0 (see LICENSE).
import math

from shapely.geometry import LineString, Point, Polygon

POINT_RADIUS = 0.25         # m: a point's temperature is the mean of this disc (one bad pixel doesn't decide it)
LINE_HALF_WIDTH = 0.25      # m: a line's temperatures are those of a strip this wide on each side
RING_MIN = 1.0              # m: the surroundings, from the outline out to the area's size, within these
RING_MAX = 3.0


def _rings(geometry):
    """The rings of a GeoJSON Point / LineString / Polygon's coordinates (a point: one ring of one coordinate)"""
    if geometry['type'] == 'Point':
        return [[geometry['coordinates']]]
    if geometry['type'] == 'LineString':
        return [geometry['coordinates']]
    return geometry['coordinates']


def projected(geometry, to_utm=None):
    """A GeoJSON Point, LineString or Polygon (lon/lat) in metres, as shapely (the coordinates are transformed
    here, with to_utm, a pyproj Transformer); without to_utm, its coordinates as they are"""
    move = to_utm.transform if to_utm is not None else (lambda x, y: (x, y))
    rings = [[move(c[0], c[1]) for c in ring] for ring in _rings(geometry)]
    if geometry['type'] == 'Point':
        return Point(*rings[0][0])
    if geometry['type'] == 'LineString':
        return LineString(rings[0])
    return Polygon(rings[0], rings[1:])


def inside_and_ring(geometry_type, shape, point_radius=POINT_RADIUS, line_half_width=LINE_HALF_WIDTH,
                    ring_min=RING_MIN, ring_max=RING_MAX):
    """
    What a projected shape measures (a point: a small disc around it, a line: a narrow strip along it, a polygon:
    itself) and its surroundings (a ring around that), as shapely polygons in the shape's units
    """
    inside = {'Point': lambda: shape.buffer(point_radius),
              'LineString': lambda: shape.buffer(line_half_width)}.get(geometry_type, lambda: shape)()
    # A line's surroundings: a band beside it (its strip's size says nothing of how far around to look)
    width = ring_min if geometry_type == 'LineString' else min(ring_max, max(ring_min, math.sqrt(inside.area)))
    return inside, inside.buffer(width).difference(inside)
