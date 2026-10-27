// dji-thermal-cli's conversion settings: the form's values and back, the WebODM plan's settings, and what a set of
// settings changes from the defaults (and where it is off the plan), told apart as short texts
import {median, type Maybe} from "../core/format";
import {convertTemp, unitOf, unitSymbol, userUnit, type Unit} from "../core/units";
import type {Analysis} from "./files";

export interface Settings {
    outputs?: string[];
    compression?: string;
    mosaics?: boolean;
    distance?: number | string | null;
    unit?: string;
    normalize?: boolean;
    max_pitch?: number | null;
    palette?: string | null;
    strip_location?: boolean;
    [key: string]: unknown;
}

export interface Product {product: string; formats: string[]; description: string}

// What the settings form can choose from, and where it starts (GET preferences)
export interface Meta {settings: Settings; saved: boolean; defaults: Settings; products: Product[]; palettes: string[]}

export const DISTANCE_MODES: [string, string][] = [
    ["lrf", "The rangefinder's, where it measured (else embedded)"], ["embedded", "Embedded in each image"], ["fixed", "Fixed"],
];
export const UNIT_LABELS: Record<Unit, string> = {C: "°C", F: "°F", K: "K"};

export interface Measurement {key: string; label: string; hint: string; unit?: string; digits?: number; step?: string; temperature?: boolean}

// The measurement parameters with the analysis' column of each image's recorded value (Celsius for temperatures)
export const MEASUREMENTS: Measurement[] = [
    {key: "humidity", label: "Relative humidity", unit: "%", hint: "humidity", digits: 0},
    {key: "emissivity", label: "Emissivity", hint: "emissivity", digits: 2, step: "0.01"},
    {key: "reflected_temp", label: "Reflected temperature", hint: "reflection", temperature: true},
    {key: "ambient_temp", label: "Ambient temperature", hint: "ambient", temperature: true},
];
export const GIMBAL: [string, string][] = [["gimbal_yaw", "Yaw"], ["gimbal_pitch", "Pitch"], ["gimbal_roll", "Roll"]];
export const SIDES = ["above", "below"] as const;

// The settings that are temperatures (in the settings' unit, the files'): the form shows them in the user's
const TEMPERATURES = ["reflected_temp", "ambient_temp", "range_min", "range_max", "replace_above", "replace_above_value",
                      "replace_below", "replace_below_value"];

export function blank(v: unknown): v is null | undefined | "" { return v === null || v === undefined || v === ""; }

