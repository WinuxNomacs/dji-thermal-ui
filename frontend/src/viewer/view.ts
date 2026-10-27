// The mosaic viewer's helpers: the tabs, the view kept in the URL, the data tiles' URL, the image's adjustments, the
// colour scale's ticks, the correction and the report, ported from viewer.js
import {type Maybe, formatNumber} from "../core/format";
import {convertDelta, convertTemp, formatDelta, formatTemp, userUnit} from "../core/units";
import {type Measured, type ParamField, symbol, typedTemp} from "../measure/measure";

export const TAB_LABELS: Record<string, string> = {as_converted: "As converted", harmonized: "Harmonized",
                                                   source_frame: "Source frame", view_angle: "View angle"};
export const TAB_HINTS: Record<string, string> = {
    as_converted: "Each pixel is one frame's own temperature, as the frames were converted.",
    harmonized: "Normalized: one ambient and reflected temperature for every frame, and each frame's offset against " +
        "its neighbours removed (camera drift between recalibrations).",
    source_frame: "Which frame each pixel comes from (the one that saw it closest to straight down), each frame in " +
        "its own colour: the seams are where the colours change.",
    view_angle: "How far from straight down each pixel was seen, in degrees.",
};
export const TEMPERATURE_TABS = ["as_converted", "harmonized"];
// The adjustments' limits and the legend's samples, as the server has them (thermal_measure)
export const GAMMA_LIMITS = [0.2, 5], SHARPEN_MAX = 5, CURVE_SAMPLES = 65;

export interface Stats {percentiles?: number[]; min?: number; max?: number}
export interface MosaicTab {tab: string; kind?: string; stats?: Stats | null; bounds?: number[]; maxzoom?: number | null}
export interface Adjust {gamma: number; equalize: boolean; sharpen: number}
export interface Style {palette: string; range: [number, number]; adjust: Adjust; whole?: Measured | null}
export interface View {tab?: string; palette?: string; frame?: string | null; range?: [number, number]; adjust?: Adjust}
export type Extra = Record<string, Maybe<string | number>>;

export function tabLabel(tab: string): string { return TAB_LABELS[tab] || tab; }
export function isTemperatureTab(tab: string): boolean { return TEMPERATURE_TABS.includes(tab); }

// The tabs that share a palette and range: both temperature mosaics show the same scale, to compare them
export function styleGroup(tab: string): string { return isTemperatureTab(tab) ? "temperature" : tab; }

// A tab's starting range: its 2nd to 98th percentile, rounded outwards to a tenth; unit: a temperature's, rounded
// in the user's unit and kept in the conversion's
export function defaultRange(tab: Maybe<MosaicTab>, unit?: unknown): [number, number] {
    const p = tab?.stats?.percentiles;
    if (!p || p.length < 2) return [0, 1];
    const shown = (x: number) => unit ? convertTemp(x, unit) as number : x;
    const kept = (x: number) => unit ? typedTemp(x, unit) : x;
    const lo = Math.floor(shown(p[0]) * 10) / 10, hi = Math.ceil(shown(p[1]) * 10) / 10;
    return hi > lo ? [kept(lo), kept(hi)] : [kept(lo), kept(lo + 1)];
}

// The range typed; unit: a temperature's, typed in the user's unit and kept in the conversion's
export function parseRange(minText: string, maxText: string, unit?: unknown): {range?: [number, number]; error?: string} {
    const lo = parseFloat(minText), hi = parseFloat(maxText);
    if (isNaN(lo) || isNaN(hi)) return {error: "The range needs a minimum and a maximum"};
    if (!(hi > lo)) return {error: "The maximum must be above the minimum"};
    return {range: unit ? [typedTemp(lo, unit), typedTemp(hi, unit)] : [lo, hi]};
}

export function defaultAdjust(): Adjust { return {gamma: 1, equalize: false, sharpen: 0}; }

// The adjustments as a query (&gamma=&equalize=1&sharpen=), those not as by default
export function adjustQuery(adjust: Maybe<Adjust>): string {
    if (!adjust) return "";
    return (adjust.gamma && adjust.gamma !== 1 ? "&gamma=" + adjust.gamma : "") + (adjust.equalize ? "&equalize=1" : "") +
        (adjust.sharpen ? "&sharpen=" + adjust.sharpen : "");
}

