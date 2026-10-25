"""Django settings. One user on their own computer: the server listens on 127.0.0.1 only, with no login."""

from pathlib import Path

from .datadir import data_dir, secret_key

PACKAGE_DIR = Path(__file__).resolve().parent
DATA_DIR = data_dir()
DATASETS_DIR = DATA_DIR / "datasets"

SECRET_KEY = secret_key(DATA_DIR)
DEBUG = False
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "dji_thermal_ui.analyzer",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "dji_thermal_ui.urls"
WSGI_APPLICATION = "dji_thermal_ui.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [PACKAGE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.template.context_processors.csrf",
            ],
        },
    },
]

# WAL and a busy timeout: the job runner's thread writes progress while waitress' threads read
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "db.sqlite3",
        "OPTIONS": {
            "timeout": 20,
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Served by the app itself (see urls.py): there is no web server in front of it
STATIC_URL = "static/"                     # urls.py serves this path
STATIC_DIR = PACKAGE_DIR / "static"

# No accounts: the API is open to the one local user, and CSRF is checked on every unsafe request (the scripts send
# the token), so another site open in the browser cannot post to it
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["dji_thermal_ui.csrf.CsrfCheck"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
    "UNAUTHENTICATED_TOKEN": None,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"dji_thermal_ui": {"handlers": ["console"], "level": "INFO"}},
}

# The basemaps under the mosaics (Google Map Tiles come later)
BASEMAPS = [
    {
        "default": True,
        "type": "tms",
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "label": "ESRI Satellite",
        "attribution": "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, "
                       "Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        "maxzoom": 21,
        "minzoom": 0,
    },
    {
        "default": False,
        "type": "tms",
        "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "label": "OpenStreetMap",
        "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        "maxzoom": 19,
        "minzoom": 0,
    },
]

# Jobs run inline instead of on the runner's thread (the tests set it)
THERMAL_JOBS_EAGER = False

# The worker processes dji-thermal-cli starts for an analysis, a conversion or a mosaic (None: its own default)
THERMAL_PROCESSES = None
