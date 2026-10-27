// The datasets list's data: a dataset as the API sums it up, what each column sorts by, the search, and the files
// dropped on the page
import {statusLabel} from "../core/format";

export interface Dataset {
    id: number;
    name: string;
    source: "upload" | "folder";
    folder?: string | null;
    status: string;
    progress?: number | null;
    error?: string;
    busy?: boolean;                 // a conversion or a mosaic of it being made
    file_count: number;
    size: number;
    thermal?: number;
    not_thermal?: number;
    errors?: number;
    warnings?: number;
    analyzed?: boolean;
    conversion_count?: number;
    conversions_ready?: number;
    mosaic_count?: number;
    measurement_count?: number;
    finding_count?: number;
    last_activity?: string | null;
    created_at?: string | null;
}

export function filesCell(d: Dataset): string {
    if (!d.analyzed || d.status === "new") return String(d.file_count);
    let text = d.thermal + " thermal";
    if (d.not_thermal) text += " · " + d.not_thermal + " other";
    return text;
}

// What each column sorts by; null (nothing to sort by, as before an analysis) goes last either way
type SortValue = string | number | null | undefined;
const SORT_KEYS: Record<string, (d: Dataset) => SortValue> = {
    name: (d) => (d.name || "").toLowerCase(),
    status: (d) => statusLabel(d),
    files: (d) => d.file_count,
    problems: (d) => d.analyzed ? (d.errors || 0) * 1e6 + (d.warnings || 0) : null,
    conversions: (d) => d.conversion_count ? (d.conversions_ready || 0) * 1e6 + d.conversion_count : null,
    findings: (d) => d.finding_count || null,
    size: (d) => d.size,
    activity: (d) => d.last_activity || null,
    created: (d) => d.created_at || null,
};

export function sortDatasets(list: Dataset[], key: string, desc: boolean): Dataset[] {
    const get = SORT_KEYS[key] || SORT_KEYS.created;
    return list.map((d, i) => ({d, v: get(d), i})).sort((a, b) => {
        const an = a.v === null || a.v === undefined, bn = b.v === null || b.v === undefined;
        if (an || bn) return an === bn ? a.i - b.i : (an ? 1 : -1);
        const c = a.v! < b.v! ? -1 : a.v! > b.v! ? 1 : 0;
        return (desc ? -c : c) || a.i - b.i;
    }).map((x) => x.d);
}

// Whether the search (words, any order) is in a dataset's name
export function matchesSearch(d: {name?: string}, query: string): boolean {
    const text = (d.name || "").toLowerCase();
    return String(query || "").toLowerCase().split(/\s+/).every((w) => text.includes(w));
}

// The parts of the File and Directory Entries API a drop gives
interface Entry {isFile: boolean; fullPath: string}
interface FileEntry extends Entry {file(ok: (f: File) => void, err: () => void): void}
interface DirectoryEntry extends Entry {createReader(): {readEntries(ok: (e: Entry[]) => void, err: () => void): void}}
interface Dropped {
    items?: ArrayLike<{webkitGetAsEntry?: () => unknown}>;
    files?: ArrayLike<File>;
}

function read(entry: Entry): Promise<File[]> {
    if (entry.isFile) {
        return new Promise((resolve) => {
            (entry as FileEntry).file((f) => {
                const rel = entry.fullPath.replace(/^\//, "");
                if (rel.indexOf("/") > 0) Object.defineProperty(f, "webkitRelativePath", {value: rel});
                resolve([f]);
            }, () => resolve([]));
        });
    }
    const reader = (entry as DirectoryEntry).createReader();
    let all: Entry[] = [];
    // readEntries gives a folder's entries a part at a time, and nothing once all are given
    const next = async (): Promise<File[]> => {
        const part = await new Promise<Entry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
        if (!part.length) return (await Promise.all(all.map(read))).flat();
        all = all.concat(part);
        return next();
    };
    return next();
}

// The files dropped, with those of the folders dropped read through (their place in it kept as a chosen folder's)
export async function droppedFiles(dataTransfer: Dropped): Promise<File[]> {
    const entries = Array.from(dataTransfer.items || [], (it) => it.webkitGetAsEntry ? it.webkitGetAsEntry() : null);
    if (!entries.length || entries.some((en) => !en)) return Array.from(dataTransfer.files || []);
    return (await Promise.all((entries as Entry[]).map(read))).flat();
}
