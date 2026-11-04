// The frames of a dataset that is a visual mosaic alone (a flight without thermal frames): its visual photos, each shown
// as it was taken, with the explorer's list, ← and → and what the drone recorded, and no temperatures to colour or
// measure. The frame page (frame-page) shows it instead of its own once the frames are loaded.
import {useEffect, useState} from "preact/hooks";
import {formatCapture, formatNumber, zoneText} from "../core/format";
import {ArrowLeft, ChevronLeft, ChevronRight, Image} from "../components/icons";
import {inField} from "../measure/drawing";
import {captureOrder, FRAME_LISTS, type FrameEntry, inMosaics, listFrames, listTitle} from "./frame";
import {FrameList} from "./frame-list";
import type {Frames} from "./frame-page";
import {viewQuery} from "../viewer/view";

const PHOTO_PX = 1600;      // the photo shown, at most this many pixels across

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    datasetId: number;
    datasetName: string;
    meta: Frames;
}

export function VisualFrames({api, publicUrl, id, datasetId, datasetName, meta}: Props) {
    const base = api + "conversions/" + id;
    const all = captureOrder(meta.frames || []);
    const [list, setList] = useState(() => {
        const wanted = new URLSearchParams(location.search).get("list");
        return all.some(inMosaics) && listFrames(all, wanted).length ? wanted : null;
    });
    const frames = listFrames(all, list);
    const [frame, setFrame] = useState<string | null>(() => {
        const wanted = new URLSearchParams(location.search).get("frame");
        return frames.find((f) => f.path === wanted)?.path ?? frames[0]?.path ?? null;
    });
    const at = frames.findIndex((f) => f.path === frame);
    const entry: FrameEntry | undefined = frames[at];

    function step(by: number) {
        const next = frames[at + by];
        if (next) setFrame(next.path);
    }

    function chooseList(next: string | null) {
        const listed = listFrames(all, next);
        setList(next);
        if (listed.length && !listed.some((f) => f.path === frame)) setFrame(listed[0].path);
    }

    // ← and → step through the frames (not while typing)
    useEffect(() => {
        const keys = (e: KeyboardEvent) => {
            if (inField(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            step(e.key === "ArrowLeft" ? -1 : 1);
        };
        document.addEventListener("keydown", keys);
        return () => document.removeEventListener("keydown", keys);
    }, [frame, list]);

    // The frame and the list in the URL, so that a reload or a copied link keeps them
    useEffect(() => {
        if (!frame) return;
        const q = viewQuery({frame});
        history.replaceState(null, "", location.pathname + q + (list ? (q ? "&" : "?") + "list=" + encodeURIComponent(list) : ""));
    }, [frame, list]);

    const photo = (size: number) => base + "/frame/visual?frame=" + encodeURIComponent(frame || "") + (size ? "&size=" + size : "");
    const recorded = entry?.recorded || {};
    const rows: [string, string][] = entry ? [
        ["Taken", entry.time ? formatCapture(entry.time) + " (" + zoneText(meta.flight_zone) + ")" : ""],
        ["Position", entry.lat !== null && entry.lat !== undefined && entry.lon !== null && entry.lon !== undefined ?
            formatNumber(entry.lat, 6) + ", " + formatNumber(entry.lon, 6) : ""],
        ["Height above take-off", formatNumber(recorded.alt, 1, " m")],
        ["Gimbal pitch", formatNumber(entry.pitch, 1, "°")],
        ["In the mosaic", inMosaics(entry) ? "frame " + (entry.mosaic! + 1) : meta.mosaic_status === "ready" ? "no" : ""],
    ].filter(([, v]) => v) as [string, string][] : [];

    return (
        <div class="page frame visual-alone">
            <div class="breadcrumb">
                <a href={publicUrl + "dataset/" + datasetId + "#datasets"}><ArrowLeft/> {datasetName}</a>
                {" · "}
                <a id="mosaics" href={publicUrl + "conversion/" + id}>The mosaic</a>
            </div>
            <div class="page-header">
                <div>
                    <h1 id="name">{meta.name}: {listTitle(list)}</h1>
                    <div class="subtitle">{meta.description || ""}</div>
                </div>
            </div>
            {!frames.length ? <div class="status text-muted" id="status">The flight has no visual frames to show.</div> :
            <div class="frame-main">
                <div class="frame-chooser">
                    <button type="button" class="button default small" id="prev" title="Previous frame" disabled={at <= 0}
                            onClick={() => step(-1)}><ChevronLeft/></button>
                    <button type="button" class="button default small" id="next" title="Next frame" disabled={at >= frames.length - 1}
                            onClick={() => step(1)}><ChevronRight/></button>
                    <strong id="frame" title={frame || ""}>{(frame || "").split("/").pop()}</strong>
                    <span class="message" id="about">{[entry?.time ? formatCapture(entry.time) + " (" + zoneText(meta.flight_zone) + ")" : "",
                        entry && inMosaics(entry) ? "frame " + (entry.mosaic! + 1) + " of the mosaic" : ""].filter(Boolean).join(" · ")}</span>
                </div>
                <div class="viewer-body">
                    <FrameList frames={frames} frame={frame} choose={setFrame} list={list} maxPitch={meta.max_pitch}
                               sizes={all.some(inMosaics) ? FRAME_LISTS.map(([l]) => listFrames(all, l).length) : undefined}
                               chooseList={chooseList} built={meta.mosaic_status === "ready"}
                               thumbs={api + "datasets/" + datasetId + "/thumbnail?file="}/>
                    <div class="frame-panes">
                        <div class="frame-pane">
                            <div class="frame-pane-title">As taken</div>
                            <div class="frame-photo">{frame && <img id="photo" src={photo(PHOTO_PX)} alt={frame}/>}</div>
                        </div>
                    </div>
                    <div class="viewer-panel">
                        <p class="hint">The visual camera's photo, as it was taken: the flight has no thermal images, so it has no
                            temperatures to read or measure.</p>
                        <table class="table values" id="recorded"><tbody>
                            {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
                        </tbody></table>
                        <a class="button default small" id="full-size" href={photo(0)} target="_blank" rel="noopener">
                            <Image/> Full size</a>
                    </div>
                </div>
            </div>}
        </div>
    );
}
