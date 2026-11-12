// Two mosaics side by side: the view kept in the URL, the mosaics to choose from (a conversion's visual mosaic among
// them), the ranges (in the user's unit, as both panes share them whatever their conversions' units) and the
// difference's. Plain functions, no DOM; ported from compare.js.
import {type Maybe} from "../core/format";
import {convertDelta, convertTemp, userUnit} from "../core/units";
import {type Profile, type Result, typedTemp} from "../measure/measure";
import {type Adjust, defaultRange, type MosaicTab} from "../viewer/view";

export const SPLIT_LIMITS = [20, 80], SPLIT_STEP = 5;
export const NO_OVERLAP = "These mosaics do not overlap.";
// A pane on a conversion's visual mosaic: its values (the readout's, the source frames', a finding's) the as converted
// mosaic's, as on the viewer's Visual tab
export const VISUAL = "visual", VISUAL_DATA = "as_converted";
export const OPACITY_STEP = 5, SWIPE_LIMITS = [0, 100];

export type PaneName = "a" | "b";

// A conversion whose mosaics can be compared (/comparable), with its temperature tabs and whether it has the visual
// mosaic, or is one of its own (visual_only: no temperature tabs)
export interface Comparable {
    id: number; name: string; dataset: number; dataset_name: string; project?: number; project_name?: string;
    unit?: string; tabs: string[]; visual?: boolean; visual_only?: boolean;
    imported?: boolean;         // an orthophoto imported from WebODM: its frames have no frame page
}

// A temperature mosaic's palette, range (in the user's unit) and adjustments
export interface CompareStyle {palette: string; range: [number, number]; adjust: Adjust}

// The difference's palette and reach (± in the user's unit), for the pair of mosaics key names
export interface DiffStyle {key: string; palette: string; reach: number}

// The difference of two mosaics (/difference): where both are, a range centred on 0, the palettes it is drawn with
export interface DiffInfo {
    unit?: string;
    bounds?: number[] | null;
    range?: [number, number] | null;
    palettes?: {key: string; label: string; color_map?: number[]}[];
}

// The view kept in the URL (?b=&a=&a_tab=&b_tab=&diff=a|b&overlay=a|b&opacity=&swipe=&split=)
// overlay: the pane showing A over B, A drawn at opacity (%) left of the swipe line (% across the map);
// findings: false when they are hidden; a_finding, b_finding: the finding open in each pane
export interface CompareView {a?: number; b?: number; a_tab?: string; b_tab?: string; diff?: "" | PaneName; split?: number;
                              overlay?: "" | PaneName; opacity?: number; swipe?: number;
                              findings?: boolean; a_finding?: number | null; b_finding?: number | null}

export function clampSplit(share: number): number {
    return Math.round(Math.max(SPLIT_LIMITS[0], Math.min(SPLIT_LIMITS[1], share)));
}

export function clampShare(share: number): number {
    return Math.round(Math.max(SWIPE_LIMITS[0], Math.min(SWIPE_LIMITS[1], share)));
}

// The tab whose values a pane's tab reads (alone: a visual mosaic of its own, read as itself)
export const dataTab = (tab: string, alone = false): string => tab === VISUAL && !alone ? VISUAL_DATA : tab;

// A conversion's tabs to compare: its temperature tabs, and its visual mosaic where it has one
export const comparedTabs = (c: Comparable): string[] =>
    c.visual_only ? [VISUAL] : c.tabs.concat(c.visual && c.tabs.includes(VISUAL_DATA) ? [VISUAL] : []);

// What the URL gave: the conversions, tabs and difference given, the split between its limits, the findings
export function readCompare(search: string): CompareView {
    const params: Record<string, string> = {};
    String(search || "").replace(/^\?/, "").split("&").forEach((pair) => {
        const i = pair.indexOf("="), key = i < 0 ? pair : pair.slice(0, i);
        if (!key) return;
        try {
            params[decodeURIComponent(key)] = decodeURIComponent(i < 0 ? "" : pair.slice(i + 1));
        } catch { /* a malformed value is left out */ }
    });
    const out: CompareView = {};
    (["a", "b"] as PaneName[]).forEach((k) => {
        if (/^[0-9]+$/.test(params[k] || "")) out[k] = parseInt(params[k], 10);
        if (params[k + "_tab"]) out[k === "a" ? "a_tab" : "b_tab"] = params[k + "_tab"];
        if (/^[1-9][0-9]*$/.test(params[k + "_finding"] || "")) out[k === "a" ? "a_finding" : "b_finding"] = parseInt(params[k + "_finding"], 10);
    });
    if (params.diff === "a" || params.diff === "b") out.diff = params.diff;
    else if (params.overlay === "a" || params.overlay === "b") out.overlay = params.overlay;
    const split = parseFloat(params.split), opacity = parseFloat(params.opacity), swipe = parseFloat(params.swipe);
    if (!isNaN(split)) out.split = clampSplit(split);
    if (!isNaN(opacity)) out.opacity = clampShare(opacity);
    if (!isNaN(swipe)) out.swipe = clampShare(swipe);
    if (params.findings === "0") out.findings = false;
    return out;
}

