import logging
import os
import shutil

from django.conf import settings
from django.db import models
from django.db.models import signals
from django.dispatch import receiver
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

logger = logging.getLogger('dji_thermal_ui')

DEFAULT_PROJECT_NAME = "Default Project"


class Project(models.Model):
    """A site's datasets together: its flights, compared with each other. One always exists (the Default Project,
    made whenever there is none)."""
    name = models.CharField(max_length=255, help_text=_("A label used to describe the project"), verbose_name=_("Name"))
    description = models.TextField(blank=True, default="", help_text=_("What the project is about"),
                                   verbose_name=_("Description"))
    location_lon = models.FloatField(null=True, blank=True, help_text=_("Where the site is: its longitude"),
                                     verbose_name=_("Longitude"))
    location_lat = models.FloatField(null=True, blank=True, help_text=_("Where the site is: its latitude"),
                                     verbose_name=_("Latitude"))
    location_label = models.CharField(max_length=255, blank=True, default="",
                                      help_text=_("The site's address or place name"), verbose_name=_("Location"))
    created_at = models.DateTimeField(default=timezone.now, help_text=_("Creation date"), verbose_name=_("Created at"))
    updated_at = models.DateTimeField(auto_now=True, help_text=_("Last modified date"), verbose_name=_("Updated at"))

    class Meta:
        verbose_name = _("Project")
        verbose_name_plural = _("Projects")
        ordering = ('created_at', 'id')

    def __str__(self):
        return self.name

    @classmethod
    def default(cls):
        """The first project, made (as the Default Project) when there is none"""
        project = cls.objects.order_by('created_at', 'id').first()
        return project or cls.objects.create(name=DEFAULT_PROJECT_NAME)

# A thermal dataset: the R-JPEGs of a flight, analyzed with dji-thermal-cli before they are converted. Its images are
# uploaded into the data folder, or read in place from a folder on the computer.

DATASET_SOURCES = (
    ('upload', _("Uploaded")),
    ('folder', _("Folder")),
)

DATASET_STATUSES = (
    ('new', _("Not analyzed")),
    ('analyzing', _("Analyzing")),
    ('ready', _("Analyzed")),
    ('failed', _("Failed")),
    ('canceled', _("Canceled")),
)


class ThermalDataset(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='datasets',
                                help_text=_("The project the dataset is in"), verbose_name=_("Project"))
    name = models.CharField(max_length=255, help_text=_("A label used to describe the dataset"), verbose_name=_("Name"))
    source = models.CharField(max_length=16, choices=DATASET_SOURCES, default='upload',
                              help_text=_("Where the images are: uploaded, or a folder on the computer"),
                              verbose_name=_("Source"))
    folder = models.CharField(max_length=1024, blank=True, default="",
                              help_text=_("The folder the images are read from (folder datasets)"),
                              verbose_name=_("Folder"))
    status = models.CharField(max_length=16, choices=DATASET_STATUSES, default='new', db_index=True,
                              help_text=_("Where the analysis is"), verbose_name=_("Status"))
    progress = models.FloatField(default=0.0, help_text=_("How far the analysis is, 0 to 1"), verbose_name=_("Progress"))
    error = models.TextField(blank=True, default="", help_text=_("Why the analysis failed"), verbose_name=_("Error"))
    run_id = models.CharField(max_length=32, blank=True, default="",
                              help_text=_("The current analysis: a job writes its results only while this is still its own "
                                          "(canceling, deleting or starting again changes it)"), verbose_name=_("Run ID"))
    file_count = models.IntegerField(default=0, help_text=_("Number of files"), verbose_name=_("Files"))
    size = models.FloatField(default=0.0, help_text=_("Size of the images in MB"), verbose_name=_("Size"))
    analysis = models.JSONField(default=dict, blank=True,
                                help_text=_("What dji-thermal-cli reported: the files, the problems it found, the WebODM plan"),
                                verbose_name=_("Analysis"))
    analyzed_at = models.DateTimeField(null=True, blank=True, help_text=_("When the analysis finished"), verbose_name=_("Analyzed at"))
    report = models.JSONField(default=dict, blank=True,
                              help_text=_("The text typed on its report: title, author, date, notes, and whether the "
                                          "frames' table is appended"), verbose_name=_("Report"))
    created_at = models.DateTimeField(default=timezone.now, help_text=_("Creation date"), verbose_name=_("Created at"))
    updated_at = models.DateTimeField(auto_now=True, help_text=_("Last modified date"), verbose_name=_("Updated at"))

    class Meta:
        verbose_name = _("Thermal dataset")
        verbose_name_plural = _("Thermal datasets")
        ordering = ('-created_at', '-id')        # rows made in the same clock tick (Windows) newest first too

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        # A dataset made without a project goes into the first one
        if self.project_id is None:
            self.project = Project.default()
        super().save(*args, **kwargs)

    def data_dir(self):
        """Where the app keeps this dataset's files"""
        return dataset_dir(self.id)

    def images_dir(self):
        """Where the images are: the uploads in the data folder, or the folder read in place"""
        return self.folder if self.source == 'folder' else os.path.join(self.data_dir(), 'images')

    def update_size(self):
        """Counts the images on disk (file count and MB)"""
        count, total = 0, 0
        d = self.images_dir()
        if os.path.isdir(d):
            for dirpath, _dirnames, filenames in os.walk(d):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    try:
                        if not os.path.islink(fp):
                            total += os.path.getsize(fp)
                            count += 1
                    except OSError:
                        pass
        self.file_count = count
        self.size = total / 1024.0 / 1024.0


