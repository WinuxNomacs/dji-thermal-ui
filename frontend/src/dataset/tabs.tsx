// The dataset page's figures and its Files, Problems and WebODM plan tabs, drawn from the analysis
import type {ComponentChildren} from "preact";
import {useCallback, useEffect, useMemo, useRef, useState} from "preact/hooks";
import {count, type FlightZone, formatBytes, formatCapture, formatCaptureRange, formatDate, fileKind, formatNumber, kindLabel, severityLabel,
        zoneText} from "../core/format";
import {formatTemp, unitSymbol, userUnit} from "../core/units";
import {isImage, isVideo} from "../core/upload";
import {errorText, readJson, sendJson} from "../core/api";
import {ask, dialog} from "../components/dialog";
import {useMenu} from "../components/menu";
import {FullSize} from "./full-size";
import {describeProblem, type Fix, shortName} from "./problems";
import {CaretDown, CaretUp, Check, ChevronDown, Copy, Download, Filter, Info, Lightbulb, Plus, Star, Trash, Wand} from "../components/icons";
import {active, type Analysis, columnType, type Condition, type Favourite, type FileColumn, FILES_TAB_COLUMNS, type FileRow,
        fileRows, type FilesView, filterQuery, filtersFrom, flagsByFile, newCondition, type Op, OPS, overview, type PlanOption, type Problem,
        shownAs, SHOWS, visualOnly} from "./files";

const FILES_SHOWN = 12;     // files listed under a problem before "and N more"
const THUMBS_KEY = "thermalAnalyzer.thumbnails";     // the Files tab's Thumbnails box, remembered per browser
const DETAIL_KEY = "thermalAnalyzer.hoverDetail";    // its Hover for detail box, on unless unchecked

const SEVERITY_CLASSES: Record<string, string> = {error: "danger", warning: "warning", info: "info"};

export interface DatasetFigures {
    size?: number | null; analyzed_at?: string | null; analysis?: Analysis | null; flight_zone?: FlightZone | null;
}

export function Figures({items}: {items: [string, string | number | null | undefined][]}) {
    return (<dl class="figures">
        {items.filter((i) => i[1] !== undefined && i[1] !== null && i[1] !== "").map((i) => (
            <div key={i[0]}><dt>{i[0]}</dt><dd>{i[1]}</dd></div>))}
    </dl>);
}

// The figures above the tabs: frames, cameras, temperatures, when and how high
export function Overview({d}: {d: DatasetFigures}) {
    const a = d.analysis || {};
    if (!a.files) return null;
    const o = overview(a);
    const others = [o.visual ? o.visual + " visual" : "", o.videos ? count(o.videos, "video", "videos") : "",
                    o.other ? o.other + " other file(s)" : ""].filter(Boolean);
    const items: [string, string][] = [["Thermal frames", o.frames + (others.length ? " (and " + others.join(", ") + ")" : "")]];
    (a.cameras || []).forEach((c) => items.push(["Camera", (c.model || "?") + (c.width ? " · " + c.width + "×" + c.height : "") +
        (c.serial ? " · " + c.serial : "") + " · " + c.frames + " frame(s)"]));
    if (o.tmin !== undefined) items.push(["Temperatures", formatTemp(o.tmin, "C", 1) + " to " + formatTemp(o.tmax!, "C", 1)]);
    if (o.first) {
        const zone = d.flight_zone;
        items.push(["Captured", formatCaptureRange(o.first, o.last) + " · " + zoneText(zone) +
            (zone && zone.offset === null && zone.reason ? " (" + zone.reason.charAt(0).toLowerCase() + zone.reason.slice(1) + ")" : "")]);
    }
    if (o.altitude !== null && o.altitude !== undefined) items.push(["Height (median)", formatNumber(o.altitude, 1, " m")]);
    if (o.frames) items.push(["With GPS", o.gps + " of " + o.frames]);
    items.push(["Size", formatBytes(d.size)]);
    if (d.analyzed_at) items.push(["Analyzed", formatDate(d.analyzed_at) + (a.version ? " · dji-thermal-cli " + a.version : "")]);
    return <Figures items={items}/>;
}

