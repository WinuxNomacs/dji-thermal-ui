// Two mosaics side by side: each pane shows a conversion's temperature or visual mosaic, the difference of pane A's and
// pane B's (A − B), or A's drawn over B's (faded, and swiped away right of a line), with pan and zoom linked, the cursor marked in the other pane, one palette and range shared (or each
// pane's own), the split between the panes moved, and the source frames of a spot or an area drawn in a pane, in a
// window, saved as a finding of its mosaic's dataset. A shape drawn with any of the measuring tools in a pane is
// measured on both mosaics, in a card on that pane's map (A, B and A − B), saved on both datasets; one isotherm is
// shared by both panes. Each pane draws its datasets' findings, opened by a click. The view (the mosaics, the
// difference or overlay, the split, the findings shown and open) is kept in the URL.
import type {Coordinate} from "ol/coordinate";
import type Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type OlPoint from "ol/geom/Point";
import type OlMap from "ol/Map";
import type TileLayer from "ol/layer/Tile";
import type XYZ from "ol/source/XYZ";
import View from "ol/View";
import type VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import {getDistance} from "ol/sphere";
import {type ComponentChildren, render} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {type Maybe} from "../core/format";
import {userUnit} from "../core/units";
import {ArrowLeft, Check, Flag, Link, Lock} from "../components/icons";
import {blankFields, type Finding, type FindingFields, fieldsBody, fieldsOf, findingSources,
        findingsUrl} from "../findings/findings";
import {centreOf, drawFindings, findingAt} from "../findings/layer";
import {FindingAbout, FindingForm, SaveFinding} from "../findings/panel";
import {Drawing, drawingKey, inField} from "../measure/drawing";
import {type Coords, type Geometry, HINTS, isothermParam, type Measured, type Measurement, nearestIndex, type Shape,
        symbol, TOOLS, type Tool} from "../measure/measure";
import {type IsothermState, Isotherm, MeasureCard, type Measuring, Toolbar} from "../measure/result";
import {type Colouring, isothermRange, scaleStops} from "../map/colour";
import {type Basemap, clipLeft, DATA_GUTTER, fitBounds, lonLatToMap, MAX_ZOOM, mapToLonLat, mosaicMap, pointFeature,
        rasterPixel, ThermalLayer, type Values, vectorLayer, visualLayer} from "../map/map";
import {type Scale} from "../viewer/canvas";
import {type Point, Readout, ScaleView} from "../viewer/panel";
import {bandsOf, dataUrl, defaultAdjust, type MosaicTab, sharesOf, tabLabel} from "../viewer/view";
import {type Mosaics, SOURCES_SHAPE, WINDOW_VISUAL_PX} from "../viewer/viewer-page";
import {autoRange, autoReach, clampShare, clampSplit, type Comparable, comparedTabs, type CompareStyle, compareQuery,
        dataTab, type DiffInfo, differenceDataUrl, differenceUrl, type DiffStyle, firstTab, frameDataUrl,
        mosaicGroups, NO_OVERLAP, OPACITY_STEP, type PaneName, profileAt, rangeIn, reachIn, readCompare,
        resultIn, SPLIT_LIMITS, SPLIT_STEP, SWIPE_LIMITS, VISUAL} from "./compare";
import {hasSources, type Sources, sourcesUrl} from "../sources/sources";
import {type SourceGroup, SourcesWindow} from "../sources/window";
import {PointerTemperatureBox, type PointerTip, pointerTip, usePointerTemperature} from "../map/pointer-temperature";
import {compareTipText, DifferenceReadout, paneDelta, StyleBar} from "./pane";

const HOVER_MS = 120;       // the readout asks for the point the cursor rests on, not every point it crosses
const CURSOR = new Style({image: new CircleStyle({radius: 6, stroke: new Stroke({color: "#fff", width: 2})})});
const PICKED = new Style({image: new CircleStyle({radius: 6, stroke: new Stroke({color: "#fff", width: 2}),
                                                  fill: new Fill({color: "#e8562a"})})});
const NAMES: PaneName[] = ["a", "b"];
// Without temperatures (two visual mosaics of their own) there is no Delta T to measure
const SIZE_TOOLS = TOOLS.filter(([x]) => x !== "delta");
// Delta T's second click: in the same pane, or in the other for a ΔT across the two images
const COMPARE_HINTS = {...HINTS, delta: "Click the first spot, then the second: in this pane, both spots measured on both " +
    "mosaics; in the other pane, ΔT across the two images (the second spot's temperature on its image minus the first's)."};
const PENDING = new Style({image: new CircleStyle({radius: 5, fill: new Fill({color: "#ffd600"}),
                                                   stroke: new Stroke({color: "#000", width: 1})})});
const toCoords = (at: Coordinate): Coords => mapToLonLat(at) as Coords;

// What a pane shows: a conversion's temperature tab or visual mosaic (its mosaics' info), the difference, or A over B
// (overlay); its own palette and range (used when they are not shared), and the difference's
interface PaneState {conv: number; tab: string; info: Mosaics; diff: boolean; overlay: boolean; style: CompareStyle;
                     diffStyle: DiffStyle | null}
type Panes = Record<PaneName, PaneState>;

// A spot or an area drawn in a pane, and the frames that saw it in each mosaic it reads (res undefined while they are
// asked, null when they could not be); or a finding opened there, with its kept frames on the mosaic of its dataset
interface PickMosaic {pane: PaneName; conv: number; unit: unknown; res?: Sources | null; error?: string}
interface Pick {geometry: Geometry; shape?: Maybe<Shape>; mosaics: PickMosaic[]; finding?: number}

// A shape drawn in a pane with the measuring tools, measured on A's and B's mosaics (res: each pane's, null where it is
// not measured; undefined while they are asked), and the first of its measurements once saved
// across: a Delta T across the two images, its first spot on that pane's mosaic and its second on the other's
interface Card {pane: PaneName; geometry: Geometry; shape?: Maybe<Shape>; res?: Record<PaneName, Measured | null>; error?: string;
                saved?: Measurement | null; across?: PaneName}

// The finding form open: a new one from a mosaic of what a pane's window shows (its index in the pick), or one changed
interface Draft {title: string; fields: FindingFields; pane: PaneName; mosaic: number; edit?: Finding; error?: string}

// A mosaic or the difference drawn on a pane's map: its values coloured, or the visual mosaic's tiles
interface Drawn {key: string; thermal?: ThermalLayer; tiles?: TileLayer<XYZ>; unclip: () => void}

// A pane's map and what is on it: what it draws (bottom first; the top one, top, cut at swipe % across while it shows
// A over B), the cursor of the other pane, the spot or area drawn, the findings, the drawing, Temperature On Pointer's tip
interface PaneMap {
    map: OlMap; legend: HTMLDivElement; drawn: Drawn[]; top: string | null; swipe: number | null;
    marks: VectorSource; cursor: Feature | null; shape: VectorSource; findings: VectorSource; drawing: Drawing;
    tip: PointerTip; pending: Feature | null;
}

// What a pane's map draws: its values (key: which mosaic or difference) and how they are coloured, or the visual tiles
interface LayerSpec {key: string; values?: Values; colouring?: Colouring; visual?: {url: string; bounds: number[]; maxZoom: number}}