CONVERSION_STATUSES = (
    ('converting', _("Converting")),
    ('ready', _("Converted")),
    ('failed', _("Failed")),
    ('canceled', _("Canceled")),
)

MOSAIC_STATUSES = (
    ('', _("None")),
    ('building', _("Building")),
    ('ready', _("Built")),
    ('failed', _("Failed")),
    ('canceled', _("Canceled")),
)


class ThermalConversion(models.Model):
    """A dataset's images converted with dji-thermal-cli's process: the settings used and the files written. A dataset
    keeps several side by side, to compare settings. The outputs are written into the data folder whatever the
    dataset's source."""
    dataset = models.ForeignKey(ThermalDataset, on_delete=models.CASCADE, related_name='conversions',
                                help_text=_("The dataset converted"), verbose_name=_("Dataset"))
    name = models.CharField(max_length=255, help_text=_("A label used to describe the conversion"), verbose_name=_("Name"))
    options = models.JSONField(default=dict, blank=True,
                                help_text=_("The settings used: measurement parameters, palette, adjustments, outputs"),
                                verbose_name=_("Settings"))
    status = models.CharField(max_length=16, choices=CONVERSION_STATUSES, default='converting', db_index=True,
                              help_text=_("Where the conversion is"), verbose_name=_("Status"))
    progress = models.FloatField(default=0.0, help_text=_("How far the conversion is, 0 to 1"), verbose_name=_("Progress"))
    error = models.TextField(blank=True, default="", help_text=_("Why the conversion failed"), verbose_name=_("Error"))
    run_id = models.CharField(max_length=32, blank=True, default="",
                              help_text=_("The current run: a job writes its results only while this is still its own "
                                          "(canceling or deleting changes it)"), verbose_name=_("Run ID"))
    results = models.JSONField(default=dict, blank=True,
                               help_text=_("What was written for each image, and what was skipped and why"),
                               verbose_name=_("Results"))
    mosaic_status = models.CharField(max_length=16, choices=MOSAIC_STATUSES, default="", blank=True,
                                     help_text=_("Where the mosaics are (built by the conversion's job after the "
                                                 "images, or later)"), verbose_name=_("Mosaics"))
    mosaic_progress = models.FloatField(default=0.0, help_text=_("How far the mosaics are, 0 to 1"),
                                        verbose_name=_("Mosaic progress"))
    stage = models.JSONField(default=dict, blank=True,
                             help_text=_("The stage a normalization or a mosaic being built is at, as dji-thermal-cli "
                                         "reports it (step, done of total), and which mosaic it is"),
                             verbose_name=_("Stage"))
    mosaic_error = models.TextField(blank=True, default="", help_text=_("Why the mosaics failed"),
                                    verbose_name=_("Mosaic error"))
    mosaics = models.JSONField(default=dict, blank=True,
                               help_text=_("The mosaics built: their files, bounds, value ranges and dji-thermal-cli's "
                                           "report"), verbose_name=_("Mosaic results"))
    file_count = models.IntegerField(default=0, help_text=_("Number of files written"), verbose_name=_("Files"))
    size = models.FloatField(default=0.0, help_text=_("Size of the outputs in MB"), verbose_name=_("Size"))
    created_at = models.DateTimeField(default=timezone.now, help_text=_("Creation date"), verbose_name=_("Created at"))
    finished_at = models.DateTimeField(null=True, blank=True, help_text=_("When the conversion finished"),
                                       verbose_name=_("Finished at"))
    report = models.JSONField(default=dict, blank=True,
                              help_text=_("Its mosaic report's text and view: title, author, date, notes, the view "
                                          "shown, and the measurements left out"), verbose_name=_("Report"))
    orthophoto = models.JSONField(default=dict, blank=True,
                                  help_text=_("The WebODM orthophoto brought back and shown beside the mosaics: the "
                                              "task it came from, its raster, where it is and its temperatures"),
                                  verbose_name=_("Orthophoto"))
    dsm = models.JSONField(default=dict, blank=True,
                           help_text=_("The WebODM surface model brought back for the mosaics: the task it came from, "
                                       "its raster, whether the mosaics use it and their height cell"),
                           verbose_name=_("DSM"))

    class Meta:
        verbose_name = _("Thermal conversion")
        verbose_name_plural = _("Thermal conversions")
        ordering = ('-created_at', '-id')        # rows made in the same clock tick (Windows) newest first too

    def __str__(self):
        return self.name

    def data_dir(self):
        """Where the outputs are written"""
        return conversion_dir(self.dataset_id, self.id)

    def update_size(self):
        """Counts the outputs on disk (file count and MB)"""
        count, total = 0, 0
        for dirpath, _dirnames, filenames in os.walk(self.data_dir()):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    if not os.path.islink(fp):
                        total += os.path.getsize(fp)
                        count += 1
                except OSError:
                    pass
        self.file_count = count
        self.size = total / 1024.0 / 1024.0