export function cell(row: FileRow, col: FileColumn): string {
    const v = row[col.key] as number | string | null | undefined;
    if (col.key === "kind") return kindLabel(fileKind(row));
    if (col.key === "time") return formatCapture(v as string);
    if (col.key === "distance") {      // the measurement's distance / the rangefinder's (a visual photo has only that)
        const lrf = row.lrf !== null && row.lrf !== undefined ? formatNumber(row.lrf, 1, " m") : "";
        return v === null || v === undefined ? lrf : formatNumber(v as number, 1, " m") + (lrf ? " / " + lrf : "");
    }
    if (col.temperature) return formatTemp(v as number, "C", col.digits);
    if (col.digits !== undefined) return formatNumber(v as number, col.digits, col.unit);
    return v === null || v === undefined ? "" : String(v);
}

function storedThumbs(): boolean {
    try { return localStorage.getItem(THUMBS_KEY) === "1"; } catch { return false; }
}

function storedDetail(): boolean {
    try { return localStorage.getItem(DETAIL_KEY) !== "0"; } catch { return true; }
}

const pictured = (path: string) => isImage({name: path} as File) || isVideo({name: path} as File);

// A file's problems: each one's short name (its sentence the tooltip), why it is not used, its warnings
function Notes({row, flags, texts}: {row: FileRow; flags: Problem[]; texts: Map<Problem, string>}) {
    const kind = fileKind(row);
    return (<>
        {flags.map((f) => (<><span class={"badge " + (SEVERITY_CLASSES[f.severity] || "")} title={texts.get(f) || f.message}>
            {shortName(f.code)}</span> </>))}
        {kind !== "thermal" && kind !== "visual" && row.reason && <span class="text-muted">{row.reason} </span>}
        {(row.warnings || []).map((w) => <span class="text-warning">{w} </span>)}
    </>);
}

// The detail pane: the file's picture at the pane's width (a video's cover), a button showing it at its own size, and
// its columns
function DetailPane({row, flags, texts, picture, thumb, frame, zone, selected, onClose, onFullSize}: {
    row: FileRow; flags: Problem[]; texts: Map<Problem, string>; picture: string; thumb: string; frame: string | null;
    zone?: FlightZone | null; selected: boolean; onClose: () => void; onFullSize: () => void;
}) {
    return (<aside class={"files-detail" + (selected ? " selected" : "")} aria-label="File details">
        <div class="files-detail-head">
            <strong class="files-detail-name" title={row.path}>{row.path}</strong>
            <button type="button" class="close" title="Close (Esc)" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {pictured(row.path) && <div class="files-detail-picture" style={{backgroundImage: `url("${thumb}")`}}>
            <img key={row.path} alt={row.path} src={picture}/></div>}
        {(pictured(row.path) || frame) && <p class="files-detail-open">
            {pictured(row.path) && <button type="button" class="button default small files-full-size" onClick={onFullSize}>
                Full size</button>}
            {frame && <a href={frame}>Open the frame</a>}</p>}
        <dl class="files-detail-columns">
            {FILES_TAB_COLUMNS.map((c) => (<><dt key={c.key}>{c.key === "time" ? c.label + " (" + zoneText(zone) + ")" : c.label}</dt>
                <dd>{c.key === "problems" ? (row.problems ? <Notes row={row} flags={flags} texts={texts}/> : "None") :
                    cell(row, c) || "–"}</dd></>))}
        </dl>
    </aside>);
}

interface FilesProps {
    api: string;
    onExport?: (shown: string[]) => void;     // the export dialog opened for the thermal frames shown
    analysis: Analysis;
    view: FilesView;
    setView: (v: FilesView) => void;
    frames: string | null;      // the frame page of the newest ready conversion, which the thermal rows open
    thumbs: string;             // the thumbnail URL, the file's name appended
    palette?: string;           // the preferred palette the thermal pictures are coloured with ("": the camera's own)
    zone?: FlightZone | null;   // the time zone the capture times are in
}

