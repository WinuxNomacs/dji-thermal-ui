// A conversion's mosaic report, laid out to be printed to PDF (A4 or Letter): its title block; the mosaic as the view
// saved with it shows it, with its measurements and the dataset's findings on it; each measurement with its close-up,
// its figures and charts, and a comment; the findings; the settings and the method; notes. The text, the view and the
// measurements left out are saved on the conversion, each comment on its measurement. The figures are images, drawn
// off the page (figures.ts), so that they print.
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {userUnit} from "../core/units";
import {type Conversion} from "../dataset/conversions";
import {type Analysis} from "../dataset/files";
import {differences, type Settings} from "../dataset/settings";
import {type Finding, findingsUrl} from "../findings/findings";
import {readValues, SEAMS} from "../map/colour";
import {DATA_GUTTER, rasterPixel, type Values} from "../map/map";
import {type Measured, type Measurement, measurementFigure, shapeLabel, targetLabel} from "../measure/measure";
import {ResultView} from "../measure/result";
import {valuesUrl} from "../frame/frame";
import {adjustQuery, dataUrl, reportRows, type Style, TAB_HINTS, tabLabel, takenText, TEMPERATURE_TABS,
        viewQuery} from "../viewer/view";
import {type Mosaics} from "../viewer/viewer-page";
import {type Ask, drawFigures, type Mark, type Source} from "./figures";
import {FindingsSection} from "./findings";
import {closeUpExtent, colouringOf, findingMark, included, legendOf, type MosaicReportText, onMosaic, reportStyle,
        temperatureStyle, underOf, viewText} from "./mosaic-report";
import {numbered, todayText} from "./report";
import {ReportBar, ReportField, TitleBlock, type Typed, useReportText} from "./text";

const COMMENT_MS = 600;         // typing a comment pauses this long before it is saved
const MAIN = {width: 1000, height: 700}, CLOSE_UP = {width: 640, height: 420};

interface Detail extends Conversion {results?: {version?: string}; report?: MosaicReportText}
interface DatasetInfo {defaults?: Settings; analysis?: Analysis}

type Text = Typed & {left_out: number[]};

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    datasetId: number;
    datasetName: string;
    projectName: string;
    location: string;       // the project's place, as labelled
    author: string;         // the author last typed on a report
    today?: string;
    print?: () => void;
}

const get = async <T,>(url: string) => readJson<T>(await fetch(url, {credentials: "same-origin"}));