MEASUREMENT_TARGETS = (
    ('as_converted', _("Mosaic as converted")),
    ('harmonized', _("Harmonized mosaic")),
    ('webodm', _("WebODM orthophoto")),
    ('frame', _("Frame")),
)


class ThermalMeasurement(models.Model):
    """A spot, line or area measured on a conversion's mosaic or one of its frames, kept with the values found when it
    was saved (and the parameters changed, if any, they were found with)"""
    conversion = models.ForeignKey(ThermalConversion, on_delete=models.CASCADE, related_name='measurements',
                                   help_text=_("The conversion measured"), verbose_name=_("Conversion"))
    name = models.CharField(max_length=255, help_text=_("A label used to describe the measurement"),
                            verbose_name=_("Name"))
    target = models.CharField(max_length=16, choices=MEASUREMENT_TARGETS,
                              help_text=_("What was measured: a mosaic or a frame"), verbose_name=_("Target"))
    frame = models.CharField(max_length=1024, blank=True, default="",
                             help_text=_("The frame measured (its path in the dataset)"), verbose_name=_("Frame"))
    geometry = models.JSONField(help_text=_("A GeoJSON point, line or polygon: lon/lat on a mosaic, pixel columns "
                                            "and rows on a frame"), verbose_name=_("Geometry"))
    parameters = models.JSONField(default=dict, blank=True,
                                  help_text=_("The measurement parameters changed for it, if any"),
                                  verbose_name=_("Parameters"))
    values = models.JSONField(default=dict, blank=True, help_text=_("What was measured"), verbose_name=_("Values"))
    comment = models.TextField(blank=True, default="", help_text=_("What the user wrote about it"),
                               verbose_name=_("Comment"))
    created_at = models.DateTimeField(default=timezone.now, help_text=_("Creation date"), verbose_name=_("Created at"))

    class Meta:
        verbose_name = _("Thermal measurement")
        verbose_name_plural = _("Thermal measurements")
        ordering = ('created_at', 'id')

    def __str__(self):
        return self.name


# A finding: a spot or an area of a dataset the user found something at, kept with the frames that saw it and the
# temperatures measured when it was saved. In lon/lat, it shows on every mosaic of the dataset.

