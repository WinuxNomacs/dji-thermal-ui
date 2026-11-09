// A project's import: an archive exported from a project page, sent in pieces (the server unpacks them as they come)
// and made into a new project. Its manifest comes first, so the project's name is known early: a name in use gets a
// free one ("Roof (2)"), which can be changed, and the import waits for a name no project has.
import {useEffect, useLayoutEffect, useRef, useState} from "preact/hooks";
import {csrfToken, errorText, readJson, sendJson} from "../core/api";
import {count, formatBytes} from "../core/format";
import {navigationChanged} from "../core/navigation";
import {Upload} from "../components/icons";

export const PIECE = 16 * 1024 * 1024;  // bytes a request (the server takes 1 GB at most)
const RETRIES = 2;                      // a piece that fails is sent again this many times
const UNANSWERED = "The app did not answer: is it still running?";

// The archive's project as the server read it from the manifest
export interface ArchiveProject {
    name: string;
    proposed: string;
    flights: {name: string; file_count: number; conversions: number}[];
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Sends an archive to an import made for it, a piece at a time (one the server already has in part is sent from where
// it stopped): onProgress hears the bytes received and the project once known. Throws with the server's reason.
export async function sendArchive(fetchFn: Fetch, url: string, csrf: string, file: Blob,
                                  onProgress: (received: number, project: ArchiveProject | null) => void,
                                  signal?: AbortSignal, piece = PIECE): Promise<void> {
    let offset = 0, failures = 0;
    while (offset < file.size) {
        if (signal?.aborted) throw new Error("canceled");
        let res: Response;
        try {
            res = await fetchFn(url + "?offset=" + offset, {
                method: "PUT", credentials: "same-origin", signal,
                headers: {"Content-Type": "application/octet-stream", "X-CSRFToken": csrf},
                body: file.slice(offset, Math.min(offset + piece, file.size)),
            });
        } catch (e) {
            if (signal?.aborted || ++failures > RETRIES) throw e;
            continue;
        }
        const r = await readJson<{received?: number; project?: ArchiveProject | null; error?: string}>(res);
        if (res.ok || res.status === 409) {
            failures = 0;
            offset = r.data.received ?? offset;
            if (res.ok) onProgress(offset, r.data.project ?? null);
        } else if (res.status >= 500 && ++failures <= RETRIES) {
            continue;
        } else {
            throw new Error(errorText(r.data, "The archive could not be sent."));
        }
    }
}

interface Props {
    api: string;
    taken: string[];                    // the names of the projects there are
    onClose: () => void;
    onImported: (project: {id: number}) => void;
}

type Stage = "choose" | "sending" | "received" | "importing";

export function ImportDialog({api, taken, onClose, onImported}: Props) {
    const [stage, setStage] = useState<Stage>("choose");
    const [file, setFile] = useState<File | null>(null);
    const [received, setReceived] = useState(0);
    const [project, setProject] = useState<ArchiveProject | null>(null);
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const id = useRef("");
    const named = useRef(false);            // the name proposed was filled in
    const controller = useRef<AbortController | null>(null);
    const stageRef = useRef(stage);
    stageRef.current = stage;

    // Closing stops the import: the pieces in flight are aborted, and what the server unpacked is removed
    function close() {
        controller.current?.abort();
        if (id.current && stageRef.current !== "importing") sendJson(api + "imports/" + id.current, "DELETE");
        id.current = "";
        onClose();
    }

    useLayoutEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && stageRef.current !== "importing") {
                e.preventDefault();
                close();
            }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    // Leaving the page would stop the import half way
    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (stageRef.current !== "sending" && stageRef.current !== "importing") return;
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, []);

