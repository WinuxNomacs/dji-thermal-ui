# Copied from WebODM, as forked in LuxODM (commit a2a81052): app/thermal_correction.py, unchanged.
# Copyright (C) the WebODM authors (OpenDroneMap) and the LuxODM authors.
# Licensed under the GNU Affero General Public License v3.0 (see LICENSE).
"""
Display-time correction of thermal (Celsius) orthophoto values for emissivity, atmospheric
transmission and the reflected/atmospheric temperatures.

The orthophoto holds the temperatures the camera reported with the parameters it was captured
with (the "baseline"). Radiometry is done with the broadband model

    W(T) = T^4                                     (Stefan-Boltzmann, temperatures in kelvin)
    W_sensor = tau * eps * W(T_obj) + tau * (1 - eps) * W(T_refl) + (1 - tau) * W(T_atm)

The baseline parameters are used to recover W_sensor from the stored temperature, then the
requested parameters are used to solve for the object temperature again. When the requested
parameters equal the baseline, the expression is left untouched.

This is an approximation of the camera's spectral band model, intended for tuning how a surface
looks, not for calibrated measurements.
"""
import re

KELVIN = 273.15

# What the DJI M4T reports for its own calibration (dirp_get_measurement_params on real frames):
# emissivity 0.91, reflected temperature 23.25 C, transmission ~1 at the usual flight distances.
# The atmospheric temperature does not matter while the transmission is 1.
DEFAULT_BASELINE = (0.91, 1.0, 23.25, 20.0)

NAMES = ('emissivity', 'transmission', 'reflected', 'atmospheric')


class InvalidCorrection(ValueError):
    pass


def parse_correction(value):
    """
    Parses "e,t,r,a" or "e,t,r,a,e0,t0,r0,a0" (emissivity, transmission, reflected temperature C,
    atmospheric temperature C; then the same four for the baseline).

    :return: (params, baseline) as 4-tuples of floats, or None when value is empty
    """
    if value is None or value == '':
        return None

    try:
        nums = [float(v) for v in value.split(',')]
    except ValueError:
        raise InvalidCorrection("Invalid thermal_correction value")  # noqa: B904

    if len(nums) not in (4, 8):
        raise InvalidCorrection("thermal_correction needs 4 or 8 comma separated numbers")

    params = tuple(nums[:4])
    baseline = tuple(nums[4:]) if len(nums) == 8 else DEFAULT_BASELINE

    for p in (params, baseline):
        for i, name in enumerate(NAMES[:2]):
            if not (0.01 <= p[i] <= 1.0):
                raise InvalidCorrection("{} must be between 0.01 and 1".format(name))
        for i, name in enumerate(NAMES[2:], 2):
            if not (-100.0 <= p[i] <= 1000.0):
                raise InvalidCorrection("{} temperature must be between -100 and 1000 C".format(name))

    return params, baseline


def is_identity(params, baseline):
    return all(abs(a - b) < 1e-9 for a, b in zip(params, baseline))


def gain_and_offset(params, baseline):
    """The object's radiance W(T) under params is gain * W(T under baseline) + offset"""
    e, t, r, a = params
    e0, t0, r0, a0 = baseline
    k = lambda c: (c + KELVIN) ** 4

    gain = (t0 * e0) / (t * e)
    offset = (t0 * (1 - e0) * k(r0) + (1 - t0) * k(a0) - t * (1 - e) * k(r) - (1 - t) * k(a)) / (t * e)
    return gain, offset


def corrected_celsius(band, params, baseline):
    """
    numexpr expression of the corrected temperature (Celsius) of `band` (a Celsius value).
    """
    gain, offset = gain_and_offset(params, baseline)

    w = "({gain!r}*({band}+{kelvin})**4+({offset!r}))".format(gain=gain, band=band, kelvin=KELVIN, offset=offset)
    return "(where({w}>0,{w},0)**0.25-{kelvin})".format(w=w, kelvin=KELVIN)


def corrected_array(values, params, baseline):
    """corrected_celsius on a numpy array of Celsius values (NaN stays NaN)"""
    import numpy as np
    if is_identity(params, baseline):
        return values
    gain, offset = gain_and_offset(params, baseline)
    values = np.asarray(values, dtype=np.float64)
    w = gain * (values + KELVIN) ** 4 + offset
    return np.where(np.isfinite(values), np.where(w > 0, w, 0) ** 0.25 - KELVIN, np.nan)


def apply_correction(expr, correction, band='b1'):
    """
    Wraps every use of the (single) Celsius band `band` in expr with the correction.

    :param correction: result of parse_correction (or None)
    """
    if expr is None or correction is None:
        return expr

    params, baseline = correction
    if is_identity(params, baseline):
        return expr

    if not re.search(r'\b{}\b'.format(band), expr):
        return expr

    return re.sub(r'\b{}\b'.format(band), lambda m: corrected_celsius(band, params, baseline), expr)
