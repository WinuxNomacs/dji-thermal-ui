// New Dataset: a name, and the images to upload, chosen one by one or as a folder. Uploading makes the dataset
// first, then sends its images; when some could not be sent it stops, to send them again, analyze
// without them, or cancel (which deletes the dataset with the images sent so far).
import {useEffect, useRef, useState} from "preact/hooks";
import {csrfToken, errorText, readJson, sendJson} from "../core/api";
import {count, failedText, formatBytes} from "../core/format";
import {FLIGHT_FILES_ACCEPT, flightFilesText, isFlightFile, type Progress, uploadFiles} from "../core/upload";
import {ask} from "../components/dialog";
import {Folder, Images} from "../components/icons";

// "idle"; "working" (creating, or starting the analysis: nothing to press); "uploading"; or "failed" (some images
// could not be sent)
export type Stage = "idle" | "working" | "uploading" | "failed";

interface Made {
    dataset: {id: number};
    saved: number;
    failed: File[];
    controller?: AbortController;
    sending?: Promise<unknown>;
}

interface Props {
    api: string;
    publicUrl: string;
    project: number;                            // the project it is made in
    nav: (url: string) => void;
    dropped: {files: File[]} | null;           // files dropped on the page, a new object for each drop
    onStage: (stage: Stage) => void;
    onClose: () => void;
    onError: (text: string) => void;           // for the page: what went wrong after the dialog closed
    load: () => void;                           // loads the list again
}

const HINT = "The R-JPEGs of a flight (the _T.JPG files). Visible images can be included: they are listed, not analyzed.";

// What is said when files were chosen but none is an image a flight takes (TIFFs, a converted dataset's outputs...)
export function noImagesText(files: File[]): string {
    return "None of the " + count(files.length, "file", "files") + " chosen is a JPEG or an MP4: a flight is made of " +
        "a DJI drone's R-JPEGs (the _T.JPG files) and its videos, and other files (TIFFs among them) are left out.";
}

