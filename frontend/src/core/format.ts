// How the pages show things: numbers, sizes, dates, a dataset's status, a job's stage. Plain functions, no DOM.

const STATUS_LABELS: Record<string, string> = {
    new: "Not analyzed", analyzing: "Analyzing", ready: "Analyzed", failed: "Failed", canceled: "Canceled",
};
const SEVERITY_LABELS: Record<string, string> = {error: "Error", warning: "Warning", info: "Note"};
const KIND_LABELS: Record<string, string> = {
    thermal: "Thermal", not_thermal: "Not thermal", not_jpeg: "Not a JPEG", corrupt: "Damaged",
    unreadable: "Unreadable", unsupported: "Unsupported camera",
};

export type Maybe<T> = T | null | undefined;

export function escapeHtml(t: unknown): string {
    return String(t === null || t === undefined ? "" : t).replace(/[&<>"']/g, (c) =>
        ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c] as string);
}

export function formatBytes(n: Maybe<number>): string {
    if (n === null || n === undefined || isNaN(n)) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? String(n) : n.toFixed(n < 10 ? 1 : 0)) + " " + units[i];
}

// The locale dates and times are shown in (the preferences', given to the page in its settings): "" for the computer's
let locale = "";

export function userLocale(): string { return locale; }
export function setUserLocale(l: unknown): void {
    locale = "";
    if (typeof l !== "string" || !l) return;
    try {
        locale = Intl.DateTimeFormat.supportedLocalesOf(l).length ? l : "";
    } catch { /* not a locale: the computer's */ }
}
const inLocale = () => locale || undefined;

// When the app did something (made, changed, analyzed): in the computer's time, in the user's locale
export function formatDate(iso: Maybe<string>): string {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleString(inLocale());
}

// The time zone a dataset was flown in, as the API finds it from its frames' two clocks: {offset} in minutes east of
// UTC, or none with the reason
export interface FlightZone {offset: number | null; reason?: string}

// "UTC−5", "UTC+5:30", "UTC"
export function zoneLabel(offset: number): string {
    if (!offset) return "UTC";
    const m = Math.abs(offset);
    return "UTC" + (offset < 0 ? "−" : "+") + Math.floor(m / 60) + (m % 60 ? ":" + String(m % 60).padStart(2, "0") : "");
}

// What a flight's times are labelled with: its time zone, or that it is not known
export function zoneText(zone: Maybe<FlightZone>): string {
    return zone && zone.offset !== null && zone.offset !== undefined ? zoneLabel(zone.offset) : "time zone unknown";
}

// A time as a frame records it ("2026:10:22 16:34:57", the flight's local time), as a Date whose UTC fields hold it
function recorded(t: Maybe<string>): Date | null {
    const m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?/.exec(t || "");
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : null;
}

// When a frame was captured, in the flight's local time and the user's locale (or the one given; "" when not
// recorded, as recorded when it is not a date and time); part: the date and time, or one of them
export function formatCapture(t: Maybe<string>, part: "both" | "date" | "time" = "both", inTag = inLocale()): string {
    const d = recorded(t);
    if (!d) return t ? String(t) : "";
    const opts: Intl.DateTimeFormatOptions = {timeZone: "UTC"};
    if (part === "date") return d.toLocaleDateString(inTag, opts);
    if (part === "time") return d.toLocaleTimeString(inTag, opts);
    return d.toLocaleString(inTag, opts);
}

// When a flight's frames were captured, first to last: "22/10/2026, 16:34:57 to 16:58:10" (the date once when it is
// the same), "" when none is recorded
export function formatCaptureRange(first: Maybe<string>, last: Maybe<string>): string {
    const a = recorded(first), b = recorded(last);
    if (!a) return "";
    if (!b || a.getTime() === b.getTime()) return formatCapture(first);
    return formatCapture(first) + " to " + formatCapture(last, a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10) ? "time" : "both");
}

export function formatNumber(v: Maybe<number | string>, digits: number, unit?: string): string {
    if (v === null || v === undefined || isNaN(Number(v))) return "";
    return Number(v).toFixed(digits) + (unit || "");
}

export function count(n: number, one: string, many: string): string {
    return n + " " + (n === 1 ? one : many);
}

export function median(values: Maybe<number>[]): number | null {
    const v = values.filter((x): x is number => x !== null && x !== undefined && !isNaN(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export interface StatusOf {status: string; progress?: number | null; analyzed?: boolean}

export function statusLabel(d: StatusOf): string {
    let label = STATUS_LABELS[d.status] || d.status;
    if (d.status === "analyzing") label += " " + Math.round((d.progress || 0) * 100) + "%";
    if (d.status === "new" && d.analyzed) label = "Images changed: analyze again";
    return label;
}

export function severityLabel(s: string): string { return SEVERITY_LABELS[s] || s; }
export function kindLabel(k: string): string { return KIND_LABELS[k] || k; }

// A normalization's or a mosaic's stage, as the jobs save it from dji-thermal-cli's "mosaic" events:
// "step 2 of 5, aligning (round 2/3), 812/1840 pairs"; "" before the first
export interface Stage {
    stage?: string; step?: number; steps?: number; round?: number; rounds?: number;
    done?: number; total?: number; unit?: string;
}

const STAGES: Record<string, string> = {
    ambient: "reading ambient temperatures", frames: "reading frames", align: "aligning",
    composite: "compositing", check: "checking alignment", write: "writing",
};

export function stageText(s: Maybe<Stage>): string {
    if (!s || !s.stage) return "";
    return "step " + s.step + " of " + s.steps + ", " + (STAGES[s.stage] || s.stage) +
        (s.round ? " (round " + s.round + "/" + s.rounds + ")" : "") + ", " + s.done + "/" + s.total + " " + s.unit;
}

// A conversion's mosaics being built (both from one layout) and their stage
export function mosaicLabel(c: {stage?: Maybe<Stage>}): string {
    const stage = stageText(c.stage);
    return "Building the mosaics" + (stage ? ": " + stage : "") + "…";
}

export interface DeleteOf {
    name: string; source?: string; folder?: string | null; file_count?: number;
    conversion_count?: number; mosaic_count?: number; measurement_count?: number; finding_count?: number;
}

// What deleting a dataset (a summary of it, or its detail) takes with it, paragraph by paragraph
export function deleteText(d: DeleteOf): string[] {
    const out = [d.source === "folder" ? "“" + d.name + "” is deleted from the Thermal Analyzer. Its server folder" +
        (d.folder ? " (" + d.folder + ")" : "") + " is left as it is." :
        "“" + d.name + "” and its " + count(d.file_count || 0, "image", "images") + " are deleted."];
    const with_: string[] = [];
    if (d.conversion_count) with_.push(count(d.conversion_count, "conversion", "conversions"));
    if (d.mosaic_count) with_.push(count(d.mosaic_count, "mosaic", "mosaics"));
    if (d.measurement_count) with_.push(count(d.measurement_count, "measurement", "measurements"));
    if (d.finding_count) with_.push(count(d.finding_count, "finding", "findings"));
    if (with_.length) {
        out.push("With it: " + with_.slice(0, -1).join(", ") + (with_.length > 1 ? " and " : "") +
            with_[with_.length - 1] + ".");
    }
    out.push("This cannot be undone.");
    return out;
}

// What an upload could not send, naming the first few images
export function failedText(files: File[], shown = 5): string {
    const names = files.slice(0, shown).map((f) => f.webkitRelativePath || f.name);
    const more = files.length - names.length;
    return files.length + (files.length === 1 ? " image" : " images") + " could not be sent: " + names.join(", ") +
        (more ? " and " + more + " more" : "") + ".";
}
