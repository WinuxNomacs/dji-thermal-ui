// A project's export: a tar of the project with all its flights or those chosen (each with the size it adds), saved
// by the browser as the server writes it. A flight still being analyzed or converted is not offered.
import {useEffect, useLayoutEffect, useState} from "preact/hooks";
import {formatBytes} from "../core/format";
import {Download} from "../components/icons";

export interface ExportFlight {id: number; name: string; busy: boolean; bytes: number | null; images_missing?: boolean}

interface Props {
    api: string;
    project: {id: number; name: string};
    onClose: () => void;
}

// The archive's address: every flight when all are chosen, so one added meanwhile goes too
export function exportUrl(api: string, project: number, flights: ExportFlight[], chosen: Set<number>): string {
    const url = api + "projects/" + project + "/export.tar";
    return flights.every((f) => chosen.has(f.id)) ? url
        : url + "?flights=" + flights.filter((f) => chosen.has(f.id)).map((f) => f.id).join(",");
}

export function ExportDialog({api, project, onClose}: Props) {
    const [flights, setFlights] = useState<ExportFlight[] | null>(null);
    const [chosen, setChosen] = useState<Set<number>>(new Set());
    const [error, setError] = useState("");

    useLayoutEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(api + "projects/" + project.id + "/export", {credentials: "same-origin"});
                if (!res.ok) throw new Error();
                const list = (await res.json()).flights as ExportFlight[];
                setFlights(list);
                setChosen(new Set(list.filter((f) => !f.busy).map((f) => f.id)));
            } catch {
                setError("Could not list the project's flights.");
            }
        })();
    }, []);

    function toggle(id: number, on: boolean) {
        const next = new Set(chosen);
        if (on) next.add(id); else next.delete(id);
        setChosen(next);
    }

    const offered = (flights || []).filter((f) => !f.busy);
    const total = offered.filter((f) => chosen.has(f.id)).reduce((n, f) => n + (f.bytes || 0), 0);
    const ready = flights !== null && !error;
    const missing = offered.filter((f) => chosen.has(f.id) && f.images_missing).map((f) => f.name);
    return (
        <div class="dialog" id="export-project" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div class="dialog-inner" role="dialog" aria-modal="true" aria-labelledby="export-title">
                <h2 id="export-title">Export project</h2>
                <p>A .tar of “{project.name}” with the flights chosen: their images, datasets, mosaics, measurements
                    and findings. A flight read from a folder has its images copied in.</p>
                {flights === null && !error && <p class="text-muted">Listing the flights…</p>}
                {flights && flights.length === 0 && <p class="text-muted">The project has no flights: only the
                    project itself is exported.</p>}
                {flights && flights.length > 0 && (
                    <ul class="export-flights">
                        {flights.map((f) => (<li key={f.id}>
                            <label class={f.busy ? "text-muted" : ""}>
                                <input type="checkbox" name="export-flight" value={f.id} disabled={f.busy}
                                       checked={!f.busy && chosen.has(f.id)}
                                       onChange={(e) => toggle(f.id, e.currentTarget.checked)}/>
                                {" "}{f.name}
                                <span class="text-muted">{f.busy ? " (busy: still being analyzed or converted)"
                                    : " " + formatBytes(f.bytes)}</span>
                            </label>
                        </li>))}
                    </ul>
                )}
                {ready && offered.length > 0 && <p id="export-total">{chosen.size === 0
                    ? "No flight chosen: only the project itself is exported."
                    : "About " + formatBytes(total) + "."}</p>}
                {missing.length > 0 && <p class="notice warning" id="export-missing">The images of {missing.join(", ")} can't
                    be found, so the archive won't have them. If they are on a drive that isn't connected, connect it
                    before exporting.</p>}
                <div class="error" role="alert">{error}</div>
                <div class="dialog-actions">
                    <button type="button" class="button default" id="export-cancel" onClick={onClose}>Cancel</button>
                    {ready ? (
                        <a class="button primary" id="export-save" download
                           href={exportUrl(api, project.id, flights || [], chosen)} onClick={onClose}>
                            <Download/> Export</a>
                    ) : <button type="button" class="button primary" disabled><Download/> Export</button>}
                </div>
            </div>
        </div>
    );
}
