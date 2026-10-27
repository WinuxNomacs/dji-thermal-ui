// The mosaic viewer: a conversion's mosaics on a map (as converted, harmonized, the source frames and the view
// angles), with their palette, range and image adjustments, the values under the cursor, measuring with the isotherm
// and the thermal correction, the saved measurements, and the mosaic as a PNG; kept up to date while the mosaics are
// built. The view (tab, palette, range, adjustments, the frame outlined) is kept in the URL.
import L from "leaflet";
import {render} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {type Maybe, mosaicLabel, type Stage} from "../core/format";
import {convertTemp} from "../core/units";
import {ask, askName} from "../components/dialog";
import {ArrowLeft, Columns, Download, Grid, Image, Save, Stop} from "../components/icons";
import {Drawing, drawingKey} from "../measure/drawing";
import {type Coords, type Geometry, isothermParam, isothermText, type Measured, type Measurement, nearestIndex,
        type Shape, symbol, toggleCompared, typedTemp} from "../measure/measure";
import {type IsothermState, Isotherm, Measurements, ResultView, Toolbar} from "../measure/result";
import {saveCanvas, type Scale, shapeOnMap, viewCanvas} from "./canvas";
import {addBasemaps, addLegend, type Basemap} from "./map";
import {type Baseline, Controls, Correction, correctionStarts, ImageControls, MosaicStatus, type Palette, type Point,
        Readout, Report, ScaleView, Section, Whole} from "./panel";
import {adjustQuery, type Correction as CorrectionValue, correctionParams, defaultAdjust, defaultRange, extraQuery,
        fileName, isTemperatureTab, type Kind, type MosaicTab, PARAM_FIELDS, parseRange, readCorrection, readView,
        scaleBar, shownRange, slidRange, sliderGamma, sliderPositions, type Style, styleGroup, tabLabel, takenText,
        tileUrl, toneShares, viewQuery} from "./view";

const POLL_MS = 2000;
const HOVER_MS = 120;       // the readout asks for the point the cursor rests on, not every point it crosses
const TYPING_MS = 400;      // the correction redraws once typing pauses

export interface Mosaics {
    name: string;
    dataset_name?: string;
    description?: string;
    stripped?: boolean;
    status: string;
    mosaic_status: string;
    mosaic_error?: string | null;
    mosaic_progress?: number | null;
    stage?: Maybe<Stage>;
    unit?: string;
    tabs?: MosaicTab[];
    palettes?: Palette[];
    default_palette?: string;
    kinds?: Record<string, Kind>;
    baselines?: Record<string, Baseline>;
    frames?: string[];
    frame_colors?: number[];
    flown?: Maybe<string>[];
}

// What is measured: the shape drawn (or a saved measurement shown), on which mosaic, and what came back; res undefined
// while it is being measured
interface Current {
    geometry: Geometry;
    target: string;
    shape?: Maybe<Shape>;
    saved?: Measurement | null;
    res?: Measured | null;
    error?: string;
}

const isReady = (v: Maybe<Mosaics>) => !!v && v.mosaic_status === "ready" && (v.tabs || []).length > 0;
const isBusy = (v: Mosaics) => v.status === "converting" || v.mosaic_status === "building";
const toCoords = (ll: L.LatLng): Coords => [ll.lng, ll.lat];
const fromCoords = (c: Coords) => L.latLng(c[1], c[0]);
const boundsOf = (b: number[]) => L.latLngBounds([b[1], b[0]], [b[3], b[2]]);

// A tab's palette and range before any is chosen
function defaultStyle(v: Mosaics, tab: string): Style {
    const group = styleGroup(tab), t = (v.tabs || []).find((x) => x.tab === tab);
    return {palette: group === "view_angle" ? "viridis" : v.default_palette || "",
            range: defaultRange(t, group === "temperature" ? v.unit : undefined), adjust: defaultAdjust()};
}

