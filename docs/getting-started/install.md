# Install

DJI Thermal Analyzer runs on Linux, macOS and Windows, and needs Python 3.12 or newer.

## From PyPI

The package holds everything, the pages and this documentation included, so installing it needs no Node.js:

```
uv tool install dji-thermal-ui
```

`pipx install dji-thermal-ui` works too. Either puts the `dji-thermal-ui` command on your path: see
[First run](first-run.md). `uv tool upgrade dji-thermal-ui` (or `pipx upgrade dji-thermal-ui`) installs a newer
release.

## From a clone

A clone of the repository builds the pages with Node.js (24 or newer, with npm) and this documentation with Zensical:

```
uv sync
npm ci && npm run build
uv run --only-group docs zensical build --strict
uv run dji-thermal-ui
```

### With the script

On Linux, WSL or macOS, `dji-thermal-ui.sh` at the top of the clone does those steps and runs the app in the
background:

```
./dji-thermal-ui.sh start
```

It builds the clone first if it was never built, then serves the app on http://127.0.0.1:8080. After pulling a newer
version, `./dji-thermal-ui.sh build` brings the environment, the pages and the documentation up to date, and
`./dji-thermal-ui.sh restart` runs it. Without uv, the script installs it into `~/.local/bin` first (without
changing the shell's startup files); without Node.js and npm, it stops and says where to get them. Its other commands
are in [The command](../reference/command.md#dji-thermal-uish).
