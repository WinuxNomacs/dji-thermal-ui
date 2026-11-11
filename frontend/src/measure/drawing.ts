// The measuring tools on a map (spot, line, area, box, circle and Delta T), what was measured shown on it, and the keys
// that finish or cancel a shape
import type {Coordinate} from "ol/coordinate";
import Feature from "ol/Feature";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import type OlMap from "ol/Map";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import DoubleClickZoom from "ol/interaction/DoubleClickZoom";
import DragPan from "ol/interaction/DragPan";
import {listen} from "ol/events";
import type VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import {fixedTip, hoverTips, vectorLayer} from "../map/map";
import {boxCoords, circleCoords, type Coords, type Geometry, geometryOf, isDelta, lengthText, type Result, type Shape,
        temp, type Tool} from "./measure";

// A click this soon after a drag ends is the drag's own, not a click
const DRAG_CLICK_MS = 400;
const COLOR = "#00e5ff";
const STYLE = new Style({stroke: new Stroke({color: COLOR, width: 2}), fill: new Fill({color: "rgba(0, 229, 255, 0.1)"})});
const SPOT = new Style({image: new CircleStyle({radius: 6, stroke: new Stroke({color: COLOR, width: 2})})});
const VERTEX = new Style({image: new CircleStyle({radius: 3, stroke: new Stroke({color: COLOR, width: 2})})});
const CURSOR = new Style({image: new CircleStyle({radius: 5, stroke: new Stroke({color: "#fff", width: 2}),
                                                  fill: new Fill({color: "#ffea00"})})});
const extreme = (fill: string) => new Style({image: new CircleStyle({radius: 5, stroke: new Stroke({color: "#fff", width: 1}),
                                                                    fill: new Fill({color: fill})})});
// The cursor is over a shown line this near it, in pixels
const LINE_REACH = 7;

export interface DrawingOptions {
    map: OlMap;
    toCoords: (at: Coordinate) => Coords;                   // a place on the map as the API takes it
    fromCoords: (coords: Coords) => Coordinate;
    distance: (a: Coords, b: Coords) => number;             // metres, or a frame's pixels
    onDone: (geometry: Geometry, shape?: Shape) => void;    // shape: how a box, a circle or a Delta T was drawn
    onChange?: () => void;                                  // a vertex added
    onClick?: (at: Coordinate) => void;                     // a click while no tool is on
    onLineHover?: (coords: Coords | null) => void;          // the cursor over a shown line (null: it left)
    pixels?: boolean;                                       // a frame: lengths in pixels
}

interface DragShape {geometry: Geometry; shape: Shape; size: string}

const dragged = (t: Tool | null) => t === "box" || t === "circle";

export class Drawing {
    private tool_: Tool | null = null;
    private points: Coords[] = [];
    private drag: {from: Coords; shape: DragShape | null} | null = null;
    private dragEnded = 0;
    private preview: VectorSource;
    private shown: VectorSource;
    private cursor: VectorSource;
    private line: Feature | null = null;
    private overLine = false;
    private sizeTip: ReturnType<typeof fixedTip>;

