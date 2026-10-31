# dji-thermal-ui

Analyze, convert, mosaic and measure DJI thermal flights in the browser, on your own computer.

dji-thermal-ui is a local web app built on [dji-thermal-cli](https://github.com/WinuxNomacs/dji-thermal-cli). It
does the work with dji-thermal-cli and shows the results in the browser, so neither ODM nor the DJI Thermal SDK is
needed. It is the Thermal Analyzer that used to be a plugin of LuxODM, a WebODM fork, now standing on its own.

- **Projects:** a site's flights together, with a name, a description and a location, and a map of where each
  flight was flown. A flight can be moved to another project. The flights made before projects existed are in the
  Default Project, which you can rename; one is made again whenever none is left. A project's location is found by
  searching an address or a place on OpenStreetMap, or by clicking the site on the map, and keeps the address.
  A project's page lists its flights' findings together. A project is exported (backed up) as a `.tar` with all its
  flights or those chosen: their images (a folder flight's copied in), datasets, mosaics, measurements, findings and
  saved video frames.
  Import on the projects page makes such an archive a new project, here or on another computer: a name already in
  use gets a free one ("Roof (2)"), which you can change. Its folder flights come back as uploaded ones.
- **Flights:** DJI R-JPEGs, uploaded or used in place from a folder, with their thumbnails. The visual images a
  drone takes with them (DJI's `_V` or `_W`, as on the Matrice 4T or the H20T/H30T) can be added too: the Files tab
  calls them visual. So can the drone's MP4 videos. Other files, such as TIFFs (a converted dataset's temperatures
  among them), cannot make a flight and are left out.
- **Videos tab:** a flight's videos with their covers, length, start time and drone. The one chosen plays beside a
  map of its track, with a marker on the frame shown, and a click on the track goes to that moment. Under it, the
  frame's time and number, height above take-off, gimbal pitch and yaw, heading, speed and position. DJI's newer
  drones (the Matrice 4T among them) write no SRT: the track is read from the metadata DJI puts in the MP4, a point
  per frame, with nothing more installed, and the browser plays the video. A video's picture has the palette already
  applied, with a range that changes from frame to frame: it holds no temperatures.
  - **Playback:** a frame or a second back or on, ⅛× to 2×, and a loop between an in and an out point at any speed.
    Keys: Space plays and pauses, ← and → step a frame (with Shift, a second), I and O set the in and out points,
    L turns the loop on and off, − and + change the speed.
  - **Recoloured:** the frame shown turned back into the camera's levels (0 to 255) through DJI's Ironbow, then drawn
    in any palette, with a range (Auto takes the frame's 2nd to 98th percentile; the range stays put from frame to
    frame), brightness, contrast, gamma, sharpening and an isotherm in levels. It starts as filmed (DJI ironred, 0 to
    255). The pointer gives the level and pixel under it. Levels are relative: the camera re-ranges each frame, so a
    level is not the same heat from one frame to the next. The Ironbow table is the Matrice 4T's.
  - **Saved frames:** Save frame (or S) keeps the frame shown, as shown (recoloured or as filmed), with its time,
    the drone's position, height and gimbal, and how it was coloured. They are listed under the video: a click on
    one goes back to that frame as it was shown; each has a name, notes and a finding it can be attached to, and
    can be deleted. The flight report shows them, numbered V1, V2… on its map, and a finding's reports show those
    attached to it. A project's export carries them.
- **Analysis:** the files, cameras and problems dji-thermal-cli finds in a flight.
- **Files tab:** a flight's files, sorted by any column and filtered by conditions on any of them (Height ≤ 21,
  Min > 32 °F, Kind is one of Thermal…), every one of which a file shown matches: numbers in the unit shown,
  text by its words. The Kind column's checkboxes and the Thermal frame and With problems columns filter too. All
  files, Thermal frames and With problems set the filter they stand for, to change from there. The filter is kept in
  the page's link, and can be saved under a name as a favourite, offered on every flight's Files tab (a favourite is
  deleted, never overwritten).
- **Datasets:** a flight's images converted to temperatures with any of dji-thermal-cli's settings, and their
  mosaics. You can keep several side by side, cancel one, or download it. The R-JPEG output (`rjpeg`) writes each
  frame again as an R-JPEG with the dataset's measurement parameters in DJI's header, so DJI's own tools measure it
  as this app does; its picture, what photo viewers show, is coloured with the dataset's palette or kept as DJI's.
- **Exports:** a frame, the frames chosen or a whole flight as Original (the files as they are), TIFF
  (temperatures), PNG (coloured as the view, one pixel per sensor pixel) or R-JPEG, each also Private: without the
  location, the serial numbers and the free-text fields where a name or an email address could be. A mosaic exports
  as its GeoTIFF, a private one without its place, or a PNG of the view at full size. Several files come as a zip,
  made as it downloads. "Export…" opens the dialog: on the frame explorer for the frame shown (as converted, or with
  the parameters changed), on the Files tab for the frames the filter shows or all of them (measured with one of the
  flight's datasets or the frames' own values, with a palette and one range shared by all of them), and on the viewer
  for the mosaic tab shown. Each format says what it is for, and R-JPEG and Original are turned off, with the reason,
  for a normalized dataset or replaced values, which only TIFF carries. "Export PNG" still saves the view as shown.
  The API: `POST /api/datasets/<id>/exports` and `POST /api/conversions/<id>/mosaics/<tab>/exports`.
- **Mosaics:** the viewer's tabs are Mosaic (the temperatures as converted), Harmonized, Source frame (the mosaic
  with a line along each seam between the frames it is made of, in the mosaic report too) and View angle, over a
  street map or Esri's or Mapbox's satellite imagery. The viewer has palettes, a temperature range, brightness and contrast, gamma,
  equalization and sharpening, redrawn as their sliders are dragged; the colour scale, in the panel, is labelled with
  its range's ends. Pointer info gives the values under the cursor; a click keeps them and outlines the frame there,
  and Esc or a second click on that frame lets go of it.
