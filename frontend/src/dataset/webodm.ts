// Process in WebODM: what the panel shows and sends (the plan's options and any other WebODM's nodes offer, each typed
// as WebODM types it, and its presets applied to them), and the tasks made, as the conversion's card lists them
import {formatBytes} from "../core/format";

export interface PlanOption {name: string; value: unknown; reason: string; recommended: boolean}
export interface TaskInfo {
    configured: boolean; problems: string[]; warnings: string[]; options: PlanOption[]; frames: number; bytes: number;
    name: string; project_name: string; process_args: string[]; preset: number | null;
}
// An option the processing nodes offer (type: bool, int, float, enum or string; domain: an enum's choices)
export interface NodeOption {name: string; type: string; value: unknown; domain: unknown; help: string}
export interface Preset {id: number; name: string; system: boolean; options: {name: string; value: unknown}[]}
export interface WebODMNode {id: number; label: string; online: boolean}
export interface WebODMProject {id: number; name: string; can_add: boolean}
export interface Choices {nodes: WebODMNode[]; options: NodeOption[]; presets: Preset[]}

export interface WebODMTask {
    id: number; project_id: number | null; project_name: string; task_id: string; name: string; node: string;
    status: string; progress: number; uploaded: number; total: number; error: string; link: string | null;
    check_error?: string;
}

// An option's row in the panel: ticked ones are sent; value is a string, or a boolean for a bool option
export interface OptionRow {
    name: string; on: boolean; value: string | boolean; type: string; domain: string[] | null; help: string;
    reason: string; recommended: boolean;
}

export const FOLLOWED = ["queued", "running"];      // the statuses WebODM is asked about
export const FOLLOW_MS = 5000;

function truthy(v: unknown): boolean { return v === true || String(v).toLowerCase() === "true"; }

// An option's row, typed as the nodes offer it (a plan's option they don't offer is text)
export function optionRow(name: string, value: unknown, offered: NodeOption | undefined,
                          extra: Partial<OptionRow> = {}): OptionRow {
    const type = offered?.type || (typeof value === "boolean" ? "bool" : "string");
    const domain = type === "enum" && Array.isArray(offered?.domain) ? (offered!.domain as unknown[]).map(String) : null;
    return {name, on: true, type, domain, help: offered?.help || "", reason: "", recommended: false,
            value: type === "bool" ? truthy(value) : value === null || value === undefined ? "" : String(value), ...extra};
}

// The plan's options: the recommended ones ticked, those to consider not
export function planRows(plan: PlanOption[], offered: NodeOption[]): OptionRow[] {
    return plan.map((o) => optionRow(o.name, o.value, offered.find((x) => x.name === o.name),
                                     {on: o.recommended, reason: o.reason, recommended: o.recommended}));
}

// A new option's row: WebODM's default value, true for a bool (added to be turned on)
export function addedRow(o: NodeOption): OptionRow {
    return optionRow(o.name, o.type === "bool" ? true : o.value, o);
}

// A preset applied: its options ticked with its values, added when not listed; the others are left as they are
export function applyPreset(rows: OptionRow[], preset: Preset, offered: NodeOption[]): OptionRow[] {
    const out = rows.slice();
    for (const p of preset.options) {
        const i = out.findIndex((r) => r.name === p.name);
        const row = optionRow(p.name, p.value, offered.find((x) => x.name === p.name));
        if (i < 0) out.push(row);
        else out[i] = {...out[i], on: true, value: row.value};
    }
    return out;
}

// What a row's value is sent as, or why it can't be
export function optionValue(r: OptionRow): {value?: boolean | number | string; problem?: string} {
    if (r.type === "bool") return {value: r.value === true};
    const text = String(r.value).trim();
    if (!text) return {problem: r.name + " needs a value"};
    if (r.type === "int" || r.type === "float") {
        const n = Number(text);
        if (isNaN(n) || (r.type === "int" && !Number.isInteger(n))) {
            return {problem: r.name + " is " + (r.type === "int" ? "a whole number" : "a number")};
        }
        return {value: n};
    }
    if (r.domain && !r.domain.includes(text)) return {problem: r.name + " is one of " + r.domain.join(", ")};
    return {value: text};
}

// The ticked options as WebODM takes them, or the first problem
export function sentOptions(rows: OptionRow[]): {options: {name: string; value: unknown}[]; problem: string | null} {
    const options: {name: string; value: unknown}[] = [];
    for (const r of rows.filter((x) => x.on)) {
        const v = optionValue(r);
        if (v.problem) return {options, problem: v.problem};
        options.push({name: r.name, value: v.value});
    }
    return {options, problem: null};
}

const STATUS_LABELS: Record<string, string> = {
    uploading: "Uploading", queued: "Queued in WebODM", running: "Processing in WebODM", completed: "Completed",
    failed: "Failed", canceled: "Canceled", gone: "Not in WebODM",
};
const BADGES: Record<string, string> = {uploading: "info", queued: "info", running: "info", completed: "success",
                                        failed: "danger", canceled: "", gone: "warning"};

export function taskLabel(t: WebODMTask): string {
    const label = STATUS_LABELS[t.status] || t.status;
    if (t.status === "uploading") {
        return label + " " + Math.round((t.progress || 0) * 100) + "% (" + formatBytes(t.uploaded) + " of " +
            formatBytes(t.total) + ")";
    }
    return t.status === "running" ? label + " " + Math.round((t.progress || 0) * 100) + "%" : label;
}

export function taskBadge(t: WebODMTask): string { return "badge " + (BADGES[t.status] ?? ""); }

export function uploading(tasks: WebODMTask[] | undefined): boolean {
    return (tasks || []).some((t) => t.status === "uploading");
}
