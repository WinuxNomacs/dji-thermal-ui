// Two mosaics side by side: each pane shows a conversion's temperature mosaic, or the difference of pane A's and pane
// B's (A − B), with pan and zoom linked, the cursor marked in the other pane, one palette and range shared (or each
// pane's own), the split between the panes moved, and the source frame of a point picked in a pane, below its map.
// The view (the mosaics, the difference, the split) is kept in the URL.
import L from "leaflet";
import {render} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {readJson} from "../core/api";
import {type Maybe} from "../core/format";
import {ArrowLeft, Crosshairs, Link, Lock, Unlink, Unlock} from "../components/icons";
import {symbol} from "../measure/measure";
import {type Scale} from "../viewer/canvas";
import {addBasemaps, addLegend, type Basemap} from "../viewer/map";
import {type Point, Readout, ScaleView} from "../viewer/panel";
import {defaultAdjust, type MosaicTab, tabLabel, tileUrl, toneShares} from "../viewer/view";
import {type Mosaics} from "../viewer/viewer-page";
import {autoRange, autoReach, clampSplit, type Comparable, type CompareStyle, compareQuery, type DiffInfo, differenceTileUrl,
        differenceUrl, type DiffStyle, firstTab, frameImageUrl, mosaicGroups, NO_OVERLAP, type PaneName, rangeIn, readCompare,
        SPLIT_LIMITS, SPLIT_STEP} from "./compare";
import {DifferenceReadout, Picked, type PickedFrame, StyleBar} from "./pane";

const HOVER_MS = 120;       // the readout asks for the point the cursor rests on, not every point it crosses
const CURSOR: L.CircleMarkerOptions = {radius: 6, weight: 2, color: "#fff", fill: false, interactive: false};
const PICKED: L.CircleMarkerOptions = {radius: 6, weight: 2, color: "#fff", fillColor: "#e8562a", fillOpacity: 1, interactive: false};
const NAMES: PaneName[] = ["a", "b"];

// What a pane shows: a conversion's temperature tab (its mosaics' info), or the difference; its own palette and range
// (used when they are not shared), and the difference's
interface PaneState {conv: number; tab: string; info: Mosaics; diff: boolean; style: CompareStyle; diffStyle: DiffStyle | null}
type Panes = Record<PaneName, PaneState>;

// A point picked in a pane, and what each mosaic it reads has there
interface Pick {latlng: L.LatLng; frames: {pane: PaneName; conv: number; unit: unknown; point: Maybe<Point>}[]}

// A pane's map and what is on it
interface PaneMap {
    map: L.Map; legend: HTMLDivElement; layer: L.TileLayer | null; layerKey: string | null;
    cursor: L.CircleMarker | null; marker: L.CircleMarker | null;
}

const other = (name: PaneName): PaneName => name === "a" ? "b" : "a";
const tabEntry = (p: PaneState): MosaicTab | undefined => (p.info.tabs || []).find((t) => t.tab === p.tab);
const diffKey = (panes: Panes) => [panes.a.conv, panes.a.tab, panes.b.conv, panes.b.tab].join(":");
const boundsOf = (b: number[]) => L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
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

