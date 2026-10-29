"""Django settings. One user on their own computer: the server listens on 127.0.0.1 only, with no login."""

from pathlib import Path

from .datadir import chosen, data_dir, secret_key

PACKAGE_DIR = Path(__file__).resolve().parent
DATA_DIR = data_dir()
# What chose it: 'environment' (--data-dir too), 'moved' (from the Storage page) or 'default'
DATA_DIR_SET_BY = chosen()[1]
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

# Where a project's location is searched for (analyzer/places.py)
NOMINATIM_URL = "https://nominatim.openstreetmap.org"

# The basemaps under the mosaics (Mapbox's satellite imagery is added to them when there is a token: analyzer/basemaps.py).
# key: what the basemap preference names it by; default: the one a map starts with unless another is preferred;
# tilemap: Esri's service saying which tiles exist, so that a level with none there is not drawn
BASEMAPS = [
    {
        "key": "esri",
        "default": True,
        "type": "tms",
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "label": "ESRI Satellite",
        "attribution": "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, "
                       "Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        "tilemap": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tilemap",
        "maxzoom": 21,
        "minzoom": 0,
    },
    {
        "key": "osm",
        "default": False,
        "type": "tms",
        "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "label": "OpenStreetMap",
        "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        "maxzoom": 19,
        "minzoom": 0,
    },
]

# Where MAPBOX_API_TOKEN is looked for when it is not in the environment: a .env file in the folder the app is
# started from, then in the data folder (the last, where a token is written when none of them has one)
MAPBOX_ENV_FILES = [Path.cwd() / ".env", DATA_DIR / ".env"]

# Jobs run inline instead of on the runner's thread (the tests set it)
THERMAL_JOBS_EAGER = False

# The worker processes dji-thermal-cli starts for an analysis, a conversion or a mosaic (None: its own default)
THERMAL_PROCESSES = None

# The front end's build (npm run build): its manifest says which files each page loads
VITE_MANIFEST = STATIC_DIR / "dist" / "manifest.json"
