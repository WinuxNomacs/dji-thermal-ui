# Copied from WebODM, as forked in LuxODM (commit a2a81052): region_band_stats of app/raster_stats.py.
# Copyright (C) the WebODM authors (OpenDroneMap) and the LuxODM authors.
# Licensed under the GNU Affero General Public License v3.0 (see LICENSE).
import numpy as np


def region_band_stats(band, percentiles=(2.0, 98.0), bins=64, scale=1.0):
    """
    Summary statistics of a single masked band, for point/region queries.

    Unlike raster_stats() (which follows rio-tiler 2.x's layer-metadata shape) this includes
    the mean, median and pixel counts, and tolerates a fully-masked band.

    :param band: masked 2D array (masked = outside the region or no data)
    :param percentiles: percentiles to compute
    :param bins: number of histogram bins
    :param scale: multiplier applied to all values (e.g. feet to meters for DEMs)
    :return: dict with valid_pixels, total_pixels and (None when no valid pixel) min, max, mean,
             std, median, percentiles, histogram [counts, edges]
    """
    valid = np.ma.getdata(band)[~np.ma.getmaskarray(band)].astype("float64") * scale
    stats = {
        "valid_pixels": int(valid.size),
        "total_pixels": int(band.size),
        "min": None, "max": None, "mean": None, "std": None, "median": None,
        "percentiles": None, "histogram": None,
    }
    if valid.size == 0:
        return stats

    counts, edges = np.histogram(valid, bins=bins)
    stats.update(
        min=float(valid.min()),
        max=float(valid.max()),
        mean=float(valid.mean()),
        std=float(valid.std()),
        median=float(np.median(valid)),
        percentiles=[float(v) for v in np.percentile(valid, percentiles)],
        histogram=[counts.tolist(), edges.tolist()],
    )
    return stats
