# Upcoming changes

Deferred work, tracked here so it isn't lost between sessions.

## Phases (current and upcoming)

The order of work, top first. Each phase is planned with the user before it is built; the details are in the
sections below. New requests arrive in `new.md`: they are turned into phases here, and `new.md` is cleared back to
its title.

**Up next**: nothing planned; new requests go here.

**Later**
1. **ODM processing through LuxODM's or WebODM's REST API**: send a conversion's temperature TIFFs as a task with
   the plan's options, and follow it. This replaces the plugin's "Process in LuxODM". (Integration)

## Standalone (option A)

Requested 2026-10-25: the Thermal Analyzer lives on as a standalone application. LuxODM's plugin will go away.
Interactive work with ODM goes through the LuxODM/WebODM API. A moves the analyzer over, keeping everything it
does that doesn't need LuxODM/WebODM. B (the facelift) follows, planned in "Facelift" below.

**Source:** LuxODM at a2a81052 (plugin 0.15.0, 53 Django tests, 143 Jest tests):
- **The plugin:** `coreplugins/thermal-analyzer/`, with `api.py`, `thermal_conversion.py`, `thermal_mosaics.py`,
  `thermal_measure.py` and `thermal_analysis.py`. `thermal_task.py` is not ported. The templates are `datasets`,
  `dataset`, `viewer`, `frame` and `compare`. `public/` has the scripts, `analyzer.css` and `__tests__/`.
- **The models:** `app/models/thermal_dataset.py` (`ThermalDataset`, `ThermalConversion` and
  `ThermalMeasurement`, with their delete signals).
- **The tests:** `app/tests/test_thermal_analyzer_plugin.py`. Its fixture is conversion "Nadir" in dataset "Roof".
- **The ESLint config:** `tools/eslint/`.

### What it keeps

Everything the user does in the plugin today, except the ODM task:
- **Datasets:** datasets of R-JPEGs, uploaded or used in place from a local folder, with their thumbnails.
- **Analysis:** dji-thermal-cli's analysis of a dataset (files, cameras, problems to fix).
- **Conversions:** any of dji-thermal-cli's settings, several conversions side by side, cancel, and download.
- **Mosaics:** as converted, harmonized, source frame and view angle. The viewer has the palette, range,
  brightness and contrast, gamma, equalization and sharpening, with the view kept in the URL.
- **Measurements:**
  - Spot, line and area temperatures, ΔT, boxes and circles, profiles, histograms and isotherms.
  - Saved measurements: compared, measured again with other parameters, and exported as CSV and GeoJSON.
  - Measurements work on mosaics and on single frames.
- **Compare:** the compare page, side by side or as the difference.
- **Preferences:** saved preferences for new datasets, and a reset to the defaults.
- **Downloads:** PNG downloads named `<dataset>-<conversion>-<tab or frame>.png`.

### What it drops

- **Projects and sharing:** datasets are top level, with no project, owner, guardian permissions or sharing.
  `created_by` goes.
- **Accounts:** no login, no quota, and no admin-only folder source (the one user may use any folder).
- **The ODM task:** "Process in LuxODM" goes: `ConversionTaskView`, `thermal_task.py`, the conversion's `tasks`
  link to `app.Task`, the task panel and the task links in `conversions.js`, and the preset saving. The WebODM plan
  (`analysis['webodm']`) is still made by dji-thermal-cli. The conversion settings still compare against it ("off
  the plan"). Only the task panel that used it goes, until the API integration.
- **WebODM's page shell:** its base template and menu, replaced by a layout of the app's own.

### What replaces WebODM's parts

| In the plugin | In dji-thermal-ui |
|---|---|
| `app.api.tiler`: `render_tile`, `point_values`, `colormap_entries`, `parse_rescale`, `check_colormap`, `get_zoom_safe`, `not_modified`, `raster_etag`, `tile_format`, `tile_response` | Copied, with WebODM's notice |
| `app.raster_utils.ZOOM_EXTRA_LEVELS`, `app/raster_stats.py`, `app/measurements.py`, `app/thermal_correction.py`, `app.security.path_traversal_check` | Copied, with WebODM's notice, and their tests too |
| `download_file_response`, `download_file_stream` (`app.api.tasks`) | A small streaming-download helper |
| `UserDataStore` (preferences) | A single preferences row |
| `Basemap.get_cached_basemaps()` | A list in the settings: OpenStreetMap and a satellite layer (Mapbox comes in B3) |
| `run_function_async` and Celery, `TestSafeAsyncResult` | The job runner (below) |
| `<project dir>/thermal/<id>` | `<data folder>/datasets/<id>`, with conversions under it as before |
| Migrations 0067–0071 and 0073 | One fresh initial migration |
| `login_required`, `visible_datasets`, `get_dataset(…, perm)` | Plain lookups by id |

### Design

- **Layout:**
  - **Code:** `src/dji_thermal_ui/` holds the Django project (`settings.py`, `urls.py`, `wsgi.py`), the CLI
    (`__main__.py`, `cli.py`) and the app `analyzer/` (models, `api.py`, the `thermal_*` modules, the copied
    WebODM helpers in `analyzer/raster/`).
  - **Templates and static files:** in `templates/` and `static/`. Leaflet 1.3.1's `dist` (BSD-2-Clause) is
    vendored in `static/vendor/leaflet/` with its licence. Note that `.gitignore` ignores `lib/`, so nothing is
    put in a `lib/` folder.
  - **Tests:** Python tests in `tests/`, Jest tests in `static/__tests__/`. `package.json` at the root holds Jest,
    jsdom and ESLint, plus leaflet for the tests.
- **URLs:**
  - **API:** keeps the plugin's paths under `/api/` (datasets, conversions, mosaics, measurements, frames and
    preferences, as `plugin.py` mounts them), less `conversions/<id>/task`. The scripts already take the API root
    from `data-api`, so they need no change.
  - **Pages:** `/`, `/dataset/<id>`, `/conversion/<id>`, `/conversion/<id>/frame` and
    `/conversion/<id>/compare?b=<id>`. The compare page drops the "same project" check, so any two conversions can
    be compared.
- **Jobs:**
  - **The runner:** a runner in the server process, a single worker thread fed from a queue. dji-thermal-cli
    already runs its own processes for the heavy work.
  - **Kinds of job:** the plugin's analysis, conversion and mosaic jobs are ported as they are. Each writes its
    status and progress to its row and checks its `run_id` to stop.
  - **On start:** a job left running by a closed server is marked failed with "interrupted".
- **Serving:** `dji-thermal-ui [--data-dir D] [--port P] [--no-browser]` runs migrations, then serves with waitress
  on 127.0.0.1, with threads so tiles load in parallel, and opens the browser. `DEBUG` is off and the secret key is
  made once into the data folder. CSRF stays on, since the scripts already send the token.
- **Tests:**
  - **Python:** the plugin's 53 Django tests run under pytest-django, with the project and permission cases
    removed. Their own tests for the copied WebODM helpers come with them, and the thermal correction and palettes
    tests.
  - **Jest:** the 143 Jest tests are ported, with the task-panel cases removed.
  - **Lint:** ruff, configured like dji-thermal-cli's, and ESLint with the plugin's config.
- **Live data for checks:** dataset 6's 220 M4T frames copied out of LuxODM's Docker volume with `docker cp` into a
  gitignored `ignored/` folder (as dji-thermal-cli does), and added as a folder dataset.

### Decisions (2026-10-25)

- **Platforms:** Linux and Windows. The tests run on both, and the Windows check is done from WSL as for
  dji-thermal-cli.
- **Distribution:** PyPI (`uvx dji-thermal-ui` or pipx), released the way dji-thermal-cli is.
- **Dependency versions:** current releases (rio-tiler, rasterio, numpy 2, Django), pinned exactly. The ported
  code is fixed where they changed.
- **CI:** in A4, tests on push (Linux and Windows), like dji-thermal-cli's `ci.yml`. A release workflow comes once
  a PyPI release is wanted.
- **LuxODM's data:** not imported (A1 planning, 2026-10-25). Datasets are added again from their folders and
  conversions re-run; measurements saved in LuxODM stay there.
- **Tooling:** set up in a fresh VS Code session opened on this repo, standalone from LuxODM's environment
  (A1 planning, 2026-10-25). The list is in "Tooling" below.
- **Permission fields:** `can_change` and `can_delete` are dropped from the API in A2, and the scripts' checks of
  them go in A3 (A2 planning, 2026-10-25).
- **Temperature unit:** an app-wide `unit` in the preferences row, °F by default (A2 planning, 2026-10-25). In
  LuxODM it was the user's profile setting.
- **The look until B:** stock Bootstrap 3.4.1 and Font Awesome Free 5.15.4, vendored, rather than copying WebODM's
  bootswatch theme or writing CSS of our own. Light only: the dark mode comes with the facelift (A3 planning,
  2026-10-25).

## Tooling (set up 2026-10-25, in A1)