FINDING_SEVERITIES = (
    ('low', _("Low")),
    ('medium', _("Medium")),
    ('high', _("High")),
    ('critical', _("Critical")),
)

FINDING_STATUSES = (
    ('open', _("Open")),
    ('reviewed', _("Reviewed")),
    ('resolved', _("Resolved")),
)


class Finding(models.Model):
    dataset = models.ForeignKey(ThermalDataset, on_delete=models.CASCADE, related_name='findings',
                                help_text=_("The dataset the finding is in"), verbose_name=_("Dataset"))
    name = models.CharField(max_length=255, help_text=_("A label used to describe the finding"), verbose_name=_("Name"))
    notes = models.TextField(blank=True, default="", help_text=_("What was found"), verbose_name=_("Notes"))
    severity = models.CharField(max_length=16, choices=FINDING_SEVERITIES, default='medium',
                                help_text=_("How serious it is"), verbose_name=_("Severity"))
    status = models.CharField(max_length=16, choices=FINDING_STATUSES, default='open',
                              help_text=_("Where it is in its review"), verbose_name=_("Status"))
    geometry = models.JSONField(help_text=_("A GeoJSON point or polygon, lon/lat"), verbose_name=_("Geometry"))
    shape = models.JSONField(null=True, blank=True, help_text=_("The box or circle it was drawn as, if any"),
                             verbose_name=_("Shape"))
    conversion = models.ForeignKey(ThermalConversion, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='findings', help_text=_("The conversion its temperatures were read on"),
                                   verbose_name=_("Conversion"))
    tab = models.CharField(max_length=16, blank=True, default="",
                           help_text=_("The mosaic its temperatures were read on"), verbose_name=_("Mosaic"))
    temperatures = models.JSONField(default=dict, blank=True,
                                    help_text=_("The temperatures measured when it was saved"),
                                    verbose_name=_("Temperatures"))
    frames = models.JSONField(default=list, blank=True,
                              help_text=_("The frames that saw it, where it is in each and which were kept"),
                              verbose_name=_("Frames"))
    models_known = models.BooleanField(default=False,
                                       help_text=_("Whether every frame that saw it is listed (the mosaic's frame "
                                                   "models), or only those the mosaic used"),
                                       verbose_name=_("Every frame listed"))
    created_at = models.DateTimeField(default=timezone.now, help_text=_("Creation date"), verbose_name=_("Created at"))
    updated_at = models.DateTimeField(auto_now=True, help_text=_("Last modified date"), verbose_name=_("Updated at"))

    class Meta:
        verbose_name = _("Finding")
        verbose_name_plural = _("Findings")
        ordering = ('created_at', 'id')

    def __str__(self):
        return self.name


# A video's frame saved: where it was in the video and where the drone was, with the picture as shown and the original
# frame as PNGs in the flight's folder (video-frames/<key>.png and <key>-original.png). It may join a finding.

class VideoFrame(models.Model):
    dataset = models.ForeignKey(ThermalDataset, on_delete=models.CASCADE, related_name='video_frames',
                                help_text=_("The flight the video is in"), verbose_name=_("Flight"))
    video = models.CharField(max_length=1024, help_text=_("The video's path in the flight"), verbose_name=_("Video"))
    time = models.FloatField(help_text=_("Seconds from the video's start"), verbose_name=_("Time"))
    frame = models.IntegerField(help_text=_("The frame's number, from 1"), verbose_name=_("Frame"))
    point = models.JSONField(null=True, blank=True,
                             help_text=_("The track's point at that time ({lat, lon, alt, ...}), if it has one"),
                             verbose_name=_("Point"))
    name = models.CharField(max_length=255, help_text=_("A label used to describe the frame"), verbose_name=_("Name"))
    notes = models.TextField(blank=True, default="", help_text=_("What it shows"), verbose_name=_("Notes"))
    look = models.JSONField(default=dict, blank=True,
                            help_text=_("How it was shown: recoloured or not, and the palette, range, tone curve and "
                                        "isotherm"), verbose_name=_("Look"))
    key = models.CharField(max_length=32, help_text=_("The name of its pictures"), verbose_name=_("Key"))
    finding = models.ForeignKey(Finding, on_delete=models.SET_NULL, null=True, blank=True,
                                related_name='video_frames', help_text=_("The finding it is attached to, if any"),
                                verbose_name=_("Finding"))
    created_at = models.DateTimeField(default=timezone.now, help_text=_("Creation date"), verbose_name=_("Created at"))
    updated_at = models.DateTimeField(auto_now=True, help_text=_("Last modified date"), verbose_name=_("Updated at"))

    class Meta:
        verbose_name = _("Video frame")
        verbose_name_plural = _("Video frames")
        ordering = ('created_at', 'id')

    def __str__(self):
        return self.name

    def picture_path(self, original=False):
        return os.path.join(dataset_dir(self.dataset_id), 'video-frames',
                            self.key + ('-original' if original else '') + '.png')


