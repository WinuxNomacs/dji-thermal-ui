// The viewer of a dataset that is a visual mosaic alone (a flight without thermal frames, laid out by its own frames):
// the mosaic on a map, with no temperatures to colour or read. A click on a spot opens the visual frames that saw it; a
// line or an area drawn is measured (its length, or its area and perimeter), saved as a measurement or kept as a finding
// of the flight, and the panel says how the mosaic was made. The thermal viewer (viewer-page) shows it instead of its
// own once the mosaics are loaded. A colour orthophoto imported from WebODM is shown as one, its photos found from its
// task's cameras, and its DSM's Heights tab in the thermal viewer.
import GeoJSON from "ol/format/GeoJSON";
import type OlMap from "ol/Map";
import type VectorSource from "ol/source/Vector";
import {getDistance} from "ol/sphere";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {type Maybe, mosaicLabel, type Stage} from "../core/format";
import {ask, askName} from "../components/dialog";
import {ArrowLeft, Columns, Download, FileText, Grid, Link, Stop} from "../components/icons";
import {type Imported, importedRows, webodmTaskUrl} from "../dataset/conversions";
import {Drawing, drawingKey, inField} from "../measure/drawing";
import {type Coords, type Geometry, HINTS, type Measured, type Measurement, type Shape, toggleCompared, type Tool,
        TOOLS} from "../measure/measure";
import {MeasureCard, Measurements, Toolbar} from "../measure/result";
import {hasSources, NOT_KNOWN, type Sources, sourcesUrl} from "../sources/sources";
import {SourcesWindow} from "../sources/window";
import {blankFields, type Finding, type FindingFields, fieldsBody, fieldsOf, findingSources,
        findingsUrl} from "../findings/findings";
import {centreOf, drawFindings, findingAt} from "../findings/layer";
import {FindingAbout, FindingForm, Findings, SaveFinding} from "../findings/panel";
import {type Basemap, fitBounds, lonLatToMap, mapToLonLat, mosaicMap, vectorLayer, visualLayer} from "../map/map";
import {MosaicStatus, PanelGroup, Report, Section} from "./panel";
import {builtQuery, TAB_TIPS, tabLabel, type VisualMosaic, viewQuery, visualRows} from "./view";
import {SOURCES_SHAPE} from "./viewer-page";

export const VISUAL_ALONE_HINT = "The visual camera's images, laid out by their own overlaps. The flight has no " +
    "thermal images, so nothing here has a temperature: click a spot to see the frames that saw it, or draw a line " +
    "or an area to measure it.";
export const IMPORTED_HINT = "The colour orthophoto imported from WebODM. Nothing here has a temperature: click a spot " +
    "to see the photos that saw it, or draw a line or an area to measure it.";
const WINDOW_PX = 1600;     // a frame in the source frames window, at most this many pixels across
const TARGET = "visual";    // what its measurements and findings are measured on
// Its tools: a Delta T has no temperatures to compare here
const TOOLS_HERE = TOOLS.filter(([x]) => x !== "delta");
const HINTS_HERE: Record<Tool, string> = {
    ...HINTS,
    point: "Click a spot: the frames that saw it open beside the map.",
    box: "Drag from one corner to the opposite one: its area and perimeter.",
    circle: "Drag from the centre outwards: its area and perimeter.",
};

export interface VisualAlone {
    name: string;
    description?: string;
    stripped?: boolean;
    status: string;
    mosaic_status: string;
    mosaics_built?: number | null;
    mosaic_error?: string | null;
    mosaic_progress?: number | null;
    stage?: Maybe<Stage>;
    visual?: VisualMosaic | null;
    imported?: Imported | null;         // an orthophoto imported from WebODM: nothing to build
    tabs?: {tab: string}[];             // its Heights tab, where it was imported with a DSM
}

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    datasetId: number;
    datasetName: string;
    basemaps: Basemap[];
    v: VisualAlone;
    finding?: Maybe<number>;                                // the finding a link asked to open
    onAction: (path: string, failure: string) => void;      // build again, cancel (the viewer then loads it again)
    nav?: (url: string) => void;                            // to the Heights tab (the thermal viewer's)
}