export function ComparePage({api, publicUrl, id, otherId, name, datasetName, basemaps}: Props) {
    const [wanted] = useState(() => readCompare(location.search));
    const [list, setList] = useState<Comparable[]>([]);
    const [status, setStatus] = useState<{text: string; error?: boolean} | null>({text: "Loading the mosaics…"});
    const [panes, setPanes] = useState<Panes | null>(null);
    const [shared, setShared] = useState<CompareStyle | null>(null);
    const [linked, setLinked] = useState(true);
    const [locked, setLocked] = useState(true);
    const [split, setSplit] = useState(wanted.split || 50);
    const [dragging, setDragging] = useState(false);
    const [diffs, setDiffs] = useState<Record<string, DiffInfo | null>>({});     // null: it could not be loaded
    const [under, setUnder] = useState<Record<PaneName, Maybe<Point>> | undefined>(undefined);
    const [picking, setPicking] = useState<Record<PaneName, boolean>>({a: false, b: false});
    const [picks, setPicks] = useState<Record<PaneName, Pick | null>>({a: null, b: null});
    const [mapsMade, setMapsMade] = useState(false);

    const mapEls = {a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null)};
    const body = useRef<HTMLDivElement>(null);
    const maps = useRef<Partial<Record<PaneName, PaneMap>>>({});
    const infos = useRef<Record<number, Promise<Mosaics>>>({});
    const asking = useRef<Record<string, boolean>>({});
    const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const syncing = useRef(false);
    const drag = useRef(false);
    // Counters: only the answer to the latest question is shown
    const asked = useRef({point: 0, a: 0, b: 0});

    // What the maps' handlers (set up once) read: this render's values
    const now = useRef({panes, linked, picking, picks});
    now.current = {panes, linked, picking, picks};

    const palettes = panes?.a.info.palettes || [];
    const key = panes ? diffKey(panes) : "";
    const styleOf = (n: PaneName): CompareStyle => locked ? shared! : panes![n].style;

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

    async function start() {
        try {
            const r = await get<Comparable[]>(api + "conversions/" + id + "/comparable");
            if (!r.ok) return setStatus({text: "Could not load the mosaics to compare.", error: true});
            const all = r.data || [], find = (x: Maybe<number>) => all.find((c) => c.id === x);
            setList(all);
            const a = (wanted.a !== undefined && find(wanted.a)) || find(id);
            if (!a) return setStatus({text: "This conversion has no mosaics to compare."});
            const b = find(otherId) || a;
            const aTab = firstTab(a, wanted.a_tab);
            const bTab = b.id === a.id ? firstTab(b, wanted.b_tab, aTab) : firstTab(b, wanted.b_tab);
            const [ia, ib] = await Promise.all([info(a.id), info(b.id)]);
            const style: CompareStyle = {palette: ia.default_palette || "", adjust: defaultAdjust(), range: [0, 1]};
            const next: Panes = {
                a: {conv: a.id, tab: aTab, info: ia, diff: wanted.diff === "a", style, diffStyle: null},
                b: {conv: b.id, tab: bTab, info: ib, diff: wanted.diff === "b", style, diffStyle: null},
            };
            style.range = autoRange(NAMES.map((n) => ({tab: tabEntry(next[n]), unit: next[n].info.unit})));
            setPanes({a: {...next.a, style: copyStyle(style)}, b: {...next.b, style: copyStyle(style)}});
            setShared(style);
            setStatus(null);
        } catch {
            setStatus({text: "Could not load the mosaics.", error: true});
        }
    }

    useEffect(() => {
        start();
        // The split follows the mouse while its handle is held
        const move = (e: MouseEvent) => {
            if (!drag.current || !body.current) return;
            const rect = body.current.getBoundingClientRect();
            if (rect.width > 0) setSplit(clampSplit((e.clientX - rect.left) / rect.width * 100));
        };
        const up = () => { drag.current = false; setDragging(false); };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
        return () => {
            clearTimeout(hover.current);
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            NAMES.forEach((n) => maps.current[n]?.map.remove());
        };
    }, []);

    // Both maps, once the mosaics are in: A fitted to its mosaic, B where A is
    useEffect(() => {
        if (!panes || maps.current.a || !mapEls.a.current || !mapEls.b.current) return;
        NAMES.forEach((n) => setupMap(n, mapEls[n].current!));
        const t = tabEntry(panes.a), a = maps.current.a!.map, b = maps.current.b!.map;
        if (t?.bounds) a.fitBounds(boundsOf(t.bounds));
        else a.setView([0, 0], 2);
        b.setView(a.getCenter(), a.getZoom(), {animate: false});
        setMapsMade(true);
    }, [panes]);

    function setupMap(n: PaneName, el: HTMLDivElement) {
        const m = L.map(el, {maxZoom: 26});
        addBasemaps(m, basemaps);
        const pm: PaneMap = maps.current[n] = {map: m, legend: addLegend(m), layer: null, layerKey: null, cursor: null, marker: null};
        m.on("moveend", () => {
            const o = maps.current[other(n)];
            if (!now.current.linked || syncing.current || !o) return;
            syncing.current = true;
            try { o.map.setView(m.getCenter(), m.getZoom(), {animate: false}); } finally { syncing.current = false; }
        });
        // The cursor marked in the other pane
        m.on("mousemove", (e: L.LeafletMouseEvent) => {
            const o = maps.current[other(n)];
            if (o) {
                if (!o.cursor) o.cursor = L.circleMarker(e.latlng, CURSOR);
                o.cursor.setLatLng(e.latlng);
                if (!o.map.hasLayer(o.cursor)) o.cursor.addTo(o.map);
            }
            if (pm.cursor) pm.cursor.remove();
            clearTimeout(hover.current);
            hover.current = setTimeout(() => readout(e.latlng), HOVER_MS);
        });
        m.on("mouseout", () => {
            clearTimeout(hover.current);
            asked.current.point++;
            NAMES.forEach((x) => maps.current[x]?.cursor?.remove());
            setUnder(undefined);
        });
        m.on("click", (e: L.LeafletMouseEvent) => { if (now.current.picking[n]) pick(n, e.latlng); });
    }

    function pointOf(p: PaneState, latlng: L.LatLng): Promise<Point | null> {
        return get<Point>(api + "conversions/" + p.conv + "/mosaics/" + p.tab + "/point?lon=" + latlng.lng + "&lat=" + latlng.lat)
            .then((r) => r.ok ? r.data : null, () => null);
    }

    // Both mosaics' values at the cursor: each pane's readout is made from them
    function readout(latlng: L.LatLng) {
        const n = ++asked.current.point, p = now.current.panes;
        if (!p) return;
        Promise.all([pointOf(p.a, latlng), pointOf(p.b, latlng)]).then(([a, b]) => {
            if (n === asked.current.point) setUnder({a, b});    // else the cursor moved on
        });
    }

    // The source frames at a point of the pane: its mosaic's, or A's and B's for the difference
    function pick(n: PaneName, latlng: L.LatLng) {
        const p = now.current.panes, pm = maps.current[n];
        if (!p || !pm) return;
        const which: PaneName[] = p[n].diff ? ["a", "b"] : [n], asking_ = ++asked.current[n];
        if (!pm.marker) pm.marker = L.circleMarker(latlng, PICKED).addTo(pm.map);
        else pm.marker.setLatLng(latlng);
        Promise.all(which.map((x) => pointOf(p[x], latlng))).then((points) => {
            if (asking_ !== asked.current[n]) return;
            setPicks((s) => ({...s, [n]: {latlng, frames: points.map((point, i) => ({
                pane: which[i], conv: p[which[i]].conv, unit: p[which[i]].info.unit, point}))}}));
        });
    }

    function closePick(n: PaneName) {
        asked.current[n]++;
        maps.current[n]?.marker?.remove();
        if (maps.current[n]) maps.current[n]!.marker = null;
        setPicks((s) => ({...s, [n]: null}));
    }

    // A pane's map sized again when the picked point opens or closes below it, or the split moves
    useEffect(() => { NAMES.forEach((n) => maps.current[n]?.map.invalidateSize()); }, [split, !!picks.a, !!picks.b, mapsMade]);

    // The points picked asked again when what the panes show changes
    const shownKey = panes ? key + ":" + panes.a.diff + ":" + panes.b.diff : "";
    const firstShown = useRef(true);
    useEffect(() => {
        if (!shownKey) return;
        if (firstShown.current) { firstShown.current = false; return; }
        NAMES.forEach((n) => { const p = now.current.picks[n]; if (p) pick(n, p.latlng); });
    }, [shownKey]);

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

    // What each pane's map shows: its mosaic's tiles in its style, or the difference's
    function layerOf(n: PaneName): {key: string; url: string; bounds: number[]; maxzoom: number} | null {
        const p = panes![n];
        if (!p.diff) {
            const t = tabEntry(p), s = styleOf(n);
            if (!t?.bounds) return null;
            return {key: p.conv + ":" + p.tab, bounds: t.bounds, maxzoom: t.maxzoom || 20,
                    url: tileUrl(api, p.conv, p.tab, {palette: s.palette, range: rangeIn(s.range, p.info.unit), adjust: s.adjust})};
        }
        const d = diffs[key];
        if (!d || !d.range || !d.bounds || !p.diffStyle || p.diffStyle.key !== key) return null;
        return {key: "diff:" + key, bounds: d.bounds,
                maxzoom: Math.max(tabEntry(panes!.a)?.maxzoom || 20, tabEntry(panes!.b)?.maxzoom || 20),
                url: differenceTileUrl(api, panes!.a.conv, panes!.a.tab, panes!.b.conv, panes!.b.tab, p.diffStyle, d.unit)};
    }

    // The colour scale of what a pane shows
    function scaleOf(n: PaneName): Scale | null {
        const p = panes![n];
        if (!p.diff) {
            const s = styleOf(n), a = s.adjust;
            return {colors: palettes.find((x) => x.key === s.palette)?.color_map || [], shown: s.range,
                    shares: a.gamma !== 1 || a.equalize ? toneShares(a.gamma) : null, caption: tabLabel(p.tab) + ", " + symbol()};
        }
        const d = diffs[key];
        if (!d || !d.range || !d.bounds || !p.diffStyle) return null;
        return {colors: (d.palettes || []).find((x) => x.key === p.diffStyle!.palette)?.color_map || [],
                shown: [-p.diffStyle.reach, p.diffStyle.reach], caption: "A − B, " + symbol()};
    }

    const layers = panes && shared ? {a: layerOf("a"), b: layerOf("b")} : null;
    const scales = panes && shared ? {a: scaleOf("a"), b: scaleOf("b")} : null;

    // The layers drawn again in their style, made again when what they show changes
    useEffect(() => {
        if (!layers || !mapsMade) return;
        NAMES.forEach((n) => {
            const pm = maps.current[n]!, spec = layers[n];
            if (!spec) {
                pm.layer?.remove();
                pm.layer = pm.layerKey = null;
            } else if (pm.layer && pm.layerKey === spec.key) {
                pm.layer.setUrl(spec.url);
            } else {
                pm.layer?.remove();
                pm.layer = L.tileLayer(spec.url, {maxZoom: 26, maxNativeZoom: spec.maxzoom + 1, minZoom: 0,
                                                  bounds: boundsOf(spec.bounds)}).addTo(pm.map);
                pm.layerKey = spec.key;
            }
        });
    }, [JSON.stringify(layers), mapsMade]);

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
                      diff: panes.a.diff ? "a" as const : panes.b.diff ? "b" as const : "" as const};
        history.replaceState(null, "", location.pathname + compareQuery(view, id));
    }, [shownKey, split]);

    function setPane(n: PaneName, changes: Partial<PaneState>) {
        setPanes((s) => s && {...s, [n]: {...s[n], ...changes}});
    }

    async function choose(n: PaneName, value: string) {
        const [conv, tab] = [parseInt(value.split(":")[0], 10), value.split(":")[1]];
        try {
            setPane(n, {conv, tab, info: await info(conv)});
        } catch {
            setStatus({text: "Could not load the mosaics.", error: true});
        }
    }

    function show(n: PaneName, diff: boolean) {
        setPanes((s) => s && {...s, [n]: {...s[n], diff}, ...(diff ? {[other(n)]: {...s[other(n)], diff: false}} : {})});
    }

    // A palette or range changed: the shared one, a pane's own, or a pane's difference's
    function changeStyle(where: PaneName | "shared", changes: Partial<CompareStyle> & Partial<DiffStyle>) {
        if (where === "shared") return setShared((s) => s && {...s, ...changes});
        const p = panes![where];
        if (p.diff) setPane(where, {diffStyle: {...p.diffStyle!, ...changes}});
        else setPane(where, {style: {...p.style, ...changes}});
    }

    function auto(where: PaneName | "shared") {
        if (where === "shared") {
            return changeStyle(where, {range: autoRange(NAMES.map((n) => ({tab: tabEntry(panes![n]), unit: panes![n].info.unit})))});
        }
        const p = panes![where];
        changeStyle(where, p.diff ? {reach: autoReach(diffs[key])} : {range: autoRange([{tab: tabEntry(p), unit: p.info.unit}])});
    }

    function toggleLinked() {
        setLinked(!linked);
        now.current.linked = !linked;
        const a = maps.current.a?.map, b = maps.current.b?.map;
        if (!linked && a && b) b.setView(a.getCenter(), a.getZoom(), {animate: false});
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

    function pickedFrames(n: PaneName): PickedFrame[] {
        const p = picks[n]!;
        return p.frames.map((f, i) => {
            const c = conversion(f.conv), frame = f.point?.frame || "";
            return {title: (panes![n].diff ? (i ? "B" : "A") + " · " : "") + (c ? c.dataset_name + " · " + c.name : ""),
                    point: f.point, unit: f.unit, href: frameUrl(f.conv) + encodeURIComponent(frame),
                    image: frame ? frameImageUrl(api, f.conv, frame, styleOf(f.pane), f.unit) : ""};
        });
    }

    function paneView(n: PaneName) {
        const p = panes?.[n], d = diffs[key];
        const ownStyle = p && (p.diff ? !!p.diffStyle : !locked);
        const note = !p?.diff ? "" : d === null ? "Could not load the difference." : d && (!d.range || !d.bounds) ? NO_OVERLAP : "";
        return (<div class={"compare-pane" + (picking[n] ? " picking" : "")} id={"pane-" + n} data-pane={n}
                     style={n === "a" ? {flexBasis: split + "%"} : undefined}>
            {p && <div class="compare-head">
                <span class="compare-name">{n.toUpperCase()}</span>
                <select name="mosaic" title={"The mosaic of pane " + n.toUpperCase()} value={p.conv + ":" + p.tab}
                        onChange={(e) => choose(n, e.currentTarget.value)}>
                    {mosaicGroups(list).map((g) => <optgroup key={g.name} label={g.name}>
                        {g.items.flatMap((c) => c.tabs.map((t) =>
                            <option key={c.id + ":" + t} value={c.id + ":" + t}>{c.name + " · " + tabLabel(t)}</option>))}
                    </optgroup>)}
                </select>
                <select name="show" value={p.diff ? "diff" : "mosaic"} onChange={(e) => show(n, e.currentTarget.value === "diff")}>
                    <option value="mosaic">Mosaic</option>
                    <option value="diff">Difference (A − B)</option>
                </select>
                <button type="button" name="pick" class={"button default small" + (picking[n] ? " active" : "")}
                        aria-pressed={picking[n]} title="Click the map to see the source frame of a point"
                        onClick={() => setPicking((s) => ({...s, [n]: !s[n]}))}><Crosshairs/> Pick a point</button>
            </div>}
            {p && ownStyle && (p.diff ?
                <StyleBar key={n + ":diff"} style={p.diffStyle!} palettes={d?.palettes || []} what="the difference"
                          onChange={(c) => changeStyle(n, c)} onAuto={() => auto(n)}/> :
                <StyleBar key={n} style={p.style} palettes={palettes} what="this mosaic"
                          onChange={(c) => changeStyle(n, c)} onAuto={() => auto(n)}/>)}
            {note ? <div class="compare-note message">{note}</div> : null}
            {/* Keyed: what comes and goes above it is never taken for it, which would lose its map */}
            <div class="compare-map" key="map" id={"map-" + n} ref={mapEls[n]}/>
            {p && <div class="compare-readout">
                {under === undefined ? <span class="message">Move the cursor over a mosaic.</span> :
                    p.diff ? <DifferenceReadout a={under.a} b={under.b} aUnit={panes!.a.info.unit} bUnit={panes!.b.info.unit}/> :
                    <Readout point={under[n]} unit={p.info.unit} frameUrl={frameUrl(p.conv)} pinned={false} onFollow={() => undefined}/>}
            </div>}
            {p && picks[n] && <Picked frames={pickedFrames(n)} onClose={() => closePick(n)}/>}
        </div>);
    }

    const sharedShown = locked && !!shared && !!panes && (!panes.a.diff || !panes.b.diff);
    return (
        <div class={"page compare" + (dragging ? " dragging" : "")}>
            <div class="breadcrumb"><a href={publicUrl + "conversion/" + id}><ArrowLeft/> {datasetName} · {name}</a></div>
            <div class="page-header">
                <div>
                    <h1>Compare</h1>
                    <div class="subtitle">Two mosaics side by side, or their difference.</div>
                </div>
                <div class="page-actions">
                    <button type="button" id="link" class={"button default" + (linked ? " active" : "")} aria-pressed={linked}
                            title="Pan and zoom both panes together" onClick={toggleLinked}>
                        {linked ? <><Link/> Linked</> : <><Unlink/> Unlinked</>}</button>
                    <button type="button" id="lock" class={"button default" + (locked ? " active" : "")} aria-pressed={locked}
                            title="Both panes share one palette and range" onClick={toggleLocked}>
                        {locked ? <><Lock/> Shared palette</> : <><Unlock/> Each pane its own</>}</button>
                </div>
            </div>
            {status && <div class={status.error ? "notice error" : "message"} id="status" role={status.error ? "alert" : undefined}>
                {status.text}</div>}

            {/* Keyed: the status line coming and going is never taken for it, which would make its maps again */}
            <div class="compare-main" key="main" hidden={!panes}>
                {sharedShown && <div id="shared">
                    <StyleBar key="shared" style={shared!} palettes={palettes} what="both mosaics"
                              onChange={(c) => changeStyle("shared", c)} onAuto={() => auto("shared")}/>
                </div>}
                <div class="compare-body" ref={body}>
                    {paneView("a")}
                    <div class="compare-split" id="split" role="separator" aria-orientation="vertical" tabIndex={0}
                         aria-label="Move the split between the panes" aria-valuenow={split}
                         aria-valuemin={SPLIT_LIMITS[0]} aria-valuemax={SPLIT_LIMITS[1]} onKeyDown={splitKey}
                         onMouseDown={(e) => { drag.current = true; setDragging(true); e.preventDefault(); }}/>
                    {paneView("b")}
                </div>
            </div>
        </div>
    );
}
