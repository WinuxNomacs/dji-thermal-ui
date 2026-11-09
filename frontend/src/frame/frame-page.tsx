// A conversion's frames, one at a time: the frame as converted (and beside it, measured again with other parameters),
// its visual pair in its place or beside it (the shapes, the cursor and the readout on it the thermal frame's), its palette, range and image adjustments, the values under the cursor, the drawing tools on the frame and a shape's
// temperatures in a card there (with the isotherm), the frame's figures, where the frames were taken, the measurements saved on it, and the frame as a PNG. The frames of the
// list chosen beside them (all of them, in the mosaic, oblique) are listed beside it, the frame shown chosen there or
// stepped to with ← and →. The view (frame, palette, range, adjustments) and the list are kept in the URL.
import type {Coordinate} from "ol/coordinate";
import type Feature from "ol/Feature";
import type OlMap from "ol/Map";
import type ImageLayer from "ol/layer/Image";
import type ImageStatic from "ol/source/ImageStatic";
import type VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import RegularShape from "ol/style/RegularShape";
import Stroke from "ol/style/Stroke";
import OlStyle from "ol/style/Style";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {type Carried, viewAsked} from "../core/exports";
import {type FlightZone, formatCapture, type Maybe, zoneText} from "../core/format";
import {convertTemp} from "../core/units";
import {ask, askName} from "../components/dialog";
import {ArrowLeft, ChevronLeft, ChevronRight, Download} from "../components/icons";
import {Drawing, drawingKey, inField} from "../measure/drawing";
import {type Coords, type Geometry, isothermParam, type Measured, type Measurement, nearestIndex,
        type Shape, symbol, toggleCompared, typedTemp} from "../measure/measure";
import {type IsothermState, Isotherm, MeasureCard, Measurements, Toolbar} from "../measure/result";
import {type Colouring, isothermRange, readValues} from "../map/colour";
import {fitBounds, frameImage, frameImageLayer, frameMap, frameView, hoverTips, lonLatToMap, pointFeature,
        pointsMap, snapshot, ThermalLayer, vectorLayer} from "../map/map";
import {fromVisual, toVisual, type VisualPair} from "../sources/sources";
import {saveCanvas, type Scale, shapeOnMap, viewCanvas} from "../viewer/canvas";
import {Controls, ImageControls, type Palette, PanelGroup, Section} from "../viewer/panel";
import {adjustQuery, defaultAdjust, defaultRange, fileName, parseRange, readView, shownRange, slidRange, sliderGamma,
        sliderPositions, type Style, takenText, toneShares, viewQuery} from "../viewer/view";
import {captureOrder, type Changes, changeStarts, changesIn, changesQuery, FRAME_LISTS, type FrameEntry, type FrameInfo,
        inMosaics, listFrames, listTitle, newConversionUrl, PARAM_FIELDS, readChanges, valuesUrl} from "./frame";
import {FrameExport} from "./export";
import {FrameList} from "./frame-list";
import {VisualFrames} from "./visual-frames";
import {FrameReadout, type FramePoint, Info, Params} from "./panel";

const HOVER_MS = 120;       // the readout asks for the point the cursor rests on, not every point it crosses
const FOLDED_KEY = "thermal-analyzer.frame.folded";
const LOCATOR_SPOT = new OlStyle({image: new CircleStyle({radius: 4, stroke: new Stroke({color: "#333", width: 1}),
                                                         fill: new Fill({color: "rgba(153, 170, 187, 0.9)"})})});
// A visual photo, over the frames: a hollow square, around its thermal frame's spot when taken with it
const LOCATOR_VISUAL = new OlStyle({image: new RegularShape({points: 4, radius: 7, angle: Math.PI / 4,
                                                          stroke: new Stroke({color: "#ff9100", width: 2})})});
const LOCATOR_VISUAL_KEY = "thermal-analyzer.frame.locator-visual";     // the visual photos on it, "1" (off unless kept)
const LOCATOR_CURRENT = new OlStyle({zIndex: 1, image: new CircleStyle({radius: 6, stroke: new Stroke({color: "#fff", width: 2}),
                                                                        fill: new Fill({color: "#e8562a"})})});

export interface Frames {
    name: string;
    dataset_name?: string;
    description?: string;
    unit?: string;
    normalized?: boolean;
    settings?: Carried | null;
    mosaic_status?: string;
    max_pitch?: number;
    default_palette?: string;
    palettes?: Palette[];
    frames?: FrameEntry[];
    visual_photos?: {path: string; lat: number; lon: number}[];
    flight_zone?: FlightZone | null;
    visual_only?: boolean;      // a visual mosaic of its own: its frames are visual photos, VisualFrames shows them
}

// What is measured: the shape drawn (or a saved measurement shown) and what came back; res undefined while it is
// being measured
interface Current {
    geometry: Geometry;
    shape?: Maybe<Shape>;
    saved?: Measurement | null;
    res?: Measured | null;
    error?: string;
}

// A frame's values (key: the URL they came from)
interface FrameValues {key: string; values: Float32Array; width: number; height: number}

