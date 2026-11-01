# Where the data lives

## The data folder

The database (SQLite), the secret key and each flight's files (`datasets/<id>/`) are kept in one data folder:

| System | Folder |
|---|---|
| Linux | `~/.local/share/dji-thermal-ui` |
| macOS | `~/Library/Application Support/dji-thermal-ui` |
| Windows | `%LOCALAPPDATA%\dji-thermal-ui` |

`--data-dir` or the `DJI_THERMAL_UI_DATA_DIR` environment variable uses another folder. Otherwise, a folder it was
moved to from the [Storage](../guide/storage.md) page is used. The Storage page shows which folder is used and what
takes room in it, and moves it to another.

## The config folder

A data folder moved to from the Storage page is remembered in a `data-dir` file in the app's config folder:

| System | Folder |
|---|---|
| Linux | `~/.config/dji-thermal-ui` |
| macOS | `~/Library/Application Support/dji-thermal-ui` |
| Windows | `%LOCALAPPDATA%\dji-thermal-ui` |

`DJI_THERMAL_UI_CONFIG_DIR` uses another folder.

## What deleting removes

A flight used in place from a folder (made by an earlier version) reads its images there and never changes them.
Deleting a flight deletes only what the app made. Deleting a project deletes its flights the same way, after saying
how many there are and how much space is freed.

## Exports and imports

A project's export is written straight to the browser's download, so it needs no room in the data folder. It holds
`manifest.json` (the project's rows) and each flight's files under `datasets/<id>/`.

An import is unpacked as it is sent into `imports/` in the data folder, then moved into place: it needs about the
archive's size free there (no second copy of the archive is kept). An import a stopped server left half way is
removed at the next start.
