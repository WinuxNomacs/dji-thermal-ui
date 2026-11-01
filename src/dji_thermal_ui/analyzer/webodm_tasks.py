"""A WebODM task from a conversion: its temperature TIFFs (the frames it kept), processed with the options of the
dataset's WebODM plan (dji-thermal-cli's check --webodm, kept in dataset.analysis['webodm']) and any other.

The checks and the plan's options are the plugin's (thermal_task.py, at LuxODM a2a81052). The task is made through
WebODM's API by a job on the uploads worker: made waiting for its images (partial), the TIFFs sent in batches, then
committed. An upload that doesn't finish (canceled, failed, the server stopped) removes the half-made task from
WebODM, and the project too when the upload made it. Once committed, WebODM is asked how the task is going while a
page shows it (refresh).

A completed task's orthophoto can be brought back, by a job on the same worker: downloaded into the conversion's
webodm folder and kept as temperatures (thermal_mosaics.orthophoto), shown beside its mosaics. Its DSM likewise, kept
as WebODM wrote it once dji-thermal-cli has read it, for the mosaics to be projected onto (thermal_mosaics.build). A
conversion keeps one of each: another task's replaces it. A task brings back one at a time (they share its run_id)."""

import logging
import os
import re
import time
import uuid
from datetime import timedelta
from pathlib import Path

import numpy as np
from django.core.exceptions import SuspiciousFileOperation
from django.utils import timezone

from . import jobs, thermal_mosaics, webodm
from .models import WebODMTask
from .raster.security import path_traversal_check

logger = logging.getLogger('dji_thermal_ui')

TIFF_SUFFIX = '_temp_c.tiff'
MIN_FRAMES = 2
BATCH_BYTES = 32 * 1024 * 1024      # images sent in one request, at most
BATCH_FILES = 50
REFRESH_SECONDS = 5                 # WebODM is asked about a task at most this often
FOLLOWED = ('queued', 'running')    # the statuses WebODM is asked about
OPTION_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,99}$')
MAX_OPTIONS = 200
MAX_VALUE = 10000
ASSETS = {'orthophoto': 'orthophoto.tif', 'dsm': 'dsm.tif'}    # what can be brought back: its asset in WebODM
MIN_CELL, MAX_CELL = 8, 1024        # dji-thermal-cli's bounds of the height cell
DSM_CELL = 16                       # the mosaics' height cell on WebODM's DSM, in mosaic pixels (24 cm in the DSM test)
PROGRESS_SECONDS = 0.5              # a download's progress is written at most this often
DOWNLOAD_SHARE = 0.9                # of its progress; writing it as temperatures is the rest


def plan_settings(process_args):
    """The conversion settings the plan's process command sets (as dji-thermal-cli's CLI takes them) that change the
    temperatures a task gets: {normalize, max_pitch, emissivity, humidity}, None for those it leaves out"""
    args = [str(a) for a in (process_args or [])]
    out = {'normalize': '--normalize' in args, 'max_pitch': None, 'emissivity': None, 'humidity': None}
    for i, a in enumerate(args[:-1]):
        key = a[2:].replace('-', '_')
        if a.startswith('--') and key in out and key != 'normalize':
            try:
                out[key] = float(args[i + 1])
            except ValueError:
                pass
    return out


def plan_of(conversion):
    return (conversion.dataset.analysis or {}).get('webodm') or {}


def tiffs(conversion):
    """The conversion's temperature TIFFs (paths in its folder), one per frame it kept"""
    found = []
    for f in (conversion.results or {}).get('files', []):
        if f.get('ok'):
            found += [o for o in f.get('outputs') or [] if o.endswith(TIFF_SUFFIX)]
    return found


