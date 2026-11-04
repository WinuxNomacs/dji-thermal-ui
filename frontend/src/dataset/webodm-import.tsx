// Import from WebODM, under the flight's New dataset form: a dialog that brings an orthophoto (and its DSM) into the
// flight as a dataset of its own. From WebODM, it browses the account's projects and their completed tasks, each with
// a preview of its orthophoto, those over the flight first; from a file, it takes a GeoTIFF downloaded from WebODM's
// page. The server downloads and reads it in the background: the dataset's card follows it.
import {useEffect, useLayoutEffect, useRef, useState} from "preact/hooks";
import {csrfToken, errorText, readJson, sendJson} from "../core/api";
import {count, formatBytes, formatDate} from "../core/format";
import {Download, Upload} from "../components/icons";
import type {Conversion} from "./conversions";
import type {WebODMProject} from "./webodm";

export const MAX_FILE_BYTES = 1024 ** 3;        // what the server takes in one request

// A completed task with an orthophoto, as the server lists a project's
export interface ImportTask {
    id: string; name: string; created_at: string | null; images: number; processing_ms: number | null; dsm: boolean;
    extent: number[] | null; over: boolean;
}

interface Props {
    api: string;
    publicUrl: string;
    dataset: number;
    onClose: () => void;
    onImported: (c: Conversion) => void;
}

// How long WebODM took, from its milliseconds: "1 h 05 min", "12 min", "40 s"
export function processingText(ms: number | null | undefined): string {
    if (!ms || ms < 0) return "";
    const s = Math.round(ms / 1000);
    if (s < 60) return s + " s";
    const m = Math.round(s / 60);
    return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min";
}

// A task's preview, or a placeholder saying there is none (WebODM couldn't make one)
function Preview({src, alt}: {src: string; alt: string}) {
    const [failed, setFailed] = useState(false);
    return failed ? <span class="webodm-no-preview text-muted">No preview</span> :
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)}/>;
}

