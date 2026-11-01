# Mosaics

The viewer shows a dataset's mosaics, opened with **View mosaics** on its card or from the navigation pane.

## The tabs

Each tab's tooltip says what it shows.

- **Mosaic:** each pixel is one frame's own temperature, as the frames were converted.
- **Harmonized:** normalized, with one ambient and reflected temperature for every frame, and each frame's offset
  against its neighbours removed (the camera's drift between recalibrations), so the seams don't show as bands.
- **Source frame:** which frame each pixel comes from (the one that saw it closest to straight down), with a line
  along each seam between the frames (in the mosaic report too).
- **View angle:** how far from straight down each pixel was seen, in degrees.
- **Visual:** the [visual mosaic](datasets.md#the-outputs), when the dataset has one: the visual camera's images, each
  placed where its thermal frame is. Pointer info gives the Mosaic tab's temperatures, and a click opens the frames
  that saw the spot.
- **WebODM** and **Heights:** an orthophoto and a surface model brought back from
  [WebODM](webodm.md#bringing-the-results-here).

The viewer opens on Mosaic, or on Harmonized when the frames disagree (their offsets against their neighbours
spanning more than 3 °C over the middle 90% of them), with a notice saying so. A link that names a tab opens that one.

Under the mosaic is a street map or satellite imagery, chosen with the switch at the top right of the map (see
[The maps under the mosaics](maps.md)).

## The side panel

The panel is grouped under:

- **View:** the palette, the temperature range, **Image** (brightness and contrast, gamma, equalization and
  sharpening) and **Isotherm**. They are redrawn as their sliders are dragged. The colour scale is labelled with its
  range's ends.
- **Values:** **Pointer info** (the values under the cursor), **Parameters** and **This mosaic**.
- **Kept:** the saved [measurements](measuring.md) and the [findings](findings.md).
- **About.**

On a first visit Image, Parameters, This mosaic and The mosaic start folded, and each section then stays as it was
left.

## Pointer info

Pointer info gives the values under the cursor. A click keeps them and outlines the frame there; Escape or a second
click on that frame lets go of it.

## From the viewer

The viewer's header has **Frames** (the [frames explorer](frames.md)), **Compare with…** (the
[compare page](compare.md)), **Export PNG** (the mosaic as shown, with its saved measurements and colour scale, the
basemap left out), **Export…** (the mosaic whole, at full resolution: see [Exports](exports.md)) and
**Mosaic report** (see [Reports](reports.md#mosaic-report)).
