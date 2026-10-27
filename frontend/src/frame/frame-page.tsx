// A conversion's frames, one at a time: the frame as converted (and beside it, measured again with other parameters),
// its palette, range and image adjustments, the values under the cursor, measuring with the isotherm, the frame's
// figures, where the frames were taken, the measurements saved on it, and the frame as a PNG. ← and → step through
// the frames. The view (frame, palette, range, adjustments) is kept in the URL.
import L from "leaflet";
import {render} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {type Maybe} from "../core/format";
import {convertTemp} from "../core/units";
import {ask, askName} from "../components/dialog";
import {ArrowLeft, ChevronLeft, ChevronRight, Download, Save} from "../components/icons";
import {Drawing, drawingKey, inField} from "../measure/drawing";
import {type Coords, type Geometry, isothermParam, isothermText, type Measured, type Measurement, nearestIndex,
        type Shape, symbol, toggleCompared, typedTemp} from "../measure/measure";
import {type IsothermState, Isotherm, Measurements, ResultView, Toolbar} from "../measure/result";
import {saveCanvas, type Scale, shapeOnMap, viewCanvas} from "../viewer/canvas";
import {Controls, ImageControls, type Palette, ScaleView, Section} from "../viewer/panel";
import {adjustQuery, defaultAdjust, defaultRange, fileName, parseRange, readView, shownRange, slidRange, sliderGamma,
        sliderPositions, type Style, takenText, toneShares, viewQuery} from "../viewer/view";
import {type Changes, changeStarts, changesIn, changesQuery, type FrameEntry, type FrameInfo, frameLabel, imageUrl,
        newConversionUrl, PARAM_FIELDS, readChanges} from "./frame";
import {FrameReadout, type FramePoint, Info, Params} from "./panel";

const HOVER_MS = 120;       // the readout asks for the point the cursor rests on, not every point it crosses
const FOLDED_KEY = "thermal-analyzer.frame.folded";
const LOCATOR_SPOT: L.CircleMarkerOptions = {radius: 4, weight: 1, color: "#333", fillColor: "#9ab", fillOpacity: 0.9};
const LOCATOR_CURRENT: L.CircleMarkerOptions = {radius: 6, weight: 2, color: "#fff", fillColor: "#e8562a", fillOpacity: 1};

export interface Frames {
    name: string;
    dataset_name?: string;
    description?: string;
    unit?: string;
    normalized?: boolean;
    default_palette?: string;
    palettes?: Palette[];
    frames?: FrameEntry[];
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

// The frame is in pixels, y downwards: the map's latitude is -y
const toCoords = (ll: L.LatLng): Coords => [ll.lng, -ll.lat];
const fromCoords = (c: Coords) => L.latLng(-c[1], c[0]);
const boundsOf = (info: FrameInfo) => L.latLngBounds([-info.height, 0], [0, info.width]);
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
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [changeError, setChangeError] = useState<{error?: string; field?: string}>({});
    const [saved, setSaved] = useState<Measurement[]>([]);
    const [compared, setCompared] = useState<number[]>([]);
    const [editing, setEditing] = useState<number | null>(null);
    const [saveName, setSaveName] = useState("");
    const [measureError, setMeasureError] = useState("");

    const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const paneEls = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
    const locatorEl = useRef<HTMLDivElement>(null);
    // The two panes (the second shown only with parameters changed), their images and drawings
    const maps = useRef<L.Map[]>([]);
    const images = useRef<L.ImageOverlay[]>([]);
    const drawings = useRef<Drawing[]>([]);
    const legend = useRef<HTMLDivElement | null>(null);
    const locator = useRef<L.Map | null>(null);
    const spots = useRef<Record<string, L.CircleMarker>>({});
    // The panes fit the frame when the next image is drawn (a new frame, or one of another size)
    const fit = useRef(true);
    // Counters: only the answer to the latest question is shown
    const asked = useRef({point: 0, frame: 0, curve: 0, measure: 0, saved: 0});

