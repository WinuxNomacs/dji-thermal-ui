// A dataset's analysis as the pages use it: the figures above the tabs, the Files tab's rows and columns, and the
// conversion a frame opens in
import {median} from "../core/format";

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
    frames: number; other: number; tmin?: number; tmax?: number; first?: string; last?: string;
    altitude?: number | null; gps?: number;
}

// The figures above the tabs, from the analysis
export function overview(a: Analysis): Overview {
    const files = a.files || [];
    const thermal = files.filter((f) => f.kind === "thermal");
    const out: Overview = {frames: thermal.length, other: files.length - thermal.length};
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

// The conversion a file row opens its frame in: the ready one finished last
export function newestReady<T extends {status: string; finished_at?: string | null}>(conversions: T[] | undefined): T | null {
    return (conversions || []).filter((c) => c.status === "ready")
        .sort((a, b) => String(b.finished_at || "").localeCompare(String(a.finished_at || "")))[0] || null;
}

export interface FilesView {show: "all" | "thermal" | "flagged"; filter: string; sort: string; desc: boolean}

// The Files tab's rows: shown as all / thermal / flagged, filtered by name (every word in the path), sorted
export function fileRows(a: Analysis, view: FilesView): FileRow[] {
    const flags = flagsByFile(a.findings);
    const words = String(view.filter || "").toLowerCase().split(/\s+/).filter((w) => w);
    const rows = (a.files || []).filter((f) => {
        const path = String(f.path).toLowerCase();
        if (!words.every((w) => path.includes(w))) return false;
        if (view.show === "thermal") return f.kind === "thermal";
        if (view.show === "flagged") {
            return !!flags[f.path] || f.kind !== "thermal" && f.kind !== "not_thermal" || !!(f.warnings || []).length;
        }
        return true;
    });
    return sortRows(rows, view.sort || "path", !!view.desc);
}
