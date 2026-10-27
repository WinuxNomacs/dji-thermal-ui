// The app's landing page: the datasets, searched and sorted, kept up to date while one is analyzed or converted;
// New Dataset, also opened by dropping images (or their folder) anywhere on the page
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {count, deleteText, formatBytes, formatDate, statusLabel} from "../core/format";
import {ask, askName} from "../components/dialog";
import {CaretDown, CaretUp, Check, Cog, Folder, Images, Pencil, Plus, Refresh, Trash} from "../components/icons";
import {type Dataset, droppedFiles, filesCell, matchesSearch, sortDatasets} from "./list";
import {NewDataset, type Stage} from "./new-dataset";

const POLL_MS = 3000;

const COLUMNS: {key: string; label: string; title?: string}[] = [
    {key: "name", label: "Name"},
    {key: "status", label: "Status"},
    {key: "files", label: "Files"},
    {key: "problems", label: "Problems"},
    {key: "conversions", label: "Conversions", title: "Conversions ready of all"},
    {key: "size", label: "Size"},
    {key: "activity", label: "Last activity", title: "The latest creation, analysis or conversion"},
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
                  title={count(ready, "conversion", "conversions") + " ready of " + d.conversion_count}>
        {ready}/{d.conversion_count}</span>);
}

interface RowProps {d: Dataset; publicUrl: string; rename: () => void; analyze: () => void; remove: () => void}

function Row({d, publicUrl, rename, analyze, remove}: RowProps) {
    return (
        <tr data-id={d.id}>
            <td><a href={publicUrl + "dataset/" + d.id}>{d.name || "(untitled)"}</a>
                {d.source === "folder" && <> <Folder class="icon text-muted"
                    title={d.folder ? "Read in place from " + d.folder : "Read in place from a folder"}/></>}</td>
            <td><StatusCell d={d}/></td>
            <td>{filesCell(d)}</td>
            <td><ProblemsCell d={d}/></td>
            <td><ConversionsCell d={d}/></td>
            <td>{formatBytes(d.size)}</td>
            <td>{formatDate(d.last_activity)}</td>
            <td>{formatDate(d.created_at)}</td>
            <td class="actions">
                <button type="button" class="icon-button rename" title="Rename" aria-label="Rename"
                        onClick={rename}><Pencil/></button>
                {d.status !== "analyzing" && (
                    <button type="button" class="icon-button analyze" title="Analyze again" aria-label="Analyze again"
                            onClick={analyze}><Refresh/></button>)}
                <button type="button" class="icon-button delete" title="Delete" aria-label="Delete"
                        onClick={remove}><Trash/></button>
            </td>
        </tr>
    );
}

interface Props {
    api: string;
    publicUrl: string;
    nav?: (url: string) => void;
}

export function DatasetsPage({api, publicUrl, nav = (url) => { location.href = url; }}: Props) {
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
            const res = await fetch(api + "datasets", {credentials: "same-origin"});
            const list: Dataset[] = (await res.json()).datasets;
            setDatasets(list);
            if (list.some((d) => d.status === "analyzing" || d.busy)) timer.current = setTimeout(load, POLL_MS);
        } catch {
            setNotice("Could not load the datasets.");
        }
    }

    useEffect(() => {
        load();
        return () => clearTimeout(timer.current);
    }, []);

    async function rename(d: Dataset) {
        const name = await askName("Rename dataset", d.name);
        if (!name) return;
        const r = await readJson(await sendJson(api + "datasets/" + d.id, "PATCH", {name}));
        setNotice(r.ok ? "" : errorText(r.data, "Could not rename the dataset."));
        load();
    }

    async function analyze(d: Dataset) {
        const r = await readJson(await sendJson(api + "datasets/" + d.id + "/analyze", "POST", {}));
        setNotice(r.ok ? "" : errorText(r.data, "Could not start the analysis."));
        load();
    }

    async function remove(d: Dataset) {
        if (!await ask("Delete dataset", deleteText(d), "Delete", "danger")) return;
        const r = await readJson(await sendJson(api + "datasets/" + d.id, "DELETE"));
        setNotice(r.ok ? "" : errorText(r.data, "Could not delete the dataset."));
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
        !datasets.length ? "No datasets yet. Use New Dataset to analyze a flight's thermal images." :
        !shown.length ? "No datasets match the search." : "";

    return (
        <div class="page datasets" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave}
             onDrop={onDrop}>
            <div class="page-header">
                <h1>Datasets</h1>
                <div class="page-actions">
                    <input type="search" id="search" placeholder="Search datasets" aria-label="Search datasets"
                           value={query} onInput={(e) => setQuery(e.currentTarget.value)}/>
                    <button type="button" class="button primary" id="new-dataset-button" onClick={openNew}>
                        <Plus/> New Dataset</button>
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
                                     analyze={() => analyze(d)} remove={() => remove(d)}/>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {hint && <div class="drop-hint" id="drop-hint"><Images/> Drop the images or their folder to make a new
                dataset</div>}

            {open && <NewDataset api={api} publicUrl={publicUrl} nav={nav} dropped={dropped}
                                 onStage={(s) => { stage.current = s; }}
                                 onClose={() => setOpen(false)} onError={setNotice} load={load}/>}
        </div>
    );
}

