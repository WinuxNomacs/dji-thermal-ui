// A project's datasets, searched and sorted, kept up to date while one is analyzed or converted, under what the
// project page shows of the project; New Dataset (made in the project), also opened by dropping images (or their
// folder) anywhere on the page; a dataset moved to another project
import {type ComponentChildren} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {count, deleteText, formatBytes, formatDate, statusLabel} from "../core/format";
import {matchesSearch} from "../core/search";
import {ask, askName, dialog} from "../components/dialog";
import {CaretDown, CaretUp, Check, Cog, Folder, Images, MoveTo, Pencil, Plus, Refresh, Trash} from "../components/icons";
import {SearchBox} from "../components/search-box";
import {type Dataset, droppedFiles, filesCell, sortDatasets} from "./list";
import {NewDataset, type Stage} from "./new-dataset";

const POLL_MS = 3000;

const COLUMNS: {key: string; label: string; title?: string}[] = [
    {key: "name", label: "Name"},
    {key: "status", label: "Status"},
    {key: "files", label: "Files"},
    {key: "problems", label: "Problems"},
    {key: "conversions", label: "Datasets", title: "Datasets ready of all"},
    {key: "findings", label: "Findings", title: "Findings saved on its mosaics"},
    {key: "size", label: "Size"},
    {key: "activity", label: "Last activity", title: "The latest creation, analysis or conversion to a dataset"},
    {key: "created", label: "Created"},
];

function StatusCell({d}: {d: Dataset}) {
    const label = statusLabel(d);
    if (d.status === "analyzing") {
        const pct = Math.round((d.progress || 0) * 100);
        return (<div class="progress row-progress" title={label}>
            <div class="progress-bar active" style={{width: pct + "%"}}>{pct}%</div></div>);
    }
    if (d.busy) return <span class="text-info" title={label}><Cog class="icon spin"/> Converting</span>;
    const cls = ({ready: "text-success", failed: "text-danger", canceled: "text-muted"} as Record<string, string>)[d.status];
    return <span class={cls} title={d.error || undefined}>{label}</span>;
}

function ProblemsCell({d}: {d: Dataset}) {
    if (!d.analyzed) return null;
    if (!d.errors && !d.warnings) return <span class="text-success"><Check/> None</span>;
    return (<>
        {d.errors ? <span class="badge danger" title="Errors">{d.errors}</span> : null}
        {d.errors && d.warnings ? " " : null}
        {d.warnings ? <span class="badge warning" title="Warnings">{d.warnings}</span> : null}
    </>);
}

// Ready of all its conversions, as 2/3
function ConversionsCell({d}: {d: Dataset}) {
    if (!d.conversion_count) return null;
    const ready = d.conversions_ready || 0;
    return (<span class={ready === d.conversion_count ? "text-success" : undefined}
                  title={count(ready, "dataset", "datasets") + " ready of " + d.conversion_count}>
        {ready}/{d.conversion_count}</span>);
}

interface RowProps {
    d: Dataset; publicUrl: string; rename: () => void; analyze: () => void; move: () => void; remove: () => void;
}

function Row({d, publicUrl, rename, analyze, move, remove}: RowProps) {
    return (
        <tr data-id={d.id}>
            <td><a href={publicUrl + "dataset/" + d.id}>{d.name || "(untitled)"}</a>
                {d.source === "folder" && <> <Folder class="icon text-muted"
                    title={d.folder ? "Read in place from " + d.folder : "Read in place from a folder"}/></>}</td>
            <td><StatusCell d={d}/></td>
            <td>{filesCell(d)}</td>
            <td><ProblemsCell d={d}/></td>
            <td><ConversionsCell d={d}/></td>
            <td>{d.finding_count || ""}</td>
            <td>{formatBytes(d.size)}</td>
            <td>{formatDate(d.last_activity)}</td>
            <td>{formatDate(d.created_at)}</td>
            <td class="actions">
                <button type="button" class="icon-button rename" title="Rename" aria-label="Rename"
                        onClick={rename}><Pencil/></button>
                {d.status !== "analyzing" && (
                    <button type="button" class="icon-button analyze" title="Analyze again" aria-label="Analyze again"
                            onClick={analyze}><Refresh/></button>)}
                <button type="button" class="icon-button move" title="Move to another project"
                        aria-label="Move to another project" onClick={move}><MoveTo/></button>
                <button type="button" class="icon-button delete" title="Delete" aria-label="Delete"
                        onClick={remove}><Trash/></button>
            </td>
        </tr>
    );
}

interface Props {
    api: string;
    publicUrl: string;
    project: number;                            // the project whose datasets are listed
    top?: ComponentChildren;                    // what the page shows above them
    onChange?: () => void;                      // a dataset changed (made, analyzed, moved, deleted)
    nav?: (url: string) => void;
}

