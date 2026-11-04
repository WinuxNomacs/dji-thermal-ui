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
    visual_only?: boolean;      // a flight without thermal images: no images converted, its visual mosaic alone
    imported?: Imported | null; // an orthophoto imported from WebODM, not converted here
}

// Where an imported dataset came from (a WebODM task, or a file downloaded from WebODM's page), and what its
// orthophoto holds once read: "thermal" (the viewer's WebODM tab) or "visual" (a visual mosaic)
export interface Imported {
    from: "webodm" | "file"; kind?: "thermal" | "visual" | null; dsm?: boolean;
    url?: string; project?: number; project_name?: string; task?: string; task_name?: string;
    file?: string; dsm_file?: string | null;
    created_at?: string | null; images?: number | null; processing_ms?: number | null;     // kept since J2
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
    if (c.visual_only && !c.imported && c.status === "ready") return "Ready";      // nothing was converted
    const label = c.imported && c.status === "ready" ? "Imported" : c.imported && c.status === "converting" ? "Importing" :
        STATUS_LABELS[c.status] || c.status;
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

// What an import is doing, as the server's stage says: downloading from WebODM, or reading what came
export function importStageText(stage: Maybe<Stage>): string {
    const what = stage?.asset === "dsm" ? "the DSM" : "the orthophoto";
    return stage?.stage === "download" ? "Downloading " + what + " from WebODM…" :
        stage?.stage === "read" ? "Reading " + what + "…" : "Starting…";
}

// An imported dataset's chips: where it came from and what it holds
export function importedChips(i: Imported): string[] {
    return [i.from === "webodm" ? "From WebODM" : "From a file",
            i.from === "webodm" ? [i.project_name, i.task_name].filter(Boolean).join(" › ") : i.file || "",
            i.kind === "thermal" ? "Temperatures" : i.kind === "visual" ? "Colours" : "",
            i.dsm || i.dsm_file ? "DSM" : ""].filter(Boolean);
}

// How long WebODM took, from its milliseconds: "1 h 05 min", "12 min", "40 s"
export function processingText(ms: number | null | undefined): string {
    if (!ms || ms < 0) return "";
    const s = Math.round(ms / 1000);
    if (s < 60) return s + " s";
    const m = Math.round(s / 60);
    return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min";
}

// The WebODM task an imported dataset came from, in WebODM's dashboard (as a task sent from here is linked), or ""
// for one from a file
export function webodmTaskUrl(i: Maybe<Imported>): string {
    if (!i || i.from !== "webodm" || !i.url || i.project === undefined || !i.task) return "";
    return i.url.replace(/\/+$/, "") + "/dashboard/?project_task_open=" + i.project + "&project_task_expanded=" +
        encodeURIComponent(i.task);
}

// Where an imported dataset came from, as its report and the viewer's About list it: the task (when it was made, from
// how many images, how long WebODM took) or the file, and its DSM
export function importedRows(i: Imported): [string, string][] {
    if (i.from !== "webodm") {
        return [["From", "a file, " + (i.file || "")] as [string, string]]
            .concat(i.dsm_file ? [["DSM", "a file, " + i.dsm_file]] : []);
    }
    const rows: [string, string][] = [["From", "WebODM: " + [i.project_name, i.task_name].filter(Boolean).join(" › ")]];
    if (formatDate(i.created_at)) rows.push(["Made in WebODM", formatDate(i.created_at)]);
    if (i.images) rows.push(["Images", String(i.images)]);
    if (processingText(i.processing_ms)) rows.push(["Processed in", processingText(i.processing_ms)]);
    if (i.dsm) rows.push(["DSM", "the task's"]);
    return rows;
}
