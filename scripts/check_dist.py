"""Check built distributions hold only what should ship: python scripts/check_dist.py dist/

Every file in the wheel and sdist must match an allowlist, so nothing local (editor or assistant settings, test data,
the front end's sources and tests, node_modules, build leftovers) can be published by accident. Also checks both carry
the templates, the migrations, the built front end (npm run build): each page's entry and files, and the licences of
what is bundled into it, and the built documentation (zensical build).
"""

from __future__ import annotations

import json
import re
import sys
import tarfile
import zipfile
from pathlib import Path

PY = r"dji_thermal_ui/(?:[a-z_0-9]+/)*[a-z_0-9]+\.py"
TEMPLATES = r"dji_thermal_ui/templates/[a-z_]+\.html"
STATIC = (r"dji_thermal_ui/static/(?:favicon\.svg|vendor/mapbox/(?:mapbox-logo\.svg|LICENSE\.txt)"
          r"|dist/(?:manifest\.json|THIRD-PARTY-LICENSES\.txt|assets/[A-Za-z0-9_.-]+\.(?:js|css|png|svg|woff2))"
          r"|docs/(?:[a-z0-9_-]+/)*(?:[A-Za-z0-9_.-]+\.(?:html|js|css|json|xml|png|jpg|svg)|LICENSE))")
PACKAGE = rf"{PY}|{TEMPLATES}|{STATIC}"
LICENSES = r"LICENSE"
WHEEL = re.compile(rf"(?:{PACKAGE})|dji_thermal_ui-[^/]+\.dist-info/(?:METADATA|WHEEL|RECORD|entry_points\.txt"
                   rf"|licenses/(?:{LICENSES}))")
# uv_build keeps the original pyproject.toml as pyproject.toml.orig next to its normalized copy
SDIST = re.compile(rf"(?:src/(?:{PACKAGE})|{LICENSES}|README\.md|pyproject\.toml(?:\.orig)?|PKG-INFO)")
REQUIRED = [
    "dji_thermal_ui/__init__.py",
    "dji_thermal_ui/cli.py",
    "dji_thermal_ui/analyzer/migrations/0001_initial.py",
    "dji_thermal_ui/templates/page.html",
    "dji_thermal_ui/templates/projects.html",
    "dji_thermal_ui/static/favicon.svg",
    "dji_thermal_ui/static/dist/manifest.json",
    "dji_thermal_ui/static/dist/THIRD-PARTY-LICENSES.txt",        # the licences of what is bundled, beside it
    "dji_thermal_ui/static/vendor/mapbox/mapbox-logo.svg",       # Mapbox's wordmark, with its licence
    "dji_thermal_ui/static/vendor/mapbox/LICENSE.txt",
    "dji_thermal_ui/static/docs/index.html",                     # the documentation, served at /help/
    "dji_thermal_ui/static/docs/guide/projects/index.html",
    "dji_thermal_ui/static/docs/search.json",
]
# The pages' entries in the build's manifest (frontend/src/pages), each with its files in the distribution
PAGES = ["projects", "project", "dataset", "viewer", "frame", "compare", "preferences"]
MANIFEST = "dji_thermal_ui/static/dist/manifest.json"
LICENCE_FILES = {"LICENSE"}


def build_problems(names: list[str], manifest: bytes | None, prefix: str = "") -> list[str]:
    """What the build's manifest lacks: an entry for each page, and the files they load"""
    if manifest is None:
        return []           # reported as missing already
    chunks = json.loads(manifest)
    problems = []
    for page in PAGES:
        chunk = chunks.get(f"src/pages/{page}.tsx")
        if not chunk or not chunk.get("isEntry"):
            problems.append(f"no entry for the {page} page in the manifest")
            continue
        for f in [chunk["file"], *chunk.get("css", [])]:
            if f"{prefix}dji_thermal_ui/static/dist/{f}" not in names:
                problems.append(f"missing: the {page} page's {f}")
    return problems


def wheel_problems(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        manifest = z.read(MANIFEST) if MANIFEST in names else None
    problems = [f"unexpected file: {n}" for n in names if not WHEEL.fullmatch(n)]
    problems += [f"missing: {r}" for r in REQUIRED if r not in names]
    licences = {n.split("/licenses/", 1)[1] for n in names if "/licenses/" in n}
    problems += [f"missing licence: {lic}" for lic in sorted(LICENCE_FILES - licences)]
    return problems + build_problems(names, manifest)


def sdist_problems(path: Path) -> list[str]:
    with tarfile.open(path) as t:
        members = t.getmembers()
        root = members[0].name.split("/", 1)[0]
        names = [m.name.removeprefix(root + "/") for m in members if m.isfile()]
        manifest = t.extractfile(f"{root}/src/{MANIFEST}").read() if f"src/{MANIFEST}" in names else None
    problems = [f"not a regular file or directory: {m.name}" for m in members if not (m.isfile() or m.isdir())]
    problems += [f"unexpected file: {n}" for n in names if not SDIST.fullmatch(n)]
    problems += [f"missing: src/{r}" for r in REQUIRED if f"src/{r}" not in names]
    problems += [f"missing licence: {lic}" for lic in sorted(LICENCE_FILES - set(names))]
    return problems + build_problems(names, manifest, "src/")


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
