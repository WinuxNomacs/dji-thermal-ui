// Process in WebODM, on a conversion's card: the panel that makes a task from its temperature TIFFs (the project, the
// options with WebODM's presets, the processing node and the name), and the tasks made, followed while queued or
// running. WebODM itself is asked by the server, with the login in System Settings.
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {count, formatBytes} from "../core/format";
import {Save, Stop, Upload, Warning} from "../components/icons";
import {addedRow, applyPreset, type Choices, FOLLOW_MS, FOLLOWED, type OptionRow, planRows, sentOptions, type TaskInfo,
        taskBadge, taskLabel, type WebODMProject, type WebODMTask} from "./webodm";

const SEARCH_MS = 300;

// An option's help as ODM writes it, its argparse placeholders left out
function helpText(help: string): string {
    return help.replace(/\s*(Can be one of|Default):?\s*[^.]*%\(\w+\)s\.?/g, "").trim();
}

async function getJson<T>(url: string): Promise<{ok: boolean; data: T}> {
    return readJson<T>(await fetch(url, {credentials: "same-origin"}));
}

// One option's value, typed as WebODM types it
function OptionInput({row, set}: {row: OptionRow; set: (value: string | boolean) => void}) {
    const label = row.name + " value";
    if (row.type === "bool") {
        return <label class="check"><input type="checkbox" aria-label={label} checked={row.value === true}
                                           onChange={(e) => set(e.currentTarget.checked)}/> {row.value ? "yes" : "no"}</label>;
    }
    if (row.domain) {
        return (<select aria-label={label} value={String(row.value)} onChange={(e) => set(e.currentTarget.value)}>
            {!row.domain.includes(String(row.value)) && <option value={String(row.value)}>{String(row.value)}</option>}
            {row.domain.map((d) => <option key={d} value={d}>{d === "" ? "(none)" : d}</option>)}
        </select>);
    }
    if (row.type === "int" || row.type === "float") {
        return <input type="number" step={row.type === "int" ? "1" : "any"} aria-label={label} value={String(row.value)}
                      onInput={(e) => set(e.currentTarget.value)}/>;
    }
    return <input type="text" aria-label={label} value={String(row.value)} onInput={(e) => set(e.currentTarget.value)}/>;
}

interface PanelProps {api: string; publicUrl: string; conversion: number; onClose: () => void; onMade: () => void}

