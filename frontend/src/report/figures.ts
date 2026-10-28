// A report's figures: a mosaic (or a frame) drawn off the page by a map of its own, fitted to what each figure
// shows, and made into an image as the PNG export makes one (canvases of WebGL do not print), with the marks drawn
// over it, the colour scale, a scale bar and north. One map at a time: the figures asked while one is drawn wait.
import OlMap from "ol/Map";
import View from "ol/View";
import type {Coordinate} from "ol/coordinate";
import {type Colouring} from "../map/colour";
import {frameMap, lonLatToMap, MAX_ZOOM, mercatorBounds, metresPerPixel, snapshot, ThermalLayer, type Values} from "../map/map";
import {type Coords, type Geometry} from "../measure/measure";
import {type Scale, shapeOnMap, viewCanvas} from "../viewer/canvas";
import {scaleBar} from "../viewer/view";

const RENDER_MS = 20000;        // a figure whose tiles have not all come by then is drawn with those that have
// A frame drawn in software (a browser without a GPU, its shaders compiled the first time) can take seconds: the
// image is waited for this long, and asked for again once
const SNAPSHOT_MS = 10000, SNAPSHOT_TRIES = 2;

// What is drawn over a figure: a measurement or a finding, named, in its colour (the drawing's when none)
export interface Mark {geometry: Geometry; name: string; color?: string}

// A figure: its title, what it is fitted to (in the map's coordinates; the whole mosaic or frame when none), its marks
export interface Ask {key: string; title: string; extent?: number[] | null; marks: Mark[]}

// What the figures are drawn from: the values, how they are coloured, the colour scale under them
export interface Source {values: Values; colouring: Colouring; legend: Scale | null}

export interface Size {width: number; height: number}

let queue: Promise<unknown> = Promise.resolve();

// The figures as images (PNG data URLs) by their keys; null for one that could not be drawn
export function drawFigures(source: Source, asks: Ask[], size: Size): Promise<Record<string, string | null>> {
    const run = queue.then(() => draw(source, asks, size));
    queue = run.catch(() => undefined);
    return run;
}

async function draw(source: Source, asks: Ask[], size: Size): Promise<Record<string, string | null>> {
    const v = source.values, frame = v.kind === "frame";
    const el = document.createElement("div");
    el.className = "report-stage";
    el.style.cssText = "position: fixed; left: -20000px; top: 0; width: " + size.width + "px; height: " + size.height + "px";
    document.body.appendChild(el);
    const map = frame ? frameMap(el, undefined, false) :
        new OlMap({target: el, controls: [], interactions: [], view: new View({center: [0, 0], zoom: 2, maxZoom: MAX_ZOOM})});
    const layer = new ThermalLayer(map, v, source.colouring);
    const whole = v.kind === "frame" ? [0, -v.height, v.width, 0] : mercatorBounds(v.bounds);
    const fromCoords = (c: Coords): Coordinate => frame ? [c[0], -c[1]] : lonLatToMap(c);
    const out: Record<string, string | null> = {};
    try {
        map.updateSize();
        for (const ask of asks) {
            map.getView().fit(ask.extent || whole, {size: [size.width, size.height], padding: [16, 16, 16, 16]});
            await rendered(map);
            let image = null;
            for (let i = 0; i < SNAPSHOT_TRIES && !image; i++) image = await snapshot(map, layer.layer, SNAPSHOT_MS);
            const shapes = ask.marks.map((m) => ({...shapeOnMap(map, m.geometry, fromCoords, m.name), color: m.color}));
            const canvas = viewCanvas({title: ask.title, date: "", panes: [{el, images: image ? [image] : [], shapes}],
                                       legend: source.legend, scale: frame ? null : scaleBar(metresPerPixel(map), 120),
                                       ratio: 2, north: !frame});
            out[ask.key] = image ? canvas.toDataURL("image/png") : null;
        }
    } finally {
        layer.remove();
        map.setTarget(undefined);
        el.remove();
    }
    return out;
}

// Once the map has drawn every tile it asked for
function rendered(map: OlMap): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(done, RENDER_MS);
        function done() {
            clearTimeout(timer);
            map.un("rendercomplete", done);
            resolve();
        }
        map.on("rendercomplete", done);
        map.render();
    });
}