function copy<T>(v: T): T { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

// Settings with their temperatures from one unit to another ("nodata" kept)
export function settingsIn<S extends Settings>(s: S, from: unknown, to: unknown): S {
    const out: Settings = {...s};
    TEMPERATURES.forEach((k) => {
        const v = out[k];
        if (typeof v === "number") out[k] = Math.round((convertTemp(v, from, to) as number) * 10000) / 10000;
    });
    return out as S;
}

export interface Recorded {
    distance: number | null; lrf: number | null; humidity: number | null; emissivity: number | null;
    reflection: number | null; ambient: number | null;
    palettes: [string, number][];   // the images' own palettes, the most used first: [name, frames]
}

// What the flight recorded (medians of its thermal frames), shown beside each measurement parameter
export function recorded(analysis: Maybe<Analysis>): Recorded {
    const thermal = (analysis?.files || []).filter((f) => f.kind === "thermal");
    const at = (k: string) => median(thermal.map((f) => f[k] as Maybe<number>));
    const counts: Record<string, number> = {};
    thermal.forEach((f) => { if (f.palette) counts[f.palette] = (counts[f.palette] || 0) + 1; });
    return {
        distance: at("distance"), lrf: at("lrf"), humidity: at("humidity"), emissivity: at("emissivity"),
        reflection: at("reflection"), ambient: at("ambient"),
        palettes: Object.entries(counts).sort((a, b) => b[1] - a[1]),
    };
}

// The form as typed: the inputs' and selects' values by name (numbers as typed, "" for empty), the checkboxes', and
// each product's output (checked, with its format)
export interface FormValues {
    values: Record<string, string>;
    checks: Record<string, boolean>;
    outputs: Record<string, {on: boolean; format: string}>;
}

const NUMBER_FIELDS = ["distance", ...MEASUREMENTS.map((m) => m.key), "range_min", "range_max", ...GIMBAL.map((g) => g[0]),
                       "replace_above", "replace_above_value", "replace_below", "replace_below_value", "max_pitch"];

function text(v: unknown): string { return blank(v) ? "" : String(v); }

// The settings in the form, its temperatures in the user's unit (rounded to 2 decimals)
export function formValues(settings: Settings, products: Product[]): FormValues {
    const s = settingsIn(settings, unitOf(settings.unit || userUnit()), userUnit());
    TEMPERATURES.forEach((k) => { const v = s[k]; if (typeof v === "number") s[k] = Math.round(v * 100) / 100; });
    const values: Record<string, string> = {};
    NUMBER_FIELDS.forEach((k) => { values[k] = text(s[k]); });
    const fixed = typeof s.distance === "number";
    values.distance_mode = fixed ? "fixed" : text(s.distance);
    if (!fixed) values.distance = "";
    values.unit = unitOf(settings.unit || userUnit());
    values.palette = s.palette || "";
    values.compression = s.compression || "deflate";
    const checks: Record<string, boolean> = {
        normalize: !!s.normalize, mosaics: !!s.mosaics, strip_location: !!s.strip_location,
    };
    SIDES.forEach((side) => {
        const nodata = s["replace_" + side + "_value"] === "nodata";
        checks["replace_" + side + "_nodata"] = nodata;
        if (nodata) values["replace_" + side + "_value"] = "";
    });
    const chosen: Record<string, string> = {};
    (s.outputs || []).forEach((o) => { const [p, f] = o.split(":"); chosen[p] = f; });
    const outputs: FormValues["outputs"] = {};
    products.forEach((p) => {
        outputs[p.product] = {on: chosen[p.product] !== undefined,
                              format: p.formats.includes(chosen[p.product]) ? chosen[p.product] : p.formats[0]};
    });
    return {values, checks, outputs};
}

// The settings the form shows ("" for an empty fixed distance), the temperatures typed in the user's unit given in the
// files'
export function readValues(f: FormValues): Settings {
    const num = (k: string) => f.values[k] === undefined || f.values[k] === "" ? null : Number(f.values[k]);
    const s: Settings = {};
    const mode = f.values.distance_mode;
    s.distance = mode === "fixed" ? (num("distance") ?? "") : mode;
    MEASUREMENTS.forEach((m) => { s[m.key] = num(m.key); });
    s.unit = f.values.unit;
    s.palette = f.values.palette || null;
    s.range_min = num("range_min");
    s.range_max = num("range_max");
    GIMBAL.forEach(([k]) => { s[k] = num(k); });
    SIDES.forEach((side) => {
        const k = "replace_" + side;
        s[k] = num(k);
        s[k + "_value"] = f.checks[k + "_nodata"] ? "nodata" : num(k + "_value");
    });
    s.strip_location = !!f.checks.strip_location;
    s.normalize = !!f.checks.normalize;
    s.mosaics = !!f.checks.mosaics;
    s.max_pitch = num("max_pitch");
    s.compression = f.values.compression;
    s.outputs = Object.entries(f.outputs).filter(([, o]) => o.on).map(([p, o]) => p + ":" + o.format);
    return settingsIn(s, userUnit(), s.unit);
}

// The settings of the WebODM plan's process command (its arguments, as dji-thermal-cli's CLI takes them), on the defaults
const PLAN_NUMBERS: Record<string, string> = {
    "--max-pitch": "max_pitch", "--emissivity": "emissivity", "--humidity": "humidity",
    "--reflected-temp": "reflected_temp", "--ambient-temp": "ambient_temp",
};

export function planSettings(args: Maybe<string[]>, defaults: Maybe<Settings>): Settings {
    const s: Settings = copy(defaults || {});
    const outputs: string[] = [], given: Settings = {};
    let planUnit: Unit = "C";
    const list = args || [];
    for (let i = 0; i < list.length; i++) {
        const a = list[i], next = list[i + 1];
        if (a === "-o" || a === "--outputs") {
            String(next).split(",").forEach((o) => { if (o) outputs.push(o.includes(":") ? o.replace(/:tif$/, ":tiff") : o); });
            i++;
        } else if (a === "--normalize") {
            s.normalize = true;
        } else if (a === "--distance") {
            s.distance = isNaN(Number(next)) ? next : Number(next);
            i++;
        } else if (a === "--unit") {
            planUnit = unitOf(String(next).toUpperCase());
            i++;
        } else if (PLAN_NUMBERS[a]) {
            given[PLAN_NUMBERS[a]] = Number(next);
            i++;
        }
    }
    if (outputs.length) s.outputs = outputs;
    return Object.assign(s, settingsIn(given, planUnit, s.unit || "C"));
}

// What stops the settings from being sent, or null
export function formProblem(s: Settings): string | null {
    if (s.distance === "") return "Enter the distance to the target, or choose another distance.";
    if (!(s.outputs || []).length) return "Choose at least one output.";
    if ((s.range_min === null) !== (s.range_max === null)) return "Give both ends of the colour range, or neither.";
    return null;
}

function round2(v: unknown): unknown { return typeof v === "number" ? Math.round(v * 100) / 100 : v; }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
function num(v: unknown, digits = 2): string { return String(Number(Number(v).toFixed(digits))); }

// Outputs alike as sets, an output without a format (the plan's "pseudo") alike with any format of its product
function sameOutputs(a: Maybe<string[]>, b: Maybe<string[]>): boolean {
    const products = (list: Maybe<string[]>) => {
        const out: Record<string, string> = {};
        (list || []).forEach((o) => { const [p, f] = o.split(":"); out[p] = f || "*"; });
        return out;
    };
    const pa = products(a), pb = products(b);
    const ka = Object.keys(pa).sort(), kb = Object.keys(pb).sort();
    return same(ka, kb) && ka.every((k) => pa[k] === "*" || pb[k] === "*" || pa[k] === pb[k]);
}

interface Difference {
    key: string;
    fields: string[];   // the form's fields that set it, the first the one it is marked on
    same?: (a: Maybe<string[]>, b: Maybe<string[]>) => boolean;
    text: (s: Settings, u: string) => string;
}

// The settings told apart in the summaries: each with its form fields and its text (u: the temperatures' unit symbol)
const DIFFERENCES: Difference[] = [
    {key: "outputs", fields: ["output"], same: sameOutputs, text: (s) => (s.outputs || []).join(", ") || "no outputs"},
    {key: "compression", fields: ["compression"],
     text: (s) => s.compression === "none" ? "no compression" : s.compression + " compression"},
    {key: "mosaics", fields: ["mosaics"], text: (s) => s.mosaics ? "mosaics" : "no mosaics"},
    {key: "distance", fields: ["distance_mode", "distance"], text: (s) =>
        typeof s.distance === "number" ? "distance " + num(s.distance, 1) + " m" :
            s.distance === "embedded" ? "embedded distance" : s.distance === "" ? "distance not given" : "rangefinder distance"},
    ...MEASUREMENTS.map((m): Difference => {
        const name = m.label.replace(/ temperature$/, "").replace(/^Relative /, "").toLowerCase();
        return {key: m.key, fields: [m.key], text: (s, u) => blank(s[m.key]) ? "each image's " + m.label.toLowerCase() :
            name + " " + num(s[m.key]) + (m.temperature ? " " + u : m.unit || "")};
    }),
    {key: "unit", fields: ["unit"], text: (s) => "files in " + UNIT_LABELS[unitOf(s.unit)]},
    {key: "normalize", fields: ["normalize"], text: (s) => s.normalize ? "normalized" : "not normalized"},
    {key: "max_pitch", fields: ["max_pitch"], text: (s) => blank(s.max_pitch) ? "all frames" : "pitch ≤ " + num(s.max_pitch) + "°"},
    {key: "palette", fields: ["palette"], text: (s) => s.palette ? "palette " + s.palette : "each image's palette"},
    {key: "range", fields: ["range_min", "range_max"], text: (s, u) => blank(s.range_min) && blank(s.range_max) ?
        "each image's range" : "range " + num(s.range_min) + " to " + num(s.range_max) + " " + u},
    {key: "gimbal", fields: GIMBAL.map((g) => g[0]), text: (s) => {
        const given = GIMBAL.filter(([k]) => !blank(s[k]));
        return given.length ? "gimbal " + given.map(([k, label]) => label.toLowerCase() + " " + num(s[k]) + "°").join(", ") :
            "recorded gimbal";
    }},
    ...SIDES.map((side): Difference => {
        const k = "replace_" + side;
        return {key: k, fields: [k, k + "_value", k + "_nodata"], text: (s, u) => {
            if (blank(s[k])) return "nothing replaced " + side;
            const v = s[k + "_value"];
            return side + " " + num(s[k]) + " " + u + " → " + (v === "nodata" ? "no data" : blank(v) ? "?" : num(v) + " " + u);
        }};
    }),
    {key: "strip_location", fields: ["strip_location"], text: (s) => s.strip_location ? "location stripped" : "location kept"},
];

// The settings fields of a difference, where they are more than its key
const FIELDS: Record<string, string[]> = {
    range: ["range_min", "range_max"], gimbal: GIMBAL.map((g) => g[0]),
    replace_above: ["replace_above", "replace_above_value"], replace_below: ["replace_below", "replace_below_value"],
};

// The settings' values compared, of one difference
function valuesOf(d: Difference, s: Settings): unknown[] {
    if (d.key === "outputs") return s.outputs || [];
    return (FIELDS[d.key] || [d.key]).map((f) => {
        const v = s[f];
        if (f === "unit") return unitOf(v);
        if (typeof v === "boolean" || f === "mosaics" || f === "normalize" || f === "strip_location") return !!v;
        return blank(v) ? null : round2(v);
    });
}

export interface Diff {key: string; text: string; changed: boolean; offPlan: boolean; plan: string | null}

// What the settings change from the defaults, and where they're off the WebODM plan (where the plan differs from the
// defaults), the temperatures in the unit shown
export function differences(s: Settings, defaults: Maybe<Settings>, plan: Maybe<Settings>, shown: unknown): Diff[] {
    const at = (x: Settings) => settingsIn(x, unitOf(x.unit), shown);
    const S = at(s), D = at(defaults || {}), P = plan ? at(plan) : null;
    const u = unitSymbol(shown);
    const out: Diff[] = [];
    DIFFERENCES.forEach((d) => {
        const alike = (a: Settings, b: Settings) => d.same ? d.same(a.outputs, b.outputs) : same(valuesOf(d, a), valuesOf(d, b));
        const changed = !alike(S, D);
        const offPlan = !!P && !alike(P, D) && !alike(S, P);
        if (changed || offPlan) out.push({key: d.key, text: d.text(S, u), changed, offPlan, plan: P ? d.text(P, u) : null});
    });
    return out;
}

// The form field a difference is marked on
export function markedField(key: string): string | undefined {
    return DIFFERENCES.find((d) => d.key === key)?.fields[0];
}

// The settings with one difference back at its default (both in their own unit)
export function resetSetting(s: Settings, defaults: Settings, key: string): Settings {
    const out: Settings = {...s};
    if (key === "unit") return {...settingsIn(out, unitOf(out.unit), unitOf(defaults.unit)), unit: defaults.unit};
    const d = settingsIn(defaults, unitOf(defaults.unit), unitOf(out.unit));
    (FIELDS[key] || [key]).forEach((f) => { out[f] = d[f] === undefined ? null : copy(d[f]); });
    return out;
}