// The frame is in pixels, y downwards: the map's y is -y
const toCoords = (at: Coordinate): Coords => [at[0], -at[1]];
const fromCoords = (c: Coords): Coordinate => [c[0], -c[1]];
// A place on the visual pair's map in the thermal frame's pixels, and back (far off the frames: off the map)
const OFF: Coords = [NaN, NaN];
const fromPair = (pair: VisualPair, at: Coordinate): Coords => fromVisual(pair, [at[0], -at[1]]) || OFF;
const toPair = (pair: VisualPair, c: Coords): Coordinate => { const p = toVisual(pair, c); return p ? [p[0], -p[1]] : OFF; };
const VISUAL_KEY = "thermal-analyzer.frame.visual";
// Which camera's image is shown: the frame's, its visual pair in its place, or both side by side (as kept: "1", "2")
type Camera = "thermal" | "visual" | "both";
const CAMERAS: [Camera, string][] = [["thermal", "Thermal"], ["visual", "Visual"], ["both", "Both"]];
const SIDE = 2;             // the pane of the visual pair beside the frame
const SIDE_MAX_RESOLUTION = 32;
// A view's place and scale (center, resolution) where they are on the other side of a pair: on the visual pair's
// pixels (toPairSide) or back on the frame's; null off the frames
function viewThere(pair: VisualPair, center: Coordinate, resolution: number, toPairSide: boolean) {
    const there = (p: Coordinate) => toPairSide ? toPair(pair, toCoords(p)) : fromCoords(fromPair(pair, p));
    const a = there(center), b = there([center[0] + 100 * resolution, center[1]]);
    if (!a.every(isFinite) || !b.every(isFinite)) return null;
    return {center: a, resolution: Math.hypot(b[0] - a[0], b[1] - a[1]) / 100};
}
const isPlaced = (f: FrameEntry) => typeof f.lat === "number" && typeof f.lon === "number";

// The same shape measured afresh (with another isotherm or other parameters)
const fresh = (c: Current | null): Current | null => c && {geometry: c.geometry, shape: c.shape};

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    datasetId: number;
    datasetName: string;
}

