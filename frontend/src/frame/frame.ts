// A conversion's frames one at a time: the parameters a frame can be measured again with, checked and sent as the API
// takes them, the frames' names, and their values' URL. Plain functions, no DOM; ported from frame.js.
import {type Maybe, formatNumber} from "../core/format";
import {convertTemp} from "../core/units";
import {type Histogram, type ParamField, symbol, typedTemp} from "../measure/measure";
import {type VisualPair} from "../sources/sources";

// The parameters a frame can be measured again with: [field, label, step, in the temperature unit, what the SDK reports
// it as (info.params), the analysis' recorded value]
export const CHANGES: [string, string, string, boolean, string, string][] = [
    ["distance", "Distance (m)", "0.1", false, "distance", "lrf"],
    ["humidity", "Humidity (%)", "1", false, "humidity", "humidity"],
    ["emissivity", "Emissivity", "0.01", false, "emissivity", "emissivity"],
    ["reflected_temp", "Reflected temperature", "0.1", true, "reflection", "reflection"],
    ["ambient_temp", "Ambient temperature", "0.1", true, "ambient_temp", "ambient"],
];
// The parameters a saved measurement can be measured again with
export const PARAM_FIELDS: ParamField[] = CHANGES.map((c) => [c[0], c[1], c[2], c[3]]);
export const DISTANCE_SOURCES: Record<string, string> = {rangefinder: "the rangefinder", embedded: "the embedded value",
                                                         option: "the dataset's"};

export type Changes = Record<string, number>;

export interface FrameEntry {
    path: string;
    pitch?: number | null;
    time?: string | null;
    converted?: boolean;
    mosaic?: number | null;         // its place among the mosaics' frames, null when it is not in them
    lat?: number | null;
    lon?: number | null;
    recorded?: Record<string, Maybe<number>>;
}

export interface FrameStats {min?: number; max?: number; mean?: number; percentiles?: number[]; histogram?: Maybe<Histogram>}

export interface FrameInfo {
    frame: string;
    width: number;
    height: number;
    distance_source?: string;
    notes?: string[];
    offset?: number;
    offset_known?: boolean;
    params?: Record<string, Maybe<number>>;
    stats?: FrameStats;
    changed?: FrameInfo | null;     // measured again with the parameters changed
    visual?: VisualPair | null;     // its visual pair, when the visual mosaic has it
}

const isTemperature = (field: string) => CHANGES.some((c) => c[0] === field && c[3]);

// The changes as the API takes them: the temperatures, typed in the user's unit, in the conversion's (unit)
export function changesIn(changes: Maybe<Changes>, unit: unknown): Changes {
    const out: Changes = {};
    Object.entries(changes || {}).forEach(([k, v]) => { out[k] = isTemperature(k) ? typedTemp(v, unit) : v; });
    return out;
}

export const inMosaics = (f: FrameEntry) => f.mosaic !== null && f.mosaic !== undefined;

// What the explorer says of a frame beside its name, besides what its list already says: in the mosaic, or why the
// mosaics left it out (oblique above their pitch limit, else unusable), and not converted (a conversion with a pitch
// limit skips the oblique ones); nothing to say of the others, nor of where frames are before the mosaics are built
export function frameTag(f: FrameEntry, list: Maybe<string>, maxPitch: Maybe<number>, built: boolean): string {
    const pitch = f.pitch;
    const oblique = pitch !== null && pitch !== undefined && pitch > (maxPitch ?? -80);
    if (!f.converted) return built && oblique ? "oblique, " + formatNumber(pitch, 0, "°") + ", not converted" : "not converted";
    if (!built) return "";
    if (inMosaics(f)) return list === "mosaic" ? "" : "in the mosaic";
    if (oblique) return "oblique, " + formatNumber(pitch, 0, "°");
    return "left out as unusable";
}

