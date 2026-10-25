from django.apps import AppConfig


class AnalyzerConfig(AppConfig):
    name = "dji_thermal_ui.analyzer"
    label = "analyzer"
    default_auto_field = "django.db.models.BigAutoField"
