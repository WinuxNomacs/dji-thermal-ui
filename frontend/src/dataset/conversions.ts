// A dataset's conversions as the Datasets tab lists them: their status, figures, results and the links that start one
import {count, formatBytes, formatDate, type Maybe, type Stage} from "../core/format";
import {MEASUREMENTS, type Settings} from "./settings";
import {type Dsm, type Orthophoto, type WebODMTask} from "./webodm";

export interface Conversion {
    id: number;
    name: string;
    settings: Settings;
    description?: string;
    status: string;
    progress?: number | null;
    error?: string | null;
    converted?: number;
    skipped?: number;
    mosaic_status?: string | null;
    mosaic_progress?: number | null;
    stage?: Maybe<Stage>;
    mosaic_error?: string | null;
    mosaic_files?: string[];
    file_count?: number;
    size?: number;
    created_at?: string;
    finished_at?: string | null;
    webodm_tasks?: WebODMTask[];
    orthophoto?: Orthophoto | null;
    dsm?: Dsm | null;
    mosaics_dsm?: {task_name: string; height_cell: number} | null;    // the DSM the mosaics were built on
    mosaics_gsd_m?: number | null;
}

export interface ResultFile {
    path: string; ok: boolean; reason?: string | null; outputs?: string[]; notes?: string[];
    distance?: number | null; distance_source?: string | null;
}

export interface Normalization {
    ambient_c: number; reflected_c: number; frames: number; offset_min?: number | null; offset_max?: number | null;
    without_offset?: number;
}

export interface Detail extends Conversion {results?: {files?: ResultFile[]; normalization?: Normalization | null}}

export const RESULTS_SHOWN = 500;     // result rows shown before "and N more"

const STATUS_LABELS: Record<string, string> = {converting: "Converting", ready: "Converted", failed: "Failed", canceled: "Canceled"};
const BADGES: Record<string, string> = {ready: "success", failed: "danger", canceled: "", converting: "info"};

export function conversionLabel(c: Conversion): string {
    const label = STATUS_LABELS[c.status] || c.status;
    return c.status === "converting" && c.progress ? label + " " + Math.round(c.progress * 100) + "%" : label;
}

export function badgeClass(c: Conversion): string { return "badge " + (BADGES[c.status] ?? ""); }

export function isBusy(c: Conversion): boolean { return c.status === "converting" || c.mosaic_status === "building"; }

// A card's figures: what was converted, its files and when
export function figures(c: Conversion): string[] {
    const out: string[] = [];
    if (c.converted || c.skipped) out.push(c.converted + " converted" + (c.skipped ? ", " + c.skipped + " skipped" : ""));
    if (c.file_count) out.push(count(c.file_count, "file", "files") + ", " + formatBytes(c.size));
    out.push(formatDate(c.finished_at || c.created_at));
    return out;
}

// Why images were skipped, the most common first: [reason, images]
export function skipReasons(files: ResultFile[]): [string, number][] {
    const counts: Record<string, number> = {};
    files.forEach((f) => {
        if (f.ok) return;
        const r = String(f.reason || "unknown").replace(/\s*\(.*\)\s*$/, "");
        counts[r] = (counts[r] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export interface Prefill {from: number; changes: Record<string, number>}

// A link's request to start from a conversion's settings with some changed ("?from=<id>&emissivity=0.98", from the
// frame page's "New conversion with these"), or null
export function parsePrefill(search: string): Prefill | null {
    const params = new URLSearchParams(search);
    const from = parseInt(params.get("from") || "", 10);
    if (isNaN(from)) return null;
    const changes: Record<string, number> = {};
    [...MEASUREMENTS.map((m) => m.key), "distance"].forEach((k) => {
        const v = params.get(k);
        if (v !== null && v !== "" && !isNaN(Number(v))) changes[k] = Number(v);
    });
    return {from, changes};
}
