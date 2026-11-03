// The mosaic viewer: a conversion's mosaics on a map (as converted, harmonized, the source frames' seams, the view angles
// and the visual mosaic), with their palette, range and image adjustments, the values under the cursor, the drawing
// tools on the map, a shape's temperatures in a card there (with the isotherm and the thermal correction), kept as a
// finding or a saved measurement, the source frames of a spot or an area in a window, the dataset's findings, and
// the mosaic as a PNG; kept up to date while the mosaics are built. The view (tab, palette,
// range, adjustments, the frame outlined, the findings shown and the one open) is kept in the URL.
import type {Coordinate} from "ol/coordinate";
import GeoJSON from "ol/format/GeoJSON";
import type OlMap from "ol/Map";
import type TileLayer from "ol/layer/Tile";
import type VectorSource from "ol/source/Vector";
import type XYZ from "ol/source/XYZ";
import CircleStyle from "ol/style/Circle";
import Stroke from "ol/style/Stroke";
import OlStyle from "ol/style/Style";
import {getDistance} from "ol/sphere";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {viewAsked} from "../core/exports";
import {type FlightZone, type Maybe, mosaicLabel, type Stage} from "../core/format";
import {convertTemp, formatDelta} from "../core/units";
import {ask, askName} from "../components/dialog";
import {ArrowLeft, Columns, Download, FileText, Grid, Image, Stop} from "../components/icons";
import {Drawing, drawingKey, inField} from "../measure/drawing";
import {type Coords, type Geometry, isothermParam, type Measured, type Measurement, nearestIndex,
        type Shape, toggleCompared, TOOLS, typedTemp} from "../measure/measure";
import {type IsothermState, Isotherm, MeasureCard, Measurements, Toolbar} from "../measure/result";
import {hasSources, type Sources, sourcesUrl} from "../sources/sources";
import {SourcesWindow} from "../sources/window";
import {blankFields, type Finding, type FindingFields, fieldsBody, fieldsOf, findingSources,
        findingsUrl} from "../findings/findings";
import {centreOf, drawFindings, findingAt} from "../findings/layer";
import {FindingAbout, FindingForm, Findings, SaveFinding} from "../findings/panel";
import {type Colouring, isothermRange, SEAMS} from "../map/colour";
import {type Basemap, DATA_GUTTER, fitBounds, lonLatToMap, mapToLonLat, metresPerPixel, mosaicMap, rasterPixel, snapshot,
        ThermalLayer, type Values, vectorLayer, visualLayer} from "../map/map";
import {saveCanvas, type Scale, shapeOnMap, viewCanvas} from "./canvas";
import {MosaicExport} from "./export";
import {type Baseline, Controls, Correction, correctionStarts, ImageControls, MosaicStatus, type Palette, type Point,
        PanelGroup, Readout, Report, Section, Whole} from "./panel";
import {adjustQuery, type Correction as CorrectionValue, correctionParams, dataUrl, defaultAdjust, defaultRange,
        disagreement, type Extra, extraQuery, fileName, isTemperatureTab, type Kind, type MosaicTab, PARAM_FIELDS, parseRange, readCorrection,
        readView, reportRows, scaleBar, shownRange, slidRange, sliderGamma, sliderPositions, type Style, styleGroup, tabLabel,
        TAB_HINTS, TAB_TIPS, takenText, toneShares, valueCaption, viewQuery, type VisualMosaic, visualRows} from "./view";

const POLL_MS = 2000;
const HOVER_MS = 120;
export const WINDOW_VISUAL_PX = 1600;  // a visual frame in the source frames window, at most this many pixels across       // the readout asks for the point the cursor rests on, not every point it crosses
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
    flight_zone?: FlightZone | null;
    visual?: VisualMosaic | null;
    visual_note?: string;
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
const toCoords = (at: Coordinate): Coords => mapToLonLat(at) as Coords;
const fromCoords = (c: Coords): Coordinate => lonLatToMap(c);
const WORLD = [-180, -85, 180, 85];
const FOOTPRINT = new OlStyle({stroke: new Stroke({color: "rgba(255, 255, 255, 0.9)", width: 2})});
export const SOURCES_SHAPE = new OlStyle({stroke: new Stroke({color: "#ffea00", width: 2, lineDash: [6, 4]}),
                                   image: new CircleStyle({radius: 7, stroke: new Stroke({color: "#ffea00", width: 2})})});
// The Visual tab: the visual mosaic shown over the as converted one, whose values the readout, the source frames and
// the shapes drawn read
const VISUAL = "visual";
// The tabs whose spots and areas open their source frames, and the tools that draw them where nothing is measured
const SOURCES_TABS = ["as_converted", "harmonized", "source_frame"];
const SOURCES_TOOLS = TOOLS.filter(([x]) => x !== "line");
// A tab whose shapes are measured: a temperature mosaic, not under the visual one
const measures = (tab: Maybe<string>, visual: boolean) => !!tab && isTemperatureTab(tab) && !visual;