const other = (name: PaneName): PaneName => name === "a" ? "b" : "a";
const tabEntry = (p: PaneState): MosaicTab | undefined => (p.info.tabs || []).find((t) => t.tab === dataTab(p.tab));
const isVisual = (p: PaneState) => p.tab === VISUAL;
// A visual mosaic of its own: no values to read, its frames the visual ones
const isAlone = (p: PaneState) => !!p.info.visual_only;
const readTab = (p: PaneState) => dataTab(p.tab, isAlone(p));
// The panes a shape is measured on: those with temperatures (a conversion's visual mosaic read on its as converted
// values), else both visual mosaics of their own (their sizes)
function measuredPanes(p: Panes): PaneName[] {
    const temperatures = NAMES.filter((x) => !isAlone(p[x]));
    return temperatures.length ? temperatures : NAMES;
}
const boundsOf = (p: PaneState) => isAlone(p) ? p.info.visual?.bounds : tabEntry(p)?.bounds;
// What a pane of a visual mosaic of its own reads at the cursor
const NO_VALUES: Point = {valid: false, reason: "visual"};
// The panes whose mosaics a pane draws, bottom first: its own, B's under A's for the overlay, none for the difference
const drawsOf = (n: PaneName, p: PaneState): PaneName[] => p.diff ? [] : p.overlay ? ["b", "a"] : [n];
// Whose source frames and findings a pane shows: A's and B's for the difference and the overlay
const readsOf = (n: PaneName, p: PaneState): PaneName[] => p.diff || p.overlay ? ["a", "b"] : [n];
const olLayer = (d: Drawn) => d.thermal ? d.thermal.layer : d.tiles!;
const diffKey = (panes: Panes) => [panes.a.conv, panes.a.tab, panes.b.conv, panes.b.tab].join(":");
const WORLD = [-180, -85, 180, 85];
// A view of its own where another map's is (a pane unlinked)
const viewLike = (v: View) => new View({center: v.getCenter(), resolution: v.getResolution(), maxZoom: MAX_ZOOM});
const copyStyle = (s: CompareStyle): CompareStyle => ({palette: s.palette, range: [s.range[0], s.range[1]], adjust: {...s.adjust}});

interface Props {
    api: string;
    publicUrl: string;
    id: number;             // the page's conversion: pane A's unless the URL names another
    otherId: number;        // pane B's
    name: string;
    datasetName: string;
    basemaps: Basemap[];
}

// A header button that stays on or off: one label either way, pressed in with a check when on
function Toggle({id, on, title, onClick, children}: {id: string; on: boolean; title: string; onClick: () => void;
                                                     children: ComponentChildren}) {
    return (<button type="button" id={id} class="button default toggle" aria-pressed={on} title={title} onClick={onClick}>
        {children}{on && <Check class="icon toggle-check"/>}</button>);
}