def frames(conversion):
    """[(path in the conversion's folder, name in the task)]: a task's images are in one folder, so a name that two
    subfolders share keeps its folders in its name"""
    paths = tiffs(conversion)
    counts = {}
    for p in paths:
        counts[os.path.basename(p)] = counts.get(os.path.basename(p), 0) + 1
    return [(p, os.path.basename(p) if counts[os.path.basename(p)] == 1 else p.replace('\\', '/').replace('/', '_'))
            for p in paths]


def files(conversion):
    """[(path on disk, name in the task, bytes)] of the TIFFs still in the conversion's folder"""
    folder = conversion.data_dir()
    out = []
    for rel, name in frames(conversion):
        try:
            path = path_traversal_check(os.path.join(folder, rel), folder)
            out.append((path, name, os.path.getsize(path)))
        except (OSError, SuspiciousFileOperation):
            continue
    return out


def checks(conversion):
    """(problems, warnings): what stops a task being made from the conversion, and how its settings differ from the
    plan's process command"""
    problems, warnings = [], []
    options = conversion.options or {}
    if conversion.status != 'ready':
        problems.append("The dataset is not converted yet")
    if options.get('strip_location'):
        problems.append("The dataset's frames had their location removed: ODM needs it to place them")
    count = len(tiffs(conversion))
    if conversion.status == 'ready' and not count:
        problems.append("The dataset has no temperature TIFFs (temp_c:tiff): convert one with them")
    elif 0 < count < MIN_FRAMES:
        problems.append("A task needs at least {} frames".format(MIN_FRAMES))

    plan = plan_settings(plan_of(conversion).get('process_args'))
    if plan['normalize'] and not options.get('normalize'):
        warnings.append("Not normalized: the frames' offsets show as seams where ODM blends them")
    if plan['max_pitch'] is not None and options.get('max_pitch') != plan['max_pitch']:
        if options.get('max_pitch') is None:
            warnings.append("Oblique frames kept: the plan leaves out frames above {:g}° pitch".format(plan['max_pitch']))
        else:
            warnings.append("Pitch limit {:g}°, the plan's is {:g}°".format(options['max_pitch'], plan['max_pitch']))
    for key, label in (('emissivity', "Emissivity"), ('humidity', "Humidity")):
        if plan[key] is not None and options.get(key) != plan[key]:
            warnings.append("{} {}, the plan's is {:g}".format(
                label, "as recorded" if options.get(key) is None else "{:g}".format(options[key]), plan[key]))
    return problems, warnings


def plan_options(conversion):
    """The plan's ODM options, [{name, value, reason, recommended}]: the recommended ones first"""
    plan = plan_of(conversion)
    out = []
    for group, recommended in (('recommended', True), ('consider', False)):
        for name, o in (plan.get(group) or {}).items():
            out.append({'name': name, 'value': o.get('value'), 'reason': o.get('reason', ""), 'recommended': recommended})
    return out


def parse_options(data):
    """The ODM options asked for, [{name, value}]; ValueError says what is wrong"""
    if not isinstance(data, list) or len(data) > MAX_OPTIONS:
        raise ValueError("A list of options is expected")
    out, seen = [], set()
    for o in data:
        name = o.get('name') if isinstance(o, dict) else None
        value = o.get('value') if isinstance(o, dict) else None
        if not isinstance(name, str) or not OPTION_RE.match(name):
            raise ValueError("An option's name is like orthophoto-resolution")
        if name in seen:
            raise ValueError("The option {} is given twice".format(name))
        if isinstance(value, str):
            value = value.strip()
        if value is None or value == "" or isinstance(value, (list, dict)) or len(str(value)) > MAX_VALUE:
            raise ValueError("The option {} needs a value".format(name))
        seen.add(name)
        out.append({'name': name, 'value': value})
    return out


def summary(task):
    """A task as the conversion's card lists it"""
    out = {k: getattr(task, k) for k in ('id', 'project_id', 'project_name', 'task_id', 'name', 'node', 'status',
                                         'progress', 'uploaded', 'total', 'error', 'created_at',
                                         'orthophoto_status', 'orthophoto_progress', 'orthophoto_error',
                                         'dsm_status', 'dsm_progress', 'dsm_error')}
    out['link'] = link(task)
    out['dsm_asked'] = asked_dsm(task.options)
    return out