// The line or area drawn (or the saved measurement shown), measured
interface Current {geometry: Geometry; shape?: Maybe<Shape>; saved?: Measurement | null; res?: Measured | null; error?: string}

// The frames that saw a spot or an area, in the window: asked for it, or a finding's kept ones
interface Asked {geometry: Geometry; res?: Sources | null; error?: string; shape?: Maybe<Shape>; measurement?: Measurement;
                 finding?: number}

interface Draft {title: string; fields: FindingFields; edit?: Finding; error?: string}

const toCoords = (at: number[]): Coords => mapToLonLat(at) as Coords;

export function VisualViewer({api, publicUrl, id, datasetId, datasetName, basemaps, v, finding, onAction,
                              nav = (url) => { location.href = url; }}: Props) {
    const base = api + "conversions/" + id;
    const vis = v.visual;
    const ready = (v.mosaic_status === "ready" || v.mosaic_status === "building") && !!vis?.bounds;
    const busy = v.status === "converting" || v.mosaic_status === "building";
    const imported = !!v.imported, heights = (v.tabs || []).some((x) => x.tab === "heights");
    const [tools, setTools] = useState<{tool: ReturnType<Drawing["tool"]>; count: number}>({tool: null, count: 0});
    const [sources, setSources] = useState<Asked | null>(null);
    const [current, setCurrent] = useState<Current | null>(null);
    const [saveName, setSaveName] = useState("");
    const [measureError, setMeasureError] = useState("");
    const [saved, setSaved] = useState<Measurement[]>([]);
    const [compared, setCompared] = useState<number[]>([]);
    const [findings, setFindings] = useState<Finding[]>([]);
    const [showFindings, setShowFindings] = useState(true);
    const [hidden, setHidden] = useState<number[]>([]);
    const [findingError, setFindingError] = useState("");
    const [draft, setDraft] = useState<Draft | null>(null);
    const mapEl = useRef<HTMLDivElement>(null);
    const map = useRef<OlMap | null>(null);
    const drawing = useRef<Drawing | null>(null);
    const sourcesShape = useRef<VectorSource | null>(null);
    const findingsShown = useRef<VectorSource | null>(null);
    const asked = useRef({sources: 0, measure: 0});
    const now = useRef({findings, current});
    now.current = {findings, current};

    const syncTools = () => {
        const d = drawing.current;
        setTools({tool: d ? d.tool() : null, count: d ? d.count() : 0});
    };

    // The map, once the mosaic is built (made again when it is built again)
    const key = ready ? JSON.stringify(vis!.bounds) + vis!.maxzoom + v.mosaics_built : "";
    useEffect(() => {
        if (!ready || !mapEl.current) return;
        const m = map.current = mosaicMap(mapEl.current, basemaps).map;
        visualLayer(m, base + "/mosaics/visual/tiles/{z}/{x}/{y}.png" + builtQuery(v.mosaics_built), vis!.bounds!, (vis!.maxzoom || 20) + 1).setVisible(true);
        sourcesShape.current = vectorLayer(m, 9);
        findingsShown.current = vectorLayer(m, 8);
        fitBounds(m, vis!.bounds!);
        drawing.current = new Drawing({
            map: m, toCoords, fromCoords: lonLatToMap, distance: (a, b) => getDistance(a, b),
            // A spot opens its frames; a line or an area is measured in the card
            onDone: (geometry, shape) => {
                if (geometry.type === "Point") openSources(geometry);
                else setCurrent({geometry, shape});
                syncTools();
            },
            onChange: syncTools,
            // A click with no tool on opens the finding there, else the frames that saw the spot
            onClick: (at) => {
                const hit = findingsShown.current && findingAt(m, m.getPixelFromCoordinate(at), findingsShown.current);
                const f = hit !== null && now.current.findings.find((x) => x.id === hit);
                if (f) openFinding(f);
                else openSources({type: "Point", coordinates: toCoords(at)});
            },
        });
        // Esc ends the drawing, else closes the card
        const keys = (e: KeyboardEvent) => {
            if (drawingKey(e, drawing.current)) return syncTools();
            if (e.key === "Escape" && !inField(e.target) && now.current.current) closeCard();
        };
        document.addEventListener("keydown", keys);
        loadSaved();
        loadFindings(finding);
        return () => {
            document.removeEventListener("keydown", keys);
            m.setTarget(undefined);
            map.current = drawing.current = sourcesShape.current = findingsShown.current = null;
        };
    }, [key]);

    // The line or area drawn, measured
    useEffect(() => {
        if (!current || current.res !== undefined || current.error) return;
        const n = ++asked.current.measure, c = current;
        sendJson(base + "/measure", "POST", {target: TARGET, geometry: c.geometry})
            .then((res) => readJson<Measured>(res))
            .then((r) => {
                if (n !== asked.current.measure) return;
                setCurrent(r.ok ? {...c, res: {...r.data, shape: c.shape}} : {...c, error: errorText(r.data, "Could not measure.")});
            })
            .catch(() => { if (n === asked.current.measure) setCurrent({...c, error: "Could not measure."}); });
    }, [current]);

    // What was measured, on the map
    useEffect(() => {
        const d = drawing.current;
        if (!d) return;
        if (current) d.show(current.geometry, current.res?.result);
        else d.clear();
    }, [current, key]);

    // The spot or area whose frames the window shows, on the map while it is open (a finding's is drawn as one)
    useEffect(() => {
        const f = sourcesShape.current;
        if (!f) return;
        f.clear();
        if (!sources || sources.finding) return;
        const feature = new GeoJSON().readFeature({type: "Feature", geometry: sources.geometry, properties: {}},
                                                  {featureProjection: "EPSG:3857"});
        (Array.isArray(feature) ? feature : [feature]).forEach((x) => { x.setStyle(SOURCES_SHAPE); f.addFeature(x); });
    }, [sources && JSON.stringify(sources.geometry), key]);

    // The findings shown on the map, the one open drawn thicker
    const opened = sources?.finding ?? null;
    const drawn = showFindings ? findings.filter((f) => !hidden.includes(f.id)) : [];
    useEffect(() => {
        if (findingsShown.current) drawFindings(findingsShown.current, drawn, opened);
    }, [JSON.stringify(drawn), opened, key]);

    async function openSources(geometry: Geometry, more: {shape?: Maybe<Shape>; measurement?: Measurement} = {}) {
        const n = ++asked.current.sources;
        const asking: Asked = {geometry, ...more};
        setSources(asking);
        try {
            const r = await readJson<Sources>(await sendJson(sourcesUrl(api, id, TARGET), "POST", {geometry}));
            if (n === asked.current.sources) {
                setSources({...asking, res: r.ok ? r.data : null, error: r.ok ? "" : errorText(r.data, "Could not find the frames.")});
            }
        } catch {
            if (n === asked.current.sources) setSources({...asking, res: null});
        }
    }

    function closeSources() {
        asked.current.sources++;
        setSources(null);
    }

    function pickTool(x: ReturnType<Drawing["tool"]>) {
        if (x) drawing.current?.start(x);
        else drawing.current?.stop();
        syncTools();
    }

    function closeCard() {
        asked.current.measure++;
        setCurrent(null);
        setMeasureError("");
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
        const r = await readJson<Measurement>(await sendJson(base + "/measurements", "POST",
                                                             {name, target: TARGET, geometry: current.geometry, shape: current.shape}));
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

    // A saved measurement shown on the mosaic, with its figures as saved; a spot opens its frames
    function showSaved(m: Measurement) {
        if (!m.geometry) return;
        if (m.geometry.type === "Point") return openSources(m.geometry, {measurement: m});
        setCurrent({geometry: m.geometry, saved: m, res: m.values || null, shape: m.values?.shape});
    }

    // The flight's findings (open: the one a link asked to open)
    async function loadFindings(open?: Maybe<number>) {
        try {
            const r = await readJson<{findings?: Finding[]}>(await fetch(findingsUrl(api, datasetId), {credentials: "same-origin"}));
            if (!r.ok) return;
            const items = r.data.findings || [];
            setFindings(items);
            setHidden((h) => h.filter((x) => items.some((f) => f.id === x)));
            const f = open && items.find((x) => x.id === open);
            if (f) openFinding(f, true);
        } catch {
            // the list stays as it was
        }
    }

    // A finding in the window with its kept frames (centre: the map moves to it)
    function openFinding(f: Finding, centre = false) {
        asked.current.sources++;
        setSources({geometry: f.geometry, res: findingSources(f), finding: f.id});
        const m = map.current;
        if (centre && m) m.getView().animate({center: centreOf(f), duration: 250});
    }

    function newFinding(name = sources?.measurement?.name || "") {
        setDraft({title: "Save as finding", fields: blankFields(name)});
    }

    // The line's or area's card kept as a finding: the form, with the frames that saw it in the window beside it
    function keepCard(c: Current) {
        openSources(c.geometry, {shape: c.shape, measurement: c.saved || undefined});
        newFinding(c.saved?.name || saveName.trim());
    }

    async function saveFinding(fields: FindingFields) {
        const d = draft, s = sources;
        if (!d) return;
        if (!fields.name.trim()) return setDraft({...d, error: "Name the finding to save it"});
        let r;
        if (d.edit) {
            r = await readJson<Finding>(await sendJson(findingsUrl(api, datasetId, d.edit.id), "PATCH",
                {...fieldsBody(fields, d.edit.frames), kept: fields.kept || d.edit.frames.map((x) => x.frame)}));
        } else {
            if (!s) return;
            const from = s.measurement ? {measurement: s.measurement.id} :
                {conversion: id, tab: TARGET, geometry: s.geometry, shape: s.shape};
            r = await readJson<Finding>(await sendJson(findingsUrl(api, datasetId), "POST", {...fieldsBody(fields, s.res?.frames), ...from}));
        }
        if (!r.ok) return setDraft({...d, fields, error: errorText(r.data, "Could not save the finding.")});
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

    // Above the window's frames: the finding shown, or the button that saves the spot or area as one
    function sourcesAbout() {
        const f = sources?.finding ? findings.find((x) => x.id === sources.finding) : null;
        if (f) return <FindingAbout f={f} onEdit={() => setDraft({title: "Change finding", fields: fieldsOf(f), edit: f})}/>;
        if (!sources?.res || sources.res.reason === "outside_raster") return null;
        if (!sources.res.frames?.length && !NOT_KNOWN.includes(sources.res.reason || "")) return null;
        return <SaveFinding onSave={() => newFinding()}/>;
    }

    return (
        <div class="page viewer visual-alone">
            <div class="breadcrumb"><a href={publicUrl + "dataset/" + datasetId + "#datasets"}><ArrowLeft/> {datasetName}</a></div>
            <div class="page-header">
                <div>
                    <h1 id="name">{v.name}</h1>
                    <div class="subtitle">{(v.description || "") + (v.stripped ? " · location stripped from the downloads" : "")}</div>
                </div>
                <div class="page-actions">
                    {webodmTaskUrl(v.imported) && <a class="button default" id="open-webodm" href={webodmTaskUrl(v.imported)}
                        target="_blank" rel="noopener noreferrer" title="The task this orthophoto was imported from, in WebODM">
                        <Link/> Open in WebODM</a>}
                    {ready && <a class="button default" id="compare" href={publicUrl + "conversion/" + id + "/compare"}
                                 title="This mosaic beside another mosaic, or over it"><Columns/> Compare with…</a>}
                    {ready && <a class="button default" id="report" href={publicUrl + "conversion/" + id + "/report"}
                                 title="The mosaic with its measurements and findings, to print or save as PDF"><FileText/> Mosaic report</a>}
                    {v.status === "ready" && v.mosaic_status !== "building" && !imported &&
                        <button type="button" class="button default" id="build"
                                onClick={() => onAction("/mosaics", "Could not build the mosaic.")}>
                            <Grid/> {v.mosaic_status === "ready" ? "Rebuild mosaic" : "Build mosaic"}</button>}
                    {busy && <button type="button" class="button default" id="cancel"
                                     onClick={() => onAction("/cancel", "Could not cancel.")}><Stop/> Cancel</button>}
                </div>
            </div>
            <MosaicStatus v={{...v, label: mosaicLabel(v)}}/>
            <div class="viewer-main" key="main" hidden={!ready}>
                {ready && <div class="tabs" role="tablist">
                    <a href="#visual" role="tab" aria-selected={true} class="active" data-tab="visual" title={TAB_TIPS.visual}
                       onClick={(e) => e.preventDefault()}>{tabLabel("visual")}</a>
                    {heights && <a href="#heights" role="tab" aria-selected={false} data-tab="heights" title={TAB_TIPS.heights}
                                   onClick={(e) => { e.preventDefault(); nav(location.pathname + viewQuery({tab: "heights"})); }}>
                        {tabLabel("heights")}</a>}
                </div>}
                <div class="viewer-body">
                    <div class="map-stage">
                        <div class="viewer-map" id="map" ref={mapEl}/>
                        {ready && <Toolbar tool={tools.tool} count={tools.count} tools={TOOLS_HERE} hints={HINTS_HERE}
                                           label="Drawing tools: the frames that saw a spot, the length of a line or the size of an area"
                                           onTool={pickTool} onFinish={() => { drawing.current?.finish(); syncTools(); }}/>}
                        {ready && current && <MeasureCard m={current} unit={undefined} name={saveName} error={measureError}
                            onName={setSaveName} onSave={save} onClose={closeCard}
                            onKeep={hasSources(current.geometry) ? () => keepCard(current) : undefined}
                            onSources={hasSources(current.geometry) ?
                                () => openSources(current.geometry, {shape: current.shape, measurement: current.saved || undefined}) : undefined}/>}
                    </div>
                    {ready && <div class="viewer-panel">
                        <PanelGroup title="View"/>
                        <p class="hint" id="visual-hint">{imported ? IMPORTED_HINT : VISUAL_ALONE_HINT}</p>
                        <Section name="saved" title={<span class="measurements-head"><span>Saved measurements</span>
                            {saved.length > 0 && <a class="button default small" id="csv" href={base + "/measurements.csv"}
                                                    onClick={(e) => e.stopPropagation()}><Download/> CSV</a>}
                            {saved.length > 0 && <a class="button default small" id="geojson" href={base + "/measurements.geojson"}
                                                    title="The measurements with their shapes, for a GIS"
                                                    onClick={(e) => e.stopPropagation()}><Download/> GeoJSON</a>}</span>}>
                            {!current && measureError && <div class="text-danger" id="measure-error">{measureError}</div>}
                            <Measurements items={saved} unit={undefined} current={current?.saved?.id ?? null} compared={compared}
                                          editing={null} fields={[]} onShow={showSaved}
                                          onCompare={(x, on) => setCompared((c) => toggleCompared(c, x, on))}
                                          onEdit={() => undefined} onRename={rename} onDelete={remove}
                                          onRemeasure={async () => null}
                                          onFinding={(m) => { openSources(m.geometry!, {shape: m.values?.shape, measurement: m}); newFinding(m.name); }}/>
                        </Section>
                        <Section name="findings" title={"Findings" + (findings.length ? " (" + findings.length + ")" : "")}>
                            {findingError && <div class="text-danger" id="finding-error">{findingError}</div>}
                            <Findings items={findings} shown={showFindings} hidden={hidden} opened={opened}
                                      onShown={setShowFindings} onOpen={(f) => openFinding(f, true)}
                                      onEdit={(f) => setDraft({title: "Change finding", fields: fieldsOf(f), edit: f})}
                                      onDelete={deleteFinding}
                                      onHide={(x, hide) => setHidden((h) => hide ? h.concat(x) : h.filter((y) => y !== x))}/>
                        </Section>
                        <PanelGroup title="About"/>
                        <Section name="report" title="The mosaic">
                            <Report rows={(v.imported ? importedRows(v.imported) : []).concat(visualRows(vis))} files={vis?.files} base={base}/>
                        </Section>
                    </div>}
                </div>
            </div>
            {sources && <SourcesWindow name="viewer" anchor={mapEl.current} onClose={closeSources} about={sourcesAbout()}
                groups={[{title: "", res: sources.res, error: sources.error, unit: undefined,
                          photo: (f) => base + "/frame/visual?frame=" + encodeURIComponent(f) + "&size=" + WINDOW_PX}]}/>}
            {draft && <FindingForm title={draft.title} fields={draft.fields} error={draft.error} onSave={saveFinding}
                                   onCancel={() => setDraft(null)}
                                   frames={draft.edit ? draft.edit.frames : sources?.res === undefined ? undefined : sources.res?.frames ?? null}/>}
        </div>
    );
}
