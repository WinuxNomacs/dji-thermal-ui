// A dataset's analysis as the pages use it: the figures above the tabs, the Files tab's rows and columns, and the
// conversion a frame opens in
import {FILE_KINDS, fileKind, formatCapture, median} from "../core/format";
import {searchWords} from "../core/search";
import {convertTemp} from "../core/units";

export interface FileRow {
    path: string;
    kind: string;
    reason?: string | null;
    warnings?: string[];
    time?: string | null;
    alt?: number | null;
    pitch?: number | null;
    tmin?: number | null;
    tmax?: number | null;
    tmean?: number | null;
    distance?: number | null;
    lrf?: number | null;
    emissivity?: number | null;
    humidity?: number | null;
    reflection?: number | null;
    ambient?: number | null;
    palette?: string | null;
    lat?: number | null;
    lon?: number | null;
    [key: string]: unknown;
}

export interface Problem {
    code: string;
    severity: string;
    message: string;
    suggestion?: string | null;
    files?: string[];
}

export interface PlanOption {value: unknown; reason: string}

export interface Plan {
    coverage?: {
        frames?: number; gsd_m?: number; area_m2?: number; images_per_point_median?: number;
        area_seen_by_3_or_more_pct?: number; equivalent_overlap_pct?: number;
    };
    recommended?: Record<string, PlanOption>;
    consider?: Record<string, PlanOption>;
    odm_arguments?: string[];
    process_args?: string[];
    process_command?: string;
    notes?: string[];
}

export interface Camera {model?: string; width?: number; height?: number; serial?: string; frames: number}

export interface Analysis {
    files?: FileRow[];
    findings?: Problem[];
    cameras?: Camera[];
    webodm?: Plan | null;
    version?: string;
}

// EXIF's "2026:10:12 18:29:50" as "2026-10-12 18:29:50"
export function captureTime(t: unknown): string { return t ? String(t).replace(/^(\d{4}):(\d{2}):/, "$1-$2-") : ""; }

export interface Overview {
    frames: number; visual: number; videos: number; other: number; tmin?: number; tmax?: number; first?: string; last?: string;
    altitude?: number | null; gps?: number;
}

// The figures above the tabs, from the analysis
export function overview(a: Analysis): Overview {
    const files = a.files || [];
    const thermal = files.filter((f) => f.kind === "thermal");
    const visual = files.filter((f) => fileKind(f) === "visual").length;
    const videos = files.filter((f) => f.kind === "video").length;
    const out: Overview = {frames: thermal.length, visual, videos, other: files.length - thermal.length - visual - videos};
    if (!thermal.length) return out;
    const present = (v: number | null | undefined): v is number => v !== null && v !== undefined;
    const mins = thermal.map((f) => f.tmin).filter(present);
    const maxs = thermal.map((f) => f.tmax).filter(present);
    if (mins.length) out.tmin = Math.min(...mins);
    if (maxs.length) out.tmax = Math.max(...maxs);
    const times = thermal.map((f) => captureTime(f.time)).filter((t) => t).sort();
    if (times.length) { out.first = times[0]; out.last = times[times.length - 1]; }
    out.altitude = median(thermal.map((f) => f.alt));
    out.gps = thermal.filter((f) => present(f.lat)).length;
    return out;
}

// Whether the flight has visual images and no thermal ones: each new dataset is then its visual mosaic alone (as the
// server's thermal_analysis.visual_only)
export function visualOnly(a: Analysis | null | undefined): boolean {
    const files = a?.files || [];
    return files.some((f) => fileKind(f) === "visual") && !files.some((f) => f.kind === "thermal");
}

// The problems each file is named in: {path: [finding, ...]}
export function flagsByFile(findings: Problem[] | undefined): Record<string, Problem[]> {
    const out: Record<string, Problem[]> = {};
    (findings || []).forEach((f) => (f.files || []).forEach((p) => (out[p] = out[p] || []).push(f)));
    return out;
}

export interface FileColumn {key: string; label: string; unit?: string; digits?: number; temperature?: boolean; title?: string}