// The kinds to choose from, as checkboxes under All: checking All checks every kind and unchecking it unchecks them,
// unchecking a kind unchecks All
function KindPicker({kinds, chosen, choose, label}: {kinds: string[]; chosen: string[]; choose: (k: string[]) => void;
                                                     label: ComponentChildren}) {
    const {open, setOpen, ref} = useMenu();
    const all = kinds.every((k) => chosen.includes(k));

    return (<span class={"menu kind-picker" + (open ? " open" : "")} ref={ref}>
        <button type="button" class="kind-button" aria-haspopup="true" aria-expanded={open} title="Show these kinds"
                onClick={() => setOpen(!open)}>{label}</button>
        {open && <div class="menu-items kind-items">
            <label><input type="checkbox" name="all" checked={all} onChange={() => choose(all ? [] : kinds)}/> All</label>
            {kinds.map((k) => (<label key={k}><input type="checkbox" name={k} checked={chosen.includes(k)}
                onChange={() => choose(chosen.includes(k) ? chosen.filter((c) => c !== k) : kinds.filter((c) => c === k || chosen.includes(c)))}/>
                {" "}{kindLabel(k)}</label>))}
        </div>}
    </span>);
}

// The favourite filters, shared by every flight: choosing one replaces the filter, the filter is saved under a new
// name (never over one saved), and a favourite is deleted
function Favourites({api, filters, setFilters}: {api: string; filters: Condition[]; setFilters: (f: Condition[]) => void}) {
    const {open, setOpen, ref} = useMenu();
    const items = useRef<HTMLUListElement>(null);
    const [saved, setSaved] = useState<Favourite[] | null>(null);
    const [error, setError] = useState("");
    const url = api + "file-filters";
    const current = filterQuery(filters.filter(active));
    // The favourite whose filter is the one shown, as it sets it (with the conditions this page does not know left out)
    const chosen = saved?.find((f) => JSON.stringify(filterQuery(filtersFrom(f.filters))) === JSON.stringify(current));

    useEffect(() => {
        fetch(url, {credentials: "same-origin"}).then(readJson<{filters: Favourite[]}>).then(({ok, data}) => {
            if (ok) setSaved(data.filters || []); else setError("The favourites could not be read.");
        }).catch(() => setError("The favourites could not be read."));
    }, [url]);

    // The menu opens under the button, toward the page's right; where that runs off a narrow page, toward its left
    useEffect(() => {
        const ul = items.current;
        if (ul && ul.getBoundingClientRect().right > document.documentElement.clientWidth) ul.classList.add("flip");
    }, [open, saved]);

    async function save() {
        setOpen(false);
        let name = "", problem = "";
        for (;;) {
            const r = await dialog({title: "Save the filter as a favourite", text: "Every flight's Files tab offers it.",
                                    field: {label: "Name", value: name, error: problem},
                                    buttons: [{label: "Cancel", value: false}, {label: "Save", value: true, style: "primary"}]});
            name = (r.value || "").trim();
            if (r.button !== true || !name) return;
            const res = await sendJson(url, "POST", {name, filters: current});
            const {ok, data} = await readJson<{filters: Favourite[]}>(res);
            if (ok) return setSaved(data.filters);
            problem = res.status === 409 ? "A favourite is already named “" + name + "”: choose another name, or delete it first." :
                errorText(data, "The favourite could not be saved.");
        }
    }

    async function remove(f: Favourite) {
        setOpen(false);
        if (!await ask("Delete the favourite?", "“" + f.name + "” is deleted for every flight. The filter shown is kept.",
                       "Delete", "danger")) return;
        const res = await sendJson(url + "?name=" + encodeURIComponent(f.name), "DELETE");
        const {ok, data} = await readJson<{filters: Favourite[]}>(res);
        if (ok) setSaved(data.filters); else setError(errorText(data, "The favourite could not be deleted."));
    }

    return (<span class={"menu favourites" + (open ? " open" : "")} ref={ref}>
        <button type="button" class="button default small" id="favourites" aria-haspopup="true" aria-expanded={open}
                title={chosen ? "Favourite: " + chosen.name : "Favourite filters"} onClick={() => setOpen(!open)}>
            <Star class={"icon" + (chosen ? " on" : "")}/> {chosen ? chosen.name : "Favourites"} <ChevronDown/></button>
        {open && <ul class="menu-items favourite-items" ref={items}>
            {error && <li class="text-danger menu-note">{error}</li>}
            {saved && !saved.length && <li class="text-muted menu-note">No favourites yet.</li>}
            {(saved || []).map((f) => (<li key={f.name} class="favourite">
                <button type="button" class="favourite-name" aria-current={f === chosen ? "true" : undefined}
                        title={f.filters.join(" · ")} onClick={() => { setOpen(false); setFilters(filtersFrom(f.filters)); }}>
                    <Check class={"icon" + (f === chosen ? "" : " unchosen")}/> {f.name}</button>
                <button type="button" class="favourite-delete" aria-label={"Delete " + f.name} title="Delete"
                        onClick={() => remove(f)}><Trash/></button>
            </li>))}
            <li class="divider" role="separator"></li>
            <li><button type="button" id="save-favourite" disabled={!current.length} onClick={save}
                        title={current.length ? undefined : "Set a filter first"}>Save this filter…</button></li>
        </ul>}
    </span>);
}