Set up in a VS Code session opened on this repo, separate from LuxODM's. Each item is proposed, approved, set up
and then verified (see the user's rules). Personal settings stay in uncommitted files.

- **Python:** uv makes `.venv` with `uv sync` once `pyproject.toml` exists. Develop on Python 3.12, the floor, as
  `.python-version`. CI tests 3.12–3.14.
- **VS Code (local `.vscode/settings.json`, uncommitted):** the interpreter at `.venv`, pytest as the test runner,
  ruff as the Python linter with the project's config (not as a formatter: the ported code keeps its layout), and
  ESLint with the root `eslint.config.*`.
  Extensions needed: Python, Pylance, Ruff (`charliermarsh.ruff`), ESLint.
- **Node:** `npm ci` for Jest, jsdom, ESLint and leaflet (tests only), pinned in `package-lock.json`.
- **Browser checks (A3):** the Playwright MCP, added to this project in local scope (`claude mcp add --scope
  local`), headless Chromium, against `http://127.0.0.1:8080`. It needs no login.
- **Claude permissions (`.claude/settings.local.json`, uncommitted):** `uv sync`, `uv run pytest`, `uv run ruff`,
  `uv run dji-thermal-ui`, `npx jest`, `npm run -s lint`, and `git` status, diff, log and branch, without a prompt
  each time.
- **Windows:** the Windows check runs from WSL with Windows' own git and uv, on a clone on C:, as dji-thermal-cli's
  release check does.
- **`.gitignore`:** add `.vscode/`, `.claude/settings.local.json` and `node_modules/` (`.venv` and `ignored/` are
  already there).
- **Test data:** dataset 6's frames copied out of LuxODM's Docker volume into `ignored/` (gitignored).

## Facelift (option B)

Planned 2026-10-26. The front end (about 6,200 lines of ES5 scripts on Leaflet 1.3.1, Bootstrap 3 and Font
Awesome 5) is rebuilt in two stages, each released on its own.

### Decisions (2026-10-26)

- **Staged:** B1 rebuilds the pages and their look, keeping the API, the server's PNG tiles and Leaflet. B2 then
  moves the viewer to OpenLayers with WebGL colouring.
- **Preact**, in TypeScript, with Vite. No Bootstrap: a stylesheet of the app's own, with CSS variables.
- **Theme:** follows the system's light or dark setting, with a switch in the header that overrides it, saved in
  the preferences.
- **Packaging:** the front end is built at release (`npm ci`, `npm run build`, then `uv build`), in CI and in the
  release checks. The built files are not committed. Building the wheel needs Node; installing it does not.

### B1: the pages rebuilt

- **Source:** `frontend/` at the root (TypeScript, Preact components, the stylesheet), one Vite entry per page.
  The five pages and their URLs stay. Django still renders each page's shell from `templates/` and mounts its
  entry, with the API root and ids in `data-` attributes as today. A small template tag reads Vite's
  `manifest.json` for the hashed file names.
- **Build:** Vite writes `src/dji_thermal_ui/static/dist/` (gitignored), which the app serves and the wheel ships.
  For development, `npm run build -- --watch` beside `uv run dji-thermal-ui`.
- **What moves over:** everything the A3 scripts do, page by page (datasets, dataset, viewer, frame, compare),
  with the same API calls. `analyzer_core.js`'s pure functions become typed modules first, with their tests.
- **Map:** Leaflet stays for B1, upgraded to 1.9.4 with `@types/leaflet`; B2 replaces it.
- **Look:** the app's own CSS: a header, panels and forms, light and dark tokens as CSS variables. The theme is
  set on `<html>` before the page paints, from the preferences or else `prefers-color-scheme`. Icons are inline
  SVG. Bootstrap and Font Awesome are dropped from `static/vendor/`, `license-files` and `check_dist.py`.
- **Preferences:** a `theme` setting (`system`, `light` or `dark`) beside `unit`.
- **Tests:** Vitest with jsdom and Testing Library replaces Jest. The behaviour the 141 Jest tests cover is
  ported. ESLint uses typescript-eslint, and `tsc --noEmit` runs with the lint. pytest's page tests run against
  a stub manifest, so they do not need a build.
- **Packaging:** CI's build job builds the front end first (lint and pytest need no build: the stub manifest).
  `check_dist.py` requires the manifest, each page's entry and its files. A third-party licence file for the
  bundle (Preact, Leaflet) is generated at build and shipped beside it (not in `license-files`: a pattern that
  matches nothing fails the build, and a clone is installed before its pages are built). Checked: the sdist carries the
  built files although they are gitignored, and `uv build` makes the wheel from it with no Node.
- **Versions (npm, 2026-10-26), pinned exactly:** preact 11.0.2, @preact/signals 2.11.3, vite 8.3.5,
  @preact/preset-vite 2.10.6, typescript 6.0.3 (typescript-eslint 8.72.0 supports up to 6.0, so not 7),
  vitest 5.0.5, jsdom 30.1.3, @testing-library/preact 3.2.6, leaflet 1.9.4, @types/leaflet 1.9.22, eslint
  10.13.0.
- **Live check:** A3's walk-through in headless Chromium on the 220 M4T frames, in light and in dark, and on
  Windows from WSL with the smoke check.
- **Release:** 0.2.0.
- **Done:** see Done below.

### B2: the map pages on OpenLayers

Planned 2026-10-27.

- **Decisions (2026-10-27):** sharpening is done in the browser's shader, not on the server; the frame page moves
  to OpenLayers too, so Leaflet is dropped.
- **Map:** OpenLayers 10.11.0 (released 2026-10-04) replaces Leaflet on the viewer, compare and frame pages: the
  basemaps (XYZ and WMS) and their switch, the scale bar, the legend, drawing measurements, the outlines and the
  PNG export. Mapbox's satellite tiles come in B3 (Basemaps).
- **Data tiles, not COGs:** the server sends float32 tiles (raw little-endian, -1e30 where there is no data, as
  WebGL cannot test for NaN, with the same ETags) of what is drawn today: a mosaic tab's values read with rio-tiler (nearest pixel), temperatures
  corrected for the emissivity and reflected temperature asked; the difference of two conversions; a frame's
  temperatures as measured (with its changes). So the mosaics stay as dji-thermal-cli writes them (strip-laid,
  five float32 bands, no overviews) and need no change there.
- **Colouring in the browser:** a WebGL tile layer (`ol/layer/WebGLTile` over `ol/source/DataTile`) colours them
  with a style built from the view: the palette (the API's colours), the range, gamma, brightness and contrast,
  the isotherm (its pixels in the palette, the rest grey), the source frames each in their colour. Changing any of
  these redraws without new tiles. Equalization applies the curve the server already gives (`/curve`), sampled
  into the style.
- **Sharpening** in the shader: the unsharp mask on the toned values, from neighbouring pixels read with the
  style's band offsets (`['band', 1, dx, dy]`), its reach in tile pixels from the zoom as on the server. Tiles carry
  a gutter (`DataTile`'s `gutter`) as wide as that reach, so tile edges show no seams. A hand-written shader only
  if the style's expressions prove too limited.
- **On the server's API still:** point readouts, measurements, the histogram and curve, the downloads. The
  server's PNG tiles and frame images, and the colouring code only they use, are removed once nothing calls them.
- **Tests:** the style builders, the curve's sampling, the tile decoding and the drawing's geometry in Vitest (jsdom
  has no WebGL); the data tiles in pytest (shape, gutter, no data, correction, difference, ETag). The look is
  checked in headless Chromium (software WebGL), compared side by side with 0.2.0's server-drawn tiles.
- **Live check:** A3's walk-through on the 220 M4T frames, in light and in dark, and the Windows check.
  Done 2026-10-27: the viewer, compare (side by side, linked, and the difference of the as converted and harmonized
  mosaics) and frame pages draw in headless Chromium with software WebGL, with no errors; hovering, the isotherm,
  sharpening and the frame locator work. The look matches 0.2.0's, Esri's missing tiles included (see Basemaps).
  pytest passes on Windows from a clone of the branch.
- **Release:** 0.3.0.
- **Done:** see Done below.

## Basemaps

### B3: the basemaps

Planned 2026-10-27, changed the same day from Google to Mapbox.

- **Decisions (2026-10-27):** this replaces the note of 2026-10-25 (a key the deployment holds, tiles proxied
  through the server, the app counting a quota). That note was written for LuxODM's shared server. Here there is
  one user on their own computer, with their own token:
  - Mapbox, not Google: Google needs a Cloud project with billing before any tile is served. Each user makes their
    own Mapbox account and token. Alternatives looked at: MapTiler and Stadia (free plans non-commercial only),
    Esri's Location Platform (more steps to sign up), Bing (retired), Azure (billing). OpenStreetMap and MapLibre
    have no imagery.
  - The browser fetches Mapbox's tiles directly, with no proxy.
  - The token is entered in the app and saved in the preferences. A `MAPBOX_API_TOKEN` in the environment or in a
    `.env` file is used too, for whoever sets the app up (the order is below).
  - Esri's layer gets a maximum zoom for each area.
  - The app counts no usage: the Mapbox account's own free tier limits it.
- **Mapbox's terms (checked 2026-10-27):** Mapbox's tiles need the Mapbox wordmark and the text attribution
  ("© Mapbox", "© OpenStreetMap", "Improve this map" at the place shown, and "© Maxar" for the imagery) while they
  are shown. The wordmark may be moved to another corner but not styled. Free allowances (mapbox.com/pricing):
  750,000 tiles a month on the Raster Tiles API, 200,000 on the Static Tiles API.
- **Mapbox Satellite:** an XYZ layer of 512-pixel tiles of the `satellite-v9` style through the Static Tiles API
  (`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token=…`), up to zoom 22.
  - The Raster Tiles API (`v4/mapbox.satellite`) was the plan, but on 2026-10-27 it answered the user's account
    (no card) with 429 and a limit of -1, while the Static Tiles API served the same token.
  - Shown as "Mapbox Satellite" in the basemap switch when a token is known.
  - The wordmark is a map control at the bottom left, above the scale line, and the attribution (not collapsible)
    goes in the attribution control, while the layer is shown. The wordmark is Mapbox's map wordmark, unmodified,
    from Mapbox GL JS 1.13.3 (BSD-3-Clause), in `static/vendor/mapbox/` with its licence.
  - If its tiles are refused (401 for a wrong token, 403 for one restricted to other URLs, 429 past the limits),
    the switch says why, and the map goes back to the previous basemap.
- **The token:** "Mapbox Satellite: add a token…" in the basemap switch opens a small form to paste the token.
  - The form says how to get one (asked for by the user, 2026-10-27): sign up at mapbox.com (no card needed, the free
    allowance, and charges only once a card is on the account), copy the Default public token from the Access tokens page (or make one
    with the public scopes only, never a secret one), paste it. It says the token stays in the app's preferences and
    goes to Mapbox with each tile, links to the Statistics page for the usage, and says when `MAPBOX_API_TOKEN` is
    the one in use. The README has the same steps.
  - Saved as the `mapbox_token` preference (`PUT /api/preferences`), never in the code or a committed file, and
    reaches the map pages in their JSON. The same form changes or removes it.
  - Only a public token (`pk.`) is accepted. A secret one (`sk.`) is refused, since the browser shows it to anyone
    looking.
  - `MAPBOX_API_TOKEN` is read from the environment, or from a `.env` file in the folder the app is started from or
    in the data folder (only that line is read; no new dependency). `.env` is in `.gitignore`.
  - Which one is used: the token saved in the app, else `MAPBOX_API_TOKEN`. The form says when the token in use
    comes from `MAPBOX_API_TOKEN`, and removing the saved one goes back to it.
  - Tests never read the real `.env` or environment token: the test settings clear `MAPBOX_API_TOKEN` and point the
    `.env` lookup at the temporary folder.
- **Esri past its levels:** Esri's satellite imagery goes as deep as zoom 21 in some places and only to 17–19 in
  others. Past that, it serves "Map data not yet available" tiles.
  - The layer asks Esri's tilemap service (`MapServer/tilemap/{z}/{row}/{col}/{w}/{h}`) which tiles exist around
    the mosaic, at most once per block and level, and requests none that do not exist.
  - Where tiles are missing, the deepest level that exists is stretched (the tile grid's lower levels).
  - First check when building: the endpoint and its answer. Esri's server returned 502s on 2026-10-27.
  - If the tilemap cannot be read, or does not answer within 5 s, the layer stops at zoom 19 there and is
    stretched past it.
  - Checked 2026-10-27: the tilemap answers (with CORS), and over the M4T dataset Esri has tiles to zoom 19 only.
  - A tile the tilemap says is missing is left in OpenLayers' error state, and the layer preloads 4 levels, so the
    renderer draws the deepest loaded level above it in its place.
  - Mapbox gets the same stretching past its deepest level if its tiles show the same problem.
- **Usage limits:** none in the app. Mapbox's URL restrictions accept no IP addresses (the app is on 127.0.0.1)
  and the default public token cannot be restricted, so the README says to use a public token, unrestricted, and to
  watch the Statistics page.
- **Tests:**
  - Vitest:
    - the basemaps listed with and without a token;
    - the token form saving, changing and removing the token, and saying when it comes from `MAPBOX_API_TOKEN`;
    - the switch going back when the tiles are refused (the tile request stubbed);
    - the tilemap's answer turned into the levels each tile has.
  - pytest: the preference saved, removed and passed to the pages; an empty, overlong or secret token refused;
    `MAPBOX_API_TOKEN` from the environment and from `.env`, and the saved token winning over it.
- **Live check:** the viewer and compare pages on the 220 M4T frames, in light and in dark.
  - Esri zoomed in past its levels, with no placeholder tiles.
  - Mapbox with the user's token from `.env` (given by the user for this; never printed or copied). The wordmark
    and attribution are shown, and a wrong token saved in the form is reported, then removed.
  Done 2026-10-27: Esri over the M4T site stretched from zoom 19 with no deeper tile requested; Mapbox's tiles to
  zoom 22 with the wordmark and the open attribution, on the viewer and both maps of the compare page; the form in
  light and dark, a secret token refused, a wrong one reported (401) and the map back on Esri. Found and fixed: the
  Raster Tiles API's 429 (above), and OpenLayers' attribution control counting hidden layers, so the switch sets it
  open only while Mapbox is shown.
- **Release:** 0.4.0 (a feature).
- **Done:** see Done below.

## Findings

Requested 2026-10-27 (`new.md`) and put before the reports at the user's request:
- **Findings on datasets:** on the As converted and Harmonized tabs, a spot or an area drawn on the mosaic opens the
  source frames that made it, in a window on the page: the whole frame, and a list to pick another when there are
  several. The user inspects them and can save the spot or area as a finding, its source frames kept with it. The
  same on the compare page. Findings can be shown or hidden, and a measurement can be saved as a finding.
- **The Source frame tab:** clicking it only outlines the frame today; it should open the frame in the same window.

### Decisions (2026-10-27)

- **Which frames:** every frame that saw the spot or area, not only the one the mosaic took each pixel from (that
  one is listed first). The mosaic does not record the others, so dji-thermal-cli saves them first (C1).
- **Kept by reference:** a finding stores its frames' names, where the spot or area is in each, and which ones the
  user kept. The pictures stay in the dataset; nothing is copied.
- **What a finding holds:** its shape (a spot or an area, in lon/lat), a name, notes, a severity (low, medium, high,
  critical), a status (open, reviewed, resolved), the temperatures measured when it was saved (min, max, mean, ΔT,
  with the conversion and tab they were read on), and its frames.
- **Findings belong to the dataset:** in lon/lat, they show on every conversion's mosaics of that dataset and on
  both panes of the compare page.
- **The name:** dji-thermal-cli's analysis also has "findings", which the app shows as Problems. They stay Problems;
  the front end's type for them is renamed `Problem` so that `Finding` is the new one.

### C1: frame models in dji-thermal-cli

- **Built** (2026-10-27): see Done.

- **In dji-thermal-cli** (`~/gitrepos/python/dji-thermal-cli`, its own branch, tests and release 1.5.0, a feature):
  - The mosaic writes how each placed frame sees the ground beside its rasters: the camera position and height,
    its rotation, principal point and focal length, the alignment correction (shift and rotation), the surface it
    was projected onto, and its corrected footprint in lon/lat.
  - A public function takes those and ground points (lon/lat) and gives each frame's pixel for them, or none where
    the frame did not see the point; another gives the frames whose footprint covers a point or meets an area.
  - Its tests: a ground point projected into a frame and back lands where it started; points outside the footprint
    give none; the file is written and read back.
- **Here:** dji-thermal-cli pinned at 1.5.0. Mosaics built before it have no frame models: for them the pop-out
  lists only the frames the mosaic used (the Source frame raster) and says that rebuilding the mosaics lists every
  frame that saw it.
- **First check when building:** that the model reproduces the mosaic's own sampling (a pixel of the Source frame
  tab maps to the same frame pixel as `frame_pixel` today).

### C2: the source frames pop-out

- **Built** (2026-10-27): see Done.
- **Decided with the user (2026-10-27):** besides the tool, a saved spot, box, circle or area measurement has a
  "Source frames" button, so a shape drawn once need not be drawn again; 0.5.0 is released after C2, as planned.
- **The frame is shown as converted** (the frame page's values) on every tab, coloured with the tab's palette and
  range, as the compare page's picked point does today.
- **A "Source frames" tool** on the viewer's As converted, Harmonized and Source frame tabs: a spot (a click) or an
  area (a polygon, as the Area tool draws). On the Source frame tab a click opens it directly, as asked.
- **The window:** on the page, beside the map (not a browser pop-up), movable and closable. It shows the whole frame,
  coloured with the mosaic's palette and range, with the spot marked or the area outlined in the frame's pixels;
  and the list of frames that saw it, the one the mosaic used first, each with its time and view angle. Picking one
  in the list (or ← and →) shows it; a link opens it on the frame page.
- **API:** `POST …/mosaics/<tab>/sources` with the geometry: the frames that saw it, for each the spot's pixel or
  the area's outline in its pixels, whether the mosaic used it, and what share of the area it covers.
- **Compare page:** its "Picked point" panel is replaced by the same window, for each pane (A's and B's frames for
  the difference).
- **Tests:** pytest for the endpoint (a spot, an area, outside the mosaic, a mosaic without frame models); Vitest
  for the window (the list, stepping, the marked spot and outline, closing).

### C3: findings on the viewer

- **Built** (2026-10-27): see Done.
- **Decided with the user (2026-10-27):**
  - **The project side too:** the projects page and the project page show findings counts, and the project page
    lists its datasets' findings, each opening the viewer on the conversion it was measured on (or the dataset's
    latest with mosaics when that one is gone).
  - **Drawn as an outline with a severity tag:** the shape in a white-and-black dashed outline that reads on any
    palette (a spot as a ringed dot), labelled with a chip in the severity's colour holding the name.
  - **Frame measurements are not saved as findings** (they are in the frame's pixels): only a mosaic's spot or
    area, from a saved measurement or the source frames window.
- **The conversion measured on** is kept as a link that empties if that conversion is deleted; the finding stays.
- **Model:** `Finding` on the dataset, with the fields above, its frames as a list ({frame, pixel or outline, kept}),
  and when it was made and changed. API: list, create, change and delete under `/api/datasets/<id>/findings`.
- **Saving:** the pop-out's "Save as finding" opens a form (name, notes, severity, status, the frames to keep, all
  ticked to start with); the temperatures are measured then on the tab shown. A saved measurement that is a spot or
  an area (box and circle included; a line cannot be) has "Save as finding" too, its geometry and figures copied.
- **On the map:** findings drawn in their own style (by severity), labelled, a click opening the finding with its
  frames in the pop-out. A "Findings" switch shows or hides them all, kept in the URL, and each can be hidden from
  the list.
- **The list:** a Findings section in the viewer's panel (name, severity, status), to open, change or delete one.
  The dataset page shows how many findings the dataset has.
- **Tests:** pytest for the API (create, change, delete, the dataset's deletion removing them, refused values);
  Vitest for the form, the list and the switch.

### C4: findings on the compare page

- **Built** (2026-10-27): see Done.
- Findings shown on both panes with their own switch, opened in each pane's pop-out, and saved from a spot or area
  drawn in a pane.
- **Decided with the user (2026-10-27):**
  - **A difference pane** draws A's and B's datasets' findings (once when they are the same dataset); in its window
    each mosaic's frames (A, B) have their own "Save as finding", saved to that mosaic's dataset and measured on it.
  - **One switch for both panes**, in the page header, kept in the URL.
  - **Open and change only:** a finding opens in the pane's window with Change (C3's form) and a link to it in the
    viewer; deleting, hiding one by one and the list stay in the viewer.
- **Each pane** draws its mosaic's dataset's findings in C3's style; a click on one opens it in that pane's window
  with its kept frames. The finding open is kept in the URL, so a link opens it on the compare page too.
- **Drawing:** the pane's "Source frames" button becomes Spot (as today) and Area (a polygon, the viewer's drawing);
  the window's "Save as finding" opens C3's form, the temperatures read on that pane's mosaic as converted.
- **Tests:** Vitest for the switch and the URL, a finding opened by a click and by a link, saving from a pane and
  from each mosaic of a difference, and changing one.

### Each phase

- Live check on the 220 M4T frames in a real browser, light and dark, leaving no findings behind.
- Release: C1 is dji-thermal-cli 1.5.0 (the user pushes and tags it there), then here 0.5.0 after C2 and 0.6.0
  after C4, unless the user prefers one release at the end.

## Reports

Planned 2026-10-27, from Later ("a report of a dataset or a mosaic"), after the findings.

### Decisions (2026-10-27)

- **Two reports:** a dataset report and a mosaic report.
- **Printed to PDF from the browser:** a report page laid out for A4 and Letter; the user prints it and picks "Save
  as PDF". It uses the viewer's own colouring and drawing, adds no dependency, and works the same on Windows.
- **The mosaic report holds:** the mosaic as shown (the viewer's tab, palette, range and adjustments, with the saved
  measurements drawn and labelled, the colour scale, a scale bar and north); the measurements' table and their
  charts (profiles, histograms); a close-up of each measurement (frame measurements on their frame); and the
  settings and method (the conversion's settings, the mosaic kind, dji-thermal-cli's version).
- **Text of the user's own, saved:** a title, author, date and notes on each report, and a comment on each
  measurement, typed on the report page and saved.

### D1: the dataset report

- **Built** (2026-10-28): see Done.

- `/dataset/<id>/report`, opened from the dataset page: the title block; the dataset (files, size, thermal frames,
  cameras, when it was flown, altitudes, where, with the frames' positions on a map); the problems from the analysis;
  the frames' settings and temperature ranges; the conversions made; and, once C3 is built, the findings.
- The report's text saved on the dataset. Print styles: no header or controls, always light, figures kept whole on
  a page.
- **Decisions (2026-10-28):**
  - **The frames:** a summary in the body: each setting's distinct values with their frame counts (emissivity,
    distance, humidity, reflection, ambient), and the lowest, median and highest of the frames' temperatures. A full
    table of the frames is an appendix, switched on per report, and the switch is saved.
  - **The author:** typed on the report; the last one used is kept in the preferences and fills in new reports.
  - **The findings:** a table, each numbered on the frames' map, with thumbnails of their kept frames.
  - **The WebODM plan:** its coverage figures only. The task options and commands stay on the dataset page.
- **Built as:** the text in a `report` field on the dataset (title, author, date, notes, appendix), changed with
  the dataset's PATCH; the page `/dataset/<id>/report` (`frontend/src/report/`), with a Report button on the dataset
  page and a Report entry in the navigation pane; print styles in `app.css`.

### D2: the mosaic report

- **Built** (2026-10-28): see Done.

- `/conversion/<id>/report`, opened from the viewer with its view: the contents decided above, and the dataset's
  findings on this mosaic with their kept frames. Each measurement's comment saved on the measurement (shown in the
  viewer and in the CSV and GeoJSON too).
- Tests for both: pytest for the pages and the saved text; Vitest for the sections from the data; a live check
  printing each to PDF with Playwright and looking at the pages.
- **Decisions (2026-10-28):**
  - **The view** (tab, palette, range, adjustments) is saved with the report. The viewer's Report button saves the
    view it shows, then opens the report; the pane's entry opens the saved view.
  - **The mosaic on white**, as in the PNG export: the coloured mosaic with the measurements and findings drawn on
    it, the colour scale, a scale bar and north. No basemap.
  - **The measurements:** every saved measurement of the conversion, on the mosaics and on frames. A switch on the
    report leaves one out, and the switch is saved.
  - **The findings:** every finding of the dataset that lies on the mosaic, numbered on the figure, with the
    conversion its temperatures were read on and its kept frames.
- **Design:**
  - **Text and view:** a `report` field on the conversion (title, author, date, notes, view, left out), changed with
    its PATCH like the dataset's. The author is shared with D1 (`report_author`).
  - **The figures are images:** WebGL canvases do not print reliably. A hidden map draws the mosaic (`ThermalLayer`)
    fitted to the mosaic, then to each measurement's extent, and `snapshot` and `viewCanvas` (the PNG export's)
    make each into an image on the page. Frame measurements are drawn on their frame (`frameMap`, the frame's
    values).
  - **The measurements' table and charts:** `Profile` and `Histogram` (SVG, which prints).
  - **A comment on each measurement:** a `comment` field, typed on the report, shown in the viewer's saved list, in
    the CSV and the GeoJSON.
  - **Settings and method:** the conversion's settings that differ from the defaults (`settings.ts`), the mosaic's
    kind and what it means (`TAB_HINTS`), the normalization, and dji-thermal-cli's version (each conversion's
    results already record it).

