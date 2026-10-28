// A dataset's report, laid out to be printed to PDF (A4 or Letter): its title block, the dataset's figures, where the
// frames were taken, the coverage, the problems, the frames' settings and temperatures, the conversions, the findings,
// notes, and the frames' table as an appendix when it is switched on. The text is typed on the page and saved on the
// dataset; the print styles leave out the controls and print it light.
import Feature from "ol/Feature";
import type OlMap from "ol/Map";
import Polygon from "ol/geom/Polygon";
import type VectorSource from "ol/source/Vector";
import {boundingExtent} from "ol/extent";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import {useEffect, useRef, useState} from "preact/hooks";
import {readJson} from "../core/api";
import {count, formatDate, formatNumber} from "../core/format";
import {formatTemp} from "../core/units";
import {conversionLabel} from "../dataset/conversions";
import {type Dataset} from "../dataset/dataset-page";
import {FILE_COLUMNS} from "../dataset/files";
import {cell, Figures, Overview, ProblemsTab} from "../dataset/tabs";
import {type Finding, findingsUrl, SEVERITY_COLORS} from "../findings/findings";
import {centreOf} from "../findings/layer";
import {type Basemap, fitBounds, lonLatToMap, mosaicMap, pointFeature, vectorLayer} from "../map/map";
import {framePositions, numbered, type ReportText, reportText, settingsSummary, temperatureSummary,
        thermalFrames, todayText} from "./report";
import {FindingsSection} from "./findings";
import {ReportBar, ReportField, TitleBlock, useReportText} from "./text";

const MAX_FIT_ZOOM = 19;
// The appendix's columns: the Files tab's, but its kind (each is a thermal frame), to fit the page's width
const APPENDIX_COLUMNS = FILE_COLUMNS.filter((c) => c.key !== "kind");

interface ReportDataset extends Dataset {report?: ReportText; flight_area?: [number, number][] | null}

const FRAME = new Style({image: new CircleStyle({radius: 3, fill: new Fill({color: "#00b8d4"}),
                                                 stroke: new Stroke({color: "#fff", width: 1})})});
const AREA = new Style({stroke: new Stroke({color: "#00b8d4", width: 2}), fill: new Fill({color: "rgba(0, 184, 212, 0.1)"})});

function findingStyle(f: Finding & {number: number}): Style {
    const colour = SEVERITY_COLORS[f.severity] || "#dc2626";
    return new Style({
        image: new CircleStyle({radius: 10, fill: new Fill({color: colour}), stroke: new Stroke({color: "#fff", width: 2})}),
        stroke: new Stroke({color: colour, width: 2}),
        text: new Text({text: String(f.number), font: "700 11px system-ui, sans-serif", fill: new Fill({color: "#fff"})}),
    });
}

interface MapProps {basemaps: Basemap[]; d: ReportDataset; findings: (Finding & {number: number})[]}

// Where the frames were taken, the flight's area and the findings by their numbers
function FramesMap({basemaps, d, findings}: MapProps) {
    const el = useRef<HTMLDivElement>(null);
    const map = useRef<OlMap | null>(null);
    const drawn = useRef<VectorSource | null>(null);

    useEffect(() => {
        const m = mosaicMap(el.current!, basemaps).map;
        map.current = m;
        drawn.current = vectorLayer(m);
        return () => m.setTarget(undefined);
    }, []);

    const drawing = JSON.stringify([d.flight_area, framePositions(d.analysis?.files), findings.map((f) => [f.id, f.geometry])]);
    useEffect(() => {
        const m = map.current!, source = drawn.current!;
        source.clear();
        const points: number[][] = [];
        if (d.flight_area) {
            const ring = d.flight_area.map((c) => lonLatToMap(c));
            const area = new Feature({geometry: new Polygon([ring])});
            area.setStyle(AREA);
            source.addFeature(area);
        }
        framePositions(d.analysis?.files).forEach((c) => {
            const at = lonLatToMap(c);
            points.push(at);
            const f = pointFeature(at);
            f.setStyle(FRAME);
            source.addFeature(f);
        });
        findings.forEach((f) => {
            const at = centreOf(f);
            points.push(at);
            if (f.geometry.type !== "Point") {
                const outline = new Feature({geometry: new Polygon((f.geometry.coordinates as [number, number][][])
                    .map((ring) => ring.map((c) => lonLatToMap(c))))});
                outline.setStyle(new Style({stroke: new Stroke({color: SEVERITY_COLORS[f.severity], width: 2})}));
                source.addFeature(outline);
            }
            const tag = pointFeature(at, {finding: f.number});
            tag.setStyle(findingStyle(f));
            source.addFeature(tag);
        });
        if (!points.length) return;
        const fit = () => {
            if (!fitBounds(m, boundingExtent(points), true, 30)) return false;
            if (m.getView().getZoom()! > MAX_FIT_ZOOM) m.getView().setZoom(MAX_FIT_ZOOM);
            return true;
        };
        if (!fit()) m.once("change:size", fit);
    }, [drawing]);

    return <div class="map report-map" id="report-map" ref={el}/>;
}

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    projectName: string;
    location: string;       // the project's place, as labelled
    author: string;         // the author last typed on a report
    basemaps: Basemap[];
    today?: string;
    print?: () => void;
}