- **Visual mosaic:** when a flight has visual images, a dataset builds their mosaic with the thermal ones (the
  convert form's "And the visual mosaic", on by default), at the visual camera's own resolution. dji-thermal-cli
  places each visual image where its thermal frame is in the thermal mosaic, after measuring and correcting the
  small angle between the two cameras, so the two mosaics line up. The viewer shows it on its Visual tab, Pointer info
  gives the Mosaic tab's temperatures, and a click opens the frames that saw the spot. It is in the downloads
  beside the thermal mosaics. Zoom camera images are left out.
- **Measurements:** spots, lines, areas, boxes and circles, ΔT, profiles, histograms and isotherms, on mosaics
  and on single frames. A frame page's Thermal/Visual/Both switch shows the frame's visual image in its place or
  beside it, with the same shapes and the cursor on it, and measures the thermal frame under them. They can be saved, compared, measured again with other settings, and exported as CSV and
  GeoJSON.
- **Source frames:** a spot or an area of a mosaic opens a window with every frame that saw it, the one the mosaic
  used first, each with its time and view angle and the spot marked or the area outlined in it, in the thermal frame
  or, with the Thermal/Visual switch, its visual image. Draw one with the
  Source frames tool, click the Source frame tab, or open a measurement's; on the compare page, draw a spot or an area
  in a pane. Mosaics
  built before 0.5.0 list only the frames they used: build them again to list every frame.
- **Findings:** a spot or an area of a mosaic kept on its flight, with a name, notes, a severity and a status, the
  temperatures measured when it was saved and the frames that saw it (all of them, or those you pick). Save one from
  the source frames window or from a saved spot or area measurement. The viewer draws them on the map, outlined and
  tagged in their severity's colour; click one, or its line in the Findings list, to open it with its frames. They
  can all be hidden with one switch, or one by one, and a link keeps which are shown and which is open. On the
  compare page each pane draws its flights' findings, opened with a click or a link and changed there, and a spot
  or an area drawn in a pane is saved on the flight of its mosaic (for a difference, the mosaic picked in the
  window).
- **Flight report:** a page laid out to print, or save as PDF from the browser's print dialog, on A4 or Letter.
  It holds the flight's figures, a map of where its frames were taken with its findings numbered, the coverage,
  the problems found, the frames' settings and temperatures summed up, the datasets, the findings with
  thumbnails of their kept frames, and the video frames saved (on the map too). A table of every frame can be appended. Open it with the flight page's Report
  button or from the navigation pane. The title, author, date and notes are typed on the page and saved with the
  flight; the last author typed fills in new reports. It always prints light, without the app's header and controls.
- **Mosaic report:** a dataset's mosaics as a report to print or save as PDF. It shows the mosaic as the viewer
  showed it when its Report button was pressed (that view is saved with the report), with the saved measurements
  and the flight's findings drawn and numbered, the colour scale, a scale bar and north. Each measurement follows
  with a close-up on its mosaic or frame, its figures, profile and histogram, and a comment; one can be left out.
  Then come the findings on the mosaic with their kept frames, and the dataset's settings and how the mosaic was
  made. A measurement's comment is also shown in the viewer's list and exported in the CSV and GeoJSON.
- **Compare:** two datasets side by side, one over the other, or their difference, from any flight, the
  project's listed first. A pane can show a dataset's visual mosaic. "Overlay (A over B)" draws pane A's mosaic
  over pane B's in one pane, faded with an opacity slider and cut at a swipe line dragged across it: visual over
  thermal, or two thermal mosaics.
- **Navigation:** a pane on the left of every page lists the projects and their flights, each with its report.
  Under each dataset come its Tools (Compare and Report), its Mosaics (each of the viewer's tabs) and its Frames:
  "Mosaic" (the frames the mosaic placed) and "Oblique" (those it left out for their angle, whose angles show what a
  view straight down misses, including those a conversion with a pitch limit did not convert), each with its count, opening the frame explorer on those frames. The
  page shown is marked, down to the viewer's tab. Each level folds, and the whole pane hides, by the header's menu button or the small tab
  on its edge; over a narrow screen it opens on top of the page. The box under Projects filters the projects by
  name, and stays as typed from page to page until it is emptied (Escape empties it). Every search in the app
  matches the same way, as you type: each word typed, in any order and any case ("roof north" finds "North roof").
  User Preferences and System Settings have a filter at the top too, showing the sections whose title, labels, help
  or choices have the words typed ("dark" finds Theme).
- **Frames explorer:** the frame page lists its frames (those of the pane's list, or all of them) beside the frame
  shown, in the order they were taken, as a list (name, time, and whether a frame is in the mosaic, oblique at its
  angle, left out as unusable or not converted) or as thumbnails, a switch the browser remembers. The first is shown
  on opening; a click or ← → shows another, with the frame page's palette, range, Pointer info, measuring and
  Thermal/Visual/Both.
- **User Preferences:** temperatures in °F, °C or K, light or dark pages (or the computer's own), both also in the
  header, the palette the map pages start with (each flight's images' own, or one chosen: the viewer, the frame
  explorer, the compare page and the mosaic report open with it, and can still switch; a small made-up roof beside
  it shows the palette chosen), the map every map starts with (ESRI Satellite, OpenStreetMap, Mapbox Satellite once
  it has a token, or none; each map can still switch, and a Mapbox that refuses its token goes back to ESRI
  Satellite), and the locale dates and
  times are written in (the computer's, or one chosen). A flight's capture times
  are shown in the time where it was flown, labelled with its time zone (e.g. UTC−5), found from the frames' two
  clocks (a flight analyzed by an earlier version of the app is analyzed again for it).
- **System Settings:** the Mapbox token (see [The maps under the mosaics](#the-maps-under-the-mosaics)), WebODM's
  address and login, with a short list of what connecting it brings (see [WebODM](#webodm)), and a link to Storage.
- **System Settings › Storage** (System Settings in the pane opens its page and folds or unfolds it; its chevron only folds): where the data
  folder is, its size on disk as measured when the page opens (and again on asking) and the free space on its
  drive, with each project and its flights, the database and the rest. A flight read in place from a folder says
  how much its images take there, outside the data folder's total. The data folder can be moved from there to
  another folder (see [Where the data lives](#where-the-data-lives)).

It runs on Linux, macOS and Windows. The server listens on 127.0.0.1 only, for the one person using the computer:
there are no logins or accounts.

## Install

dji-thermal-ui is not on PyPI yet. From a built wheel, it installs as a command with
`uv tool install dji_thermal_ui-<version>-py3-none-any.whl` (or `pipx install` with the same file). It needs
Python 3.12 or newer.

From a clone, for development: `uv sync` and `npm ci && npm run build` (the pages are built with Node.js), then
`uv run dji-thermal-ui`.

### From a clone, with the script

On Linux, WSL or macOS, `dji-thermal-ui.sh` at the top of the clone does those steps and runs the app in the
background:

| Command | |
|---|---|
| `./dji-thermal-ui.sh build` | set up the environment, or bring it up to date: `uv sync --locked`, `npm ci` and `npm run build`. It does not pull: the code checked out is used as it is. Without uv, it installs uv into `~/.local/bin` first (without changing the shell's startup files); without Node.js and npm, it stops and says where to get them. |
| `./dji-thermal-ui.sh rebuild` | the same as `build` |
| `./dji-thermal-ui.sh start` | start the app in the background, on http://127.0.0.1:8080, building it first if it was never built. Options after `start` go to the command: `--port`, `--data-dir`, `--no-browser`. |
| `./dji-thermal-ui.sh stop` | stop it (as Ctrl+C would) |
| `./dji-thermal-ui.sh restart` | stop, then start, with the options given |
| `./dji-thermal-ui.sh status` | whether it runs, and at which address (exit status 3 when it does not) |
| `./dji-thermal-ui.sh logs` | the end of its log; `logs -f` follows it |

Its PID file and log are in `.run/` in the clone (`DJI_THERMAL_UI_RUN_DIR` puts them elsewhere).

## Run

```
dji-thermal-ui
```

This serves the app on http://127.0.0.1:8080 and opens it in the browser. Press Ctrl+C to stop it. A job still
running when the server stops is marked as interrupted the next time it starts.

| Option | |
|---|---|
| `--data-dir DIR` | the folder for the database and the flights (see below) |
| `--port PORT` | the port to serve on (default 8080) |
| `--no-browser` | do not open the browser |
| `--version` | print the version |

The maps under the mosaics are loaded from the internet, and a project's location is searched for on OpenStreetMap's
[Nominatim](https://nominatim.org/) (the text searched, or the point clicked, is sent to it by the app, at most once a
second; the addresses are © OpenStreetMap contributors, under the ODbL). Everything else works offline.

## The maps under the mosaics

The switch at the top right of a mosaic's map chooses what is under it. Every map starts with the one chosen under
User Preferences › Map (ESRI Satellite unless another is chosen), and switching changes that map only:

- **ESRI Satellite** (the default) and **OpenStreetMap** need nothing set up. Where Esri's imagery stops short of the
  zoom shown, its deepest level there is stretched instead of showing "Map data not yet available".
- **Mapbox Satellite** needs a Mapbox account of your own and its access token, saved under System Settings, which
  says how to get one. The switch lists it once a token is known.

To get the token:

1. Sign up at [mapbox.com](https://account.mapbox.com/auth/signup/): no card is needed. The imagery comes through
   Mapbox's Static Tiles API, whose free allowance is 200,000 tiles a month; Mapbox charges past it only when a card
   is on the account.
2. On the [Access tokens](https://console.mapbox.com/account/access-tokens/) page, copy the **Default public token**
   (it starts with `pk.`), or create a token with the public scopes only. A secret token (`sk.`) is refused: the
   browser sends the token to Mapbox with each tile, so anyone using the page could read it. Mapbox's URL
   restrictions do not accept `127.0.0.1`, so leave the token unrestricted.
3. Paste it under System Settings › Mapbox Satellite and press Check and save. Mapbox's
   [Statistics](https://console.mapbox.com/account/statistics/) page shows how many tiles have been used.

The app first asks Mapbox for one tile with the token, and saves it only if Mapbox serves it; otherwise it says why
(a wrong token, the account's limit, or Mapbox out of reach), and nothing is changed. The token is kept as
`MAPBOX_API_TOKEN` in a `.env` file: the one in the folder the app is started from or in the data folder, whichever it
was read from (else the data folder's, made readable by you only). A new token replaces the old one in that file, the
file's other lines kept; no earlier token is kept, and a token can be replaced but not removed there. You can also
write `MAPBOX_API_TOKEN=pk....` in one of those files yourself. A `MAPBOX_API_TOKEN` in the environment the app is
started from wins over the files: System Settings then shows it, and it is changed there. A token saved by an earlier
version of the app (in its preferences) is moved to the data folder's `.env` when the app starts, unless a token is
already known.

## WebODM

Processing with ODM is done in a WebODM of your own, through its API: the app logs in to it as a WebODM account.
Under System Settings › WebODM, give its address (`http://` is fine, for a WebODM on this computer or your network),
the account's user name and its password, and press Check and save. The app logs in to WebODM first and saves them
only if WebODM takes them; it then lists the processing nodes the account can see. Otherwise it says why (a wrong
login, WebODM out of reach, an address that isn't WebODM's) and nothing is changed.

They are kept as `WEBODM_URL`, `WEBODM_USERNAME` and `WEBODM_PASSWORD` in a `.env` file, as the Mapbox token is (the
one they were read from, else the data folder's, made readable by you only), never in the database. The page never
shows the password, only that one is set, and shows the user name masked; leave either empty to keep the saved one.
Remove takes all three out of the file. Set in the environment the app is started from, they win over the files:
System Settings then shows them, and they are changed there. The app asks WebODM for a login token when it needs one
and keeps it in memory only.

The account is set up by a WebODM admin, in WebODM's Administration (its `/admin/` pages). System Settings › WebODM
walks through it with the names those pages show, linking to them once WebODM's address is saved:

1. **Users › Add user**: a user name and a password. Leave **Active** ticked, **Staff status** and **Superuser status**
   unticked: an ordinary account is enough.
2. **Its permissions.** A new account is in WebODM's **Default** group, which holds these unless they were taken away
   from it (Groups › Default); else add them to the account under **User permissions**:
   - `app | Project | Can add Project` (`app.add_project`): to create projects. The account owns those it creates,
     with every permission on them.
   - `app | Task | Can add Task`, `Can change Task` and `Can delete Task` (`app.add_task`, `app.change_task`,
     `app.delete_task`): to create, upload to, follow, cancel and remove tasks.
   - `app | Preset | Can add Preset`, `Can change Preset` and `Can delete Preset` (`app.add_preset`,
     `app.change_preset`, `app.delete_preset`): to keep task options as presets.
   - `nodeodm | Processing Node | Can view Processing Node` (`nodeodm.view_processingnode`).
3. **Each processing node** the account may use: Processing nodes › the node › **Object permissions**, type the user
   name in User identification, Manage user, choose **Can view Processing Node** and save (or the same for the
   Default group, under Groups). WebODM gives it to the Default group only for the node there when it first
   started: a node added later is not offered to the account until it, or its group, is given it.
4. **Only for a project the account didn't create:** Projects › the project › Object permissions: Can view Project to
   see it, Can change Project to add tasks to it and Can delete Project to remove its tasks. A project shared with
   the account is never deleted through the API.
5. Back in System Settings › WebODM, **Check and save**: the processing nodes the account sees are listed, and none
   means step 3 is missing.

### Processing a dataset in WebODM

Once a dataset is converted with temperature TIFFs (`temp_c:tiff`), **Process in WebODM** in its card's menu makes a
WebODM task from them:

- **The checks:** a dataset still converting, one whose frames had their location removed, or one without at least
  two temperature TIFFs can't be sent. Settings that differ from the WebODM plan's (normalization, the pitch limit,
  the emissivity or humidity) are said, and can still be sent.
- **The project:** a new WebODM project, named after the app's project unless you change it, or one of the
  account's, searched by name (one of the app's project's name is chosen when there is one). Nothing is remembered.
- **The options:** the WebODM plan's, the recommended ones ticked and those to consider not, with the plan's reason
  for each; **Add an option** offers any other the processing nodes offer, with an input for its type. A WebODM
  preset (the account's or WebODM's own) can be applied: its options are ticked with its values, the others left
  as they are. The ticked options can be kept as a preset of the account's own (the same name changes it). The
  preset last applied is offered first next time.
- **The processing node** (or WebODM's choice) and the task's name, "flight - dataset" unless changed.
- **Make a DSM:** asks WebODM for a surface model as well (`dsm`, and `fast-orthophoto` left out, as it makes none),
  for the mosaics to be projected onto (below). The task takes longer.

**Upload to WebODM** sends the TIFFs in the background, beside conversions, so a long upload holds nothing up: the
task is made waiting for its images, the TIFFs sent in batches, then the task committed and processed. An upload
can be canceled; one canceled, refused or cut short by the app stopping removes the half-made task from WebODM (and
the project, when it made it), at the next start if WebODM couldn't be reached.

The card lists the tasks made from the dataset, each with a link to it in WebODM and its progress: the upload's,
then WebODM's while it is queued or processing (asked at most every 5 seconds while the page shows it). A task can
be taken off the list; deleting the dataset does the same. Neither removes it from WebODM.

Once WebODM has completed a task, **Bring the orthophoto here** on its line downloads its orthophoto in the
background (with its progress, and a cancel). It is kept as temperatures, in the dataset's unit, and shown on the
dataset's viewer as a **WebODM** tab beside its mosaics (even without mosaics of its own): coloured, read under the
pointer, measured and saved as findings as they are, and offered on the compare page, beside the app's own mosaics
or as their difference. ODM blends the frames, so it doesn't say which frames a spot came from. The orthophoto has
to hold temperatures, which the WebODM plan's `radiometric-calibration none` keeps; one of colours is refused. A
dataset shows one orthophoto: another task's replaces it. The card says which task it came from and can remove it;
taking that task off the list removes it too. WebODM keeps its own copy either way.

A completed task that was asked for a DSM also has **Bring the DSM here** (one download per task at a time). The DSM
is kept as WebODM wrote it, once dji-thermal-cli has read it, and the card says it is there:

- **Project the mosaics onto it:** ticked when it arrives. The next time the mosaics are built, the frames are
  projected onto WebODM's surface instead of the heights dji-thermal-cli estimates from the frames themselves, so
  roofs and walls line up better at the seams. The mosaic's report says the heights came from the DSM.
- **The height cell:** the size of the cells the surface is read on, in mosaic pixels (8 to 1024; 16 at first),
  with its size on the ground once the mosaics are built (16 px was about 24 cm in a test flight, and gave straight
  roof edges where the default 64 px stepped).
- **Build the mosaics again** shows when the mosaics were built otherwise (without it, or on another cell).

A dataset keeps one DSM: another task's replaces it, keeping the tick and the cell. **Remove**, or taking its task
off the list, removes it; the mosaics built on it are kept.

The DSM is also shown on the viewer, on a **Heights** tab: the height of the ground, roofs and trees in metres above
the DSM's lowest ground (its 1st percentile, so a stray low pixel doesn't set it), with the palette (Viridis at first)
and range as the View angle tab has them. On every tab, Pointer info gives the **Ground height** under the cursor (its
tooltip, the height as WebODM gives it), and a spot measured on a temperature tab gets its ground height, an area its
lowest, mean and highest.

## Where the data lives

The database (SQLite), the secret key and each flight's files (`datasets/<id>/`) are kept in one data folder:

- Linux: `~/.local/share/dji-thermal-ui`
- Windows: `%LOCALAPPDATA%\dji-thermal-ui`

`--data-dir` or the `DJI_THERMAL_UI_DATA_DIR` environment variable uses another folder. System Settings › Storage
shows which folder is used and what takes room in it, and moves it to another:

- **Type the new folder's full path and check it.** It may be a new folder, an empty one, or another data folder of
  this app; a folder holding other files is refused, as is one without room (on another drive, the whole data folder
  is copied there, then removed here). Nothing moves while a job runs or a project is being imported.
- **Moving restarts the server.** The database cannot change under a running server, so the server stops, moves the
  files as they are (same ids and links; a flight read in place is still read there) before it opens the database
  again, and starts again on the same port; the page reloads when it is back and says how the move went.
- **Another data folder there** offers its projects, all chosen at first. Its database and files are set aside in
  `replaced-<date>/` in it, nothing deleted; the projects chosen are then imported from them as an export would bring
  them (new ids, and a name already used gets a number), their files moved out of the folder set aside. A folder
  set aside stays in the data folder, counted under Other, and moves with it.
- **The new folder is remembered** in a `data-dir` file in the app's config folder (`~/.config/dji-thermal-ui`,
  `%LOCALAPPDATA%\dji-thermal-ui`, or `DJI_THERMAL_UI_CONFIG_DIR`). `--data-dir` and `DJI_THERMAL_UI_DATA_DIR` still
  win, and a folder they set is not moved from the page. When the folder moved to is missing (a drive not
  connected), the app says so and stops rather than starting with an empty one.

A flight used in place
from a folder reads its images there and never changes them. Deleting a flight deletes only what the app made.
Deleting a project deletes its flights the same way, after saying how many there are and how much space is freed.
A project's export is written straight to the browser's download, so it needs no room in the data folder; it holds
`manifest.json` (the project's rows) and each flight's files under `datasets/<id>/`. An import is unpacked as it is
sent into `imports/` in the data folder, then moved into place: it needs about the archive's size free there (no
second copy of the archive is kept). An import a stopped server left half way is removed at the next start.

## Development

```
uv sync
uv run pytest            # DJI_THERMAL_FLIGHT_DIR=<a folder of one flight's R-JPEGs> runs the flight tests too
                         # (with its _V images beside them, the visual mosaic's too)
uv run ruff check
npm ci
npm test                 # the pages' tests (Vitest)
npm run -s lint          # ESLint and the TypeScript check
npm run build            # the pages, into src/dji_thermal_ui/static/dist (`-- --watch` while working on them)
```

Release checks, on the built distributions (after `npm run build`, which they carry):

```
uv build --no-sources
uv run --no-project python scripts/check_dist.py dist
uvx twine@7.0.0 check --strict dist/*
uv run --no-project python scripts/smoke.py uvx --from dist/dji_thermal_ui-<version>-py3-none-any.whl dji-thermal-ui
```

CI (`.github/workflows/ci.yml`) runs these and the tests on Linux and Windows on every push. It publishes nothing.

## Licence

AGPL-3.0-only (see [LICENSE](LICENSE)). Parts of the code come from WebODM and LuxODM (AGPL-3.0), whose files keep
their notices. The pages bundle Preact (MIT) and OpenLayers (BSD-2-Clause, with rbush, MIT, and quickselect,
ISC); their licences are in `THIRD-PARTY-LICENSES.txt` beside the built pages, in `dji_thermal_ui/static/dist/`.
Mapbox's wordmark, shown with its imagery, comes from Mapbox GL JS 1.13.3 (BSD-3-Clause), with its licence in
`dji_thermal_ui/static/vendor/mapbox/`.