    constructor(private opts: DrawingOptions) {
        const map = opts.map;
        this.shown = vectorLayer(map, 10);
        this.preview = vectorLayer(map, 11);
        this.cursor = vectorLayer(map, 12);
        this.sizeTip = fixedTip(map);
        hoverTips(map);
        const at = (e: MapBrowserEvent) => opts.toCoords(e.coordinate);

        // (pointerdown and pointerup are map events too, but not in Map.on's types)
        listen(map, "pointerdown", (e) => {
            if (dragged(this.tool_)) this.drag = {from: at(e as MapBrowserEvent), shape: null};
        });
        map.on(["pointerdrag", "pointermove"], (e) => {
            const me = e as MapBrowserEvent;
            if (!this.drag) return this.hoverLine(me);
            this.drag.shape = this.dragShape(this.drag.from, at(me));
            this.preview.clear();
            this.sizeTip(null);
            if (!this.drag.shape) return;
            const ring = this.mapped(ringOf(this.drag.shape.geometry)), f = new Feature({geometry: new Polygon([[...ring, ring[0]]])});
            f.setStyle(STYLE);
            this.preview.addFeature(f);
            this.sizeTip(this.centre(ring), this.drag.shape.size);
        });
        listen(map, "pointerup", (e) => {
            if (!this.drag) return;
            const d = this.dragShape(this.drag.from, at(e as MapBrowserEvent)) || this.drag.shape;
            this.drag = null;
            this.dragEnded = Date.now();
            this.preview.clear();
            this.sizeTip(null);
            // A click, or a drag too small to make a shape, keeps the tool on
            if (!d) return;
            this.stop();
            opts.onDone(d.geometry, d.shape);
        });
        map.on("click", (e) => {
            if (Date.now() - this.dragEnded < DRAG_CLICK_MS) return;
            if (!this.tool_) { opts.onClick?.(e.coordinate); return; }
            if (dragged(this.tool_)) return;
            this.points.push(at(e));
            // A spot ends on its click, a Delta T on its second
            if (this.tool_ === "point" || (this.tool_ === "delta" && this.points.length === 2)) { this.finish(); return; }
            this.redraw();
            opts.onChange?.();
        });
        map.on("dblclick", () => {
            if (!this.tool_ || this.tool_ === "point" || this.tool_ === "delta") return;
            // The double click's own two clicks each added the same last point
            if (this.points.length > 1) this.points.pop();
            if (!this.finish()) this.redraw();
        });
    }

    tool(): Tool | null { return this.tool_; }

    count(): number { return this.points.length; }

    start(t: Tool) {
        this.tool_ = t;
        this.points = [];
        this.drag = null;
        this.setHandlers(false, !dragged(t));
        this.redraw();
    }

    stop() {
        this.tool_ = null;
        this.points = [];
        this.drag = null;
        this.setHandlers(true, true);
        this.redraw();
    }

    // Ends the line, area or Delta T being drawn: false when it has too few points
    finish(): boolean {
        const g = geometryOf(this.tool_, this.points);
        if (!g) return false;
        const delta = this.tool_ === "delta";
        this.stop();
        if (delta) this.opts.onDone(g, {kind: "delta"});
        else this.opts.onDone(g);
        return true;
    }

    // A measured geometry on the map, with its hottest and coldest pixels; a Delta T (shape) as its line between its
    // two spots
    show(geometry: Geometry | null | undefined, result?: Result | null, unit?: unknown, shape?: Shape | null) {
        const {fromCoords} = this.opts;
        this.shown.clear();
        this.line = null;
        this.leaveLine();
        if (!geometry) return;
        let f: Feature;
        if (geometry.type === "Point") {
            f = new Feature({geometry: new Point(fromCoords(geometry.coordinates))});
            f.setStyle(SPOT);
        } else if (isDelta(shape) && geometry.type === "LineString") {
            // No profile to follow along it
            f = new Feature({geometry: new LineString(this.mapped(geometry.coordinates))});
            f.setStyle(STYLE);
            geometry.coordinates.forEach((c) => {
                const end = new Feature({geometry: new Point(fromCoords(c))});
                end.setStyle(SPOT);
                this.shown.addFeature(end);
            });
        } else if (geometry.type === "LineString") {
            f = this.line = new Feature({geometry: new LineString(this.mapped(geometry.coordinates))});
            f.setStyle(STYLE);
        } else {
            const ring = this.mapped(ringOf(geometry));
            f = new Feature({geometry: new Polygon([[...ring, ring[0]]])});
            f.setStyle(STYLE);
        }
        this.shown.addFeature(f);
        if (!result || geometry.type === "Point") return;
        ([[result.max_location, result.max, "#ff1744", "Hottest"], [result.min_location, result.min, "#2979ff", "Coldest"]] as const)
            .forEach(([at, v, fill, label]) => {
                if (!at) return;
                const x = new Feature({geometry: new Point(fromCoords(at)), tip: label + ": " + temp(v, unit)});
                x.setStyle(extreme(fill));
                this.shown.addFeature(x);
            });
    }

