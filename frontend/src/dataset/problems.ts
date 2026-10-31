// The Problems tab's text: each of dji-thermal-cli's problems in the app's words, its numbers taken from the files'
// rows and shown in the user's unit, with the New dataset form's setting that fixes it where one does. A code the app
// doesn't know keeps dji-thermal-cli's own text.
import {count, formatNumber, median} from "../core/format";
import {formatDelta, formatTemp} from "../core/units";
import type {FileRow, Problem} from "./files";

const MOSAIC_PITCH = -80;   // dji-thermal-cli's pitch limit for a mosaic's frames, which the analysis checks with
const MIN_FRAMES = 5;       // the nadir frames a mosaic needs (as ODM does)

// What a problem's button changes in the New dataset form: its fields' values and boxes, and the note saying so
export interface Fix {label: string; values?: Record<string, string>; checks?: Record<string, boolean>; done: string}

export interface ProblemText {
    message: string;
    advice: string;
    values: Record<string, string>;     // each file's value the problem is about, shown beside its name
    fix?: Fix;
}

const NORMALIZE: Fix = {label: "Normalize the frames to each other", checks: {normalize: true},
                        done: "“Normalize the frames to each other” is ticked."};

const isNumber = (v: unknown): v is number => typeof v === "number" && !isNaN(v);
const frames = (n: number) => count(n, "frame", "frames");
const plain = (v: number) => String(Number(v.toFixed(3)));      // 0.95, 21.4: as dji-thermal-cli's %g
const metres = (v: number) => formatNumber(v, 1, " m");