def asked_dsm(options):
    """Whether a task's options ask ODM for a DSM"""
    return any(o.get('name') == 'dsm' and str(o.get('value')).lower() == 'true' for o in options or []
               if isinstance(o, dict))


def orthophoto_summary(conversion):
    """The orthophoto shown, as the card says it: {task, task_name, downloaded_at}, or None"""
    o = conversion.orthophoto or {}
    return {k: o.get(k) for k in ('task', 'task_name', 'downloaded_at')} if o.get('raster') else None


def dsm_summary(conversion):
    """The DSM brought back, as the card says it: {task, task_name, downloaded_at, use, height_cell, pixel_m}, or
    None"""
    d = conversion.dsm or {}
    return {k: d.get(k) for k in ('task', 'task_name', 'downloaded_at', 'use', 'height_cell', 'pixel_m')} \
        if d.get('raster') else None


def used_dsm(conversion):
    """(the DSM's path, the height cell) when the mosaics are to be projected onto it, else None"""
    d = conversion.dsm or {}
    if not d.get('raster') or not d.get('use'):
        return None
    path = path_traversal_check(os.path.join(conversion.data_dir(), d['raster']), conversion.data_dir())
    return path, int(d.get('height_cell') or DSM_CELL)


def link(task):
    """The task in WebODM's dashboard, or its project while the task is being made; None without either (an upload
    that didn't finish leaves no task)"""
    if not task.project_id or not (task.task_id or task.status == 'uploading'):
        return None
    if not task.task_id:
        return "%s/dashboard/?project_task_open=%d" % (task.url, task.project_id)
    return "%s/dashboard/?project_task_open=%d&project_task_expanded=%s" % (task.url, task.project_id, task.task_id)


def start(conversion, url, project, project_name, name, node, node_label, options):
    """A task's row, its upload queued on the uploads worker"""
    found = files(conversion)
    task = WebODMTask.objects.create(conversion=conversion, url=url, project_id=project, project_name=project_name,
                                     name=name, node=node_label if node else "", options=options,
                                     total=sum(size for _, _, size in found), run_id=uuid.uuid4().hex)
    jobs.submit(upload_job(node), task.pk, task.run_id, jobs.UPLOADS)
    task.refresh_from_db()
    return task


class Stopped(Exception):
    """The upload's run is no longer its own: canceled, or its conversion deleted"""


def upload_job(node):
    def upload(pk, run_id):
        return run_upload(pk, run_id, node)
    upload.__name__ = 'upload'
    return upload


def current(pk, run_id, **fields):
    """Writes fields to the task while the run is still its own; Stopped when it is not"""
    q = WebODMTask.objects.filter(pk=pk, run_id=run_id)
    if not (q.update(**fields) if fields else q.exists()):
        raise Stopped()


