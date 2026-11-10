# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[PEP 440](https://peps.python.org/pep-0440/).

## [Unreleased]

### Added

- **Import from WebODM**, beside the New dataset form's **Convert**: an orthophoto made in WebODM becomes a dataset of
  the flight, with its DSM if wanted. The dialog browses the WebODM account's projects and their completed tasks as
  cards with a preview of each orthophoto (WebODM's own for colours, coloured here from its tiles for temperatures),
  those over the flight first; or it takes a GeoTIFF downloaded from WebODM's page. An orthophoto of temperatures is
  the viewer's WebODM tab, one of colours a visual mosaic, the DSM the Heights tab, beside either. The viewer, the
  compare page and the mosaic report take it as any dataset's mosaic; its card and the viewer link to the task in
  WebODM (**Open in WebODM**), and its report and the viewer's panel say where it came from: the project and task, when
  it was made, from how many images and how long WebODM took.
- The frames that saw a spot or an area of WebODM's orthophoto, which ODM doesn't record: found from the task's
  cameras (its `shots.geojson` and `cameras.json`, at the DSM's height), the most nadir first, in the Source frames
  window (a click on an imported dataset's WebODM or Visual tab opens it) and kept by a finding, on an imported dataset and on the WebODM tab of a dataset without mosaics of its own.
  An import from a task brings them along, **From a file** takes them as two optional files, and an orthophoto
  imported or brought back before fetches them the first time. A thermal frame is measured with the settings of the
  dataset its task was sent from.
- Flights of visual images only (no thermal ones): each dataset is the mosaic of the visual images, laid out by their
  own overlaps with dji-thermal-cli 1.13.0, made with **Make mosaic** from the New dataset form, which shows only its
  settings (the pitch limit, the pixel size, the height cells and removing the location). The viewer shows it on its
  Visual tab alone, with no temperatures: a click or a shape drawn opens the visual frames that saw it, and the panel
  says how it was laid out. The flight report puts such a flight's photos on its map.
- On such a dataset's mosaic, a line drawn in the viewer gives its length, and an area, box or circle its area and
  perimeter, with **Save measurement** (exported as CSV and GeoJSON, with a new Perimeter column) and **Keep as
  finding** (which keeps the area and the visual photos that saw it). The compare page shows it beside or over any
  mosaic, its frames page shows the flight's photos as taken with ← and →, and the viewer offers its **Mosaic
  report**.

- The navigation pane lists **Frames** under each dataset with frames, opening its frames explorer (marked there):
  datasets fold now, as projects and flights do.
- A cross of buttons under the colour range, in the viewer's panel, the frame page's and the Video tab's, with
  **Auto** at its centre (moved from beside the range's fields) and an arrow each way, named beside it: ◀ **Narrow**
  and ▶ **Widen** take 10% off the span or add 10%, half at each end, and ▼ **Lower** and ▲ **Raise** move both ends
  by 10% of the span. Neither end goes past the image's own lowest and highest values; an end that reaches one stays
  there while the other moves on.
- System Settings › WebODM: **Create the account for me** creates the account the app logs in as, with a WebODM
  admin's login used for that one request and never saved. The new account (`dji-thermal-ui-api-user` unless
  renamed) is an ordinary one in WebODM's Default group, its password typed or made by **Generate**; the app logs in
  as it, lists its processing nodes and saves it to `.env` as Check and save does. A name WebODM already has is
  refused, and an existing WebODM account is never changed.
- Help in the header: the documentation, opened in a new tab at the guide's page for the page shown. The app serves
  it at `/help/` from the copy it was installed with (built from `docs/` by Zensical 0.0.73, and carried by the
  wheel), so it matches the version and works offline. `scripts/publish_docs.py` commits the same site in a clone of
  the public `dji-thermal-ui-docs` repository for GitHub Pages. It has Getting started, a user guide with a page for
  each part of the app, Quickstart tutorials from a first flight to its report and exports, and Reference (the
  command, its environment variables, and where the data lives). Its screenshots are made by
  `npm run screenshots` (Playwright 1.64.1) on an instance of their own.
- System Settings › WebODM: WebODM's address and an account's login, saved to `.env` (`WEBODM_URL`,
  `WEBODM_USERNAME`, `WEBODM_PASSWORD`) once WebODM has taken them, with the processing nodes the account sees. The
  password is written encrypted (Fernet, from `cryptography` 50.0.2), its key kept in the database, so `.env` alone
  doesn't give it away; one already in a `.env` file as typed is encrypted when the app starts, and one the key can't
  open is asked for again. The password is never shown, the user name masked; the saved login can be checked again
  or removed. Setting the account up in WebODM's admin is walked through there step by step (and in the README),
  with the permissions as its pages name them and links to those pages. It opens with what connecting WebODM brings:
  tasks made straight from a converted dataset, its options and presets, the progress followed on the card, the
  orthophoto brought back.
- Process in WebODM, on a converted dataset's card: a WebODM task from its temperature TIFFs, in a new project or
  one of the account's, with the WebODM plan's options and any other the nodes offer, WebODM's presets applied or
  the options kept as one, a processing node and a name. The upload runs in the background on a worker of its own
  and can be canceled; one that doesn't finish removes its half-made task from WebODM. The card lists the tasks
  made, with links into WebODM, followed while they are queued or processing.
- A completed WebODM task's orthophoto brought back from its line on the card, in the background: kept as
  temperatures in the dataset's unit and shown as a WebODM tab on the viewer, measured, made a finding on and
  compared as the app's own mosaics are. A dataset shows one; another task's replaces it, and the card removes it.
- WebODM's DSM under the mosaics: **Make a DSM** on the task panel (sends `dsm`, leaves `fast-orthophoto` out); a
  completed task that asked for one brings it back from its line, kept as WebODM wrote it; the card projects the
  mosaics onto it (on by default) with a height cell in mosaic pixels (16 at first, about 24 cm in a test), and
  offers to build them again when they were built otherwise. A backup keeps it, without its task.
- WebODM's DSM on the viewer: a Heights tab (heights in metres above the DSM's lowest ground, coloured with the
  palette and range), the ground's height under the cursor on every tab (as WebODM gives it in its tooltip), and a
  spot's ground height or an area's lowest, mean and highest in a measurement on a temperature tab.
- Videos in a flight: DJI's MP4s uploaded with the images or found in a folder flight, listed by the analysis (the
  Files tab calls them Video, with their cover as thumbnail) and on a Videos tab: each with its cover, length, start
  time and drone, played beside a map of its track (read from DJI's metadata in the MP4, a point per frame), a marker
  following the frame shown and a click on the track seeking to that moment, with the frame's height, gimbal angles,
  heading, speed and position. A project's export carries them.
- A video analysed in the browser: stepped a frame or a second at a time, played at ⅛× to 2×, looped between an in
  and an out point, from buttons or keys; and recoloured: the frame shown turned back into the camera's levels
  through DJI's Ironbow (the Matrice 4T's) and drawn with the viewer's palette, range and Auto, brightness, contrast,
  gamma, sharpening and an isotherm in levels, with the level under the pointer. Relative, never temperatures.
- A video's frame saved from the Videos tab (Save frame, or S): as shown and as filmed, with its time, the track's
  point (position, height, gimbal) and its look; listed under the video to go back to as it was shown, named,
  described, attached to a finding and deleted. The flight report has a Video frames section, numbered V1, V2… on
  its map; a finding shows the frames attached to it in the flight's and the mosaic's reports. A project's export
  carries them (its format is now version 2: an older app refuses it; it still imports version 1).
- The Files tab shows a visual photo's time, position, heights, gimbal pitch and yaw and rangefinder distance, read
  from its metadata by dji-thermal-cli 1.11 (a flight gets them on its next Analyze). The flight report can put the
  visual photos on its map (saved with the report), and so can the frame page's map of where the frames are.
- Hover for detail on the Files tab (on by default, remembered by the browser): a pane at the right with a file's
  picture, up to 1280 px (a video's cover), and its columns, following the thumbnail or name the pointer is over.
  A clicked row stays in the pane until it is clicked again, closed or Escape is pressed; with the box unchecked,
  only a clicked row opens it.
- Full size in the Files tab's pane: the picture at its own size over the page (4032 × 3024 for an M4T's visual
  photo), fitting the window at first, zoomed with the wheel or shown 1:1, dragged to move it; Escape or × closes it.
- The Files tab's thermal pictures (thumbnails, the pane and full size) are coloured with the preferred palette
  (User Preferences) over each frame's own range, instead of the camera's colours; "As each flight's images", or a
  DJI palette a frame doesn't hold, keeps the camera's pictures.

### Changed

- The viewer's side panel and the frame page's have no Values and Kept headings, so they take less room; the line
  under the Image sliders reads "Adjustments change how the image is drawn: temperatures remain unchanged."
- The guide, the README and the documentation's home page say the mosaics are a preview to help the analysis, not a
  replacement for an orthomosaic made by photogrammetry (ODM's or WebODM's).
- dji-thermal-cli 1.13.1 (from 1.11.0): mosaics are faster, the frames' overlaps matched in worker processes (the
  thermal test flight's mosaic in 35 s instead of 96 s on 8 workers), and unchanged to the pixel.
  With 1.13.1, a flight of visual images only gets no WebODM plan, and no "only 0 nadir frame(s)" error on its
  Problems tab.
- The line giving the mosaic's (or frame's) own lowest and highest values is straight under the colour scale, above
  the range's fields.
