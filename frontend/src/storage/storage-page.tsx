// System Settings › Storage: where the data folder is, and its size on disk as measured now (when the page opens, and
// again on asking): each project with its flights, the database, files left behind and the rest. A folder flight's
// images are read where they are: they are said apart, outside the data folder's total. The folder can be moved to
// another: checked first, then moved by the server as it restarts (move.py), the projects of a data folder there
// imported as chosen.
import {useEffect, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {count, formatBytes} from "../core/format";
import {ask} from "../components/dialog";
import {Refresh} from "../components/icons";

export interface StorageFlight {id: number; name: string; size: number; files: number; in_place: number | null}
export interface StorageProject {id: number; name: string; size: number; flights: StorageFlight[]}
export interface Storage {
    path: string; total: number; free: number | null; database: number; other: number; left_behind: number;
    projects: StorageProject[];
    set_by?: "environment" | "moved" | "default";
    last_move?: LastMove | null;
}

// What moving the data folder to a folder would do (api/storage/check), and what stops it
export interface MoveCheck {
    path: string; kind: "new" | "empty" | "data" | "other" | "file" | null; same_drive: boolean; needed: number;
    free: number | null; projects: {id: number; name: string; flights: number; size: number}[]; problems: string[];
}

// How the last move went, as the server wrote it once restarted
export interface LastMove {
    state: "moved" | "failed"; from: string; to: string; replaced: string | null; at: number;
    imported: {name: string; flights: number}[]; error: string | null; left_behind?: string | null;
}

// A line of the table: a project, one of its flights, or a part of the folder that is no project's
export interface Row {kind: "project" | "flight" | "part"; key: string; label: string; size: number; href?: string; note?: string}

// The table's lines: the projects, largest first, each followed by its flights (largest first); then the database,
// files left behind by flights no longer there (when there are any) and the rest
export function storageRows(s: Storage, publicUrl: string): Row[] {
    const bySize = <T extends {size: number; name: string}>(a: T, b: T) => b.size - a.size || a.name.localeCompare(b.name);
    const rows: Row[] = [];
    for (const p of [...s.projects].sort(bySize)) {
        rows.push({kind: "project", key: "p" + p.id, label: p.name || "(untitled)", size: p.size,
                   href: publicUrl + "project/" + p.id, note: count(p.flights.length, "flight", "flights")});
        for (const f of [...p.flights].sort(bySize)) {
            rows.push({kind: "flight", key: "f" + f.id, label: f.name || "(untitled)", size: f.size,
                       href: publicUrl + "dataset/" + f.id,
                       note: f.in_place !== null ? "images read in place: " + formatBytes(f.in_place) + ", not counted"
                           : count(f.files, "file", "files")});
        }
    }
    rows.push({kind: "part", key: "database", label: "Database", size: s.database});
    if (s.left_behind) rows.push({kind: "part", key: "left", label: "Left behind", size: s.left_behind,
                                  note: "files of flights no longer in any project"});
    rows.push({kind: "part", key: "other", label: "Other", size: s.other, note: "the secret key and anything else in the folder"});
    return rows;
}

// A part's share of the total, as shown: "42%", "<1%" for a part too small to show, "" for nothing
export function share(size: number, total: number): string {
    if (!size || !total) return "";
    const pct = size / total * 100;
    return pct < 1 ? "<1%" : Math.round(pct) + "%";
}

// What a check found, said: what the folder holds and how the files get there
export function checkText(c: MoveCheck): string[] {
    const out: string[] = [];
    if (c.kind === "new") out.push("There is no such folder yet: it will be made.");
    if (c.kind === "empty") out.push("The folder is empty.");
    if (c.kind === "data") out.push("It holds another data folder of this app, with " +
        count(c.projects.length, "project", "projects") + ". What it holds is set aside in a replaced-<date> folder " +
        "there, nothing deleted; the projects chosen below are imported from it.");
    out.push(c.same_drive ? "It is on the same drive: the files are moved, not copied."
        : "It is on another drive: " + formatBytes(c.needed) + " are copied there" +
          (c.free !== null ? " (" + formatBytes(c.free) + " free)" : "") + ", then removed from here.");
    return out;
}

// The last move, said
export function lastMoveText(m: LastMove): string[] {
    if (m.state !== "moved") return ["The data folder was not moved to " + m.to + ": " + (m.error || "unknown error")];
    const out = ["The data folder was moved from " + m.from + " to " + m.to + "."];
    if (m.imported.length) out.push("Imported: " + m.imported.map((p) =>
        p.name + " (" + count(p.flights, "flight", "flights") + ")").join(", ") + ".");
    if (m.error) out.push("Not all the projects chosen could be imported: " + m.error);
    if (m.left_behind) out.push(m.left_behind + ". What is left of " + m.from + " is no longer used: it can be deleted.");
    if (m.replaced) out.push("What the folder held before is set aside in " + m.replaced +
        (m.imported.length ? ", but for the files of the projects imported." : "."));
    return out;
}

// Waits for the server to be back from moving the folder (its last move newer than when it was asked), then reloads
export async function waitForMove(api: string, since: number, reload: () => void, every = 1000): Promise<void> {
    for (;;) {
        await new Promise((r) => setTimeout(r, every));
        try {
            const r = await readJson<Storage>(await fetch(api + "storage", {credentials: "same-origin"}));
            if (r.ok && r.data.last_move && r.data.last_move.at >= since) return reload();
        } catch {
            // the server is restarting
        }
    }
}

function MoveFolder({api, setBy, reload}: {api: string; setBy?: Storage["set_by"]; reload: () => void}) {
    const [path, setPath] = useState("");
    const [found, setFound] = useState<MoveCheck | null>(null);
    const [chosen, setChosen] = useState<Set<number>>(new Set());
    const [busy, setBusy] = useState(false);
    const [moving, setMoving] = useState("");
    const [error, setError] = useState("");

    if (setBy === "environment") return (<section class="storage-move" id="storage-move">
        <h2>Move the data folder</h2>
        <p class="text-muted" id="move-set-by">The data folder is set by the command's --data-dir or by
            DJI_THERMAL_UI_DATA_DIR: to move it, change it there.</p>
    </section>);

    async function check(e?: Event) {
        e?.preventDefault();
        setBusy(true);
        setError("");
        try {
            const r = await readJson<MoveCheck>(await sendJson(api + "storage/check", "POST", {path: path.trim()}));
            if (r.ok) {
                setFound(r.data);
                setChosen(new Set(r.data.projects.map((p) => p.id)));
            } else {
                setFound(null);
                setError(errorText(r.data, "Could not check the folder."));
            }
        } catch {
            setError("Could not check the folder.");
        } finally {
            setBusy(false);
        }
    }

    async function moveIt() {
        if (!found) return;
        const ok = await ask("Move the data folder?", [
            "To " + found.path + ".",
            "The server stops while the files move, then starts again from there: this page reloads when it is back. " +
            "A large folder moved to another drive takes a while."], "Move", "primary");
        if (!ok) return;
        setBusy(true);
        setError("");
        const since = Date.now() / 1000 - 1;
        try {
            const r = await readJson<MoveCheck>(await sendJson(api + "storage/move", "POST",
                                                               {path: found.path, projects: [...chosen]}));
            if (r.ok) {
                setMoving(found.path);
                await waitForMove(api, since, reload);
                return;
            }
            if (r.data.problems) setFound(r.data);
            else setError(errorText(r.data, "Could not move the data folder."));
        } catch {
            setError("Could not move the data folder.");
        }
        setBusy(false);
    }

    const ready = found !== null && found.problems.length === 0 && !busy;
    return (<section class="storage-move" id="storage-move">
        <h2>Move the data folder</h2>
        <p class="text-muted">Type the full path of a folder on this computer: a new one, an empty one, or another data
            folder of this app, whose projects can be imported.</p>
        <form class="move-form" onSubmit={check}>
            <label for="move-path" class="sr-only">New folder</label>
            <input type="text" id="move-path" value={path} placeholder="/path/to/the/new/folder" disabled={!!moving}
                   onInput={(e) => { setPath((e.target as HTMLInputElement).value); setFound(null); }}/>
            <button type="submit" class="button default" id="check-folder" disabled={busy || !path.trim()}>Check</button>
        </form>
        {error && <div class="notice error" role="alert">{error}</div>}
        {found && found.problems.length > 0 && <div class="notice error" role="alert" id="move-problems">
            {found.problems.map((p) => <p>{p}</p>)}</div>}
        {found && found.problems.length === 0 && <div id="move-check">
            {checkText(found).map((t) => <p>{t}</p>)}
            {found.projects.length > 0 && <ul class="move-projects" id="move-projects">
                {found.projects.map((p) => <li key={p.id}><label>
                    <input type="checkbox" checked={chosen.has(p.id)} onChange={() => {
                        const next = new Set(chosen);
                        if (!next.delete(p.id)) next.add(p.id);
                        setChosen(next);
                    }}/> {p.name} <span class="text-muted">{count(p.flights, "flight", "flights")},
                    {" " + formatBytes(p.size)}</span></label></li>)}
            </ul>}
            {moving ? <div class="notice" role="status" id="moving">Moving the data folder to {moving}: the server
                    is restarting, and this page reloads when it is back.</div>
                : <button type="button" class="button primary" id="move-folder" disabled={!ready} onClick={moveIt}>
                    Move the data folder</button>}
        </div>}
    </section>);
}

export function StoragePage({api, publicUrl, reload = () => location.reload()}:
                            {api: string; publicUrl: string; reload?: () => void}) {
    const [storage, setStorage] = useState<Storage | null>(null);
    const [measuring, setMeasuring] = useState(false);
    const [error, setError] = useState("");

    async function measure() {
        setMeasuring(true);
        try {
            const r = await readJson<Storage>(await fetch(api + "storage", {credentials: "same-origin"}));
            setError(r.ok ? "" : "Could not measure the data folder.");
            if (r.ok) setStorage(r.data);
        } catch {
            setError("Could not measure the data folder.");
        } finally {
            setMeasuring(false);
        }
    }

    useEffect(() => { measure(); }, []);

    const s = storage;
    return (<div class="page storage">
        <div class="page-header">
            <h1>Storage</h1>
            <div class="page-actions">
                <button type="button" class="button default" id="measure" disabled={measuring} onClick={measure}>
                    <Refresh/> Measure again</button>
            </div>
        </div>
        {error && <div class="notice error" role="alert">{error}</div>}
        {s?.last_move && <div class={"notice" + (s.last_move.state === "moved" ? "" : " error")} id="last-move">
            {lastMoveText(s.last_move).map((t) => <p>{t}</p>)}
            <button type="button" class="button default" id="dismiss-move" onClick={async () => {
                await sendJson(api + "storage/move", "DELETE");
                setStorage({...s, last_move: null});
            }}>Dismiss</button>
        </div>}
        {!s ? <div class="message" id="message">{measuring ? "Measuring the data folder…" : ""}</div> : (<>
            <section class="storage-folder">
                <h2>Data folder</h2>
                <p><code id="data-path">{s.path}</code></p>
                <p id="storage-total">{formatBytes(s.total)} on disk
                    {s.free !== null && <>; {formatBytes(s.free)} free on its drive</>}.</p>
            </section>
            <div class="table-scroll">
                <table class="table storage-table" id="storage-table">
                    <thead><tr><th>Project, flight or part</th><th class="num">Size</th><th class="num">Share</th>
                        <th><span class="sr-only">About</span></th></tr></thead>
                    <tbody>{storageRows(s, publicUrl).map((r) => (
                        <tr key={r.key} class={"storage-" + r.kind} data-key={r.key}>
                            <td>{r.href ? <a href={r.href}>{r.label}</a> : r.label}</td>
                            <td class="num">{formatBytes(r.size)}</td>
                            <td class="num">{r.kind === "flight" ? "" : share(r.size, s.total)}</td>
                            <td class="text-muted">{r.note || ""}</td>
                        </tr>))}</tbody>
                    <tfoot><tr><th>Total</th><th class="num" id="storage-sum">{formatBytes(s.total)}</th><th/><th/></tr></tfoot>
                </table>
            </div>
            <MoveFolder api={api} setBy={s.set_by} reload={reload}/>
        </>)}
    </div>);
}
