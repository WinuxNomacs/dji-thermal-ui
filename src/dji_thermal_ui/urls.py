from django.conf import settings
from django.urls import include, path, re_path
from django.views.generic import TemplateView
from django.views.static import serve

urlpatterns = [
    path("api/", include("dji_thermal_ui.analyzer.urls")),
    path("", TemplateView.as_view(template_name="home.html"), name="home"),
    # The static files, served by the app itself: it runs without DEBUG and has no web server in front of it
    re_path(r"^static/(?P<path>.*)$", serve, {"document_root": settings.STATIC_DIR}),
]
