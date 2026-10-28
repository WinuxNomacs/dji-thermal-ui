# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[PEP 440](https://peps.python.org/pep-0440/).

## [Unreleased]

### Added

- A dataset's report, to print or save as PDF (A4 or Letter): the dataset's figures, a map of where its frames were
  taken with its findings numbered, the coverage, the problems found, the frames' settings and temperatures summed
  up, the conversions, the findings with their kept frames' thumbnails, notes, and a table of every frame when
  appended. Its title, author, date and notes are typed on the page and saved on the dataset; the last author typed
  fills in new reports. Opened from the dataset page's Report button and the navigation pane.

### Changed

- Pages always print light, whatever the theme.

## [0.6.0] - 2026-10-27

### Added

- Findings: a spot or an area of a mosaic saved on its dataset, with a name, notes, a severity and a status, its
  temperatures and the frames that saw it. They are saved from the source frames window or a saved spot or area
  measurement, drawn on the viewer's map with a tag in their severity's colour, listed in the viewer's panel, shown
  or hidden all together or one by one (kept in the link), changed and deleted. The projects, datasets and dataset
  pages count them, and a project's page lists its datasets' findings, each opening the viewer. On the compare page
  each pane draws its datasets' findings (one switch for both, kept in the link), opens one with a click or a link
  and changes it, and saves a spot or an area drawn in it on its mosaic's dataset.

### Changed

- The compare page's source frames take a spot or an area (Spot and Area tools in each pane, as in the viewer), and
  the spot tool is put away after one spot.

### Fixed

- A spot or an area far from a mosaic (in another UTM zone, or nowhere near) measures nothing instead of failing.

## [0.5.1] - 2026-10-27

### Changed

- The image is redrawn while the brightness, contrast, gamma or sharpening slider is dragged, on the viewer, the
  frame page and the compare page, rather than when it is let go. The sliders' steps are about 5% finer, with the
  same ends.
- The colour scale, and the legend of a PNG export, are labelled with the temperatures at their two ends, with round
  values between them.

## [0.5.0] - 2026-10-27

### Added

- Projects: a site's datasets together, with a name, a description and a location. The projects page is the new
  home page; a project's page shows where each of its datasets was flown on a map, and lists its datasets. A dataset
  is made in the project it was started from, and can be moved to another. Deleting a project deletes its datasets,
  after saying how many there are and how much disk space is freed.
- The datasets made before projects are moved into a "Default Project", which can be renamed and described. One is
  made again whenever no project is left.
- A project's location: an address or a place searched for on OpenStreetMap's Nominatim, or a point clicked on the
  map and named by its address, shown on the project's map. The app's server asks Nominatim, as the app, at most once
  a second.
- A navigation pane on the left of every page: the projects, their datasets and each conversion's mosaics, frames
  and compare page, and User Preferences. Each level folds and the whole pane hides, both kept for the next visit;
  the page shown is unfolded to and marked. On a narrow screen it opens over the page.
- User Preferences, a page with the unit and the theme (still in the header too) and the locale dates and times are
  written in: the computer's, or one chosen from a list.
- A flight's capture times are shown in the time where it was flown, labelled with its time zone, found from each
  frame's local capture time and DJI's UTC time of exposure (now kept by the analysis). A dataset analyzed before
  says to analyze it again; one whose images do not record both times says the time zone is unknown.
- Source frames: a window over the viewer showing every frame that saw a spot or an area of the mosaic, the one the
  mosaic used first, with its time and view angle, and the spot marked or the area outlined in the frame. It opens
  from the Source frames tool, a click on the Source frame tab, or a spot or area measurement's "Source frames"
  button; it is moved by its title, and ← and → step through the frames. The API is
  `POST …/mosaics/<tab>/sources`. Mosaics built before list only the frames they used, and say to build them again.

### Changed

- The compare page's Picked point panel is replaced by the source frames window, with A's and B's frames for a
  difference.
- Compare lists the conversions of the project first, and names the project of the others.
- dji-thermal-cli 1.5.0: a mosaic built now keeps how each of its frames saw the ground, for the source frames
  pop-out to come. Mosaics built before keep working.

## [0.4.0] - 2026-10-27

### Added

- Mapbox's satellite imagery under the mosaics, with your own Mapbox token: "Mapbox Satellite: add a token…" in the
  map's basemap switch says how to get one and saves it in the app, or set `MAPBOX_API_TOKEN` in the environment or
  a `.env` file. Only public tokens (`pk.`) are taken; the Mapbox wordmark and attribution show while it is shown.

### Changed

- Esri's satellite layer asks Esri which tiles exist and stretches the deepest one it has, instead of showing "Map
  data not yet available" when zoomed in further.

## [0.3.0] - 2026-10-27

### Changed

- The viewer, compare and frame pages use OpenLayers 10.11.0 instead of Leaflet. The server sends a mosaic's
  tiles, a difference and a frame as their float32 values, and the browser colours them with WebGL. Changing the
  palette, range, gamma, brightness, contrast, equalization, isotherm or sharpening redraws at once, with no new
  tiles.

### Removed

- The API's PNG tiles (`mosaics/<tab>/tiles/`, `mosaics/<tab>/difference/tiles/`) and frame image
  (`frame/image`), replaced by `mosaics/<tab>/data/`, `mosaics/<tab>/difference/data/` and `frame/data`. scipy is
  no longer a dependency.

## [0.2.0] - 2026-10-27

### Changed

- The pages are rebuilt in TypeScript and Preact, with Leaflet 1.9.4, and built with Vite. Bootstrap and Font
  Awesome are gone: the app has its own stylesheet.
- Light and dark pages, or the computer's own, chosen in the header.

### Fixed

- The legends of the gray, rainbow, hot, magma, inferno, plasma, viridis and jet colour maps, and of the
  difference's, were drawn black: their colours were lost when sent to the page.

## [0.1.0] - 2026-10-25

The first release: the Thermal Analyzer from LuxODM's `thermal-analyzer` plugin (0.15.0), as a standalone app.

- The `dji-thermal-ui` command serves the app on 127.0.0.1 and opens the browser (`--data-dir`, `--port`,
  `--no-browser`). The database, secret key and datasets are kept in the user data folder.
- Everything the plugin did except processing with ODM: datasets, analysis, conversions, mosaics, measurements,
  compare, preferences and downloads, with dji-thermal-cli 1.4.0.
- Datasets are top level, with no projects, accounts, permissions, sharing or quota. Any folder can be used in
  place.
- Analyses, conversions and mosaics run in a local job runner instead of Celery. A job left running when the
  server stopped is marked as interrupted.
- Temperatures are shown in °F, °C or K, chosen in the header.
- The pages use stock Bootstrap 3.4.1 and Font Awesome Free 5.15.4, vendored with Leaflet 1.3.1, so nothing is
  loaded from a CDN.
- Runs on Linux and Windows, with Python 3.12 or newer.