export function FramePage({api, publicUrl, id, datasetId, datasetName}: Props) {
    const base = api + "conversions/" + id;
    const [wanted] = useState(() => readView(location.search));
    // The list of frames shown (in the mosaic, oblique; all of them for none), from the URL; the flight's frames, in
    // the order they were taken, and those of the list in meta
    const [list, setList] = useState(() => new URLSearchParams(location.search).get("list"));
    const [all, setAll] = useState<FrameEntry[]>([]);
    const [meta, setMeta] = useState<Frames | null>(null);
    const [notice, setNotice] = useState("");
    const [status, setStatus] = useState<{text: string; error?: boolean}>({text: ""});
    const [frame, setFrame] = useState<string | null>(null);
    const [info, setInfo] = useState<FrameInfo | null>(null);
    const [style, setStyleState] = useState<Style | null>(null);
    // A slider being dragged: the range or gamma it gives, shown at once (the fields and the scale), drawn when let go
    const [live, setLive] = useState<Partial<Style> | null>(null);
    const [rangeText, setRangeText] = useState<[string, string] | null>(null);
    const [rangeError, setRangeError] = useState("");
    const [curve, setCurve] = useState<number[] | null>(null);
    const [point, setPoint] = useState<Maybe<FramePoint>>(undefined);
    const [tools, setTools] = useState<{tool: ReturnType<Drawing["tool"]>; count: number}>({tool: null, count: 0});
    const [current, setCurrent] = useState<Current | null>(null);
    const [index, setIndex] = useState<number | null>(null);
    const [isotherm, setIsotherm] = useState<IsothermState>({mode: ""});
    const [isoValue, setIsoValue] = useState("");
    const [isoError, setIsoError] = useState("");
    // The parameters changed (temperatures in the user's unit), and what is typed in their fields
    const [changes, setChanges] = useState<Changes>({});
    const [exporting, setExporting] = useState(false);
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [changeError, setChangeError] = useState<{error?: string; field?: string}>({});
    const [saved, setSaved] = useState<Measurement[]>([]);
    const [compared, setCompared] = useState<number[]>([]);
    const [editing, setEditing] = useState<number | null>(null);
    const [saveName, setSaveName] = useState("");
    const [measureError, setMeasureError] = useState("");
    // Each pane's values: as converted, and with the parameters changed
    const [values, setValues] = useState<(FrameValues | null)[]>([null, null]);
    // The visual pair shown instead of the frame or beside it (where it has one), kept from frame to frame and visit to visit
    const [camera, setCameraState] = useState<Camera>(() => {
        try {
            const kept = localStorage.getItem(VISUAL_KEY);
            return kept === "1" ? "visual" : kept === "2" ? "both" : "thermal";
        } catch {
            return "thermal";
        }
    });

    const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const paneEls = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
    const locatorEl = useRef<HTMLDivElement>(null);
    // The panes (the second shown only with parameters changed, the third, SIDE, with the visual pair beside the
    // frame), their images and drawings
    const maps = useRef<OlMap[]>([]);
    const layers = useRef<ThermalLayer[]>([]);
    const pairLayer = useRef<ImageLayer<ImageStatic> | null>(null);
    const sideLayer = useRef<ImageLayer<ImageStatic> | null>(null);
    // The visual pair shown on the first pane, and beside the frame, which their drawings and readouts then map to the
    // frame's pixels
    const shownPair = useRef<VisualPair | null>(null);
    const sidePair = useRef<VisualPair | null>(null);
    // The side pane's view follows the first's (and the reverse), on the other side of the pair
    const following = useRef(false);
    const follow = useRef<() => void>(() => undefined);
    const drawings = useRef<Drawing[]>([]);
    const locator = useRef<{map: OlMap; spots: VectorSource; photos: VectorSource; fitted: boolean} | null>(null);
    const [locatorVisual, setLocatorVisualState] = useState(() => {
        try { return localStorage.getItem(LOCATOR_VISUAL_KEY) === "1"; } catch { return false; }
    });
    // The panes fit the frame when the next image is drawn (a new frame, or one of another size)
    const fit = useRef(true);
    // Counters: only the answer to the latest question is shown
    const asked = useRef({point: 0, frame: 0, curve: 0, measure: 0, saved: 0, values: [0, 0]});

    const unit = meta?.unit;
    const changed = Object.keys(changes).length > 0;
    const changesKey = JSON.stringify(changes);
    const shown: Style | null = style && {...style, ...live};
    const urls = info && frame ? [valuesUrl(api, id, frame, {}), changed ? valuesUrl(api, id, frame, changesIn(changes, unit)) : ""]
        : ["", ""];
    const entry = (meta?.frames || []).find((f) => f.path === frame);
    const placed = (meta?.frames || []).filter(isPlaced);
    const pair = info?.frame === frame ? info?.visual || null : null;
    const onPair = camera === "visual" && !!pair, beside = camera === "both" && !!pair;
    shownPair.current = onPair ? pair : null;
    sidePair.current = beside ? pair : null;

    // What the maps' handlers (set up once) read: this render's values
    const now = useRef({frame, changes, meta, current, locatorVisual});
    now.current = {frame, changes, meta, current, locatorVisual};

    useEffect(() => {
        load();
        // Enter finishes the shape being drawn and Esc cancels it; otherwise Esc closes the measurement's card, and ←
        // and → step through the frames (not while typing)
        const keys = (e: KeyboardEvent) => {
            const d = active();
            if (drawingKey(e, d)) return syncTools();
            if (d || inField(e.target) || e.altKey || e.ctrlKey || e.metaKey || !now.current.frame) return;
            if (e.key === "Escape" && now.current.current) return closeCard();
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            step(e.key === "ArrowLeft" ? -1 : 1);
        };
        document.addEventListener("keydown", keys);
        return () => {
            clearTimeout(hover.current);
            document.removeEventListener("keydown", keys);
            maps.current.forEach((m) => m.setTarget(undefined));
            locator.current?.map.setTarget(undefined);
        };
    }, []);

    async function load() {
        try {
            const r = await readJson<Frames>(await fetch(base + "/frames", {credentials: "same-origin"}));
            if (!r.ok) return setNotice("Could not load the frames.");
            if (r.data.visual_only) return setMeta(r.data);        // VisualFrames shows them
            // All of them for a list without frames, or before the mosaics placed any (a link from before they were
            // built again)
            const ordered = captureOrder(r.data.frames || []);
            const shown = ordered.some(inMosaics) && listFrames(ordered, list).length ? list : null;
            const listed = r.data.frames && listFrames(ordered, shown);
            setList(shown);
            setAll(ordered);
            setMeta({...r.data, frames: listed});
            const paths = (listed || []).map((f) => f.path);
            if (!paths.length) return setStatus({text: "The flight has no thermal frames to show."});
            chooseFrame(wanted.frame && paths.includes(wanted.frame) ? wanted.frame : paths[0]);
        } catch {
            setNotice("Could not load the frames.");
        }
    }

    // The drawing with a tool on, on any pane (the second may not be made while the side one is)
    function active(): Drawing | null { return drawings.current.find((d) => d?.tool()) || null; }

    function syncTools() {
        const d = active();
        setTools({tool: d ? d.tool() : null, count: d ? d.count() : 0});
    }

    function chooseFrame(path: string) {
        drawings.current.forEach((d) => { d.stop(); d.clear(); });
        syncTools();
        fit.current = true;
        asked.current.measure++;
        setFrame(path);
        setCurrent(null);
        setIndex(null);
        setTyped({});
        setChangeError({});
        setMeasureError("");
        setEditing(null);
    }

    // Another list: the frame shown stays if it is in it, else its first is shown
    function chooseList(next: string | null) {
        const listed = listFrames(all, next);
        setList(next);
        setMeta((m) => m && {...m, frames: listed});
        if (listed.length && !listed.some((f) => f.path === frame)) chooseFrame(listed[0].path);
    }

    function step(by: number) {
        const paths = (now.current.meta?.frames || []).map((f) => f.path);
        const i = paths.indexOf(now.current.frame || "") + by;
        if (i >= 0 && i < paths.length) chooseFrame(paths[i]);
    }

    // The frame (or the same one with other parameters) measured: its size, figures and what it was measured with
    useEffect(() => {
        if (!frame) return;
        const n = ++asked.current.frame;
        setStatus({text: "Measuring the frame…"});
        fetch(base + "/frame?frame=" + encodeURIComponent(frame) + changesQuery(changesIn(changes, unit)), {credentials: "same-origin"})
            .then((res) => readJson<FrameInfo>(res))
            .then((r) => {
                if (n !== asked.current.frame) return;
                if (!r.ok) return setStatus({text: errorText(r.data, "Could not measure the frame."), error: true});
                setStatus({text: ""});
                setInfo((old) => {
                    if (!old || old.width !== r.data.width || old.height !== r.data.height) fit.current = true;
                    return r.data;
                });
                setStyleState((s) => s || wantedStyle(r.data));
            })
            .catch(() => { if (n === asked.current.frame) setStatus({text: "Could not measure the frame.", error: true}); });
    }, [frame, changesKey]);

    // The palette, range and adjustments a link asked for, else the frame's own
    function wantedStyle(i: FrameInfo): Style {
        const known = (meta?.palettes || []).some((p) => p.key === wanted.palette);
        return {palette: known ? wanted.palette! : meta?.default_palette || "",
                range: wanted.range || defaultRange({tab: "frame", stats: i.stats}, unit), adjust: wanted.adjust || defaultAdjust()};
    }

    // The measurements saved on the frame
    useEffect(() => { if (frame) loadSaved(); }, [frame]);

    async function loadSaved() {
        const n = ++asked.current.saved;
        try {
            const r = await readJson<{measurements?: Measurement[]}>(await fetch(base + "/measurements?frame=" +
                encodeURIComponent(now.current.frame || ""), {credentials: "same-origin"}));
            if (n !== asked.current.saved || !r.ok) return;
            const items = r.data.measurements || [];
            setSaved(items);
            setCompared((c) => c.filter((x) => items.some((m) => m.id === x)));
        } catch {
            // the list stays as it was
        }
    }

    // A pane's map (with the first one's view: the panes move together; the side pane's following it), its readout,
    // the cursor marked on the other panes, and its drawing
    function setupMap(i: number, el: HTMLDivElement) {
        // no keyboard: the arrows step through the frames
        const m = frameMap(el, i === SIDE ? frameView(SIDE_MAX_RESOLUTION) : maps.current[0]?.getView());
        // The first pane may show the visual pair, and the side pane does: their places are the frame's pixels mapped
        // through it
        const pairOf = () => i === 0 ? shownPair.current : i === SIDE ? sidePair.current : null;
        const to = (at: Coordinate): Coords => { const p = pairOf(); return p ? fromPair(p, at) : toCoords(at); };
        const from = (c: Coords): Coordinate => { const p = pairOf(); return p ? toPair(p, c) : fromCoords(c); };
        m.on("pointermove", (e) => {
            if (e.dragging) return;
            clearTimeout(hover.current);
            const at = to(e.coordinate);
            drawings.current.forEach((d, j) => d?.showCursor(j === i || !at.every(isFinite) ? null : at));
            hover.current = setTimeout(() => readout(at), HOVER_MS);
        });
        m.getViewport()?.addEventListener("mouseleave", () => {
            clearTimeout(hover.current);
            asked.current.point++;
            drawings.current.forEach((d) => d?.showCursor(null));
            setPoint(undefined);
        });
        if (i === SIDE) {
            const first = maps.current[0].getView(), own = m.getView();
            const along = (a: typeof own, b: typeof own, toPairSide: boolean) => () => {
                const p = sidePair.current, c = a.getCenter(), r = a.getResolution();
                const v = !following.current && p && c && r ? viewThere(p, c, r, toPairSide) : null;
                if (!v) return;
                following.current = true;
                b.setCenter(v.center);
                b.setResolution(v.resolution);
                following.current = false;
            };
            follow.current = along(first, own, true);
            const back = along(own, first, false);
            first.on(["change:center", "change:resolution"], () => follow.current());
            own.on(["change:center", "change:resolution"], back);
            sideLayer.current = frameImageLayer(m);
        }
        drawings.current[i] = new Drawing({
            map: m, toCoords: to, fromCoords: from, pixels: true, distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
            onDone: (geometry, shape) => {
                drawings.current.forEach((d) => { if (d.tool()) d.stop(); });
                setCurrent({geometry, shape});
                setIndex(null);
                syncTools();
            },
            onChange: syncTools,
            onLineHover: (coords) => {
                const points = now.current.current?.res?.result?.profile?.points;
                showIndex(coords && points ? nearestIndex(points, coords, true) : null, points);
            },
        });
        if (i === 0) pairLayer.current = frameImageLayer(m);
        maps.current[i] = m;
    }

    // Each pane's values, asked again only when the frame or the parameters changed are others
    useEffect(() => {
        urls.forEach((url, i) => {
            const n = ++asked.current.values[i];
            if (!url || values[i]?.key === url) return;
            fetch(url, {credentials: "same-origin"}).then(readValues)
                .then((v) => { if (n === asked.current.values[i]) setValues((s) => s.map((x, j) => j === i ? {key: url, ...v} : x)); })
                .catch(() => { if (n === asked.current.values[i]) setStatus({text: "Could not load the frame's values.", error: true}); });
        });
    }, [urls[0], urls[1]]);

    // How the frame is coloured, as the palette, range, adjustments and isotherm are (a slider's as it is dragged)
    const colouring: Colouring | null = shown && meta ? {
        colors: (meta.palettes || []).find((p) => p.key === shown.palette)?.color_map || [], range: shown.range,
        shares: shares(shown.adjust), sharpen: shown.adjust.sharpen, isotherm: isothermRange(isoValue)} : null;

    // The panes drawn as the frame, palette, range, adjustments, isotherm and parameters now are: the second pane with
    // the parameters changed
    useEffect(() => {
        const ms = maps.current, first = values[0];
        if (!first || !colouring) return;
        if (!ms[0] && paneEls[0].current) setupMap(0, paneEls[0].current);
        if (changed && values[1] && !ms[1] && paneEls[1].current) setupMap(1, paneEls[1].current);
        if (beside && ms[0] && !ms[SIDE] && paneEls[SIDE].current) setupMap(SIDE, paneEls[SIDE].current);
        values.forEach((v, i) => {
            if (!v || !ms[i]) return;
            const shown = {kind: "frame" as const, key: v.key, values: v.values, width: v.width, height: v.height};
            if (!layers.current[i]) layers.current[i] = new ThermalLayer(ms[i], shown, colouring);
            else {
                layers.current[i].setValues(shown);
                layers.current[i].setColouring(colouring);
            }
        });
        showPair();
        ms.forEach((m) => m?.updateSize());
        const extent = onPair ? [0, -pair!.height, pair!.width, 0] : [0, -first.height, first.width, 0];
        if (fit.current && fitBounds(ms[0], extent, true)) fit.current = false;
        if (beside) follow.current();
        drawLocator();
    }, [values[0]?.key, values[1]?.key, changed, JSON.stringify(colouring), onPair, beside, pair?.frame]);

    // The first pane shows the visual pair instead of the frame's values on the Visual switch; the side pane shows it
    // beside them on Both
    function showPair() {
        const url = frame ? base + "/frame/visual?frame=" + encodeURIComponent(frame) : "";
        ([[pairLayer.current, onPair], [sideLayer.current, beside]] as [ImageLayer<ImageStatic> | null, boolean][]).forEach(([l, on]) => {
            if (!l) return;
            if (on && (l.getSource() as ImageStatic | null)?.getUrl() !== url) l.setSource(frameImage(url, pair!.width, pair!.height));
            l.setVisible(on);
        });
        layers.current[0]?.layer.setVisible(!onPair);
    }

    // The switch: the first pane's view stays on the same place, at the same scale on the ground
    function setCamera(c: Camera) {
        try { localStorage.setItem(VISUAL_KEY, c === "visual" ? "1" : c === "both" ? "2" : "0"); } catch { /* kept for this visit only */ }
        const on = c === "visual", view = maps.current[0]?.getView(), at = view?.getCenter(), r = view?.getResolution();
        if (pair && on !== onPair && view && at && r) {
            const v = viewThere(pair, at, r, on);
            if (v) {
                view.setCenter(v.center);
                view.setResolution(v.resolution);
            } else fit.current = true;
        }
        setCameraState(c);
    }

    // Where the frames were taken, on a small map: the frame shown highlighted, a click on another opens it
    function drawLocator() {
        if (locator.current || !locatorEl.current || !placed.length) return;
        const m = pointsMap(locatorEl.current), spots = vectorLayer(m), photos = vectorLayer(m, 11);
        locator.current = {map: m, spots, photos, fitted: false};
        placed.forEach((f) => spots.addFeature(pointFeature(lonLatToMap([f.lon!, f.lat!]), {path: f.path, tip: f.path})));
        hoverTips(m);
        m.on("click", (e) => {
            const path = m.forEachFeatureAtPixel(e.pixel, (x) => x.get("path") as string, {hitTolerance: 3});
            if (path && path !== now.current.frame) chooseFrame(path);
        });
        fitLocator();
        markLocator();
        drawPhotos();
    }

    // The visual photos under the frames, when switched on: shown, not opened
    function drawPhotos() {
        const l = locator.current;
        if (!l) return;
        l.photos.clear();
        if (!now.current.locatorVisual) return;
        (now.current.meta?.visual_photos || []).forEach((p) => {
            const f = pointFeature(lonLatToMap([p.lon, p.lat]), {tip: p.path});
            f.setStyle(LOCATOR_VISUAL);
            l.photos.addFeature(f);
        });
    }
    function setLocatorVisual(on: boolean) {
        try { localStorage.setItem(LOCATOR_VISUAL_KEY, on ? "1" : "0"); } catch { /* kept for this visit only */ }
        setLocatorVisualState(on);
    }
    useEffect(drawPhotos, [locatorVisual]);

    // Fitted to the frames once it has a size (it may start folded)
    function fitLocator() {
        const l = locator.current;
        if (!l || l.fitted) return;
        l.map.updateSize();
        l.fitted = fitBounds(l.map, l.spots.getExtent()!, true, 12);
    }

    function markLocator() {
        locator.current?.spots.getFeatures().forEach((f: Feature) => {
            f.setStyle(f.get("path") === now.current.frame ? LOCATOR_CURRENT : LOCATOR_SPOT);
        });
    }
    useEffect(markLocator, [frame]);

    // The legend's curve with equalization: the server's (from the whole frame's histogram, as converted)
    useEffect(() => {
        const n = ++asked.current.curve;
        setCurve(null);
        if (!frame || !style || !style.adjust.equalize) return;
        fetch(base + "/frame/curve?frame=" + encodeURIComponent(frame) + "&rescale=" + style.range[0] + "," + style.range[1] +
              adjustQuery(style.adjust), {credentials: "same-origin"})
            .then((res) => readJson<{shares?: number[]}>(res))
            .then((r) => { if (n === asked.current.curve && r.ok) setCurve(r.data.shares || null); })
            .catch(() => { /* the legend stays as gamma alone draws it */ });
    }, [frame, style && style.range.join(), style && adjustQuery(style.adjust)]);

    // The shape drawn measured on the frame, with the isotherm and the parameters changed
    useEffect(() => {
        if (!current || current.res !== undefined || current.error || !frame) return;
        const n = ++asked.current.measure, c = current;
        sendJson(base + "/measure", "POST", {target: "frame", frame, geometry: c.geometry, isotherm: isoValue,
                                             parameters: changesIn(changes, unit)})
            .then((res) => readJson<Measured>(res))
            .then((r) => {
                if (n !== asked.current.measure) return;
                setCurrent(r.ok ? {...c, res: r.data} : {...c, error: errorText(r.data, "Could not measure.")});
            })
            .catch(() => { if (n === asked.current.measure) setCurrent({...c, error: "Could not measure."}); });
    }, [current]);

    // What was measured, on both panes
    useEffect(() => {
        drawings.current.forEach((d) => {
            d.showCursor(null);
            if (current) d.show(current.geometry, current.res?.result, unit);
            else d.clear();
        });
    }, [current, changed, onPair, beside, pair?.frame]);

    // The colour scale, in the panel and the PNG (not on the map: the panel shows it)
    const scale = onPair ? null : scaleShown();

    // The view in the URL, so that a reload or a copied link keeps it: the frame, its palette, range and adjustments
    useEffect(() => {
        if (!frame) return;
        const q = viewQuery({frame, palette: style?.palette, range: style?.range, adjust: style?.adjust});
        history.replaceState(null, "", location.pathname + q + (list ? (q ? "&" : "?") + "list=" + encodeURIComponent(list) : ""));
    }, [frame, list, style && style.palette, style && style.range.join(), style && adjustQuery(style.adjust)]);

    // The values at a pixel of the frame (where the cursor is, on the frame or on its visual pair)
    function readout(at: Coords) {
        const n = ++asked.current.point, q = now.current;
        if (!at.every(isFinite)) return setPoint(null);
        fetch(base + "/frame/point?frame=" + encodeURIComponent(q.frame || "") + "&x=" + at[0] + "&y=" + at[1] +
              changesQuery(changesIn(q.changes, q.meta?.unit)), {credentials: "same-origin"})
            .then((res) => readJson<FramePoint>(res))
            .then((r) => { if (n === asked.current.point) setPoint(r.ok ? r.data : null); })
            .catch(() => { if (n === asked.current.point) setPoint(null); });
    }

    // The profile's sample under the cursor (on the chart or along the line), marked on the chart and both panes
    function showIndex(i: number | null, points?: Maybe<Coords[]>) {
        setIndex(i);
        drawings.current.forEach((d) => d.showCursor(i === null || i < 0 || !points ? null : points[i]));
    }

    function setStyle(c: Partial<Style>) { setStyleState((s) => s && {...s, ...c}); }

    // The range Auto gives: the frame's 2nd to 98th percentile
    function autoRange(): [number, number] { return defaultRange({tab: "frame", stats: info?.stats}, unit); }

    // The palette's share at values evenly across the range, as the image is drawn; null: evenly
    function shares(a: Style["adjust"]): number[] | null {
        if (a.equalize && curve) return curve;
        return a.gamma !== 1 || a.equalize ? toneShares(a.gamma) : null;
    }

    function scaleShown(): Scale | null {
        if (!shown || !meta) return null;
        const colors = (meta.palettes || []).find((p) => p.key === shown.palette)?.color_map || [];
        return {colors, shown: shownRange("frame", shown.range, unit), shares: shares(shown.adjust), caption: "Temperature, " + symbol()};
    }

    // The range the fields show: in the user's unit
    function rangeFields(range: [number, number]): [string, string] {
        const s = (x: number) => String(Math.round((convertTemp(x, unit) as number) * 100) / 100);
        return [s(range[0]), s(range[1])];
    }

    function typedRange(min: string, max: string) {
        const r = parseRange(min, max, unit);
        setRangeError(r.error || "");
        if (r.error) return setRangeText([min, max]);
        setRangeText(null);
        setStyle({range: r.range});
    }

    function auto(reset = false) {
        setLive(null);
        setRangeText(null);
        setRangeError("");
        setStyle(reset ? {range: autoRange(), adjust: defaultAdjust()} : {range: autoRange()});
    }

    // A slider dragged: the image drawn with its change at once, which is kept when it is let go
    function dragged(changes: Partial<Style>, done: boolean) {
        setLive(done ? null : changes);
        if (done) setStyle(changes);
    }

    // The brightness or contrast slider moved: the range follows
    function slide(brightness: number, contrast: number, done: boolean) {
        const f = rangeFields(slidRange(autoRange(), brightness, contrast));
        const range: [number, number] = [typedTemp(Number(f[0]), unit), typedTemp(Number(f[1]), unit)];
        setRangeText(null);
        setRangeError("");
        dragged({range}, done);
    }

    function sharpen(value: number, done: boolean) {
        dragged({adjust: {...style!.adjust, sharpen: value}}, done);
    }

    function gamma(slider: string, done: boolean) {
        dragged({adjust: {...style!.adjust, gamma: sliderGamma(slider)}}, done);
    }

    function changeIsotherm(s: IsothermState, field: string) {
        let next = s;
        if (field === "mode" && s.mode && (s.a ?? "") === "") {
            // Starts from the top of the range: the hottest part shows (typed in the user's unit)
            const lo = convertTemp(style!.range[0], unit) as number, hi = convertTemp(style!.range[1], unit) as number;
            next = {...s, a: String(Math.round((hi - (hi - lo) / 4) * 10) / 10), b: String(Math.round(hi * 100) / 100)};
        }
        setIsotherm(next);
        const r = isothermParam(next.mode, next.a || "", next.b || "", unit);
        setIsoError(r.error || "");
        if (r.error || r.value === isoValue) return;
        setIsoValue(r.value || "");
        setCurrent(fresh);
    }

    // The parameters' fields as they read: typed, else the change applied, else what the frame was measured with
    const starts = changeStarts(info);
    const fieldValues: Record<string, string> = {};
    Object.keys(starts).forEach((k) => {
        fieldValues[k] = typed[k] ?? (changes[k] !== undefined ? String(changes[k]) : starts[k]);
    });

    // The parameters changed, read: an error marks its field; the frame is measured again with the rest
    function applyChanges() {
        const r = readChanges(fieldValues, starts);
        setChangeError({error: r.error, field: r.field});
        if (r.error) return;
        setTyped({});
        if (JSON.stringify(r.changes) === changesKey) return;
        setChanges(r.changes!);
        setCurrent(fresh);
    }

    function clearChanges() {
        setTyped({});
        setChangeError({});
        if (!changed) return;
        setChanges({});
        setCurrent(fresh);
    }

    // The measurement's card closed, and its shape taken off the frame
    function closeCard() {
        asked.current.measure++;
        setCurrent(null);
        setIndex(null);
        setMeasureError("");
    }

    async function save() {
        const name = saveName.trim();
        if (!name || !current) return setMeasureError("Name the measurement to save it");
        const r = await readJson<Measurement>(await sendJson(base + "/measurements", "POST", {
            name, target: "frame", frame, geometry: current.geometry, shape: current.shape, isotherm: isoValue,
            parameters: changesIn(changes, unit)}));
        if (!r.ok) return setMeasureError(errorText(r.data, "Could not save the measurement."));
        setMeasureError("");
        setSaveName("");
        setCurrent({...current, saved: r.data, res: r.data.values});
        await loadSaved();
    }

    async function rename(m: Measurement) {
        const name = await askName("Rename measurement", m.name);
        if (!name) return;
        const r = await readJson<Measurement>(await sendJson(base + "/measurements/" + m.id, "PATCH", {name}));
        if (!r.ok) return setMeasureError(errorText(r.data, "Could not rename the measurement."));
        setMeasureError("");
        setCurrent((c) => c && c.saved?.id === m.id ? {...c, saved: r.data} : c);
        await loadSaved();
    }

    async function remove(m: Measurement) {
        if (!await ask("Delete measurement", "Delete the measurement " + m.name + "?", "Delete", "danger")) return;
        const r = await readJson(await sendJson(base + "/measurements/" + m.id, "DELETE"));
        if (!r.ok) return setMeasureError(errorText(r.data, "Could not delete the measurement."));
        setMeasureError("");
        setCurrent((c) => c && c.saved?.id === m.id ? {...c, saved: null} : c);
        await loadSaved();
    }

    // A saved measurement measured again with the parameters typed (empty: the conversion's own)
    async function remeasure(m: Measurement, values: Record<string, string>): Promise<string | null> {
        const r = readChanges(values, {});
        if (r.error) return r.error;
        const res = await readJson<Measurement>(await sendJson(base + "/measurements/" + m.id, "PATCH",
                                                               {parameters: changesIn(r.changes, unit)}));
        if (!res.ok) return errorText(res.data, "Could not measure again.");
        setEditing(null);
        setCurrent((c) => c && c.saved?.id === m.id ? {...c, saved: res.data, res: res.data.values} : c);
        await loadSaved();
        return null;
    }

    // A saved measurement shown on the frame, with its figures as saved
    function showSaved(m: Measurement) {
        if (!m.geometry) return;
        setIndex(null);
        setCurrent({geometry: m.geometry, saved: m, res: m.values || null, shape: m.values?.shape});
    }

    // The frame as shown (every pane: with the visual pair beside it, with parameters changed), its saved measurements
    // (and the one drawn, not saved yet) and colour scale, as a PNG (the Export dialog's As shown): "" once saved, else
    // why it couldn't be. The frame is in pixels: there is no scale bar.
    async function exportShown(): Promise<string> {
        if (!meta || !frame || !layers.current[0]) return "The frame isn't shown yet.";
        const shownPanes = [0].concat(beside && maps.current[SIDE] ? [SIDE] : [],
                                      changed && !onPair && maps.current[1] && layers.current[1] ? [1] : []);
        const onVisual = (i: number) => i === SIDE || (i === 0 && onPair);
        const panes = await Promise.all(shownPanes.map(async (i) => {
            const m = maps.current[i];
            const drawn = await snapshot(m, i === SIDE ? sideLayer.current! : i === 0 && onPair ? pairLayer.current! : layers.current[i].layer);
            const from = onVisual(i) ? (c: Coords) => toPair(pair!, c) : fromCoords;
            const shapes = saved.filter((x) => x.geometry).map((x) => shapeOnMap(m, x.geometry!, from, x.name));
            if (current && !current.saved) shapes.push(shapeOnMap(m, current.geometry, from, ""));
            return {el: paneEls[i].current!, images: drawn ? [drawn] : [], shapes,
                    caption: onVisual(i) ? "Visual: " + pair!.frame : shownPanes.length > 1 ? (i ? "Parameters changed" : "As converted") : ""};
        }));
        const taken = takenText([entry?.time], meta.flight_zone), today = new Date().toISOString().slice(0, 10);
        const canvas = viewCanvas({
            title: [meta.dataset_name, meta.name, frame].filter(Boolean).join(" · "),
            date: (taken ? "Taken " + taken + " · exported " : "Exported ") + today,
            panes, legend: scale, scale: null, ratio: Math.max(1, devicePixelRatio || 1),
        });
        return await saveCanvas(canvas, fileName([meta.dataset_name, meta.name, frame.replace(/\.[^./]*$/, "")], ".png")) || "";
    }

    if (!meta) {
        return (<div class="page frame">
            {notice ? <div class="notice error" role="alert">{notice}</div> : <div class="message">Loading…</div>}
        </div>);
    }

    if (meta.visual_only) {
        return <VisualFrames api={api} publicUrl={publicUrl} id={id} datasetId={datasetId} datasetName={datasetName} meta={meta}/>;
    }

    const frames = meta.frames || [];
    const inMosaic = !!entry && inMosaics(entry);
    const res = current;
    const auto_ = shown && info ? sliderPositions(autoRange(), shown.range) : {brightness: 0, contrast: 0};
    const at = frames.findIndex((f) => f.path === frame);

    return (
        <div class="page frame">
            <div class="breadcrumb">
                <a href={publicUrl + "dataset/" + datasetId + "#datasets"}><ArrowLeft/> {datasetName}</a>
                {" · "}
                {/* Back to the mosaics with this frame's footprint outlined, when it is in them */}
                <a id="mosaics" href={publicUrl + "conversion/" + id + (inMosaic ? viewQuery({frame}) : "")}>The mosaics</a>
            </div>
            <div class="page-header">
                <div>
                    <h1 id="name">{meta.name}: {listTitle(list)}</h1>
                    <div class="subtitle">{meta.description || ""}</div>
                </div>
                <div class="page-actions">
                    {info && shown && <button type="button" class="button default" id="export" onClick={() => setExporting(true)}
                                              title="This frame as shown, with its measurements and colour scale, or as a PNG, TIFF, R-JPEG or its original">
                        <Download/> Export…</button>}
                </div>
            </div>

            {exporting && frame && shown && <FrameExport api={api} datasetId={datasetId} conversion={id} frame={frame}
                settings={{...meta.settings, normalize: meta.normalized}} changes={changesIn(changes, unit)} hasVisual={!!pair} asShown={exportShown}
                view={viewAsked(shown.palette, shown.range, shown.adjust, isoValue)} onClose={() => setExporting(false)}/>}
            {notice && <div class="notice error" role="alert">{notice}</div>}
            {status.text && <div class={"status " + (status.error ? "text-danger" : "text-muted")} id="status">{status.text}</div>}

            {/* Keyed: a line appearing above it is never taken for it, which would make its maps again */}
            <div class="frame-main" key="main" hidden={!info}>
                <div class="frame-chooser">
                    <button type="button" class="button default small" id="prev" title="Previous frame" disabled={at <= 0}
                            onClick={() => step(-1)}><ChevronLeft/></button>
                    <button type="button" class="button default small" id="next" title="Next frame" disabled={at >= frames.length - 1}
                            onClick={() => step(1)}><ChevronRight/></button>
                    <strong id="frame" title={frame || ""}>{(frame || "").split("/").pop()}</strong>
                    {pair && <div class="segmented frame-camera" role="group" aria-label="Camera">
                        {CAMERAS.map(([c, label]) => <button key={c} type="button" name={c} class={camera === c ? "active" : ""}
                                                             aria-pressed={camera === c} onClick={() => setCamera(c)}
                                                             title={c === "visual" ? "Its visual image, " + pair.frame :
                                                                 c === "both" ? "The frame and its visual image side by side" : undefined}>
                            {label}</button>)}
                    </div>}
                    <span class="message" id="about">{[entry?.time ? formatCapture(entry.time) + " (" + zoneText(meta.flight_zone) + ")" : "",
                        inMosaic ? "frame " + (entry!.mosaic! + 1) + " of the mosaics" : ""].filter(Boolean).join(" · ")}</span>
                </div>
                <div class="viewer-body">
                    <FrameList frames={frames} frame={frame} choose={chooseFrame} list={list} maxPitch={meta.max_pitch}
                               sizes={all.some(inMosaics)
                                   ? FRAME_LISTS.map(([l]) => listFrames(all, l).length) : undefined} chooseList={chooseList}
                               built={meta.mosaic_status === "ready"} thumbs={api + "datasets/" + datasetId + "/thumbnail?file="}/>
                    <div class="frame-panes">
                        <div class="frame-pane">
                            <div class="frame-pane-title" id="pane-title">{onPair ? "Visual · " + pair!.frame.split("/").pop() +
                                " (the readout and the shapes are the thermal frame's)" : "As converted"}</div>
                            <div class="map-stage">
                                <div class="viewer-map frame-map" id="map" ref={paneEls[0]}/>
                                {info && <Toolbar tool={tools.tool} count={tools.count}
                                                  label="Drawing tools: measure a spot, a line or an area"
                                                  onTool={(x) => {
                                                      drawings.current.forEach((d) => d.stop());
                                                      if (x) drawings.current[0]?.start(x);
                                                      syncTools();
                                                  }}
                                                  onFinish={() => { active()?.finish(); syncTools(); }}/>}
                                {res && <MeasureCard m={res} unit={unit} pixels labels={["As converted", "Changed"]} index={index}
                                                     onIndex={(i) => showIndex(i, res.res?.result?.profile?.points)}
                                                     name={saveName} error={measureError} onName={setSaveName} onSave={save}
                                                     onClose={closeCard}/>}
                            </div>
                        </div>
                        <div class="frame-pane" id="pair-pane" hidden={!beside}>
                            <div class="frame-pane-title">{beside ? "Visual · " + pair!.frame.split("/").pop() : "Visual"}</div>
                            <div class="viewer-map frame-map" id="map-pair" ref={paneEls[SIDE]}/>
                        </div>
                        <div class="frame-pane" id="changed-pane" hidden={!changed || onPair}>
                            <div class="frame-pane-title">Parameters changed</div>
                            <div class="viewer-map frame-map" id="map-changed" ref={paneEls[1]}/>
                        </div>
                    </div>
                    {info && shown && <div class="viewer-panel">
                        <PanelGroup title="View"/>
                        <Controls tab={{tab: "frame", stats: info.stats}} palette={shown.palette} palettes={meta.palettes || []}
                                  scale={scale} unit={unit} range={rangeText || rangeFields(shown.range)} rangeError={rangeError}
                                  onPalette={(palette) => setStyle({palette})} onRange={typedRange} onAuto={() => auto()}/>
                        <Section name="image" title="Image" store={FOLDED_KEY} folded>
                            <ImageControls adjust={shown.adjust} brightness={auto_.brightness} contrast={auto_.contrast}
                                           temperature={true} onSlide={slide} onGamma={gamma}
                                           onSharpen={sharpen}
                                           onTone={(equalize) => setStyle({adjust: {...style!.adjust, equalize}})}
                                           onReset={() => auto(true)}/>
                        </Section>
                        <Section name="isotherm" title="Isotherm" store={FOLDED_KEY}>
                            <Isotherm state={isotherm} error={isoError} onChange={changeIsotherm}/>
                        </Section>
                        <Section name="cursor" title="Pointer info" store={FOLDED_KEY}>
                            <div class="readout" id="readout"><FrameReadout point={point} unit={unit}/></div>
                        </Section>
                        <Section name="parameters" title="Measurement parameters" store={FOLDED_KEY} folded>
                            <Params info={info} recorded={entry?.recorded} starts={starts} values={fieldValues} changes={changes}
                                    newUrl={newConversionUrl(publicUrl, datasetId, id, changes)}
                                    error={changeError.error} field={changeError.field}
                                    onInput={(k, x) => setTyped((t) => ({...t, [k]: x}))} onApply={applyChanges} onClear={clearChanges}/>
                        </Section>
                        <Section name="saved" title={<span class="measurements-head"><span>Saved on this frame</span>
                            {saved.length > 0 && <a class="button default small" id="csv" href={base + "/measurements.csv"}
                                                    onClick={(e) => e.stopPropagation()}><Download/> CSV</a>}</span>} store={FOLDED_KEY}>
                            {!res && measureError && <div class="text-danger" id="measure-error">{measureError}</div>}
                            <Measurements items={saved} unit={unit} current={current?.saved?.id ?? null} compared={compared}
                                          editing={editing} fields={PARAM_FIELDS} onShow={showSaved}
                                          onCompare={(x, on) => setCompared((c) => toggleCompared(c, x, on))}
                                          onEdit={setEditing} onRename={rename} onDelete={remove} onRemeasure={remeasure}/>
                        </Section>
                        <PanelGroup title="About"/>
                        <Section name="info" title="This frame" store={FOLDED_KEY} folded>
                            <Info info={info} unit={unit} normalized={meta.normalized}/>
                        </Section>
                        {placed.length > 0 && <Section name="locator" title="Where the frames are" store={FOLDED_KEY}
                                                        onToggle={(open) => { if (open) { locator.current?.map.updateSize(); fitLocator(); } }}>
                            <div class="frame-locator" id="locator" ref={locatorEl}/>
                            {(meta.visual_photos || []).length > 0 && <label class="locator-visual">
                                <input type="checkbox" id="locator-visual" checked={locatorVisual}
                                       onChange={(e) => setLocatorVisual(e.currentTarget.checked)}/> Visual photos (orange squares)</label>}
                        </Section>}
                    </div>}
                </div>
            </div>
        </div>
    );
}