function kindsText(kinds: string[], chosen: string[]): string {
    if (kinds.every((k) => chosen.includes(k))) return "All";
    return chosen.length ? kinds.filter((k) => chosen.includes(k)).map(kindLabel).join(", ") : "None";
}

// One condition: its column, how it compares, its value (in the unit shown), and a way to remove it
function ConditionRow({c, kinds, set, remove}: {c: Condition; kinds: string[]; set: (c: Condition) => void; remove: () => void}) {
    const type = columnType(c.key);
    const col = FILES_TAB_COLUMNS.find((k) => k.key === c.key);
    const unit = col?.temperature ? unitSymbol(userUnit()) : (col?.unit || "").trim();
    const ops = OPS[type];
    return (<div class={"filter-row" + (active(c) ? "" : " unset")} data-key={c.key}>
        <select name="column" aria-label="Column" value={c.key} onChange={(e) => set(newCondition(e.currentTarget.value))}>
            {FILES_TAB_COLUMNS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        {ops.length > 1 ? <select name="op" aria-label="Comparison" value={c.op}
                                  onChange={(e) => set({...c, op: e.currentTarget.value as Op})}>
            {ops.map(([o, label]) => <option key={o} value={o}>{label}</option>)}
        </select> : <span class="filter-op">{ops[0][1]}</span>}
        {type === "kind" && <KindPicker kinds={kinds} chosen={c.value as string[]} choose={(v) => set({...c, value: v})}
                                        label={<>{kindsText(kinds, c.value as string[])} <ChevronDown/></>}/>}
        {type === "flag" && <select name="value" aria-label="Value" value={c.value ? "yes" : "no"}
                                    onChange={(e) => set({...c, value: e.currentTarget.value === "yes"})}>
            <option value="yes">yes</option><option value="no">no</option></select>}
        {type === "number" && <input name="value" aria-label="Value" class="filter-value" type="number" step="any"
                                     value={c.value as string} onInput={(e) => set({...c, value: e.currentTarget.value})}/>}
        {type === "text" && <input name="value" aria-label="Value" class="filter-value" type="search" placeholder="words"
                                   value={c.value as string} onInput={(e) => set({...c, value: e.currentTarget.value})}/>}
        {unit && type === "number" && <span class="text-muted">{unit}</span>}
        <button type="button" class="icon-button" title="Remove this filter" aria-label="Remove this filter"
                onClick={remove}>×</button>
    </div>);
}

// The Files tab: the files matching every condition of the filter (none at first: all of them), sorted by any column.
// The buttons start the filter from all files, the thermal frames or those with problems
export function FilesTab({api, onExport, analysis, view, setView, frames, thumbs, palette = "", zone}: FilesProps) {
    const [showThumbs, setShowThumbs] = useState(storedThumbs);
    const [hoverDetail, setHoverDetail] = useState(storedDetail);
    const [selected, setSelected] = useState<string | null>(null);     // the row the pane shows whatever is hovered
    const [hovered, setHovered] = useState<string | null>(null);
    const [closedOn, setClosedOn] = useState<string | null>(null);     // closed on this row: shut until another is hovered
    const [fullSize, setFullSize] = useState<string | null>(null);     // the row shown at its own size, over the page
    const flags = flagsByFile(analysis.findings);
    // Each problem's sentence in the app's words, the tooltip on its name
    const texts = useMemo(() => new Map((analysis.findings || []).map((f) => [f, describeProblem(f, analysis.files || []).message])),
                          [analysis]);
    const rows = fileRows(analysis, view);
    const filters = view.filters;
    const shown = shownAs(filters);
    const kinds = [...new Set((analysis.files || []).map(fileKind))].sort((x, y) => kindLabel(x).localeCompare(kindLabel(y)));
    const kindFilter = filters.find((c) => c.key === "kind");

    const detail = selected ?? (hoverDetail && hovered !== closedOn ? hovered : null);
    const detailRow = detail ? rows.find((r) => r.path === detail) : undefined;
    // A flight of visual photos only: its datasets' frames are the photos
    const framed = (r: FileRow) => r.kind === "thermal" || visualOnly(analysis) && fileKind(r) === "visual";
    const frameOf = (r: FileRow) => frames && framed(r) ? frames + "?frame=" + encodeURIComponent(r.path) : null;
    // A row's picture (a thermal frame's in the preferred palette), at the size asked (the thumbnail's without one)
    const pictureOf = (r: FileRow, size?: "preview" | "full") => thumbs + encodeURIComponent(r.path) +
        (palette && r.kind === "thermal" ? "&palette=" + encodeURIComponent(palette) : "") + (size ? "&size=" + size : "");
    const fullRow = fullSize ? rows.find((r) => r.path === fullSize) : undefined;

    function hover(path: string) {
        if (!hoverDetail) return;
        setHovered(path);
        if (path !== closedOn) setClosedOn(null);
    }

    function select(path: string) { setSelected(selected === path ? null : path); }

    function close() {
        setSelected(null);
        setClosedOn(hovered);
    }

    const closeFullSize = useCallback(() => setFullSize(null), []);

    function toggleDetail(on: boolean) {
        setHoverDetail(on);
        setHovered(null);
        try { localStorage.setItem(DETAIL_KEY, on ? "1" : "0"); } catch { /* not remembered */ }
    }

    // Escape closes the pane as its close button does, unless something nearer used it (a menu, a dialog)
    useEffect(() => {
        if (!detailRow) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) close(); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    });

    function toggleThumbs(on: boolean) {
        setShowThumbs(on);
        try { localStorage.setItem(THUMBS_KEY, on ? "1" : "0"); } catch { /* not remembered */ }
    }

    function sortBy(key: string) {
        setView({...view, sort: key, desc: key === view.sort ? !view.desc : false});
    }

    function setFilters(f: Condition[]) { setView({...view, filters: f}); }

    // The Kind header's checkboxes are the filter's Kind condition: none while every kind is checked
    function chooseKinds(chosen: string[]) {
        const others = filters.filter((c) => c.key !== "kind");
        const all = kinds.every((k) => chosen.includes(k));
        if (all) return setFilters(others);
        const at = kindFilter ? filters.indexOf(kindFilter) : filters.length;
        const c: Condition = {key: "kind", op: "in", value: chosen};
        setFilters(kindFilter ? filters.filter((f) => f.key !== "kind" || f === kindFilter).map((f) => f === kindFilter ? c : f) :
            [...filters.slice(0, at), c]);
    }

    return (<div class="files-tab">
        <div class="files-bar">
            <span class="files-shows" role="group" aria-label="Start the filter from">
                {SHOWS.map(([value, label, f]) => (
                    <label key={value}><input type="radio" name="files-show" value={value} checked={shown === value}
                                              onChange={() => setFilters(f.map((c) => ({...c})))}/> {label}</label>))}
            </span>
            <button type="button" class="button default small" id="add-filter" onClick={() => setFilters([...filters, newCondition("path")])}>
                <Plus/> Add filter</button>
            {filters.length > 0 && <button type="button" class="button default small" id="clear-filters"
                                           onClick={() => setFilters([])}>Clear</button>}
            <Favourites api={api} filters={filters} setFilters={setFilters}/>
            <label><input type="checkbox" class="files-thumbs" checked={showThumbs}
                          onChange={(e) => toggleThumbs(e.currentTarget.checked)}/> Thumbnails</label>
            <label title="Show a file's picture and details beside the list as the pointer passes over its thumbnail or name; click a row to keep it there">
                <input type="checkbox" class="files-hover-detail" checked={hoverDetail}
                       onChange={(e) => toggleDetail(e.currentTarget.checked)}/> Hover for detail</label>
            <span class="text-muted files-shown">{rows.length} shown</span>
            {onExport && <button type="button" class="button default small" id="export-frames"
                                 title="The thermal frames shown, or all of them, as PNG, TIFF, R-JPEG or their originals"
                                 onClick={() => onExport(rows.filter((r) => r.kind === "thermal").map((r) => r.path))}>
                <Download/> Export…</button>}
        </div>
        {filters.length > 0 && <div class="filters" aria-label="Filters">
            {filters.map((c, i) => <ConditionRow key={i} c={c} kinds={kinds}
                set={(n) => setFilters(filters.map((f, j) => j === i ? n : f))}
                remove={() => setFilters(filters.filter((_, j) => j !== i))}/>)}
        </div>}
        {!frames && <p class="text-muted files-hint"><Info/> Convert the images (on the Datasets tab) to open each frame from
            here.</p>}
        <div class="files-body">
        <div class="table-scroll">
            <table class={"table files" + (frames ? " linked" : "")}>
                <thead><tr>
                    {showThumbs && <th><span class="sr-only">Thumbnail</span></th>}
                    {FILES_TAB_COLUMNS.map((c) => {
                        const on = (view.sort || "path") === c.key;
                        const time = c.key === "time";
                        return (<th key={c.key} data-sort={c.key} title={time ? zone?.reason || "The flight's local time" : c.title}
                                    aria-sort={on ? (view.desc ? "descending" : "ascending") : "none"}>
                            <button type="button" class="sort" onClick={() => sortBy(c.key)}>
                                {time ? c.label + " (" + zoneText(zone) + ")" : c.label}{on && " "}
                                {on && (view.desc ? <CaretDown class="icon sort-icon down"/> : <CaretUp class="icon sort-icon up"/>)}
                            </button>
                            {c.key === "kind" && <KindPicker kinds={kinds} chosen={kindFilter ? kindFilter.value as string[] : kinds}
                                choose={chooseKinds} label={<Filter class={"icon" + (kindFilter ? " on" : "")}
                                                                    title={kindFilter ? "Filtered by kind" : "Filter by kind"}/>}/>}
                        </th>);
                    })}
                </tr></thead>
                <tbody>
                    {rows.map((r) => {
                        const href = frameOf(r);
                        // A click on the row (not on its name's link) selects it; on its thumbnail too, from the keyboard
                        return (<tr key={r.path} class={"kind-" + fileKind(r) + (selected === r.path ? " selected" : "")}
                                    onClick={(e) => { if (!(e.target as Element).closest("a, input")) select(r.path); }}>
                            {showThumbs && <td class="thumb" onMouseEnter={() => hover(r.path)}>{pictured(r.path) &&
                                <button type="button" class="thumb-button" aria-pressed={selected === r.path}
                                        aria-label={"Show the details of " + r.path}>
                                    <img loading="lazy" alt="" src={pictureOf(r)}/></button>}</td>}
                            {FILES_TAB_COLUMNS.map((c) => (<td key={c.key} class={c.key === "problems" ? "problems" : undefined}
                                                               onMouseEnter={c.key === "path" ? () => hover(r.path) : undefined}>
                                {c.key === "problems" ? <Notes row={r} flags={flags[r.path] || []} texts={texts}/> :
                                    href && c.key === "path" ? <a href={href} title="Open the frame">{cell(r, c)}</a> : cell(r, c)}</td>))}
                        </tr>);
                    })}
                </tbody>
            </table>
        </div>
        {detailRow && <DetailPane row={detailRow} flags={flags[detailRow.path] || []} texts={texts} frame={frameOf(detailRow)} zone={zone}
            picture={pictureOf(detailRow, "preview")} thumb={pictureOf(detailRow)}
            selected={selected === detailRow.path} onClose={close} onFullSize={() => setFullSize(detailRow.path)}/>}
        </div>
        {fullRow && <FullSize src={pictureOf(fullRow, "full")} name={fullRow.path} onClose={closeFullSize}/>}
    </div>);
}

