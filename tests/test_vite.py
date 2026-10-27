"""{% vite_entry %}: a page loads its script built by Vite, with the stylesheets and chunks it imports"""

from pathlib import Path

import pytest
from django.template import Context, Template

from dji_thermal_ui.analyzer.templatetags.vite import ManifestError

STUB = Path(__file__).parent / "data" / "vite-manifest.json"


def render(name):
    return Template('{%% load vite %%}{%% vite_entry "%s" %%}' % name).render(Context())


def test_an_entry_loads_its_script_its_stylesheets_once_and_preloads_its_chunks(settings):
    settings.VITE_MANIFEST = STUB
    html = render("projects")
    assert html.count('<link rel="stylesheet"') == 2
    assert '<link rel="stylesheet" href="/static/dist/assets/projects-c3.css">' in html
    assert '<link rel="stylesheet" href="/static/dist/assets/shared-e5.css">' in html
    assert '<link rel="modulepreload" href="/static/dist/assets/shared-b2.js">' in html
    assert '<link rel="modulepreload" href="/static/dist/assets/leaflet-d4.js">' in html
    assert html.endswith('<script type="module" src="/static/dist/assets/projects-a1.js"></script>')


def test_a_missing_build_or_entry_says_what_to_do(settings, tmp_path):
    settings.VITE_MANIFEST = tmp_path / "manifest.json"
    with pytest.raises(ManifestError, match="npm run build"):
        render("projects")
    settings.VITE_MANIFEST = STUB
    with pytest.raises(ManifestError, match="src/pages/nowhere.tsx"):
        render("nowhere")
