// The dataset page's figures and its Files, Problems and WebODM plan tabs, drawn from the analysis
import {useState} from "preact/hooks";
import {type FlightZone, formatBytes, formatCapture, formatCaptureRange, formatDate, fileKind, formatNumber, kindLabel, severityLabel,
        zoneText} from "../core/format";
import {formatTemp} from "../core/units";
import {isImage} from "../core/upload";
import {CaretDown, CaretUp, Check, Copy, Info, Lightbulb, Wand} from "../components/icons";
import {type Analysis, type FileColumn, FILE_COLUMNS, type FileRow, fileRows, type FilesView, flagsByFile,
        overview, type PlanOption} from "./files";

const FILES_SHOWN = 12;     // files listed under a problem before "and N more"
const THUMBS_KEY = "thermalAnalyzer.thumbnails";     // the Files tab's Thumbnails box, remembered per browser

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
    const others = [o.visual ? o.visual + " visual" : "", o.other ? o.other + " other file(s)" : ""].filter(Boolean);
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
    if (col.key === "distance") {
        return formatNumber(v as number, 1, " m") + (row.lrf !== null && row.lrf !== undefined ? " / " + formatNumber(row.lrf, 1, " m") : "");
    }
    if (col.temperature) return formatTemp(v as number, "C", col.digits);
    if (col.digits !== undefined) return formatNumber(v as number, col.digits, col.unit);
    return v === null || v === undefined ? "" : String(v);
}

function storedThumbs(): boolean {
    try { return localStorage.getItem(THUMBS_KEY) === "1"; } catch { return false; }
}

interface FilesProps {
    analysis: Analysis;
    view: FilesView;
    setView: (v: FilesView) => void;
    frames: string | null;      // the frame page of the newest ready conversion, which the thermal rows open
    thumbs: string;             // the thumbnail URL, the file's name appended
    zone?: FlightZone | null;   // the time zone the capture times are in
}

// The Files tab: all files, the thermal frames or those with problems, filtered by name and sorted by any column
export function FilesTab({analysis, view, setView, frames, thumbs, zone}: FilesProps) {
    const [showThumbs, setShowThumbs] = useState(storedThumbs);
    const flags = flagsByFile(analysis.findings);
    const rows = fileRows(analysis, view);
    const shows: [FilesView["show"], string][] = [["all", "All files"], ["thermal", "Thermal frames"], ["flagged", "With problems"]];

    function toggleThumbs(on: boolean) {
        setShowThumbs(on);
        try { localStorage.setItem(THUMBS_KEY, on ? "1" : "0"); } catch { /* not remembered */ }
    }

    function sortBy(key: string) {
        setView({...view, sort: key, desc: key === view.sort ? !view.desc : false});
    }

    return (<div class="files-tab">
        <div class="files-bar">
            {shows.map(([value, label]) => (
                <label key={value}><input type="radio" name="files-show" value={value} checked={view.show === value}
                                          onChange={() => setView({...view, show: value})}/> {label}</label>))}
            <input type="search" class="files-filter" placeholder="Filter by name" aria-label="Filter by name"
                   value={view.filter} onInput={(e) => setView({...view, filter: e.currentTarget.value})}/>
            <label><input type="checkbox" class="files-thumbs" checked={showThumbs}
                          onChange={(e) => toggleThumbs(e.currentTarget.checked)}/> Thumbnails</label>
            <span class="text-muted files-shown">{rows.length} shown</span>
        </div>
        {!frames && <p class="text-muted files-hint"><Info/> Convert the images (on the Convert tab) to open each frame from
            here.</p>}
        <div class="table-scroll">
            <table class={"table files" + (frames ? " linked" : "")}>
                <thead><tr>
                    {showThumbs && <th><span class="sr-only">Thumbnail</span></th>}
                    {FILE_COLUMNS.map((c) => {
                        const on = (view.sort || "path") === c.key;
                        const time = c.key === "time";
                        return (<th key={c.key} data-sort={c.key} title={time ? zone?.reason || "The flight's local time" : c.title}
                                    aria-sort={on ? (view.desc ? "descending" : "ascending") : "none"}>
                            <button type="button" class="sort" onClick={() => sortBy(c.key)}>
                                {time ? c.label + " (" + zoneText(zone) + ")" : c.label}{on && " "}
                                {on && (view.desc ? <CaretDown class="icon sort-icon down"/> : <CaretUp class="icon sort-icon up"/>)}
                            </button></th>);
                    })}
                    <th>Notes</th>
                </tr></thead>
                <tbody>
                    {rows.map((r) => {
                        const href = frames && r.kind === "thermal" ? frames + "?frame=" + encodeURIComponent(r.path) : null;
                        const kind = fileKind(r);
                        return (<tr key={r.path} class={"kind-" + kind}>
                            {showThumbs && <td class="thumb">{isImage({name: r.path} as File) &&
                                <img loading="lazy" alt="" src={thumbs + encodeURIComponent(r.path)}/>}</td>}
                            {FILE_COLUMNS.map((c) => (<td key={c.key}>
                                {href && c.key === "path" ? <a href={href} title="Open the frame">{cell(r, c)}</a> : cell(r, c)}</td>))}
                            <td>
                                {(flags[r.path] || []).map((f) => (<><span class={"badge " + (SEVERITY_CLASSES[f.severity] || "")}
                                                                          title={f.message}>{f.code}</span> </>))}
                                {kind !== "thermal" && kind !== "visual" && r.reason && <span class="text-muted">{r.reason} </span>}
                                {(r.warnings || []).map((w) => <span class="text-warning">{w} </span>)}
                            </td>
                        </tr>);
                    })}
                </tbody>
            </table>
        </div>
    </div>);
}

// The Problems tab: the findings, most severe first, each with what addresses it and the files it names (each opening
// the Files tab filtered to it, when showFile is given: the report lists them only)
export function ProblemsTab({analysis, showFile}: {analysis: Analysis; showFile?: (path: string) => void}) {
    const findings = analysis.findings || [];
    if (!findings.length) {
        return <p class="text-success none"><Check/> dji-thermal-cli found no problems in this flight.</p>;
    }
    return (<div class="problems-tab">
        {findings.map((f) => {
            const cls = SEVERITY_CLASSES[f.severity] || "";
            const files = f.files || [];
            return (<div class={"finding " + cls}>
                <div><span class={"badge " + cls}>{severityLabel(f.severity)}</span> {f.message}</div>
                {f.suggestion && <div class="suggestion"><Lightbulb/> {f.suggestion}</div>}
                {files.length > 0 && <div class="finding-files">
                    {files.slice(0, FILES_SHOWN).map((p) => (<>{showFile ? <a href="#files" title="Show it on the Files tab"
                        onClick={(e) => { e.preventDefault(); showFile(p); }}><code>{p}</code></a> : <code>{p}</code>} </>))}
                    {files.length > FILES_SHOWN && <span class="text-muted">and {files.length - FILES_SHOWN} more</span>}
                </div>}
                <div class="finding-code">{f.code}</div>
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
// (Convert with these opens the Convert tab with the plan's settings)
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
                title="Open the Convert tab with these settings" onClick={convert}><Wand/> Convert with these</button></>}</p>
        <div class="command-row"><pre class="command">{p.process_command || ""}</pre>
            {p.process_command && <CopyButton what="the command" text={p.process_command}/>}</div>
        {(p.notes || []).length > 0 && <><h2>Notes</h2><ul>{p.notes!.map((n) => <li>{n}</li>)}</ul></>}
    </div>);
}