- The viewer's and the frame page's **Export PNG** button is now the Export dialog's first format, **PNG as shown**,
  making the same picture (title, date, saved measurements, colour scale).
- **Build the mosaics again** is **Rebuild mosaics** (the viewer and the WebODM heights panel), and **Open this
  frame** is **Open frame** (Pointer info and the source frames window). Pointer info shows it only once a click
  keeps the point, not while the cursor passes over a frame.
- The app is called DJI Thermal Analyzer: in the header, the page titles, the documentation and the README. The
  command and the package are still `dji-thermal-ui`.
- A banner heads the README and the documentation's home page.
- CI has a macOS job (the tests, and the built wheel serving its pages), off until the repository variable
  `MACOS_CI` is set to `true`.
- The README keeps what the app is, how to install it and how to run it: the rest, its feature list included, is
  in the documentation.
- The image sliders (Brightness, Contrast, Gamma and Sharpening, on the viewer, the frame page, the video tab and
  the compare page) move in steps half as big as before, for finer adjustments.
- The flight page's Files tab: the Thermal frame column goes (Kind says it; a link or saved filter on it is read
  as Kind), and With problems and Notes become one Problems column naming each problem (Unusual max, Oblique…),
  its sentence the tooltip, every row one height.
- A project's Flights table: a flight's Rename, Analyze again, Move to another project and Delete are named in its
  row's "…" menu, and its name stays on one line; the Projects table counts 0 datasets and findings. A dataset
  card's menu shows its links (Frames, Compare with…, Download all) as its other items.