// The same as a query; pageId: the page's conversion, pane A's when a is left out
export function compareQuery(view: CompareView, pageId: number): string {
    const parts = ["b=" + view.b];
    if (String(view.a) !== String(pageId)) parts.push("a=" + view.a);
    parts.push("a_tab=" + encodeURIComponent(view.a_tab || ""), "b_tab=" + encodeURIComponent(view.b_tab || ""));
    if (view.diff) parts.push("diff=" + view.diff);
    if (view.overlay) {
        parts.push("overlay=" + view.overlay);
        if (view.opacity !== undefined && view.opacity !== 100) parts.push("opacity=" + view.opacity);
        if (view.swipe !== undefined && view.swipe !== 50) parts.push("swipe=" + view.swipe);
    }
    if (view.split !== undefined && view.split !== 50) parts.push("split=" + view.split);
    if (view.findings === false) parts.push("findings=0");
    if (view.a_finding) parts.push("a_finding=" + view.a_finding);
    if (view.b_finding) parts.push("b_finding=" + view.b_finding);
    return "?" + parts.join("&");
}

// The mosaics to choose from, by dataset (in the order given: the project's first); those of other projects named with
// their project
export function mosaicGroups(list: Comparable[], project?: number): {name: string; items: Comparable[]}[] {
    const groups: {name: string; items: Comparable[]}[] = [], byDataset: Record<number, {name: string; items: Comparable[]}> = {};
    list.forEach((c) => {
        const name = project !== undefined && c.project !== undefined && c.project !== project ?
            c.project_name + " · " + c.dataset_name : c.dataset_name;
        if (!byDataset[c.dataset]) groups.push(byDataset[c.dataset] = {name, items: []});
        byDataset[c.dataset].items.push(c);
    });
    return groups;
}

// The tab a pane starts on: the one wanted if the conversion has it, else its first (avoid: not that one, if it can)
export function firstTab(c: Comparable, wanted?: string, avoid?: string): string {
    if (wanted && comparedTabs(c).includes(wanted)) return wanted;
    if (c.visual_only) return VISUAL;
    const others = c.tabs.filter((t) => t !== avoid);
    return (others.length ? others : c.tabs)[0];
}

// The range (in the user's unit) as the API takes it for a conversion in unit
export function rangeIn(range: [number, number], unit: unknown): [number, number] {
    return [typedTemp(range[0], unit), typedTemp(range[1], unit)];
}

// A tab's Auto range in the user's unit; several: the range that holds them all
export function autoRange(entries: {tab: Maybe<MosaicTab>; unit: unknown}[]): [number, number] {
    let lo: number | null = null, hi: number | null = null;
    entries.forEach((e) => {
        if (!e.tab) return;
        const r = defaultRange(e.tab, e.unit).map((x) => convertTemp(x, e.unit) as number);
        lo = lo === null ? r[0] : Math.min(lo, r[0]);
        hi = hi === null ? r[1] : Math.max(hi, r[1]);
    });
    if (lo === null || hi === null) return [0, 1];
    return [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
}

// The difference's Auto reach in the user's unit (the server's symmetric range, in A's unit), rounded up to a tenth
export function autoReach(info: Maybe<DiffInfo>): number {
    if (!info || !info.range) return 1;
    return Math.max(0.1, Math.ceil((convertDelta(info.range[1], info.unit) as number) * 10 - 1e-9) / 10);
}

// The difference's values (A − B, in A's unit)
export function differenceDataUrl(api: string, a: number, aTab: string, b: number, bTab: string): string {
    return api + "conversions/" + a + "/mosaics/" + aTab + "/difference/data/{z}/{x}/{y}?b=" + b + "&b_tab=" +
        encodeURIComponent(bTab);
}

// The difference's reach (± in the user's unit) in A's unit, as its values are
export function reachIn(reach: number, aUnit: unknown): number {
    return Math.round((convertDelta(reach, userUnit(), aUnit) as number) * 10000) / 10000;
}

export function differenceUrl(api: string, a: number, aTab: string, b: number, bTab: string): string {
    return api + "conversions/" + a + "/mosaics/" + aTab + "/difference?b=" + b + "&b_tab=" + encodeURIComponent(bTab);
}

// A frame's values
export function frameDataUrl(api: string, id: number, frame: string): string {
    return api + "conversions/" + id + "/frame/data?frame=" + encodeURIComponent(frame);
}

// A mosaic's measured figures in another unit (B's in A's, so that one card shows both): its temperatures converted,
// its spreads and differences scaled
export function resultIn(r: Result, from: unknown, to: unknown): Result {
    const t = (v: Maybe<number>) => v === null || v === undefined ? v : convertTemp(v, from, to) as number;
    const d = (v: Maybe<number>) => v === null || v === undefined ? v : convertDelta(v, from, to) as number;
    const out: Result = {...r, value: t(r.value), mean: t(r.mean), min: t(r.min), max: t(r.max), std: d(r.std),
                         delta_t: d(r.delta_t), first: t(r.first), second: t(r.second)};
    (Object.keys(out) as (keyof Result)[]).forEach((k) => { if (out[k] === undefined) delete out[k]; });
    if (r.percentiles) out.percentiles = r.percentiles.map((v) => t(v) as number);
    if (r.histogram) out.histogram = [r.histogram[0], r.histogram[1].map((v) => t(v) as number)];
    if (r.profile) out.profile = {...r.profile, values: r.profile.values.map(t)};
    return out;
}

// A line's profile read at n samples evenly along it (B's at A's, when their pixels differ in size): each the sample
// nearest that far along
export function profileAt(p: Profile, n: number): Profile {
    const m = p.values.length;
    if (m === n || m < 2 || n < 2) return p;
    const at = Array.from({length: n}, (_, i) => Math.round(i / (n - 1) * (m - 1)));
    const length = p.distance[m - 1];
    return {distance: at.map((_, i) => i / (n - 1) * length), values: at.map((j) => p.values[j]),
            points: p.points && at.map((j) => p.points![j]), frames: p.frames && at.map((j) => p.frames![j])};
}
