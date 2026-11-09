// The pages' maps on OpenLayers: a map of mosaics with its basemaps (basemaps.ts) and their switch, its
// scale and a place for the colour scale; a frame's map, in its pixels; the values the server sends, coloured in the
// browser (colour.ts); a visual mosaic's colour tiles; a layer drawn only left of a swipe line; tips shown over what is
// drawn; and the values as drawn, for the PNG export
import type {Coordinate} from "ol/coordinate";
import Feature from "ol/Feature";
import OlMap from "ol/Map";
import Overlay from "ol/Overlay";
import View from "ol/View";
import Attribution from "ol/control/Attribution";
import Control from "ol/control/Control";
import ScaleLine from "ol/control/ScaleLine";
import Zoom from "ol/control/Zoom";
import Point from "ol/geom/Point";
import {defaults as defaultInteractions} from "ol/interaction/defaults";
import ImageLayer from "ol/layer/Image";
import type Layer from "ol/layer/Layer";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import WebGLTileLayer from "ol/layer/WebGLTile";
import Projection from "ol/proj/Projection";
import {fromLonLat, toLonLat, transformExtent} from "ol/proj";
import type RenderEvent from "ol/render/Event";
import {getRenderPixel} from "ol/render";
import {getDistance} from "ol/sphere";
import DataTile from "ol/source/DataTile";
import ImageStatic from "ol/source/ImageStatic";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import TileGrid from "ol/tilegrid/TileGrid";
import {createXYZ} from "ol/tilegrid";
import {addBasemaps, type Basemap} from "./basemaps";
import {type Colouring, colourStyle, decodeValues, sharpenSigma} from "./colour";

export type {Basemap};

export const MAX_ZOOM = 26;
// A mosaic's data tiles: their size and the gutter around them (the server's DATA_TILE_SIZE and DATA_GUTTER)
export const DATA_TILE = 256, DATA_GUTTER = 8;
const LONLAT = "EPSG:4326", MERCATOR = "EPSG:3857";

// A frame's pixels, y upwards (a row is at -y), as the frame page's maps and layers have them
export const FRAME_PIXELS = new Projection({code: "frame-pixels", units: "pixels", extent: [0, -65536, 65536, 0]});

export const lonLatToMap = (c: Coordinate): Coordinate => fromLonLat(c);
export const mapToLonLat = (c: Coordinate): Coordinate => toLonLat(c);
export const mercatorBounds = (b: number[]) => transformExtent(b, LONLAT, MERCATOR);

// The interactions without rotation (the maps are always north up)
const interactions = (keyboard = true) => defaultInteractions({altShiftDragRotate: false, pinchRotate: false, keyboard});

// A map of mosaics (view: another map's, to move with it): the basemaps (the default one shown, else none) with their
// switch, the scale and the colour scale's place
export function mosaicMap(el: HTMLElement, basemaps: Basemap[], view?: View): {map: OlMap; legend: HTMLDivElement} {
    const map = new OlMap({target: el, interactions: interactions(),
                           controls: [new Zoom(), new Attribution({collapsible: true}), new ScaleLine({units: "metric"})],
                           view: view || new View({center: [0, 0], zoom: 2, maxZoom: MAX_ZOOM})});
    addBasemaps(map, basemaps);
    return {map, legend: addLegend(map)};
}

// A frame's map, in its pixels (view: another pane's, to move with it)
export function frameMap(el: HTMLElement, view?: View, controls = true): OlMap {
    return new OlMap({target: el, interactions: interactions(false), controls: controls ? [new Zoom()] : [],
                      view: view || frameView()});
}

// A view of a frame's pixels, zoomed out at most to maxResolution pixels a screen pixel (a visual pair's are more)
export function frameView(maxResolution = 8): View {
    return new View({projection: FRAME_PIXELS, center: [0, 0], resolution: 1, minResolution: 1 / 64, maxResolution});
}