## Projects

Requested 2026-10-27 (`new.md`):
- **Projects:** a project contains datasets, and has a name, a description and a location. The location is found by
  searching OpenStreetMap or Mapbox for an address or a place on the map. Everything about a project's datasets,
  findings included, is available across the project, so its datasets can be compared with each other.
- **A navigation pane:** collapsible, on the left, to move between projects, their datasets and what is under them,
  with User Preferences as an entry: the unit temperatures are shown in (°C, °F, K), the theme (light, dark), and the
  locale times are shown in, the computer's by default.

### What it builds on

- **Datasets** have no container today: the datasets page lists them all. A dataset's conversions, mosaics,
  measurements and (after C3) findings hang off the dataset, so a project only has to hold datasets.
- **The compare page** can already pair any two conversions, from any dataset: within a project it can offer that
  project's conversions first.
- **The unit and the theme** are already chosen in the header and saved for the app (`Preferences`); times are shown
  with the browser's locale (`toLocaleString` in `core/format.ts`). The preferences page gathers these, and adds the
  locale.
- **Basemaps** (B3): OpenStreetMap and, with the user's token, Mapbox. Both have a search service (Nominatim, and
  Mapbox's geocoding), which the location search would call from the browser.

### Decisions (2026-10-27)

- **Order:** projects first, before the rest of the findings (C2–C4) and the reports, since they change the scope
  of everything else: findings and reports are then seen within a project.
- **The Default Project:** made whenever no project exists (on the first start after E1, and again if the last
  project is deleted). Datasets made before projects go into it. It is an ordinary project: the user renames it and
  fills in its description and location.
- **Deleting a project** deletes its datasets with it (their files, conversions, mosaics, measurements and
  findings), after a confirmation that says how many datasets and how much disk space go with it.
- **Place search:** OpenStreetMap's Nominatim, with or without a Mapbox token (changed 2026-10-27, while building E2:
  Mapbox's geocoding results may not be stored unless asked for as its permanent geocoding, which needs a card on
  the account and is billed per request, and may only be used with a Mapbox map; Nominatim's are OpenStreetMap's
  data, kept under the ODbL with the credit). The search text, or the point clicked, goes to Nominatim; nothing else
  leaves the computer.
- **The location:** one point with its address or place name, the general site where the project's flights are made
  (a parcel with several buildings or silos). No outline.
- **Unit and theme** stay in the header as quick switches, and are on the preferences page too.
- **Locale:** dates and times only, not numbers. The locale's format is the computer's by default, or one chosen on
  the preferences page. A flight's times are shown in the time where the flight was made: the offset of the
  frames' local capture time (EXIF DateTimeOriginal) from their UTC time (DJI's UTCAtExposure), rounded to 15
  minutes as the two clocks differ by seconds (the 220 M4T frames: 08:44:42 against 13:45:01.8 UTC, so UTC−5), so
  no time zone database is needed; the times of the app's own events (made, changed) stay in the computer's time.

### E1: projects

- **Built** (2026-10-27): see Done. The findings counts and the project's findings together came with C3; the form
  edits the name and description, and the location's form is E2's.
- **Model:** `Project` (name, description, location as lon/lat with its label, when made and changed), and each
  dataset in exactly one project. The migration makes the Default Project and moves the existing datasets into it.
- **API:** `/api/projects` (list, create, change, delete with its datasets); a dataset's `project`, changed to move
  it. A new dataset is made in the project it was started from.
- **Pages:** a projects page as the new home (each project with its location, dataset count and findings count),
  and a project page with its datasets (their conversions and findings counts), the project's findings together
  (once C3 is built), and the flight areas on a map. The compare page lists the project's conversions first.
