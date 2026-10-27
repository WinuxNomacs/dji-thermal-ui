// A thermal dataset's page: what dji-thermal-cli found in it (an overview, then tabs: the files, the problems, the
// WebODM plan and its conversions), with adding images and analyzing again; kept up to date while it is analyzed or
// converted
import {useEffect, useRef, useState} from "preact/hooks";
import {csrfToken, errorText, readJson, sendJson} from "../core/api";
import {count, deleteText, failedText, type FlightZone, formatDate} from "../core/format";
import {isImage, type Progress, uploadFiles} from "../core/upload";
import {ask, askName, dialog} from "../components/dialog";
import {ArrowLeft, Check, Link, Pencil, Play, Plus, Refresh, Stop, Trash, Warning} from "../components/icons";
import {navigationChanged} from "../core/navigation";
import {type Conversion, isBusy, parsePrefill} from "./conversions";
import {ConvertTab} from "./convert";
import {type Analysis, type FilesView, newestReady} from "./files";
import {copyText, FilesTab, Overview, PlanTab, ProblemsTab} from "./tabs";

const POLL_MS = 2000;

const TABS = [["files", "Files"], ["problems", "Problems"], ["webodm", "WebODM plan"], ["convert", "Convert"]] as const;
type Tab = typeof TABS[number][0];

export interface Dataset {
    id: number;
    name: string;
    status: string;
    progress?: number | null;
    error?: string | null;
    source?: string;
    folder?: string | null;
    file_count?: number;
    size?: number | null;
    analyzed?: boolean;
    analyzed_at?: string | null;
    analysis?: Analysis | null;
    flight_zone?: FlightZone | null;
    conversions?: Conversion[];
    conversion_count?: number;
    mosaic_count?: number;
    measurement_count?: number;
    finding_count?: number;
    created_at?: string;
}

// A link to a tab (#convert, as the mosaic viewer's way back) opens it
function linkedTab(): Tab | null {
    const t = location.hash.replace(/[^a-z]/g, "");
    return TABS.some(([key]) => key === t) ? t as Tab : null;
}

function Status({d}: {d: Dataset}) {
    if (d.status === "analyzing") {
        const pct = Math.round((d.progress || 0) * 100);
        return (<div class="status" id="status">
            <div class="progress"><div class="progress-bar active" style={{width: pct + "%"}}>{pct}%</div></div>
            {" "}Analyzing {d.file_count} file(s)…</div>);
    }
    if (d.status === "failed") return <div class="status text-danger" id="status"><Warning/> The analysis failed: {d.error}</div>;
    if (d.status === "canceled") return <div class="status text-muted" id="status">The analysis was canceled.</div>;
    if (d.status === "new") {
        return (<div class="status text-muted" id="status">{d.file_count ? (d.analyzed ?
            "Images were added since the last analysis: analyze again to include them." :
            d.file_count + " file(s), not analyzed yet.") : "No images yet: add the flight's R-JPEGs."}</div>);
    }
    return null;
}

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    projectId: number;                          // the project it is in
    projectName: string;
    nav?: (url: string) => void;
}