export function DatasetsPage({api, publicUrl, project, top, onChange, nav = (url) => { location.href = url; }}: Props) {
    const [datasets, setDatasets] = useState<Dataset[] | null>(null);       // null until first loaded
    const [notice, setNotice] = useState("");
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState({key: "created", desc: true});
    const [open, setOpen] = useState(false);
    const [dropped, setDropped] = useState<{files: File[]} | null>(null);
    const [hint, setHint] = useState(false);
    const stage = useRef<Stage>("idle");
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const dragDepth = useRef(0);

    async function load() {
        clearTimeout(timer.current);
        try {
            const res = await fetch(api + "datasets?project=" + project, {credentials: "same-origin"});
            const list: Dataset[] = (await res.json()).datasets;
            setDatasets(list);
            onChange?.();
            if (list.some((d) => d.status === "analyzing" || d.busy)) timer.current = setTimeout(load, POLL_MS);
        } catch {
            setNotice("Could not load the flights.");
        }
    }

    useEffect(() => {
        load();
        return () => clearTimeout(timer.current);
    }, []);

    async function rename(d: Dataset) {
        const name = await askName("Rename flight", d.name);
        if (!name) return;
        const r = await readJson(await sendJson(api + "datasets/" + d.id, "PATCH", {name}));
        setNotice(r.ok ? "" : errorText(r.data, "Could not rename the flight."));
        load();
    }

    async function analyze(d: Dataset) {
        const r = await readJson(await sendJson(api + "datasets/" + d.id + "/analyze", "POST", {}));
        setNotice(r.ok ? "" : errorText(r.data, "Could not start the analysis."));
        load();
    }

    async function move(d: Dataset) {
        let projects: {id: number; name: string}[];
        try {
            projects = (await (await fetch(api + "projects", {credentials: "same-origin"})).json()).projects;
        } catch {
            return setNotice("Could not load the projects.");
        }
        const others = projects.filter((p) => p.id !== project);
        if (!others.length) {
            await dialog({title: "Move flight", text: "There is no other project to move it to. Make one on the " +
                                                        "Projects page first."});
            return;
        }
        let to = others[0].id;
        const r = await dialog({
            title: "Move flight", text: "Move “" + d.name + "”, with its datasets and measurements, to:",
            body: <div class="field"><select id="move-to" aria-label="Project"
                                             onChange={(e) => { to = Number(e.currentTarget.value); }}>
                {others.map((p) => <option value={p.id}>{p.name}</option>)}</select></div>,
            buttons: [{label: "Cancel", value: false}, {label: "Move", value: true, style: "primary"}],
        });
        if (r.button !== true) return;
        const res = await readJson(await sendJson(api + "datasets/" + d.id, "PATCH", {project: to}));
        setNotice(res.ok ? "" : errorText(res.data, "Could not move the flight."));
        load();
    }

    async function remove(d: Dataset) {
        if (!await ask("Delete flight", deleteText(d), "Delete", "danger")) return;
        const r = await readJson(await sendJson(api + "datasets/" + d.id, "DELETE"));
        setNotice(r.ok ? "" : errorText(r.data, "Could not delete the flight."));
        load();
    }

    // Names start A to Z; numbers and dates largest or newest first
    function sortBy(key: string) {
        setSort(key === sort.key ? {key, desc: !sort.desc} : {key, desc: key !== "name" && key !== "status"});
    }

    function openNew() {
        stage.current = "idle";
        setDropped(null);
        setOpen(true);
    }

    // Images (or their folder) dropped anywhere on the page open New Dataset with them chosen
    const accepts = (e: DragEvent) =>
        Array.from(e.dataTransfer?.types || []).includes("Files") && (!open || stage.current === "idle");

    function onDragEnter(e: DragEvent) {
        if (!accepts(e)) return;
        e.preventDefault();
        dragDepth.current++;
        setHint(true);
    }

    function onDragOver(e: DragEvent) {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer!.dropEffect = "copy";
    }

    function onDragLeave() {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setHint(false);
    }

    async function onDrop(e: DragEvent) {
        dragDepth.current = 0;
        setHint(false);
        if (!accepts(e)) return;
        e.preventDefault();
        const files = await droppedFiles(e.dataTransfer!);
        if (open && stage.current !== "idle") return;
        setOpen(true);
        setDropped({files});
    }

    const shown = (datasets || []).filter((d) => matchesSearch(d, query.trim()));
    const message = datasets === null ? (notice ? "" : "Loading…") :
        !datasets.length ? "No flights in this project yet. Use New Flight to analyze a flight's thermal images." :
        !shown.length ? "No flights match the search." : "";

    return (
        <div class="page datasets" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave}
             onDrop={onDrop}>
            {top}
            <div class="page-header">
                <h2>Flights</h2>
                <div class="page-actions">
                    <SearchBox id="search" label="Search flights" query={query} setQuery={setQuery}/>
                    <button type="button" class="button primary" id="new-dataset-button" onClick={openNew}>
                        <Plus/> New Flight</button>
                </div>
            </div>

            {notice && <div class="notice error" role="alert">{notice}</div>}
            {message && <div class="message" id="message">{message}</div>}

            {shown.length > 0 && (
                <div class="table-scroll">
                    <table class="table" id="datasets">
                        <thead><tr>
                            {COLUMNS.map((c) => {
                                const on = c.key === sort.key;
                                return (
                                    <th data-sort={c.key} title={c.title}
                                        aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
                                        <button type="button" class="sort" onClick={() => sortBy(c.key)}>
                                            {c.label}{on && " "}
                                            {on && (sort.desc ? <CaretDown class="icon sort-icon down"/> :
                                                <CaretUp class="icon sort-icon up"/>)}
                                        </button>
                                    </th>
                                );
                            })}
                            <th><span class="sr-only">Actions</span></th>
                        </tr></thead>
                        <tbody>
                            {sortDatasets(shown, sort.key, sort.desc).map((d) => (
                                <Row key={d.id} d={d} publicUrl={publicUrl} rename={() => rename(d)}
                                     analyze={() => analyze(d)} move={() => move(d)} remove={() => remove(d)}/>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {hint && <div class="drop-hint" id="drop-hint"><Images/> Drop the images or their folder to make a new
                flight</div>}

            {open && <NewDataset api={api} publicUrl={publicUrl} project={project} nav={nav} dropped={dropped}
                                 onStage={(s) => { stage.current = s; }}
                                 onClose={() => setOpen(false)} onError={setNotice} load={load}/>}
        </div>
    );
}

