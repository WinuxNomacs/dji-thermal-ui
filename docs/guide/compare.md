# Compare

The compare page shows two datasets side by side, one over the other, or their difference, from any flight, the
project's listed first. Open it with **Compare with…** in the viewer's header or on a dataset's card.

![The compare page: the visual mosaic over the thermal one in pane A, the thermal mosaic in pane B](../assets/screenshots/compare-overlay.png)

- **A pane** shows a dataset's mosaic, or its visual mosaic. The dataset of a
  [flight of visual images only](datasets.md#a-flight-of-visual-images-only) is listed with its visual mosaic alone:
  its pane has no values under the cursor, a spot or an area drawn on it opens its visual photos, and it has no
  difference. An [imported dataset](mosaics.md#an-imported-dataset) is listed with its WebODM tab, or its visual
  mosaic alone; a spot or an area drawn on it opens the photos found from its task's cameras.
- **Overlay (A over B)** draws pane A's mosaic over pane B's in one pane, faded with an opacity slider and cut at a
  swipe line dragged across it: visual over thermal, or two thermal mosaics.
- **The difference** of two mosaics, in one pane.

The header's **Link the panes**, **Shared palette** and **Findings** stay pressed in, with a check, while they are on.

Each pane draws its flights' [findings](findings.md#on-the-compare-page). The measuring tools on each pane's map (Spot,
Line, Area, Box, Circle and Delta T) measure a shape on both mosaics at once, with A − B, in a card that saves it on
both datasets and opens its [source frames](measuring.md#source-frames); an isotherm is shared by both panes. See
[Measuring › On the compare page](measuring.md#on-the-compare-page).
