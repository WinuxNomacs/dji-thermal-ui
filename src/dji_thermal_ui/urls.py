from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

from .analyzer import views

urlpatterns = [
    path("api/", include("dji_thermal_ui.analyzer.urls")),
    path("", views.projects_list, name="projects"),
    path("project/<int:project_id>", views.project_page, name="project"),
    path("dataset/<int:dataset_id>", views.dataset_page, name="dataset"),
    path("conversion/<int:conversion_id>", views.viewer_page, name="viewer"),
    path("conversion/<int:conversion_id>/frame", views.frame_page, name="frame"),
    path("conversion/<int:conversion_id>/compare", views.compare_page, name="compare"),
    # The static files, served by the app itself: it runs without DEBUG and has no web server in front of it
    re_path(r"^static/(?P<path>.*)$", serve, {"document_root": settings.STATIC_DIR}),
]
