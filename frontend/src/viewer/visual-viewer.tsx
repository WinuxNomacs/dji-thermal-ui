// The viewer of a dataset that is a visual mosaic alone (a flight without thermal frames, laid out by its own frames):
// the mosaic on a map, with no temperatures to colour, read or measure; a click on a spot, or an area drawn, opens the
// visual frames that saw it, and the panel says how the mosaic was made. The thermal viewer (viewer-page) shows it
// instead of its own once the mosaics are loaded.
import type OlMap from "ol/Map";
import {getDistance} from "ol/sphere";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {type Maybe, mosaicLabel, type Stage} from "../core/format";
import {ArrowLeft, Grid, Stop} from "../components/icons";
import {Drawing, drawingKey} from "../measure/drawing";
import {type Coords, type Geometry, TOOLS} from "../measure/measure";
import {Toolbar} from "../measure/result";
import {type Sources, sourcesUrl} from "../sources/sources";
import {SourcesWindow} from "../sources/window";
import {type Basemap, fitBounds, lonLatToMap, mapToLonLat, mosaicMap, visualLayer} from "../map/map";
import {MosaicStatus, PanelGroup, Report, Section} from "./panel";
import {TAB_TIPS, tabLabel, type VisualMosaic, visualRows} from "./view";

export const VISUAL_ALONE_HINT = "The visual camera's images, laid out by their own overlaps. The flight has no " +
    "thermal images, so nothing here has a temperature: click a spot, or draw an area, to see the frames that saw it.";
const WINDOW_PX = 1600;     // a frame in the source frames window, at most this many pixels across
const TOOLS_HERE = TOOLS.filter(([x]) => x !== "line");

export interface VisualAlone {
    name: string;
    description?: string;
    stripped?: boolean;
    status: string;
    mosaic_status: string;
    mosaic_error?: string | null;
    mosaic_progress?: number | null;
    stage?: Maybe<Stage>;
    visual?: VisualMosaic | null;
}

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    datasetId: number;
    datasetName: string;
    basemaps: Basemap[];
    v: VisualAlone;
    onAction: (path: string, failure: string) => void;      // build again, cancel (the viewer then loads it again)
}

const toCoords = (at: number[]): Coords => mapToLonLat(at) as Coords;

export function VisualViewer({api, publicUrl, id, datasetId, datasetName, basemaps, v, onAction}: Props) {
    const base = api + "conversions/" + id;
    const vis = v.visual;
    const ready = v.mosaic_status === "ready" && !!vis?.bounds;
    const busy = v.status === "converting" || v.mosaic_status === "building";
    const [tools, setTools] = useState<{tool: ReturnType<Drawing["tool"]>; count: number}>({tool: null, count: 0});
    const [sources, setSources] = useState<{res?: Sources | null; error?: string} | null>(null);
    const mapEl = useRef<HTMLDivElement>(null);
    const map = useRef<OlMap | null>(null);
    const drawing = useRef<Drawing | null>(null);
    const asked = useRef(0);

    const syncTools = () => {
        const d = drawing.current;
        setTools({tool: d ? d.tool() : null, count: d ? d.count() : 0});
    };

    // The map, once the mosaic is built (made again when it is built again)
    const key = ready ? JSON.stringify(vis!.bounds) + vis!.maxzoom : "";
    useEffect(() => {
        if (!ready || !mapEl.current) return;
        const m = map.current = mosaicMap(mapEl.current, basemaps).map;
        visualLayer(m, base + "/mosaics/visual/tiles/{z}/{x}/{y}.png", vis!.bounds!, (vis!.maxzoom || 20) + 1).setVisible(true);
        fitBounds(m, vis!.bounds!);
        drawing.current = new Drawing({
            map: m, toCoords, fromCoords: lonLatToMap, distance: (a, b) => getDistance(a, b),
            onDone: (geometry) => { openSources(geometry); syncTools(); },
            onChange: syncTools,
            onClick: (at) => openSources({type: "Point", coordinates: toCoords(at)}),
        });
        const keys = (e: KeyboardEvent) => { if (drawingKey(e, drawing.current)) syncTools(); };
        document.addEventListener("keydown", keys);
        return () => {
            document.removeEventListener("keydown", keys);
            m.setTarget(undefined);
            map.current = drawing.current = null;
        };
    }, [key]);

    async function openSources(geometry: Geometry) {
        const n = ++asked.current;
        setSources({});
        try {
            const r = await readJson<Sources>(await sendJson(sourcesUrl(api, id, "visual"), "POST", {geometry}));
            if (n === asked.current) setSources({res: r.ok ? r.data : null, error: r.ok ? "" : errorText(r.data, "Could not find the frames.")});
        } catch {
            if (n === asked.current) setSources({res: null});
        }
    }

    function pickTool(x: ReturnType<Drawing["tool"]>) {
        if (x) drawing.current?.start(x);
        else drawing.current?.stop();
        syncTools();
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
                    {v.status === "ready" && v.mosaic_status !== "building" &&
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
                </div>}
                <div class="viewer-body">
                    <div class="map-stage">
                        <div class="viewer-map" id="map" ref={mapEl}/>
                        {ready && <Toolbar tool={tools.tool} count={tools.count} tools={TOOLS_HERE}
                                           label="Drawing tools: the frames that saw a spot or an area" onTool={pickTool}
                                           onFinish={() => { drawing.current?.finish(); syncTools(); }}/>}
                    </div>
                    {ready && <div class="viewer-panel">
                        <PanelGroup title="View"/>
                        <p class="hint" id="visual-hint">{VISUAL_ALONE_HINT}</p>
                        <PanelGroup title="About"/>
                        <Section name="report" title="The mosaic">
                            <Report rows={visualRows(vis)} files={vis?.files} base={base}/>
                        </Section>
                    </div>}
                </div>
            </div>
            {sources && <SourcesWindow name="viewer" anchor={mapEl.current} onClose={() => { asked.current++; setSources(null); }}
                groups={[{title: "", res: sources.res, error: sources.error, unit: undefined,
                          photo: (f) => base + "/frame/visual?frame=" + encodeURIComponent(f) + "&size=" + WINDOW_PX}]}/>}
        </div>
    );
}