export function DatasetReportPage({api, publicUrl, id, projectName, location: place, author, basemaps,
                                   today = todayText(), print = () => window.print()}: Props) {
    const url = api + "datasets/" + id;
    const [d, setD] = useState<ReportDataset | null>(null);
    const [findings, setFindings] = useState<Finding[]>([]);
    const [notice, setNotice] = useState("");
    const {text, setText, saved, change} = useReportText<Required<ReportText>>(url);

    useEffect(() => {
        (async () => {
            try {
                const r = await readJson<ReportDataset>(await fetch(url, {credentials: "same-origin"}));
                if (!r.ok) return setNotice("Could not load the flight.");
                setD(r.data);
                setText(reportText(r.data.report, r.data.name, author, today));
                document.title = r.data.name + " report · Thermal Analyzer";
                const f = await readJson<{findings: Finding[]}>(await fetch(findingsUrl(api, id), {credentials: "same-origin"}));
                if (f.ok) setFindings(f.data.findings || []);
            } catch {
                setNotice("Could not load the flight.");
            }
        })();
    }, []);

    if (!d || !text) {
        return (<div class="page report">
            {notice ? <div class="notice error" role="alert">{notice}</div> : <div class="message">Loading…</div>}
        </div>);
    }

    const a = d.analysis || {};
    const files = a.files;
    const items = numbered(findings);
    const coverage = a.webodm?.coverage;
    const settings = settingsSummary(files);
    const temperatures = temperatureSummary(files);
    const conversions = d.conversions || [];
    const thumbs = url + "/thumbnail?file=";

    return (
        <div class="page report">
            <ReportBar back={publicUrl + "dataset/" + id} backLabel={d.name} saved={saved} print={print}>
                <label><input type="checkbox" id="report-appendix" checked={text.appendix}
                              onChange={(e) => change("appendix", e.currentTarget.checked, 0)}/> Append the frames' table</label>
            </ReportBar>
            {notice && <div class="notice error no-print" role="alert">{notice}</div>}

            <TitleBlock text={text} change={change}>{projectName}{place && <> · {place}</>} · flight {d.name}</TitleBlock>

            <section class="report-section" id="report-dataset">
                <h2>The flight</h2>
                {a.files ? <Overview d={d}/> : <p class="text-muted">Not analyzed: analyze the flight for its figures.</p>}
                {d.source === "folder" && d.folder && <p class="text-muted">Read in place from <code>{d.folder}</code>.</p>}
            </section>

            <section class="report-section report-keep" id="report-where">
                <h2>Where the frames were taken</h2>
                {framePositions(files).length ? <>
                    <FramesMap basemaps={basemaps} d={d} findings={items}/>
                    <p class="report-caption">{count(framePositions(files).length, "frame", "frames")} with a position
                        {items.length > 0 && <>, and the findings by their numbers</>}.</p>
                </> : <p class="text-muted">None of the frames records where it was taken.</p>}
            </section>

            {coverage && (<section class="report-section report-keep" id="report-coverage">
                <h2>Coverage</h2>
                <Figures items={[
                    ["Frames used", coverage.frames],
                    ["Ground sample distance", coverage.gsd_m ? formatNumber(coverage.gsd_m * 100, 1, " cm/px") : ""],
                    ["Area", coverage.area_m2 ? formatNumber(coverage.area_m2, 0, " m²") : ""],
                    ["Frames per ground point (median)", coverage.images_per_point_median],
                    ["Area seen by 3 or more frames", coverage.area_seen_by_3_or_more_pct !== undefined ?
                        formatNumber(coverage.area_seen_by_3_or_more_pct, 0, " %") : ""],
                    ["Equivalent overlap", coverage.equivalent_overlap_pct !== undefined ?
                        formatNumber(coverage.equivalent_overlap_pct, 0, " %") : ""],
                ]}/>
            </section>)}

            {a.files && (<section class="report-section" id="report-problems">
                <h2>Problems found in the images</h2>
                <ProblemsTab analysis={a}/>
            </section>)}

            {thermalFrames(files).length > 0 && (<section class="report-section" id="report-frames">
                <h2>The frames' settings</h2>
                {settings.length ? <table class="table report-settings">
                    <thead><tr><th>Setting</th><th>Values (frames)</th></tr></thead>
                    <tbody>{settings.map((s) => (<tr key={s.setting.key}><td>{s.setting.label}</td>
                        <td>{s.range ? s.range.from + " to " + s.range.to + " (" + count(s.values.length, "value", "values") +
                                " across " + s.values.reduce((n, v) => n + v.frames, 0) + " frames)" :
                            s.values.map((v) => v.text + " (" + v.frames + ")").join(", ")}
                            {s.missing > 0 && <span class="text-muted">, not recorded ({s.missing})</span>}</td></tr>))}</tbody>
                </table> : <p class="text-muted">The frames record none of their settings.</p>}
                {temperatures.length > 0 && <>
                    <h3>Temperatures</h3>
                    <table class="table report-temperatures">
                        <thead><tr><th/><th>Lowest</th><th>Median</th><th>Highest</th></tr></thead>
                        <tbody>{temperatures.map((t) => (<tr key={t.label}><td>{t.label}</td>
                            <td>{formatTemp(t.lowest, "C", 1)}</td><td>{formatTemp(t.median, "C", 1)}</td>
                            <td>{formatTemp(t.highest, "C", 1)}</td></tr>))}</tbody>
                    </table>
                </>}
            </section>)}

            <section class="report-section" id="report-conversions">
                <h2>Datasets</h2>
                {conversions.length ? <table class="table report-conversions">
                    <thead><tr><th>Name</th><th>Settings</th><th>Status</th><th>Mosaics</th><th>Finished</th></tr></thead>
                    <tbody>{conversions.map((c) => (<tr key={c.id}><td>{c.name}</td><td>{c.description}</td>
                        <td>{conversionLabel(c)}{c.converted ? " · " + c.converted + " converted" : ""}</td>
                        <td>{c.mosaic_status === "ready" ? "Built" : c.mosaic_status ? c.mosaic_status : "None"}</td>
                        <td>{formatDate(c.finished_at)}</td></tr>))}</tbody>
                </table> : <p class="text-muted">None made.</p>}
            </section>

            <FindingsSection items={items} files={files} thumbs={thumbs} none="None saved."/>

            <section class={"report-section" + (text.notes ? "" : " empty")} id="report-notes-section">
                <h2>Notes</h2>
                <ReportField name="notes" label="Notes" text={text} change={change}/>
            </section>

            {text.appendix && files && (<section class="report-section report-appendix" id="report-appendix-table">
                <h2>Appendix: the frames</h2>
                <table class="table files report-files">
                    <thead><tr>{APPENDIX_COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                    <tbody>{thermalFrames(files).map((r) => (<tr key={r.path}>
                        {APPENDIX_COLUMNS.map((c) => <td key={c.key}>{c.key === "path" ? r.path.split("/").pop() : cell(r, c)}</td>)}
                    </tr>))}</tbody>
                </table>
            </section>)}
        </div>
    );
}