// A tab's palette and range before any is chosen
export function defaultStyle(v: Mosaics, tab: string): Style {
    const group = styleGroup(tab), t = (v.tabs || []).find((x) => x.tab === tab);
    return {palette: group === "view_angle" || group === "heights" ? "viridis" : v.default_palette || "",
            range: defaultRange(t, group === "temperature" ? v.unit : undefined), adjust: defaultAdjust()};
}

// The source frames asked for a spot or an area, on a tab: res undefined while they are asked, null when they could
// not be; shape: how it was drawn, measurement: the saved one it is; finding: the finding shown (its kept frames)
interface Asked {geometry: Geometry; tab: string; res?: Sources | null; error?: string; shape?: Maybe<Shape>;
                measurement?: Measurement; finding?: number}

// The finding form open: a new one (from the source frames shown) or one being changed
interface Draft {title: string; fields: FindingFields; edit?: Finding; error?: string}

// The same shape measured afresh (on another tab, or with another isotherm or correction)
const fresh = (c: Current | null, target: string): Current | null => c && {geometry: c.geometry, target, shape: c.shape};

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    datasetId: number;
    datasetName: string;
    basemaps: Basemap[];
    nav?: (url: string) => void;
}

export function ViewerPage({api, publicUrl, id, datasetId, datasetName, basemaps,
                            nav = (url) => { location.href = url; }}: Props) {
    const base = api + "conversions/" + id;
    const frameUrl = publicUrl + "conversion/" + id + "/frame?frame=";
    const [wanted] = useState(() => readView(location.search));
    const [v, setV] = useState<Mosaics | null>(null);
    const [notice, setNotice] = useState("");
    const [tab, setTab] = useState<string | null>(null);
    // Opened on Harmonized for the frames' offsets (°C), which the notice above the tabs gives, until it is closed
    const [evened, setEvened] = useState<{min: number; max: number} | null>(null);
    // The Visual tab is shown (tab is then the as converted one)
    const [visual, setVisual] = useState(false);
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
    const [exporting, setExporting] = useState(false);
    const [isoError, setIsoError] = useState("");
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [correction, setCorrection] = useState<CorrectionValue>({});
    const [corrError, setCorrError] = useState<{error?: string; field?: string}>({});
    const [saved, setSaved] = useState<Measurement[]>([]);
    const [compared, setCompared] = useState<number[]>([]);
    const [editing, setEditing] = useState<number | null>(null);
    const [saveName, setSaveName] = useState("");
    const [measureError, setMeasureError] = useState("");
    const [sources, setSources] = useState<Asked | null>(null);
    const [findings, setFindings] = useState<Finding[]>([]);
    const [showFindings, setShowFindings] = useState(wanted.findings !== false);
    const [hidden, setHidden] = useState<number[]>(wanted.hidden || []);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [findingError, setFindingError] = useState("");

    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const mapEl = useRef<HTMLDivElement>(null);
    const map = useRef<OlMap | null>(null);
    const layer = useRef<ThermalLayer | null>(null);
    const visualTiles = useRef<TileLayer<XYZ> | null>(null);
    const visualKey = useRef("");
    const seams = useRef<ThermalLayer | null>(null);
    const drawing = useRef<Drawing | null>(null);
    const footprint = useRef<VectorSource | null>(null);
    const sourcesShape = useRef<VectorSource | null>(null);
    const findingsShown = useRef<VectorSource | null>(null);
    // Counters: only the answer to the latest question is shown
    const asked = useRef({point: 0, outline: 0, curve: 0, whole: 0, measure: 0, sources: 0});

    const ready = isReady(v);
    const unit = v?.unit;
    const t = v && tab ? (v.tabs || []).find((x) => x.tab === tab) : undefined;
    // The tab whose values are drawn: the Source frame tab's are the as converted mosaic's, its own the seams
    const onSeams = tab === "source_frame";
    const drawnTab = onSeams && (v?.tabs || []).some((x) => x.tab === "as_converted") ? "as_converted" : tab;
    const d = drawnTab === tab ? t : (v?.tabs || []).find((x) => x.tab === drawnTab);
    const temperature = !!tab && isTemperatureTab(tab);
    const group = tab ? styleGroup(tab) : "";
    const style: Style | null = v && tab ? styles[group] || defaultStyle(v, tab) : null;
    const shown: Style | null = style && {...style, ...live};
    const params = unit !== undefined ? correctionParams(correction, unit) : {};
    const paramsKey = JSON.stringify(params);
    const tiles = (x: MosaicTab, extra?: Extra): Values =>
        ({kind: "tiles", url: dataUrl(api, id, x.tab, extra), bounds: x.bounds || WORLD, maxZoom: (x.maxzoom || 20) + 1,
          gutter: DATA_GUTTER, pixel: rasterPixel(x.bounds, v?.kinds?.[x.kind || ""]?.width)});
    const values: Values | null = d ? tiles(d, params) : null;
    const seamValues: Values | null = onSeams && t ? tiles(t) : null;
    const colouring = colouringOf(shown);

    // What the map's handlers (set up once) read: this render's values
    const now = useRef({tab, visual, params, current, pinned, outlined, findings});
    now.current = {tab, visual, params, current, pinned, outlined, findings};

    function show(data: Mosaics) {
        clearTimeout(timer.current);
        const wasReady = isReady(v);
        setV(data);
        document.title = data.name + " · DJI Thermal Analyzer";
        if (isReady(data)) {
            // Rebuilt: start again from the new mosaics' ranges
            if (!wasReady && map.current) setStyles({});
            if (!tab || !data.tabs!.some((x) => x.tab === tab)) {
                const onVisual = wanted.tab === VISUAL && !!data.visual && data.tabs!.some((x) => x.tab === "as_converted");
                // Without a tab asked for, frames that disagree open on Harmonized, which evens them out
                const off = !wanted.tab && !tab && data.tabs!.some((x) => x.tab === "harmonized") ? disagreement(data.kinds) : null;
                const first = onVisual ? "as_converted" : wanted.tab && data.tabs!.some((x) => x.tab === wanted.tab) ?
                    wanted.tab : off ? "harmonized" : data.tabs![0].tab;
                setEvened(off);
                setTab(first);
                setVisual(onVisual);
                if (!map.current && !onVisual) applyWanted(data, first);
            }
            if (!data.visual) setVisual(false);
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
        // Enter finishes the shape being drawn and Esc cancels it; else Esc closes the measurement's card, or lets go
        // of the spot or frame kept
        const keys = (e: KeyboardEvent) => {
            if (drawingKey(e, drawing.current)) return syncTools();
            if (e.key !== "Escape" || inField(e.target)) return;
            if (now.current.current) closeCard();
            else if (now.current.pinned) follow();
        };
        document.addEventListener("keydown", keys);
        return () => {
            clearTimeout(timer.current);
            clearTimeout(hover.current);
            clearTimeout(typing.current);
            document.removeEventListener("keydown", keys);
            map.current?.setTarget(undefined);
        };
    }, []);

    function syncTools() {
        const d = drawing.current;
        setTools({tool: d ? d.tool() : null, count: d ? d.count() : 0});
    }

    // The map, once there are mosaics to show: the basemaps, the mosaic's values and the drawing
    useEffect(() => {
        if (!ready || map.current || !mapEl.current || !t || !values || !colouring) return;
        const m = map.current = mosaicMap(mapEl.current, basemaps).map;
        footprint.current = vectorLayer(m, 5);
        sourcesShape.current = vectorLayer(m, 9);
        findingsShown.current = vectorLayer(m, 8);
        layer.current = new ThermalLayer(m, values, colouring);
        fitBounds(m, t.bounds || WORLD);
        makeVisual();

        m.on("pointermove", (e) => {
            if (now.current.pinned || e.dragging) return;
            clearTimeout(hover.current);
            hover.current = setTimeout(() => readout(e.coordinate), HOVER_MS);
        });
        m.getViewport()?.addEventListener("mouseleave", () => {
            if (now.current.pinned) return;
            clearTimeout(hover.current);
            asked.current.point++;
            setPoint(undefined);
        });
        drawing.current = new Drawing({
            map: m, toCoords, fromCoords, distance: (a, b) => getDistance(a, b),
            // Measured in the card on a temperature mosaic; elsewhere its source frames open
            onDone: (geometry, shape) => {
                if (!measures(now.current.tab, now.current.visual)) {
                    openSources(geometry, {shape});
                    syncTools();
                    return;
                }
                setCurrent({geometry, target: now.current.tab!, shape});
                setIndex(null);
                syncTools();
            },
            onChange: syncTools,
            onLineHover: (coords) => {
                const points = now.current.current?.res?.result?.profile?.points;
                showIndex(coords && points ? nearestIndex(points, coords) : null, points);
            },
            // A click with no tool on opens the finding there, else keeps the values there (and its frame's link)
            // until the next click; on the Source frame and Visual tabs it opens the frames that saw it too. A click
            // on the frame kept (outlined) lets go of it instead.
            onClick: (at) => {
                const hit = findingsShown.current && findingAt(m, m.getPixelFromCoordinate(at), findingsShown.current);
                const f = hit !== null && now.current.findings.find((x) => x.id === hit);
                if (f) return openFinding(f);
                const kept = now.current.pinned ? now.current.outlined : null;
                setPinned(true);
                now.current.pinned = true;
                clearTimeout(hover.current);
                readout(at, true, kept).then((shown) => {
                    if (shown && (now.current.tab === "source_frame" || now.current.visual)) {
                        openSources({type: "Point", coordinates: toCoords(at)});
                    }
                });
            },
        });
        loadSaved();
        loadFindings(wanted.finding);
        if (wanted.frame) showFrame(wanted.frame);
    }, [ready]);

    // The visual mosaic's tiles (made again when it is built again), shown instead of the values on the Visual tab
    function makeVisual() {
        const m = map.current, vis = v?.visual, key = JSON.stringify(vis || null);
        if (!m || key === visualKey.current) return;
        visualKey.current = key;
        if (visualTiles.current) m.removeLayer(visualTiles.current);
        visualTiles.current = vis && vis.bounds ?
            visualLayer(m, base + "/mosaics/visual/tiles/{z}/{x}/{y}.png", vis.bounds, (vis.maxzoom || 20) + 1) : null;
        showVisual();
    }
    function showVisual() {
        visualTiles.current?.setVisible(now.current.visual);
        layer.current?.layer.setVisible(!now.current.visual || !visualTiles.current);
    }
    useEffect(makeVisual, [JSON.stringify(v?.visual)]);
    useEffect(showVisual, [visual]);

    // The mosaic drawn again as the tab, palette, range, adjustments, isotherm and correction now are: its values
    // asked again only for another tab or correction
    useEffect(() => {
        if (values) layer.current?.setValues(values);
        if (colouring) layer.current?.setColouring(colouring);
    }, [JSON.stringify(values), JSON.stringify(colouring)]);

    // The seams over the mosaic, on the Source frame tab only
    useEffect(() => {
        const m = map.current;
        if (!m) return;
        if (!seamValues) {
            seams.current?.remove();
            seams.current = null;
        } else if (seams.current) {
            seams.current.setValues(seamValues);
        } else {
            seams.current = new ThermalLayer(m, seamValues, SEAMS, false);
        }
    }, [JSON.stringify(seamValues), ready]);

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

    // The source frames asked again on the tab chosen (its spot's temperature is its own), and their spot or area on
    // the map while the window is open
    useEffect(() => {
        if (sources && !sources.finding && tab && tab !== sources.tab && SOURCES_TABS.includes(tab)) {
            openSources(sources.geometry, {shape: sources.shape, measurement: sources.measurement});
        }
    }, [tab]);
    useEffect(() => {
        const f = sourcesShape.current;
        if (!f) return;
        f.clear();
        if (!sources || sources.finding) return;
        const feature = new GeoJSON().readFeature({type: "Feature", geometry: sources.geometry, properties: {}},
                                                  {featureProjection: "EPSG:3857"});
        (Array.isArray(feature) ? feature : [feature]).forEach((x) => { x.setStyle(SOURCES_SHAPE); f.addFeature(x); });
    }, [sources && JSON.stringify(sources.geometry)]);

    // The findings shown on the map, the one open drawn thicker
    const opened = sources?.finding ?? null;
    const drawn = showFindings ? findings.filter((f) => !hidden.includes(f.id)) : [];
    useEffect(() => {
        if (findingsShown.current) drawFindings(findingsShown.current, drawn, opened);
    }, [JSON.stringify(drawn), opened, ready]);

    // The colour scale, in the panel and the PNG (not on the map: the panel shows it)
    const scale = scaleShown();

    // The view in the URL, so that a reload or a copied link keeps it: the tab, its palette, range and adjustments,
    // the frame outlined, and the findings shown and open
    useEffect(() => {
        if (!ready || !tab || !style) return;
        const marks = {frame: outlined, findings: showFindings, hidden, finding: opened};
        const view = visual ? {tab: VISUAL, ...marks} : tab === "source_frame" ? {tab, ...marks} :
            {tab, ...marks, palette: style.palette, range: style.range, adjust: style.adjust};
        history.replaceState(null, "", location.pathname + viewQuery(view));
    }, [ready, tab, visual, outlined, style && style.palette, style && style.range.join(), style && adjustQuery(style.adjust),
        showFindings, hidden.join(), opened]);

    // The values at a point, kept (and its frame outlined) when pinned; kept: the frame outlined before, let go of
    // when the point is on it again. Resolves to whether the point's values are shown (not let go of, nor moved on).
    function readout(at: Coordinate, pin = false, kept: string | null = null): Promise<boolean> {
        const n = ++asked.current.point, q = now.current, [lon, lat] = mapToLonLat(at);
        return fetch(base + "/mosaics/" + q.tab + "/point?lon=" + lon + "&lat=" + lat +
                     extraQuery(q.params), {credentials: "same-origin"})
            .then((res) => readJson<Point>(res))
            .then((r) => {
                if (n !== asked.current.point) return false;    // the cursor moved on
                const frame = r.ok && r.data.valid && r.data.frame || null;
                if (pin && kept && frame === kept) {
                    follow();
                    return false;
                }
                setPoint(r.ok ? r.data : null);
                if (pin) outline(frame);
                return true;
            })
            .catch(() => {
                if (n !== asked.current.point) return false;
                setPoint(null);
                return true;
            });
    }

    // The frames that saw a spot or an area of the mosaic shown (or, on the View angle tab, of the as converted one;
    // a saved measurement's on its own mosaic)
    async function openSources(geometry: Geometry, more: {shape?: Maybe<Shape>; measurement?: Measurement} = {}) {
        const n = ++asked.current.sources;
        const at = more.measurement ? more.measurement.target : SOURCES_TABS.includes(now.current.tab || "") ? now.current.tab! : "as_converted";
        const asking: Asked = {geometry, tab: at, ...more};
        setSources(asking);
        // The spot's temperature corrected as the mosaic is
        const q = extraQuery(now.current.params);
        try {
            const r = await readJson<Sources>(await sendJson(sourcesUrl(api, id, at) + (q ? "?" + q.slice(1) : ""),
                                                             "POST", {geometry}));
            if (n !== asked.current.sources) return;
            setSources({...asking, res: r.ok ? r.data : null, error: r.ok ? "" : errorText(r.data, "Could not find the frames.")});
        } catch {
            if (n === asked.current.sources) setSources({...asking, res: null});
        }
    }

    function closeSources() {
        asked.current.sources++;
        setSources(null);
    }

    // The dataset's findings (open: the one a link asked to open)
    async function loadFindings(open?: Maybe<number>) {
        try {
            const r = await readJson<{findings?: Finding[]}>(await fetch(findingsUrl(api, datasetId), {credentials: "same-origin"}));
            if (!r.ok) return;
            const items = r.data.findings || [];
            setFindings(items);
            setHidden((h) => h.filter((x) => items.some((f) => f.id === x)));
            const f = open && items.find((x) => x.id === open);
            if (f) openFinding(f, true);
            return items;
        } catch {
            // the list stays as it was
        }
    }

    // A finding in the window with its kept frames (centre: the map moves to it)
    function openFinding(f: Finding, centre = false) {
        asked.current.sources++;
        setSources({geometry: f.geometry, tab: SOURCES_TABS.includes(now.current.tab || "") ? now.current.tab! : "as_converted",
                    res: findingSources(f), finding: f.id});
        const m = map.current;
        if (centre && m) m.getView().animate({center: centreOf(f), duration: 250});
    }

    // The form, to save the spot or area in the window as a finding (named as its measurement is), or to change one
    function newFinding(name = sources?.measurement?.name || "") {
        setDraft({title: "Save as finding", fields: blankFields(name)});
    }

    function editFinding(f: Finding) {
        setDraft({title: "Change finding", fields: fieldsOf(f), edit: f});
    }

    async function saveFinding(v: FindingFields) {
        const d = draft, s = sources;
        if (!d) return;
        if (!v.name.trim()) return setDraft({...d, error: "Name the finding to save it"});
        let r;
        if (d.edit) {
            r = await readJson<Finding>(await sendJson(findingsUrl(api, datasetId, d.edit.id), "PATCH",
                {...fieldsBody(v, d.edit.frames), kept: v.kept || d.edit.frames.map((x) => x.frame)}));
        } else {
            if (!s) return;
            const read = isTemperatureTab(s.tab) ? s.tab : "as_converted";
            const from = s.measurement ? {measurement: s.measurement.id} :
                {conversion: id, tab: read, geometry: s.geometry, shape: s.shape,
                 parameters: isTemperatureTab(now.current.tab || "") ? now.current.params : {}};
            r = await readJson<Finding>(await sendJson(findingsUrl(api, datasetId), "POST",
                                                       {...fieldsBody(v, s.res?.frames), ...from}));
        }
        if (!r.ok) return setDraft({...d, fields: v, error: errorText(r.data, "Could not save the finding.")});
        setDraft(null);
        setFindingError("");
        // The shape kept as a finding is drawn as one from now on: its card closes
        if (!d.edit && s) setCurrent((c) => c && !c.saved && JSON.stringify(c.geometry) === JSON.stringify(s.geometry) ? null : c);
        setHidden((h) => h.filter((x) => x !== r.data.id));
        await loadFindings();
        openFinding(r.data);
    }

    async function deleteFinding(f: Finding) {
        if (!await ask("Delete finding", "Delete the finding " + f.name + "?", "Delete", "danger")) return;
        const r = await readJson(await sendJson(findingsUrl(api, datasetId, f.id), "DELETE"));
        if (!r.ok) return setFindingError(errorText(r.data, "Could not delete the finding."));
        setFindingError("");
        if (sources?.finding === f.id) closeSources();
        await loadFindings();
    }

    // A drawing tool put on (or away)
    function pickTool(x: ReturnType<Drawing["tool"]>) {
        if (x) drawing.current?.start(x);
        else drawing.current?.stop();
        syncTools();
    }

    // The measurement's card closed, and its shape taken off the map
    function closeCard() {
        asked.current.measure++;
        setCurrent(null);
        setIndex(null);
        setMeasureError("");
    }

    // The shape in the card kept as a finding: the form, with the frames that saw it in the window beside it
    function keepCard(c: Current) {
        openSources(c.geometry, {shape: c.shape, measurement: c.saved || undefined});
        newFinding(c.saved?.name || saveName.trim());
    }

    // The frame's footprint outlined on the mosaic, what it contributes (null: none); fit: the map moves to it
    async function outline(path: string | null, fit = false) {
        const n = ++asked.current.outline, m = map.current, f = footprint.current;
        f?.clear();
        setOutlined(path);
        if (!path || !m || !f) return;
        try {
            const r = await readJson(await fetch(base + "/mosaics/footprint?frame=" + encodeURIComponent(path),
                                                 {credentials: "same-origin"}));
            if (n !== asked.current.outline || !r.ok) return;
            const features = new GeoJSON().readFeatures(r.data, {featureProjection: "EPSG:3857"});
            features.forEach((x) => x.setStyle(FOOTPRINT));
            f.addFeatures(features);
            if (fit && features.length) fitBounds(m, f.getExtent()!, true);
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

    // How the mosaic's values are coloured, as the tab's palette, range, adjustments and isotherm are (a slider's as
    // it is dragged)
    function colouringOf(s: Style | null): Colouring | null {
        if (!s || !v || !tab) return null;
        if (onSeams) return frameColouring();
        return {colors: (v.palettes || []).find((p) => p.key === s.palette)?.color_map || [], range: s.range,
                shares: shares(s.adjust), sharpen: s.adjust.sharpen, isotherm: temperature ? isothermRange(isoValue) : null};
    }

    // How the source frames are coloured: as the temperature mosaics are (without the isotherm), whichever tab is shown
    function frameStyle(): Style | null {
        return v && tab ? (isTemperatureTab(tab) ? style : styles.temperature || defaultStyle(v, "as_converted")) : null;
    }

    function frameColouring(): Colouring {
        const s = frameStyle();
        return s ? {colors: (v?.palettes || []).find((p) => p.key === s.palette)?.color_map || [], range: s.range,
                    shares: shares(s.adjust), sharpen: s.adjust.sharpen} : {colors: []};
    }

    function frameCurve(frame: string): string {
        const s = frameStyle();
        return s && s.adjust.equalize ? base + "/frame/curve?frame=" + encodeURIComponent(frame) + "&rescale=" + s.range[0] +
            "," + s.range[1] + adjustQuery(s.adjust) : "";
    }

    // The colour scale as the tab's palette and range now are, or null on a tab without one
    function scaleShown(): Scale | null {
        const s = onSeams ? frameStyle() : shown;
        if (!s || !v || !drawnTab || visual) return null;
        const colors = (v.palettes || []).find((p) => p.key === s.palette)?.color_map || [];
        return {colors, shown: shownRange(drawnTab, s.range, unit), shares: shares(s.adjust),
                caption: valueCaption(drawnTab)};
    }

    function chooseTab(chosen: string) {
        const onVisual = chosen === VISUAL, next = onVisual ? "as_converted" : chosen;
        if (onVisual !== visual) {
            setVisual(onVisual);
            now.current.visual = onVisual;
            // The tools are another set there
            drawing.current?.stop();
            syncTools();
        }
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

    // A slider dragged: the image drawn with its change at once, which is kept when it is let go
    function dragged(changes: Partial<Style>, done: boolean) {
        setLive(done ? null : changes);
        if (done) setStyle(changes);
    }

    // The brightness or contrast slider moved: the range follows
    function slide(brightness: number, contrast: number, done: boolean) {
        const r = slidRange(autoRange(), brightness, contrast);
        const range: [number, number] = temperature ?
            [typedTemp(Number(rangeFields(r)[0]), unit), typedTemp(Number(rangeFields(r)[1]), unit)] : r;
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

    // The mosaic as shown, its saved measurements (and the one drawn, not saved yet) and colour scale, as a PNG (the Export
    // dialog's As shown): "" once saved, else why it couldn't be
    async function exportShown(): Promise<string> {
        const m = map.current, l = visual ? visualTiles.current : layer.current?.layer;
        if (!m || !l || !v || !tab || !mapEl.current) return "The mosaic isn't shown yet.";
        const shownTab = visual ? VISUAL : tab;
        const shapes = saved.filter((x) => x.target === tab && x.geometry).map((x) => shapeOnMap(m, x.geometry!, fromCoords, x.name));
        drawn.forEach((f) => shapes.push(shapeOnMap(m, f.geometry, fromCoords, f.name)));
        if (current && !current.saved && current.target === tab && temperature && !visual) shapes.push(shapeOnMap(m, current.geometry, fromCoords, ""));
        const image = await snapshot(m, l);
        // the seams over the mosaic, on the Source frame tab
        const seamsImage = !visual && seams.current ? await snapshot(m, seams.current.layer) : null;
        const taken = takenText(v.flown, v.flight_zone), today = new Date().toISOString().slice(0, 10);
        const canvas = viewCanvas({
            title: [v.dataset_name, v.name, tabLabel(shownTab)].filter(Boolean).join(" · "),
            date: (taken ? "Flown " + taken + " · exported " : "Exported ") + today,
            panes: [{el: mapEl.current, images: [image, seamsImage].filter((x) => !!x), shapes}],
            legend: scale, scale: scaleBar(metresPerPixel(m), 120), ratio: Math.max(1, devicePixelRatio || 1),
        });
        return await saveCanvas(canvas, fileName([v.dataset_name, v.name, tabLabel(shownTab)], ".png")) || "";
    }

    // The mosaic report, with the view shown: saved with the report first
    async function openReport() {
        if (!tab || !style) return;
        const marks = {findings: showFindings, hidden};
        const view = tab === "source_frame" ? {tab, ...marks} :
            {tab, ...marks, palette: style.palette, range: style.range, adjust: style.adjust};
        const r = await readJson(await sendJson(base, "PATCH", {report: {view}}));
        if (!r.ok) return setNotice(errorText(r.data, "Could not open the report."));
        nav(publicUrl + "conversion/" + id + "/report");
    }

    // Above the window's frame: the finding shown, or the button that saves the spot or area as one
    function sourcesAbout() {
        const f = sources?.finding ? findings.find((x) => x.id === sources.finding) : null;
        if (f) return <FindingAbout f={f} onEdit={() => editFinding(f)}/>;
        if (!sources?.res || sources.res.reason === "outside_raster") return null;
        return <SaveFinding onSave={() => newFinding()}/>;
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
    // The tools: measuring on a temperature mosaic, else the source frames' where a tab has them
    const measuring = measures(tab, visual);
    const drawable = measuring || visual || tab === "source_frame";

    return (
        <div class="page viewer">
            <div class="breadcrumb"><a href={publicUrl + "dataset/" + datasetId + "#datasets"}><ArrowLeft/> {datasetName}</a></div>
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
                    {ready && <button type="button" class="button default" id="export" onClick={() => setExporting(true)}
                                      title="The mosaic as shown, with its measurements and colour scale, or whole at full resolution: a PNG or its GeoTIFF">
                        <Download/> Export…</button>}
                    {ready && <button type="button" class="button default" id="report" onClick={openReport}
                                      title="A report of this mosaic as shown, its measurements and findings, to print or save as PDF">
                        <FileText/> Mosaic report</button>}
                    {v.status === "ready" && v.mosaic_status !== "building" &&
                        <button type="button" class="button default" id="build"
                                onClick={() => action("/mosaics", "Could not build the mosaics.")}>
                            <Grid/> {v.mosaic_status === "ready" ? "Rebuild mosaics" : "Build mosaics"}</button>}
                    {isBusy(v) && <button type="button" class="button default" id="cancel"
                                          onClick={() => action("/cancel", "Could not cancel.")}><Stop/> Cancel</button>}
                </div>
            </div>

            {exporting && tab && (visual || shown) && <MosaicExport base={base} tab={visual ? VISUAL : tab}
                label={tabLabel(visual ? VISUAL : tab)} correction={params} asShown={exportShown} onClose={() => setExporting(false)}
                view={visual || !shown ? null : viewAsked(shown.palette, shown.range, shown.adjust, temperature ? isoValue : null)}/>}
            {notice && <div class="notice error" role="alert">{notice}</div>}
            <MosaicStatus v={{...v, label: mosaicLabel(v)}}/>

            {/* Keyed: a notice appearing above it is never taken for it, which would make its map again */}
            <div class="viewer-main" key="main" hidden={!ready}>
                {ready && evened && <div class="notice dismissible" role="status" id="evened">
                    <span>Opened on Harmonized: the frames differ by up to {formatDelta(evened.max - evened.min, "C", 0)} where
                        they overlap, which Harmonized evens out. Mosaic shows each frame as converted.</span>
                    <button type="button" class="close" title="Close" aria-label="Close" onClick={() => setEvened(null)}>×</button>
                </div>}
                {ready && <div class="tabs" role="tablist">
                    {v.tabs!.map((x) => x.tab).concat(v.visual ? [VISUAL] : []).map((x) => {
                        const on = visual ? x === VISUAL : tab === x;
                        return (<a key={x} href={"#" + x} role="tab" aria-selected={on} class={on ? "active" : ""}
                                   data-tab={x} title={TAB_TIPS[x]} onClick={(e) => { e.preventDefault(); chooseTab(x); }}>{tabLabel(x)}</a>);
                    })}
                </div>}
                <div class="viewer-body">
                    <div class="map-stage">
                        <div class="viewer-map" id="map" ref={mapEl}/>
                        {ready && drawable && <Toolbar tool={tools.tool} count={tools.count} tools={measuring ? TOOLS : SOURCES_TOOLS}
                            label={measuring ? "Drawing tools: measure a spot, a line or an area" : "Drawing tools: the frames that saw a spot or an area"}
                            onTool={pickTool} onFinish={() => { drawing.current?.finish(); syncTools(); }}/>}
                        {ready && measuring && res && <MeasureCard m={res} unit={unit} index={index}
                            onIndex={(i) => showIndex(i, res.res?.result?.profile?.points)}
                            name={saveName} error={measureError} onName={setSaveName} onSave={save} onClose={closeCard}
                            onKeep={hasSources(res.geometry) ? () => keepCard(res) : undefined}
                            onSources={hasSources(res.geometry) ?
                                () => openSources(res.geometry, {shape: res.shape, measurement: res.saved || undefined}) : undefined}/>}
                    </div>
                    {ready && t && shown && <div class="viewer-panel">
                        <PanelGroup title="View"/>
                        {visual ? <p class="hint" id="visual-hint">{TAB_HINTS[VISUAL]}</p> :
                            <Controls tab={t} palette={shown.palette} palettes={v.palettes || []} scale={scale} unit={unit}
                                      range={rangeText || rangeFields(shown.range)} rangeError={rangeError}
                                      frames={(v.frames || []).length}
                                      onPalette={(palette) => setStyle({palette})} onRange={typedRange} onAuto={() => auto()}/>}
                        {tab !== "source_frame" && !visual && <Section name="image" title="Image" folded>
                            <ImageControls adjust={shown.adjust} brightness={auto_.brightness} contrast={auto_.contrast}
                                           temperature={temperature} onSlide={slide} onGamma={gamma}
                                           onSharpen={sharpen}
                                           onTone={(equalize) => setStyle({adjust: {...style!.adjust, equalize}})}
                                           onReset={() => auto(true)}/>
                        </Section>}
                        {measuring && <Section name="isotherm" title="Isotherm">
                            <Isotherm state={isotherm} error={isoError} onChange={changeIsotherm}/>
                        </Section>}
                        <PanelGroup title="Values"/>
                        <Section name="cursor" title="Pointer info">
                            <div class="readout" id="readout">
                                <Readout point={point} unit={unit} frameUrl={frameUrl} pinned={pinned} onFollow={follow}/>
                            </div>
                        </Section>
                        {measuring && <>
                            <Section name="parameters" title="Parameters" folded>
                                <Correction values={typed} starts={starts} error={corrError.error} field={corrError.field}
                                            onInput={correctionInput} onChange={correctionChange}/>
                            </Section>
                            <Section name="whole" title="This mosaic" folded>
                                <Whole whole={style?.whole} unit={unit}/>
                            </Section>
                        </>}
                        <PanelGroup title="Kept"/>
                        <Section name="saved" title={<span class="measurements-head"><span>Saved measurements</span>
                            {saved.length > 0 && <a class="button default small" id="csv" href={base + "/measurements.csv"}
                                                    onClick={(e) => e.stopPropagation()}><Download/> CSV</a>}
                            {saved.some((m) => m.target !== "frame") &&
                                <a class="button default small" id="geojson" href={base + "/measurements.geojson"}
                                   title="The measurements on the mosaics, with their shapes, for a GIS"
                                   onClick={(e) => e.stopPropagation()}><Download/> GeoJSON</a>}</span>}>
                            {!(measuring && res) && measureError && <div class="text-danger" id="measure-error">{measureError}</div>}
                            <Measurements items={saved} unit={unit} current={current?.saved?.id ?? null} compared={compared}
                                          editing={editing} fields={PARAM_FIELDS} onShow={showSaved}
                                          onCompare={(x, on) => setCompared((c) => toggleCompared(c, x, on))}
                                          onEdit={setEditing} onRename={rename} onDelete={remove} onRemeasure={remeasure}
                                          onFinding={(m) => { openSources(m.geometry!, {shape: m.values?.shape, measurement: m}); newFinding(m.name); }}/>
                        </Section>
                        <Section name="findings" title={"Findings" + (findings.length ? " (" + findings.length + ")" : "")}>
                            {findingError && <div class="text-danger" id="finding-error">{findingError}</div>}
                            <Findings items={findings} shown={showFindings} hidden={hidden} opened={opened}
                                      onShown={setShowFindings} onOpen={(f) => openFinding(f, true)} onEdit={editFinding}
                                      onDelete={deleteFinding}
                                      onHide={(x, hide) => setHidden((h) => hide ? h.concat(x) : h.filter((y) => y !== x))}/>
                        </Section>
                        <PanelGroup title="About"/>
                        <Section name="report" title="The mosaic" folded>
                            {visual ? <Report rows={visualRows(v.visual)} files={v.visual?.files} base={base}/> :
                                <Report rows={reportRows(kind)} files={kind?.files} base={base}/>}
                        </Section>
                    </div>}
                </div>
            </div>
            {sources && <SourcesWindow name="viewer" anchor={mapEl.current} onClose={closeSources} about={sourcesAbout()} groups={[{
                title: "", res: sources.res, error: sources.error, unit, colouring: frameColouring(),
                values: (f) => base + "/frame/data?frame=" + encodeURIComponent(f),
                curve: (f) => frameCurve(f), href: (f) => frameUrl + encodeURIComponent(f),
                visual: v.visual ? (f) => base + "/frame/visual?frame=" + encodeURIComponent(f) + "&size=" + WINDOW_VISUAL_PX : undefined,
            }]} visual={visual}/>}
            {draft && <FindingForm title={draft.title} fields={draft.fields} error={draft.error} onSave={saveFinding}
                                   onCancel={() => setDraft(null)}
                                   frames={draft.edit ? draft.edit.frames : sources?.res === undefined ? undefined : sources.res?.frames ?? null}/>}
        </div>
    );
}
