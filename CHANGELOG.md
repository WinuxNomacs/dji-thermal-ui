# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[PEP 440](https://peps.python.org/pep-0440/).

## [Unreleased]

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

### Changed

- Compare lists the conversions of the project first, and names the project of the others.

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