export function NewDataset({api, publicUrl, project, nav, dropped, onStage, onClose, onError, load}: Props) {
    const [name, setName] = useState("");
    const [chosen, setChosen] = useState<File[]>([]);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState<Progress | null>(null);
    const [stage, setStageState] = useState<Stage>("idle");
    // Read by what an upload does once it ends, after a render or two
    const stageRef = useRef<Stage>("idle");
    const made = useRef<Made | null>(null);

    function setStage(s: Stage) {
        stageRef.current = s;
        setStageState(s);
        onStage(s);
    }

    function close() {
        made.current = null;
        setStage("idle");
        onClose();
    }

    function choose(files: File[]) {
        setChosen(files);
        const images = files.filter(isFlightFile);
        setError(files.length && !images.length ? noImagesText(files) : "");
        if (images.length) {
            setName((n) => n || images[0].webkitRelativePath.split("/")[0] || "Thermal flight");
        }
    }

    useEffect(() => {
        if (!dropped) return;
        choose(dropped.files);
    }, [dropped]);

    // Leaving the page would stop the upload half way
    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (stageRef.current !== "uploading") return;
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, []);

    // Cancel: before the dataset exists, closes the dialog; once it does, deletes it with the images sent so far
    async function cancel() {
        if (stageRef.current === "idle") return close();
        if (stageRef.current !== "uploading" && stageRef.current !== "failed") return;
        const m = made.current!;
        const yes = await ask("Cancel the new flight?", ["The images sent so far are deleted with the flight."],
                              "Delete it", "danger");
        // The upload may have ended while the question was asked
        if (!yes || made.current !== m || (stageRef.current !== "uploading" && stageRef.current !== "failed")) return;
        setStage("working");
        m.controller?.abort();
        // Deleted once its requests have settled, so that none saves an image after it
        try {
            await m.sending;
            const r = await readJson(await sendJson(api + "datasets/" + m.dataset.id, "DELETE"));
            if (!r.ok) onError(errorText(r.data, "Could not delete the canceled flight."));
        } catch {
            onError("Could not delete the canceled flight.");
        }
        close();
        load();
    }

    // Opened even when the analysis could not start: its page says so and can start it again
    async function analyze() {
        setStage("working");
        const id = made.current!.dataset.id;
        try {
            await sendJson(api + "datasets/" + id + "/analyze", "POST", {});
        } catch {
            // the dataset's page says it is not analyzed
        }
        stageRef.current = "idle";
        nav(publicUrl + "dataset/" + id);
    }

    // Sends the images to the dataset made: analyzes it when all arrived, or stops and says which did not
    async function sendImages(files: File[]) {
        const m = made.current!;
        setError("");
        setStage("uploading");
        m.controller = new AbortController();
        setProgress({sent: 0, total: files.filter(isFlightFile).length, bytesSent: 0, bytesTotal: 1});
        const sending = uploadFiles((u, i) => fetch(u, i), api + "datasets/" + m.dataset.id + "/upload", csrfToken(),
                                    files, setProgress, {signal: m.controller.signal});
        m.sending = sending;
        const u = await sending;
        if (u.canceled || made.current !== m) return;
        m.saved += u.saved;
        if (!u.failed.length) return analyze();
        m.failed = u.failed;
        setStage("failed");
        setError(failedText(u.failed) + " " + (m.saved ?
            count(m.saved, "image", "images") + " arrived: send the others again, or analyze without them." :
            "None arrived: send them again, or cancel."));
    }

    async function create() {
        const n = name.trim();
        if (!n) return setError("Give the flight a name.");
        if (!chosen.some(isFlightFile)) return setError(chosen.length ? noImagesText(chosen) : "Choose the images to upload.");
        setError("");
        setStage("working");
        try {
            const r = await readJson<{id: number}>(await sendJson(api + "datasets", "POST",
                                                                  {name: n, source: "upload", project}));
            if (!r.ok) throw new Error(errorText(r.data, "Could not create the flight."));
            made.current = {dataset: r.data, saved: 0, failed: []};
            await sendImages(chosen);
        } catch (e) {
            setStage("idle");
            setError((e as Error).message);
            load();
        }
    }

    const images = chosen.filter(isFlightFile);
    const bytes = images.reduce((s, f) => s + f.size, 0);
    const pct = progress && progress.bytesTotal ? Math.round(progress.bytesSent / progress.bytesTotal * 100) : 0;
    const locked = stage !== "idle";

    return (
        <div class="dialog" id="new-dataset">
            <div class="dialog-inner" role="dialog" aria-modal="true" aria-labelledby="new-dataset-title">
                <h2 id="new-dataset-title">New thermal flight</h2>
                <div class="field">
                    <label for="new-name">Name</label>
                    <input type="text" id="new-name" maxLength={255} value={name} disabled={locked}
                           onInput={(e) => setName(e.currentTarget.value)}/>
                </div>
                <div class="field" id="new-upload">
                    <div class="pickers">
                        <label class={"button default" + (locked ? " disabled" : "")}><Images/> Choose images
                            <input type="file" id="new-files" multiple accept={FLIGHT_FILES_ACCEPT} hidden
                                   disabled={locked}
                                   onChange={(e) => choose(Array.from(e.currentTarget.files || []))}/></label>
                        <label class={"button default" + (locked ? " disabled" : "")}><Folder/> Choose a folder
                            <input type="file" id="new-dir" hidden disabled={locked}
                                   {...{webkitdirectory: true}}
                                   onChange={(e) => choose(Array.from(e.currentTarget.files || []))}/></label>
                    </div>
                    <p class="help" id="new-chosen">
                        {chosen.length ? flightFilesText(images) + ", " + formatBytes(bytes) +
                            (chosen.length > images.length ?
                                " (" + (chosen.length - images.length) + " other file(s) left out)" : "") : HINT}
                    </p>
                </div>
                {progress && (
                    <div class="upload-progress" id="new-progress">
                        <div class="progress"><div class="progress-bar" style={{width: pct + "%"}}/></div>
                        <span id="new-progress-text">
                            Uploading {progress.sent} of {progress.total} images ({pct}%)
                        </span>
                    </div>
                )}
                <div class="error" id="new-error" role="alert">{error}</div>
                <div class="dialog-actions">
                    <button type="button" class="button default" id="new-cancel" disabled={stage === "working"}
                            onClick={cancel}>Cancel</button>
                    {stage === "failed" && made.current?.saved ? (
                        <button type="button" class="button default" id="new-without"
                                onClick={() => stageRef.current === "failed" && analyze()}>
                            Analyze without them</button>) : null}
                    {stage === "failed" && (
                        <button type="button" class="button primary" id="new-retry"
                                onClick={() => stageRef.current === "failed" && sendImages(made.current!.failed)}>
                            Send them again</button>)}
                    {stage !== "failed" && (
                        <button type="button" class="button primary" id="new-create" disabled={locked}
                                onClick={create}>Create</button>)}
                </div>
            </div>
        </div>
    );
}