// The view kept in the URL (?tab=&palette=&min=&max=&gamma=&equalize=&sharpen=&frame=): those given, the range only
// when it is one (the conversion's unit), the image's adjustments when any is (the others as by default)
export function readView(search: string): View {
    const out: View = {}, params: Record<string, string> = {};
    String(search || "").replace(/^\?/, "").split("&").forEach((pair) => {
        const i = pair.indexOf("="), key = i < 0 ? pair : pair.slice(0, i);
        if (!key) return;
        try {
            params[key] = decodeURIComponent((i < 0 ? "" : pair.slice(i + 1)).replace(/\+/g, " "));
        } catch { /* a malformed value is left out */ }
    });
    if (params.tab) out.tab = params.tab;
    if (params.palette) out.palette = params.palette;
    if (params.frame) out.frame = params.frame;
    const lo = parseFloat(params.min), hi = parseFloat(params.max);
    if (isFinite(lo) && isFinite(hi) && hi > lo) out.range = [lo, hi];
    const adjust = defaultAdjust(), gamma = parseFloat(params.gamma), sharpen = parseFloat(params.sharpen);
    if (gamma >= GAMMA_LIMITS[0] && gamma <= GAMMA_LIMITS[1]) adjust.gamma = gamma;
    if (sharpen >= 0 && sharpen <= SHARPEN_MAX) adjust.sharpen = sharpen;
    adjust.equalize = params.equalize === "1";
    if (adjustQuery(adjust)) out.adjust = adjust;
    return out;
}

// The same view as a URL query, those given
export function viewQuery(view: View): string {
    const parts: string[] = [];
    if (view.tab) parts.push("tab=" + encodeURIComponent(view.tab));
    if (view.palette) parts.push("palette=" + encodeURIComponent(view.palette));
    if (view.range) parts.push("min=" + encodeURIComponent(view.range[0]), "max=" + encodeURIComponent(view.range[1]));
    const adjust = adjustQuery(view.adjust);
    if (adjust) parts.push(adjust.slice(1));
    if (view.frame) parts.push("frame=" + encodeURIComponent(view.frame));
    return parts.length ? "?" + parts.join("&") : "";
}

// The query of what a temperature is asked with: the isotherm and the correction's parameters, those given
export function extraQuery(extra: Maybe<Extra>): string {
    return Object.entries(extra || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined)
        .map(([k, v]) => "&" + k + "=" + encodeURIComponent(v as string | number)).join("");
}

// A mosaic tab's data tiles (the values the browser colours): a temperature's corrected as extra asks
export function dataUrl(api: string, id: number, tab: string, extra?: Extra): string {
    const query = isTemperatureTab(tab) ? extraQuery(extra) : "";
    return api + "conversions/" + id + "/mosaics/" + tab + "/data/{z}/{x}/{y}" + (query ? "?" + query.slice(1) : "");
}

// The palette's share at CURVE_SAMPLES values evenly across the range, with gamma alone (what the server's curve
// gives with equalization)
export function toneShares(gamma: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < CURVE_SAMPLES; i++) out.push(Math.pow(i / (CURVE_SAMPLES - 1), 1 / (gamma || 1)));
    return out;
}

// The brightness (-1 to 1) and contrast (-2 to 2) sliders move the range from ref (the Auto one): brightness
// lowers its centre by up to its width, each step of contrast halves its width
export function slidRange(ref: [number, number], brightness: number, contrast: number): [number, number] {
    const centre = (ref[0] + ref[1]) / 2 - brightness * (ref[1] - ref[0]), half = (ref[1] - ref[0]) / Math.pow(2, contrast) / 2;
    const round = (x: number) => Math.round(x * 100) / 100;
    return [round(centre - half), round(centre + half)];
}

// Where the sliders sit for a range (within their ends)
export function sliderPositions(ref: [number, number], range: [number, number]): {brightness: number; contrast: number} {
    const clamp = (x: number, limit: number) => Math.max(-limit, Math.min(limit, Math.round(x * 100) / 100));
    const refWidth = ref[1] - ref[0], width = range[1] - range[0];
    if (!(refWidth > 0) || !(width > 0)) return {brightness: 0, contrast: 0};
    return {brightness: clamp(((ref[0] + ref[1]) - (range[0] + range[1])) / 2 / refWidth, 1),
            contrast: clamp(Math.log(refWidth / width) / Math.LN2, 2)};
}