WEBODM_TASK_STATUSES = (
    ('uploading', _("Uploading")),
    ('queued', _("Queued")),
    ('running', _("Running")),
    ('completed', _("Completed")),
    ('failed', _("Failed")),
    ('canceled', _("Canceled")),
    ('gone', _("Not in WebODM")),
)

ORTHOPHOTO_STATUSES = (
    ('', _("None")),
    ('downloading', _("Downloading")),
    ('failed', _("Failed")),
)


class WebODMTask(models.Model):
    """A task made in WebODM from a conversion's temperature TIFFs: where it is in WebODM and how far it got. Deleting
    the conversion deletes this row, never the task in WebODM."""
    conversion = models.ForeignKey(ThermalConversion, on_delete=models.CASCADE, related_name='webodm_tasks',
                                   help_text=_("The conversion its images come from"), verbose_name=_("Conversion"))
    url = models.CharField(max_length=2048, help_text=_("WebODM's address when it was made"), verbose_name=_("WebODM"))
    project_id = models.IntegerField(null=True, blank=True, help_text=_("Its WebODM project, once made"),
                                     verbose_name=_("WebODM project"))
    project_name = models.CharField(max_length=255, help_text=_("The WebODM project's name"),
                                    verbose_name=_("WebODM project name"))
    task_id = models.CharField(max_length=64, blank=True, default="", help_text=_("Its id in WebODM, once made"),
                               verbose_name=_("WebODM task"))
    name = models.CharField(max_length=255, help_text=_("The task's name"), verbose_name=_("Name"))
    node = models.CharField(max_length=255, blank=True, default="",
                            help_text=_("The processing node chosen; empty for WebODM's choice"),
                            verbose_name=_("Processing node"))
    options = models.JSONField(default=list, blank=True, help_text=_("The ODM options sent, [{name, value}]"),
                               verbose_name=_("Options"))
    status = models.CharField(max_length=16, choices=WEBODM_TASK_STATUSES, default='uploading', db_index=True,
                              help_text=_("Where it is: uploading here, then as WebODM says"), verbose_name=_("Status"))
    progress = models.FloatField(default=0.0, help_text=_("How far the upload, then the processing, is, 0 to 1"),
                                 verbose_name=_("Progress"))
    uploaded = models.BigIntegerField(default=0, help_text=_("Bytes sent"), verbose_name=_("Uploaded"))
    total = models.BigIntegerField(default=0, help_text=_("Bytes to send"), verbose_name=_("Total"))
    error = models.TextField(blank=True, default="", help_text=_("Why it failed"), verbose_name=_("Error"))
    run_id = models.CharField(max_length=32, blank=True, default="",
                              help_text=_("The upload, then a download (the orthophoto's or the DSM's): its job goes "
                                          "on only while this is still its own (canceling changes it)"), verbose_name=_("Run ID"))
    half_made = models.BooleanField(default=False,
                                    help_text=_("Made in WebODM but not committed: removed there when the upload "
                                                "doesn't finish"), verbose_name=_("Half made"))
    made_project = models.BooleanField(default=False,
                                       help_text=_("Whether the upload made its WebODM project, which goes with a "
                                                   "half-made task"), verbose_name=_("Made the project"))
    created_at = models.DateTimeField(default=timezone.now, help_text=_("Creation date"), verbose_name=_("Created at"))
    checked_at = models.DateTimeField(null=True, blank=True, help_text=_("When WebODM was last asked about it"),
                                      verbose_name=_("Checked at"))
    orthophoto_status = models.CharField(max_length=16, choices=ORTHOPHOTO_STATUSES, default="", blank=True,
                                         help_text=_("Its orthophoto being brought back (once it is, the "
                                                     "conversion's orthophoto says so)"),
                                         verbose_name=_("Orthophoto status"))
    orthophoto_progress = models.FloatField(default=0.0, help_text=_("How far the orthophoto's download is, 0 to 1"),
                                            verbose_name=_("Orthophoto progress"))
    orthophoto_error = models.TextField(blank=True, default="", help_text=_("Why the orthophoto wasn't brought back"),
                                        verbose_name=_("Orthophoto error"))
    dsm_status = models.CharField(max_length=16, choices=ORTHOPHOTO_STATUSES, default="", blank=True,
                                  help_text=_("Its DSM being brought back (once it is, the conversion's DSM says so)"),
                                  verbose_name=_("DSM status"))
    dsm_progress = models.FloatField(default=0.0, help_text=_("How far the DSM's download is, 0 to 1"),
                                     verbose_name=_("DSM progress"))
    dsm_error = models.TextField(blank=True, default="", help_text=_("Why the DSM wasn't brought back"),
                                 verbose_name=_("DSM error"))

    class Meta:
        verbose_name = _("WebODM task")
        verbose_name_plural = _("WebODM tasks")
        ordering = ('-created_at', '-id')

    def __str__(self):
        return self.name