export const FILE_COLUMNS: FileColumn[] = [
    {key: "path", label: "File"},
    {key: "kind", label: "Kind"},
    {key: "time", label: "Captured"},
    {key: "alt", label: "Height", unit: " m", digits: 1, title: "Above the take-off point"},
    {key: "pitch", label: "Pitch", unit: "°", digits: 1, title: "Gimbal pitch (-90° looks straight down)"},
    {key: "tmin", label: "Min", temperature: true, digits: 1},
    {key: "tmax", label: "Max", temperature: true, digits: 1},
    {key: "tmean", label: "Mean", temperature: true, digits: 1},
    {key: "distance", label: "Distance", unit: " m", digits: 1, title: "Object distance embedded in the image / the rangefinder's"},
    {key: "emissivity", label: "Emissivity", digits: 2},
];

export function sortRows<T extends Record<string, unknown>>(rows: T[], key: string, desc: boolean): T[] {
    return rows.slice().sort((a, b) => {
        const x = a[key], y = b[key];
        const xm = x === null || x === undefined || x === "", ym = y === null || y === undefined || y === "";
        if (xm || ym) return xm === ym ? 0 : (xm ? 1 : -1);    // missing values last either way
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return desc ? -c : c;
    });
}

// The conversion a file row opens its frame in: the ready one finished last (a visual mosaic of its own has no frames)
export function newestReady<T extends {status: string; finished_at?: string | null; visual_only?: boolean}>(
    conversions: T[] | undefined): T | null {
    return (conversions || []).filter((c) => c.status === "ready" && !c.visual_only)
        .sort((a, b) => String(b.finished_at || "").localeCompare(String(a.finished_at || "")))[0] || null;
}

// The Files tab's filter: conditions every row shown matches. A number's are compared in the unit shown (a temperature
// in the user's), its = and ≠ at the digits shown; text matches every word, or none, in any case; a condition still
// being typed (no value) filters nothing, and a row without the value matches no condition on it
export type Op = "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "has" | "not" | "in" | "is";
export interface Condition {key: string; op: Op; value: string | string[] | boolean}
export type ColumnType = "number" | "text" | "kind" | "flag";

// The column only the Files tab has, after Kind: worked out from the problems (filtered as yes or no, shown as their names)
export const FLAG_COLUMNS: FileColumn[] = [
    {key: "problems", label: "Problems", title: "Named by a problem, not readable as a frame, or with a warning"},
];
export const FILES_TAB_COLUMNS: FileColumn[] = [...FILE_COLUMNS.slice(0, 2), ...FLAG_COLUMNS, ...FILE_COLUMNS.slice(2)];

export function columnType(key: string): ColumnType {
    if (key === "kind") return "kind";
    if (FLAG_COLUMNS.some((c) => c.key === key)) return "flag";
    const col = FILE_COLUMNS.find((c) => c.key === key);
    return col && col.digits !== undefined ? "number" : "text";
}

export const OPS: Record<ColumnType, [Op, string][]> = {
    number: [["eq", "="], ["ne", "≠"], ["lt", "<"], ["le", "≤"], ["gt", ">"], ["ge", "≥"]],
    text: [["has", "contains"], ["not", "does not contain"]],
    kind: [["in", "is one of"]],
    flag: [["is", "is"]],
};

// A new condition on a column: what it starts as when chosen
export function newCondition(key: string): Condition {
    const type = columnType(key);
    return {key, op: OPS[type][0][0], value: type === "kind" ? [] : type === "flag" ? true : ""};
}

// What the three buttons start from
export type Show = "all" | "thermal" | "flagged";
export const SHOWS: [Show, string, Condition[]][] = [
    ["all", "All files", []],
    ["thermal", "Thermal frames", [{key: "kind", op: "in", value: ["thermal"]}]],
    ["flagged", "With problems", [{key: "problems", op: "is", value: true}]],
];

// The button whose filter is exactly the one set (conditions still being typed aside), if any
export function shownAs(filters: Condition[]): Show | null {
    const text = JSON.stringify(filters.filter(active));
    return SHOWS.find(([, , f]) => JSON.stringify(f) === text)?.[0] || null;
}

