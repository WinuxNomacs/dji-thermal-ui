"""
The display-time thermal correction (analyzer/raster/thermal_correction.py).

The oracle is the forward radiometric model itself: the corrected temperature, seen through the requested
emissivity/transmission/reflected/atmospheric parameters, must produce the same sensor radiance as the stored
temperature seen through the baseline parameters.
"""
import numexpr
import numpy as np
import pytest

from dji_thermal_ui.analyzer.raster import thermal_correction as tc

K = 273.15


def sensor_radiance(t_obj, params):
    """Broadband model, temperatures in C in, radiance (K^4) out"""
    e, t, r, a = params
    return t * e * (t_obj + K) ** 4 + t * (1 - e) * (r + K) ** 4 + (1 - t) * (a + K) ** 4


def evaluate(expr, values):
    return numexpr.evaluate(expr, {"b1": np.asarray(values, dtype=np.float64)})


CASES = [
    (0.95, 1.0, 23.25, 20.0),
    (0.60, 1.0, 23.25, 20.0),
    (0.91, 0.80, 23.25, 5.0),
    (0.30, 0.70, -10.0, 35.0),
    (1.0, 1.0, 0.0, 0.0),
]


def test_parse():
    assert tc.parse_correction(None) is None
    assert tc.parse_correction("") is None
    params, baseline = tc.parse_correction("0.95,0.9,21,18")
    assert params == (0.95, 0.9, 21.0, 18.0)
    assert baseline == tc.DEFAULT_BASELINE
    params, baseline = tc.parse_correction("0.95,0.9,21,18,0.97,1,25,25")
    assert baseline == (0.97, 1.0, 25.0, 25.0)


@pytest.mark.parametrize("bad", ["a,b,c,d", "1,2,3", "0,1,20,20", "1.5,1,20,20", "0.9,0,20,20", "0.9,1.2,20,20",
                                 "0.9,1,2000,20", "0.9,1,20,-500", "0.9,1,20,20,0.9,1,20", "0.9,1,20,nan1",
                                 "0.9,1,nan,20"])
def test_parse_rejects_bad_values(bad):
    with pytest.raises(tc.InvalidCorrection):
        tc.parse_correction(bad)


def test_baseline_leaves_the_expression_untouched():
    c = tc.parse_correction(",".join(str(v) for v in tc.DEFAULT_BASELINE))
    assert tc.apply_correction("b1", c) == "b1"
    assert tc.apply_correction("b1*1.8+32", c) == "b1*1.8+32"
    assert tc.apply_correction("b1*1.8+32", None) == "b1*1.8+32"
    assert tc.apply_correction(None, c) is None


@pytest.mark.parametrize("case", CASES)
def test_corrected_temperature_conserves_sensor_radiance(case):
    stored = np.array([-20.0, 0.0, 14.0, 23.25, 35.4, 80.0, 250.0])
    c = tc.parse_correction(",".join(str(v) for v in case))
    corrected = evaluate(tc.apply_correction("b1", c), stored)
    e, t, r, a = case
    # Where the requested parameters cannot explain the radiance at all (it would have to be negative) the result
    # is clamped: only check the physically possible points
    needed = (sensor_radiance(stored, tc.DEFAULT_BASELINE) - t * (1 - e) * (r + K) ** 4
              - (1 - t) * (a + K) ** 4) / (t * e)
    possible = needed > 0
    assert possible.sum() >= 5
    np.testing.assert_allclose(sensor_radiance(corrected, case)[possible],
                               sensor_radiance(stored, tc.DEFAULT_BASELINE)[possible], rtol=1e-9)
    np.testing.assert_allclose(corrected[~possible], -K)


def test_lower_emissivity_raises_a_surface_that_looks_cooler_than_the_reflection():
    # Colder than the reflected temperature: less emissivity means more of what we see is reflection, so the object
    # itself must be even colder; hotter than it: the object must be hotter
    c = tc.parse_correction("0.5,1,23.25,20")
    cold, hot = evaluate(tc.apply_correction("b1", c), [10.0, 40.0])
    assert cold < 10.0
    assert hot > 40.0


def test_wraps_the_band_inside_conversion_formulas():
    c = tc.parse_correction("0.8,0.9,15,10")
    celsius = evaluate(tc.apply_correction("b1", c), [12.0, 30.0])
    fahrenheit = evaluate(tc.apply_correction("b1*1.8+32", c), [12.0, 30.0])
    np.testing.assert_allclose(fahrenheit, celsius * 1.8 + 32, rtol=1e-9)
    kelvin = evaluate(tc.apply_correction("b1+273.15", c), [12.0, 30.0])
    np.testing.assert_allclose(kelvin, celsius + 273.15, rtol=1e-9)


def test_impossible_radiance_does_not_produce_nan():
    c = tc.parse_correction("0.05,0.05,900,-90")
    out = evaluate(tc.apply_correction("b1", c), [-50.0, 0.0, 30.0])
    assert np.all(np.isfinite(out))


@pytest.mark.parametrize("case", CASES)
def test_arrays_are_corrected_as_the_expression_corrects_them_keeping_no_data(case):
    stored = np.array([-20.0, 0.0, 14.0, 23.25, 35.4, 80.0, np.nan])
    params, baseline = tc.parse_correction(",".join(str(v) for v in case))
    out = tc.corrected_array(stored, params, baseline)
    np.testing.assert_allclose(out[:-1], evaluate(tc.apply_correction("b1", (params, baseline)), stored[:-1]),
                               rtol=1e-9)
    assert np.isnan(out[-1])


def test_the_baseline_leaves_an_array_as_it_is():
    stored = np.array([-20.0, 0.0, 14.0, np.nan])
    assert tc.is_identity(tc.DEFAULT_BASELINE, tc.DEFAULT_BASELINE)
    np.testing.assert_array_equal(tc.corrected_array(stored, tc.DEFAULT_BASELINE, tc.DEFAULT_BASELINE), stored)