    const unit = meta?.unit;
    const changed = Object.keys(changes).length > 0;
    const changesKey = JSON.stringify(changes);
    const shown: Style | null = style && {...style, ...live};
    const urls = info && style && frame ? [imageUrl(api, id, frame, style, isoValue, {}),
                                           changed ? imageUrl(api, id, frame, style, isoValue, changesIn(changes, unit)) : ""] : ["", ""];
    const entry = (meta?.frames || []).find((f) => f.path === frame);
    const placed = (meta?.frames || []).filter(isPlaced);

    // What the maps' handlers (set up once) read: this render's values
    const now = useRef({frame, changes, meta, current});
    now.current = {frame, changes, meta, current};

    useEffect(() => {
        load();
        // Enter finishes the shape being drawn and Esc cancels it; otherwise ← and → step through the frames (not
        // while typing)
        const keys = (e: KeyboardEvent) => {
            const d = active();
            if (drawingKey(e, d)) return syncTools();
            if (d || inField(e.target) || e.altKey || e.ctrlKey || e.metaKey || !now.current.frame) return;
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            step(e.key === "ArrowLeft" ? -1 : 1);
        };
        document.addEventListener("keydown", keys);
        return () => {
            clearTimeout(hover.current);
            document.removeEventListener("keydown", keys);
            maps.current.forEach((m) => m.remove());
            locator.current?.remove();
        };
    }, []);

    async function load() {
        try {
            const r = await readJson<Frames>(await fetch(base + "/frames", {credentials: "same-origin"}));
            if (!r.ok) return setNotice("Could not load the frames.");
            setMeta(r.data);
            const paths = (r.data.frames || []).map((f) => f.path);
            if (!paths.length) return setStatus({text: "The dataset has no thermal frames to show."});
            chooseFrame(wanted.frame && paths.includes(wanted.frame) ? wanted.frame : paths[0]);
        } catch {
            setNotice("Could not load the frames.");
        }
    }

    // The drawing with a tool on, on either pane
    function active(): Drawing | null { return drawings.current.find((d) => d.tool()) || null; }

    function syncTools() {
        const d = active();
        setTools({tool: d ? d.tool() : null, count: d ? d.count() : 0});
    }