export function ConversionReportPage({api, publicUrl, id, datasetId, datasetName, projectName, location: place, author,
                                      today = todayText(), print = () => window.print()}: Props) {
    const base = api + "conversions/" + id;
    const [c, setC] = useState<Detail | null>(null);
    const [v, setV] = useState<Mosaics | null>(null);
    const [d, setD] = useState<DatasetInfo>({});
    const [items, setItems] = useState<Measurement[]>([]);
    const [findings, setFindings] = useState<Finding[]>([]);
    const [curve, setCurve] = useState<number[] | null | undefined>(undefined);
    const [images, setImages] = useState<Record<string, string | null>>({});
    const [drawing, setDrawing] = useState(0);              // the figures being drawn
    const [loaded, setLoaded] = useState(false);            // the dataset and its findings too
    const [notice, setNotice] = useState("");
    const [comments, setComments] = useState<Record<number, string>>({});
    const [commentSaved, setCommentSaved] = useState("");
    const commentTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
    const {text, setText, saved, change} = useReportText<Text>(base);

    useEffect(() => {
        (async () => {
            try {
                const [rc, rv, rm] = await Promise.all([get<Detail>(base), get<Mosaics>(base + "/mosaics"),
                                                        get<{measurements: Measurement[]}>(base + "/measurements")]);
                if (!rc.ok || !rv.ok) return setNotice("Could not load the dataset.");
                const s = rc.data.report || {};
                setC(rc.data);
                setV(rv.data);
                setItems(rm.ok ? rm.data.measurements || [] : []);
                setText({title: s.title ?? datasetName + " · " + rc.data.name, author: s.author ?? author,
                         date: s.date ?? today, notes: s.notes ?? "", left_out: s.left_out || []});
                document.title = rc.data.name + " report · Thermal Analyzer";
                const [rd, rf] = await Promise.all([get<DatasetInfo>(api + "datasets/" + datasetId),
                                                    get<{findings: Finding[]}>(findingsUrl(api, datasetId))]);
                if (rd.ok) setD(rd.data);
                if (rf.ok) setFindings(rf.data.findings || []);
                setLoaded(true);
            } catch {
                setNotice("Could not load the dataset.");
            }
        })();
        return () => Object.values(commentTimers.current).forEach(clearTimeout);
    }, []);

    const ready = loaded && !!v && v.mosaic_status === "ready" && (v.tabs || []).length > 0;
    const {tab, style} = ready ? reportStyle(v!, c?.report?.view) : {tab: "", style: null as Style | null};
    const t = ready ? v!.tabs!.find((x) => x.tab === tab) : undefined;

    // The equalization's curve, asked of the server as the viewer asks it (none needed without)
    useEffect(() => {
        if (!ready || !style) return;
        if (!style.adjust.equalize) return setCurve(null);
        (async () => {
            const r = await get<{shares?: number[]}>(base + "/mosaics/" + tab + "/curve?rescale=" + style.range[0] + "," +
                                                      style.range[1] + adjustQuery(style.adjust));
            setCurve(r.ok ? r.data.shares || null : null);
        })().catch(() => setCurve(null));
    }, [ready]);

    const shownItems = text ? included(items, text.left_out) : [];
    const numberOf = (m: Measurement) => shownItems.indexOf(m) + 1;
    const found = numbered(onMosaic(findings, t?.bounds));

    const tiles = (tabName: string): Values | null => {
        const x = v?.tabs?.find((y) => y.tab === tabName);
        return x ? {kind: "tiles", url: dataUrl(api, id, tabName), bounds: x.bounds || [-180, -85, 180, 85],
                    maxZoom: (x.maxzoom || 20) + 1, gutter: DATA_GUTTER,
                    pixel: rasterPixel(x.bounds, v?.kinds?.[x.kind || ""]?.width)} : null;
    };
    const mark = (m: Measurement): Mark => ({geometry: m.geometry!, name: "M" + numberOf(m)});

    async function figures(source: Source | null, asks: Ask[], size: typeof MAIN) {
        if (!source || !asks.length) return;
        setDrawing((n) => n + asks.length);
        try {
            const out = await drawFigures(source, asks, size);
            setImages((x) => ({...x, ...out}));
        } finally {
            setDrawing((n) => n - asks.length);
        }
    }

    // The mosaic with what is on it, drawn again when a measurement is left out or put back
    const marksKey = JSON.stringify([text?.left_out, found.map((f) => f.id)]);
    useEffect(() => {
        if (!ready || !style || curve === undefined || !text) return;
        const marks = [...shownItems.filter((m) => m.target !== "frame" && m.geometry).map(mark), ...found.map(findingMark)];
        const under = underOf(v!, tab, style), shares = under.style === style ? curve : null;
        figures({values: tiles(under.tab)!, colouring: colouringOf(v!, under.tab, under.style, shares),
                 legend: legendOf(v!, under.tab, under.style, shares),
                 over: under.seams ? {values: tiles(tab)!, colouring: SEAMS} : undefined},
                [{key: "main", title: viewText(v!, tab, style), marks}], MAIN);
    }, [ready, curve, marksKey]);

    // Each measurement's close-up, once: on its own mosaic, or its frame, coloured as the temperatures are shown
    useEffect(() => {
        if (!ready || !style || curve === undefined || !items.length) return;
        const temps = temperatureStyle(v!, tab, style), shares = temps === style ? curve : null;
        const colouring = colouringOf(v!, "as_converted", temps, shares), legend = legendOf(v!, "as_converted", temps, shares);
        const named = (m: Measurement): Mark => ({geometry: m.geometry!, name: m.name});
        for (const target of TEMPERATURE_TABS) {
            const on = items.filter((m) => m.target === target && m.geometry);
            figures(tiles(target) && {values: tiles(target)!, colouring, legend},
                    on.map((m) => ({key: "m" + m.id, title: m.name + " · " + tabLabel(target), extent: closeUpExtent(m.geometry!),
                                    marks: [named(m)]})), CLOSE_UP);
        }
        const frames = [...new Set(items.filter((m) => m.target === "frame" && m.frame).map((m) => m.frame!))];
        frames.forEach(async (frame) => {
            const res = await fetch(valuesUrl(api, id, frame, {}), {credentials: "same-origin"});
            if (!res.ok) return;
            const {values, width, height} = await readValues(res);
            const on = items.filter((m) => m.target === "frame" && m.frame === frame && m.geometry);
            figures({values: {kind: "frame", key: frame, values, width, height}, colouring: {...colouring, shares: null}, legend},
                    on.map((m) => ({key: "m" + m.id, title: m.name + " · " + targetLabel(m), marks: [named(m)]})), CLOSE_UP);
        });
    }, [ready, curve, items.length]);

    function leaveOut(m: Measurement, out: boolean) {
        const ids = text!.left_out.filter((x) => x !== m.id).concat(out ? [m.id] : []);
        change("left_out", ids, 0);
    }

    function comment(m: Measurement, value: string) {
        setComments((x) => ({...x, [m.id]: value}));
        setCommentSaved("");
        clearTimeout(commentTimers.current[m.id]);
        commentTimers.current[m.id] = setTimeout(async () => {
            const r = await readJson(await sendJson(base + "/measurements/" + m.id, "PATCH", {comment: value}));
            setCommentSaved(r.ok ? "Comment saved" : errorText(r.data, "Could not save the comment."));
        }, COMMENT_MS);
    }

    if (!c || !v || !text) {
        return (<div class="page report">
            {notice ? <div class="notice error" role="alert">{notice}</div> : <div class="message">Loading…</div>}
        </div>);
    }

    const viewer = publicUrl + "conversion/" + id + viewQuery(c.report?.view || {});
    const waiting = drawing > 0 ? "Drawing the figures…" : "";
    const unit = v.unit;
    const diffs = differences(c.settings, d.defaults, null, userUnit()).filter((x) => x.changed);
    const kind = t ? v.kinds?.[t.kind || ""] : undefined;
    const taken = takenText(v.flown, v.flight_zone);
    const img = (key: string, alt: string) => images[key] ?
        <img class="report-figure" src={images[key]!} alt={alt}/> :
        <p class="text-muted report-figure-missing">{drawing ? "Drawing…" : "Could not be drawn."}</p>;

    return (
        <div class="page report">
            <ReportBar back={viewer} backLabel={c.name} saved={commentSaved || saved} print={print} waiting={waiting}/>
            {notice && <div class="notice error no-print" role="alert">{notice}</div>}

            <TitleBlock text={text} change={change}>{projectName}{place && <> · {place}</>} · flight {datasetName} ·
                dataset {c.name}{taken && <> · flown {taken}</>}</TitleBlock>

            {!ready ? <p class="text-muted">The mosaics are not built: build them on the flight page's Convert tab.</p> : <>
                <section class="report-section report-keep" id="report-mosaic">
                    <h2>The mosaic</h2>
                    <p class="report-caption no-print">{viewText(v, tab, style!)}. <a href={viewer}>Change the view in the
                        viewer</a>, then open the report from there.</p>
                    {img("main", "The mosaic")}
                </section>

                <section class="report-section" id="report-measurements">
                    <h2>Measurements</h2>
                    {items.length ? <>
                        <table class="table report-measurements-table">
                            <thead><tr><th>#</th><th>Measurement</th><th>On</th><th>Figure</th><th>Comment</th></tr></thead>
                            <tbody>{shownItems.map((m) => (<tr key={m.id}><td>M{numberOf(m)}</td><td>{m.name}</td>
                                <td>{targetLabel(m)}</td><td>{measurementFigure(m, unit)}</td>
                                <td class="report-notes-text">{comments[m.id] ?? m.comment ?? ""}</td></tr>))}</tbody>
                        </table>
                        {[...shownItems, ...items.filter((m) => !shownItems.includes(m))].map((m) => {
                            const out = !shownItems.includes(m);
                            const value = comments[m.id] ?? m.comment ?? "";
                            return (<article class={"report-measurement report-keep" + (out ? " left-out" : "")} key={m.id}
                                             data-measurement={m.id}>
                                <h3>{out ? "" : "M" + numberOf(m) + ". "}{m.name}{" "}
                                    <span class="text-muted">{shapeLabel(m.values?.result, m.values?.shape)} · {targetLabel(m)}</span>
                                    <label class="no-print report-leave-out"><input type="checkbox" checked={out}
                                        onChange={(e) => leaveOut(m, e.currentTarget.checked)}/> Leave out</label></h3>
                                {!out && <>
                                    {img("m" + m.id, m.name)}
                                    <ResultView res={m.values as Measured} unit={unit} shape={m.values?.shape}
                                                pixels={m.target === "frame"}/>
                                    <label class={"report-field report-comment" + (value ? "" : " empty")}>
                                        <span class="report-label">Comment</span>
                                        <textarea rows={2} value={value} placeholder="A comment printed with it"
                                                  onInput={(e) => comment(m, e.currentTarget.value)}/>
                                        <span class="print-only report-value">{value}</span>
                                    </label>
                                </>}
                            </article>);
                        })}
                    </> : <p class="text-muted">None saved: measure in the viewer and save them.</p>}
                </section>
            </>}

            <FindingsSection items={found} files={d.analysis?.files} thumbs={api + "datasets/" + datasetId + "/thumbnail?file="}
                             none="None on this mosaic."/>

            <section class="report-section report-keep" id="report-method">
                <h2>Settings and method</h2>
                <dl class="figures">
                    <div><dt>Dataset</dt><dd>{c.name}{c.description && " · " + c.description}</dd></div>
                    <div><dt>Changed from the defaults</dt><dd>{diffs.length ? diffs.map((x) => x.text).join("; ") : "None"}</dd></div>
                    {ready && <div><dt>Mosaic</dt><dd>{tabLabel(tab)}{TAB_HINTS[tab] && ": " + TAB_HINTS[tab]}</dd></div>}
                    <div><dt>dji-thermal-cli</dt><dd>{c.results?.version || "Not recorded"}</dd></div>
                </dl>
                {reportRows(kind).length > 0 && <table class="table report-mosaic-rows"><tbody>
                    {reportRows(kind).map(([k, x]) => <tr key={k}><th>{k}</th><td>{x}</td></tr>)}</tbody></table>}
            </section>

            <section class={"report-section" + (text.notes ? "" : " empty")} id="report-notes-section">
                <h2>Notes</h2>
                <ReportField name="notes" label="Notes" text={text} change={change}/>
            </section>
        </div>
    );
}