// Gamma from its slider (its log2), and the slider from gamma
export function sliderGamma(value: string | number): number {
    const g = Math.round(Math.pow(2, parseFloat(String(value)) || 0) * 100) / 100;
    return Math.max(GAMMA_LIMITS[0], Math.min(GAMMA_LIMITS[1], g));
}
export function gammaSlider(gamma: number): number { return Math.round(Math.log(gamma) / Math.LN2 * 100) / 100; }

// Round values to mark on a colour scale from lo to hi (as shown), about count of them: each with its label and
// where it sits on the scale (0 to 1)
export function scaleTicks(lo: number, hi: number, count = 5): {value: number; label: string; at: number}[] {
    if (!(hi > lo)) return [];
    const rough = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const m = [1, 2, 2.5, 5, 10].filter((x) => x * mag >= rough * (1 - 1e-9))[0], step = m * mag;
    const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (m === 2.5 ? 1 : 0));
    const out = [];
    for (let i = Math.ceil(lo / step - 1e-9); i <= Math.floor(hi / step + 1e-9); i++) {
        const value = i * step;
        out.push({value, label: value.toFixed(digits).replace(/^-(0\.?0*)$/, "$1"), at: (value - lo) / (hi - lo)});
    }
    return out;
}

// A tab's range as shown: a temperature's in the user's unit
export function shownRange(tab: string, range: [number, number], unit: unknown): [number, number] {
    return tab === "view_angle" ? [range[0], range[1]] : [convertTemp(range[0], unit) as number, convertTemp(range[1], unit) as number];
}

// When frames were taken, from their recorded times ("YYYY:MM:DD HH:MM:SS"): "2026-09-18 08:44–09:02", or the
// first and last in full when they are on different days; "" when none is known
export function takenText(times: Maybe<Maybe<string>[]>): string {
    const t = (times || []).map((s) => {
        const m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d)/.exec(s || "");
        return m ? m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] : null;
    }).filter((x): x is string => !!x).sort();
    if (!t.length) return "";
    const first = t[0], last = t[t.length - 1];
    if (first === last) return first;
    return first.slice(0, 10) === last.slice(0, 10) ? first + "–" + last.slice(11) : first + " – " + last;
}

// A scale bar no longer than maxPx at metresPerPx: a round length (1, 2 or 5 times a power of ten) and its width
export function scaleBar(metresPerPx: number, maxPx: number): {px: number; label: string} | null {
    if (!(metresPerPx > 0) || !(maxPx > 0)) return null;
    const most = metresPerPx * maxPx, mag = Math.pow(10, Math.floor(Math.log10(most)));
    const metres = [5, 2, 1].map((m) => m * mag).filter((d) => d <= most * (1 + 1e-9))[0];
    const label = metres >= 1000 ? +(metres / 1000).toPrecision(6) + " km" : +metres.toPrecision(6) + " m";
    return {px: metres / metresPerPx, label};
}

// A file name from the names given: letters, digits, dots, dashes and underscores, as the server names its downloads
export function fileName(parts: Maybe<string>[], ext: string): string {
    const name = parts.filter(Boolean).join("-").replace(/[^\w.-]+/g, "_").replace(/^[._]+|[._]+$/g, "");
    return (name || "view") + ext;
}

// The correction's limits, those the server checks: the reflected temperature's in the user's unit
export const EMISSIVITY_RANGE = [0.1, 1];
export function reflectedRange(): [number, number] {
    const r = [-100, 1000].map((c) => Math.round((convertTemp(c, "C") as number) * 100) / 100);
    return [r[0], r[1]];
}

// The parameters a saved measurement can be measured again with
export const PARAM_FIELDS: ParamField[] = [["emissivity", "Emissivity", "0.01", false],
                                           ["reflected_temp", "Reflected temperature", "0.1", true]];

export type Correction = {emissivity?: string; reflected_temp?: string};

// The correction from the fields: values as typed (the user's unit) and where each started; a value left at its
// start, or emptied, is not sent. An out-of-range value gives the error and the field it is in.
export function readCorrection(values: Record<string, Maybe<string>>, starts?: Record<string, string>):
        {correction?: Correction; error?: string; field?: string} {
    const out: Record<string, string> = {}, limits: Record<string, number[]> = {emissivity: EMISSIVITY_RANGE, reflected_temp: reflectedRange()};
    const names: Record<string, string> = {emissivity: "The emissivity", reflected_temp: "The reflected temperature"};
    for (const key of Object.keys(limits)) {
        const x = String(values[key] ?? "").trim(), range = limits[key];
        if (x === "" || x === String((starts || {})[key])) continue;
        const n = Number(x);
        if (isNaN(n)) return {error: names[key] + " is not a number", field: key};
        if (n < range[0] || n > range[1]) {
            return {error: names[key] + " is between " + range[0] + " and " + range[1] + (key === "emissivity" ? "" : " " + symbol()),
                    field: key};
        }
        out[key] = x;
    }
    return {correction: out};
}

