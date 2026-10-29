# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[PEP 440](https://peps.python.org/pep-0440/).

## [Unreleased]

### Changed

- The Mapbox token moves to a System Settings page of its own (System Settings in the navigation pane is now a link
  to it, which also folds or unfolds it to Storage). The basemap switch no longer offers to add or change it. A new token is
  checked with Mapbox (one tile asked for) before it is saved, and the reason is shown when Mapbox refuses it. It is
  kept as `MAPBOX_API_TOKEN` in a `.env` file, in place of the one there (the file it was read from, else the data
  folder's), and is no longer kept in the preferences: a token saved there by an earlier version is moved to the
  data folder's `.env` when the app starts. A token in the environment is shown, and is changed there.

### Fixed

- The Convert tab's settings, once opened with Edit settings, fold away again: the button stays, as Hide settings,
  and the values chosen are kept.

### Added

- A preferred basemap in User Preferences › Map: every map (the viewer, the compare page, the project maps, the
  location picker and the dataset report) starts with ESRI Satellite, OpenStreetMap, Mapbox Satellite (once it has a
  token) or none, and can still switch to another. ESRI Satellite stays the default, and a preferred Mapbox whose
  token is gone or refused goes back to it.
- A preferred palette in User Preferences: the viewer, the frame explorer, the compare page and the mosaic report
  start with it (a DJI palette where the flight's images carry it), and can still switch to another. "As each
  flight's images", the default, keeps the palette they started with before. A small made-up thermal scene beside
  the choice shows the palette, with its scale.
- A small tab on the navigation pane's edge, near the top, hides and shows the pane in one click (beside the
  header's menu button, which still does too); with the pane hidden it waits at the page's left edge.
- System Settings › Storage, below User Preferences in the navigation pane (System Settings folds away, by its name
  or its chevron, and unfolds on the Storage page): the data folder's path, its size on disk
  as measured now and the free space on its drive, broken down by project and flight, with the database, files left
  behind by flights no longer there, and the rest. A flight read in place says how much its images take where they
  are.
- Moving the data folder from System Settings › Storage: a folder typed in is checked (new, empty or another data
  folder of the app; writable; room on its drive; no job running), then the server restarts and moves the files
  before it opens the database again, and the page reloads. The folder is remembered in the config folder
  (`DJI_THERMAL_UI_CONFIG_DIR` sets another); `--data-dir` and `DJI_THERMAL_UI_DATA_DIR` still win. Another data
  folder there offers its projects to import, all chosen at first; what it held is set aside in `replaced-<date>/`,
  nothing deleted.

### Changed

- A thermal image of a format that cannot be read is called an "Unsupported image type" (it was "Unsupported
  camera"), on the Files tab and in its filter.
- dji-thermal-cli 1.6.1: a FLIR radiometric JPEG (a Zenmuse XT2's) is an "Unsupported image type", no longer
  "Not thermal".

## [0.8.0] - 2026-10-28

### Added

- A project's import, from the projects page: an archive exported from a project's page becomes a new project with
  its flights, datasets, mosaics, measurements and findings. The archive is sent in pieces and unpacked as it comes,
  so no copy of it is kept. As soon as it starts, the dialog shows the project and its flights, and proposes its
  name, or a free one ("Roof (2)") when a project already has it; a name in use is not accepted. A folder flight
  comes back as an uploaded one, and an analysis or conversion that was running as canceled.
- A project's export, from its page: a `.tar` of the project with all its flights or those chosen, each listed with
  the size it adds. It holds everything: the images (a folder flight's copied in), the datasets and their mosaics,
  the measurements and the findings. It is streamed to the browser's download as it is written. A flight still being
  analyzed or converted is not offered.
- Favourite filters on the Files tab: the filter shown is saved under a name, and every flight's Files tab offers it
  from the Favourites menu, where choosing one replaces the filter. A favourite can be deleted but not overwritten:
  saving under a name in use is refused.

- `dji-thermal-ui.sh`, for a clone on Linux, WSL or macOS: `build` (or `rebuild`) sets up or updates the environment
  from the lock files, installing uv when it is missing; `start` runs the app in the background, building it first
  when needed; `stop`, `restart`, `status` and `logs`.

- The visual mosaic: when a dataset has visual images (DJI's `_V` or `_W`), a conversion's mosaics include their
  mosaic, placed as the thermal frames are with the cameras' offset corrected (dji-thermal-cli 1.6.0). The convert
  form offers it, on by default. The viewer shows it on a Visual tab, as colour tiles, with the temperatures as
  converted under the cursor and the frames that saw a spot opened by a click; its section reports its frames, size
  and the cameras' offset. It is in the downloads.
- A Thermal/Visual switch in the source frames window and on the frame page: a frame's visual image in its place,
  with the spot, the area or the shapes where the visual camera saw them. On the frame page the readout and a shape
  drawn on the visual image measure the thermal frame.
- The Files tab, the dataset's figures and the datasets list count the visual images apart.
- The compare page offers each conversion's visual mosaic in its panes, read on its temperatures as converted (no
  difference with it), and an overlay: "Overlay (A over B)" draws A's mosaic over B's in one pane, with an opacity
  slider and a swipe line, kept in the link.
- The frame page's switch has Both: the frame and its visual image side by side, their views moving together, with
  the shapes and the cursor on both; the PNG export takes both.

### Changed

- New names in what you see: a dataset (the images uploaded or read from a folder) is now a **flight**, and a
  conversion (its images converted with one set of settings, and their mosaics) is now a **dataset**: Project ›
  Flight › Dataset. New datasets are named "Dataset 1", "Dataset 2"…; names given before stay. Links, the API and the
  data folder are unchanged.

- The navigation pane: under each dataset, its Tools (Compare, Report), its Mosaics (unfolding to each of the
  viewer's tabs) and its Frames (unfolding to "Mosaic" and "Oblique", with their counts). The frame page
  opened from a list shows only its frames: Oblique lists those the mosaic left out, including those a conversion
  with a pitch limit did not convert. The page shown is marked down to the viewer's tab.
- The frame page is a frames explorer: its frames (those of the pane's list, or all) are listed beside the frame, in
  the order they were taken, the first shown, as a list or as thumbnails (remembered by the browser). Each says
  whether it is in the mosaic, oblique (with its angle), left out as unusable or not converted. The list replaces the
  frame picker; ← → still step through it.
- The flight's Files tab filters by conditions on any column instead of by name, each file shown matching every
  one. The Kind column has a dropdown of checkboxes, and two new columns, Thermal frame and With problems, can be
  sorted and filtered. All files, Thermal frames and With problems now set the filter they stand for, as a start to
  change from. The filter is kept in the page's link.

- The viewer: the Source frame tab draws the mosaic with a line along each seam between its frames, instead of each
  frame in its own colour (in the PNG export and the mosaic report too). The As converted tab is called Mosaic,
  there and on the compare page, in the reports and in the measurements. "Under the cursor" is "Pointer info", above "Source frames" (and on
  the frame page). The viewer's and the frame page's maps no longer show the colour scale: the panel does.
- A frame kept by a click on the viewer's map is let go with Esc or a second click on it.

- The app serves on port 8080 by default (it was 8765). It stops cleanly, as with Ctrl+C, when sent SIGTERM.

- dji-thermal-cli 1.6.0.
- The flight tests take the visual images beside the thermal ones in `DJI_THERMAL_FLIGHT_DIR`, and check the visual
  mosaic with them.

### Fixed

- New Flight's "Choose a folder" opened a file picker, in which a folder could not be chosen: it picks a folder
  again. Files chosen with no JPEG among them (TIFFs, for one) are now told apart: the dialog says that a flight is
  made of R-JPEGs, instead of asking to choose the images.
- A test of the command waits for Windows to let go of the database files of the server it stopped (it failed now
  and then on Windows with Python 3.14).

## [0.7.0] - 2026-10-27

### Added

- A dataset's report, to print or save as PDF (A4 or Letter): the dataset's figures, a map of where its frames were
  taken with its findings numbered, the coverage, the problems found, the frames' settings and temperatures summed
  up, the conversions, the findings with their kept frames' thumbnails, notes, and a table of every frame when
  appended. Its title, author, date and notes are typed on the page and saved on the dataset; the last author typed
  fills in new reports. Opened from the dataset page's Report button and the navigation pane.
- A conversion's mosaic report, to print or save as PDF: the mosaic as shown in the viewer when its Report button
  was pressed (the view is saved with the report), with the measurements and the dataset's findings numbered on it,
  the colour scale, a scale bar and north; each measurement with a close-up on its mosaic or frame, its figures and
  charts, and a comment (a measurement can be left out); the findings on the mosaic; the settings and the method.
  Also in the navigation pane under each conversion with mosaics.
- A comment on each saved measurement, typed on the mosaic report, shown in the viewer's list, and in the CSV
  and GeoJSON exports.
- The PNG export's image can carry north and marks in colours of their own (used by the reports).

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