export function WebODMPanel({api, publicUrl, conversion, onClose, onMade}: PanelProps) {
    const [info, setInfo] = useState<TaskInfo | null>(null);
    const [choices, setChoices] = useState<Choices | null>(null);
    const [rows, setRows] = useState<OptionRow[]>([]);
    const [projects, setProjects] = useState<{projects: WebODMProject[]; count: number} | null>(null);
    const [search, setSearch] = useState("");
    const [newProject, setNewProject] = useState(true);
    const [project, setProject] = useState<number | null>(null);
    const [projectName, setProjectName] = useState("");
    const [name, setName] = useState("");
    const [node, setNode] = useState("auto");
    const [preset, setPreset] = useState("");
    const [applied, setApplied] = useState<number | null>(null);
    const [presetName, setPresetName] = useState("");
    const [message, setMessage] = useState<{text: string; cls: string} | null>(null);
    const [busy, setBusy] = useState(false);
    const searched = useRef(0);
    const say = (text: string, cls = "text-danger") => setMessage({text, cls});

    useEffect(() => {
        (async () => {
            const r = await getJson<TaskInfo>(api + "conversions/" + conversion + "/webodm");
            if (!r.ok) return say(errorText(r.data, "Could not load what the task would be."));
            setInfo(r.data);
            setName(r.data.name);
            setProjectName(r.data.project_name);
            if (!r.data.configured || r.data.problems.length) return;
            const [c, p] = await Promise.all([getJson<Choices>(api + "webodm/choices"),
                                              getJson<{projects: WebODMProject[]; count: number}>(api + "webodm/projects")]);
            if (!c.ok) return say(errorText(c.data, "Could not ask WebODM."));
            setChoices(c.data);
            setRows(planRows(r.data.options, c.data.options));
            if (c.data.presets.some((x) => x.id === r.data.preset)) setPreset(String(r.data.preset));
            if (p.ok) {
                setProjects(p.data);
                // A project of the app's project's name is chosen, when there is one the account can add to
                const same = p.data.projects.find((x) => x.can_add && x.name === r.data.project_name);
                if (same) { setNewProject(false); setProject(same.id); }
            }
        })().catch(() => say("Could not load what the task would be: is the app still running?"));
    }, [conversion]);

    // The projects whose name holds what is typed, asked a moment after typing stops
    useEffect(() => {
        if (!choices) return;
        const n = ++searched.current;
        const timer = setTimeout(async () => {
            const r = await getJson<{projects: WebODMProject[]; count: number}>(
                api + "webodm/projects?search=" + encodeURIComponent(search.trim()));
            if (n === searched.current && r.ok) setProjects(r.data);
        }, SEARCH_MS);
        return () => clearTimeout(timer);
    }, [search]);

    if (!info) {
        return (<div class="webodm-panel" id={"webodm-panel-" + conversion}>
            {message ? <p class={message.cls}>{message.text}</p> : <p class="text-muted">Loading…</p>}
            <div class="webodm-panel-actions"><button type="button" class="button default small" onClick={onClose}>Close</button></div>
        </div>);
    }

    const close = <button type="button" class="button default small" onClick={onClose}>Close</button>;
    if (!info.configured) {
        return (<div class="webodm-panel" id={"webodm-panel-" + conversion}>
            <p>WebODM is not set up yet: give its address and the account the app logs in as in
                {" "}<a href={publicUrl + "settings#webodm-settings"}>System Settings › WebODM</a>.</p>
            <div class="webodm-panel-actions">{close}</div>
        </div>);
    }
    if (info.problems.length) {
        return (<div class="webodm-panel" id={"webodm-panel-" + conversion}>
            <div class="notice error webodm-problems" role="alert">No task can be made from it:
                <ul>{info.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
            <div class="webodm-panel-actions">{close}</div>
        </div>);
    }

    const offered = choices?.options || [];
    const listed = new Set(rows.map((r) => r.name));
    const addable = offered.filter((o) => !listed.has(o.name)).sort((a, b) => a.name.localeCompare(b.name));
    const setRow = (i: number, change: Partial<OptionRow>) => setRows(rows.map((r, j) => j === i ? {...r, ...change} : r));
    const chosen = projects?.projects.find((p) => p.id === project);

    function apply() {
        const p = choices?.presets.find((x) => String(x.id) === preset);
        if (!p) return;
        setRows(applyPreset(rows, p, offered));
        setApplied(p.id);
        say(p.name + " applied: its options are ticked with its values.", "text-muted");
    }

    async function savePreset() {
        const sent = sentOptions(rows);
        if (sent.problem) return say(sent.problem);
        if (!presetName.trim()) return say("Type a name for the preset.");
        setBusy(true);
        try {
            const r = await readJson<{id: number; presets: Choices["presets"]}>(
                await sendJson(api + "webodm/presets", "POST", {name: presetName.trim(), options: sent.options}));
            if (!r.ok) return say(errorText(r.data, "Could not keep the preset."));
            setChoices({...choices!, presets: r.data.presets});
            setPreset(String(r.data.id));
            say("Kept in WebODM as the preset " + presetName.trim() + ".", "text-success");
        } finally {
            setBusy(false);
        }
    }

    async function start() {
        const sent = sentOptions(rows);
        if (sent.problem) return say(sent.problem);
        if (!newProject && !project) return say("Choose a WebODM project, or make a new one.");
        setBusy(true);
        setMessage(null);
        try {
            const body: Record<string, unknown> = {
                name: name.trim(), options: sent.options, node: node === "auto" ? null : Number(node),
                project: newProject ? null : project, project_name: projectName.trim(),
            };
            if (applied !== null) body.preset = applied;
            const r = await readJson(await sendJson(api + "conversions/" + conversion + "/webodm", "POST", body));
            if (!r.ok) return say(errorText(r.data, "Could not make the task."));
            onMade();
            onClose();
        } catch {
            say("Could not make the task: is the app still running?");
        } finally {
            setBusy(false);
        }
    }

    return (<div class="webodm-panel" id={"webodm-panel-" + conversion}>
        <div class="webodm-panel-head"><strong>Process in WebODM</strong>: a task from {count(info.frames, "temperature TIFF",
            "temperature TIFFs")} ({formatBytes(info.bytes)}), uploaded to WebODM, then processed there.</div>
        {info.warnings.length > 0 && <div class="notice warning webodm-warnings" role="status">
            <Warning/> Its settings differ from the WebODM plan's
            {info.process_args.length ? <> (<code>{info.process_args.join(" ")}</code>)</> : null}:
            <ul>{info.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
        {!choices ? (message ? null : <p class="text-muted">Asking WebODM…</p>) : <>
            <fieldset class="webodm-project"><legend>WebODM project</legend>
                <label class="check"><input type="radio" name={"webodm-project-" + conversion} checked={newProject}
                                            onChange={() => setNewProject(true)}/> A new project, named</label>
                {" "}<input type="text" class="webodm-project-name" aria-label="The new project's name" maxLength={255}
                            value={projectName} disabled={!newProject} onInput={(e) => setProjectName(e.currentTarget.value)}/>
                <div>
                    <label class="check"><input type="radio" name={"webodm-project-" + conversion} checked={!newProject}
                                                onChange={() => setNewProject(false)}/> One of the account's</label>
                    {" "}<input type="search" class="webodm-project-search" placeholder="Search the projects"
                                aria-label="Search the WebODM projects" value={search}
                                onInput={(e) => { setSearch(e.currentTarget.value); setNewProject(false); }}/>
                    {" "}<select class="webodm-project-list" aria-label="The WebODM project" value={project ?? ""}
                                 onChange={(e) => { setProject(Number(e.currentTarget.value) || null); setNewProject(false); }}>
                        <option value="">{projects?.projects.length ? "Choose one…" : "None found"}</option>
                        {project && !chosen && <option value={project}>(the one chosen)</option>}
                        {(projects?.projects || []).map((p) => <option key={p.id} value={p.id} disabled={!p.can_add}>
                            {p.name}{p.can_add ? "" : " (view only)"}</option>)}
                    </select>
                    {projects && projects.count > projects.projects.length && <span class="text-muted">
                        {" "}{projects.count - projects.projects.length} more: search to find them</span>}
                </div>
            </fieldset>
            <fieldset class="webodm-options"><legend>Options</legend>
                <div class="webodm-presets">
                    <select aria-label="A WebODM preset" value={preset} onChange={(e) => setPreset(e.currentTarget.value)}>
                        <option value="">A preset…</option>
                        {choices.presets.map((p) => <option key={p.id} value={p.id}>{p.name}{p.system ? " (WebODM's)" : ""}</option>)}
                    </select>
                    {" "}<button type="button" class="button default small" data-action="apply-preset" disabled={!preset || busy}
                                 title="Ticks the preset's options with its values; the others are left as they are"
                                 onClick={apply}>Apply</button>
                </div>
                {rows.length ? <div class="table-scroll"><table class="table webodm-options-table">
                    <thead><tr><th></th><th>Option</th><th>Value</th><th>Why</th></tr></thead>
                    <tbody>{rows.map((r, i) => (<tr key={r.name} class={r.on ? undefined : "off"} data-option={r.name}>
                        <td><input type="checkbox" aria-label={"Send " + r.name} checked={r.on}
                                   onChange={(e) => setRow(i, {on: e.currentTarget.checked})}/></td>
                        <td title={r.help}><code>{r.name}</code></td>
                        <td><OptionInput row={r} set={(value) => setRow(i, {value, on: true})}/></td>
                        <td class="text-muted">{r.reason || <span class="webodm-help">{helpText(r.help)}</span>}</td>
                    </tr>))}</tbody>
                </table></div> : <p class="text-muted">No options: ODM's defaults.</p>}
                <div class="webodm-add">
                    <select aria-label="Add an option" value="" onChange={(e) => {
                        const o = offered.find((x) => x.name === e.currentTarget.value);
                        if (o) setRows([...rows, addedRow(o)]);
                    }}>
                        <option value="">Add an option…</option>
                        {addable.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                    </select>
                    <span class="webodm-save-preset">
                        <input type="text" aria-label="The preset's name" placeholder="Preset name" maxLength={255}
                               value={presetName} onInput={(e) => setPresetName(e.currentTarget.value)}/>
                        {" "}<button type="button" class="button default small" data-action="save-preset"
                                     disabled={busy || !presetName.trim()} onClick={savePreset}
                                     title="The ticked options, kept in WebODM as a preset of the account's own">
                            <Save/> Save as preset</button>
                    </span>
                </div>
            </fieldset>
            <div class="webodm-task-fields">
                <label>Task name <input type="text" class="webodm-task-name" maxLength={255} value={name}
                                        onInput={(e) => setName(e.currentTarget.value)}/></label>
                <label>Processing node <select class="webodm-node" value={node} onChange={(e) => setNode(e.currentTarget.value)}>
                    <option value="auto">Automatic</option>
                    {choices.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}{n.online ? "" : " (offline)"}</option>)}
                </select></label>
            </div>
        </>}
        {message && <div class={"webodm-message " + message.cls} role="status">{message.text}</div>}
        <div class="webodm-panel-actions">
            {choices && <button type="button" class="button primary small" data-action="webodm-start" disabled={busy}
                                onClick={start}><Upload/> Upload to WebODM</button>}
            {close}
        </div>
    </div>);
}

interface TaskProps {api: string; task: WebODMTask; onChange: () => void}

// A task made in WebODM, on its conversion's card: asked about while queued or running
function TaskLine({api, task, onChange}: TaskProps) {
    const [t, setT] = useState(task);
    const [problem, setProblem] = useState("");
    useEffect(() => setT(task), [task]);

    useEffect(() => {
        if (!FOLLOWED.includes(t.status)) return;
        const timer = setTimeout(async () => {
            try {
                const r = await getJson<WebODMTask>(api + "webodm-tasks/" + t.id);
                if (r.ok) { setT(r.data); setProblem(r.data.check_error || ""); }
            } catch {
                setProblem("The app could not be reached");
            }
        }, FOLLOW_MS);
        return () => clearTimeout(timer);
    }, [t]);

    async function act(method: string, url: string) {
        const r = await readJson(await sendJson(url, method, method === "POST" ? {} : undefined));
        if (!r.ok) setProblem(errorText(r.data, "Could not change the task"));
        onChange();
    }

    const pct = Math.round((t.progress || 0) * 100);
    return (<li class="webodm-task" data-task={t.id}>
        <span class="webodm-task-name">WebODM: {t.link ? <a href={t.link} target="_blank" rel="noopener noreferrer">{t.name}</a>
            : t.name}</span>
        <span class="text-muted"> in {t.project_name}{t.node ? ", on " + t.node : ""}</span>
        {" "}<span class={taskBadge(t)}>{taskLabel(t)}</span>
        {t.status === "uploading" ? <button type="button" class="button default small" data-action="webodm-cancel"
                                           onClick={() => act("POST", api + "webodm-tasks/" + t.id + "/cancel")}>
            <Stop/> Cancel</button> :
            <button type="button" class="icon-button delete" data-action="webodm-forget" title="Take off the list (kept in WebODM)"
                    aria-label={"Take " + t.name + " off the list"}
                    onClick={() => act("DELETE", api + "webodm-tasks/" + t.id)}>×</button>}
        {(t.status === "uploading" || t.status === "running") &&
            <div class="progress row-progress"><div class="progress-bar active" style={{width: pct + "%"}}>{pct}%</div></div>}
        {t.error && <div class="text-danger"><Warning/> {t.error}</div>}
        {problem && <div class="text-warning">{problem}</div>}
    </li>);
}

export function WebODMTasks({api, tasks, onChange}: {api: string; tasks: WebODMTask[]; onChange: () => void}) {
    if (!tasks.length) return null;
    return <ul class="webodm-tasks">{tasks.map((t) => <TaskLine key={t.id} api={api} task={t} onChange={onChange}/>)}</ul>;
}
