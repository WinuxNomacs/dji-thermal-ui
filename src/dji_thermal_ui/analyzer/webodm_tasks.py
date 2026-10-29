"""A WebODM task from a conversion: its temperature TIFFs (the frames it kept), processed with the options of the
dataset's WebODM plan (dji-thermal-cli's check --webodm, kept in dataset.analysis['webodm']) and any other.

The checks and the plan's options are the plugin's (thermal_task.py, at LuxODM a2a81052). The task is made through
WebODM's API by a job on the uploads worker: made waiting for its images (partial), the TIFFs sent in batches, then
committed. An upload that doesn't finish (canceled, failed, the server stopped) removes the half-made task from
WebODM, and the project too when the upload made it. Once committed, WebODM is asked how the task is going while a
page shows it (refresh)."""

import logging
import os
import re
import uuid
from datetime import timedelta

from django.core.exceptions import SuspiciousFileOperation
from django.utils import timezone

from . import jobs, webodm
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
                                         'progress', 'uploaded', 'total', 'error', 'created_at')}
    out['link'] = link(task)
    return out


def link(task):
    """The task in WebODM's dashboard, or its project while the task is not made; None before either"""
    if not task.project_id:
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
    """An upload whose job is gone (the job failed, the server stopped) is not left uploading forever"""
    if task.status == 'uploading' and not jobs.alive(task.run_id):
        message = "The upload stopped before it finished"
        if WebODMTask.objects.filter(pk=task.pk, run_id=task.run_id, status='uploading').update(
                status='failed', error=message, run_id=""):
            task.status, task.error, task.run_id = 'failed', message, ""
    return task


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