export interface FilesView {filters: Condition[]; sort: string; desc: boolean}

// Whether a file has problems, which the Files tab works out
export function flagged(f: FileRow, flags: Record<string, Problem[]>): boolean {
    return !!flags[f.path] || !["thermal", "not_thermal", "video"].includes(f.kind) || !!f.reason && f.kind === "video" ||
        !!(f.warnings || []).length;
}


// Whether a condition is set enough to filter: a value typed (a number for a number's), kinds chosen or not
export function active(c: Condition): boolean {
    const type = columnType(c.key);
    if (type === "kind" || type === "flag") return true;
    if (type === "number") return c.value !== "" && !isNaN(Number(c.value));
    return searchWords(c.value).length > 0;
}

export function matches(row: FileRow, c: Condition): boolean {
    if (!active(c)) return true;
    const type = columnType(c.key);
    if (type === "kind") return (c.value as string[]).includes(fileKind(row));
    if (type === "flag") return !!row[c.key] === c.value;
    if (type === "text") {
        const v = row[c.key];
        if (v === null || v === undefined || v === "") return false;
        // A capture time as written and as shown: "2026-10-12 18:29" or the locale's
        const text = (c.key === "time" ? captureTime(v) + " " + formatCapture(v as string) : String(v)).toLowerCase(), found = searchWords(c.value).map((w) => text.includes(w));
        return c.op === "not" ? !found.some(Boolean) : found.every(Boolean);
    }
    const raw = row[c.key];
    if (raw === null || raw === undefined || raw === "" || isNaN(Number(raw))) return false;
    const col = FILE_COLUMNS.find((k) => k.key === c.key)!;
    let v = Number(col.temperature ? convertTemp(Number(raw), "C") : raw);
    const want = Number(c.value);
    if (c.op === "eq" || c.op === "ne") v = Number(v.toFixed(col.digits));
    return {eq: v === want, ne: v !== want, lt: v < want, le: v <= want, gt: v > want, ge: v >= want}[c.op as "eq"];
}

// The Files tab's rows, with their worked-out columns: those matching every condition, sorted
export function fileRows(a: Analysis, view: FilesView): FileRow[] {
    const flags = flagsByFile(a.findings);
    const rows = (a.files || []).map((f) => ({...f, problems: flagged(f, flags)}))
        .filter((f) => view.filters.every((c) => matches(f, c)));
    return sortRows(rows, view.sort || "path", !!view.desc);
}

// A filter saved under a name (api/file-filters), shared by every flight; its conditions as filterQuery() has them
export interface Favourite {name: string; filters: string[]}

// The filter in a link: ?filter=alt.le.20&filter=kind.in.thermal,visual&filter=problems.is.yes&filter=path.has.roof
export function filterQuery(filters: Condition[]): string[] {
    return filters.map((c) => c.key + "." + c.op + "." +
        (Array.isArray(c.value) ? c.value.join(",") : typeof c.value === "boolean" ? (c.value ? "yes" : "no") : c.value));
}

export function parseFilters(search: string): Condition[] {
    return filtersFrom(new URLSearchParams(search).getAll("filter"));
}

// Conditions as a link or a favourite has them, those of columns or comparisons not known dropped
export function filtersFrom(list: string[]): Condition[] {
    return list.flatMap((f) => {
        const [key, op, ...rest] = f.split(".");
        // The "Thermal frame" column's, before Kind said it alone
        if (key === "thermal_frame" && op === "is")
            return [{key: "kind", op: "in" as Op, value: rest.join(".") === "no" ? FILE_KINDS.filter((k) => k !== "thermal") : ["thermal"]}];
        const value = rest.join("."), type = columnType(key);
        const known = FILES_TAB_COLUMNS.some((c) => c.key === key) && OPS[type].some(([o]) => o === op);
        if (!known) return [];
        return [{key, op: op as Op,
                 value: type === "kind" ? value.split(",").filter(Boolean) : type === "flag" ? value !== "no" : value}];
    });
}