// The same shape measured afresh (on another tab, or with another isotherm or correction)
const fresh = (c: Current | null, target: string): Current | null => c && {geometry: c.geometry, target, shape: c.shape};

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    datasetId: number;
    datasetName: string;
    basemaps: Basemap[];
}

export function ViewerPage({api, publicUrl, id, datasetId, datasetName, basemaps}: Props) {
    const base = api + "conversions/" + id;
    const frameUrl = publicUrl + "conversion/" + id + "/frame?frame=";
    const [wanted] = useState(() => readView(location.search));
    const [v, setV] = useState<Mosaics | null>(null);
    const [notice, setNotice] = useState("");
    const [tab, setTab] = useState<string | null>(null);
    const [styles, setStyles] = useState<Record<string, Style>>({});
    // A slider being dragged: the range or gamma it gives, shown at once (the fields and the scale), drawn when let go
    const [live, setLive] = useState<Partial<Style> | null>(null);
    const [rangeText, setRangeText] = useState<[string, string] | null>(null);
    const [rangeError, setRangeError] = useState("");
    const [curve, setCurve] = useState<number[] | null>(null);
    const [point, setPoint] = useState<Maybe<Point>>(undefined);
    const [pinned, setPinned] = useState(false);
    const [outlined, setOutlined] = useState<string | null>(null);
    const [tools, setTools] = useState<{tool: ReturnType<Drawing["tool"]>; count: number}>({tool: null, count: 0});
    const [current, setCurrent] = useState<Current | null>(null);
    const [index, setIndex] = useState<number | null>(null);
    const [isotherm, setIsotherm] = useState<IsothermState>({mode: ""});
    const [isoValue, setIsoValue] = useState("");
    const [isoError, setIsoError] = useState("");
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [correction, setCorrection] = useState<CorrectionValue>({});
    const [corrError, setCorrError] = useState<{error?: string; field?: string}>({});
    const [saved, setSaved] = useState<Measurement[]>([]);
    const [compared, setCompared] = useState<number[]>([]);
    const [editing, setEditing] = useState<number | null>(null);
    const [saveName, setSaveName] = useState("");
    const [measureError, setMeasureError] = useState("");

    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const mapEl = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map | null>(null);
    const layer = useRef<L.TileLayer | null>(null);
    const legend = useRef<HTMLDivElement | null>(null);
    const drawing = useRef<Drawing | null>(null);
    const footprint = useRef<L.GeoJSON | null>(null);
    // Counters: only the answer to the latest question is shown
    const asked = useRef({point: 0, outline: 0, curve: 0, whole: 0, measure: 0});

    const ready = isReady(v);
    const unit = v?.unit;
    const t = v && tab ? (v.tabs || []).find((x) => x.tab === tab) : undefined;
    const temperature = !!tab && isTemperatureTab(tab);
    const group = tab ? styleGroup(tab) : "";
    const style: Style | null = v && tab ? styles[group] || defaultStyle(v, tab) : null;
    const shown: Style | null = style && {...style, ...live};
    const params = unit !== undefined ? correctionParams(correction, unit) : {};
    const paramsKey = JSON.stringify(params);
    const extra = {isotherm: isoValue, ...params};
    const url = style && tab ? tileUrl(api, id, tab, style, extra) : "";

    // What the map's handlers (set up once) read: this render's values
    const now = useRef({tab, params, current, pinned});
    now.current = {tab, params, current, pinned};

    function show(data: Mosaics) {
        clearTimeout(timer.current);
        const wasReady = isReady(v);
        setV(data);
        document.title = data.name + " · Thermal Analyzer";
        if (isReady(data)) {
            // Rebuilt: start again from the new mosaics' ranges
            if (!wasReady && map.current) setStyles({});
            if (!tab || !data.tabs!.some((x) => x.tab === tab)) {
                const first = wanted.tab && data.tabs!.some((x) => x.tab === wanted.tab) ? wanted.tab : data.tabs![0].tab;
                setTab(first);
                if (!map.current) applyWanted(data, first);
            }
        }
        if (isBusy(data)) timer.current = setTimeout(load, POLL_MS);
    }

    // The palette, range and adjustments a link asked for, on the tab it opened
    function applyWanted(data: Mosaics, first: string) {
        if (first === "source_frame") return;
        const s = defaultStyle(data, first);
        if (wanted.palette && (data.palettes || []).some((p) => p.key === wanted.palette)) s.palette = wanted.palette;
        if (wanted.range) s.range = wanted.range;
        if (wanted.adjust) s.adjust = {...wanted.adjust, equalize: wanted.adjust.equalize && isTemperatureTab(first)};
        setStyles({[styleGroup(first)]: s});
    }

    async function load() {
        clearTimeout(timer.current);
        try {
            const r = await readJson<Mosaics>(await fetch(base + "/mosaics", {credentials: "same-origin"}));
            if (!r.ok) return setNotice("Could not load the mosaics.");
            show(r.data);
        } catch {
            setNotice("Could not load the mosaics.");
        }
    }

    useEffect(() => {
        load();
        // Enter finishes the shape being drawn and Esc cancels it
        const keys = (e: KeyboardEvent) => { if (drawingKey(e, drawing.current)) syncTools(); };
        document.addEventListener("keydown", keys);
        return () => {
            clearTimeout(timer.current);
            clearTimeout(hover.current);
            clearTimeout(typing.current);
            document.removeEventListener("keydown", keys);
            map.current?.remove();
        };
    }, []);

    function syncTools() {
        const d = drawing.current;
        setTools({tool: d ? d.tool() : null, count: d ? d.count() : 0});
    }

    // The map, once there are mosaics to show: the basemaps, the mosaic's tiles, the legend and the drawing
    useEffect(() => {
        if (!ready || map.current || !mapEl.current || !t || !style) return;
        const m = map.current = L.map(mapEl.current, {maxZoom: 26});
        addBasemaps(m, basemaps);
        legend.current = addLegend(m);
        layer.current = L.tileLayer(url, {maxZoom: 26, maxNativeZoom: (t.maxzoom || 20) + 1, minZoom: 0,
                                          bounds: t.bounds && boundsOf(t.bounds)}).addTo(m);
        if (t.bounds) m.fitBounds(boundsOf(t.bounds));
        else m.setView([0, 0], 2);

        m.on("mousemove", (e: L.LeafletMouseEvent) => {
            if (now.current.pinned) return;
            clearTimeout(hover.current);
            hover.current = setTimeout(() => readout(e.latlng), HOVER_MS);
        });
        m.on("mouseout", () => {
            if (now.current.pinned) return;
            clearTimeout(hover.current);
            asked.current.point++;
            setPoint(undefined);
        });
        drawing.current = new Drawing({
            map: m, toCoords, fromCoords,
            onDone: (geometry, shape) => {
                setCurrent({geometry, target: now.current.tab!, shape});
                setIndex(null);
                syncTools();
            },
            onChange: syncTools,
            onLineHover: (coords) => {
                const points = now.current.current?.res?.result?.profile?.points;
                showIndex(coords && points ? nearestIndex(points, coords) : null, points);
            },
            // A click with no tool on keeps the values there (and its frame's link) until the next click
            onClick: (e) => {
                setPinned(true);
                now.current.pinned = true;
                clearTimeout(hover.current);
                readout(e.latlng, true);
            },
        });
        loadSaved();
        if (wanted.frame) showFrame(wanted.frame);
    }, [ready]);

    // The tiles drawn again as the tab, palette, range, adjustments, isotherm and correction now are
    useEffect(() => { if (url) layer.current?.setUrl(url); }, [url]);

    // The legend's curve with equalization: the server's (from the whole mosaic's histogram)
    useEffect(() => {
        const n = ++asked.current.curve;
        setCurve(null);
        if (!ready || !style || !temperature || !style.adjust.equalize) return;
        fetch(base + "/mosaics/" + tab + "/curve?rescale=" + style.range[0] + "," + style.range[1] + adjustQuery(style.adjust) +
              extraQuery(params), {credentials: "same-origin"})
            .then((res) => readJson<{shares?: number[]}>(res))
            .then((r) => { if (n === asked.current.curve && r.ok) setCurve(r.data.shares || null); })
            .catch(() => { /* the legend stays as gamma alone draws it */ });
    }, [ready, tab, style && style.range.join(), style && adjustQuery(style.adjust), paramsKey]);

    // The whole mosaic: its histogram, percentiles and the isotherm's share, with the correction
    useEffect(() => {
        if (!ready || !temperature || !v) return;
        const n = ++asked.current.whole, measuredTab = tab!;
        sendJson(base + "/measure", "POST", {target: measuredTab, geometry: null, isotherm: isoValue, parameters: params})
            .then((res) => readJson<Measured>(res))
            .then((r) => {
                if (n !== asked.current.whole || !r.ok) return;
                setStyles((s) => ({...s, [styleGroup(measuredTab)]: {...(s[styleGroup(measuredTab)] ||
                    defaultStyle(v, measuredTab)), whole: r.data}}));
            })
            .catch(() => { /* the figures stay as they were */ });
    }, [ready, tab, isoValue, paramsKey]);

    // The shape drawn measured on the mosaic shown, with the isotherm and correction
    useEffect(() => {
        if (!current || current.res !== undefined || current.error || !temperature) return;
        const n = ++asked.current.measure, c = current;
        sendJson(base + "/measure", "POST", {target: c.target, geometry: c.geometry, isotherm: isoValue, parameters: params})
            .then((res) => readJson<Measured>(res))
            .then((r) => {
                if (n !== asked.current.measure) return;
                setCurrent(r.ok ? {...c, res: r.data} : {...c, error: errorText(r.data, "Could not measure.")});
            })
            .catch(() => { if (n === asked.current.measure) setCurrent({...c, error: "Could not measure."}); });
    }, [current, temperature]);

    // What was measured, on the map
    useEffect(() => {
        const d = drawing.current;
        if (!d) return;
        d.showCursor(null);
        if (current && current.target === tab) d.show(current.geometry, current.res?.result, unit);
        else d.clear();
    }, [current, tab, ready]);

    // The colour scale on the map
    const scale = scaleShown();
    useEffect(() => {
        if (!legend.current) return;
        render(scale ? <ScaleView scale={scale}/> : null, legend.current);
        legend.current.hidden = !scale;
    }, [JSON.stringify(scale), ready]);

    // The view in the URL, so that a reload or a copied link keeps it: the tab, its palette, range and adjustments,
    // and the frame outlined
    useEffect(() => {
        if (!ready || !tab || !style) return;
        const view = tab === "source_frame" ? {tab, frame: outlined} :
            {tab, frame: outlined, palette: style.palette, range: style.range, adjust: style.adjust};
        history.replaceState(null, "", location.pathname + viewQuery(view));
    }, [ready, tab, outlined, style && style.palette, style && style.range.join(), style && adjustQuery(style.adjust)]);

    function readout(latlng: L.LatLng, pin = false) {
        const n = ++asked.current.point, q = now.current;
        fetch(base + "/mosaics/" + q.tab + "/point?lon=" + latlng.lng + "&lat=" + latlng.lat +
              extraQuery(q.params), {credentials: "same-origin"})
            .then((res) => readJson<Point>(res))
            .then((r) => {
                if (n !== asked.current.point) return;    // the cursor moved on
                setPoint(r.ok ? r.data : null);
                if (pin) outline(r.ok && r.data.valid && r.data.frame || null);
            })
            .catch(() => { if (n === asked.current.point) setPoint(null); });
    }

    // The frame's footprint outlined on the mosaic, what it contributes (null: none); fit: the map moves to it
    async function outline(path: string | null, fit = false) {
        const n = ++asked.current.outline, m = map.current;
        if (footprint.current) m?.removeLayer(footprint.current);
        footprint.current = null;
        setOutlined(path);
        if (!path || !m) return;
        try {
            const r = await readJson(await fetch(base + "/mosaics/footprint?frame=" + encodeURIComponent(path),
                                                 {credentials: "same-origin"}));
            if (n !== asked.current.outline || !r.ok) return;
            const f = footprint.current = L.geoJSON(r.data as unknown as GeoJSON.GeoJsonObject,
                                                    {style: {color: "#fff", weight: 2, opacity: 0.9, fill: false}, interactive: false});
            f.addTo(m);
            const b = f.getBounds();
            if (fit && b.isValid()) m.fitBounds(b);
        } catch {
            // the outline is simply not drawn then
        }
    }

    // The frame a link asked for: kept in the readout and outlined
    function showFrame(path: string) {
        setPinned(true);
        now.current.pinned = true;
        setPoint({valid: true, frame: path});
        outline(path, true);
    }

    function follow() {
        setPinned(false);
        now.current.pinned = false;
        setPoint(undefined);
        outline(null);
    }

    // The profile's sample under the cursor (on the chart or along the line), marked on both
    function showIndex(i: number | null, points?: Maybe<Coords[]>) {
        setIndex(i);
        drawing.current?.showCursor(i === null || i < 0 || !points ? null : points[i]);
    }

    function setStyle(changes: Partial<Style>) {
        setStyles((s) => ({...s, [group]: {...(s[group] || defaultStyle(v!, tab!)), ...changes}}));
    }

    // The range Auto gives: the whole mosaic's 2nd to 98th percentile (as corrected), else the tab's
    function autoRange(): [number, number] {
        const p = style?.whole?.result?.percentiles;
        return p && temperature ? defaultRange({tab: tab!, stats: {percentiles: p}}, unit) :
            defaultRange(t, temperature ? unit : undefined);
    }

    // The palette's share at values evenly across the range, as the image is drawn; null: evenly
    function shares(a: Style["adjust"]): number[] | null {
        if (a.equalize && curve) return curve;
        return a.gamma !== 1 || a.equalize ? toneShares(a.gamma) : null;
    }

    // The colour scale as the tab's palette and range now are, or null on a tab without one
    function scaleShown(): Scale | null {
        if (!shown || !v || tab === "source_frame") return null;
        const colors = (v.palettes || []).find((p) => p.key === shown.palette)?.color_map || [];
        return {colors, shown: shownRange(tab!, shown.range, unit), shares: shares(shown.adjust),
                caption: tab === "view_angle" ? "View angle, °" : "Temperature, " + symbol()};
    }

    function chooseTab(next: string) {
        if (next === tab) return;
        drawing.current?.stop();
        syncTools();
        setTab(next);
        setLive(null);
        setRangeText(null);
        setRangeError("");
        setIndex(null);
        setCurrent((c) => fresh(c, next));
    }

    // The range a temperature tab's fields show: in the user's unit
    function rangeFields(range: [number, number]): [string, string] {
        const s = (x: number) => String(temperature ? Math.round((convertTemp(x, unit) as number) * 100) / 100 : x);
        return [s(range[0]), s(range[1])];
    }

    function typedRange(min: string, max: string) {
        const r = parseRange(min, max, temperature ? unit : undefined);
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

    // The brightness or contrast slider moved: the range follows (its fields and the scale at once, the tiles when
    // let go)
    function slide(brightness: number, contrast: number, done: boolean) {
        const r = slidRange(autoRange(), brightness, contrast);
        const range: [number, number] = temperature ?
            [typedTemp(Number(rangeFields(r)[0]), unit), typedTemp(Number(rangeFields(r)[1]), unit)] : r;
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
        setCurrent((c) => fresh(c, tab!));
    }

    // The correction's fields read: an error marks its field and keeps the mosaic as it is
    const typedNow = useRef(typed);
    typedNow.current = typed;
    function applyCorrection() {
        clearTimeout(typing.current);
        const r = readCorrection(typedNow.current, correctionStarts(t && v?.baselines?.[t.kind || ""], unit));
        setCorrError({error: r.error, field: r.field});
        if (r.error || JSON.stringify(r.correction) === JSON.stringify(correction)) return;
        setCorrection(r.correction!);
        setCurrent((c) => fresh(c, tab!));
    }

    function correctionInput(key: string, value: string) {
        setTyped((x) => ({...x, [key]: value}));
        typedNow.current = {...typedNow.current, [key]: value};
        clearTimeout(typing.current);
        typing.current = setTimeout(applyCorrection, TYPING_MS);
    }

    function correctionChange(key: string, value: string) {
        setTyped((x) => ({...x, [key]: value}));
        typedNow.current = {...typedNow.current, [key]: value};
        applyCorrection();
    }

    async function loadSaved() {
        try {
            const r = await readJson<{measurements?: Measurement[]}>(await fetch(base + "/measurements", {credentials: "same-origin"}));
            if (!r.ok) return;
            const items = r.data.measurements || [];
            setSaved(items);
            setCompared((c) => c.filter((x) => items.some((m) => m.id === x)));
        } catch {
            // the list stays as it was
        }
    }

    async function save() {
        const name = saveName.trim();
        if (!name || !current) return setMeasureError("Name the measurement to save it");
        const r = await readJson<Measurement>(await sendJson(base + "/measurements", "POST", {
            name, target: current.target, geometry: current.geometry, shape: current.shape, isotherm: isoValue, parameters: params}));
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
        const r = readCorrection(values, {});
        if (r.error) return r.error;
        // A frame's other parameters (distance, humidity, …) are kept
        const p: Record<string, number | null> = {...(m.parameters || {})};
        PARAM_FIELDS.forEach((f) => { delete p[f[0]]; });
        if (r.correction!.emissivity !== undefined) p.emissivity = Number(r.correction!.emissivity);
        if (r.correction!.reflected_temp !== undefined) p.reflected_temp = typedTemp(parseFloat(r.correction!.reflected_temp), unit);
        const res = await readJson<Measurement>(await sendJson(base + "/measurements/" + m.id, "PATCH", {parameters: p}));
        if (!res.ok) return errorText(res.data, "Could not measure again.");
        setEditing(null);
        setCurrent((c) => c && c.saved?.id === m.id ? {...c, saved: res.data, res: res.data.values} : c);
        await loadSaved();
        return null;
    }

    // A saved measurement shown on its mosaic, with its figures as saved
    function showSaved(m: Measurement) {
        if (!m.geometry) return;
        if (isTemperatureTab(m.target) && m.target !== tab) {
            drawing.current?.stop();
            syncTools();
            setTab(m.target);
        }
        setIndex(null);
        setCurrent({geometry: m.geometry, target: m.target, saved: m, res: m.values || null, shape: m.values?.shape});
    }

    async function action(path: string, failure: string) {
        const r = await readJson(await sendJson(base + path, "POST"));
        setNotice(r.ok ? "" : errorText(r.data, failure));
        await load();
    }

    // The mosaic as shown, its saved measurements (and the one drawn, not saved yet) and colour scale, as a PNG
    async function exportPng() {
        const m = map.current, l = layer.current;
        if (!m || !l || !v || !tab || !mapEl.current) return;
        const shapes = saved.filter((x) => x.target === tab && x.geometry).map((x) => shapeOnMap(m, x.geometry!, fromCoords, x.name));
        if (current && !current.saved && current.target === tab && temperature) shapes.push(shapeOnMap(m, current.geometry, fromCoords, ""));
        const size = m.getSize(), y = size.y / 2;
        const metresPerPx = m.distance(m.containerPointToLatLng([0, y]), m.containerPointToLatLng([size.x, y])) / size.x;
        const taken = takenText(v.flown), today = new Date().toISOString().slice(0, 10);
        const canvas = viewCanvas({
            title: [v.dataset_name, v.name, tabLabel(tab)].filter(Boolean).join(" · "),
            date: (taken ? "Flown " + taken + " · exported " : "Exported ") + today,
            panes: [{el: mapEl.current, images: Array.from(l.getContainer()?.querySelectorAll("img") || []), shapes}],
            legend: scale, scale: scaleBar(metresPerPx, 120), ratio: Math.max(1, devicePixelRatio || 1),
        });
        const error = await saveCanvas(canvas, fileName([v.dataset_name, v.name, tabLabel(tab)], ".png"));
        if (error) setNotice(error);
    }

    if (!v) {
        return (<div class="page viewer">
            {notice ? <div class="notice error" role="alert">{notice}</div> : <div class="message">Loading…</div>}
        </div>);
    }

    const kind = t?.kind ? (v.kinds || {})[t.kind] : undefined;
    const starts = correctionStarts(t?.kind ? (v.baselines || {})[t.kind] : null, unit);
    const auto_ = shown ? sliderPositions(autoRange(), shown.range) : {brightness: 0, contrast: 0};
    const res = current && current.target === tab ? current : null;

    return (
        <div class="page viewer">
            <div class="breadcrumb"><a href={publicUrl + "dataset/" + datasetId + "#convert"}><ArrowLeft/> {datasetName}</a></div>
            <div class="page-header">
                <div>
                    <h1 id="name">{v.name}</h1>
                    <div class="subtitle">{(v.description || "") + (v.stripped ? " · location stripped from the downloads" : "")}</div>
                </div>
                <div class="page-actions">
                    {v.status === "ready" && <a class="button default" id="frames" href={frameUrl.replace(/\?frame=$/, "")}>
                        <Image/> Frames</a>}
                    {ready && <a class="button default" id="compare" href={publicUrl + "conversion/" + id + "/compare"}
                                 title="This mosaic beside another mosaic, or their difference"><Columns/> Compare with…</a>}
                    {ready && <button type="button" class="button default" id="png" onClick={exportPng}
                                      title="The mosaic as shown, with its saved measurements and colour scale (the basemap is left out)">
                        <Download/> Export PNG</button>}
                    {v.status === "ready" && v.mosaic_status !== "building" &&
                        <button type="button" class="button default" id="build"
                                onClick={() => action("/mosaics", "Could not build the mosaics.")}>
                            <Grid/> {v.mosaic_status === "ready" ? "Build the mosaics again" : "Build mosaics"}</button>}
                    {isBusy(v) && <button type="button" class="button default" id="cancel"
                                          onClick={() => action("/cancel", "Could not cancel.")}><Stop/> Cancel</button>}
                </div>
            </div>

            {notice && <div class="notice error" role="alert">{notice}</div>}
            <MosaicStatus v={{...v, label: mosaicLabel(v)}}/>

            {/* Keyed: a notice appearing above it is never taken for it, which would make its map again */}
            <div class="viewer-main" key="main" hidden={!ready}>
                {ready && <div class="tabs" role="tablist">
                    {v.tabs!.map((x) => (
                        <a key={x.tab} href={"#" + x.tab} role="tab" aria-selected={tab === x.tab} class={tab === x.tab ? "active" : ""}
                           data-tab={x.tab} onClick={(e) => { e.preventDefault(); chooseTab(x.tab); }}>{tabLabel(x.tab)}</a>))}
                </div>}
                <div class="viewer-body">
                    <div class="viewer-map" id="map" ref={mapEl}/>
                    {ready && t && shown && <div class="viewer-panel">
                        <Controls tab={t} palette={shown.palette} palettes={v.palettes || []} scale={scale} unit={unit}
                                  range={rangeText || rangeFields(shown.range)} rangeError={rangeError}
                                  frames={(v.frames || []).length} frameColors={v.frame_colors}
                                  onPalette={(palette) => setStyle({palette})} onRange={typedRange} onAuto={() => auto()}/>
                        {tab !== "source_frame" && <Section name="image" title="Image">
                            <ImageControls adjust={shown.adjust} brightness={auto_.brightness} contrast={auto_.contrast}
                                           temperature={temperature} onSlide={slide} onGamma={gamma}
                                           onSharpen={(sharpen) => setStyle({adjust: {...style!.adjust, sharpen}})}
                                           onTone={(equalize) => setStyle({adjust: {...style!.adjust, equalize}})}
                                           onReset={() => auto(true)}/>
                        </Section>}
                        <Section name="cursor" title="Under the cursor">
                            <div class="readout" id="readout">
                                <Readout point={point} unit={unit} frameUrl={frameUrl} pinned={pinned} onFollow={follow}/>
                            </div>
                        </Section>
                        {temperature && <>
                            <Section name="measure" title="Measure">
                                <Toolbar tool={tools.tool} count={tools.count}
                                         onTool={(x) => { if (x) drawing.current?.start(x); else drawing.current?.stop(); syncTools(); }}
                                         onFinish={() => { drawing.current?.finish(); syncTools(); }}/>
                                <div id="result">
                                    {!res ? <p class="message">Choose a tool and draw on the mosaic.</p> :
                                        res.error ? <p class="text-danger">{res.error}</p> :
                                        res.res === undefined ? <p class="message">Measuring…</p> : <>
                                            {res.saved && <div class="message">Saved as <strong>{res.saved.name}</strong>
                                                {res.saved.values && (res.saved.values as {isotherm?: string}).isotherm &&
                                                    ", isotherm " + isothermText((res.saved.values as {isotherm?: string}).isotherm, unit)}</div>}
                                            <ResultView res={res.res} unit={unit} shape={res.shape} index={index}
                                                        onIndex={(i) => showIndex(i, res.res?.result?.profile?.points)}/>
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
                            <Section name="isotherm" title="Isotherm">
                                <Isotherm state={isotherm} error={isoError} onChange={changeIsotherm}/>
                            </Section>
                            <Section name="parameters" title="Parameters">
                                <Correction values={typed} starts={starts} error={corrError.error} field={corrError.field}
                                            onInput={correctionInput} onChange={correctionChange}/>
                            </Section>
                            <Section name="whole" title="This mosaic">
                                <Whole whole={style?.whole} unit={unit}/>
                            </Section>
                        </>}
                        <Section name="saved" title={<span class="measurements-head"><span>Saved measurements</span>
                            {saved.length > 0 && <a class="button default small" id="csv" href={base + "/measurements.csv"}
                                                    onClick={(e) => e.stopPropagation()}><Download/> CSV</a>}
                            {saved.some((m) => m.target !== "frame") &&
                                <a class="button default small" id="geojson" href={base + "/measurements.geojson"}
                                   title="The measurements on the mosaics, with their shapes, for a GIS"
                                   onClick={(e) => e.stopPropagation()}><Download/> GeoJSON</a>}</span>}>
                            {!temperature && measureError && <div class="text-danger" id="measure-error">{measureError}</div>}
                            <Measurements items={saved} unit={unit} current={current?.saved?.id ?? null} compared={compared}
                                          editing={editing} fields={PARAM_FIELDS} onShow={showSaved}
                                          onCompare={(x, on) => setCompared((c) => toggleCompared(c, x, on))}
                                          onEdit={setEditing} onRename={rename} onDelete={remove} onRemeasure={remeasure}/>
                        </Section>
                        <Section name="report" title="The mosaic">
                            <Report kind={kind} base={base}/>
                        </Section>
                    </div>}
                </div>
            </div>
        </div>
    );
}
