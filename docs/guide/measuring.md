# Measuring

Spots, lines, areas, boxes, circles and Delta Ts are measured on mosaics, in the [viewer](mosaics.md) and on the
[compare page](compare.md), and on single frames, on the [frame page](frames.md).

![A box measured on a mosaic, with its card](../assets/screenshots/viewer-measure.png)

## Drawing a shape

The drawing tools are on the map's top edge, beside the zoom buttons. A shape drawn is measured in a card on the map,
closed with × or Escape. The card gives the temperature at a spot, or a shape's mean, min, max and standard
deviation, its surroundings and the ΔT against them, the share inside the isotherm, its pixels, and a line's profile
or an area's histogram.

On the card:

- **Save measurement** keeps it, listed in the side panel's Saved measurements.
- **Keep as finding**, for a spot, an area or a Delta T of a mosaic: see [Findings](findings.md).
- **Source frames**, for a spot, an area or a Delta T of a mosaic: see below.

## Delta T

The **Delta T** tool, after Circle, compares two spots. Click the first spot, then the second: the tool ends on the
second click, and the card gives the line's length, the temperature of each spot (**First spot**, **Second spot**,
each the temperature of the pixel under it, as the cursor's own readout gives it, so a small hot or cold spot reads
true) and **ΔT**, the second's temperature
minus the first's. A Delta T is drawn as a line with a ring at each end. It has no isotherm, and it isn't offered on
the Source frame tab or on a visual mosaic, which have no temperatures.

A saved Delta T is listed with its ΔT and both temperatures, for example "ΔT +1.5 °C (20.0 °C → 21.5 °C)", and the
CSV gives them in its **First spot**, **Second spot** and **ΔT** columns. Its source frames are those that saw a strip
along its line, as wide as a spot's disc, outlined in each frame.

On a frame page, the Thermal/Visual/Both switch shows the frame's visual image in its place or beside it, with the
same shapes and the cursor on it, and measures the thermal frame under them.

## On a visual mosaic

The dataset of a [flight of visual images only](datasets.md#a-flight-of-visual-images-only) has no temperatures. In
its viewer, the card of a line gives its length, and that of an area, box or circle its area and perimeter, in
metres on the mosaic. They are measured on the mosaic, so they are only as exact as it is (see
[Mosaics](mosaics.md)). The card has **Save measurement**, **Keep as finding** and **Source frames**, as on a thermal
mosaic, and its saved measurements export as CSV and GeoJSON with their length, area and perimeter. A spot opens the
frames that saw it.

## Saved measurements

Saved measurements can be compared, measured again with other settings, and exported as CSV and GeoJSON. Each can
have a comment, shown in the viewer's list, in the CSV and GeoJSON, and in the
[mosaic report](reports.md#mosaic-report).

## Source frames

The source frames window shows every frame that saw a spot, an area or a [Delta T](#delta-t) of a mosaic, the one
the mosaic used first, each with its time and view angle and the spot marked or the area (or the Delta T's strip)
outlined in it, in the thermal frame or, with the Thermal/Visual switch, its visual image.

It opens from:

- **Source frames** on a measurement's card;
- a spot or an area drawn (or a click) on the Source frame or Visual tab;
- a saved measurement's;
- on the compare page, a spot or an area drawn with the tools on a pane's map.

A [finding](findings.md) can be kept from it. Mosaics built before version 0.5.0 list only the frames they used:
build them again to list every frame.
