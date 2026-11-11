// Measuring a conversion's mosaics and frames (the viewer and frame pages): what the tools draw as the geometry the API
// takes, the isotherm, what the API measured as rows of figures, and the measurements saved on the conversion.
// Plain functions, no DOM.
import {formatNumber, type Maybe} from "../core/format";
import {convertTemp, formatDelta, formatTemp, unitSymbol, userUnit} from "../core/units";

export type Tool = "point" | "line" | "area" | "box" | "circle";
export type Coords = [number, number];     // lon/lat, or a frame's pixels

export const TOOLS: [Tool, string][] = [["point", "Spot"], ["line", "Line"], ["area", "Area"], ["box", "Box"], ["circle", "Circle"]];
export const ISOTHERM_MODES: [string, string][] = [["", "None"], ["above", "Above"], ["below", "Below"], ["between", "Between"]];
const SHAPE_LABELS: Record<string, string> = {Point: "Spot", LineString: "Line", Polygon: "Area"};
// An area drawn by dragging (values.shape.kind)
const DRAWN_LABELS: Record<string, string> = {box: "Box", circle: "Circle"};
const TARGET_LABELS: Record<string, string> = {as_converted: "Mosaic", harmonized: "Harmonized", webodm: "WebODM",
                                               frame: "Frame", visual: "Visual"};
export const HINTS: Record<Tool, string> = {
    point: "Click a spot: its temperature is the mean of a small disc around it.",
    line: "Click the line's points; double-click the last one (or Finish) to end.",
    area: "Click the area's corners; double-click the last one (or Finish) to end.",
    box: "Drag from one corner to the opposite one.",
    circle: "Drag from the centre outwards.",
};
const CIRCLE_VERTICES = 64;

export type Geometry =
    {type: "Point"; coordinates: Coords} | {type: "LineString"; coordinates: Coords[]} | {type: "Polygon"; coordinates: Coords[][]};

// How a box or circle was drawn
export interface Shape {kind: string; center?: Coords; radius?: number}

// A line's profile: evenly spaced samples, null where there is no data; on a mosaic, the frame each was read from
export interface Profile {distance: number[]; values: Maybe<number>[]; points?: Coords[]; frames?: Maybe<string>[]}

export type Histogram = [number[], number[]];      // counts, edges

export interface Result {
    kind?: string;
    valid_pixels?: number;
    reason?: string;
    value?: number | null;
    mean?: number | null;
    min?: number | null;
    max?: number | null;
    std?: number | null;
    surroundings?: number | null;
    delta_t?: number | null;
    length?: number | null;
    area?: number | null;
    perimeter?: number | null;
    isotherm?: {share?: number | null} | null;
    profile?: Profile | null;
    histogram?: Histogram | null;
    percentiles?: number[] | null;
    max_location?: Coords | null;
    min_location?: Coords | null;
    // The ground's height (WebODM's DSM, above its lowest ground) at a spot, or an area's lowest, mean and highest
    height?: number | null;
    heights?: {min: number; mean: number; max: number} | null;
}

// What the API measured: as converted, and with the parameters changed
export interface Measured {result?: Result | null; changed?: Result | null; approximate?: boolean; shape?: Shape | null}

export interface Measurement {
    id: number;
    name: string;
    target: string;
    frame?: string | null;
    geometry?: Geometry | null;
    parameters?: Record<string, number | null> | null;
    values?: Measured | null;
    comment?: string;
}

// A parameter one can change: [key, label, step, isTemp]
export type ParamField = [string, string, string, boolean];

// Values come in the conversion's unit (unit) and are shown in the user's: its symbol is the user's
export function symbol(): string { return unitSymbol(userUnit()); }

export function temp(v: Maybe<number>, unit: unknown, digits?: number): string { return formatTemp(v, unit, digits); }

// A difference (a standard deviation): scaled to the user's unit, not shifted
export function delta(v: Maybe<number>, unit: unknown, digits?: number): string { return formatDelta(v, unit, digits); }

// A difference, signed (ΔT, or the effect of the parameters changed)
export function signed(v: Maybe<number>, unit: unknown, digits?: number): string { return formatDelta(v, unit, digits, true); }

// A temperature typed in the user's unit, in the conversion's, as the API takes it
export function typedTemp(x: number, unit: unknown): number {
    return Math.round((convertTemp(x, userUnit(), unit) as number) * 10000) / 10000;
}

// A stored temperature as the user would type it
export function shownTemp(x: number | string, unit: unknown): string {
    return String(Math.round((convertTemp(x, unit) as number) * 100) / 100);
}

export function percent(share: Maybe<number>): string {
    return share === null || share === undefined ? "" : formatNumber(share * 100, 1, " %");
}

export function isValue(v: Maybe<number>): v is number { return v !== null && v !== undefined && !isNaN(v); }

export function lengthText(v: Maybe<number>, pixels?: boolean): string {
    return formatNumber(v, pixels ? 0 : 1, pixels ? " px" : " m");
}

