"""{% vite_entry "name" %}: the tags that load a page's script built by Vite (frontend/src/pages/<name>.tsx), read
from the build's manifest: its stylesheets, its module script and the chunks it imports, preloaded."""

import json
from functools import lru_cache
from pathlib import Path

from django import template
from django.conf import settings
from django.templatetags.static import static
from django.utils.html import format_html, format_html_join
from django.utils.safestring import mark_safe

register = template.Library()


class ManifestError(Exception):
    pass


@lru_cache(maxsize=4)
def _read(path: str, mtime: float) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def manifest() -> dict:
    """The build's manifest, read again when it changes (a build while the server runs)"""
    path = Path(settings.VITE_MANIFEST)
    try:
        return _read(str(path), path.stat().st_mtime)
    except FileNotFoundError:
        raise ManifestError("%s is missing: build the front end with `npm ci && npm run build`" % path) from None


def _url(file: str) -> str:
    return static("dist/" + file)


@register.simple_tag
def vite_entry(name: str):
    chunks = manifest()
    key = "src/pages/%s.tsx" % name
    if key not in chunks:
        raise ManifestError("%s is not in the front end's build" % key)
    css, preload, seen = [], [], set()

    def walk(k, entry):
        if k in seen:
            return
        seen.add(k)
        chunk = chunks[k]
        css.extend(f for f in chunk.get("css", []) if f not in css)
        if not entry:
            preload.append(chunk["file"])
        for i in chunk.get("imports", []):
            walk(i, False)

    walk(key, True)
    return mark_safe(
        format_html_join("", '<link rel="stylesheet" href="{}">\n', ((_url(f),) for f in css))
        + format_html_join("", '<link rel="modulepreload" href="{}">\n', ((_url(f),) for f in preload))
        + format_html('<script type="module" src="{}"></script>', _url(chunks[key]["file"])))
