"""Check built distributions hold only what should ship: python scripts/check_dist.py dist/

Every file in the wheel and sdist must match an allowlist, so nothing local (editor or assistant settings, test data,
the Jest tests, node_modules, build leftovers) can be published by accident. Also checks both carry the templates, the
migrations, the scripts and the vendored libraries with their licences.
"""

from __future__ import annotations

import re
import sys
import tarfile
import zipfile
from pathlib import Path

PY = r"dji_thermal_ui/(?:[a-z_0-9]+/)*[a-z_0-9]+\.py"
TEMPLATES = r"dji_thermal_ui/templates/[a-z_]+\.html"
STATIC = r"dji_thermal_ui/static/[a-z_]+\.(?:js|css)"
VENDOR = (r"dji_thermal_ui/static/vendor/(?:"
          r"bootstrap/(?:LICENSE|css/bootstrap\.min\.css)"
          r"|fontawesome/(?:LICENSE\.txt|css/all\.min\.css|webfonts/fa-(?:regular-400|solid-900)\.woff2)"
          r"|leaflet/(?:LICENSE|leaflet\.(?:js|css)|images/[a-z0-9-]+\.png))")
PACKAGE = rf"{PY}|{TEMPLATES}|{STATIC}|{VENDOR}"
VENDOR_LICENSES = r"src/dji_thermal_ui/static/vendor/(?:bootstrap/LICENSE|fontawesome/LICENSE\.txt|leaflet/LICENSE)"
LICENSES = rf"LICENSE|{VENDOR_LICENSES}"
WHEEL = re.compile(rf"(?:{PACKAGE})|dji_thermal_ui-[^/]+\.dist-info/(?:METADATA|WHEEL|RECORD|entry_points\.txt"
                   rf"|licenses/(?:{LICENSES}))")
# uv_build keeps the original pyproject.toml as pyproject.toml.orig next to its normalized copy
SDIST = re.compile(rf"(?:src/(?:{PACKAGE})|{LICENSES}|README\.md|pyproject\.toml(?:\.orig)?|PKG-INFO)")
REQUIRED = [
    "dji_thermal_ui/__init__.py",
    "dji_thermal_ui/cli.py",
    "dji_thermal_ui/analyzer/migrations/0001_initial.py",
    "dji_thermal_ui/templates/base.html",
    "dji_thermal_ui/templates/datasets.html",
    "dji_thermal_ui/static/analyzer_core.js",
    "dji_thermal_ui/static/viewer.js",
    "dji_thermal_ui/static/vendor/bootstrap/css/bootstrap.min.css",
    "dji_thermal_ui/static/vendor/fontawesome/css/all.min.css",
    "dji_thermal_ui/static/vendor/leaflet/leaflet.js",
]
LICENCE_FILES = {
    "LICENSE",
    "src/dji_thermal_ui/static/vendor/bootstrap/LICENSE",
    "src/dji_thermal_ui/static/vendor/fontawesome/LICENSE.txt",
    "src/dji_thermal_ui/static/vendor/leaflet/LICENSE",
}


def wheel_problems(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
    problems = [f"unexpected file: {n}" for n in names if not WHEEL.fullmatch(n)]
    problems += [f"missing: {r}" for r in REQUIRED if r not in names]
    licences = {n.split("/licenses/", 1)[1] for n in names if "/licenses/" in n}
    problems += [f"missing licence: {lic}" for lic in sorted(LICENCE_FILES - licences)]
    return problems


def sdist_problems(path: Path) -> list[str]:
    with tarfile.open(path) as t:
        members = t.getmembers()
    root = members[0].name.split("/", 1)[0]
    names = [m.name.removeprefix(root + "/") for m in members if m.isfile()]
    problems = [f"not a regular file or directory: {m.name}" for m in members if not (m.isfile() or m.isdir())]
    problems += [f"unexpected file: {n}" for n in names if not SDIST.fullmatch(n)]
    problems += [f"missing: src/{r}" for r in REQUIRED if f"src/{r}" not in names]
    problems += [f"missing licence: {lic}" for lic in sorted(LICENCE_FILES - set(names))]
    return problems


def main(argv: list[str]) -> int:
    dist = Path(argv[1] if len(argv) > 1 else "dist")
    wheels, sdists = sorted(dist.glob("*.whl")), sorted(dist.glob("*.tar.gz"))
    if len(wheels) != 1 or len(sdists) != 1:
        print(f"expected one wheel and one sdist in {dist}, found {len(wheels)} and {len(sdists)}")
        return 1
    failed = False
    for path, check in ((wheels[0], wheel_problems), (sdists[0], sdist_problems)):
        problems = check(path)
        print(f"{path.name}: {'ok' if not problems else f'{len(problems)} problem(s)'}")
        for p in problems:
            print(f"  {p}")
        failed |= bool(problems)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