// A drawing's vertices as the geometry the API takes, or null if too few
export function geometryOf(tool: Tool | null, coords: Coords[]): Geometry | null {
    if (!coords.length) return null;
    if (tool === "point") return {type: "Point", coordinates: coords[0]};
    if (tool === "line") return coords.length >= 2 ? {type: "LineString", coordinates: coords} : null;
    if (coords.length < 3) return null;
    return {type: "Polygon", coordinates: [coords.concat([coords[0]])]};
}

// The isotherm as the API takes it ("above,T", "below,T", "between,A,B"; "" for none), or {error}: a and b are
// typed in the user's unit, the value is in the conversion's (unit)
export function isothermParam(mode: string, a: string, b: string, unit: unknown): {value?: string; error?: string} {
    if (!mode) return {value: ""};
    const x = parseFloat(a), y = parseFloat(b);
    if (isNaN(x)) return {error: "The isotherm needs a temperature"};
    if (mode !== "between") return {value: mode + "," + typedTemp(x, unit)};
    if (isNaN(y)) return {error: "The isotherm needs two temperatures"};
    if (!(y > x)) return {error: "The second temperature must be above the first"};
    return {value: "between," + typedTemp(x, unit) + "," + typedTemp(y, unit)};
}

// A stored isotherm (in the conversion's unit) in the user's
export function isothermText(value: Maybe<string>, unit: unknown): string {
    if (!value) return "";
    const p = String(value).split(",");
    if (p[0] === "between") return "between " + shownTemp(p[1], unit) + " and " + shownTemp(p[2], unit) + " " + symbol();
    return p[0] + " " + shownTemp(p[1], unit) + " " + symbol();
}

export interface Row {label: string; values: string[]; difference?: string}

type Key = "value" | "mean" | "min" | "max" | "std" | "surroundings" | "delta_t";

// A measure's figures, as rows of [label, value(s)]: a column per result (as converted, then changed) and their
// difference when there are two
export function resultRows(results: Result[], unit: unknown, pixels?: boolean): Row[] {
    const a = results[0];
    const rows: Row[] = [];
    const units = pixels ? {length: " px", area: " px²", perimeter: " px"} : {length: " m", area: " m²", perimeter: " m"};
    // A size once when the results share it (the same shape), else each result's own (two compared)
    function size(label: string, key: "length" | "area" | "perimeter") {
        let vs = results.map((r) => r[key] === undefined ? null : r[key]);
        if (vs.every((v) => v === null)) return;
        if (vs.every((v) => v === vs[0])) vs = [vs[0]];
        rows.push({label, values: vs.map((v) => v === null ? "" : formatNumber(v, pixels ? 0 : 2, units[key]))});
    }
    size("Length", "length");
    size("Area", "area");
    // A visual mosaic's shape has its size alone: its perimeter too, and no pixels measured
    const sizeAlone = results.every((r) => !isPresent(r.mean) && !isPresent(r.value));
    if (sizeAlone) size("Perimeter", "perimeter");
    function figure(label: string, key: Key, fmt: (v: Maybe<number>) => string, diffFmt: (v: number) => string) {
        const vs = results.map((r) => r[key]);
        if (vs.every((v) => v === null || v === undefined)) return;
        const row: Row = {label, values: vs.map(fmt)};
        if (results.length === 2 && isPresent(vs[0]) && isPresent(vs[1])) row.difference = diffFmt(vs[1] - vs[0]);
        rows.push(row);
    }
    const t = (v: Maybe<number>) => temp(v, unit);
    const d = (v: Maybe<number>) => signed(v, unit);
    figure("At the spot", "value", t, d);
    figure("Mean", "mean", t, d);
    if (a.kind !== "Point") {
        figure("Min", "min", t, d);
        figure("Max", "max", t, d);
    }
    figure("Std dev", "std", (v) => delta(v, unit), d);
    figure("Surroundings", "surroundings", t, d);
    figure("ΔT", "delta_t", d, d);
    const share = results.map((r) => r.isotherm ? r.isotherm.share : null);
    if (share.some(isPresent)) {
        rows.push({label: "In the isotherm", values: share.map(percent),
                   difference: results.length === 2 && isPresent(share[0]) && isPresent(share[1]) ?
                       (share[1] - share[0] > 0 ? "+" : "") + formatNumber((share[1] - share[0]) * 100, 1, " %") : undefined});
    }
    function height(label: string, vs: Maybe<number>[]) {
        if (!vs.some(isPresent)) return;
        const row: Row = {label, values: vs.map((v) => isPresent(v) ? formatNumber(v, 1, " m") : "")};
        if (results.length === 2 && isPresent(vs[0]) && isPresent(vs[1])) {
            row.difference = (vs[1] - vs[0] > 0 ? "+" : "") + formatNumber(vs[1] - vs[0], 1, " m");
        }
        rows.push(row);
    }
    height("Ground height", results.map((r) => r.height));
    height("Lowest height", results.map((r) => r.heights?.min));
    height("Mean height", results.map((r) => r.heights?.mean));
    height("Highest height", results.map((r) => r.heights?.max));
    if (!sizeAlone) rows.push({label: "Pixels", values: results.map((r) => String(r.valid_pixels || 0))});
    return rows;
}