class Preferences(models.Model):
    """The saved preferences for new datasets: a single row"""
    data = models.JSONField(default=dict, blank=True, help_text=_("The preferences saved"), verbose_name=_("Data"))

    class Meta:
        verbose_name = _("Preferences")
        verbose_name_plural = _("Preferences")

    @classmethod
    def load(cls):
        obj, _created = cls.objects.get_or_create(pk=1)
        return obj



class EncryptionKey(models.Model):
    """The key the WebODM password is encrypted with in a .env file (encryption): a single row, never sent to the
    browser"""
    key = models.CharField(max_length=64, help_text=_("A Fernet key"), verbose_name=_("Key"))

    class Meta:
        verbose_name = _("Encryption key")
        verbose_name_plural = _("Encryption keys")

def dataset_dir(dataset_id):
    return os.path.join(settings.DATASETS_DIR, str(dataset_id))


def conversion_dir(dataset_id, conversion_id):
    return os.path.join(dataset_dir(dataset_id), 'conversions', str(conversion_id))


def remove_dir(d, remove_empty_parent=True):
    """Removes a folder the app keeps, and its parent when that is left empty"""
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)
    if not remove_empty_parent:
        return
    parent = os.path.dirname(d)
    try:
        if os.path.isdir(parent) and not os.listdir(parent):
            os.rmdir(parent)
    except OSError:
        pass


@receiver(signals.post_delete, sender=ThermalConversion, dispatch_uid="thermal_conversion_post_delete")
def thermal_conversion_post_delete(sender, instance, **kwargs):
    if not ThermalDataset.objects.filter(pk=instance.dataset_id).exists():
        return  # the dataset's own deletion removes its whole folder
    remove_dir(conversion_dir(instance.dataset_id, instance.id))


@receiver(signals.post_delete, sender=VideoFrame, dispatch_uid="video_frame_post_delete")
def video_frame_post_delete(sender, instance, **kwargs):
    if not ThermalDataset.objects.filter(pk=instance.dataset_id).exists():
        return  # the dataset's own deletion removes its whole folder
    for path in (instance.picture_path(), instance.picture_path(original=True), os.path.dirname(instance.picture_path())):
        try:
            os.rmdir(path) if os.path.isdir(path) else os.remove(path)     # the folder only once it is empty
        except OSError:
            pass


@receiver(signals.post_delete, sender=ThermalDataset, dispatch_uid="thermal_dataset_post_delete")
def thermal_dataset_post_delete(sender, instance, **kwargs):
    # A folder dataset's folder is the user's own: only what the app keeps for the dataset is removed (and the
    # datasets/ folder itself is kept)
    remove_dir(dataset_dir(instance.id), remove_empty_parent=False)
