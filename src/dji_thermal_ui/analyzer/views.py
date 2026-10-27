"""The app's pages (the plugin's mount points, without its login and project checks). Each sets the CSRF cookie the
scripts send back to the API."""

from django.http import Http404
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import ensure_csrf_cookie

from .._version import __version__
from .api import app_theme, app_unit
from .basemaps import page_basemaps
from .models import ThermalConversion, ThermalDataset

API = "/api/"
PUBLIC = "/"


def page(request, template, **context):
    return render(request, template, dict(context, api=API, public=PUBLIC, unit=app_unit(), theme=app_theme(),
                                                 version=__version__))


def conversion_or_404(conversion_id):
    return get_object_or_404(ThermalConversion.objects.select_related('dataset'), pk=conversion_id)


@ensure_csrf_cookie
def datasets_list(request):
    return page(request, "datasets.html", title="Thermal Analyzer", entry="datasets")


@ensure_csrf_cookie
def dataset_page(request, dataset_id):
    dataset = get_object_or_404(ThermalDataset, pk=dataset_id)
    return page(request, "dataset.html", title=dataset.name, dataset=dataset, entry="dataset")


@ensure_csrf_cookie
def viewer_page(request, conversion_id):
    conversion = conversion_or_404(conversion_id)
    return page(request, "viewer.html", title=conversion.name, entry="viewer", conversion=conversion,
                dataset=conversion.dataset, basemaps=page_basemaps(API))


@ensure_csrf_cookie
def frame_page(request, conversion_id):
    conversion = conversion_or_404(conversion_id)
    return page(request, "frame.html", title=conversion.name, entry="frame", conversion=conversion,
                dataset=conversion.dataset)


@ensure_csrf_cookie
def compare_page(request, conversion_id):
    """Two conversions side by side: any two, of one dataset or of two (b: the other; this one when left out)"""
    conversion = conversion_or_404(conversion_id)
    other = conversion
    if request.GET.get('b'):
        try:
            other = conversion_or_404(int(request.GET['b']))
        except ValueError:
            raise Http404("No such conversion") from None
    return page(request, "compare.html", title="Compare", entry="compare", conversion=conversion, other=other,
                dataset=conversion.dataset, basemaps=page_basemaps(API))