// The value most frames have
function mode(values: number[]): number {
    const counts = new Map<number, number>();
    values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function sentence(t: string | null | undefined): string {
    const s = (t || "").trim();
    return s ? s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : "";
}

const fixedDistance = (d: number): Fix => ({label: "Use one distance (" + metres(d) + ")",
    values: {distance_mode: "fixed", distance: plain(Number(d.toFixed(1)))},
    done: "Object distance is fixed at " + metres(d) + "."});

export function describeProblem(p: Problem, rows: FileRow[]): ProblemText {
    const thermal = rows.filter((r) => r.kind === "thermal");
    const byPath = new Map(rows.map((r) => [r.path, r]));
    const named = (p.files || []).map((f) => byPath.get(f)).filter((r): r is FileRow => !!r);
    const valuesOf = (key: string, show: (v: number) => string) => {
        const out: Record<string, string> = {};
        named.forEach((r) => { if (isNumber(r[key])) out[r.path] = show(r[key] as number); });
        return out;
    };
    const fallback: ProblemText = {message: sentence(p.message), advice: sentence(p.suggestion), values: {}};
    const n = (p.files || []).length;

    switch (p.code) {
    case "ambient_temp_varies":
    case "reflection_varies": {
        const key = p.code === "ambient_temp_varies" ? "ambient" : "reflection";
        const v = thermal.map((r) => r[key]).filter(isNumber);
        if (v.length < 2) return fallback;
        const both = thermal.every((r) => r.ambient === r.reflection);
        const what = both ? "ambient and reflected temperatures" : key === "ambient" ? "ambient temperature" : "reflected temperature";
        const field = both ? "Ambient and Reflected temperature" : key === "ambient" ? "Ambient temperature" : "Reflected temperature";
        const lo = Math.min(...v), hi = Math.max(...v);
        return {message: "The " + what + " recorded in the frames " + (both ? "vary" : "varies") + " by " +
                    formatDelta(hi - lo, "C", 1) + " (" + formatTemp(lo, "C", 1) + " to " + formatTemp(hi, "C", 1) + "). " +
                    (both ? "They scale" : "It scales") + " each frame's temperatures with distance, so frames of the same scene disagree.",
                advice: "Normalize the frames to each other when converting, or set one " + field + " under Measurement.",
                values: {}, fix: NORMALIZE};
    }
    case "emissivity_differs":
    case "humidity_differs": {
        const key = p.code === "emissivity_differs" ? "emissivity" : "humidity";
        const v = thermal.map((r) => r[key]).filter(isNumber);
        if (!v.length) return fallback;
        const common = mode(v);
        const unit = key === "humidity" ? " %" : "";
        const label = key === "humidity" ? "relative humidity" : "emissivity";
        return {message: "The " + label + " recorded in the frames differs: " + frames(v.filter((x) => x === common).length) +
                    " at " + plain(common) + unit + ", " + frames(n) + " at other values.",
                advice: "Frames measured with different values disagree: set one " +
                    (key === "humidity" ? "Relative humidity" : "Emissivity") + " under Measurement for every frame.",
                values: valuesOf(key, (x) => plain(x) + unit),
                fix: {label: "Use one " + label + " (" + plain(common) + unit + ")", values: {[key]: plain(common)},
                      done: (key === "humidity" ? "Relative humidity" : "Emissivity") + " is set to " + plain(common) + unit + "."}};
    }
    case "distance_differs":
        return {message: "The object distance embedded in the frames differs between " + frames(n) + " and the rest.",
                advice: "Object distance: the rangefinder's (the default) measures each frame at its own distance; a Fixed " +
                    "distance under Measurement uses one for every frame.",
                values: valuesOf("distance", metres)};
    case "rangefinder_distance": {
        const emb = median(thermal.map((r) => r.distance)), lrf = median(thermal.map((r) => r.lrf));
        if (emb === null || lrf === null) return fallback;
        return {message: "The object distance embedded in the frames is " + metres(emb) + ", but the rangefinder reads " +
                    metres(lrf) + " (median). The rangefinder's is used by default.",
                advice: "Choose “Embedded in each image” as the Object distance under Measurement to keep the embedded one.",
                values: {},
                fix: {label: "Use the embedded distance", values: {distance_mode: "embedded", distance: ""},
                      done: "Object distance is the one embedded in each image."}};
    }
    case "rangefinder_invalid":
    case "rangefinder_outlier": {
        const invalid = p.code === "rangefinder_invalid";
        const bad = new Set(invalid ? p.files || [] : []);
        const good = median(thermal.filter((r) => !bad.has(r.path)).map((r) => r.lrf));
        return {message: invalid ? frames(n) + " have no valid rangefinder reading: their embedded distance is used instead." :
                    frames(n) + " with an unusual rangefinder distance: the laser hit something nearer or farther " +
                    "(a roof, a tree, the horizon).",
                advice: "A Fixed object distance under Measurement uses one distance for every frame.",
                values: invalid ? {} : valuesOf("lrf", metres),
                fix: good === null ? undefined : fixedDistance(good)};
    }
    case "temperature_max_outlier":
    case "temperature_min_outlier":
    case "temperature_mean_outlier": {
        const stat = p.code.split("_")[1] as "max" | "min" | "mean";
        const key = "t" + stat;
        const med = median(thermal.map((r) => r[key] as number | null | undefined));
        const label = {max: "maximum", min: "minimum", mean: "mean"}[stat];
        const oblique = named.filter((r) => isNumber(r.pitch) && r.pitch > MOSAIC_PITCH).length;
        const why = oblique ? "; " + (n === 1 ? "it is an oblique frame" : oblique + " of them " +
            (oblique === 1 ? "is an oblique frame" : "are oblique frames")) +
            (stat === "min" ? " (sky in view?)" : "") + ", which a mosaic leaves out" : "";
        return {message: frames(n) + " with an unusual " + label + " temperature" +
                    (med === null ? "" : " (the flight's median " + formatTemp(med, "C", 1) + ")") + why + ".",
                advice: stat === "mean" ? "Check what these frames see. Normalizing the frames to each other evens out each " +
                    "frame's offset." : "“Replace " + (stat === "max" ? "above" : "below") + "” under Adjustments replaces or " +
                    "blanks " + (stat === "max" ? "hot spots such as sun glint" : "cold spots such as the sky") + "; a Colour " +
                    "range under Colours keeps one colour scale.",
                values: valuesOf(key, (x) => formatTemp(x, "C", 1)),
                fix: stat === "mean" ? NORMALIZE : undefined};
    }
    case "oblique": {
        const nadir = thermal.filter((r) => isNumber(r.pitch) && r.pitch <= MOSAIC_PITCH).length;
        const steepest = Math.max(...named.map((r) => r.pitch).filter(isNumber));
        const few = nadir < MIN_FRAMES && isFinite(steepest);
        const limit = String(Math.ceil(steepest));
        return {message: frames(n) + " look less steeply down than " + MOSAIC_PITCH + "° and are left out of a mosaic (" +
                    count(nadir, "nadir frame remains", "nadir frames remain") + ").",
                advice: "“Only frames with a gimbal pitch at or below” under Frames sets which frames a mosaic uses" +
                    (few ? ": too few nadir frames are left for a mosaic." : "."),
                values: valuesOf("pitch", (x) => formatNumber(x, 1, "°")),
                fix: few ? {label: "Include them", values: {max_pitch: limit},
                            done: "Only frames with a gimbal pitch at or below " + limit + "° are used."} : undefined};
    }
    case "pitch_outlier":
        return {message: frames(n) + " in a mosaic with an unusual gimbal pitch.",
                advice: "If the recorded angle is wrong, set the Gimbal override's Pitch under Adjustments; or lower “Only " +
                    "frames with a gimbal pitch at or below” under Frames to leave them out.",
                values: valuesOf("pitch", (x) => formatNumber(x, 1, "°"))};
    case "altitude_outlier":
        return {message: frames(n) + " in a mosaic at an unusual height.",
                advice: "Their ground resolution differs from the rest's (take-off or landing frames?).",
                values: valuesOf("alt", metres)};
    case "no_pose":
        return {message: frames(n) + " have no position or gimbal attitude.",
                advice: "They are converted, but can't be placed in a mosaic.", values: {}};
    default:
        return fallback;
    }
}