def run_upload(pk, run_id, node):
    """The upload job: makes the project (when asked) and the task in WebODM, sends the TIFFs in batches, commits"""
    try:
        task = WebODMTask.objects.select_related('conversion').get(pk=pk, run_id=run_id)
    except WebODMTask.DoesNotExist:
        return
    client, project, made_project, task_id = None, task.project_id, False, ""
    try:
        client = webodm.Client.from_config()
        found = files(task.conversion)
        if len(found) < MIN_FRAMES:
            raise webodm.WebODMError("The dataset's temperature TIFFs are no longer in its folder")
        if not project:
            project = client.create_project(task.project_name)
            made_project = True
            current(pk, run_id, project_id=project, made_project=True)
        task_id = str(client.create_task(project, task.name, task.options, node))
        current(pk, run_id, task_id=task_id, half_made=True)
        sent = 0
        for batch in batches(found):
            current(pk, run_id)
            client.upload(project, task_id, [(path, name) for path, name, _ in batch])
            sent += sum(size for _, _, size in batch)
            current(pk, run_id, uploaded=sent, progress=sent / task.total if task.total else 1)
        current(pk, run_id)
        state = client.commit(project, task_id)
    except Stopped:
        if remove(client, project, task_id, made_project):
            WebODMTask.objects.filter(pk=pk).update(**removed(made_project))
    except Exception as e:
        if not isinstance(e, webodm.WebODMError):
            logger.exception("The upload of WebODM task %s failed", pk)
        fields = {'status': 'failed', 'run_id': "",
                  'error': str(e) if isinstance(e, webodm.WebODMError) else "The upload failed: {}".format(e)}
        if remove(client, project, task_id, made_project):
            fields.update(removed(made_project))
        WebODMTask.objects.filter(pk=pk, run_id=run_id).update(**fields)
    else:
        # Committed: WebODM processes it, whatever happened here meanwhile (a cancel too late)
        status = webodm.TASK_STATUSES.get(state.get('status') if isinstance(state, dict) else None, 'queued')
        WebODMTask.objects.filter(pk=pk).update(status=status, half_made=False, progress=0, run_id="", error="",
                                                checked_at=timezone.now())


def removed(made_project):
    """A task's fields once its half-made task (and the project the upload made) is removed from WebODM"""
    return dict({'task_id': "", 'half_made': False, 'made_project': False},
                **({'project_id': None} if made_project else {}))