- Compare's Link the panes, Shared palette and Findings keep one label each, pressed in with a check while on; the
  maps' basemap list follows the dark theme.
- The reports say their text saves as it is typed (Saving…, Saved), and say why they can't be printed yet beside
  that rather than in its place.
- The navigation pane (U7) lists projects, flights and datasets, and stops there: the Tools, Mosaics and Frames under
  a dataset, the viewer's tabs and the Flight report's row are gone, the pages' own tabs and buttons reaching them. A
  dataset is marked on any of its pages, a flight on its Flight report, and what the pane unfolds to show the page
  shown stays unfolded. Storage is a row of its own beside User Preferences and System Settings (which no longer
  folds), and its page has their width.
- The frames explorer switches between all the frames, those In the mosaic and the Oblique ones, each with its
  count, once the mosaics are built (the pane offered those lists before). A link to a list with no frames opens on
  all of them.
- Names (U6): the two reports are called Flight report (the flight page, the navigation pane) and Mosaic report (the
  viewer, the navigation pane), their pages titled "<name> · Flight report" and "<name> · Mosaic report". A dataset
  converted with no name typed is named after the settings that change its temperatures or mosaics ("Emissivity
  0.9 · normalized", else "Default settings", with " (2)" after a name the flight has), shown as the Datasets tab's
  name placeholder; existing datasets keep their names.

- Measuring (U5): the mosaics viewer's two sets of drawing tools (Source frames, Measure) are one, on the map's top
  edge; a shape drawn on a temperature mosaic is measured in a card on the map, with Keep as finding (the form at
  once, the frames that saw it beside it), Save measurement and Source frames, closed with × or Esc. The Source frame
  and Visual tabs still open the frames that saw a shape. The side panel is grouped under View, Values, Kept and
  About, with Image, Parameters, This mosaic and The mosaic folded on a first visit. The frames explorer gets the same
  tools, card and headings; the compare page's Spot and Area move onto each pane's map.
- The mosaics viewer (U4) opens on Harmonized when the frames disagree (their offsets against their neighbours
  spanning more than 3 °C over the middle 90% of them), with a notice saying why that can be closed; otherwise on
  Mosaic, as before. A link that names a tab still opens that one. Each tab has a tooltip saying what it shows.
- The Problems tab (U3) says each problem in the New dataset form's words rather than dji-thermal-cli's flags,
  with its temperatures in the preferred unit, its files listed once with their values and the code in a tooltip.
  A problem a setting fixes has a button that opens the New dataset form with it set: "Normalize the frames to
  each other", "Use one emissivity", "Use the embedded distance", "Use one distance", and "Include them" for
  oblique frames when too few nadir frames are left. The flight report shows the same text, without the buttons.
- The flight page leads from the analysis to a dataset (U2): the Convert tab is now **Datasets**, listing the
  flight's datasets first and then a New dataset bar with the settings summary and the Convert button, the settings
  folded under Change settings. The page opens on it once the flight has a dataset. After the analysis, a flight
  without one shows "Next: make a dataset". The outputs are named for what they are for, with dji-thermal-cli's name
  beside them. While the analysis runs, the page shows how far it has got, with no tabs, and the button says
  "Cancel the analysis". Links to `#convert` still open the tab.
- dji-thermal-cli 1.11.0 (was 1.9.1): it describes a drone's visual photos, which the Files tab, its detail pane and
  the maps' visual layers show; 1.10.0's fix for a crash in DJI's library on Windows comes with it.
- CI runs only on a `v*` tag or by hand (Actions › CI › Run workflow), no longer on every push or pull request.
- The map pages colour a frame drawn without a map (the source frames, the palette previews) several times faster.
- The `.env` values (the Mapbox token, WebODM's login) are read and written by one module; the setting
  `MAPBOX_ENV_FILES` is now `ENV_FILES`.
- dji-thermal-cli 1.9.1 (was 1.8.0). It reads a DSM, ODM's `dsm.tif` included, with nothing more installed, ahead of
  WebODM's DSM under the mosaics. 1.9.0's option to use DJI's own Thermal SDK comes with it, unused here.

### Removed

- The New thermal flight dialog's "A folder on this computer" (images read in place from a typed path): images and
  folders are chosen and uploaded. Flights already read in place keep working, and the API still takes them.

### Fixed
- **OpenStreetMap** follows its tile usage policy: the pages let the browser send the Referer the tile server requires
  (the app's address alone), and the credit reads "© OpenStreetMap contributors" and stays open while that map is shown.
- **Rebuild mosaics** builds the new mosaics beside the last ones and swaps them in when they are finished: the viewer
  goes on showing the last ones meanwhile, and a rebuild that fails or is canceled keeps them, saying why it failed.
- The project's **Export** dialog names a flight whose images can't be found (a drive not connected), instead of
  exporting it silently without them.
- A line under the header says when the app has stopped answering, after a write that couldn't reach it or a job being
  followed, and goes away once it answers again. Following a job goes on after that, instead of stopping for good.
- An upload, a video frame saved or a project imported onto a full disk says the disk is full, instead of a server error.
- The measurements CSV opens correctly in Excel (it starts with a byte order mark; a script reads it as `utf-8-sig`).
- The Storage page says, while a move takes long, where to look if the page never comes back. The Flights list says why
  when it can't be loaded.

- A failed request whose answer gave no reason (a page that isn't JSON) showed only "could not be done": it now says
  when the app doesn't know the request, as a server started before an update answers a page made after it (restart
  it), or when the app ran into an error (its log says more).
- On Windows, WebODM's orthophoto and DSM were saved with `\` in their paths: they now use `/`, as the mosaics do,
  so a data folder reads the same on any system.
- On Windows, a mosaic's colours no longer fail when two requests draw them at once (its kept histogram is written
  again next time instead).
- Importing a project, a file whose name this computer can't keep (on Windows, a name with a colon; on Windows and
  macOS, two names that differ only in case) is said so, instead of failing with a server error or one file
  replacing the other.
- The flight report's map showed its zoom buttons, scale, attribution and basemap switch unstyled, piled up in its
  corner: the page now loads OpenLayers' styles. Printing was not affected.
- On Windows, the tabs of the viewer and of a flight's page (Mosaic, Harmonized…; Datasets, Files…) showed a small
  vertical scrollbar at their right end: their line is drawn inside the strip now, so nothing scrolls.
- Moving the data folder to another drive: an original that could not be removed stopped the app on a half-removed
  folder. The move now counts, the Storage page says what was left behind, and a new folder that can't be remembered
  undoes the move. A transfer with WebODM now stops a move, as a job does.
- A database error while importing the projects of a folder set aside no longer stops the app from starting.
- WebODM: an error page from WebODM itself is no longer called another server's answer, and an address that doesn't
  speak HTTP is said to be unreachable, instead of a server error.
- Downloads named with letters beyond ASCII (a project's archive, an export, measurements) keep their name.
- An orthophoto imported from WebODM in Fahrenheit or Kelvin: its equalization and PNG export no longer read it as
  Celsius.
- The viewer after **Rebuild** shows the new mosaic and its range, without reloading the page.
- A saved measurement chosen on the viewer's Visual tab now goes to its mosaic's tab and shows its card.
- The frame page: a measurement answered after moving to the next frame no longer appears on that frame.
- The project import dialog no longer sticks when the app stops answering: it says so and can be used again.

## [0.9.0] - 2026-10-29

### Added

- Exports on the server: a flight's frames as Original, TIFF, PNG or R-JPEG, each also Private (no location, serial
  numbers or free-text fields), and a dataset's mosaics as GeoTIFF, a private GeoTIFF without its place, or a
  full-size PNG. The PNGs and the R-JPEGs' pictures are coloured exactly as the browser colours the view. Several
  files come as a zip made as it downloads; a frame that can't be made is listed in `export-notes.txt`.
- The R-JPEG output on the Convert tab, with its picture: the palette's colours or DJI's own.
- The export dialog ("Export…"): on the frame explorer (this frame, as converted or with the parameters changed), on
  the Files tab (the frames the filter shows, or all of them, measured with a dataset or the frames' own values) and
  on the viewer (the mosaic tab shown). Each format says what it is for; R-JPEG and Original are turned off, with the
  reason, where only TIFF can carry the temperatures.
- A filter under Projects in the navigation pane: the projects whose name has every word typed. It is kept from page
  to page, as the folds are; Escape empties it, as it does every search box.
- A filter at the top of User Preferences and System Settings: the sections whose title, labels, help or choices
  have every word typed.
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

- The Mapbox token moves to a System Settings page of its own (System Settings in the navigation pane is now a link
  to it, which also folds or unfolds it to Storage). The basemap switch no longer offers to add or change it. A new token is
  checked with Mapbox (one tile asked for) before it is saved, and the reason is shown when Mapbox refuses it. It is
  kept as `MAPBOX_API_TOKEN` in a `.env` file, in place of the one there (the file it was read from, else the data
  folder's), and is no longer kept in the preferences: a token saved there by an earlier version is moved to the
  data folder's `.env` when the app starts. A token in the environment is shown, and is changed there.
- A thermal image of a format that cannot be read is called an "Unsupported image type" (it was "Unsupported
  camera"), on the Files tab and in its filter.
- dji-thermal-cli 1.8.0 (was 1.6.0). A FLIR radiometric JPEG (a Zenmuse XT2's) is an "Unsupported image type", no
  longer "Not thermal". A conversion with "strip location" now also removes the free-text fields where a name or an
  email address could be: EXIF Artist, Copyright, ImageDescription, UserComment and the XP fields, their XMP
  counterparts, and the sensor serial in DJI's debug block.

### Fixed

- The Convert tab's settings, once opened with Edit settings, fold away again: the button stays, as Hide settings,
  and the values chosen are kept.

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