// A small map of points with nothing under them (where the frames were taken)
export function pointsMap(el: HTMLElement): OlMap {
    return new OlMap({target: el, interactions: interactions(false), controls: [],
                      view: new View({center: [0, 0], zoom: 2, maxZoom: 19})});
}

// A map fitted to bounds (lon/lat: west, south, east, north; or the map's own when mapped): false when it has no size
// to fit them in (hidden)
export function fitBounds(map: OlMap, bounds: number[], mapped = false, padding = 0): boolean {
    const size = map.getSize();
    if (!size || !size[0] || !size[1]) return false;
    map.getView().fit(mapped ? bounds : mercatorBounds(bounds), {size, padding: [padding, padding, padding, padding]});
    return true;
}

// The colour scale's place on the map (bottom right), for the page to render into
export function addLegend(map: OlMap): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "map-legend ol-unselectable ol-control";
    map.addControl(new Control({element: el}));
    return el;
}

// What is drawn over a map (measurements, markers), above its mosaic
export function vectorLayer(map: OlMap, zIndex = 10): VectorSource {
    const source = new VectorSource();
    map.addLayer(new VectorLayer({source, zIndex, updateWhileInteracting: true}));
    return source;
}

// A tip shown by the cursor over a feature drawn with one (its "tip" property)
export function hoverTips(map: OlMap) {
    const el = document.createElement("div");
    el.className = "map-tip";
    el.hidden = true;
    const tip = new Overlay({element: el, offset: [10, -10], positioning: "bottom-left", stopEvent: false});
    map.addOverlay(tip);
    map.on("pointermove", (e) => {
        if (e.dragging) return;
        const f = map.forEachFeatureAtPixel(e.pixel, (x) => x.get("tip") ? x : undefined, {hitTolerance: 3});
        el.hidden = !f;
        if (f) {
            el.textContent = String(f.get("tip"));
            tip.setPosition(e.coordinate);
        }
    });
    map.getViewport()?.addEventListener("mouseleave", () => { el.hidden = true; });
}

// A tip that stays where it is put (the size of a box or circle being drawn): set(null) hides it
export function fixedTip(map: OlMap, className = "map-tip map-tip-center"): (at: Coordinate | null, text?: string) => void {
    const el = document.createElement("div");
    el.className = className;
    el.hidden = true;
    const tip = new Overlay({element: el, positioning: "center-center", stopEvent: false});
    map.addOverlay(tip);
    return (at, text) => {
        el.hidden = !at;
        el.textContent = text || "";
        tip.setPosition(at || undefined);
    };
}

// The metres a map's pixel spans across its middle (a mosaic's map)
export function metresPerPixel(map: OlMap): number {
    const size = map.getSize();
    if (!size || !size[0]) return 0;
    const y = size[1] / 2, a = map.getCoordinateFromPixel([0, y]), b = map.getCoordinateFromPixel([size[0], y]);
    return a && b ? getDistance(toLonLat(a), toLonLat(b)) / size[0] : 0;
}

// A raster's pixel in the map's metres, from its bounds (lon/lat) and its width in pixels; undefined when unknown
export function rasterPixel(bounds: number[] | null | undefined, width: number | null | undefined): number | undefined {
    if (!bounds || !width) return undefined;
    const b = mercatorBounds(bounds);
    return (b[2] - b[0]) / width;
}

// What a thermal layer reads: a mosaic's data tiles (url: with {z}, {x} and {y}, within bounds in lon/lat, up to
// maxZoom; pixel: the raster's pixel in the map's metres, for the unsharp mask), or a frame's values
export type Values =
    {kind: "tiles"; url: string; bounds: number[]; maxZoom: number; gutter?: number; pixel?: number} |
    {kind: "frame"; key: string; values: Float32Array; width: number; height: number};

const tileUrl = (url: string, z: number, x: number, y: number) =>
    url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));

