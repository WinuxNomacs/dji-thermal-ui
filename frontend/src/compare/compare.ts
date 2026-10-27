// Two mosaics side by side: the view kept in the URL, the mosaics to choose from, the ranges (in the user's unit, as
// both panes share them whatever their conversions' units) and the difference's. Plain functions, no DOM; ported
// from compare.js.
import {type Maybe} from "../core/format";
import {convertDelta, convertTemp, userUnit} from "../core/units";
import {typedTemp} from "../measure/measure";
import {adjustQuery, type Adjust, defaultRange, type MosaicTab} from "../viewer/view";

export const SPLIT_LIMITS = [20, 80], SPLIT_STEP = 5;
export const NO_OVERLAP = "These mosaics do not overlap.";

export type PaneName = "a" | "b";

// A conversion whose mosaics can be compared (/comparable), with its temperature tabs
export interface Comparable {id: number; name: string; dataset: number; dataset_name: string; unit?: string; tabs: string[]}

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

// The view kept in the URL (?b=&a=&a_tab=&b_tab=&diff=a|b&split=)
export interface CompareView {a?: number; b?: number; a_tab?: string; b_tab?: string; diff?: "" | PaneName; split?: number}

export function clampSplit(share: number): number {
    return Math.round(Math.max(SPLIT_LIMITS[0], Math.min(SPLIT_LIMITS[1], share)));
}

// What the URL gave: the conversions, tabs and difference given, the split between its limits
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
    });
    if (params.diff === "a" || params.diff === "b") out.diff = params.diff;
    const split = parseFloat(params.split);
    if (!isNaN(split)) out.split = clampSplit(split);
    return out;
}

// The same as a query; pageId: the page's conversion, pane A's when a is left out
export function compareQuery(view: CompareView, pageId: number): string {
    const parts = ["b=" + view.b];
    if (String(view.a) !== String(pageId)) parts.push("a=" + view.a);
    parts.push("a_tab=" + encodeURIComponent(view.a_tab || ""), "b_tab=" + encodeURIComponent(view.b_tab || ""));
    if (view.diff) parts.push("diff=" + view.diff);
    if (view.split !== undefined && view.split !== 50) parts.push("split=" + view.split);
    return "?" + parts.join("&");
}

// The mosaics to choose from, by dataset (in the order given)
export function mosaicGroups(list: Comparable[]): {name: string; items: Comparable[]}[] {
    const groups: {name: string; items: Comparable[]}[] = [], byDataset: Record<number, {name: string; items: Comparable[]}> = {};
    list.forEach((c) => {
        if (!byDataset[c.dataset]) groups.push(byDataset[c.dataset] = {name: c.dataset_name, items: []});
        byDataset[c.dataset].items.push(c);
    });
    return groups;
}

// The tab a pane starts on: the one wanted if the conversion has it, else its first (avoid: not that one, if it can)
export function firstTab(c: Comparable, wanted?: string, avoid?: string): string {
    if (wanted && c.tabs.includes(wanted)) return wanted;
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

// How a temperature tab is toned with equalization in a style (the range in the user's unit), for a conversion in unit
export function mosaicCurveUrl(api: string, id: number, tab: string, style: CompareStyle, unit: unknown): string {
    const range = rangeIn(style.range, unit);
    return api + "conversions/" + id + "/mosaics/" + tab + "/curve?rescale=" + range[0] + "," + range[1] + adjustQuery(style.adjust);
}

// A frame's values, and how it is toned with equalization in a style
export function frameDataUrl(api: string, id: number, frame: string): string {
    return api + "conversions/" + id + "/frame/data?frame=" + encodeURIComponent(frame);
}

export function frameCurveUrl(api: string, id: number, frame: string, style: CompareStyle, unit: unknown): string {
    const range = rangeIn(style.range, unit);
    return api + "conversions/" + id + "/frame/curve?frame=" + encodeURIComponent(frame) + "&rescale=" + range[0] + "," +
        range[1] + adjustQuery(style.adjust);
}