// The query parameters of a correction: the emissivity as typed, the reflected temperature in the conversion's unit
export function correctionParams(c: Correction, unit: unknown): Extra {
    return {emissivity: c.emissivity, reflected_temp: c.reflected_temp === undefined ? undefined : typedTemp(parseFloat(c.reflected_temp), unit)};
}

interface Report {
    radiometric_seams?: {pixels?: number; median_abs_c?: number; p95_abs_c?: number};
    misalignment?: {pairs?: number; median_m?: number; p90_m?: number};
    frame_offsets?: {offset_c?: {min?: number; max?: number}; normalized?: boolean;
                     overlap_difference_c?: {median_abs?: number; median_abs_after_offsets?: number}};
    heights?: {range_m?: number[]; method?: string; file?: string; observed_cells?: number; cells?: number; cell_m?: number;
               reason?: string};
}
export interface Kind {
    frames?: number; oblique?: number; unusable?: number; width?: number; height?: number; gsd_m?: number;
    report?: Report | null; normalization?: number[] | null; files?: string[];
}

// What dji-thermal-cli reports about a mosaic: how many frames, how well they agree and line up
export function reportRows(kind: Maybe<Kind>): [string, string][] {
    if (!kind) return [];
    const r = kind.report || {}, rows: [string, string][] = [];
    rows.push(["Frames", kind.frames + " placed" + (kind.oblique ? ", " + kind.oblique + " oblique left out" : "") +
        (kind.unusable ? ", " + kind.unusable + " unusable" : "")]);
    rows.push(["Size", kind.width + " × " + kind.height + " px at " + formatNumber((kind.gsd_m || 0) * 100, 1, " cm")]);
    const seams = r.radiometric_seams;
    if (seams && seams.pixels) {
        rows.push(["Seams", "median " + formatDelta(seams.median_abs_c, "C") + ", 95% under " + formatDelta(seams.p95_abs_c, "C")]);
    }
    const mis = r.misalignment;
    if (mis && mis.pairs) {
        rows.push(["Misalignment", "median " + formatNumber((mis.median_m || 0) * 100, 1, " cm") + ", 90% under " +
            formatNumber((mis.p90_m || 0) * 100, 1, " cm") + " (" + mis.pairs + " overlapping pairs)"]);
    }
    const off = r.frame_offsets;
    if (off && off.offset_c && off.offset_c.min !== undefined) {
        rows.push(["Frame offsets", formatNumber(convertDelta(off.offset_c.min, "C") as number, 2) + " to " +
            formatDelta(off.offset_c.max, "C") + (off.normalized ? ", removed" : "")]);
    }
    const diff = off && off.overlap_difference_c;
    if (diff && diff.median_abs !== undefined) {
        rows.push(["Overlaps differ by", "median " + formatDelta(diff.median_abs, "C") +
            (diff.median_abs_after_offsets !== undefined ? ", " + formatDelta(diff.median_abs_after_offsets, "C") +
                " without the offsets" : "")]);
    }
    const h = r.heights;
    if (h && h.range_m) {
        rows.push(["Heights", formatNumber(h.range_m[0], 1) + " to " + formatNumber(h.range_m[1], 1, " m") +
            " above the ground plane, " + (h.method === "DSM" ? "from the DSM " + (h.file || "") : "measured in " +
            h.observed_cells + " of " + h.cells + " cells of " + formatNumber(h.cell_m, 1, " m"))]);
    } else if (h && h.method === "plane") {
        rows.push(["Heights", "a ground plane" + (h.reason ? " (" + h.reason + ")" : "")]);
    }
    if (kind.normalization) {
        rows.push(["Normalized to", "ambient " + formatTemp(kind.normalization[0], "C", 1) + ", reflected " +
            formatTemp(kind.normalization[1], "C", 1)]);
    }
    return rows;
}

// The unit temperatures are shown in (the user's)
export function shownUnit(): string { return userUnit(); }