// The Problems tab: the findings, most severe first, each in the app's words with the files it names (each opening the
// Files tab filtered to it, when showFile is given: the report lists them only) and, when fix is given, a button that
// sets what fixes it in the New dataset form
export function ProblemsTab({analysis, showFile, fix}: {analysis: Analysis; showFile?: (path: string) => void;
                                                       fix?: (f: Fix) => void}) {
    const findings = analysis.findings || [];
    if (!findings.length) {
        return <p class="text-success none"><Check/> dji-thermal-cli found no problems in this flight.</p>;
    }
    return (<div class="problems-tab">
        {findings.map((f) => {
            const cls = SEVERITY_CLASSES[f.severity] || "";
            const files = f.files || [];
            const t = describeProblem(f, analysis.files || []);
            const name = (p: string) => (<><code>{p}</code>{t.values[p] && <span class="finding-value"> {t.values[p]}</span>}</>);
            return (<div class={"finding " + cls}>
                <div><span class={"badge " + cls} title={"dji-thermal-cli's code: " + f.code}>{severityLabel(f.severity)}</span>
                    {" "}{t.message}</div>
                {t.advice && <div class="suggestion"><Lightbulb/> {t.advice}</div>}
                {fix && t.fix && <div class="finding-fix"><button type="button" class="button default small"
                    title="Opens the New dataset form with this set" onClick={() => fix(t.fix!)}><Wand/> {t.fix.label}</button></div>}
                {files.length > 0 && <div class="finding-files">
                    {files.slice(0, FILES_SHOWN).map((p) => (<span class="finding-file">{showFile ? <a href="#files"
                        title="Show it on the Files tab" onClick={(e) => { e.preventDefault(); showFile(p); }}>{name(p)}</a> :
                        name(p)}</span>))}
                    {files.length > FILES_SHOWN && <span class="text-muted">and {files.length - FILES_SHOWN} more</span>}
                </div>}
            </div>);
        })}
    </div>);
}