export function DatasetPage({api, publicUrl, id, projectId, projectName,
                             nav = (url) => { location.href = url; }}: Props) {
    const projectUrl = publicUrl + "project/" + projectId;
    const url = api + "datasets/" + id;
    const [d, setD] = useState<Dataset | null>(null);
    const [notice, setNotice] = useState("");
    const [chosen, setChosen] = useState<Tab | null>(linkedTab);
    const [view, setView] = useState<FilesView>({show: "all", filter: "", sort: "path", desc: false});
    const [planRequest, setPlanRequest] = useState(0);
    const [copied, setCopied] = useState(false);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [unsent, setUnsent] = useState<{files: File[]; text: string} | null>(null);
    const [prefill] = useState(() => parsePrefill(location.search));
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const controller = useRef<AbortController | null>(null);
    const convertRef = useRef<HTMLDivElement>(null);
    const shows = useRef<string | null>(null);     // what the navigation pane lists of the conversions

    function show(data: Dataset) {
        clearTimeout(timer.current);
        setD(data);
        // A conversion's frames or mosaics became ready while the page watched it: the pane offers them
        const listed = (data.conversions || []).map((c) => c.id + ":" + c.status + ":" + c.mosaic_status).join();
        if (shows.current !== null && shows.current !== listed) navigationChanged();
        shows.current = listed;
        document.title = data.name + " · Thermal Analyzer";
        if (data.status === "analyzing" || (data.conversions || []).some(isBusy)) timer.current = setTimeout(load, POLL_MS);
    }

    async function load() {
        clearTimeout(timer.current);
        try {
            const r = await readJson<Dataset>(await fetch(url, {credentials: "same-origin"}));
            if (!r.ok) return setNotice("Could not load the dataset.");
            show(r.data);
        } catch {
            setNotice("Could not load the dataset.");
        }
    }

    useEffect(() => {
        load();
        // Leaving the page would stop an upload half way
        const leaving = (e: BeforeUnloadEvent) => {
            if (!controller.current) return;
            e.preventDefault();
            e.returnValue = "";
        };
        addEventListener("beforeunload", leaving);
        return () => {
            clearTimeout(timer.current);
            removeEventListener("beforeunload", leaving);
        };
    }, []);

    async function action(path: string, failure: string) {
        const r = await readJson<Dataset>(await sendJson(url + path, "POST", {}));
        setNotice(r.ok ? "" : errorText(r.data, failure));
        if (r.ok) show(r.data);
    }

    async function rename() {
        const name = await askName("Rename dataset", d!.name);
        if (!name) return;
        const r = await readJson<Dataset>(await sendJson(url, "PATCH", {name}));
        setNotice(r.ok ? "" : errorText(r.data, "Could not rename the dataset."));
        if (r.ok) show(r.data);
    }

    async function remove() {
        if (!await ask("Delete dataset", deleteText(d!), "Delete", "danger")) return;
        const r = await readJson(await sendJson(url, "DELETE"));
        if (!r.ok) return setNotice(errorText(r.data, "Could not delete the dataset."));
        nav(projectUrl);
    }

    // To the clipboard, the button saying so; refused, a dialog to copy it from
    async function copyLink() {
        const link = location.origin + publicUrl + "dataset/" + id;
        if (await copyText(link)) return setCopied(true);
        dialog({title: "Copy link", text: "Copy this:", field: {value: link, readonly: true},
                buttons: [{label: "Close", value: true, style: "primary"}]});
    }

    // Adding images: those sent are kept when the upload is canceled (the dataset exists already); those that did not
    // arrive (failed, or never sent) can be sent again
    async function addImages(files: File[]) {
        setUnsent(null);
        setNotice("");
        controller.current = new AbortController();
        setProgress({sent: 0, total: files.filter(isImage).length, bytesSent: 0, bytesTotal: 1});
        const u = await uploadFiles((x, i) => fetch(x, i), url + "/upload", csrfToken(), files, setProgress,
                                    {signal: controller.current.signal});
        controller.current = null;
        setProgress(null);
        if (u.saved && !u.canceled) await action("/analyze", "Could not start the analysis.");
        else await load();
        if (!u.failed.length) return;
        setUnsent({files: u.failed, text: u.canceled ?
            "Upload canceled: " + count(u.saved, "image was", "images were") + " sent and kept (analyze again to include " +
            "them), " + count(u.failed.length, "image was", "images were") + " not sent." : failedText(u.failed)});
    }

    function chooseImages(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const files = Array.from(input.files || []);
        input.value = "";
        if (!files.some(isImage)) return setNotice("Choose JPEG images (the flight's R-JPEGs).");
        addImages(files);
    }

    function cancelUpload() {
        controller.current?.abort();
        setProgress((p) => p && {...p, canceling: true} as Progress);
    }

    if (!d) {
        return (<div class="page dataset">
            {notice ? <div class="notice error" role="alert">{notice}</div> : <div class="message">Loading…</div>}
        </div>);
    }

    const a = d.analysis || null;
    const analyzing = d.status === "analyzing", uploading = progress !== null;
    // Converting needs no analysis: the tabs show as soon as there are images (or conversions); before the analysis
    // only the Convert tab has something to show, after it the files unless a tab was chosen
    const hasTabs = !!a?.files || !!d.file_count || !!(d.conversions || []).length;
    const tab: Tab = !a?.files ? "convert" : chosen || "files";
    const ready = newestReady(d.conversions);
    const frames = ready ? publicUrl + "conversion/" + ready.id + "/frame" : null;
    const mosaics = (d.conversions || []).find((c) => c.status === "ready" && c.mosaic_status === "ready");
    const serious = (a?.findings || []).filter((f) => f.severity !== "info").length;
    const convertCount = (d.conversions || []).length;
    const badges: Record<Tab, number | string> = {files: a?.files?.length || "", problems: serious || "", webodm: "",
                                                   convert: convertCount || ""};
    const pct = progress && progress.bytesTotal ? Math.round(progress.bytesSent / progress.bytesTotal * 100) : 0;

    function showFile(path: string) {
        setView({...view, filter: path, show: "all"});
        setChosen("files");
    }

    function convertWithPlan() {
        setPlanRequest((n) => n + 1);
        setChosen("convert");
        setTimeout(() => convertRef.current?.scrollIntoView?.());
    }

    return (
        <div class="page dataset">
            <div class="breadcrumb"><a href={projectUrl}><ArrowLeft/> {projectName}</a></div>
            <div class="page-header">
                <div>
                    <h1 id="name">{d.name}</h1>
                    <div class="subtitle">{formatDate(d.created_at)}{d.source === "folder" ?
                        <> · read in place{d.folder && <> from <code>{d.folder}</code></>}</> : " · uploaded"}
                        {d.finding_count ? <> · {mosaics ? <a id="findings" href={publicUrl + "conversion/" + mosaics.id}
                            title="Open its newest mosaics, where the findings are listed">{count(d.finding_count, "finding", "findings")}</a> :
                            <span id="findings">{count(d.finding_count, "finding", "findings")}</span>}</> : null}</div>
                </div>
                <div class="page-actions">
                    {d.source === "upload" && !analyzing && !uploading && (
                        <label class="button default" id="add-images" title="Add images to this dataset"><Plus/> Add images
                            <input type="file" multiple accept=".jpg,.jpeg,image/jpeg" hidden onChange={chooseImages}/></label>)}
                    {!analyzing && !uploading && (
                        <button type="button" class="button default" id="analyze"
                                onClick={() => action("/analyze", "Could not start the analysis.")}>
                            {d.analyzed ? <><Refresh/> Analyze again</> : <><Play/> Analyze</>}</button>)}
                    {analyzing && <button type="button" class="button default" id="cancel"
                                          onClick={() => action("/cancel", "Could not cancel the analysis.")}><Stop/> Cancel</button>}
                    <button type="button" class="button default" id="copy-link" title="Copy a link to this dataset"
                            onClick={copyLink}>{copied ? <><Check/> Copied</> : <><Link/> Copy link</>}</button>
                    <button type="button" class="icon-button" id="rename" title="Rename" aria-label="Rename"
                            onClick={rename}><Pencil/></button>
                    <button type="button" class="icon-button danger" id="delete" title="Delete" aria-label="Delete"
                            onClick={remove}><Trash/></button>
                </div>
            </div>

            {notice && <div class="notice error" role="alert">{notice}</div>}
            <Status d={d}/>
            {progress && (
                <div class="upload-progress" id="add-progress">
                    <div class="progress"><div class="progress-bar" style={{width: pct + "%"}}/></div>
                    <span>{(progress as Progress & {canceling?: boolean}).canceling ? "Canceling…" :
                        "Uploading " + progress.sent + " of " + progress.total + " images (" + pct + "%)"}</span>
                    <button type="button" class="button default small" onClick={cancelUpload}
                            disabled={(progress as Progress & {canceling?: boolean}).canceling}>Cancel</button>
                </div>)}
            {unsent && (
                <div class="status text-danger" id="add-failed">{unsent.text}{" "}
                    <button type="button" class="button default small"
                            onClick={() => !uploading && addImages(unsent.files)}>Send them again</button></div>)}

            <Overview d={d}/>

            {hasTabs && (<>
                <div class="tabs" role="tablist">
                    {TABS.filter(([key]) => key === "convert" || a?.files).map(([key, label]) => (
                        <a key={key} href={"#" + key} role="tab" aria-selected={tab === key} class={tab === key ? "active" : ""}
                           data-tab={key} onClick={(e) => { e.preventDefault(); setChosen(key); }}>
                            {label}{badges[key] !== "" && <> <span class="badge">{badges[key]}</span></>}</a>))}
                </div>
                {a?.files && tab === "files" && <FilesTab analysis={a} view={view} setView={setView} frames={frames}
                                                          thumbs={url + "/thumbnail?file="} zone={d.flight_zone}/>}
                {a?.files && tab === "problems" && <ProblemsTab analysis={a} showFile={showFile}/>}
                {a?.files && tab === "webodm" && <PlanTab analysis={a} convert={convertWithPlan}/>}
                {/* Kept mounted, hidden: its form keeps what was typed while another tab is open */}
                <div ref={convertRef} hidden={tab !== "convert"}>
                    <ConvertTab api={api} publicUrl={publicUrl} dataset={d} onChange={load} planRequest={planRequest}
                                prefill={prefill}/>
                </div>
            </>)}
        </div>
    );
}