    // A marker on the shown line where the profile's cursor is (null hides it)
    showCursor(coords: Coords | null) {
        this.cursor.clear();
        if (!coords) return;
        const f = new Feature({geometry: new Point(this.opts.fromCoords(coords))});
        f.setStyle(CURSOR);
        this.cursor.addFeature(f);
    }

    clear() {
        this.shown.clear();
        this.cursor.clear();
        this.line = null;
        this.leaveLine();
    }

    // The cursor over the shown line (within LINE_REACH pixels of it), or leaving it
    private hoverLine(e: MapBrowserEvent) {
        const {map, onLineHover, toCoords} = this.opts;
        if (!onLineHover || !this.line || this.tool_) return this.leaveLine();
        const over = map.forEachFeatureAtPixel(e.pixel, (f) => f === this.line || undefined, {hitTolerance: LINE_REACH});
        if (!over) return this.leaveLine();
        this.overLine = true;
        onLineHover(toCoords(e.coordinate));
    }

    private leaveLine() {
        if (!this.overLine) return;
        this.overLine = false;
        this.opts.onLineHover?.(null);
    }

    private setHandlers(doubleClickZoom: boolean, dragging: boolean) {
        this.opts.map.getInteractions().forEach((i) => {
            if (i instanceof DoubleClickZoom) i.setActive(doubleClickZoom);
            if (i instanceof DragPan) i.setActive(dragging);
        });
    }

    private mapped(coords: Coords[]): Coordinate[] { return coords.map(this.opts.fromCoords); }

    private centre(ring: Coordinate[]): Coordinate {
        const xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1]);
        return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    }

    // What a drag from a to b draws (size: its width and height, or its radius), or null
    private dragShape(a: Coords, b: Coords): DragShape | null {
        const {distance, pixels} = this.opts;
        if (this.tool_ === "box") {
            if (a[0] === b[0] || a[1] === b[1]) return null;
            const c = boxCoords(a, b);
            return {geometry: geometryOf("area", c)!, shape: {kind: "box"},
                    size: lengthText(distance(c[0], c[1]), pixels) + " × " + lengthText(distance(c[1], c[2]), pixels)};
        }
        const circle = circleCoords(a, b, distance);
        if (!circle) return null;
        return {geometry: geometryOf("area", circle.coords)!, shape: {kind: "circle", center: a, radius: circle.radius},
                size: "radius " + lengthText(circle.radius, pixels)};
    }

    private redraw() {
        this.preview.clear();
        if (!this.tool_) return;
        if (this.points.length > 1) {
            const c = this.mapped(this.points);
            const f = new Feature({geometry: this.tool_ === "area" ? new Polygon([[...c, c[0]]]) : new LineString(c)});
            f.setStyle(STYLE);
            this.preview.addFeature(f);
        }
        this.points.forEach((p) => {
            const f = new Feature({geometry: new Point(this.opts.fromCoords(p))});
            f.setStyle(VERTEX);
            this.preview.addFeature(f);
        });
    }
}

// A polygon's outer ring without its closing point
function ringOf(g: Geometry): Coords[] {
    return g.type === "Polygon" ? g.coordinates[0].slice(0, -1) : [];
}

// Whether a key went to a field being typed in (where it is the field's own)
export function inField(el: EventTarget | null): boolean {
    return !!(el && (el as Element).closest && (el as Element).closest("input, select, textarea"));
}

// Enter finishes the shape being drawn and Esc cancels it (not while typing in a field): true when the key was used
export function drawingKey(e: KeyboardEvent, drawing: Drawing | null): boolean {
    if (!drawing || !drawing.tool() || inField(e.target) || e.altKey || e.ctrlKey || e.metaKey) return false;
    if (e.key === "Enter") drawing.finish();
    else if (e.key === "Escape") drawing.stop();
    else return false;
    e.preventDefault();
    return true;
}