    function chooseFrame(path: string) {
        drawings.current.forEach((d) => { d.stop(); d.clear(); });
        syncTools();
        fit.current = true;
        setFrame(path);
        setCurrent(null);
        setIndex(null);
        setTyped({});
        setChangeError({});
        setMeasureError("");
        setEditing(null);
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

    // A pane's map, its readout and its drawing; the panes move together
    function setupMap(i: number, el: HTMLDivElement) {
        const m = L.map(el, {crs: L.CRS.Simple, minZoom: -3, maxZoom: 6, zoomSnap: 0.25, attributionControl: false,
                             keyboard: false});    // the arrows step through the frames
        let syncing = false;
        m.on("move", () => {
            if (syncing) return;
            syncing = true;
            maps.current.forEach((other) => { if (other !== m) other.setView(m.getCenter(), m.getZoom(), {animate: false}); });
            syncing = false;
        });
        m.on("mousemove", (e: L.LeafletMouseEvent) => {
            clearTimeout(hover.current);
            hover.current = setTimeout(() => readout(e.latlng), HOVER_MS);
        });
        m.on("mouseout", () => {
            clearTimeout(hover.current);
            asked.current.point++;
            setPoint(undefined);
        });
        drawings.current[i] = new Drawing({
            map: m, toCoords, fromCoords, pixels: true,
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
        if (i === 0) {
            const lg = legend.current = L.DomUtil.create("div", "map-legend leaflet-control");
            L.DomEvent.disableClickPropagation(lg);
            L.DomEvent.disableScrollPropagation(lg);
            const control = new L.Control({position: "bottomright"});
            control.onAdd = () => lg;
            control.addTo(m);
        }
        maps.current[i] = m;
    }

    // The images drawn as the frame, palette, range, adjustments, isotherm and parameters now are: the second pane
    // with the parameters changed
    useEffect(() => {
        if (!info || !urls[0]) return;
        const b = boundsOf(info), ms = maps.current;
        if (!ms[0] && paneEls[0].current) setupMap(0, paneEls[0].current);
        if (urls[1] && !ms[1] && paneEls[1].current) setupMap(1, paneEls[1].current);
        urls.forEach((u, i) => {
            if (!u || !ms[i]) return;
            const image = images.current[i];
            if (!image) {
                images.current[i] = L.imageOverlay(u, b).addTo(ms[i]);
            } else {
                image.setUrl(u);
                image.setBounds(b);
            }
        });
        ms.forEach((m) => m.invalidateSize());
        if (fit.current) {
            ms[0].fitBounds(b);
            fit.current = false;
        } else if (ms[1]) {
            ms[1].setView(ms[0].getCenter(), ms[0].getZoom(), {animate: false});
        }
        drawLocator();
    }, [info, urls[0], urls[1]]);

    // Where the frames were taken, on a small map: the frame shown highlighted, a click on another opens it
    function drawLocator() {
        if (locator.current || !locatorEl.current || !placed.length) return;
        const m = locator.current = L.map(locatorEl.current, {attributionControl: false, zoomControl: false, keyboard: false,
                                                              maxZoom: 19});
        placed.forEach((f) => {
            const spot = L.circleMarker([f.lat!, f.lon!], LOCATOR_SPOT).bindTooltip(f.path);
            spot.on("click", () => { if (f.path !== now.current.frame) chooseFrame(f.path); });
            spot.addTo(m);
            spots.current[f.path] = spot;
        });
        m.fitBounds(L.latLngBounds(placed.map((f) => [f.lat!, f.lon!] as L.LatLngTuple)), {padding: [12, 12]});
        markLocator();
    }

    function markLocator() {
        Object.entries(spots.current).forEach(([path, spot]) => {
            spot.setStyle(path === now.current.frame ? LOCATOR_CURRENT : LOCATOR_SPOT);
            if (path === now.current.frame) spot.bringToFront();
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
    }, [current, changed]);

    // The colour scale on the first pane
    const scale = scaleShown();
    useEffect(() => {
        if (!legend.current) return;
        render(scale ? <ScaleView scale={scale}/> : null, legend.current);
        legend.current.hidden = !scale;
    }, [JSON.stringify(scale), !!info]);

    // The view in the URL, so that a reload or a copied link keeps it: the frame, its palette, range and adjustments
    useEffect(() => {
        if (!frame) return;
        history.replaceState(null, "", location.pathname + viewQuery({frame, palette: style?.palette, range: style?.range,
                                                                      adjust: style?.adjust}));
    }, [frame, style && style.palette, style && style.range.join(), style && adjustQuery(style.adjust)]);

    function readout(latlng: L.LatLng) {
        const n = ++asked.current.point, q = now.current;
        fetch(base + "/frame/point?frame=" + encodeURIComponent(q.frame || "") + "&x=" + latlng.lng + "&y=" + (-latlng.lat) +
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

    // The brightness or contrast slider moved: the range follows (its fields and the scale at once, the image when let
    // go)
    function slide(brightness: number, contrast: number, done: boolean) {
        const f = rangeFields(slidRange(autoRange(), brightness, contrast));
        const range: [number, number] = [typedTemp(Number(f[0]), unit), typedTemp(Number(f[1]), unit)];
        setRangeText(null);
        setRangeError("");
        if (done) {
            setLive(null);
            setStyle({range});
        } else {
            setLive({range});
        }
    }

    function gamma(slider: string, done: boolean) {
        const adjust = {...style!.adjust, gamma: sliderGamma(slider)};
        if (done) {
            setLive(null);
            setStyle({adjust});
        } else {
            setLive({adjust});
        }
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

    // The frame as shown (both panes, with parameters changed), its saved measurements (and the one drawn, not saved
    // yet) and colour scale, as a PNG. The frame is in pixels: there is no scale bar.
    async function exportPng() {
        if (!meta || !frame || !images.current[0]) return;
        const both = changed && !!maps.current[1] && !!images.current[1];
        const panes = (both ? [0, 1] : [0]).map((i) => {
            const m = maps.current[i];
            const shapes = saved.filter((x) => x.geometry).map((x) => shapeOnMap(m, x.geometry!, fromCoords, x.name));
            if (current && !current.saved) shapes.push(shapeOnMap(m, current.geometry, fromCoords, ""));
            return {el: m.getContainer(), images: [images.current[i].getElement()!], shapes,
                    caption: both ? (i ? "Parameters changed" : "As converted") : ""};
        });
        const taken = takenText([entry?.time]), today = new Date().toISOString().slice(0, 10);
        const canvas = viewCanvas({
            title: [meta.dataset_name, meta.name, frame].filter(Boolean).join(" · "),
            date: (taken ? "Taken " + taken + " · exported " : "Exported ") + today,
            panes, legend: scale, scale: null, ratio: Math.max(1, devicePixelRatio || 1),
        });
        const error = await saveCanvas(canvas, fileName([meta.dataset_name, meta.name, frame.replace(/\.[^./]*$/, "")], ".png"));
        if (error) setStatus({text: error, error: true});
    }

    if (!meta) {
        return (<div class="page frame">
            {notice ? <div class="notice error" role="alert">{notice}</div> : <div class="message">Loading…</div>}
        </div>);
    }

    const frames = meta.frames || [];
    const inMosaics = entry && entry.mosaic !== null && entry.mosaic !== undefined;
    const res = current;
    const auto_ = shown && info ? sliderPositions(autoRange(), shown.range) : {brightness: 0, contrast: 0};
    const at = frames.findIndex((f) => f.path === frame);

    return (
        <div class="page frame">
            <div class="breadcrumb">
                <a href={publicUrl + "dataset/" + datasetId + "#convert"}><ArrowLeft/> {datasetName}</a>
                {" · "}
                {/* Back to the mosaics with this frame's footprint outlined, when it is in them */}
                <a id="mosaics" href={publicUrl + "conversion/" + id + (inMosaics ? viewQuery({frame}) : "")}>The mosaics</a>
            </div>
            <div class="page-header">
                <div>
                    <h1 id="name">{meta.name}: frames</h1>
                    <div class="subtitle">{meta.description || ""}</div>
                </div>
                <div class="page-actions">
                    {info && <button type="button" class="button default" id="png" onClick={exportPng}
                                     title="The frame as shown (both panes with parameters changed), with its saved measurements and colour scale">
                        <Download/> Export PNG</button>}
                </div>
            </div>

            {notice && <div class="notice error" role="alert">{notice}</div>}
            {status.text && <div class={"status " + (status.error ? "text-danger" : "text-muted")} id="status">{status.text}</div>}

            {/* Keyed: a line appearing above it is never taken for it, which would make its maps again */}
            <div class="frame-main" key="main" hidden={!info}>
                <div class="frame-chooser">
                    <button type="button" class="button default small" id="prev" title="Previous frame" disabled={at <= 0}
                            onClick={() => step(-1)}><ChevronLeft/></button>
                    <select id="frame" aria-label="Frame" value={frame || ""} onChange={(e) => chooseFrame(e.currentTarget.value)}>
                        {frames.map((f) => <option key={f.path} value={f.path}>{frameLabel(f)}</option>)}
                    </select>
                    <button type="button" class="button default small" id="next" title="Next frame" disabled={at >= frames.length - 1}
                            onClick={() => step(1)}><ChevronRight/></button>
                    <span class="message" id="about">{(entry?.time || "") + (inMosaics ? " · frame " + (entry!.mosaic! + 1) +
                        " of the mosaics" : "")}</span>
                </div>
                <div class="viewer-body">
                    <div class="frame-panes">
                        <div class="frame-pane">
                            <div class="frame-pane-title">As converted</div>
                            <div class="viewer-map frame-map" id="map" ref={paneEls[0]}/>
                        </div>
                        <div class="frame-pane" id="changed-pane" hidden={!changed}>
                            <div class="frame-pane-title">Parameters changed</div>
                            <div class="viewer-map frame-map" id="map-changed" ref={paneEls[1]}/>
                        </div>
                    </div>
                    {info && shown && <div class="viewer-panel">
                        <Controls tab={{tab: "frame", stats: info.stats}} palette={shown.palette} palettes={meta.palettes || []}
                                  scale={scale} unit={unit} range={rangeText || rangeFields(shown.range)} rangeError={rangeError}
                                  onPalette={(palette) => setStyle({palette})} onRange={typedRange} onAuto={() => auto()}/>
                        <Section name="image" title="Image" store={FOLDED_KEY}>
                            <ImageControls adjust={shown.adjust} brightness={auto_.brightness} contrast={auto_.contrast}
                                           temperature={true} onSlide={slide} onGamma={gamma}
                                           onSharpen={(sharpen) => setStyle({adjust: {...style!.adjust, sharpen}})}
                                           onTone={(equalize) => setStyle({adjust: {...style!.adjust, equalize}})}
                                           onReset={() => auto(true)}/>
                        </Section>
                        <Section name="cursor" title="Under the cursor" store={FOLDED_KEY}>
                            <div class="readout" id="readout"><FrameReadout point={point} unit={unit}/></div>
                        </Section>
                        <Section name="measure" title="Measure" store={FOLDED_KEY}>
                            <Toolbar tool={tools.tool} count={tools.count}
                                     onTool={(x) => {
                                         drawings.current.forEach((d) => d.stop());
                                         if (x) drawings.current[0]?.start(x);
                                         syncTools();
                                     }}
                                     onFinish={() => { active()?.finish(); syncTools(); }}/>
                            <div id="result">
                                {!res ? <p class="message">Choose a tool and draw on the frame.</p> :
                                    res.error ? <p class="text-danger">{res.error}</p> :
                                    res.res === undefined ? <p class="message">Measuring…</p> : <>
                                        {res.saved && <div class="message">Saved as <strong>{res.saved.name}</strong>
                                            {res.saved.values && (res.saved.values as {isotherm?: string}).isotherm &&
                                                ", isotherm " + isothermText((res.saved.values as {isotherm?: string}).isotherm, unit)}</div>}
                                        <ResultView res={res.res} unit={unit} shape={res.shape} pixels labels={["As converted", "Changed"]}
                                                    index={index} onIndex={(i) => showIndex(i, res.res?.result?.profile?.points)}/>
                                    </>}
                            </div>
                            {res && !res.saved && res.res?.result?.valid_pixels ? <div class="measure-save" id="save">
                                <div class="inline">
                                    <input type="text" name="name" maxLength={255} placeholder="Name" value={saveName}
                                           onInput={(e) => setSaveName(e.currentTarget.value)}/>
                                    <button type="button" class="button primary small" onClick={save}><Save/> Save</button>
                                </div>
                            </div> : null}
                            {measureError && <div class="text-danger" id="measure-error">{measureError}</div>}
                        </Section>
                        <Section name="isotherm" title="Isotherm" store={FOLDED_KEY}>
                            <Isotherm state={isotherm} error={isoError} onChange={changeIsotherm}/>
                        </Section>
                        <Section name="parameters" title="Measurement parameters" store={FOLDED_KEY}>
                            <Params info={info} recorded={entry?.recorded} starts={starts} values={fieldValues} changes={changes}
                                    newUrl={newConversionUrl(publicUrl, datasetId, id, changes)}
                                    error={changeError.error} field={changeError.field}
                                    onInput={(k, x) => setTyped((t) => ({...t, [k]: x}))} onApply={applyChanges} onClear={clearChanges}/>
                        </Section>
                        <Section name="info" title="This frame" store={FOLDED_KEY}>
                            <Info info={info} unit={unit} normalized={meta.normalized}/>
                        </Section>
                        {placed.length > 0 && <Section name="locator" title="Where the frames are" store={FOLDED_KEY}
                                                        onToggle={(open) => { if (open) locator.current?.invalidateSize(); }}>
                            <div class="frame-locator" id="locator" ref={locatorEl}/>
                        </Section>}
                        <Section name="saved" title={<span class="measurements-head"><span>Saved on this frame</span>
                            {saved.length > 0 && <a class="button default small" id="csv" href={base + "/measurements.csv"}
                                                    onClick={(e) => e.stopPropagation()}><Download/> CSV</a>}</span>} store={FOLDED_KEY}>
                            <Measurements items={saved} unit={unit} current={current?.saved?.id ?? null} compared={compared}
                                          editing={editing} fields={PARAM_FIELDS} onShow={showSaved}
                                          onCompare={(x, on) => setCompared((c) => toggleCompared(c, x, on))}
                                          onEdit={setEditing} onRename={rename} onDelete={remove} onRemeasure={remeasure}/>
                        </Section>
                    </div>}
                </div>
            </div>
        </div>
    );
}