// The frames in the order they were taken, those without a time last (by their names)
export function captureOrder(frames: FrameEntry[]): FrameEntry[] {
    const at = (f: FrameEntry) => f.time || "\uffff";
    return [...frames].sort((a, b) => at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

// The explorer's lists, once the mosaics placed frames (kept in the URL as list=): all of them, those in the mosaic and
// those left out
export const FRAME_LISTS: [string | null, string][] = [[null, "All"], ["mosaic", "In the mosaic"], ["oblique", "Oblique"]];

// The frames of one of the explorer's lists (FRAME_LISTS): those the mosaics placed, or those they left out (for their
// angle, or as unusable, converted or skipped by the conversion's pitch limit); all of them for no list, or while the
// mosaics placed none (not built yet)
export function listFrames(frames: FrameEntry[], list: Maybe<string>): FrameEntry[] {
    if (!frames.some(inMosaics)) return frames;
    return list === "mosaic" ? frames.filter(inMosaics) :
        list === "oblique" ? frames.filter((f) => !inMosaics(f)) : frames;
}

// The page's title for a list: "frames in the mosaic"
export function listTitle(list: Maybe<string>): string {
    return list === "mosaic" ? "frames in the mosaic" : list === "oblique" ? "oblique frames" : "frames";
}

// The changes as a query ("&emissivity=0.98...")
export function changesQuery(changes: Maybe<Record<string, Maybe<number | string>>>): string {
    return Object.entries(changes || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined)
        .map(([k, v]) => "&" + k + "=" + encodeURIComponent(v as string | number)).join("");
}

// A frame's values, measured again with the changes (as the API takes them)
export function valuesUrl(api: string, id: number, frame: string, changes: Maybe<Changes>): string {
    return api + "conversions/" + id + "/frame/data?frame=" + encodeURIComponent(frame) + changesQuery(changes);
}

// Convert with the conversion's settings and these changes: the flight's Datasets tab, its form filled in
export function newConversionUrl(publicUrl: string, datasetId: number, conversionId: number, changes: Maybe<Changes>): string {
    return publicUrl + "dataset/" + datasetId + "?from=" + conversionId + changesQuery(changes) + "#datasets";
}

// Each change's limits, those the server checks (the temperatures: above absolute zero, in the user's unit), and the
// error beyond them
const LIMITS: Record<string, [number, number, string]> = {
    distance: [0.1, 1000, "The distance is between 0.1 and 1000 m"],
    humidity: [0, 100, "The humidity is between 0 and 100 %"],
    emissivity: [0.1, 1, "The emissivity is between 0.1 and 1"],
};
export function limits(field: string): [number, number | null, string] {
    if (!isTemperature(field)) return LIMITS[field];
    const zero = Math.round((convertTemp(-273.15, "C") as number) * 100) / 100;
    return [zero, null, "A temperature is above absolute zero (" + zero + " " + symbol() + ")"];
}

// The changes typed ({field: text}) and where each field started, checked: {changes} (only those given and moved from
// their start) or {error, field}
export function readChanges(values: Record<string, Maybe<string>>, starts?: Record<string, string>):
        {changes?: Changes; error?: string; field?: string} {
    const out: Changes = {};
    for (const c of CHANGES) {
        const f = c[0], t = String(values[f] ?? "").trim(), start = (starts || {})[f];
        // "50" is where "50.0" started: no change
        if (t === "" || t === start || (start !== undefined && start !== "" && Number(t) === Number(start))) continue;
        const n = Number(t), range = limits(f);
        if (isNaN(n)) return {error: c[1] + ": not a number", field: f};
        if (n < range[0] || (range[1] !== null && n > range[1])) return {error: range[2], field: f};
        out[f] = n;
    }
    return {changes: out};
}

// Where each change field starts: the value the frame was measured with, the temperatures in the user's unit
export function changeStarts(info: Maybe<FrameInfo>): Record<string, string> {
    const p = info?.params || {}, out: Record<string, string> = {};
    CHANGES.forEach((c) => {
        out[c[0]] = formatNumber(c[3] ? convertTemp(p[c[4]], "C") as Maybe<number> : p[c[4]], c[0] === "emissivity" ? 2 : 1);
    });
    return out;
}
