// System Settings › Storage: where the data folder is, and its size on disk as measured now (when the page opens, and
// again on asking): each project with its flights, the database, files left behind and the rest. A folder flight's
// images are read where they are: they are said apart, outside the data folder's total.
import {useEffect, useState} from "preact/hooks";
import {readJson} from "../core/api";
import {count, formatBytes} from "../core/format";
import {Refresh} from "../components/icons";

export interface StorageFlight {id: number; name: string; size: number; files: number; in_place: number | null}
export interface StorageProject {id: number; name: string; size: number; flights: StorageFlight[]}
export interface Storage {
    path: string; total: number; free: number | null; database: number; other: number; left_behind: number;
    projects: StorageProject[];
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

export function StoragePage({api, publicUrl}: {api: string; publicUrl: string}) {
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
        </>)}
    </div>);
}
