// A dataset's report as the page lays it out, from the dataset and its findings: the text typed on it (or what fills
// it in), the frames' settings and temperatures summed up, the findings numbered, and the files their thumbnails are
// of. Plain functions, no DOM.
import {formatNumber, median} from "../core/format";
import {formatTemp} from "../core/units";
import {type FileRow} from "../dataset/files";

// What is saved on the dataset (its "report"), each field typed on the page
export interface ReportText {title?: string; author?: string; date?: string; notes?: string; appendix?: boolean}

// The text shown: what was saved, else the dataset's name, the author last typed and today
export function reportText(saved: ReportText | undefined, name: string, author: string, today: string): Required<ReportText> {
    const s = saved || {};
    return {title: s.title ?? name, author: s.author ?? author, date: s.date ?? today, notes: s.notes ?? "",
            appendix: !!s.appendix};
}

// Today in the computer's time, as the date field has it: "2026-10-28"
export function todayText(now = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
}

export const thermalFrames = (files: FileRow[] | undefined): FileRow[] => (files || []).filter((f) => f.kind === "thermal");

const present = (v: unknown): v is number => typeof v === "number" && !isNaN(v);

// A setting the frames record, and how a value of it is shown
export interface Setting {key: keyof FileRow & string; label: string; show: (v: number) => string}

export const SETTINGS: Setting[] = [
    {key: "emissivity", label: "Emissivity", show: (v) => formatNumber(v, 2)},
    {key: "distance", label: "Object distance", show: (v) => formatNumber(v, 1, " m")},
    {key: "humidity", label: "Relative humidity", show: (v) => formatNumber(v, 0, " %")},
    {key: "reflection", label: "Reflected temperature", show: (v) => formatTemp(v, "C", 1)},
    {key: "ambient", label: "Ambient temperature", show: (v) => formatTemp(v, "C", 1)},
];

export interface SettingValues {setting: Setting; values: {text: string; frames: number}[]; missing: number}

// Each setting's values across the frames, the most frames first, with how many frames do not record it; settings no
// frame records are left out
export function settingsSummary(files: FileRow[] | undefined): SettingValues[] {
    const frames = thermalFrames(files);
    return SETTINGS.map((setting) => {
        const counts = new Map<string, number>();
        let missing = 0;
        frames.forEach((f) => {
            const v = f[setting.key];
            if (!present(v)) { missing++; return; }
            const text = setting.show(v);
            counts.set(text, (counts.get(text) || 0) + 1);
        });
        const values = [...counts].map(([text, n]) => ({text, frames: n}))
            .sort((a, b) => b.frames - a.frames || a.text.localeCompare(b.text, undefined, {numeric: true}));
        return {setting, values, missing};
    }).filter((s) => s.values.length);
}

export interface TemperatureRow {label: string; lowest: number; median: number; highest: number}

// The frames' own lowest, highest and mean temperatures (°C), each as its lowest, median and highest across the frames
export function temperatureSummary(files: FileRow[] | undefined): TemperatureRow[] {
    const frames = thermalFrames(files);
    const rows: [keyof FileRow & string, string][] = [["tmin", "Frame minimum"], ["tmean", "Frame mean"], ["tmax", "Frame maximum"]];
    return rows.flatMap(([key, label]) => {
        const v = frames.map((f) => f[key]).filter(present);
        return v.length ? [{label, lowest: Math.min(...v), median: median(v)!, highest: Math.max(...v)}] : [];
    });
}

// Where each frame was taken (lon, lat)
export function framePositions(files: FileRow[] | undefined): [number, number][] {
    return thermalFrames(files).filter((f) => present(f.lon) && present(f.lat)).map((f) => [f.lon!, f.lat!]);
}

// The dataset's file a frame name is (a mosaic names its frames as converted: the same path, maybe another extension),
// for its thumbnail; null when the analysis lists none
export function fileOf(frame: string, files: FileRow[] | undefined): string | null {
    const paths = (files || []).map((f) => f.path);
    if (paths.includes(frame)) return frame;
    const stem = (p: string) => p.replace(/\.[^./\\]+$/, "").toLowerCase();
    return paths.find((p) => stem(p) === stem(frame)) || null;
}

// The findings in the order they were saved, numbered from 1 in the table and on the map alike
export function numbered<T extends {id: number}>(findings: T[]): (T & {number: number})[] {
    return findings.slice().sort((a, b) => a.id - b.id).map((f, i) => ({...f, number: i + 1}));
}