async function loadTile(url: string, size: number, signal: AbortSignal): Promise<Float32Array> {
    const res = await fetch(url, {credentials: "same-origin", signal});
    if (!res.ok) throw new Error("No values here (" + res.status + ")");
    return decodeValues(await res.arrayBuffer(), size, size);
}

function valuesSource(v: Values): DataTile {
    if (v.kind === "frame") {
        const extent = [0, -v.height, v.width, 0];
        return new DataTile({projection: FRAME_PIXELS, bandCount: 1, interpolate: false, transition: 0,
                             tileGrid: new TileGrid({extent, origin: [0, 0], resolutions: [1], tileSize: [v.width, v.height]}),
                             loader: () => v.values});
    }
    const gutter = v.gutter ?? 0, size = DATA_TILE + 2 * gutter;
    return new DataTile({bandCount: 1, interpolate: false, gutter, maxZoom: v.maxZoom, tileSize: DATA_TILE, transition: 0,
                         loader: (z, x, y, {signal}) => loadTile(tileUrl(v.url, z, x, y), size, signal)});
}

const valuesKey = (v: Values) => v.kind === "frame" ? "frame:" + v.key : "tiles:" + v.url + ":" + v.maxZoom;

// A mosaic's values or a frame's, coloured in the browser; the map's element says what it reads (data-values)
export class ThermalLayer {
    readonly layer: WebGLTileLayer;
    private key = "";
    private colouring: Colouring;
    private source: Values;

    // marked: the map's element names the values drawn (data-values), as the page's main layer does
    constructor(private map: OlMap, values: Values, colouring: Colouring, private marked = true) {
        this.source = values;
        this.colouring = colouring;
        const extent = values.kind === "tiles" ? mercatorBounds(values.bounds) : [0, -values.height, values.width, 0];
        this.layer = new WebGLTileLayer({source: valuesSource(values), extent, style: this.style(), cacheSize: 1024});
        this.key = valuesKey(values);
        this.mark();
        map.addLayer(this.layer);
        // The unsharp mask reaches as far in the raster's pixels whatever the zoom (and whichever view the map has)
        map.on("moveend", this.zoomed);
    }

    // Other values: a new source when they are not the same
    setValues(values: Values) {
        const key = valuesKey(values);
        this.source = values;
        if (key === this.key) return;
        this.key = key;
        this.layer.setExtent(values.kind === "tiles" ? mercatorBounds(values.bounds) : [0, -values.height, values.width, 0]);
        this.layer.setSource(valuesSource(values));
        this.mark();
        this.layer.setStyle(this.style());
    }

    // The values were made again under the same address (a mosaic rebuilt): the next setValues asks for them anew
    forget() {
        this.key = "";
    }

    // Coloured otherwise: the style compiled again only when its expression is not the same, else its variables set
    // (as a slider dragged changes the range or the sharpening, quickly enough to follow it)
    setColouring(colouring: Colouring) {
        const before = JSON.stringify(colourStyle(this.colouring).color);
        this.colouring = colouring;
        const style = this.style();
        if (JSON.stringify(style.color) !== before) this.layer.setStyle(style);
        else this.layer.updateStyleVariables(style.variables);
    }

    remove() {
        this.map.un("moveend", this.zoomed);
        this.map.removeLayer(this.layer);
        this.layer.dispose();
    }

    private mark() {
        const el = this.marked && this.map.getTargetElement();
        if (el) el.dataset.values = this.source.kind === "tiles" ? this.source.url : this.source.key;
    }

    private style() {
        return colourStyle(this.colouring, this.sigma());
    }

    // The unsharp mask's sigma in the pixels drawn: the raster's pixel in those of the tiles shown now (a frame's are
    // its own)
    private sigma(): number {
        const v = this.source, resolution = this.map.getView().getResolution();
        if (v.kind !== "tiles" || !v.pixel || !resolution) return 1;
        const grid = createXYZ({maxZoom: v.maxZoom, tileSize: DATA_TILE});
        return sharpenSigma(v.pixel, grid.getResolution(grid.getZForResolution(resolution)));
    }