export function ComparePage({api, publicUrl, id, otherId, name, datasetName, basemaps}: Props) {
    const [wanted] = useState(() => readCompare(location.search));
    const [list, setList] = useState<Comparable[]>([]);
    const [status, setStatus] = useState<{text: string; error?: boolean} | null>({text: "Loading the mosaics…"});
    const [panes, setPanes] = useState<Panes | null>(null);
    const [shared, setShared] = useState<CompareStyle | null>(null);
    const [linked, setLinked] = useState(true);
    const [locked, setLocked] = useState(true);
    const [split, setSplit] = useState(wanted.split || 50);
    const [opacity, setOpacity] = useState(wanted.opacity ?? 100);
    const [swipe, setSwipe] = useState(wanted.swipe ?? 50);
    const [dragging, setDragging] = useState(false);
    const [diffs, setDiffs] = useState<Record<string, DiffInfo | null>>({});     // null: it could not be loaded
    const [under, setUnder] = useState<Record<PaneName, Maybe<Point>> | undefined>(undefined);
    const [tools, setTools] = useState<Record<PaneName, {tool: Tool | null; count: number}>>(
        {a: {tool: null, count: 0}, b: {tool: null, count: 0}});
    const [picks, setPicks] = useState<Record<PaneName, Pick | null>>({a: null, b: null});
    // The findings of the datasets shown, by dataset
    const [findings, setFindings] = useState<Record<number, Finding[]>>({});
    const [showFindings, setShowFindings] = useState(wanted.findings !== false);
    const [tipOn, setTipOn] = usePointerTemperature();
    const [draft, setDraft] = useState<Draft | null>(null);
    const [card, setCard] = useState<Card | null>(null);
    const [saveName, setSaveName] = useState("");
    const [measureError, setMeasureError] = useState("");
    const [index, setIndex] = useState<number | null>(null);
    // The isotherm as typed (in the user's unit), and as it was last read right: what the panes and the card use
    const [isoTyped, setIsoTyped] = useState<IsothermState>({mode: ""});
    const [iso, setIso] = useState<IsothermState>({mode: ""});
    const [isoError, setIsoError] = useState("");
    const [mapsMade, setMapsMade] = useState(false);
    const [live, setLive] = useState<{where: PaneName | "shared"; changes: Partial<CompareStyle>} | null>(null);

    const mapEls = {a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null)};
    const body = useRef<HTMLDivElement>(null);
    const acrossLine = useRef<SVGSVGElement>(null);
    const maps = useRef<Partial<Record<PaneName, PaneMap>>>({});
    const infos = useRef<Record<number, Promise<Mosaics>>>({});
    const asking = useRef<Record<string, boolean>>({});
    const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const drag = useRef(false);
    const swiping = useRef<PaneName | null>(null);
    // Counters: only the answer to the latest question is shown
    const asked = useRef({point: 0, a: 0, b: 0, measure: 0});
    // A Delta T begun in one pane, whose second spot may be clicked in the other
    const pending = useRef<{from: PaneName; first: Coords} | null>(null);

    // The findings a link asked to open, once their datasets' are in
    const toOpen = useRef<Record<PaneName, Maybe<number>>>({a: wanted.a_finding, b: wanted.b_finding});

    // What the maps' handlers (set up once) read: this render's values
    const now = useRef({panes, linked, picks, findings, list, card, tipOn});
    now.current = {panes, linked, picks, findings, list, card, tipOn};

    const palettes = panes?.a.info.palettes || [];
    const key = panes ? diffKey(panes) : "";
    const styleOf = (n: PaneName): CompareStyle => locked ? shared! : panes![n].style;
    // As it is drawn: with the change of a slider being dragged
    const drawnStyle = (where: PaneName | "shared"): CompareStyle => {
        const s = where === "shared" ? shared! : styleOf(where);
        return live && live.where === (where === "shared" || locked ? "shared" : where) ? {...s, ...live.changes} : s;
    };

    const get = <T, >(url: string) => fetch(url, {credentials: "same-origin"}).then((res) => readJson<T>(res));

    // A conversion's mosaics (/mosaics), asked once
    function info(conv: number): Promise<Mosaics> {
        if (!infos.current[conv]) {
            infos.current[conv] = get<Mosaics>(api + "conversions/" + conv + "/mosaics").then((r) => {
                if (!r.ok) throw new Error("mosaics");
                return r.data;
            });
            infos.current[conv].catch(() => { delete infos.current[conv]; });
        }
        return infos.current[conv];
    }

    // The Auto range of the panes' temperature mosaics
    const thermalRange = (p: Panes) => autoRange(NAMES.filter((n) => !isVisual(p[n])).map((n) => ({tab: tabEntry(p[n]), unit: p[n].info.unit})));

    async function start() {
        try {
            const r = await get<Comparable[]>(api + "conversions/" + id + "/comparable");
            if (!r.ok) return setStatus({text: "Could not load the mosaics to compare.", error: true});
            const all = r.data || [], find = (x: Maybe<number>) => all.find((c) => c.id === x);
            setList(all);
            const a = (wanted.a !== undefined && find(wanted.a)) || find(id);
            if (!a) return setStatus({text: "This dataset has no mosaics to compare."});
            const b = find(otherId) || a;
            const aTab = firstTab(a, wanted.a_tab);
            const bTab = b.id === a.id ? firstTab(b, wanted.b_tab, aTab) : firstTab(b, wanted.b_tab);
            const [ia, ib] = await Promise.all([info(a.id), info(b.id)]);
            const style: CompareStyle = {palette: ia.default_palette || "", adjust: defaultAdjust(), range: [0, 1]};
            // No difference with a visual mosaic
            const diff = aTab === VISUAL || bTab === VISUAL ? "" : wanted.diff;
            const next: Panes = {
                a: {conv: a.id, tab: aTab, info: ia, diff: diff === "a", overlay: wanted.overlay === "a", style, diffStyle: null},
                b: {conv: b.id, tab: bTab, info: ib, diff: diff === "b", overlay: wanted.overlay === "b", style, diffStyle: null},
            };
            style.range = thermalRange(next);
            setPanes({a: {...next.a, style: copyStyle(style)}, b: {...next.b, style: copyStyle(style)}});
            setShared(style);
            setStatus(null);
        } catch {
            setStatus({text: "Could not load the mosaics.", error: true});
        }
    }

    useEffect(() => { hideTips(); }, [tipOn]);

    useEffect(() => {
        start();
        const keys = (e: KeyboardEvent) => {
            if (NAMES.some((n) => drawingKey(e, maps.current[n]?.drawing || null))) syncTools();
            else if (e.key === "Escape" && !inField(e.target) && now.current.card) closeCard();
        };
        document.addEventListener("keydown", keys);
        // The split follows the mouse while its handle is held
        const move = (e: MouseEvent) => {
            const sw = swiping.current && mapEls[swiping.current].current;
            if (sw) {
                const rect = sw.getBoundingClientRect();
                if (rect.width > 0) setSwipe(clampShare((e.clientX - rect.left) / rect.width * 100));
                return;
            }
            if (!drag.current || !body.current) return;
            const rect = body.current.getBoundingClientRect();
            if (rect.width > 0) setSplit(clampSplit((e.clientX - rect.left) / rect.width * 100));
        };
        const up = () => { drag.current = false; swiping.current = null; setDragging(false); };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
        return () => {
            clearTimeout(hover.current);
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            document.removeEventListener("keydown", keys);
            NAMES.forEach((n) => maps.current[n]?.map.setTarget(undefined));
        };
    }, []);

    // Both maps, once the mosaics are in, with one view while they are linked: fitted to A's mosaic
    useEffect(() => {
        if (!panes || maps.current.a || !mapEls.a.current || !mapEls.b.current) return;
        setupMap("a", mapEls.a.current);
        setupMap("b", mapEls.b.current, now.current.linked ? maps.current.a!.map.getView() : undefined);
        fitBounds(maps.current.a!.map, boundsOf(panes.a) || WORLD);
        setMapsMade(true);
    }, [panes]);

    function setupMap(n: PaneName, el: HTMLDivElement, view?: View) {
        const {map: m, legend} = mosaicMap(el, basemaps, view);
        const findingsShown = vectorLayer(m, 8);
        const drawing = new Drawing({
            map: m, toCoords, fromCoords: lonLatToMap, distance: (a, b) => getDistance(a, b),
            onDone: (geometry, shape) => {
                setCard({pane: n, geometry, shape});
                setMeasureError("");
                showIndex(null);
                syncTools();
            },
            onChange: syncTools,
            onLineHover: (coords) => {
                const points = profilePoints(now.current.card);
                showIndex(coords && points ? nearestIndex(points, coords) : null, points);
            },
            // A click with no tool on: a Delta T's second spot, begun in the other pane, else the finding there
            onClick: (at) => {
                const q = pending.current;
                if (q && q.from !== n) return finishAcross(q, n, at);
                const hit = findingAt(m, m.getPixelFromCoordinate(at), findingsShown);
                const f = hit !== null && paneFindings(n).find((x) => x.id === hit);
                if (f) openFinding(n, f);
            },
        });
        m.on("postrender", drawAcross);
        const pm: PaneMap = maps.current[n] = {map: m, legend, drawn: [], top: null, swipe: null, marks: vectorLayer(m, 20),
                                               cursor: null, shape: vectorLayer(m, 9), findings: findingsShown, drawing,
                                               tip: pointerTip(m), pending: null};
        // The cursor marked in the other pane
        m.on("pointermove", (e) => {
            const o = maps.current[other(n)];
            if (o?.cursor) (o.cursor.getGeometry() as OlPoint).setCoordinates(e.coordinate);
            else if (o) {
                o.cursor = pointFeature(e.coordinate);
                o.cursor.setStyle(CURSOR);
                o.marks.addFeature(o.cursor);
            }
            if (pm.cursor) { pm.marks.removeFeature(pm.cursor); pm.cursor = null; }
            hideTips();
            if (e.dragging) return;
            clearTimeout(hover.current);
            hover.current = setTimeout(() => readout(e.coordinate, n), HOVER_MS);
        });
        m.getViewport()?.addEventListener("mouseleave", () => {
            clearTimeout(hover.current);
            hideTips();
            asked.current.point++;
            NAMES.forEach((x) => {
                const xm = maps.current[x];
                if (xm?.cursor) { xm.marks.removeFeature(xm.cursor); xm.cursor = null; }
            });
            setUnder(undefined);
        });
    }

    function syncTools() {
        const of = (n: PaneName) => {
            const d = maps.current[n]?.drawing;
            return {tool: d ? d.tool() : null, count: d ? d.count() : 0};
        };
        setTools({a: of("a"), b: of("b")});
        // A Delta T's first spot clicked, where both panes show a temperature mosaic: its second may be in the other pane,
        // where the first is marked
        const p = now.current.panes, d = (n: PaneName) => maps.current[n]?.drawing;
        const from = p && NAMES.every((x) => !p[x].diff && !p[x].overlay && !isAlone(p[x])) ?
            NAMES.find((n) => d(n)?.tool() === "delta" && d(n)!.count() === 1) : undefined;
        pending.current = from ? {from, first: d(from)!.vertices()[0]} : null;
        NAMES.forEach((n) => {
            const pm = maps.current[n];
            if (!pm) return;
            if (pm.pending) { pm.marks.removeFeature(pm.pending); pm.pending = null; }
            if (from && n !== from) {
                pm.pending = pointFeature(lonLatToMap(pending.current!.first));
                pm.pending.setStyle(PENDING);
                pm.marks.addFeature(pm.pending);
            }
        });
    }

    // A Delta T across: a line over both panes from its spot 1 to its spot 2, across the split; hidden while either spot
    // is out of its own pane's view, where the line would point at the wrong place
    function drawAcross() {
        const svg = acrossLine.current, el = body.current, c = now.current.card;
        if (!svg || !el) return;
        const g = c?.across && c.geometry?.type === "LineString" ? c.geometry.coordinates : null;
        const at = g && ([[c!.across!, g[0]], [other(c!.across!), g[1]]] as const).map(([n, coords]) => {
            const m = maps.current[n]?.map, size = m?.getSize(), px = m?.getPixelFromCoordinate(lonLatToMap(coords));
            if (!m || !size || !px || px[0] < 0 || px[1] < 0 || px[0] > size[0] || px[1] > size[1]) return null;
            const r = m.getViewport()!.getBoundingClientRect(), b = el.getBoundingClientRect();
            return [r.left - b.left + px[0], r.top - b.top + px[1]];
        });
        if (!at || !at[0] || !at[1]) return svg.removeAttribute("data-shown");
        svg.setAttribute("data-shown", "");
        svg.querySelectorAll("line").forEach((l) => {
            l.setAttribute("x1", String(at[0]![0]));
            l.setAttribute("y1", String(at[0]![1]));
            l.setAttribute("x2", String(at[1]![0]));
            l.setAttribute("y2", String(at[1]![1]));
        });
    }

    // A Delta T's second spot clicked in the other pane than its first: a Delta T across the two images, its card there
    function finishAcross(q: {from: PaneName; first: Coords}, n: PaneName, at: Coordinate) {
        maps.current[q.from]?.drawing.stop();
        syncTools();
        setCard({pane: n, geometry: {type: "LineString", coordinates: [q.first, toCoords(at)]}, shape: {kind: "across"},
                 across: q.from});
        setMeasureError("");
        showIndex(null);
    }

    // A Delta T across: how its saved row (on pane x's dataset) reads it: the end own on x's mosaic, the other on the
    // other pane's
    function acrossShape(c: Card, x: PaneName): Shape {
        const p = panes!, y = other(x);
        return {kind: "across", own: x === c.across ? 0 : 1, other: p[y].conv, other_target: readTab(p[y])};
    }

    // A drawing tool put on in a pane (or away): the other pane's put away
    function pickTool(n: PaneName, x: Tool | null) {
        maps.current[other(n)]?.drawing.stop();
        if (x) maps.current[n]?.drawing.start(x);
        else maps.current[n]?.drawing.stop();
        syncTools();
    }

    // The profile's sample the cursor is at, marked on the line in both panes
    function showIndex(i: number | null, points?: Maybe<Coords[]>) {
        setIndex(i);
        NAMES.forEach((n) => maps.current[n]?.drawing.showCursor(i === null || i < 0 || !points ? null : points[i]));
    }

    // Where the card's line was sampled: the first mosaic's measure
    const profilePoints = (c: Maybe<Card>) => NAMES.map((x) => c?.res?.[x]?.result?.profile?.points).find((x) => x);

    function closeCard() {
        asked.current.measure++;
        setCard(null);
        setMeasureError("");
        showIndex(null);
    }

    // The isotherm of a pane's mosaic, in its conversion's unit ("" for none)
    const isoFor = (p: PaneState): string =>
        iso.mode && !isAlone(p) ? isothermParam(iso.mode, iso.a || "", iso.b || "", p.info.unit).value || "" : "";

    function changeIsotherm(s: IsothermState, field: string) {
        let next = s;
        if (field === "mode" && s.mode && (s.a ?? "") === "") {
            // Starts from the top of the range shown (A's, or the shared one): the hottest part shows
            const range = (locked ? shared : panes?.a.style)?.range || [0, 1];
            next = {...s, a: String(Math.round((range[1] - (range[1] - range[0]) / 4) * 10) / 10),
                    b: String(Math.round(range[1] * 100) / 100)};
        }
        setIsoTyped(next);
        const r = isothermParam(next.mode, next.a || "", next.b || "", userUnit());
        setIsoError(r.error || "");
        if (!r.error) setIso(next);
    }

    // The shape drawn saved on both datasets (once on a dataset whose mosaic both panes show)
    async function save() {
        const name = saveName.trim(), c = card, p = panes;
        if (!c || !p) return;
        if (!name) return setMeasureError("Name the measurement to save it");
        // A Delta T across: on both datasets, each with its own end (twice on one dataset whose two tabs it spans)
        const which = c.across ? NAMES : measuredPanes(p).filter((x, i, all) =>
            all.findIndex((y) => p[y].conv === p[x].conv && readTab(p[y]) === readTab(p[x])) === i);
        const saved: Measurement[] = [];
        for (const x of which) {
            const r = await readJson<Measurement>(await sendJson(api + "conversions/" + p[x].conv + "/measurements", "POST",
                c.across ? {name, target: readTab(p[x]), geometry: c.geometry, shape: acrossShape(c, x)} :
                    {name, target: readTab(p[x]), geometry: c.geometry, shape: c.shape ?? undefined, isotherm: isoFor(p[x])}));
            if (!r.ok) {
                if (saved.length) setCard({...c, saved: saved[0]});
                return setMeasureError((saved.length ? "Saved on " + which[0].toUpperCase() + "'s dataset only. " : "") +
                                       errorText(r.data, "Could not save the measurement."));
            }
            saved.push(r.data);
        }
        setMeasureError("");
        setSaveName("");
        setCard({...c, saved: saved[0]});
    }

    // What the card shows: A's and B's figures (B's in A's unit, its profile at A's samples) with A − B, or one mosaic's
    // where the other has none there or no temperatures, with a line naming them
    function cardShown(c: Card): {m: Measuring; unit: unknown; compared: boolean; note?: string} {
        const p = panes!, named = (x: PaneName) => {
            const conv = list.find((y) => y.id === p[x].conv);
            return x.toUpperCase() + " " + (conv ? conv.name + " · " : "") + tabLabel(p[x].tab);
        };
        const base = {error: c.error, saved: c.saved, shape: c.shape};
        if (!c.res) return {m: {...base, res: c.res}, unit: p.a.info.unit, compared: false};
        if (c.across) {
            const x = c.across;
            return {m: {...base, res: c.res[x] && {...c.res[x]!, shape: c.shape}}, unit: p[x].info.unit, compared: false,
                    note: "First spot on " + named(x) + ", second on " + named(other(x))};
        }
        const got = NAMES.filter((x) => c.res![x]?.result), valid = got.filter((x) => c.res![x]!.result!.valid_pixels);
        const shown = valid.length ? valid : got.slice(0, 1);
        if (!shown.length) return {m: {...base, res: null}, unit: p.a.info.unit, compared: false};
        const first = shown[0], unit = p[first].info.unit, result = c.res[first]!.result!;
        const approximate = shown.some((x) => c.res![x]!.approximate);
        if (shown.length === 2) {
            let b = resultIn(c.res.b!.result!, p.b.info.unit, unit);
            if (result.profile && b.profile) b = {...b, profile: profileAt(b.profile, result.profile.values.length)};
            return {m: {...base, res: {result, changed: b, approximate, shape: c.shape}}, unit, compared: true,
                    note: named("a") + ", " + named("b")};
        }
        const left = NAMES.find((x) => x !== first)!;
        const why = !c.res[left] ? left.toUpperCase() + " is a visual mosaic, with no temperatures" :
            got.length === 2 ? "outside " + left.toUpperCase() + "'s mosaic" : "";
        return {m: {...base, res: {result, approximate, shape: c.shape}}, unit, compared: false,
                note: named(first) + (why ? "; " + why : "")};
    }

    function pointOf(p: PaneState, at: Coordinate): Promise<Point | null> {
        if (isAlone(p)) return Promise.resolve(NO_VALUES);
        const [lon, lat] = mapToLonLat(at);
        return get<Point>(api + "conversions/" + p.conv + "/mosaics/" + dataTab(p.tab) + "/point?lon=" + lon + "&lat=" + lat)
            .then((r) => r.ok ? r.data : null, () => null);
    }

    // Both mosaics' values at the cursor (in pane from): each pane's readout is made from them, and the tip beside it
    function readout(at: Coordinate, from: PaneName) {
        const n = ++asked.current.point, p = now.current.panes;
        if (!p) return;
        Promise.all([pointOf(p.a, at), pointOf(p.b, at)]).then(([a, b]) => {
            if (n !== asked.current.point) return;      // the cursor moved on
            setUnder({a, b});
            showTip(from, at, a, b);
        });
    }

    // Temperature On Pointer: the tip in the pane the cursor is in, or none where it has nothing to say
    function showTip(n: PaneName, at: Coordinate, a: Point | null, b: Point | null) {
        const q = now.current, p = q.panes?.[n], tip = maps.current[n]?.tip;
        if (!tip || !p || !q.tipOn || isAlone(p)) return tip?.hide();
        const shows = p.diff ? "difference" : p.overlay ? "overlay" : "mosaic";
        const text = compareTipText(shows, n, a, b, q.panes!.a.info.unit, q.panes!.b.info.unit);
        if (text) tip.show(at, text);
        else tip.hide();
    }

    function hideTips() { NAMES.forEach((x) => maps.current[x]?.tip.hide()); }

    function sourcesOf(p: PaneState, geometry: Geometry): Promise<{res: Sources | null; error?: string}> {
        return sendJson(sourcesUrl(api, p.conv, readTab(p)), "POST", {geometry}).then((res) => readJson<Sources>(res))
            .then((r) => r.ok ? {res: r.data} : {res: null, error: errorText(r.data, "Could not find the frames.")},
                  () => ({res: null}));
    }

    // The spot or area drawn in a pane on its map (none for a finding, which its own layer draws)
    function showShape(n: PaneName, geometry: Geometry | null) {
        const pm = maps.current[n];
        if (!pm) return;
        pm.shape.clear();
        if (!geometry) return;
        if (geometry.type === "Point") {
            const f = pointFeature(lonLatToMap(geometry.coordinates));
            f.setStyle(PICKED);
            return pm.shape.addFeature(f);
        }
        const read = new GeoJSON().readFeature({type: "Feature", geometry, properties: {}}, {featureProjection: "EPSG:3857"});
        (Array.isArray(read) ? read : [read]).forEach((x) => { x.setStyle(SOURCES_SHAPE); pm.shape.addFeature(x as Feature); });
    }

    // The source frames of a spot or an area of the pane: its mosaic's, or A's and B's for the difference and the
    // overlay (once when they read the same values)
    function openSources(n: PaneName, geometry: Geometry, shape?: Maybe<Shape>) {
        const p = now.current.panes;
        if (!p) return;
        const reads = (x: PaneName) => p[x].conv + ":" + readTab(p[x]);
        const which = readsOf(n, p[n]).filter((x, i, all) => all.findIndex((y) => reads(y) === reads(x)) === i);
        const asking_ = ++asked.current[n];
        showShape(n, geometry);
        const mosaics = which.map((x) => ({pane: x, conv: p[x].conv, unit: p[x].info.unit}));
        setPicks((s) => ({...s, [n]: {geometry, shape, mosaics}}));
        Promise.all(which.map((x) => sourcesOf(p[x], geometry))).then((found) => {
            if (asking_ !== asked.current[n]) return;
            setPicks((s) => ({...s, [n]: {geometry, shape, mosaics: mosaics.map((m, i) => ({...m, ...found[i]}))}}));
        });
    }

    function closePick(n: PaneName) {
        asked.current[n]++;
        showShape(n, null);
        setPicks((s) => ({...s, [n]: null}));
    }

    // The dataset of a conversion compared
    const datasetOf = (conv: number) => now.current.list.find((c) => c.id === conv)?.dataset;

    // The datasets whose findings a pane draws: its mosaic's, or A's and B's for the difference and the overlay
    function paneDatasets(n: PaneName): number[] {
        const p = now.current.panes;
        if (!p) return [];
        const out: number[] = [];
        readsOf(n, p[n]).forEach((x) => {
            const d = datasetOf(p[x].conv);
            if (d !== undefined && !out.includes(d)) out.push(d);
        });
        return out;
    }

    const paneFindings = (n: PaneName) => paneDatasets(n).flatMap((d) => now.current.findings[d] || []);

    // The pane whose mosaic a finding of a dataset is shown on, in a pane (A's first for the difference and the overlay)
    function mosaicFor(n: PaneName, dataset: number): PaneName | null {
        const p = now.current.panes;
        if (!p) return null;
        return readsOf(n, p[n]).find((x) => datasetOf(p[x].conv) === dataset) || null;
    }

    // A dataset's findings
    async function loadFindings(dataset: number) {
        try {
            const r = await readJson<{findings?: Finding[]}>(await fetch(findingsUrl(api, dataset), {credentials: "same-origin"}));
            if (r.ok) setFindings((s) => ({...s, [dataset]: r.data.findings || []}));
        } catch {
            // they stay as they were
        }
    }

    // A finding in a pane's window with its kept frames (centre: the map moves to it)
    function openFinding(n: PaneName, f: Finding, centre = false) {
        const p = now.current.panes, x = mosaicFor(n, f.dataset);
        if (!p || !x) return;
        asked.current[n]++;
        showShape(n, null);
        setPicks((s) => ({...s, [n]: {geometry: f.geometry, finding: f.id,
                                      mosaics: [{pane: x, conv: p[x].conv, unit: p[x].info.unit, res: findingSources(f)}]}}));
        if (centre) maps.current[n]?.map.getView().animate({center: centreOf(f), duration: 250});
    }

    async function saveFinding(v: FindingFields) {
        const d = draft, p = panes, pick = picks[d?.pane || "a"];
        if (!d || !p) return;
        if (!v.name.trim()) return setDraft({...d, error: "Name the finding to save it"});
        let r, dataset: Maybe<number>;
        if (d.edit) {
            dataset = d.edit.dataset;
            r = await readJson<Finding>(await sendJson(findingsUrl(api, dataset, d.edit.id), "PATCH",
                {...fieldsBody(v, d.edit.frames), kept: v.kept || d.edit.frames.map((x) => x.frame)}));
        } else {
            const m = pick?.mosaics[d.mosaic];
            dataset = m && datasetOf(m.conv);
            if (!pick || !m || dataset === undefined) return;
            r = await readJson<Finding>(await sendJson(findingsUrl(api, dataset), "POST", {...fieldsBody(v, m.res?.frames),
                conversion: m.conv, tab: readTab(p[m.pane]), geometry: pick.geometry, shape: pick.shape, parameters: {}}));
        }
        if (!r.ok) return setDraft({...d, fields: v, error: errorText(r.data, "Could not save the finding.")});
        setDraft(null);
        await loadFindings(dataset);
        openFinding(d.pane, r.data);
    }

    // The shape drawn measured on both mosaics, with the isotherm
    useEffect(() => {
        if (!card || card.res !== undefined || card.error || !panes) return;
        const n = ++asked.current.measure, c = card, p = panes, which = c.across ? [c.across] : measuredPanes(p);
        // (a Delta T across: measured once, from its first spot's dataset)
        const measure = (x: PaneName): Promise<Measured | null> => !which.includes(x) ? Promise.resolve(null) :
            sendJson(api + "conversions/" + p[x].conv + "/measure", "POST", c.across ?
                     {target: readTab(p[x]), geometry: c.geometry, shape: acrossShape(c, x)} :
                     {target: readTab(p[x]), geometry: c.geometry, shape: c.shape ?? undefined, isotherm: isoFor(p[x])})
                .then((res) => readJson<Measured>(res))
                .then((r) => {
                    if (!r.ok) throw new Error(errorText(r.data, "Could not measure."));
                    return r.data;
                });
        Promise.all(NAMES.map(measure)).then(
            ([a, b]) => { if (n === asked.current.measure) setCard({...c, res: {a, b}}); },
            (e: unknown) => {
                if (n === asked.current.measure) setCard({...c, error: (e instanceof Error && e.message) || "Could not measure."});
            });
    }, [card, panes]);

    // Measured again when the mosaics compared or the isotherm change
    const isoKey = iso.mode ? isothermParam(iso.mode, iso.a || "", iso.b || "", userUnit()).value : "";
    const firstMeasured = useRef(true);
    useEffect(() => {
        if (firstMeasured.current) { firstMeasured.current = false; return; }
        setCard((c) => c && {pane: c.pane, geometry: c.geometry, shape: c.shape, across: c.across});
        showIndex(null);
    }, [key, isoKey]);

    // The shape measured drawn in both panes, with the hottest and coldest pixels of the mosaic each pane reads (A's for
    // the difference and the overlay)
    useEffect(() => {
        if (!mapsMade) return;
        NAMES.forEach((n) => {
            const d = maps.current[n]!.drawing;
            d.showCursor(null);
            if (!card || !panes) return d.clear();
            const x = readsOf(n, panes[n]).find((y) => card.res?.[y]?.result);
            // A Delta T across: each pane its own spot alone
            const shape = card.across ? {...card.shape!, own: n === card.across ? 0 : 1} : card.shape;
            d.show(card.geometry, x ? card.res![x]!.result : null, x ? panes[x].info.unit : undefined, shape);
        });
        drawAcross();
    }, [card, mapsMade]);

    // A pane's map sized again when the split moves
    useEffect(() => { NAMES.forEach((n) => maps.current[n]?.map.updateSize()); }, [split, mapsMade]);

    // The spots and areas drawn asked again when what the panes show changes; a finding kept open where its dataset still is
    const shownKey = panes ? key + ":" + panes.a.diff + ":" + panes.b.diff + ":" + panes.a.overlay + ":" + panes.b.overlay : "";
    const firstShown = useRef(true);
    useEffect(() => {
        if (!shownKey) return;
        if (firstShown.current) { firstShown.current = false; return; }
        NAMES.forEach((n) => {
            const p = now.current.picks[n];
            if (!p) return;
            if (p.finding === undefined) return openSources(n, p.geometry, p.shape);
            const f = paneFindings(n).find((x) => x.id === p.finding);
            if (f) openFinding(n, f);
            else closePick(n);
        });
    }, [shownKey]);

    // The findings of the datasets shown, each asked once (again after a change), and those a link asked to open
    const shownDatasets = panes ? Array.from(new Set(NAMES.map((n) => datasetOf(panes[n].conv))))
        .filter((d): d is number => d !== undefined) : [];
    useEffect(() => {
        shownDatasets.forEach((d) => {
            const k = "findings:" + d;
            if (d in findings || asking.current[k]) return;
            asking.current[k] = true;
            loadFindings(d).then(() => { delete asking.current[k]; });
        });
    }, [shownDatasets.join()]);
    useEffect(() => {
        if (!mapsMade) return;
        NAMES.forEach((n) => {
            const id_ = toOpen.current[n], wantedIn = paneDatasets(n);
            if (!id_ || !wantedIn.every((d) => d in findings)) return;
            toOpen.current[n] = null;
            const f = paneFindings(n).find((x) => x.id === id_);
            if (f) openFinding(n, f, true);
        });
    }, [findings, mapsMade]);

    // Each pane's findings on its map, the one open there drawn thicker
    const drawnFindings = panes && list.length ? {a: showFindings ? paneFindings("a") : [], b: showFindings ? paneFindings("b") : []} : null;
    useEffect(() => {
        if (!drawnFindings || !mapsMade) return;
        NAMES.forEach((n) => drawFindings(maps.current[n]!.findings, drawnFindings[n], picks[n]?.finding ?? null));
    }, [JSON.stringify(drawnFindings), picks.a?.finding, picks.b?.finding, mapsMade]);

    // The difference, asked once for each pair of mosaics while a pane shows it; its palette and reach start from it
    const anyDiff = !!panes && (panes.a.diff || panes.b.diff);
    useEffect(() => {
        if (!panes || !anyDiff) return;
        const d = diffs[key];
        if (d === undefined) {
            if (asking.current[key]) return;
            asking.current[key] = true;
            get<DiffInfo>(differenceUrl(api, panes.a.conv, panes.a.tab, panes.b.conv, panes.b.tab))
                .then((r) => r.ok ? r.data : null, () => null)
                .then((data) => { delete asking.current[key]; setDiffs((s) => ({...s, [key]: data})); });
            return;
        }
        if (!d) return;
        const stale = NAMES.filter((n) => panes[n].diff && panes[n].diffStyle?.key !== key);
        if (!stale.length) return;
        setPanes((s) => {
            const out = {...s!};
            stale.forEach((n) => {
                const kept = out[n].diffStyle?.palette, keys = (d.palettes || []).map((x) => x.key);
                out[n] = {...out[n], diffStyle: {key, palette: kept && keys.includes(kept) ? kept : keys[0] || "", reach: autoReach(d)}};
            });
            return out;
        });
    }, [key, anyDiff, diffs, panes]);

    // The temperature mosaics drawn in either pane
    const thermalDrawn = panes ? NAMES.filter((x) => !isVisual(panes[x]) && NAMES.some((n) => drawsOf(n, panes[n]).includes(x))) : [];

    // How a pane's mosaic is coloured as drawn (a slider's style while it is dragged), without its isotherm
    function mosaicColouring(x: PaneName): Colouring {
        const p = panes![x], s = drawnStyle(x);
        return {colors: palettes.find((c) => c.key === s.palette)?.color_map || [], range: rangeIn(s.range, p.info.unit),
                shares: sharesOf(s.adjust), sharpen: s.adjust.sharpen, bands: bandsOf(s.adjust, p.info.unit)};
    }

    // A pane's mosaic as drawn: its values in its style, or the visual mosaic's tiles
    function mosaicSpec(x: PaneName): LayerSpec | null {
        const p = panes![x];
        if (isVisual(p)) {
            const v = p.info.visual;
            return v?.bounds ? {key: x + ":" + p.conv + ":" + VISUAL, visual: {url: api + "conversions/" + p.conv +
                "/mosaics/visual/tiles/{z}/{x}/{y}.png", bounds: v.bounds, maxZoom: (v.maxzoom || 20) + 1}} : null;
        }
        const t = tabEntry(p);
        if (!t?.bounds) return null;
        return {key: x + ":" + p.conv + ":" + p.tab,
                values: {kind: "tiles", url: dataUrl(api, p.conv, p.tab), bounds: t.bounds, maxZoom: (t.maxzoom || 20) + 1,
                         gutter: DATA_GUTTER, pixel: rasterPixel(t.bounds, p.info.kinds?.[t.kind || ""]?.width)},
                colouring: {...mosaicColouring(x), isotherm: isothermRange(isoFor(p))}};
    }

    // What each pane's map shows, bottom first: its mosaic, B's and A's for the overlay, or the difference's values
    function layersOf(n: PaneName): LayerSpec[] {
        const p = panes![n];
        if (!p.diff) return drawsOf(n, p).map(mosaicSpec).filter((x): x is LayerSpec => !!x);
        const d = diffs[key];
        if (!d || !d.range || !d.bounds || !p.diffStyle || p.diffStyle.key !== key) return [];
        const r = reachIn(p.diffStyle.reach, d.unit);
        return [{key: "diff:" + key,
                 values: {kind: "tiles", bounds: d.bounds, url: differenceDataUrl(api, panes!.a.conv, panes!.a.tab, panes!.b.conv, panes!.b.tab),
                          maxZoom: Math.max(tabEntry(panes!.a)?.maxzoom || 20, tabEntry(panes!.b)?.maxzoom || 20) + 1},
                 colouring: {colors: (d.palettes || []).find((x) => x.key === p.diffStyle!.palette)?.color_map || [], range: [-r, r]}}];
    }

    // The colour scale of what a pane shows: its temperature mosaic's (the top one's for the overlay), or the difference's
    function scaleOf(n: PaneName): Scale | null {
        const p = panes![n];
        if (!p.diff) {
            const x = drawsOf(n, p).reverse().find((y) => !isVisual(panes![y]));
            if (!x) return null;
            const s = drawnStyle(x), c = mosaicColouring(x);
            return {colors: c.colors, shown: s.range, shares: c.shares, stops: scaleStops(c), caption: (p.overlay ? x.toUpperCase() + " · " : "") + tabLabel(panes![x].tab) + ", " + symbol()};
        }
        const d = diffs[key];
        if (!d || !d.range || !d.bounds || !p.diffStyle) return null;
        return {colors: (d.palettes || []).find((x) => x.key === p.diffStyle!.palette)?.color_map || [],
                shown: [-p.diffStyle.reach, p.diffStyle.reach], caption: "A − B, " + symbol()};
    }

    const layers = panes && shared ? {a: layersOf("a"), b: layersOf("b")} : null;
    const scales = panes && shared ? {a: scaleOf("a"), b: scaleOf("b")} : null;

    // The layers drawn again in their style, made again when what they show changes; the overlay's top one faded and
    // cut at the swipe line
    useEffect(() => {
        if (!layers || !mapsMade) return;
        NAMES.forEach((n) => {
            const pm = maps.current[n]!, specs = layers[n], keys = specs.map((x) => x.key);
            pm.drawn.filter((d) => !keys.includes(d.key)).forEach((d) => {
                d.unclip();
                if (d.thermal) d.thermal.remove();
                else pm.map.removeLayer(d.tiles!);
            });
            pm.drawn = specs.map((spec) => {
                const had = pm.drawn.find((d) => d.key === spec.key);
                if (had?.thermal) {
                    had.thermal.setValues(spec.values!);
                    had.thermal.setColouring(spec.colouring!);
                }
                if (had) return had;
                const made: Drawn = spec.visual ? {key: spec.key, unclip: () => undefined,
                                                   tiles: visualLayer(pm.map, spec.visual.url, spec.visual.bounds, spec.visual.maxZoom)} :
                    {key: spec.key, unclip: () => undefined, thermal: new ThermalLayer(pm.map, spec.values!, spec.colouring!)};
                made.unclip = clipLeft(olLayer(made), () => pm.top === made.key ? pm.swipe : null);
                return made;
            });
            const overlay = panes![n].overlay && pm.drawn.length > 1;
            pm.top = overlay ? pm.drawn[pm.drawn.length - 1].key : null;
            pm.swipe = overlay ? swipe : null;
            pm.drawn.forEach((d, i) => {
                const l = olLayer(d);
                l.setZIndex(i);
                l.setVisible(true);
                l.setOpacity(overlay && d.key === pm.top ? opacity / 100 : 1);
            });
            pm.map.render();
        });
    }, [JSON.stringify(layers), mapsMade, opacity, swipe]);

    useEffect(() => {
        if (!scales || !mapsMade) return;
        NAMES.forEach((n) => {
            const el = maps.current[n]!.legend;
            render(scales[n] ? <ScaleView scale={scales[n]}/> : null, el);
            el.hidden = !scales[n];
        });
    }, [JSON.stringify(scales), mapsMade]);

    // The view in the URL, so that a reload or a copied link keeps it
    useEffect(() => {
        if (!panes) return;
        const view = {a: panes.a.conv, b: panes.b.conv, a_tab: panes.a.tab, b_tab: panes.b.tab, split,
                      diff: panes.a.diff ? "a" as const : panes.b.diff ? "b" as const : "" as const, findings: showFindings,
                      overlay: panes.a.overlay ? "a" as const : panes.b.overlay ? "b" as const : "" as const, opacity, swipe,
                      a_finding: picks.a?.finding ?? toOpen.current.a, b_finding: picks.b?.finding ?? toOpen.current.b};
        history.replaceState(null, "", location.pathname + compareQuery(view, id));
    }, [shownKey, split, showFindings, picks.a?.finding, picks.b?.finding, opacity, swipe]);

    function setPane(n: PaneName, changes: Partial<PaneState>) {
        setPanes((s) => s && {...s, [n]: {...s[n], ...changes}});
    }

    // A pane's mosaic chosen: the difference shown no more when it is a visual mosaic
    async function choose(n: PaneName, value: string) {
        const [conv, tab] = [parseInt(value.split(":")[0], 10), value.split(":")[1]];
        try {
            const got = await info(conv);
            setPanes((s) => {
                if (!s) return s;
                const out = {...s, [n]: {...s[n], conv, tab, info: got}};
                if (tab === VISUAL) NAMES.forEach((x) => { out[x] = {...out[x], diff: false}; });
                return out;
            });
        } catch {
            setStatus({text: "Could not load the mosaics.", error: true});
        }
    }

    // What a pane shows: its mosaic, the difference or the overlay (which the other pane then does not show)
    function show(n: PaneName, what: string) {
        const diff = what === "diff", overlay = what === "overlay";
        setPanes((s) => s && {...s, [n]: {...s[n], diff, overlay},
                              ...(diff || overlay ? {[other(n)]: {...s[other(n)], diff: false, overlay: false}} : {})});
    }

    // A palette or range changed: the shared one, a pane's own, or a pane's difference's; while a slider is dragged
    // (done false) it is only drawn
    function changeStyle(where: PaneName | "shared", changes: Partial<CompareStyle> & Partial<DiffStyle>, done = true) {
        setLive(done ? null : {where, changes});
        if (!done) return;
        if (where === "shared") return setShared((s) => s && {...s, ...changes});
        const p = panes![where];
        if (p.diff) setPane(where, {diffStyle: {...p.diffStyle!, ...changes}});
        else setPane(where, {style: {...p.style, ...changes}});
    }

    function auto(where: PaneName | "shared") {
        if (where === "shared") return changeStyle(where, {range: thermalRange(panes!)});
        const p = panes![where];
        changeStyle(where, p.diff ? {reach: autoReach(diffs[key])} : {range: autoRange([{tab: tabEntry(p), unit: p.info.unit}])});
    }

    function toggleLinked() {
        setLinked(!linked);
        now.current.linked = !linked;
        // Linked, both maps have A's view; unlinked, B has its own, where A's is
        const a = maps.current.a?.map, b = maps.current.b?.map;
        if (a && b) b.setView(linked ? viewLike(a.getView()) : a.getView());
    }

    // Each pane starts from the shared palette and range when they part
    function toggleLocked() {
        if (locked && shared) setPanes((s) => s && {a: {...s.a, style: copyStyle(shared)}, b: {...s.b, style: copyStyle(shared)}});
        setLocked(!locked);
    }

    function splitKey(e: KeyboardEvent) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        setSplit((s) => clampSplit(s + (e.key === "ArrowLeft" ? -SPLIT_STEP : SPLIT_STEP)));
    }

    const conversion = (conv: number) => list.find((c) => c.id === conv);
    const frameUrl = (conv: number) => publicUrl + "conversion/" + conv + "/frame?frame=";

    // The frames that saw the spot or area drawn in a pane, coloured as each mosaic is, each mosaic's saved as a finding
    // of its dataset
    function pickedGroups(n: PaneName): SourceGroup[] {
        const pick = picks[n]!;
        return pick.mosaics.map((m, i) => {
            const c = conversion(m.conv), s = styleOf(m.pane);
            const savable = pick.finding === undefined && m.res && m.res.reason !== "outside_raster";
            const about = savable ? <SaveFinding onSave={() => setDraft({title: "Save as finding", fields: blankFields(),
                                                                         pane: n, mosaic: i})}/> : null;
            const title = (panes![n].diff ? m.pane.toUpperCase() + " · " : "") + (c ? c.name + " · " : "") + tabLabel(panes![m.pane].tab);
            // A visual mosaic of its own: its visual frames, as photos
            if (isAlone(panes![m.pane])) {
                return {title, res: m.res, error: m.error, unit: undefined, about,
                        photo: (f) => api + "conversions/" + m.conv + "/frame/visual?frame=" + encodeURIComponent(f) +
                            "&size=" + WINDOW_VISUAL_PX};
            }
            // As the pane's mosaic is named: its conversion and tab
            return {title, res: m.res, error: m.error, unit: m.unit, about,
                    href: c?.imported ? undefined : (f) => frameUrl(m.conv) + encodeURIComponent(f),
                    values: (f) => frameDataUrl(api, m.conv, f),
                    visual: panes![m.pane].info.visual ? (f) => api + "conversions/" + m.conv + "/frame/visual?frame=" +
                        encodeURIComponent(f) + "&size=" + WINDOW_VISUAL_PX : undefined,
                    colouring: {colors: palettes.find((x) => x.key === s.palette)?.color_map || [], range: rangeIn(s.range, m.unit),
                                shares: sharesOf(s.adjust), sharpen: s.adjust.sharpen, bands: bandsOf(s.adjust, m.unit)}};
        });
    }

    // Above a finding's frames in a pane's window: what it is, to change or open in the viewer
    function findingAbout(n: PaneName) {
        const pick = picks[n], f = pick?.finding !== undefined ? paneFindings(n).find((x) => x.id === pick.finding) : null;
        if (!pick || !f) return null;
        return <FindingAbout f={f} viewer={publicUrl + "conversion/" + pick.mosaics[0].conv + "?finding=" + f.id}
                             onEdit={() => setDraft({title: "Change finding", fields: fieldsOf(f), pane: n, mosaic: 0, edit: f})}/>;
    }

    // What the finding form keeps: the frames of the finding changed, or of the mosaic saved from
    function draftFrames(d: Draft) {
        if (d.edit) return d.edit.frames;
        const res = picks[d.pane]?.mosaics[d.mosaic]?.res;
        return res === undefined ? undefined : res?.frames ?? null;
    }

    function swipeKey(e: KeyboardEvent) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        setSwipe((s) => clampShare(s + (e.key === "ArrowLeft" ? -SPLIT_STEP : SPLIT_STEP)));
    }

    function paneView(n: PaneName) {
        const p = panes?.[n], d = diffs[key];
        const ownStyle = p && (p.diff ? !!p.diffStyle : !locked && !isVisual(p) && !p.overlay);
        const anyVisual = !!panes && NAMES.some((x) => isVisual(panes[x]));
        // The window opens on the visual frames where the pane shows a visual mosaic on top
        const onVisual = !!p && !p.diff && isVisual(panes![p.overlay ? "a" : n]);
        const note = !p?.diff ? "" : d === null ? "Could not load the difference." : d && (!d.range || !d.bounds) ? NO_OVERLAP : "";
        return (<div class={"compare-pane" + (tools[n].tool ? " picking" : "")} id={"pane-" + n} data-pane={n}
                     style={n === "a" ? {flexBasis: split + "%"} : undefined}>
            {p && <div class="compare-head">
                <span class="compare-name">{n.toUpperCase()}</span>
                <select name="mosaic" title={"The mosaic of pane " + n.toUpperCase()} value={p.conv + ":" + p.tab}
                        onChange={(e) => choose(n, e.currentTarget.value)}>
                    {mosaicGroups(list, list.find((c) => c.id === id)?.project).map((g) => <optgroup key={g.name} label={g.name}>
                        {g.items.flatMap((c) => comparedTabs(c).map((t) =>
                            <option key={c.id + ":" + t} value={c.id + ":" + t}>{c.name + " · " + tabLabel(t)}</option>))}
                    </optgroup>)}
                </select>
                <select name="show" value={p.diff ? "diff" : p.overlay ? "overlay" : "mosaic"} onChange={(e) => show(n, e.currentTarget.value)}>
                    <option value="mosaic">Mosaic</option>
                    <option value="diff" disabled={anyVisual} title={anyVisual ? "Not with a visual mosaic" : undefined}>Difference (A − B)</option>
                    <option value="overlay">Overlay (A over B)</option>
                </select>
            </div>}
            {p?.overlay && <div class="compare-overlay">
                <label class="slider" title="How much of B shows through A">Opacity of A
                    <input type="range" name="opacity" min={0} max={100} step={OPACITY_STEP} value={opacity}
                           onInput={(e) => setOpacity(clampShare(parseFloat(e.currentTarget.value)))}/>
                </label>
                <span class="text-muted">Drag the line across the map to show B right of it.</span>
            </div>}
            {p && ownStyle && (p.diff ?
                <StyleBar key={n + ":diff"} style={p.diffStyle!} palettes={d?.palettes || []} what="the difference"
                          onChange={(c) => changeStyle(n, c)} onAuto={() => auto(n)}/> :
                <StyleBar key={n} style={drawnStyle(n)} palettes={palettes} what="this mosaic"
                          onChange={(c, done) => changeStyle(n, c, done)} onAuto={() => auto(n)}/>)}
            {note ? <div class="compare-note message">{note}</div> : null}
            {/* Keyed: what comes and goes above it is never taken for it, which would lose its map */}
            <div class="compare-stage" key="map">
                <div class="compare-map" id={"map-" + n} ref={mapEls[n]}/>
                {p && <Toolbar tool={tools[n].tool} count={tools[n].count} compact
                               tools={NAMES.some((x) => !isAlone(panes![x])) ? TOOLS : SIZE_TOOLS} hints={COMPARE_HINTS}
                               label={"Drawing tools: measure a spot, a line, an area or a Delta T on both mosaics, from pane " + n.toUpperCase()}
                               onTool={(x) => pickTool(n, x)} onFinish={() => { maps.current[n]?.drawing.finish(); syncTools(); }}/>}
                {p && card && card.pane === n && (() => {
                    const c = cardShown(card), points = profilePoints(card);
                    return <MeasureCard m={c.m} unit={c.unit} compared={c.compared} labels={c.compared ? ["A", "B"] : undefined}
                                        note={c.note} index={index} onIndex={(i) => showIndex(i, points)}
                                        name={saveName} error={measureError} onName={setSaveName} onSave={save} onClose={closeCard}
                                        onSources={!card.across && hasSources(card.geometry, card.shape) ?
                                            () => openSources(n, card.geometry, card.shape) : undefined}/>;
                })()}
                {p?.overlay && <div class="compare-swipe" id={"swipe-" + n} role="separator" aria-orientation="vertical"
                                    tabIndex={0} aria-label="Move the line A is shown left of" aria-valuenow={swipe}
                                    aria-valuemin={SWIPE_LIMITS[0]} aria-valuemax={SWIPE_LIMITS[1]} style={{left: swipe + "%"}}
                                    onKeyDown={swipeKey}
                                    onMouseDown={(e) => { swiping.current = n; setDragging(true); e.preventDefault(); }}/>}
            </div>
            {p && <div class="compare-readout">
                {under === undefined ? <span class="message">Move the cursor over a mosaic.</span> :
                    p.diff || p.overlay ? <DifferenceReadout a={under.a} b={under.b} aUnit={panes!.a.info.unit}
                                                             bUnit={panes!.b.info.unit} difference={p.diff}/> :
                    isAlone(p) ? <span class="message">A visual mosaic, with no values to read.</span> :
                    <Readout point={under[n]} unit={p.info.unit} frameUrl={frameUrl(p.conv)} pinned={false} onFollow={() => undefined}
                             after={underDelta(n)}/>}
            </div>}
            {p && picks[n] && <SourcesWindow name={"compare-" + n} anchor={mapEls[n].current} groups={pickedGroups(n)}
                                             about={findingAbout(n)} visual={onVisual} onClose={() => closePick(n)}/>}
        </div>);
    }

    // ΔT under the cursor in pane n's readout: its mosaic minus the other's (A's A − B, B's B − A), when both mosaics
    // have a temperature there
    function underDelta(n: PaneName): [string, string][] {
        const d = under && panes ? paneDelta(n, under.a, under.b, panes.a.info.unit, panes.b.info.unit) : null;
        return d ? [["ΔT", d]] : [];
    }

    const sharedShown = locked && !!shared && thermalDrawn.length > 0;
    return (
        <div class={"page compare" + (dragging ? " dragging" : "")}>
            <div class="breadcrumb"><a href={publicUrl + "conversion/" + id}><ArrowLeft/> {datasetName} · {name}</a></div>
            <div class="page-header">
                <div>
                    <h1>Compare</h1>
                    <div class="subtitle">Two mosaics side by side, one over the other, or their difference.</div>
                </div>
                <div class="page-actions">
                    <Toggle id="link" on={linked} title="Pan and zoom both panes together" onClick={toggleLinked}>
                        <Link/> Link the panes</Toggle>
                    <Toggle id="lock" on={locked} title="Both panes share one palette and range; off, each pane has its own"
                            onClick={toggleLocked}><Lock/> Shared palette</Toggle>
                    <Toggle id="findings" on={showFindings} title="Show the flights' findings in both panes"
                            onClick={() => setShowFindings(!showFindings)}><Flag/> Findings</Toggle>
                </div>
            </div>
            {status && <div class={status.error ? "notice error" : "message"} id="status" role={status.error ? "alert" : undefined}>
                {status.text}</div>}

            {/* Keyed: the status line coming and going is never taken for it, which would make its maps again */}
            <div class="compare-main" key="main" hidden={!panes}>
                {sharedShown && <div id="shared">
                    <StyleBar key="shared" style={drawnStyle("shared")} palettes={palettes} what="both mosaics"
                              onChange={(c, done) => changeStyle("shared", c, done)} onAuto={() => auto("shared")}/>
                </div>}
                {thermalDrawn.length > 0 && <div class="compare-isotherm" id="isotherm">
                    <span class="compare-isotherm-label"
                          title="Both panes' temperature mosaics: the pixels inside it keep the palette">Isotherm</span>
                    <Isotherm state={isoTyped} error={isoError} onChange={changeIsotherm}/>
                    <PointerTemperatureBox on={tipOn} onChange={setTipOn}
                                           title="Beside the pointer once it rests: the temperature under it and ΔT (A − B)"/>
                </div>}
                <div class="compare-body" ref={body}>
                    {/* A Delta T across: its line from one pane to the other (drawAcross) */}
                    <svg class="compare-across" id="across-line" ref={acrossLine} aria-hidden="true">
                        <line class="halo"/><line class="link"/>
                    </svg>
                    {paneView("a")}
                    <div class="compare-split" id="split" role="separator" aria-orientation="vertical" tabIndex={0}
                         aria-label="Move the split between the panes" aria-valuenow={split}
                         aria-valuemin={SPLIT_LIMITS[0]} aria-valuemax={SPLIT_LIMITS[1]} onKeyDown={splitKey}
                         onMouseDown={(e) => { drag.current = true; setDragging(true); e.preventDefault(); }}/>
                    {paneView("b")}
                </div>
            </div>
            {draft && <FindingForm title={draft.title} fields={draft.fields} error={draft.error} onSave={saveFinding}
                                   onCancel={() => setDraft(null)} frames={draftFrames(draft)}/>}
        </div>
    );
}