export function ImportDialog({api, publicUrl, dataset, onClose, onImported}: Props) {
    const [mode, setMode] = useState<"webodm" | "file">("webodm");
    const [projects, setProjects] = useState<{projects: WebODMProject[]; count: number} | null>(null);
    const [search, setSearch] = useState("");
    const [project, setProject] = useState<WebODMProject | null>(null);
    const [tasks, setTasks] = useState<{tasks: ImportTask[]; others: number} | null>(null);
    const [task, setTask] = useState<ImportTask | null>(null);
    const [dsm, setDsm] = useState(true);
    const [name, setName] = useState("");
    const [orthophoto, setOrthophoto] = useState<File | null>(null);
    const [dsmFile, setDsmFile] = useState<File | null>(null);
    const [problem, setProblem] = useState<string | null>(null);      // WebODM can't be asked: said in place of the browser
    const [message, setMessage] = useState<{text: string; cls: string} | null>(null);
    const [busy, setBusy] = useState(false);
    const searched = useRef(0);
    const inner = useRef<HTMLDivElement>(null);
    const get = async <T,>(url: string) => readJson<T>(await fetch(url, {credentials: "same-origin"}));

    // Escape closes it (not while it sends what was chosen)
    useLayoutEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); } };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, [busy]);
    useLayoutEffect(() => { inner.current?.focus(); }, []);

    // The projects whose name holds what is typed, asked a moment after typing stops; the first chosen
    useEffect(() => {
        const n = ++searched.current;
        const asked = async () => {
            const r = await get<{projects: WebODMProject[]; count: number}>(
                api + "webodm/projects" + (search.trim() ? "?search=" + encodeURIComponent(search.trim()) : ""));
            if (n !== searched.current) return;
            if (!r.ok) return setProblem(errorText(r.data, "WebODM could not be asked for its projects."));
            setProblem(null);
            setProjects(r.data);
            if (!project && r.data.projects.length) setProject(r.data.projects[0]);
        };
        if (!search) return void asked();
        const timer = setTimeout(asked, 300);
        return () => clearTimeout(timer);
    }, [search]);

    // A project's tasks, the first chosen
    useEffect(() => {
        if (!project) return;
        let live = true;
        setTasks(null);
        setTask(null);
        (async () => {
            const r = await get<{tasks: ImportTask[]; others: number}>(
                api + "webodm/projects/" + project.id + "/tasks?dataset=" + dataset);
            if (!live) return;
            if (!r.ok) return setMessage({text: errorText(r.data, "WebODM could not be asked for the project's tasks."), cls: "text-danger"});
            setTasks(r.data);
            choose(r.data.tasks[0] || null);
        })();
        return () => { live = false; };
    }, [project?.id]);

    function choose(t: ImportTask | null) {
        setTask(t);
        setDsm(!!t?.dsm);
        setMessage(null);
    }

    const preview = (t: ImportTask, size: number) =>
        api + "webodm/projects/" + project!.id + "/tasks/" + encodeURIComponent(t.id) + "/preview?size=" + size;

    async function start() {
        setMessage(null);
        let res: Response;
        if (mode === "webodm") {
            if (!task || !project) return setMessage({text: "Choose a task.", cls: "text-danger"});
            setBusy(true);
            res = await sendJson(api + "datasets/" + dataset + "/import/webodm", "POST",
                                 {project: project.id, task: task.id, dsm: dsm && task.dsm, name: name.trim()});
        } else {
            if (!orthophoto) return setMessage({text: "Choose the orthophoto's GeoTIFF.", cls: "text-danger"});
            const big = [orthophoto, dsmFile].find((f) => f && f.size > MAX_FILE_BYTES);
            if (big) return setMessage({text: big.name + " is " + formatBytes(big.size) + ": a file can be up to " +
                formatBytes(MAX_FILE_BYTES) + ". Import it from its WebODM task instead.", cls: "text-danger"});
            const body = new FormData();
            body.append("orthophoto", orthophoto);
            if (dsmFile) body.append("dsm", dsmFile);
            if (name.trim()) body.append("name", name.trim());
            setBusy(true);
            setMessage({text: "Sending " + orthophoto.name + "…", cls: "text-muted"});
            res = await fetch(api + "datasets/" + dataset + "/import/file", {
                method: "POST", credentials: "same-origin", headers: {"X-CSRFToken": csrfToken()}, body});
        }
        const r = await readJson<Conversion>(res);
        setBusy(false);
        if (!r.ok) return setMessage({text: errorText(r.data, "Could not start the import."), cls: "text-danger"});
        onImported(r.data);
        onClose();
    }

    const fileField = (label: string, id: string, file: File | null, set: (f: File | null) => void) => (
        <div class="field">
            <label for={id}>{label}</label>
            <input type="file" id={id} accept=".tif,.tiff,image/tiff" disabled={busy}
                   onChange={(e) => set(e.currentTarget.files?.[0] || null)}/>
            {file && <span class="text-muted"> {formatBytes(file.size)}</span>}
        </div>);

    return (
        <div class="dialog" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div class="dialog-inner webodm-import" role="dialog" aria-modal="true" aria-labelledby="import-title"
                 tabIndex={-1} ref={inner}>
                <h2 id="import-title">Import from WebODM</h2>
                <div class="segmented import-from">
                    <button type="button" id="import-from-webodm" aria-pressed={mode === "webodm"} disabled={busy}
                            onClick={() => setMode("webodm")}><Download/> From WebODM</button>
                    <button type="button" id="import-from-file" aria-pressed={mode === "file"} disabled={busy}
                            onClick={() => setMode("file")}><Upload/> From a file</button>
                </div>
                <p class="text-muted">An orthophoto becomes a dataset of this flight: one of temperatures (read as °C,
                    as ODM writes them) is shown as the viewer's WebODM tab, one of colours as a visual mosaic.</p>
                {mode === "webodm" ? (problem ? <p class="text-danger" id="import-problem">{problem}{" "}
                    <a href={publicUrl + "settings#webodm-settings"}>System Settings › WebODM</a></p> : browser()) : fromFile()}
                <div class="field import-name">
                    <label for="import-name">Name</label>
                    <input type="text" id="import-name" maxLength={255} value={name} disabled={busy}
                           placeholder={mode === "webodm" ? task?.name || "The task's name" : orthophoto?.name.replace(/\.tiff?$/i, "") || "The file's name"}
                           onInput={(e) => setName(e.currentTarget.value)}/>
                </div>
                {message && <div class={"import-message " + message.cls} role="status">{message.text}</div>}
                <div class="dialog-actions">
                    <button type="button" class="button default" disabled={busy} onClick={onClose}>Cancel</button>
                    <button type="button" class="button primary" id="import-start" disabled={busy || (mode === "webodm" && !task)}
                            onClick={start}>Import</button>
                </div>
            </div>
        </div>
    );

    function browser() {
        return (<div class="webodm-browser">
            <div class="webodm-projects">
                <input type="search" placeholder="Search the projects" aria-label="Search the WebODM projects"
                       value={search} onInput={(e) => setSearch(e.currentTarget.value)}/>
                {!projects ? <p class="text-muted">Asking WebODM…</p> : !projects.projects.length ?
                    <p class="text-muted">{search ? "No project's name holds that." : "The account sees no projects."}</p> :
                    <ul class="webodm-project-list" aria-label="WebODM projects">
                        {projects.projects.map((p) => <li key={p.id}>
                            <button type="button" aria-pressed={p.id === project?.id} data-webodm-project={p.id}
                                    onClick={() => setProject(p)}>{p.name || "Project " + p.id}</button></li>)}
                    </ul>}
                {projects && projects.count > projects.projects.length && <p class="text-muted">
                    {projects.count - projects.projects.length} more: search to find them.</p>}
            </div>
            <div class="webodm-tasks" aria-label="Its tasks">
                {!project ? null : !tasks ? <p class="text-muted">Asking WebODM…</p> : <>
                    {!tasks.tasks.length && <p class="text-muted">No completed task with an orthophoto.</p>}
                    <div class="webodm-task-grid">
                        {tasks.tasks.map((t) => <button type="button" key={t.id} class="webodm-task-card" data-task={t.id}
                                                        aria-pressed={t.id === task?.id} onClick={() => choose(t)}>
                            <Preview src={preview(t, 256)} alt=""/>
                            <span class="webodm-task-name">{t.name || "Task " + t.id.slice(0, 8)}</span>
                            <span class="text-muted">{formatDate(t.created_at)}</span>
                            <span class="chips">{t.over && <span class="chip changed">Over this flight</span>}
                                <span class="chip">Orthophoto</span>{t.dsm && <span class="chip">DSM</span>}</span>
                        </button>)}
                    </div>
                    {tasks.others > 0 && <p class="text-muted">{count(tasks.others, "other task", "other tasks")} (running,
                        failed, or without an orthophoto) {tasks.others === 1 ? "isn't" : "aren't"} listed.</p>}
                </>}
            </div>
            <div class="webodm-chosen">
                {task && project && <>
                    <Preview key={task.id} src={preview(task, 640)} alt={"The orthophoto of " + task.name}/>
                    <strong>{task.name}</strong>
                    <table class="table values"><tbody>
                        <tr><th>Project</th><td>{project.name}</td></tr>
                        <tr><th>Made</th><td>{formatDate(task.created_at)}</td></tr>
                        <tr><th>Images</th><td>{task.images}</td></tr>
                        {processingText(task.processing_ms) && <tr><th>Processed in</th><td>{processingText(task.processing_ms)}</td></tr>}
                        <tr><th>Over this flight</th><td>{task.over ? "yes" : task.extent ? "no" : "unknown"}</td></tr>
                    </tbody></table>
                    {task.dsm && <label class="check"><input type="checkbox" id="import-dsm" checked={dsm} disabled={busy}
                                                             onChange={(e) => setDsm(e.currentTarget.checked)}/> Its DSM too (the Heights tab)</label>}
                </>}
            </div>
        </div>);
    }

    function fromFile() {
        return (<div class="import-file">
            <p class="text-muted">On WebODM's page, a task's Download assets gives the orthophoto (GeoTIFF) and the
                DSM. A file can be up to {formatBytes(MAX_FILE_BYTES)}.</p>
            {fileField("Orthophoto", "import-orthophoto", orthophoto, setOrthophoto)}
            {fileField("DSM (optional)", "import-dsm-file", dsmFile, setDsmFile)}
        </div>);
    }
}