    private zoomed = () => {
        if (this.colouring.sharpen) this.layer.updateStyleVariables({sigma: this.sigma()});
    };
}

// A visual mosaic's colour tiles (url: with {z}, {x} and {y}) over its bounds (lon/lat), above the values and under
// what is drawn; hidden until it is shown
export function visualLayer(map: OlMap, url: string, bounds: number[], maxZoom: number): TileLayer<XYZ> {
    const layer = new TileLayer({source: new XYZ({url, maxZoom, transition: 0}), extent: mercatorBounds(bounds), zIndex: 1,
                                 visible: false});
    map.addLayer(layer);
    return layer;
}

// A layer drawn only left of a line share() % across its map (all of it while share() is null): cut with the scissor
// on WebGL, clipped on a canvas. Gives what takes the cut away.
export function clipLeft(layer: Layer, share: () => number | null): () => void {
    const before = (e: RenderEvent) => {
        const s = share(), size = e.frameState?.size;
        if (s === null || !size) return;
        const x = size[0] * s / 100, ctx = e.context;
        if (ctx instanceof CanvasRenderingContext2D) {
            const corners = [[0, 0], [x, 0], [x, size[1]], [0, size[1]]].map((p) => getRenderPixel(e, p));
            ctx.save();
            ctx.beginPath();
            corners.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
            ctx.closePath();
            ctx.clip();
        } else if (ctx) {
            const gl = ctx as WebGLRenderingContext, low = getRenderPixel(e, [0, size[1]]), high = getRenderPixel(e, [x, 0]);
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(low[0], low[1], Math.max(0, high[0] - low[0]), high[1] - low[1]);
        }
    };
    const after = (e: RenderEvent) => {
        if (share() === null) return;
        const ctx = e.context;
        if (ctx instanceof CanvasRenderingContext2D) ctx.restore();
        else if (ctx) (ctx as WebGLRenderingContext).disable((ctx as WebGLRenderingContext).SCISSOR_TEST);
    };
    layer.on("prerender", before);
    layer.on("postrender", after);
    return () => { layer.un("prerender", before); layer.un("postrender", after); };
}

// An image of a frame's size (a frame's visual pair) on a frame's map, in its pixels: hidden until it is shown
export function frameImageLayer(map: OlMap): ImageLayer<ImageStatic> {
    const layer = new ImageLayer<ImageStatic>({zIndex: 1, visible: false});
    map.addLayer(layer);
    return layer;
}

export function frameImage(url: string, width: number, height: number): ImageStatic {
    return new ImageStatic({url, imageExtent: [0, -height, width, 0], projection: FRAME_PIXELS, interpolate: true});
}

// The values (or the colour tiles) as drawn on the map (the basemap left out), where they are on the page; null when
// none were drawn within wait milliseconds
export function snapshot(map: OlMap, layer: Layer, wait = 3000): Promise<{image: HTMLCanvasElement; rect: DOMRect} | null> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => { layer.un("postrender", copy); resolve(null); }, wait);
        function copy(e: {context?: unknown}) {
            clearTimeout(timer);
            const src = (e.context as WebGLRenderingContext | undefined)?.canvas as HTMLCanvasElement | undefined;
            if (!src || !src.width) return resolve(null);
            const out = document.createElement("canvas");
            out.width = src.width;
            out.height = src.height;
            out.getContext("2d")!.drawImage(src, 0, 0);
            resolve({image: out, rect: src.getBoundingClientRect()});
        }
        layer.once("postrender", copy);
        map.render();
    });
}

// A point drawn over a map (a cursor, a picked point, a frame on the locator)
export function pointFeature(at: Coordinate, props: Record<string, unknown> = {}): Feature<Point> {
    return new Feature({...props, geometry: new Point(at)});
}
