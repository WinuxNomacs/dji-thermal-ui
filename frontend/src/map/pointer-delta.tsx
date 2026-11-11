// Delta T Around Pointer (in Pointer info, on the viewer and the frame page): the temperature under the pointer against
// the mean of the other pixels in a circle around it, whose radius a slider sets (metres on a mosaic, pixels on a frame),
// the circle outlined on the map with its ΔT in a small tip beside it. Off until ticked; the box and the radii are
// remembered in this browser.
import Feature from "ol/Feature";
import type {Coordinate} from "ol/coordinate";
import Polygon from "ol/geom/Polygon";
import type OlMap from "ol/Map";
import Overlay from "ol/Overlay";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import {useState} from "preact/hooks";
import {formatNumber, type Maybe} from "../core/format";
import {circleAround, type Coords, isValue, signed, temp} from "../measure/measure";
import {vectorLayer} from "./map";

export const POINTER_DELTA_KEY = "thermal-analyzer.pointer-delta";
export const POINTER_DELTA_RADIUS_KEY = "thermal-analyzer.pointer-delta-radius.";

export type DeltaKind = "mosaic" | "frame";

// The radii the slider of each kind of map stops at (metres on a mosaic: 0.25, then every 0.5 to 10; pixels on a
// frame: 3 to 50), the one it starts at, and their unit
function steps(from: number, to: number, step: number): number[] {
    return Array.from({length: Math.round((to - from) / step) + 1}, (_, i) => from + i * step);
}

export const RADIUS_SLIDERS: Record<DeltaKind, {stops: number[]; start: number; unit: string}> = {
    mosaic: {stops: [0.25, ...steps(0.5, 10, 0.5)], start: 2, unit: " m"},
    frame: {stops: steps(3, 50, 1), start: 10, unit: " px"},
};

// What the point requests answer of the circle (?around=): its pixels' mean, min and max and the difference of the
// pixel under the pointer with their mean
export interface Around {radius: number; pixels: number; mean: number | null; min: number | null; max: number | null;
                        delta_t: number | null}

function read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* kept for this visit only */ }
}

// A radius remembered, within the slider's limits, else where the slider starts
export function storedRadius(kind: DeltaKind): number {
    const s = RADIUS_SLIDERS[kind], r = parseFloat(read(POINTER_DELTA_RADIUS_KEY + kind) || "");
    return s.stops.includes(r) ? r : s.start;
}

export interface PointerDelta {on: boolean; radius: number; setOn: (on: boolean) => void; setRadius: (r: number) => void}

// Whether the box is ticked and the radius of this kind of map, and changing them (remembered)
export function usePointerDelta(kind: DeltaKind): PointerDelta {
    const [on, setOnState] = useState(() => read(POINTER_DELTA_KEY) === "1");
    const [radius, setRadiusState] = useState(() => storedRadius(kind));
    return {
        on, radius,
        setOn: (next) => { setOnState(next); write(POINTER_DELTA_KEY, next ? "1" : "0"); },
        setRadius: (r) => { setRadiusState(r); write(POINTER_DELTA_RADIUS_KEY + kind, String(r)); },
    };
}

// What the point requests add to ask for the circle (nothing while the box is unticked)
export function aroundQuery(on: boolean, radius: number): string { return on ? "&around=" + radius : ""; }

const OUTLINE = [new Style({stroke: new Stroke({color: "rgba(0, 0, 0, 0.6)", width: 3})}),
                 new Style({stroke: new Stroke({color: "#fff", width: 1.25})})];

// The circle's outline on a map: show(at, radius) draws it around the place at (to and from: the map's places as
// the measure's coordinates and back; distance in metres or pixels), label(at, text) puts the ΔT tip just right of
// it while it is still around at (none for null), hide() takes both away. A circle moved takes its tip away.
export interface AroundOutline {
    show: (at: Coordinate, radius: number) => void;
    label: (at: Coordinate, text: string | null) => void;
    hide: () => void;
}

export function aroundOutline(map: OlMap, to: (at: Coordinate) => Coords, from: (c: Coords) => Coordinate,
                              distance: (a: Coords, b: Coords) => number): AroundOutline {
    const source = vectorLayer(map, 13);
    const el = document.createElement("div");
    el.className = "map-tip pointer-delta-tip";
    el.hidden = true;
    const tip = new Overlay({element: el, offset: [8, 0], positioning: "center-left", stopEvent: false});
    map.addOverlay(tip);
    // Where the circle is drawn, and its rightmost point (its first vertex), where the tip goes
    let centre: Coordinate | null = null, side: Coordinate | null = null;
    const hide = () => {
        source.clear();
        el.hidden = true;
        centre = side = null;
    };
    return {
        show: (at, radius) => {
            hide();
            const c = to(at);
            const circle = c.every(isFinite) ? circleAround(c, radius, distance) : null;
            if (!circle) return;
            const ring = circle.map(from);
            const f = new Feature({geometry: new Polygon([[...ring, ring[0]]])});
            f.setStyle(OUTLINE);
            source.addFeature(f);
            centre = at;
            side = ring[0];
        },
        label: (at, text) => {
            if (!text || !side || !centre || centre[0] !== at[0] || centre[1] !== at[1]) {
                el.hidden = true;
                return;
            }
            el.textContent = text;
            tip.setPosition(side);
            el.hidden = false;
        },
        hide,
    };
}

// The box and the slider, at the top of Pointer info
export function DeltaControls({kind, delta}: {kind: DeltaKind; delta: PointerDelta}) {
    const s = RADIUS_SLIDERS[kind];
    const shown = kind === "mosaic" ? formatNumber(delta.radius, delta.radius % 0.5 ? 2 : 1, s.unit)
        : formatNumber(delta.radius, 0, s.unit);
    return (<div class="pointer-delta">
        <label class="pointer-delta-box"
               title="The temperature under the pointer against the mean of the other pixels in a circle around it">
            <input type="checkbox" id="pointer-delta" checked={delta.on}
                   onChange={(e) => delta.setOn((e.currentTarget as HTMLInputElement).checked)}/>
            Delta T Around Pointer
        </label>
        {delta.on && <label class="slider" title="The circle's radius, on the ground">Radius
            <input type="range" name="pointer-delta-radius" min={0} max={s.stops.length - 1} step={1}
                   value={Math.max(0, s.stops.indexOf(delta.radius))} aria-valuetext={shown}
                   onInput={(e) => delta.setRadius(s.stops[parseInt(e.currentTarget.value, 10)] ?? s.start)}/>
            <span class="slider-value">{shown}</span>
        </label>}
    </div>);
}

// What the tip beside the circle says: its ΔT, or null where it has none (no tip)
export function deltaText(around: Maybe<Around>, unit: unknown): string | null {
    return around && around.pixels && isValue(around.delta_t) ? "ΔT " + signed(around.delta_t, unit) : null;
}

// The circle's figures, under the values at the point
export function DeltaFigures({around, unit}: {around: Maybe<Around>; unit: unknown}) {
    if (!around) return null;
    if (!around.pixels) return <p class="message" id="pointer-delta-figures">No data in the circle.</p>;
    const rows: [string, string][] = [["Circle mean", temp(around.mean, unit)], ["Min", temp(around.min, unit)],
                                      ["Max", temp(around.max, unit)],
                                      ["ΔT", isValue(around.delta_t) ? signed(around.delta_t, unit) : "no data"],
                                      ["Pixels", String(around.pixels)]];
    return (<table class="table values" id="pointer-delta-figures"><tbody>
        {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
    </tbody></table>);
}