- **Tests:** pytest for the model, migration and API (the Default Project made when none exists, a dataset moved,
  deleting a project and its datasets' folders, refused values); Vitest for the pages' lists and the delete
  confirmation.

### E2: the location

- **Built** (2026-10-27): see Done.
- On the project's form: a map with the basemaps of B3 and a search box; results from Nominatim (one search a second
  at most, on Enter, with the app's name as its user agent as Nominatim's usage policy asks: the server asks it, since
  a browser cannot set the user agent), with the service named under the results. A result, or a click on the map (reverse-geocoded
  for its label), sets the point; the label can be edited.
- **Tests:** pytest for the location's values; Vitest for the search (each service, no token, no results, a failed
  request) and setting the point.

### E3: the navigation pane and preferences

- **Built** (2026-10-27): see Done. The fallback changed while building: a frame's capture time is the drone's own
  clock, not UTC, so without the UTC time it cannot be shown in the computer's time; it is shown as recorded and
  labelled "time zone unknown" with why (the images do not record both times, or the dataset was analyzed before the
  UTC time was kept: analyze it again). The PNG exports keep their fixed date format, with the zone added.
- **The pane:** on the left of every page: the projects, under each its datasets, under each its conversions (with
  their viewer, compare and, later, report pages), and User Preferences last. Collapsible by level and as a whole
  (kept for the next visit), the current page highlighted, and over the page on narrow screens.
- **User Preferences:** a page with the unit and the theme (as in the header), and the date and time locale (the
  computer's, or one chosen from a list), applied to every date and time shown.
- **Flight times:** a dataset's capture times are shown in the flight's local time (the offset above), labelled
  with it (e.g. "UTC−5"); a dataset without both times falls back to the computer's time and says so.
- **Tests:** pytest for the preference and the flight's offset; Vitest for the pane (levels, collapsing, the current
  page) and the date formatting (locale, offset, fallback); a live check in the browser, light and dark, at desktop
  and narrow widths.

## Controls

Asked in `new.md` (2026-10-27): the image should change while the brightness, contrast, gamma and other sliders are
dragged, not only when they are let go, and the sliders should be 5% less sensitive; the temperature scale should
show the minimum and maximum at its ends.

### What it builds on

- The browser colours the tiles since B2 (`frontend/src/map/colour.ts`), so redrawing while dragging needs no request
  to the server. Today the viewer and frame pages move the range fields and the scale while brightness, contrast or
  gamma is dragged, and colour the map when the slider is let go; sharpening, and every slider on the compare page,
  act only when let go.
- The scale (`ScaleView` in `viewer/panel.tsx`, and the PNG download's legend in `viewer/canvas.ts`) labels round
  ticks (`scaleTicks` in `viewer/view.ts`), so its ends are labelled only when a tick falls on them.

### Decisions (2026-10-27)

- **Sensitivity:** smaller steps, same reach: each slider's step is 5% smaller, and its ends stay where they are.
- **The scale's ends:** labelled with the range's ends (the exact values the palette's ends stand for, to 0.1), with
  the round ticks between them; a tick too close to an end is dropped. On every scale, the download's legend included.
- **Order:** before C3, then released as 0.5.1.

### F1: live sliders and the scale's ends

- **Built** (2026-10-27): see Done.
- **Live:** brightness, contrast, gamma and sharpening redraw the image while dragged, on the viewer, frame and
  compare pages; what is kept (the style saved, an equalized tone curve asked of the server) waits until the slider
  is let go, as today.
- **Steps:** about 5% finer, and a whole number of them from end to end so that both ends are reached: brightness
  0.05 → 2/42, contrast 0.1 → 4/42, gamma 0.1 → 4.6/48, sharpening 0.5 → 5/11 (9% finer: its 10 steps cannot be
  5% more and stay whole).
- **Scale:** `scaleTicks` gives the two ends as well as the round ticks between them.
- **Tests:** Vitest for the ticks (ends, ticks near an end dropped) and the sliders (the image's style changes while
  dragging); a live check in the browser, light and dark.

## RGB and thermal

Requested 2026-10-28 (`new.md`):
- dji-thermal-cli should make mosaics of DJI's non-thermal (visual, RGB) images too. The Matrice 4T and the Zenmuse
  H20T/H30T series capture a route in thermal and visual at once, and comparing the visual and thermal mosaics, and
  their frames, would help in the app.
- The app should compare visual and thermal mosaics, building on the first. dji-thermal-cli's changes stay separate
  from the app's: the CLI must always work standalone, and the app uses its Python API (`api.py`) rather than
  duplicating its work.

### What it builds on

- **dji-thermal-cli 1.5.0 (`mosaic.py`)** builds mosaics without ODM:
  - **Placement:** each frame is placed from its pose (GPS, height and gimbal angles read from its XMP by `read_pose`).
    The camera's focal length in pixels comes from `focal_length_px(model, ...)`.
  - **Refinement:** the placements are refined by aligning overlaps with phase correlation, optionally over a DSM.
  - **Output:** a single-band float32 temperature GeoTIFF with frame models (each frame's footprint, for the source
    frames).
  - **What carries over:** posing, placing, the grid, the DSM and the frame models do not depend on what a pixel
    holds. Compositing, normalization, the PNG views and the alignment's input are specific to temperatures.
- **dji-thermal-cli's analysis** already recognizes a visual image: a valid JPEG without thermal data is
  `not_thermal` (`dataset.py`). DJI names a capture's pair `..._0001_T.JPG` and `..._0001_V.JPG` (and `_W`/`_Z` for the
  wide and zoom cameras on some drones).
- **The app:**
  - **Datasets:** they keep every uploaded JPEG and list the visual ones as "not thermal". The Files tab shows them.
  - **Mosaics:** the viewer and compare page take a mosaic's float32 data tiles and colour them in WebGL. A visual
    mosaic needs RGB tiles instead: the server's PNG/JPEG tiles, or the image itself as a tile layer.
  - **Compare page:** two panes kept in step (`compare/`), which F3 would extend with a visual pane, a swipe or an
    overlay.
  - **Source frames window and frame page:** they show the thermal frames that saw a spot. The paired `_V` frame
    could be shown beside each one.
- **Test data:** the 220 M4T frames in `ignored/` and dataset 1 are thermal only. A flight with both `_T` and `_V`
  images is needed for development and the live checks.

### Proposed phases

- **F1 (dji-thermal-cli, its own repo and release, e.g. 1.6.0):** visual mosaics.
  - **Frames and cameras:** read the visual frames' poses (the same XMP), and the intrinsics of the visual cameras of
    the supported drones (M4T wide; M3T, H20T and H30T wide), with tests.
  - **Pairing:** pair `_V` with `_T` by capture.
  - **Compositing:** an RGB composite (uint8, 3 bands with alpha) at a chosen GSD.
  - **Placement:** optionally use the thermal mosaic's refined placements (the pair shares a gimbal), so the two
    mosaics line up.
  - **Output:** a GeoTIFF with frame models.
  - **Interfaces:** a CLI option (e.g. `mosaic --visual`) and the same in the Python API. No UI work.
  - **Release:** the user pushes and tags it there.
- **F2 (app):** pin the new dji-thermal-cli.
  - **Building:** a conversion builds the visual mosaic beside its thermal mosaics, when the dataset has visual
    frames.
  - **Showing:** the viewer gains a Visual tab, as RGB tiles under the basemap switch; the frame page and source frames
    window show each frame's visual pair.
  - **Tests:** pytest for the tiles and pairing; Vitest for the tab and the pairs; a live check on a dataset with
    both.
- **F3 (app):** compare visual and thermal.
  - **Panes:** on the compare page, either pane can show a conversion's visual mosaic, beside a thermal one.
  - **Overlay:** a swipe or opacity overlay of the two on one map, with measurements and findings drawn over both.
  - **Frames:** a frame and its pair side by side on the frame page.

### Open decisions (to ask when planning)

- **Order (decided 2026-10-28):** after D2 and its release.
- **Test data (decided 2026-10-28):** the user provides a folder with a flight that has both `_T` and `_V` images,
  before F1 is built. Its path is noted for this machine, as dataset 6 was. **Provided 2026-10-28:** `ignored/m4t-rgb`,
  the 327 `_V` images (M4T wide camera, 4032×3024, 1.5 GB) of the flight whose 327 `_T` frames are dataset 1. Each
  `_V` image has the same pose fields as its `_T` frame in its XMP: GPS, relative altitude, gimbal and flight yaw,
  pitch and the rangefinder's distance. Its EXIF gives a focal length of 6.72 mm, 24 mm as 35 mm equivalent; there is
  no `DewarpData` or `CalibratedFocalLength`.
- **Pairing (found 2026-10-28):** pair `_V` with `_T` by the capture index (`_0024_`), not by the whole name. In 52 of
  the 327 pairs, the two names' timestamps differ by a second (`DJI_20261022163317_0024_T.JPG` and
  `DJI_20261022163316_0024_V.JPG`). By index all 327 pair up.
- **Cameras (decided 2026-10-27):** any DJI wide visual frame (`_V` or `_W`) with a pose and a 35 mm-equivalent
  focal length in its EXIF, paired with its thermal frame; zoom (`_Z`) frames are left out. Tested on the M4T only.
- **Resolution (decided 2026-10-27):** the visual frames' own (on dataset 1's flight about 0.57 cm/px against the
  thermal 1.6 cm/px, the wide camera seeing about 2.3× wider: roughly 6000×6500 px), with an option to make it
  coarser.
- **Registration (decided 2026-10-27):** the thermal mosaic's placement: each visual frame takes its thermal frame's
  refined shift and rotation and the estimated heights, so the two line up by construction; the one constant offset
  between the two cameras is measured, applied and reported. A visual mosaic is built only with the thermal one.
- **Overlay in F3 (decided 2026-10-28):** side by side, a swipe and an opacity blend; see "F3: decisions".

### F3: decisions (2026-10-28)

- **Panes:** the compare page's mosaic menu lists each conversion's visual mosaic ("· Visual") beside its thermal
  tabs. A visual pane is drawn as the viewer's Visual tab: no palette, its readout the conversion's temperature under
  the cursor, findings drawn over it, and its source frames window opening on the Visual camera. "Difference" is not
  offered while either pane is visual.
- **Overlay:** each pane's Show menu gains "Overlay (A over B)": A's mosaic drawn over B's on one map, with an opacity
  slider and a swipe line dragged across it (both kept in the URL). It works for thermal over visual and for two
  thermal mosaics; the readout gives both values.
- **Frames:** the frame page's switch becomes Thermal / Visual / Both. Both shows the visual pair in a second pane
  beside the thermal frame, the two moving together, with the shapes and the cursor drawn on both; with the
  parameters changed, that pane comes third.

### F2: decisions (2026-10-27)

- **Building:** the convert form shows a "Visual mosaic" checkbox when the dataset has visual frames, on by default.
  The conversion's mosaic job passes `MosaicOptions(visual=True)` to its one `make_mosaic` call; the result is kept in
  `mosaics/visual/` and recorded as `mosaics.visual` (beside the kinds, which the baselines and reports loop over;
  with the cameras' offset from its report). A conversion
  that strips the location keeps a located copy for the map only, as the thermal mosaics do.
- **Resolution:** full, the frames' own (0.6 cm/px and about 86 MB on dataset 1's flight). The map reads a copy
  with overviews, so zoomed-out tiles stay fast.
- **Viewer:** a Visual tab, as RGB tiles (PNG with alpha) from a new endpoint. The readout gives the thermal
  temperature under the cursor; findings and measurement shapes are drawn over it, the measuring tools stay on the
  thermal tabs, and a click opens the source frames window.
- **Frames:** on the frame page and in the source frames window, a Thermal/Visual switch shows a frame's visual
  pair in its place, with the same spot or area marked; ← and → work on both. F3 adds the side by side. As built, a
  shape drawn on the visual pair on the frame page is measured on the thermal frame (the drawing maps it back), so
  the frame page's measuring tools stay on with the switch.
- **Downloads:** the visual mosaic, its sidecar and its preview, like the thermal files.
- **Elsewhere:** the Files tab and the reports call the visual images "visual", not "not thermal".
- **Test data:** dataset 1 gets the 327 `_V` images of its flight (`ignored/m4t-rgb`, 1.5 GB) for good, and is the
  paired flight for this and later checks.
- **Pin:** built once dji-thermal-cli 1.6.0 is on PyPI.

## Running

Requested 2026-10-28 (`new.md`):
- Change the default port to 8080.
- A wrapper shell script, `dji-thermal-ui.sh`, that builds, rebuilds, starts and stops the app, from an existing or a
  fresh environment: `dji-thermal-ui.sh start` serves on 8080 with no `--port`; `build` sets up the environment and
  always rebuilds and updates it; `rebuild` is the same as `build`; `start` runs `build` first when there is no
  environment yet.

### What it builds on

- `cli.py`: `--port` (default 8765), `--data-dir`, `--no-browser`, and the "port in use" check.
- The development setup in the README: `uv sync`, `npm ci && npm run build`, `uv run dji-thermal-ui`.
- The port appears in `cli.py`, the README, CLAUDE.md and the Tooling notes above; `tests/test_cli.py` and
  `scripts/smoke.py` pick their own ports.

