"""
Values coloured as the browser colours them (colourValues in frontend/src/map/colour.ts), for the images the exports
make: over a range, toned by the curve's shares, sharpened with an unsharp mask, in bands (stepped: each band one
colour; banded: every other band darkened), an isotherm's pixels in the palette and the rest in grey, or each source
frame in its own colour. The same values give the same bytes on both sides:
tests/fixtures/colouring.json holds what colourValues makes, and both test suites check against it.
"""
import numpy as np

# The palette's entries along the range, the tone curve baked into them, and the server's 256 levels of a palette
TONE_STEPS = 1024
LEVELS = 255
# The unsharp mask's sigma, in the pixels of the values drawn: as the browser clamps it
SIGMA_LIMITS = (0.5, 4.0)
# A binomial blur: its variance is the spacing's square
TAPS = (-2, -1, 0, 1, 2)
WEIGHTS = (1, 4, 6, 4, 1)
# Banded: every other band's colours this much darker
BAND_DARKEN = 0.7
# The pixels the unsharp mask reads around one: a strip of an image is coloured with this many more rows on each side
MARGIN = int(np.floor(TAPS[-1] * SIGMA_LIMITS[1] + 0.5))


def js_round(x):
    """Math.round: halves up"""
    return np.floor(np.asarray(x, dtype=np.float64) + 0.5)


def rgb(encoded):
    """The palette as the API gives it (0xRRGGBBAA integers) as an (n, 3) uint8 array"""
    c = np.asarray(encoded, dtype=np.uint64) & 0xFFFFFFFF
    return np.stack([(c >> 24) & 255, (c >> 16) & 255, (c >> 8) & 255], axis=-1).astype(np.uint8)


def toned(u, shares=None):
    """Shares of the range (0 to 1) toned: along shares (interpolated between its samples), else as they are"""
    x = np.clip(np.asarray(u, dtype=np.float64), 0.0, 1.0)
    if shares is None or len(shares) < 2:
        return x
    s = np.asarray(shares, dtype=np.float64)
    at = x * (len(s) - 1)
    i = np.minimum(np.floor(at), len(s) - 2).astype(np.int64)
    f = at - i
    return s[i] * (1 - f) + s[i + 1] * f


def toned_palette(colors, shares=None, grey=False):
    """The palette as drawn along the range: TONE_STEPS colours ((TONE_STEPS, 3) uint8), each the level (0 to 255) of
    its toned share in the palette, or in grey"""
    levels = js_round(toned(np.arange(TONE_STEPS) / (TONE_STEPS - 1), shares) * LEVELS).astype(np.int64)
    if grey:
        return np.repeat(levels[:, None], 3, axis=1).astype(np.uint8)
    palette = rgb(colors)
    if not len(palette):
        return np.zeros((TONE_STEPS, 3), np.uint8)
    return palette[js_round(levels * (len(palette) - 1) / LEVELS).astype(np.int64)]


def isotherm_range(isotherm):
    """thermal_measure.parse_isotherm's (mode, low, high) as the values inside it, as the browser takes it, or None"""
    if not isotherm:
        return None
    _mode, low, high = isotherm
    return (-3e38 if low is None else low, 3e38 if high is None else high)


def colour(values, colors, value_range=None, shares=None, sharpen=0.0, isotherm=None, index=False, sigma=1.0,
           rows=None, bands=None):
    """
    Values (a 2-D array, NaN or not finite where there are none) coloured: an (h, w, 4) uint8 RGBA image, clear where
    there are no values.

    :param colors: the palette, as the API gives it (0xRRGGBBAA)
    :param value_range: the values at either end of the palette (low, high)
    :param shares: the palette's share at values evenly across the range (None: linear)
    :param sharpen: the unsharp mask's amount (0: none)
    :param isotherm: the values drawn in the palette, (low, high), the rest in grey (None: all in the palette)
    :param index: each value its own colour (the source frames): colors[value mod length]
    :param sigma: the unsharp mask's, in the pixels drawn
    :param rows: (first, stop): only these rows are coloured (the others are the unsharp mask's margin)
    :param bands: (mode, width, origin): the values in bands width wide, one's edge at origin (the values' unit);
        stepped: each band the colour of its middle; banded: every other band darkened (None: neither)
    """
    v = np.asarray(values, dtype=np.float32).astype(np.float64)
    first, stop = rows or (0, v.shape[0])
    has = np.isfinite(v)
    out = np.zeros((stop - first, v.shape[1], 4), np.uint8)
    here = has[first:stop]
    if index:
        palette = rgb(colors)
        if len(palette):
            n = len(palette)
            at = (js_round(np.where(here, v[first:stop], 0)).astype(np.int64) % n + n) % n
            out[..., :3] = palette[at]
            out[..., 3] = 255
            out[~here] = 0
        return out

    low, high = value_range or (0.0, 1.0)
    span = (high - low) or 1.0
    with np.errstate(invalid='ignore'):
        share = np.clip((np.where(has, v, low) - low) / span, 0.0, 1.0)
    u = share[first:stop]
    if sharpen > 0:
        s = float(np.clip(sigma, *SIGMA_LIMITS))
        h, w = v.shape
        total = np.zeros_like(u)
        weight = np.zeros_like(u)
        ys = np.arange(first, stop)
        xs = np.arange(w)
        for j, dy in enumerate(TAPS):
            for i, dx in enumerate(TAPS):
                oy, ox = int(js_round(dy * s)), int(js_round(dx * s))
                ny, nx = ys + oy, xs + ox
                iny, inx = (ny >= 0) & (ny < h), (nx >= 0) & (nx < w)
                taken = np.zeros_like(u, dtype=bool)
                taken[np.ix_(iny, inx)] = has[np.ix_(ny[iny], nx[inx])]
                n = np.zeros_like(u)
                n[np.ix_(iny, inx)] = share[np.ix_(ny[iny], nx[inx])]
                wt = WEIGHTS[i] * WEIGHTS[j]
                total = total + np.where(taken, wt * n, 0.0)
                weight = weight + np.where(taken, wt, 0)
        with np.errstate(invalid='ignore', divide='ignore'):
            u = np.clip(u + sharpen * (u - total / weight), 0.0, 1.0)
    odd = None
    if bands:
        mode, width, origin = bands
        with np.errstate(invalid='ignore'):
            band = np.floor((np.where(here, v[first:stop], low) - origin) / width)     # its own temperature's band
        if mode == 'stepped':
            u = np.clip((origin + (band + 0.5) * width - low) / span, 0.0, 1.0)
        else:
            odd = band % 2 == 1
    step = js_round(np.where(here, u, 0) * (TONE_STEPS - 1)).astype(np.int64)
    palette = toned_palette(colors, shares)
    out[..., :3] = palette[step]
    if isotherm:
        grey = toned_palette(colors, shares, grey=True)
        vals = v[first:stop]
        with np.errstate(invalid='ignore'):
            outside = ~((vals >= isotherm[0]) & (vals <= isotherm[1]))
        out[..., :3] = np.where(outside[..., None], grey[step], out[..., :3])
    if odd is not None:
        out[..., :3] = np.where(odd[..., None], js_round(out[..., :3] * BAND_DARKEN), out[..., :3])
    out[..., 3] = 255
    out[~here] = 0
    return out