function isPresent<T>(v: T | null | undefined): v is T { return v !== null && v !== undefined; }

// What a measure's shape is called: a box or a circle (shape: how it was drawn), else its geometry's kind
export function shapeLabel(result: Maybe<Result>, shape?: Maybe<Shape>): string {
    return (shape && DRAWN_LABELS[shape.kind]) || SHAPE_LABELS[(result || {}).kind || ""] || "";
}

// A shape's size on a mosaic: a line's length, an area's area and perimeter ("" for a spot)
export function sizeText(r: {length?: Maybe<number>; area?: Maybe<number>; perimeter?: Maybe<number>}): string {
    if (isPresent(r.length)) return formatNumber(r.length, 2, " m");
    if (!isPresent(r.area)) return "";
    return formatNumber(r.area, 2, " m²") + (isPresent(r.perimeter) ? ", perimeter " + formatNumber(r.perimeter, 2, " m") : "");
}

// The sample of a profile nearest a point
export function nearestIndex(points: Maybe<Coords[]>, coords: Coords, pixels?: boolean): number {
    const k = pixels ? 1 : Math.cos(coords[1] * Math.PI / 180);
    let best = -1, bestD = Infinity;
    (points || []).forEach((p, i) => {
        const dx = (p[0] - coords[0]) * k, dy = p[1] - coords[1], d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
    });
    return best;
}

export function targetLabel(m: {target: string; frame?: string | null}): string {
    if (m.target === "frame") return "Frame " + String(m.frame || "").split("/").pop();
    return TARGET_LABELS[m.target] || m.target;
}

// A measurement's own parameters (in the conversion's unit) as text
export function paramsText(parameters: Maybe<Record<string, number | null>>, fields: ParamField[], unit: unknown): string {
    const p = parameters || {};
    return fields.filter((f) => isPresent(p[f[0]])).map((f) =>
        f[1].toLowerCase() + " " + (f[3] ? shownTemp(p[f[0]]!, unit) + " " + symbol() : String(p[f[0]]))).join(", ");
}

// A saved measurement's main figure: a spot's temperature, else the mean and ΔT; on a visual mosaic, its size. A frame's
// measurement measured again keeps the frame as converted in result, its own in changed.
export function measurementFigure(m: Measurement, unit: unknown): string {
    const r = m.values?.changed || m.values?.result || {};
    if (m.target === "visual") return sizeText(r);
    if (r.kind === "Point") return temp(isPresent(r.value) ? r.value : r.mean, unit, 1);
    return temp(r.mean, unit, 1) + (isPresent(r.delta_t) ? ", ΔT " + signed(r.delta_t, unit, 1) : "");
}

// The ids compared once id is ticked (on) or unticked: two at most, a third dropping the first ticked
export function toggleCompared(compared: Maybe<number[]>, id: number, on: boolean): number[] {
    const out = (compared || []).filter((x) => x !== id);
    if (on) out.push(id);
    return out.slice(-2);
}

// A box's corners from two opposite ones
export function boxCoords(a: Coords, b: Coords): Coords[] { return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; }

// A circle's vertices around c of a radius in the map's distance (see circleCoords), or null
export function circleAround(c: Coords, radius: number, distance: (a: Coords, b: Coords) => number): Coords[] | null {
    const step = 1e-4, scale = distance(c, [c[0] + step, c[1]]) / step;
    if (!(radius > 0) || !(scale > 0)) return null;
    return circleCoords(c, [c[0] + radius / scale, c[1]], distance)?.coords || null;
}

// A circle's vertices around c through e, as a polygon's, and its radius in the map's distance (metres on a mosaic,
// pixels on a frame): distance(c, d) -> how far apart two points are
export function circleCoords(c: Coords, e: Coords, distance: (a: Coords, b: Coords) => number):
        {coords: Coords[]; radius: number} | null {
    const dx = Math.abs(e[0] - c[0]), dy = Math.abs(e[1] - c[1]), d = Math.max(dx, dy);
    const r = distance(c, e);
    if (!d || !r) return null;
    // How far a unit along each axis goes, to draw the circle round where the axes' scales differ (lon/lat)
    let sx = distance(c, [c[0] + d, c[1]]) / d, sy = distance(c, [c[0], c[1] + d]) / d;
    if (!sx) sx = sy;
    if (!sy) sy = sx;
    const coords: Coords[] = [];
    for (let i = 0; i < CIRCLE_VERTICES; i++) {
        const a = i / CIRCLE_VERTICES * 2 * Math.PI;
        coords.push([c[0] + r * Math.cos(a) / sx, c[1] + r * Math.sin(a) / sy]);
    }
    return {coords, radius: r};
}
