# The command

```
dji-thermal-ui [--data-dir DIR] [--port PORT] [--no-browser]
```

It serves the app on http://127.0.0.1:PORT and opens it in the browser. Ctrl+C stops it.

| Option | |
|---|---|
| `--data-dir DIR` | the folder for the database and the flights (see [Where the data lives](data.md)) |
| `--port PORT` | the port to serve on (default 8080) |
| `--no-browser` | do not open the browser |
| `--version` | print the version |

## Environment variables

| Variable | |
|---|---|
| `DJI_THERMAL_UI_DATA_DIR` | the data folder, as `--data-dir` (which wins over it) |
| `DJI_THERMAL_UI_CONFIG_DIR` | the config folder, where a data folder moved from the Storage page is remembered |
| `MAPBOX_API_TOKEN` | the Mapbox token (see [The maps under the mosaics](../guide/maps.md#where-it-is-kept)) |
| `WEBODM_URL`, `WEBODM_USERNAME`, `WEBODM_PASSWORD` | WebODM's address and login (see [WebODM](../guide/webodm.md#where-the-login-is-kept)) |

The Mapbox token and WebODM's login are read from a `.env` file too, in the folder the app is started from or in the
data folder; those set in the environment win over the files.

## dji-thermal-ui.sh

In a clone of the repository, on Linux, WSL or macOS, `dji-thermal-ui.sh` builds the app and runs it in the
background:

| Command | |
|---|---|
| `./dji-thermal-ui.sh build` | set up the environment, or bring it up to date: `uv sync --locked`, `npm ci`, `npm run build` and the documentation's build (Zensical). It does not pull: the code checked out is used as it is. Without uv, it installs uv into `~/.local/bin` first (without changing the shell's startup files); without Node.js and npm, it stops and says where to get them. |
| `./dji-thermal-ui.sh rebuild` | the same as `build` |
| `./dji-thermal-ui.sh start` | start the app in the background, on http://127.0.0.1:8080, building it first if it was never built. Options after `start` go to the command: `--port`, `--data-dir`, `--no-browser`. |
| `./dji-thermal-ui.sh stop` | stop it (as Ctrl+C would) |
| `./dji-thermal-ui.sh restart` | stop, then start, with the options given |
| `./dji-thermal-ui.sh status` | whether it runs, and at which address (exit status 3 when it does not) |
| `./dji-thermal-ui.sh logs` | the end of its log; `logs -f` follows it |

Its PID file and log are in `.run/` in the clone (`DJI_THERMAL_UI_RUN_DIR` puts them elsewhere).