def batches(found):
    """The files in batches of at most BATCH_FILES and BATCH_BYTES (a bigger file alone)"""
    batch, size = [], 0
    for f in found:
        if batch and (len(batch) >= BATCH_FILES or size + f[2] > BATCH_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(f)
        size += f[2]
    if batch:
        yield batch


def remove(client, project, task_id, made_project):
    """Removes a half-made task from WebODM, and its project when the upload made it: whether it could"""
    if client is None or not project:
        return not task_id
    try:
        if task_id:
            client.remove_task(project, task_id)
        if made_project:
            client.delete_project(project)
        return True
    except webodm.WebODMError as e:
        logger.warning("The half-made WebODM task %s could not be removed: %s", task_id, e)
        return False


def remove_half_made():
    """Queues the removal of the tasks a closed server left half made (after jobs.mark_interrupted)"""
    for task in WebODMTask.objects.filter(half_made=True).exclude(status='uploading'):
        jobs.submit(remove_job, task.pk, "", jobs.UPLOADS)


def remove_job(pk, run_id):
    try:
        task = WebODMTask.objects.get(pk=pk, half_made=True)
        client = webodm.Client.from_config()
    except (WebODMTask.DoesNotExist, webodm.WebODMError):
        return
    if remove(client, task.project_id, task.task_id, task.made_project):
        WebODMTask.objects.filter(pk=pk).update(**removed(task.made_project))


def cancel(task):
    """Stops an upload: its job removes the half-made task"""
    WebODMTask.objects.filter(pk=task.pk, status='uploading').update(status='canceled', run_id="")
    task.refresh_from_db()
    return task


def check_stale(task):
    """An upload or download whose job is gone (the job failed, the server stopped) is not left going forever"""
    if task.status == 'uploading' and not jobs.alive(task.run_id):
        message = "The upload stopped before it finished"
        if WebODMTask.objects.filter(pk=task.pk, run_id=task.run_id, status='uploading').update(
                status='failed', error=message, run_id=""):
            task.status, task.error, task.run_id = 'failed', message, ""
    for asset in ASSETS:
        if getattr(task, asset + '_status') == 'downloading' and not jobs.alive(task.run_id):
            message = "The download stopped before it finished"
            if WebODMTask.objects.filter(pk=task.pk, run_id=task.run_id, **{asset + '_status': 'downloading'}).update(
                    run_id="", **{asset + '_status': 'failed', asset + '_error': message}):
                setattr(task, asset + '_status', 'failed')
                setattr(task, asset + '_error', message)
                task.run_id = ""
    return task


def downloading(task):
    """Whether something of the task is being brought back"""
    return any(getattr(task, asset + '_status') == 'downloading' for asset in ASSETS)


def refresh(task):
    """Asks WebODM how a queued or running task is going (at most every REFRESH_SECONDS); what went wrong asking is
    returned, not kept"""
    if task.status not in FOLLOWED or not task.task_id or not task.project_id:
        return ""
    now = timezone.now()
    if task.checked_at and now - task.checked_at < timedelta(seconds=REFRESH_SECONDS):
        return ""
    try:
        state = webodm.Client.from_config().task(task.project_id, task.task_id)
    except webodm.WebODMError as e:
        if e.status == 404:
            task.status, task.error = 'gone', "Removed from WebODM, or the account can no longer see it"
            WebODMTask.objects.filter(pk=task.pk).update(status=task.status, error=task.error, checked_at=now)
            return ""
        return str(e)
    task.status = state['status']
    task.progress = 1.0 if task.status == 'completed' else state['progress']
    task.error = state['error'] if task.status == 'failed' else ""
    task.checked_at = now
    task.save(update_fields=['status', 'progress', 'error', 'checked_at'])
    return ""


def orthophoto_folder(conversion):
    return os.path.join(conversion.data_dir(), thermal_mosaics.WEBODM)


def fetch(task, asset='orthophoto'):
    """Brings back a completed task's orthophoto or DSM: its download queued on the uploads worker"""
    run_id = uuid.uuid4().hex
    WebODMTask.objects.filter(pk=task.pk).update(run_id=run_id, **{asset + '_status': 'downloading',
                                                                  asset + '_progress': 0, asset + '_error': ""})
    jobs.submit(run_orthophoto if asset == 'orthophoto' else run_dsm, task.pk, run_id, jobs.UPLOADS)
    task.refresh_from_db()
    return task


def run_orthophoto(pk, run_id):
    """The orthophoto's download job: written beside the conversion's mosaics as temperatures, then shown in place of
    the one shown before"""
    run_download('orthophoto', pk, run_id)


def run_dsm(pk, run_id):
    """The DSM's download job: kept as WebODM wrote it once dji-thermal-cli has read it, in place of the one before
    (whose use and height cell it keeps)"""
    run_download('dsm', pk, run_id)


def made_orthophoto(conversion, part, made):
    unit = (conversion.options or {}).get('unit') or 'C'
    return dict(thermal_mosaics.orthophoto(part, made, unit), unit=unit)


def made_dsm(conversion, part, made):
    from dji_thermal_cli import mosaic as dji_mosaic
    dsm = dji_mosaic.read_dsm(Path(part))
    if not np.isfinite(dsm.z).any():
        raise ValueError("WebODM's DSM holds no heights")
    rows, cols = dsm.z.shape
    shown = thermal_mosaics.heights(part, heights_name(made))
    os.replace(part, made)
    before = conversion.dsm or {}
    return dict(shown, width=cols, height=rows, pixel_m=round(dsm.pixel_m(), 4),
                use=before.get('use', True) if before.get('raster') else True,
                height_cell=before.get('height_cell') or DSM_CELL)


def heights_name(name):
    """The name of the DSM's copy the Heights tab reads (thermal_mosaics.heights), beside it"""
    return name.replace('.tif', '-heights.tif', 1)


def run_download(asset, pk, run_id):
    try:
        task = WebODMTask.objects.select_related('conversion').get(pk=pk, run_id=run_id)
    except WebODMTask.DoesNotExist:
        return
    conversion = task.conversion
    folder = orthophoto_folder(conversion)
    part = os.path.join(folder, 'download-%d.part' % pk)
    name = '%s-%d.tif' % (asset, pk)
    made = os.path.join(folder, name + '.part')
    written = [0.0]

    def progress(done, total):
        now = time.monotonic()
        if total and now - written[0] >= PROGRESS_SECONDS:
            written[0] = now
            current(pk, run_id, **{asset + '_progress': done / total * DOWNLOAD_SHARE})
        else:
            current(pk, run_id)

    what = "orthophoto" if asset == 'orthophoto' else "DSM"
    try:
        os.makedirs(folder, exist_ok=True)
        webodm.Client.from_config().download(task.project_id, task.task_id, ASSETS[asset], part, progress)
        current(pk, run_id, **{asset + '_progress': DOWNLOAD_SHARE})
        info = (made_orthophoto if asset == 'orthophoto' else made_dsm)(conversion, part, made)
        current(pk, run_id)
        os.replace(made, os.path.join(folder, name))
        if asset == 'dsm':
            os.replace(heights_name(made), os.path.join(folder, heights_name(name)))
            info['heights_raster'] = thermal_mosaics.WEBODM + '/' + heights_name(name)
    except Stopped:
        return
    except Exception as e:
        if not isinstance(e, (webodm.WebODMError, ValueError)):
            logger.exception("The %s of WebODM task %s could not be brought back", what, pk)
        message = str(e) if isinstance(e, (webodm.WebODMError, ValueError)) else \
            "The {} could not be brought back: {}".format(what, e)
        WebODMTask.objects.filter(pk=pk, run_id=run_id).update(run_id="", **{
            asset + '_status': 'failed', asset + '_error': message, asset + '_progress': 0})
        return
    finally:
        for path in (part, made, heights_name(made)):
            if os.path.exists(path):
                os.remove(path)
    from .models import ThermalConversion
    shown = dict(info, raster=thermal_mosaics.WEBODM + '/' + name, task=pk, task_name=task.name,
                 downloaded_at=timezone.now().isoformat())
    before = ThermalConversion.objects.filter(pk=conversion.pk).values_list(asset, flat=True).first()
    ThermalConversion.objects.filter(pk=conversion.pk).update(**{asset: shown})
    WebODMTask.objects.filter(pk=pk).update(run_id="", **{asset + '_status': "", asset + '_progress': 0,
                                                          asset + '_error': ""})
    if before and before.get('raster') and before['raster'] != shown['raster']:
        remove_rasters(conversion, before)
    update_size(conversion.pk)


def remove_rasters(conversion, shown):
    """Removes an orthophoto's or DSM's files (the DSM's copy for the Heights tab too)"""
    for raster in (shown.get('raster'), shown.get('heights_raster')):
        if not raster:
            continue
        try:
            os.remove(path_traversal_check(os.path.join(conversion.data_dir(), raster), conversion.data_dir()))
        except (OSError, SuspiciousFileOperation):
            pass


def remove_orthophoto(conversion, task=None, asset='orthophoto'):
    """Stops showing the conversion's orthophoto, or using its DSM (only when it came from task, if given), and
    removes its file"""
    from .models import ThermalConversion
    shown = getattr(conversion, asset) or {}
    if not shown.get('raster') or (task is not None and shown.get('task') != task.pk):
        return False
    ThermalConversion.objects.filter(pk=conversion.pk).update(**{asset: {}})
    setattr(conversion, asset, {})
    remove_rasters(conversion, shown)
    update_size(conversion.pk)
    return True


def cancel_orthophoto(task, asset='orthophoto'):
    """Stops a download: its job removes what it wrote"""
    WebODMTask.objects.filter(pk=task.pk, **{asset + '_status': 'downloading'}).update(
        run_id="", **{asset + '_status': "", asset + '_progress': 0})
    task.refresh_from_db()
    return task


def update_size(pk):
    from .models import ThermalConversion
    conversion = ThermalConversion.objects.filter(pk=pk).first()
    if conversion:
        conversion.update_size()
        ThermalConversion.objects.filter(pk=pk).update(file_count=conversion.file_count, size=conversion.size)