    async function choose(f: File | undefined) {
        if (!f) return;
        setFile(f);
        setError("");
        setStage("sending");
        let r;
        try {
            r = await readJson<{id?: string}>(await sendJson(api + "imports", "POST", {size: f.size}));
        } catch {
            setStage("choose");
            return setError(UNANSWERED);
        }
        if (!r.ok || !r.data.id) {
            setStage("choose");
            return setError(errorText(r.data, "Could not start the import."));
        }
        id.current = r.data.id;
        controller.current = new AbortController();
        try {
            const importId = r.data.id;
            await sendArchive((u, i) => fetch(u, i), api + "imports/" + importId, csrfToken(), f, (n, p) => {
                setReceived(n);
                if (p && !named.current) {
                    named.current = true;
                    setName(p.proposed);
                }
                if (p) setProject(p);
            }, controller.current.signal);
            setStage("received");
        } catch (e) {
            if (controller.current?.signal.aborted) return;
            id.current = "";
            setStage("choose");
            setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message
                : "The archive could not be sent: is the app still running?");
        }
    }

    const trimmed = name.trim();
    const inUse = taken.includes(trimmed);
    async function save() {
        if (stage !== "received" || !trimmed || inUse) return;
        setStage("importing");
        setError("");
        let r;
        try {
            r = await readJson<{id?: number}>(await sendJson(api + "imports/" + id.current, "POST", {name: trimmed}));
        } catch {
            setStage("received");
            return setError(UNANSWERED);
        }
        if (r.ok && r.data.id) {
            id.current = "";
            navigationChanged();
            return onImported({id: r.data.id});
        }
        setError(errorText(r.data, "Could not import the project."));
        // A name taken meanwhile can be changed; otherwise the import is over, and the archive is chosen again
        if (r.data && "name" in r.data) return setStage("received");
        id.current = "";
        setStage("choose");
    }

    const pct = file && file.size ? Math.floor(received / file.size * 100) : 0;
    return (
        <div class="dialog" id="import-project" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            <div class="dialog-inner" role="dialog" aria-modal="true" aria-labelledby="import-title">
                <h2 id="import-title">Import project</h2>
                <p>An archive exported from a project's page (.tar) becomes a new project, with its flights, datasets,
                    mosaics, measurements and findings.</p>
                <div class="field">
                    <input type="file" id="import-file" accept=".tar,application/x-tar" aria-label="Project archive"
                           disabled={stage !== "choose"} onChange={(e) => choose(e.currentTarget.files?.[0])}/>
                </div>
                {project && (<div id="import-archive">
                    <p>“{project.name}”, with {count(project.flights.length, "flight", "flights")}{project.flights.length ? ":" : "."}</p>
                    {project.flights.length > 0 && <ul class="import-flights">{project.flights.map((f, i) => (
                        <li key={i}>{f.name} <span class="text-muted">({count(f.file_count, "image", "images")},{" "}
                            {count(f.conversions, "dataset", "datasets")})</span></li>))}</ul>}
                    <div class={"field" + (inUse ? " has-error" : "")}>
                        <label for="import-name">Name</label>
                        <input type="text" id="import-name" value={name} maxLength={255}
                               disabled={stage === "importing"} onInput={(e) => setName(e.currentTarget.value)}/>
                        {inUse ? <p class="field-error" id="import-name-help">A project is already named
                                “{trimmed}”: choose another name.</p>
                            : project.proposed !== project.name &&
                            <p class="help" id="import-name-help">A project is already named “{project.name}”, so this
                                one gets another name.</p>}
                    </div>
                </div>)}
                {(stage === "sending" || stage === "received") && file && (
                    <div class="upload-progress" id="import-progress">
                        <div class="progress"><div class="progress-bar" style={{width: pct + "%"}}/></div>
                        <span id="import-progress-text">{stage === "received" ? "Received " + formatBytes(file.size) + "."
                            : "Sending " + formatBytes(received) + " of " + formatBytes(file.size) + " (" + pct + "%)"}</span>
                    </div>
                )}
                {stage === "importing" && <p class="text-muted" id="import-progress-text">Importing…</p>}
                <div class="error" id="import-error" role="alert">{error}</div>
                <div class="dialog-actions">
                    <button type="button" class="button default" id="import-cancel" disabled={stage === "importing"}
                            onClick={close}>Cancel</button>
                    <button type="button" class="button primary" id="import-save"
                            disabled={stage !== "received" || !trimmed || inUse} onClick={save}>
                        <Upload/> Import</button>
                </div>
            </div>
        </div>
    );
}