- **Built** (2026-10-28): see Done.

### G1: proposed

- **Port:** `--port` defaults to 8080 in `cli.py`, and in the README and CLAUDE.md.
- **Script:** `dji-thermal-ui.sh` at the repo root (bash; Linux, WSL and macOS), committed, not in the wheel or sdist.
  - `build` (and `rebuild`): checks `uv` and `npm` are there (it says how to get them rather than installing them),
    then `uv sync`, `npm ci` and `npm run build`.
  - `start`: runs `build` when there is no `.venv`, `node_modules` or `static/dist`, then starts the server.
  - `stop`: stops the server `start` started.
- **Tests:** a pytest that runs the script's `build`-free paths (start, status, stop) against a temporary data folder
  and port; a live run from a fresh clone.

### G1: decisions (2026-10-28)

- **Start:** in the background, with a PID file and a log (`.run/` in the clone, ignored by git), so `stop` stops it;
  `status`, `logs` and `restart` come with it. Options after `start` go to the command (`--no-browser`, `--port`,
  `--data-dir`); the browser opens as it does now.
- **Update:** `build` reinstalls the dependencies from the lock files (`uv sync --locked`, `npm ci`) and rebuilds the
  pages. It does not pull: the code checked out is left alone.
- **Missing tools:** when `uv` is missing, `build` installs it for the user with uv's own installer, pinned to the
  version CI uses, into `~/.local/bin` (without editing the shell's startup files). Node.js and npm are not installed:
  it says where to get them and stops.

## Viewer

Requested 2026-10-28 (`new.md`):
- Deselect when the user presses Esc or clicks the same selected image tile again.
- Remove the temperature range/scale at the bottom of the image: the one in the right panel makes it moot.
- Source frame view: instead of random colours for the tiles, show the orthomosaic under them, with distinct lines
  between them so the tile boundaries are clear. The colour view isn't helpful.
- Rename the "As converted" tab "Mosaic".
- Move "Under the cursor" above "Source frames", renamed "Pointer info".

### What it builds on

- **Selecting:** a click with no tool on pins the readout (`readout(at, true)`), outlines the frame there from
  `mosaics/footprint`, and on the Source frame and Visual tabs opens the source frames window; "Follow the cursor"
  (`follow()`) lets go of it.
- **The map's scale:** `addLegend` in `map/map.ts`, filled with `ScaleView` on the viewer and the frame page; the
  panel's `Controls` has the same scale. The PNG export draws its own.
- **Source frame tab:** the frame index coloured with `frame_colors` (`colourStyle`'s `index`). The data tiles have
  a gutter, so a shader can read the neighbouring pixels (as the sharpening does): seams can be drawn where the
  index changes, exact at every zoom, over the as converted mosaic.
- **Labels:** `TAB_LABELS` (viewer, compare menu, reports) and `TARGET_LABELS` (measurements); the frame page's
  "As converted" is the frame's, not the mosaic's.

- **Built** (2026-10-28): see Done.

### H1: decisions (2026-10-28)

- **Letting go:** Esc, or a click on the frame already selected, unpins the readout and removes the outline (as
  "Follow the cursor" does). The source frames window stays open. Esc goes to a tool being drawn with, or to the
  window when it has the focus, first.
- **Map scale:** off the viewer's and the frame page's maps, whose panels show it. The compare page keeps its maps'
  scales; the PNG exports and the reports keep theirs.
- **Source frame tab:** the as converted mosaic in the temperature tabs' palette and range, with a line drawn
  where the source frame changes; the cursor and a click still name and outline the frame.
- **Labels:** "As converted" is "Mosaic" wherever it names the mosaic: the viewer's tab, the compare page's menu,
  the reports and the measurements' target. The frame page's "As converted" (the frame's) stays.
- **Panel:** "Under the cursor" becomes "Pointer info", above "Source frames", on the viewer (and on the frame page,
  for the same name).

## Naming and the explorer

Requested 2026-10-28 (`new.md`):
- Rename Conversion to Dataset, as that is its core concept ("I'm open to suggestions, but Conversion is not an
  intuitive UI term").
- Navigation: Mosaics becomes an expandable menu listing the mosaics of the conversion unfolded, each opening on the
  right. Compare gets two items, Converted and Not Converted: choosing one shows a list or thumbnails of those images
  to the right, the first one selected and shown whole in the far right pane; an "explorer" kind of UI.

### What it builds on

- **Names:** the UI has Project › Dataset (the R-JPEGs uploaded or used in place, analyzed) › Conversion (the
  temperature images made with one set of settings, and their mosaics). "Dataset" is taken: renaming Conversion to it
  needs the dataset another name. The models, URLs and API say `dataset` and `conversion`.
- **The pane:** `components/nav-pane.tsx`, its items from `conversionPages()` in `core/navigation.ts` (Mosaics,
  Frames, Compare, Report).
- **Mosaics:** the viewer's tabs (Mosaic, Harmonized, Source frame, View angle, Visual), each a `?tab=` link.
- **Compare today:** two mosaics side by side, their difference, or one over the other (`compare/`).
- **Images:** the dataset's thumbnails (`datasets/<id>/thumbnail`), a conversion's files and what it skipped
  (`thermal_conversion`: `converted`, `skipped`), and the frame page's colouring of a converted frame.
- **What "not converted" turned out to be:** dataset 1's conversion 1 converted all 327 thermal frames and skipped
  none; its mosaic placed 151 and left out 176 as oblique (`kinds.*.oblique`, and `unusable`). The frames the user
  means are those left out of the mosaic, which are converted all the same.

### Decisions (2026-10-28)

- **Names:** Project › Flight › Dataset: the R-JPEGs uploaded or used in place are a Flight, a conversion (its
  settings, temperature images and mosaics) is a Dataset. Only what is seen changes (labels, titles, messages,
  reports, export file names): the URLs, the API, the database and the code keep `dataset` and `conversion`, so links
  and saved views keep working. Names already saved (such as "Conversion 1") stay as they are; new ones are named
  "Dataset N".
- **The pane, under each dataset (conversion):** Tools first (Compare, the mosaics side by side as now, and Report),
  then Mosaics (unfolding to each mosaic, the viewer's tabs), then Frames (unfolding to Mosaic and Oblique).
  Compare and the reports are tools; mosaics and frames are the two ways of analyzing the images. The oblique frames
  matter: their angles show defects a nadir view misses.
- **Frames lists:** "Mosaic" (the frames the mosaic placed) and "Oblique" (those it left out for their angle,
  and the few left out as unusable, marked why), with their counts.
- **The explorer:** choosing a list shows its frames to the right of the pane, as a list or as thumbnails (a switch,
  remembered), in capture order, the first selected; the selected frame is shown on the far right as the frame page
  shows it today (palette, range, Pointer info, measuring, Thermal/Visual/Both), and ← → step through the list. The
  list replaces the frame page's own frame picker.

## Files filters

Requested 2026-10-28 (`new.md`), for the Files tab and the other tabs under a project:
- **Kind:** a dropdown with a checkbox for each kind present, and All, which is the default. Choosing any other kind
  unchecks All, and checking All checks every kind.
- **Filters:** replace "Filter by name" with filters on any column. By default there are none, so every file shows.
  Examples: Height <= 20.0, Kind = Thermal, Min > 32.0, Emissivity > 90.
- **Columns:** add Thermal frames and With problems as columns that can be filtered.
- **The buttons:** All files, Thermal frames and With problems fill in the filter they stand for, as if the user had
  set it. They are starting points for the user's own filter.
- **Favourites:** the current filter is saved under a name. Choosing one from a dropdown replaces the current filter.
  A favourite can be deleted but never overwritten: to change one, save a new one and delete the old.

### What it builds on

- **The Files tab:** `FilesTab` in `dataset/tabs.tsx`, with its rows from `fileRows()` in `dataset/files.ts`.
  - The view is `FilesView {show, filter, sort, desc}`, held by `dataset-page.tsx`, and not kept in the URL.
  - The columns are `FILE_COLUMNS`: File, Kind, Captured, Height, Pitch, Min, Max, Mean, Distance and Emissivity.
  - Kinds: `fileKind()` and `kindLabel()` in `core/format.ts` (Thermal, Visual, Not thermal, Not a JPEG, Damaged,
    Unreadable, Unsupported camera).
- **"With problems" today:** a file named by a problem, a file whose kind is neither thermal nor not thermal, or a file
  with warnings.
- **The Problems tab:** a problem's file opens the Files tab filtered to its name (`showFile`).
- **Saved settings:** `Preferences` (one row, server-side, `api/preferences`) holds the defaults and the last report
  author. Per-browser switches use localStorage (the thumbnails).
- The project page has no tabs. "The other tabs" are the flight page's: Problems, WebODM plan and Convert. Only the
  Files tab has a table of rows to filter.

### Proposed design

- **A filter is a list of conditions:** a column, an operator and a value.
  - Numbers (Height, Pitch, Min, Max, Mean, Distance, Emissivity): =, ≠, <, ≤, >, ≥.
  - Text (File, Captured): contains, does not contain.
  - Kind: is one of (the checkboxes).
  - Thermal frame and With problems: yes or no.
  - Values are compared as the table shows them: temperatures in the unit shown, emissivity as 0.90. A file
    without the value does not match a condition on it.
- **The bar:** "Add filter" adds a condition row (column, operator, value, ×). "Clear" removes them all, and the count
  of files shown stays.
- **The Kind header** has the dropdown of checkboxes. It is the same condition as "Kind is one of", so the two stay
  in step. With All checked there is no Kind condition.
- **The buttons** set the filter: All files sets none, Thermal frames sets "Thermal frame is yes", and With problems
  sets "With problems is yes". A button shows as chosen while the filter is exactly its own.
- **The Problems tab's file links** set "File contains <name>".
- **The filter is kept in the URL** (`?filter=`), as the viewer keeps its view, so a reload or a link keeps it.

### Decisions (2026-10-28)

- **Combining:** a file shows only when it matches every condition (no any/all switch, no groups).
- **Columns:** Thermal frame and With problems are visible columns (a check mark), sorted and filtered like the rest.
- **Favourites:** shared by all flights, saved server-side in `Preferences` (`file_filters`).
- **Scope:** the Files tab only; no other table gets the filters.

## Backup and restore

Requested 2026-10-28 (`new.md`): back up and restore projects. A project is exported whole or with only some of its
flights (all by default), preferably as a tarball. Importing must handle collisions at the project level: a project
name already in use is never reused.

### What it builds on

- **A project's rows:** `Project` › `ThermalDataset` (flight) › `ThermalConversion` (dataset) › `ThermalMeasurement`,
  and `Finding` on the flight (its `conversion` is optional). The flight and conversion `report` fields, the analysis,
  results and mosaics are JSON on the rows.
- **Its files:** `datasets/<id>/images/` (uploaded images; a folder flight reads them in place from `folder`), and
  `datasets/<id>/conversions/<id>/` (TIFFs and mosaics). Thumbnails are made on request, not stored. Flight 1 here is
  1.8 GB of images and 0.5 GB of conversion outputs.
- **Paths in the JSON:** frames are named relative to the images folder, and the outputs relative to the conversion
  folder, so they survive new ids (confirmed in K1 on flight 1: no absolute path in its rows).
- **Preferences** are app-wide (defaults, report author, favourite filters), not a project's.
- **Jobs:** an analysis, conversion or mosaic still running has a `run_id` and a status that would be wrong elsewhere.

### Proposed design

- **The archive:** `<project>.tar` with `manifest.json` (the format version, the app version, the project, and its
  flights, conversions, measurements and findings, with their old ids) and the files under `datasets/<old id>/`.
  It is streamed to the browser as it is written, so no copy is made in the data folder.
- **Export:** an "Export" button on the project page opens a dialog with a checkbox per flight (all checked), the
  size each adds, and what to include. A flight still being analyzed or converted is not offered until it finishes.
- **Import:** "Import project" on the projects page takes an archive. It is read and checked first (the manifest's
  version, the paths staying inside the archive), then becomes a **new project** with new ids, the rows remapped.
  A project of the same name gets a new name (see the decisions). Running statuses come in as canceled.
- **Proposed phases:**
  1. **K1: export**: the archive format, the streamed export, and the dialog.
  2. **K2: import**: reading and checking an archive, the new project, collisions, and a round-trip test. Built:
     see Done.

### Decisions (2026-10-28)

- **Contents:** everything: the rows, the images and the conversions' outputs, so a restore is ready to use at once.
- **Folder flights:** their images are copied into the archive, and they come back as uploaded flights.
- **A name in use:** the import dialog says so and proposes a free name ("Roof (2)"), which the user can change.
  The import waits until the name is free.
- **Format:** a plain `.tar`, not compressed.

### What K2 starts from (K1's archive)

- `manifest.json` comes first: `format` "dji-thermal-ui project", `version` 1, `app`, `exported_at`, `project` (its
  row), and `flights`, each its row with `conversions` (each with its `measurements`) and `findings`. A row is every
  stored field by its column name (`project_id`, `dataset_id`, `conversion_id` hold the old ids), dates as ISO text.
- Files follow as `datasets/<old flight id>/images/<path in the analysis>` and
  `datasets/<old flight id>/conversions/<old id>/<path>` (the `viewer/` copies too). A folder flight's row still says
  `source` "folder" with its `folder`: K2 makes it an uploaded flight.

## Integration

- **ODM through the REST API** (LuxODM or WebODM): authenticate, create a task from a conversion's TIFFs with the
  plan's options, and follow its progress. The plugin's `thermal_task.py` and the task panel in `conversions.js`
  (at LuxODM a2a81052) show what it did.

## Done (kept here briefly as a note, not a tracked deferral)

- **A1: the skeleton** (2026-10-25). The tooling (above), then the package in `src/dji_thermal_ui/`: the data
  folder and secret key (`datadir.py`), settings with SQLite in WAL mode, the three models and `Preferences`
  (`analyzer/models.py`, one initial migration), the job runner (`analyzer/jobs.py`), DRF's CSRF check without users
  (`csrf.py`), and the command (`cli.py`). Leaflet 1.3.1 is vendored in `static/vendor/leaflet/`. Tests: `tests/`
  (pytest; the `flight` test needs `DJI_THERMAL_FLIGHT_DIR`) and `static/__tests__/` (Jest), both passing on Linux
  and on Windows, where dji-thermal-cli's worker processes start fine from the runner's thread.
- **A2: the back end** (2026-10-25). The plugin's API (`analyzer/api.py`, `analyzer/urls.py`, under `/api/`) and its
  `thermal_*` modules, without projects, permissions, quota or the ODM task; downloads with zipstream-ng
  (`analyzer/downloads.py`); WebODM's tiler, colour maps, statistics, correction, path check and the measurement
  functions (on shapely, not GEOS) copied into `analyzer/raster/` with their notices. Temperatures are in the app's
  unit, °F by default, in the preferences. Tests: `tests/test_api_*.py` (the plugin's API tests on fakes),
  `tests/test_raster_*.py` and `tests/test_thermal_correction.py`, and `tests/test_flight.py` on real frames.
  Checked live on the 220 M4T frames: a folder dataset analyzed, converted, made into mosaics (209 frames), then
  points, tiles, a measured and saved area, its CSV and GeoJSON, and the download.
- **A3: the front end** (2026-10-25). Stock Bootstrap 3.4.1 and Font Awesome Free 5.15.4 vendored with their
  licences in `static/vendor/`; the header and the unit in `templates/base.html` and `static/app.js`/`app.css`; the
  five pages (`analyzer/views.py`, `templates/`); the plugin's scripts and `analyzer.css` in `static/`, without
  projects, sharing, permissions or the task panel. Tests: `static/__tests__/` (Jest) and `tests/test_pages.py`.
  Checked live in headless Chromium on the 220 M4T frames: the dataset made, analyzed and deleted; the defaults
  saved and reset; a conversion, its mosaics and the zip; the viewer's tabs, palette, readout, a box measured and
  saved, its CSV, GeoJSON and the PNG export; a frame with a changed distance; compare as the difference; the unit
  switched. No console errors and no failed requests.
- **A4: packaging, release 0.1.0** (2026-10-25). The README and `CHANGELOG.md`; the vendored licences in
  `license-files`; `scripts/check_dist.py` (only the package's own files in the wheel and sdist) and
  `scripts/smoke.py` (the installed command started on a free port and a temporary data folder, its pages and API
  fetched, then the whole process tree stopped); CI in `.github/workflows/ci.yml` (ruff and ESLint, pytest on Linux
  and Windows with Python 3.12 and 3.14, Jest, the build checks, the smoke check of the wheel on both systems),
  publishing nothing. The Windows run found paths stored and zipped with `\` and rows made in the same clock tick
  listed in either order; both fixed on their own branch (`relative()` gives `/`, ordering by `-created_at, -id`).
  `release/0.1.0` sets the version and dates the changelog. Release checks passed on Linux (check_dist, twine,
  smoke on 3.12 and 3.14, ruff, 141 Jest, ESLint, 124 pytest) and on Windows from WSL (124 pytest, the wheel built,
  smoke on 3.12 and 3.14).
- **B1: the pages rebuilt, release 0.2.0** (2026-10-27). The five pages in TypeScript and Preact (`frontend/src`,
  one Vite entry per page in `frontend/src/pages`), Leaflet 1.9.4, the app's own stylesheet
  (`frontend/src/styles/app.css`) with light and dark tokens, the theme in the preferences and the header; the build
  in `src/dji_thermal_ui/static/dist/` (gitignored, shipped in the sdist and wheel) read by the `{% vite_entry %}` tag
  (`analyzer/templatetags/vite.py`). Bootstrap, Font Awesome, the old scripts and Jest removed. Tests: Vitest
  (`frontend/tests`, 138), pytest against a stub manifest (`tests/data/vite-manifest.json`), ESLint with tsc. CI
  builds the pages before the distributions; `check_dist.py` requires each page's entry and files. The walk-through
  found three bugs, fixed (one, the black legends of rio-tiler's colour maps, on `main` since A2). Release checks
  passed on Linux (check_dist, twine, smoke on 3.12 and 3.14, ruff, 129 pytest, 138 Vitest, ESLint) and on Windows
  from WSL (129 pytest from a fresh clone, smoke on 3.12 and 3.14).
- **B2: the map pages on OpenLayers, release 0.3.0** (2026-10-27). The viewer, compare and frame pages on
  OpenLayers 10.11.0 (`frontend/src/map/map.ts`), Leaflet removed. The server sends float32 values
  (`data_response` in `analyzer/api.py`: `mosaics/<tab>/data/`, `mosaics/<tab>/difference/data/`, `frame/data`, with
  `X-Width` and `X-Height`), and the browser colours them (`frontend/src/map/colour.ts`): a WebGL style with the
  tone curve baked into the palette, the isotherm, and sharpening as a 5 × 5 kernel in the shader; the same on a
  canvas for the compare page's picked frames (`colourValues`). The PNG tiles and frame image, the server's
  colouring and scipy removed. Tests: Vitest (`frontend/tests`, 153, `colour.test.ts` new), pytest (129, the data
  tiles in `tests/test_api_mosaics.py`). Release checks passed on Linux (check_dist, twine, smoke, ruff, 131 pytest
  with the flight tests, 153 Vitest, ESLint) and on Windows from WSL (129 pytest from a fresh clone, smoke on 3.12
  and 3.14).
- **B3: the basemaps, release 0.4.0** (2026-10-27). Mapbox's satellite imagery through the Static Tiles API with
  the user's own public token (`analyzer/basemaps.py`: the `mapbox_token` preference, else `MAPBOX_API_TOKEN` from
  the environment or a `.env` file; `PUT /api/preferences` saves and removes it), the switch, the token form with
  how to get one, the wordmark and attribution (`frontend/src/map/basemaps.ts`, `frontend/src/map/mapbox-token.tsx`,
  the wordmark in `static/vendor/mapbox/`), and Esri's layer reading its tilemap to stretch its deepest level instead
  of "Map data not yet available". Tests: `tests/test_basemaps.py` (pytest), `frontend/tests/basemaps.test.tsx`
  (Vitest). The README says how to get a token. The release checks found check_dist refusing the wordmark, fixed on
  its own branch. Release checks passed on Linux (check_dist, twine, smoke on 3.12 and 3.14, ruff, 143 pytest with
  the flight tests, 164 Vitest, ESLint) and on Windows from WSL (141 pytest from a fresh clone, smoke).
- **E1: projects** (2026-10-27). `Project` and each dataset's `project` (`analyzer/models.py`; a dataset saved
  without one goes into the first), the migration making the Default Project and moving the datasets into it
  (`migrations/0003_projects.py`), and `Project.default()` making it again whenever none is left. `/api/projects`
  (list, make, change, delete with the datasets and their folders), a project's disk space and each dataset's flight
  area (the hull of its frames' positions, `thermal_analysis.flight_area`); datasets made in, listed by and moved to
  a project; compare listing the project's conversions first (`analyzer/api.py`). The projects page is the home page
  and a project has its page with the map of its flights and its datasets (`frontend/src/projects/`); the dataset
  page leads back to its project. Tests: `tests/test_api_projects.py` (with the migration), `tests/test_pages.py`,
  `frontend/tests/projects.test.tsx`, `frontend/tests/datasets.test.tsx` (moving a dataset). Checked live in headless
  Chromium on the real data folder (its database backed up first and restored after): the migration, a project
  made, the dataset moved into it and back, its flight area on the map, the breadcrumb, the delete dialog, compare;
  light, dark and 390 px wide; no console errors or failed requests.
- **E2: the location** (2026-10-27). `/api/places` (`?q=` a search, `?lon=&lat=` the address at a point) asking
  OpenStreetMap's Nominatim from the server with the app's user agent, one request a second at most, in the browser's
  language (`analyzer/places.py`, `NOMINATIM_URL` in the settings). On the project's form, the search, its results
  and their credit, the map the point is clicked on, the label edited, and the location cleared
  (`frontend/src/projects/location-field.tsx`, `location-map.tsx`, `places.ts`); the projects page has the basemaps
  for it. Tests: `tests/test_places.py` (a fake Nominatim), `tests/test_pages.py`, `frontend/tests/location.test.tsx`
  (the map stood in for). Checked live in headless Chromium against Nominatim, light, dark and 390 px wide: a search,
  a result picked, a point clicked and named, the project made and shown with its pin, the location cleared, the
  project deleted. No console errors and no failed requests.
- **E3: the navigation pane and preferences** (2026-10-27). `/api/navigation` (projects, their datasets and
  conversions, and which of a conversion's pages are ready), the `locale` preference, `/preferences`, and the flight's
  time zone (`flight_zone` in the dataset, frames and mosaics APIs: the offset between the frames' recorded time and
  their UTC time, `analyzer/thermal_analysis.py`). The pane with the toggle in the header, remembered shown and
  unfolded, the current page marked, an overlay with a backdrop under 768 px, relisted after a change
  (`frontend/src/components/nav-pane.tsx`, `core/navigation.ts`, `core/page.tsx`); User Preferences (unit, theme,
  locale with an example, `frontend/src/preferences/`); dates in the locale and capture times in the flight's zone
  (`core/format.ts`). Tests: `tests/test_navigation.py`, `tests/test_pages.py`, `frontend/tests/navigation.test.tsx`.
  Checked live in headless Chromium on the user's data, light, dark and 390 px wide: the pane, hidden and kept, the
  dataset analyzed again and shown in UTC−5, the locale and theme saved. No console errors and no failed requests.
- **C1: dji-thermal-cli 1.5.0** (2026-10-27). Released there (frame models in the mosaic's sidecar,
  `read_frame_models` and `FrameModels`; its model reproduces the mosaic's own sampling for 99.6% of pixels on the
  220 M4T frames), and pinned here in `pyproject.toml` and `uv.lock`. Test: `tests/test_flight.py` reads a mosaic's
  frame models back and finds its centre in a frame.
- **C2: the source frames pop-out** (2026-10-27). `POST …/mosaics/<tab>/sources` (`analyzer/thermal_sources.py`,
  `MosaicSourcesView` in `analyzer/api.py`): a spot's frames with its pixel in each, or an area's with the share each
  saw, the share the mosaic took from it and the area's outline in its pixels, from the frame models; a mosaic built
  before 1.5.0 lists only the frames it used. The window (`frontend/src/sources/`): moved by its title and kept
  there, ←/→ and Esc, the frame coloured as the mosaic, a list for each mosaic of a difference. On the viewer: a
  Source frames tool, a click on the Source frame tab, and a button under a spot or area measurement; on the compare
  page it replaces the Picked point panel. Tests: `tests/test_api_sources.py`, `tests/test_flight.py`,
  `frontend/tests/sources.test.tsx`. Checked live in headless Chromium, light and dark, on the user's data (one frame
  and the rebuild note) and on a copy with its mosaics rebuilt (42 frames for a spot, 112 for a box, the outline in
  each). No console errors and no failed requests. Released as 0.5.0 with E1–E3 and C1: the release checks found
  check_dist and the smoke check still expecting the datasets page E1 replaced, fixed on their own branch. Release
  checks passed on Linux (check_dist, twine, smoke on 3.12 and 3.14, ruff, 198 pytest with the flight tests, 206
  Vitest, ESLint) and on Windows from WSL (196 pytest from a fresh clone, smoke).
- **F1: live sliders and the scale's ends** (2026-10-27). The viewer, frame and compare pages colour the map from
  the style of a slider being dragged (`dragged` in `viewer-page.tsx` and `frame-page.tsx`, `drawnStyle` in
  `compare-page.tsx`); `ThermalLayer.setColouring` (`map/map.ts`) sets the shader's variables when only the range or
  the sharpening changed, and compiles the style again otherwise. The steps are `SLIDERS` and the scale's labels
  `scaleTicks` (`viewer/view.ts`). Tests: `frontend/tests/view.test.ts` (steps, the scale's ends),
  `viewer.test.tsx` and `compare.test.tsx` (drawn while dragged, kept when let go, no curve asked meanwhile).
  Checked live in headless Chromium on the 220 M4T frames, light and dark: every slider on the three pages redraws
  the map while held, and it is the same once let go; the scales read e.g. 49.2, 80, 100, 125.4; no console errors
  and no failed requests. Released as 0.5.1: release checks passed on Linux (check_dist, twine, smoke on 3.12 and
  3.14, ruff, 198 pytest with the flight tests, 210 Vitest, ESLint) and on Windows from WSL (196 pytest from a fresh
  clone, smoke).
- **C3: findings on the viewer** (2026-10-27). `Finding` on the dataset (`analyzer/models.py`, migration 0004),
  its API under `/api/datasets/<id>/findings` (`analyzer/api.py`: drawn spots and areas measured on the tab shown, or
  a saved measurement copied; the frames from `frame_sources`, shared with the source frames window), and the counts
  and the project's findings list. The viewer's part in `frontend/src/findings/` (helpers, the map layer, the form,
  list and window heading) and `viewer/viewer-page.tsx`; the view in the URL keeps `findings=0`, `hide=` and
  `finding=`. A spot far from a mosaic made a 500, also on `main`: fixed on its own branch (`mosaic_measure` checks
  the shape lands in the mosaic's CRS). Tests: `tests/test_api_findings.py`, `frontend/tests/findings.test.ts`, and
  findings tests in `viewer.test.tsx` and `projects.test.tsx` (214 pytest, 219 Vitest, ESLint and ruff clean).
  Checked live in headless Chromium on the 220 M4T frames, light and dark: a box from the source frames window with
  one frame left out, a saved spot measurement saved as a finding, both drawn and tagged, a click on the map opening
  one, hiding one and the switch in the URL, a change of status, a link opening one, the project page's list and
  the counts, then both deleted; no console errors and no failed requests.
- **C4: findings on the compare page** (2026-10-27). In `compare/compare-page.tsx`: a Drawing on each pane's map
  (Spot and Area, `Toolbar` in its compact form), each pane drawing its datasets' findings (`findings/layer.ts`, with
  `centreOf` shared with the viewer), the findings of the datasets shown loaded once each, the window's per-mosaic
  "Save as finding" (`SourceGroup.about`, `SaveFinding` in `findings/panel.tsx`) and a finding's heading with Change
  and a link to the viewer; the URL keeps `findings=0`, `a_finding=` and `b_finding=` (`compare/compare.ts`). No
  change to the back end. Tests: findings tests in `frontend/tests/compare.test.tsx`, a map click made up through
  `MapBrowserEvent` (223 Vitest, ESLint clean). Checked live in headless Chromium on the 220 M4T frames, light and
  dark: a spot saved from pane A, an area from pane B, a spot from B's mosaic of a difference (saved on conversion 2),
  a click on the map opening one, a change of status, the switch in the URL, a link opening one in pane B and its
  link to the viewer. The pane's tool hint pushed its map down: the toolbar now keeps it as a tooltip. No console
  errors, no failed requests, no findings left. Released as 0.6.0: release checks passed on Linux (check_dist, twine,
  smoke on 3.12 and 3.14, ruff, 216 pytest with the flight tests, 223 Vitest, ESLint) and on Windows from WSL (214
  pytest from a fresh clone, smoke).
- **D1: the dataset report** (2026-10-28, branch `d1-dataset-report`): `/dataset/<id>/report`
  (`views.dataset_report`, `templates/dataset_report.html`, entry `pages/dataset_report.tsx`), the page in
  `frontend/src/report/` (`dataset-report-page.tsx`; the summaries, numbering and defaults in `report.ts`). The text
  is the dataset's `report` field (migration 0005), changed a field at a time with its PATCH (`parse_report` in
  `api.py`; null forgets one) and the last author kept as the preference `report_author`; the dataset's detail adds
  `flight_area`. A Report button on the dataset page and a Report entry under each dataset in the pane. Print styles
  at the end of `app.css`; the dark tokens now apply on screen only, so every page prints light. A setting with more
  than 6 values (reflected and ambient temperatures, measured at each frame) is given as its range. Tests: pytest in
  `test_pages.py`, `test_api_datasets.py` and `test_vite.py` (each page the views serve is one Vite builds: the stub
  manifest had hidden a page named with a hyphen, which Vite skips), 219 passed; Vitest in
  `frontend/tests/report.test.tsx` and the pane's in `navigation.test.tsx`, 237 passed; ESLint and ruff clean.
  Checked live in headless Chromium on dataset 1 (327 frames), light and dark: a temporary finding, the text typed and
  saved, the appendix on, `page.pdf()` to A4 and Letter (the same in both themes) and the print layout looked at;
  fixed from it: the date as large as the title, a setting listing dozens of values, the appendix wider than the page.
  No console errors, no failed requests; the finding deleted and the report's text put back (`{}`). The author was
  not typed live, as the preference cannot be cleared through the API (its saving is covered by pytest).
- **D2: the mosaic report** (2026-10-28, branch `d2-mosaic-report`): `/conversion/<id>/report`
  (`views.conversion_report`, `templates/conversion_report.html`, entry `pages/conversion_report.tsx`).
  - **Page:** `frontend/src/report/conversion-report-page.tsx`, with the view, colouring, close-up extents and
    findings on the mosaic in `mosaic-report.ts`.
  - **Figures:** `figures.ts` draws them off the page with a `ThermalLayer` of its own and makes them into images
    with `snapshot` and `viewCanvas`, one map at a time. The page cannot be printed until they are drawn.
  - **Shared with D1:** `text.tsx` (the text saved as typed, the title block, the bar) and `findings.tsx`.
  - **Server:** the conversion's `report` field (title, author, date, notes, view, left_out; migration 0006),
    changed with its PATCH (`parse_report` with `MOSAIC_REPORT`, the view checked by `report_view`), and the
    measurement's `comment` (its PATCH, the CSV's Comment column, the GeoJSON's property).
  - **Viewer:** a Report button saves the view shown, then opens the report. The pane lists the report under each
    conversion with mosaics. `viewCanvas` gained north and coloured marks.
  - **Tests:** pytest in `test_api_conversions.py`, `test_api_measurements.py`, `test_pages.py` and `test_vite.py`
    (222 passed). Vitest in `frontend/tests/mosaic-report.test.tsx` (its figures mocked: jsdom has no WebGL), the
    viewer's Report button and the pane (247 passed). ESLint and ruff are clean.
  - **Live check:** in headless Chromium on dataset 1's conversion 2, light and dark, with three temporary
    measurements (a line, an area, a spot on a frame) and a finding. The viewer's Report button saved the
    harmonized view, the four figures were drawn, a comment was typed, a measurement left out, and the report
    printed to A4 and Letter and looked at.
  - **Fixed from the live check:** every figure undrawn on the first run (the image is now waited for 10 s and
    asked for again once), and the caption and the profile's hint in the print.
  - **Left as found:** no console errors or failed requests; the measurements and finding deleted, the report's
    text put back (`{}`).
  - **Released as 0.7.0** with D1: release checks passed on Linux (check_dist, twine, smoke on 3.12 and 3.14,
    ruff, 224 pytest with the flight tests, 247 Vitest, ESLint) and on Windows from WSL (222 pytest from a fresh
    clone, smoke).
- **F1: visual mosaics in dji-thermal-cli** (2026-10-27, there: branch `mosaic/visual`, released as dji-thermal-cli
  1.6.0, merged into its `main`, not pushed or tagged). `--mosaic-visual` / `MosaicOptions(visual=True)`
  (`visual.py`; `read_pose(visual=True)`, `_place(r=...)` in `mosaic.py`; RGBA in `tiffout.write_tiff`):
  `mosaic_visual.tif` (red, green, blue, alpha; 8-bit, UTM), its sidecar with the visual frames (each with
  `thermal_file`) and `frame_models` (read by `read_frame_models`), and `mosaic_visual_preview.png` (at most 2048
  px). As the app calls it with `as_converted_dir`, the visual mosaic is written once, in the harmonized folder.
  - **Pairing:** by `UTCAtExposure` within 0.25 s (by content, as the CLI identifies files), else the capture
    number in the same folder. On dataset 1's flight the pairs are 10 to 100 ms apart and the captures at least
    0.57 s, so it agrees with the capture index for all 327.
  - **Placement:** the thermal frame's attitude with the alignment's boresight, its shift, rotation and surface;
    the visual frame's own position and lens (35 mm equivalent: 2795 px on the M4T's wide camera).
  - **The cameras' offset:** each pair's offset is measured by phase correlation of gradient magnitudes on the
    largest square inside the thermal footprint, and solved robustly as one pitch and yaw. On dataset 1's flight
    it was 10 cm before and 2.6 cm after correction (median, 94 pairs), at pitch +0.25° and yaw −0.29°. On the
    CLI's own M4T flight (12 pairs, on Windows) it was +0.28° and −0.31°.
  - **Size:** dataset 1's visual mosaic is 5764×6256 px at 0.6 cm/px and 86 MB, about a minute after the thermal
    mosaic. `--mosaic-visual-gsd` makes it coarser, decoding the JPEGs at 1/2, 1/4 or 1/8 of their size.
  - **Tests:** `tests/test_visual.py`. A synthetic flight whose visual camera is turned 0.4°/−0.3° is recovered
    to 0.05°. Also tested: pairing, posing, the GeoTIFF and frame models, threads, and a flight test of the API
    and CLI. Full suite 905 passed with the CLI's flight and the native SDK; on Windows 218 passed from a fresh
    clone with 12 nadir pairs. The flight tests first assumed the offset is always corrected, which a small
    flight doesn't give; they now follow the report (fixed on `fix/visual-flight-tests`).
- **F2: visual mosaics and frames in the app** (2026-10-28, branch `f2-visual`; dji-thermal-cli pinned at 1.6.0).
  - **Server:** `thermal_mosaics.build` asks for the visual mosaic (the conversion option `visual`, on by default)
    and `build_visual` moves it to `mosaics/visual/`, writes the map's copy `viewer/visual.tif` (`map_copy`: tiled
    512, JPEG YCbCr q90, the alpha as an internal mask, average overviews; 14 MB against 85 MB on dataset 1's
    flight, tiles in 30 to 60 ms) and `viewer/visual_pairs.json` (`visual_pairs`). A stripped conversion writes a
    located copy for these and removes it. API: `mosaics/visual/tiles/z/x/y.png` (`VisualTileView`),
    `frame/visual?frame=&size=` (`FrameVisualView`, re-encoded without metadata), `visual` and `visual_note` in the
    viewer's data, each frame's `visual` pair in `frame` and the sources, and the datasets' `visual` count.
  - **The pairs' homography** (`thermal_mosaics.homography`): a thermal pixel to its visual one, from the two
    sidecars' frame models, through the cameras' rotations and the drone's move between the two exposures onto
    the ground plane. On dataset 1's flight it lands 0.24 visual px from the visual frame model (median, at most
    2.9 px on the roofs); without the move the median was 2.5 px and the maximum 16 px, as the visual image is
    exposed 10 to 100 ms after the thermal one.
  - **Pages:** the viewer's Visual tab (`visualLayer` in `map/map.ts`; the data tab stays as converted, so the
    readout, the source frames and the shapes drawn are its), its report rows (`visualRows`); the source frames
    window's Thermal/Visual switch (`VisualImage`, `toVisual`/`ringToVisual` in `sources/sources.ts`); the frame
    page's switch (`frameImageLayer`; its drawing and readout map through `fromVisual`, and the view keeps the same
    ground); "Visual" in the Files tab, the figures, the datasets list and the convert form's checkbox
    (`fileKind`, `thermal_analysis.VISUAL_NAME`: DJI's `_V`/`_W` names, for what the pages call them only).
  - **Tests:** `tests/test_api_visual.py` (fakes with real frame models in `tests/fakes.py`: the homography against
    `FrameModels.pixels`, the pairs, the build, the map copy, the tiles, the stripped copy, the frame image, the
    download), the flight test of a paired flight (`DJI_THERMAL_FLIGHT_DIR` with `_V` images; skipped without),
    Vitest for the mapping, the window's and frame page's switches, the Visual tab and the rows. Checked live on
    dataset 1, which now holds the flight's 327 `_V` images too (its conversion 1 rebuilt with the visual mosaic,
    92 pairs measured, pitch +0.25° and yaw −0.29°), in light and dark: the tab, the readout, a click's window on
    both cameras, a box drawn and measured on a visual frame, the Files tab and the convert form. No console
    errors and no failed requests.
  - **Also on this branch:** the test of the command retries reading the journal mode while Windows still holds
    the stopped server's database files (it failed now and then on CI's Windows with Python 3.14; merged before as
    `fix-windows-wal-test`).
- **F3: comparing visual and thermal** (2026-10-28, branch `f3-visual-compare`).
  - **Compare page:** the mosaic menu lists each conversion's visual mosaic (`comparable` says `visual`;
    `comparedTabs`, `dataTab` and `VISUAL` in `compare/compare.ts`). A visual pane draws the visual tiles
    (`visualLayer`), reads the as converted values (readout, source frames, a finding's tab), opens its window on
    the visual pairs, has no palette or colour scale, and turns the difference off and keeps it from being chosen.
    "Overlay (A over B)" draws both panes' mosaics in one pane (`drawsOf`/`layersOf` in `compare-page.tsx`, the
    top one faded and cut by `clipLeft` in `map/map.ts`: a scissor on WebGL, a clip on a canvas); opacity and swipe
    are in the URL (`overlay=`, `opacity=`, `swipe=`), and the readout gives A and B without A − B.
  - **Frame page:** the switch is Thermal / Visual / Both (kept as before in localStorage: "1" Visual, "2" Both).
    Both shows the pair in a side pane (`SIDE`) with its own view (`frameView(32)`), which follows the frame's
    through the pair and the reverse (`viewThere`). The shapes and the cursor are drawn on every pane, and the
    PNG export takes the side pane.
  - **Tests:** pytest for `comparable`'s flag; Vitest for the URL, the tabs offered, the visual pane, the overlay's
    layers, opacity, swipe and readout, and Both's pane and its view following. Checked live on dataset 1, light and
    dark: a visual pane beside a thermal one, A over B swiped and faded (a 50% blend is the mean of the two
    pixels), an overlay of two thermal mosaics, the window from a visual pane, Both with a spot measured, zoomed
    and stepped to the next frame, and the PNG export. No console errors and no failed requests.
- **G1: the default port and a wrapper script** (2026-10-28). `cli.py` serves on 8080 by default and stops like
  Ctrl+C on SIGTERM; `dji-thermal-ui.sh` (build, rebuild, start, stop, restart, status, logs; `.run/` for its PID
  file and log). Tests: `tests/test_script.py` (the script in a clone of its own, with stub uv, npm and curl) and
  `tests/test_cli.py`. Checked live from a fresh clone: `start` built it and served on 8080 with no `--port`, then
  restart, logs, rebuild, stop and status.
- **H1: the viewer tidied** (2026-10-28). `viewer/viewer-page.tsx`: Esc or a click on the frame kept lets go of it
  (`readout`'s `kept`); the Source frame tab draws the as converted values with a second `ThermalLayer` of the source
  frame index coloured `seams` (`map/colour.ts`: light and dark where the index changes, in WebGL and on a canvas),
  in the PNG export too; no legend on the viewer's or the frame page's map; Pointer info above Source frames. "Mosaic"
  in `TAB_LABELS` and `TARGET_LABELS`. Tests: `frontend/tests/colour.test.ts` (the seams), `viewer.test.tsx` (letting
  go, the seams layer, the panel's order and scale) and the labels throughout. Checked live on dataset 1 in light and
  dark: the tabs, Esc and a second click letting go (the window left open), the seams at two zooms and in the PNG,
  the frame page without its map scale, and the compare page's scales. No console errors or failed requests.
  - **Then** (2026-10-28): the mosaic report's Source frame figure too: the as converted mosaic coloured as the
    temperatures are, with the seams over it (`underOf` in `report/mosaic-report.ts`, `Source.over` in
    `report/figures.ts`, `SEAMS` in `map/colour.ts`). Test: `frontend/tests/mosaic-report.test.tsx`. Checked live
    on dataset 1's report in light and dark, its saved view put back as it was.
- **I1: the names** (2026-10-28). Every visible string says flight for a `dataset` and dataset for a `conversion`:
  the pages in `frontend/src` (lists, the flight page and its Convert tab, the reports, the viewer, compare, frame,
  findings and preferences), the server's messages (`api.py`, `thermal_*.py`, `views.py`), the command's help, and
  new datasets' default name "Dataset N" (`api.py`). The README calls them so throughout; CLAUDE.md says which name
  is which. Tests: the strings updated in `frontend/tests/` and `tests/`. Checked live on every page: what still says
  otherwise is a name saved before ("Conversion 1") or dji-thermal-cli's own problem text ("dataset median").
- **I2: the navigation** (2026-10-28). Under each dataset, Tools (Compare, Report), Mosaics (each viewer tab, a
  `?tab=` link) and Frames ("In the mosaic" and "Oblique", `frame?list=mosaic|oblique`, with counts; one list for a
  dataset without mosaics). The navigation API gives a built conversion's `tabs`, `in_mosaic` and `oblique` (left out
  for their angle or as unusable) (`nav_conversion` in `api.py`); the pane's items and the marked one are worked out
  in `core/navigation.ts` (`conversionItems`, `trailTo`, `markedItem`), the deepest item seen is marked, and the
  viewer says when its tab changes (`partChanged`). The frame page shows only the list's frames (`listFrames` in
  `frame/frame.ts`) and keeps `list` in its URL; I3 makes it the explorer. The tab labels are in
  `viewer/tab-labels.ts`, so the pane imports no viewer code. Tests: `tests/test_navigation.py`,
  `frontend/tests/navigation.test.tsx`, `frontend/tests/frame.test.tsx`. Checked live on dataset 1: 151 in the
  mosaic and 176 oblique, the viewer's tab followed, the lists stepped through with →.
- **I3: the frames explorer** (2026-10-28). The frame page lists its frames (the pane's list, or all) beside the
  frame, in capture order (`captureOrder` in `frame/frame.ts`), the first shown, as a list or thumbnails (the
  dataset's `thumbnail`, a switch kept in localStorage `thermal-analyzer.frame.thumbnails`), the frame shown kept in
  sight (`frame/frame-list.tsx`); it replaces the frame picker. Each frame says what its list does not
  (`frameTag`): not converted, in the mosaic, oblique above the mosaics' pitch limit (the frames API's `max_pitch`,
  from `thermal_mosaics.max_pitch`, which the mosaics use too) or left out as unusable. Tests:
  `frontend/tests/frame.test.tsx`, `tests/test_api_measurements.py`. Checked live on dataset 1, light and dark: 176
  oblique frames in capture order (all tagged oblique, as the mosaic's report counts them), 151 in the mosaic, ← →
  keeping the frame in sight and the list in the URL, the thumbnails loading as they scroll in and the switch kept
  over a reload, the list above the frame at 700 px; no errors.
- **J1: the Files tab's filters** (2026-10-28). The name search became a list of conditions every row matches
  (`Condition`, `matches`, `fileRows` in `dataset/files.ts`): numbers in the unit shown (= and ≠ at the digits shown),
  text by its words, Kind as checkboxes (`KindPicker` in `dataset/tabs.tsx`, in the Kind header and in a condition),
  and yes/no on two new columns, Thermal frame and With problems (`FLAG_COLUMNS`, the Files tab's columns being
  `FILES_TAB_COLUMNS`; the report's appendix keeps `FILE_COLUMNS`). The three buttons set their filter (`SHOWS`,
  `shownAs`). The filter is in the URL (`?filter=key.op.value`, `filterQuery`/`parseFilters`). Tests:
  `frontend/tests/dataset.test.tsx`. Checked live on flight 1 in °F, light and dark: 654 files, 327 thermal frames,
  177 with problems; Kind without Visual, Height ≤ 21.15 m and Min > 50 °F showing the 34 the data has, kept over a
  reload; Clear back to 654; no overflow at 700 px; no errors.
- **Release 0.8.0** (2026-10-28): F2 to K2, the report's seams and the two fixes below (the changelog's two Changed
  sections made one). Release checks passed on Linux (check_dist, twine, smoke on 3.12 and 3.14, ruff, 273 pytest
  with the flight tests, 300 Vitest, ESLint) and on Windows from WSL (264 pytest from a fresh clone, 9 skipped;
  smoke of the final wheel).
- **Fix: New Flight's folder picker and TIFFs** (2026-10-28, reported by the user: "Ability to create new flights
  seems to be completely broken"). "Choose a folder" gave Preact `webkitdirectory: ""`, which it sets as the
  property, false: the input was a file picker, where a folder cannot be chosen; it is `true` now. Files chosen
  with no JPEG among them (the user chose TIFFs) said "Choose the images to upload"; `noImagesText` now says that a
  flight is made of R-JPEGs, as soon as they are chosen and on Create (`datasets/new-dataset.tsx`). Tests:
  `frontend/tests/datasets.test.tsx` (the folder test with the property as browsers have it; both fail on the old
  code). Checked live on 8080: TIFFs by files and by folder told apart, R-JPEGs by files and by folder made flights
  (deleted after).
- **Fix: the Oblique frames list** (2026-10-28, reported by the user). A conversion with a pitch limit does not
  convert its oblique frames, so the Oblique list (converted frames the mosaics left out) was empty and fell back to
  every frame, the mosaic's included. It now lists every frame the mosaics left out, converted or not (tagged
  "oblique, -45°, not converted"), and falls back to all only while the mosaics placed none; "In the mosaic" is
  called "Mosaic" in the pane. `listFrames`, `frameTag` (`frame/frame.ts`), `FRAME_LISTS` (`core/navigation.ts`).
  Tests: `frontend/tests/frame.test.tsx`, `navigation.test.tsx`. Checked live on both datasets of flight 1:
  Mosaic 151 and Oblique 176 each, as a list and as thumbnails.
- **K2: import a project** (2026-10-28). `analyzer/restore.py`: the archive sent in pieces of 16 MB (waitress takes
  1 GB a request at most) to `api/imports` (`POST` {size}, refused without the room; `PUT ?offset=` each piece, one
  sent again read from where the last stopped, 409 for a gap; `POST` {name} finishes; `DELETE` stops). Each piece is
  unpacked as it comes by a tar reader of its own (tarfile's header parser, PAX and GNU long names) into
  `imports/<id>/`; the manifest, first, is checked (format, version, rows) and summed up with a free name
  (`free_name`). A file outside the manifest's flights, a path leaving its folder, a link or a damaged tar is refused
  and the folder removed. Finishing makes the rows with new ids in one transaction (`full_clean` on each), remaps the
  links and a mosaic report's `left_out` and `view.hidden`, makes folder flights uploaded and running jobs canceled,
  and renames the folders into place. `clear_imports` at the server's start. The export now keeps dates to the
  microsecond. The Import dialog (`projects/import-dialog.tsx`, `sendArchive`). Tests: `tests/test_api_import.py`,
  `frontend/tests/projects.test.tsx`. Checked live on project 1 (on 8081), light and dark: the 2.2 GB archive's
  project known in 0.15 s with "Default Project (2)" proposed, a name in use refused, received in 13 s, imported in
  0.1 s; its images and both datasets' outputs identical to flight 1's, its rows the same; the copy's viewer showed
  its mosaic; no overflow at 700 px; no errors; both copies deleted.
- **K1: export a project** (2026-10-28). `analyzer/backup.py`: the tar written by hand (PAX headers, its length
  known beforehand) as `manifest.json` then each flight's files; a folder flight's JPEGs as dji-thermal-cli's scan
  finds them. `api/projects/<id>/export` lists each flight's bytes (or busy), `export.tar?flights=<ids>` streams it
  (409 for a busy flight). The Export dialog (`projects/export-dialog.tsx`) on the project page. Tests:
  `tests/test_api_export.py`, `frontend/tests/projects.test.tsx`. Checked live on project 1 (on 8081), light and
  dark: 2.2 GB listed, downloaded in 16 s at the length announced, GNU tar listed 1634 entries (manifest, 654
  images, 979 outputs) and extracted identical to the data folder; no overflow at 700 px; the archive deleted.
- **J2: favourite filters** (2026-10-28). The Files tab's Favourites menu (`Favourites` in `dataset/tabs.tsx`): the
  filter shown saved under a new name, a favourite chosen in place of the filter (marked while the filter is its own),
  and deleted once asked. They are shared by every flight, in `Preferences` under `file_filters` as the link's
  `key.op.value` conditions (`filtersFrom` in `dataset/files.ts`), through `api/file-filters` (`FileFiltersView`,
  409 for a name in use). Tests: `tests/test_api_file_filters.py`, `frontend/tests/dataset.test.tsx`. Checked live on
  flight 1 (on 8081), light and dark: saved, refused under the same name, listed after a reload, chosen (67 files,
  its link), deleted; the menu kept inside the page at 700 px; none left behind.