export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

function CopyButton({what, text}: {what: string; text: string}) {
    const [done, setDone] = useState(false);
    return (<button type="button" class="button default small copy" title={"Copy " + what}
                    onClick={async () => setDone(await copyText(text))}>
        {done ? <Check/> : <Copy/>} {done ? "Copied" : "Copy"}</button>);
}

function OptionsTable({options}: {options?: Record<string, PlanOption>}) {
    const keys = Object.keys(options || {});
    if (!keys.length) return <p class="text-muted">None.</p>;
    return (<table class="table options">
        <thead><tr><th>Option</th><th>Value</th><th>Why</th></tr></thead>
        <tbody>{keys.map((k) => (<tr key={k}><td><code>{k}</code></td><td>{String(options![k].value)}</td>
            <td>{options![k].reason}</td></tr>))}</tbody>
    </table>);
}

// The WebODM plan tab: how well the frames cover the ground, the task options to use and how to prepare the images
// (Convert with these opens the Datasets tab with the plan's settings)
export function PlanTab({analysis, convert}: {analysis: Analysis; convert: () => void}) {
    const p = analysis.webodm;
    if (!p) return <p class="text-muted">No plan: the flight has no thermal frames to plan with.</p>;
    const c = p.coverage || {};
    const args = (p.odm_arguments || []).join(" ");
    return (<div class="plan-tab">
        <h2>Coverage</h2>
        <Figures items={[
            ["Frames used", c.frames],
            ["Ground sample distance", c.gsd_m ? formatNumber(c.gsd_m * 100, 1, " cm/px") : ""],
            ["Area", c.area_m2 ? formatNumber(c.area_m2, 0, " m²") : ""],
            ["Frames per ground point (median)", c.images_per_point_median],
            ["Area seen by 3 or more frames", c.area_seen_by_3_or_more_pct !== undefined ?
                formatNumber(c.area_seen_by_3_or_more_pct, 0, " %") : ""],
            ["Equivalent overlap", c.equivalent_overlap_pct !== undefined ? formatNumber(c.equivalent_overlap_pct, 0, " %") : ""],
        ]}/>
        <h2>Recommended task options</h2>
        <OptionsTable options={p.recommended}/>
        {args && <p class="odm-args"><code>{args}</code> <CopyButton what="the options" text={args}/></p>}
        <h2>To consider</h2>
        <OptionsTable options={p.consider}/>
        <h2>Preparing the images</h2>
        <p>Convert the frames with these settings before processing them.
            {p.process_args && <> <button type="button" class="button primary small" id="plan-convert"
                title="Open the Datasets tab's form with these settings" onClick={convert}><Wand/> Convert with these</button></>}</p>
        <div class="command-row"><pre class="command">{p.process_command || ""}</pre>
            {p.process_command && <CopyButton what="the command" text={p.process_command}/>}</div>
        {(p.notes || []).length > 0 && <><h2>Notes</h2><ul>{p.notes!.map((n) => <li>{n}</li>)}</ul></>}
    </div>);
}
