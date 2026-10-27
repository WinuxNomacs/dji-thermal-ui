// The measuring tools on a Leaflet map (spot, line, area, box and circle), what was measured shown on it, and the
// keys that finish or cancel a shape
import L from "leaflet";
import {boxCoords, circleCoords, type Coords, type Geometry, geometryOf, lengthText, type Result, type Shape, temp,
        type Tool} from "./measure";

// A click this soon after a drag ends is the drag's own, not a click
const DRAG_CLICK_MS = 400;
const STYLE: L.PathOptions = {color: "#00e5ff", weight: 2, fillOpacity: 0.1};
// What is being drawn lets clicks through to the map: the browser fires a double click only when both of its clicks
// reach the same element, and the first one draws a vertex under the cursor
const PREVIEW: L.PathOptions = {...STYLE, interactive: false};

export interface DrawingOptions {
    map: L.Map;
    toCoords: (latlng: L.LatLng) => Coords;
    fromCoords: (coords: Coords) => L.LatLng;
    onDone: (geometry: Geometry, shape?: Shape) => void;    // shape: how a box or circle was drawn
    onChange?: () => void;                                  // a vertex added
    onClick?: (e: L.LeafletMouseEvent) => void;             // a click while no tool is on
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
    private preview: L.LayerGroup;
    private shown: L.LayerGroup;
    private cursor: L.LayerGroup;

    constructor(private opts: DrawingOptions) {
        const map = opts.map;
        this.preview = L.layerGroup().addTo(map);
        this.shown = L.layerGroup().addTo(map);
        this.cursor = L.layerGroup().addTo(map);

        map.on("mousedown", (e: L.LeafletMouseEvent) => {
            if (dragged(this.tool_)) this.drag = {from: opts.toCoords(e.latlng), shape: null};
        });
        map.on("mousemove", (e: L.LeafletMouseEvent) => {
            if (!this.drag) return;
            this.drag.shape = this.dragShape(this.drag.from, opts.toCoords(e.latlng));
            this.preview.clearLayers();
            if (!this.drag.shape) return;
            L.polygon(this.latlngs(ring(this.drag.shape.geometry)), STYLE).addTo(this.preview)
                .bindTooltip(this.drag.shape.size, {permanent: true, direction: "center"});
        });
        map.on("mouseup", (e: L.LeafletMouseEvent) => {
            if (!this.drag) return;
            const d = this.dragShape(this.drag.from, opts.toCoords(e.latlng)) || this.drag.shape;
            this.drag = null;
            this.dragEnded = Date.now();
            this.preview.clearLayers();
            // A click, or a drag too small to make a shape, keeps the tool on
            if (!d) return;
            this.stop();
            opts.onDone(d.geometry, d.shape);
        });
        map.on("click", (e: L.LeafletMouseEvent) => {
            if (Date.now() - this.dragEnded < DRAG_CLICK_MS) return;
            if (!this.tool_) { opts.onClick?.(e); return; }
            if (dragged(this.tool_)) return;
            this.points.push(opts.toCoords(e.latlng));
            if (this.tool_ === "point") { this.finish(); return; }
            this.redraw();
            opts.onChange?.();
        });
        map.on("dblclick", () => {
            if (!this.tool_ || this.tool_ === "point") return;
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

    // Ends the line or area being drawn: false when it has too few points
    finish(): boolean {
        const g = geometryOf(this.tool_, this.points);
        if (!g) return false;
        this.stop();
        this.opts.onDone(g);
        return true;
    }

    // A measured geometry on the map, with its hottest and coldest pixels
    show(geometry: Geometry | null | undefined, result?: Result | null, unit?: unknown) {
        const {fromCoords, onLineHover, toCoords} = this.opts;
        this.shown.clearLayers();
        if (!geometry) return;
        if (geometry.type === "Point") {
            L.circleMarker(fromCoords(geometry.coordinates), {radius: 6, color: STYLE.color, weight: 2}).addTo(this.shown);
        } else if (geometry.type === "LineString") {
            L.polyline(this.latlngs(geometry.coordinates), STYLE).addTo(this.shown);
            if (onLineHover) {
                // A wider, invisible line, easier to point at
                L.polyline(this.latlngs(geometry.coordinates), {weight: 14, opacity: 0}).addTo(this.shown)
                    .on("mousemove", (e) => onLineHover(toCoords((e as L.LeafletMouseEvent).latlng)))
                    .on("mouseout", () => onLineHover(null));
            }
        } else {
            L.polygon(this.latlngs(ring(geometry)), STYLE).addTo(this.shown);
        }
        if (!result || geometry.type === "Point") return;
        ([[result.max_location, result.max, "#ff1744", "Hottest"], [result.min_location, result.min, "#2979ff", "Coldest"]] as const)
            .forEach(([at, v, fill, label]) => {
                if (!at) return;
                L.circleMarker(fromCoords(at), {radius: 5, color: "#fff", weight: 1, fillColor: fill, fillOpacity: 1})
                    .bindTooltip(label + ": " + temp(v, unit)).addTo(this.shown);
            });
    }

    // A marker on the shown line where the profile's cursor is (null hides it)
    showCursor(coords: Coords | null) {
        this.cursor.clearLayers();
        if (coords) {
            L.circleMarker(this.opts.fromCoords(coords), {radius: 5, color: "#fff", weight: 2, fillColor: "#ffea00", fillOpacity: 1})
                .addTo(this.cursor);
        }
    }

    clear() {
        this.shown.clearLayers();
        this.cursor.clearLayers();
    }

    private setHandlers(doubleClickZoom: boolean, dragging: boolean) {
        const map = this.opts.map;
        map.doubleClickZoom?.[doubleClickZoom ? "enable" : "disable"]();
        map.dragging?.[dragging ? "enable" : "disable"]();
    }

    private distance(a: Coords, b: Coords): number {
        return this.opts.map.distance(this.opts.fromCoords(a), this.opts.fromCoords(b));
    }

    private latlngs(coords: Coords[]): L.LatLng[] { return coords.map(this.opts.fromCoords); }

    // What a drag from a to b draws (size: its width and height, or its radius), or null
    private dragShape(a: Coords, b: Coords): DragShape | null {
        const pixels = this.opts.pixels;
        if (this.tool_ === "box") {
            if (a[0] === b[0] || a[1] === b[1]) return null;
            const c = boxCoords(a, b);
            return {geometry: geometryOf("area", c)!, shape: {kind: "box"},
                    size: lengthText(this.distance(c[0], c[1]), pixels) + " × " + lengthText(this.distance(c[1], c[2]), pixels)};
        }
        const circle = circleCoords(a, b, (p, q) => this.distance(p, q));
        if (!circle) return null;
        return {geometry: geometryOf("area", circle.coords)!, shape: {kind: "circle", center: a, radius: circle.radius},
                size: "radius " + lengthText(circle.radius, pixels)};
    }

    private redraw() {
        this.preview.clearLayers();
        if (!this.tool_) return;
        if (this.points.length > 1) {
            const ll = this.latlngs(this.points);
            (this.tool_ === "area" ? L.polygon(ll, PREVIEW) : L.polyline(ll, PREVIEW)).addTo(this.preview);
        }
        this.points.forEach((p) => {
            L.circleMarker(this.opts.fromCoords(p), {radius: 3, color: STYLE.color, interactive: false}).addTo(this.preview);
        });
    }
}

// A polygon's outer ring without its closing point
function ring(g: Geometry): Coords[] {
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
