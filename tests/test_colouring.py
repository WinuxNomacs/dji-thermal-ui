"""The server colours the images it exports byte for byte as the browser colours the values it sends
(frontend/src/map/colour.ts): both are checked against tests/fixtures/colouring.json, made from the browser's."""
import base64
import json
from pathlib import Path

import numpy as np
import pytest

from dji_thermal_ui.analyzer import colouring

FIXTURE = json.loads((Path(__file__).parent / 'fixtures' / 'colouring.json').read_text())


def coloured(case, first=0, stop=None):
    """The case's rows first..stop coloured from them and colouring.MARGIN rows on either side, as a strip is"""
    c = case['colouring']
    values = np.array([np.nan if v is None else v for v in case['values']], dtype=np.float32)
    values = values.reshape(case['height'], case['width'])
    stop = case['height'] if stop is None else stop
    top = max(0, first - colouring.MARGIN)
    window = values[top:stop + colouring.MARGIN]
    return colouring.colour(window, c['colors'], c.get('range'), c.get('shares'), c.get('sharpen') or 0,
                            c.get('isotherm'), bool(c.get('index')), case['sigma'], (first - top, stop - top),
                            bands=(lambda b: b and (b['mode'], b['width'], b['origin']))(c.get('bands')))


@pytest.mark.parametrize('case', FIXTURE['cases'], ids=lambda c: c['name'])
def test_values_are_coloured_as_the_browser_colours_them(case):
    want = np.frombuffer(base64.b64decode(case['rgba']), np.uint8).reshape(case['height'], case['width'], 4)
    assert np.array_equal(coloured(case), want)


@pytest.mark.parametrize('case', FIXTURE['cases'], ids=lambda c: c['name'])
def test_an_image_coloured_in_strips_is_the_image_coloured_whole(case):
    whole = coloured(case)
    strips = [coloured(case, first, min(first + 5, case['height'])) for first in range(0, case['height'], 5)]
    assert np.array_equal(np.concatenate(strips), whole)
