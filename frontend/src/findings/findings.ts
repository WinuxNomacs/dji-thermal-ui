// The findings of a dataset (/api/datasets/<id>/findings): a spot, an area or a Delta T the user found something at, kept with
// the frames that saw it and the temperatures measured when it was saved. Plain functions, no DOM.
import {type Maybe} from "../core/format";
import {deltaFigure, type Geometry, type Shape, sizeText, temp} from "../measure/measure";
import {type SourceFrame, type Sources} from "../sources/sources";

export type Severity = "low" | "medium" | "high" | "critical";
export type Status = "open" | "reviewed" | "resolved";

// The temperatures read when it was saved, in unit (the conversion's), on the conversion and tab it names
export interface Temperatures {
    min?: number;
    max?: number;
    mean?: number;
    delta_t?: number;
    value?: number;             // a spot's own pixel
    first?: number;             // a Delta T's spots (ΔT: delta_t) and its length
    second?: number;
    length?: number;
    valid_pixels?: number;
    area?: number;
    perimeter?: number;
    unit?: string;
    approximate?: boolean;
    parameters?: Record<string, number>;
}

export interface FindingFrame extends SourceFrame {kept: boolean}

export interface Finding {
    id: number;
    dataset: number;
    name: string;
    notes: string;
    severity: Severity;
    status: Status;
    geometry: Geometry;
    shape?: Maybe<Shape>;
    conversion: number | null;  // the conversion its temperatures were read on (null once deleted)
    conversion_name: string;
    tab: string;
    temperatures: Temperatures;
    frames: FindingFrame[];
    models: boolean;            // every frame that saw it is listed, else only those the mosaic used
    created_at: string;
    updated_at: string;
    dataset_name?: string;      // in a project's list: its dataset, and the conversion it opens on
    opens?: number | null;
}

// What the form saves: the frames kept by name (null: all of them)
export interface FindingFields {name: string; notes: string; severity: Severity; status: Status; kept: string[] | null}

export const SEVERITIES: [Severity, string][] = [["low", "Low"], ["medium", "Medium"], ["high", "High"],
                                                 ["critical", "Critical"]];
export const STATUSES: [Status, string][] = [["open", "Open"], ["reviewed", "Reviewed"], ["resolved", "Resolved"]];

// Each severity's colour: the tag's on the map and the list's chip, read on white text
export const SEVERITY_COLORS: Record<Severity, string> = {low: "#2563eb", medium: "#b45309", high: "#ea580c",
                                                          critical: "#dc2626"};

export const severityLabel = (s: string): string => SEVERITIES.find(([k]) => k === s)?.[1] || s;
export const statusLabel = (s: string): string => STATUSES.find(([k]) => k === s)?.[1] || s;

export function findingsUrl(api: string, dataset: number, id?: number): string {
    return api + "datasets/" + dataset + "/findings" + (id ? "/" + id : "");
}

// A new finding's fields: its name from what it was drawn as
export function blankFields(name = ""): FindingFields {
    return {name, notes: "", severity: "medium", status: "open", kept: null};
}

export function fieldsOf(f: Finding): FindingFields {
    return {name: f.name, notes: f.notes, severity: f.severity, status: f.status,
            kept: f.frames.filter((x) => x.kept).map((x) => x.frame)};
}

// The fields as the API takes them: all frames kept is sent as none named
export function fieldsBody(v: FindingFields, frames: Maybe<SourceFrame[]>): Record<string, unknown> {
    const all = !frames || !v.kept || frames.every((f) => v.kept!.includes(f.frame));
    return {name: v.name.trim(), notes: v.notes, severity: v.severity, status: v.status, ...(all ? {} : {kept: v.kept})};
}

// A finding as the source frames window shows it: its kept frames
export function findingSources(f: Finding): Sources {
    return {kind: f.geometry.type, geometry: f.geometry, models: f.models,
            frames: f.frames.filter((x) => x.kept), reason: null};
}

// Its main figures, in the user's unit: a spot's temperature, an area's max and mean, a Delta T's ΔT and its
// spots; with no temperatures (on a visual mosaic of its own), an area's size
export function temperaturesText(t: Temperatures): string {
    const unit = t.unit;
    if (t.first !== undefined || t.second !== undefined) {
        return deltaFigure(t, unit) + (t.approximate ? " (corrected, approximate)" : "");
    }
    if (t.value === undefined && t.mean === undefined) return sizeText(t);
    const parts = t.value !== undefined && t.value !== null ? [temp(t.value, unit)] :
        [t.max !== undefined ? "max " + temp(t.max, unit) : "", t.mean !== undefined ? "mean " + temp(t.mean, unit) : ""];
    return parts.filter(Boolean).join(" · ") + (t.approximate ? " (corrected, approximate)" : "");
}

// The ids hidden, as the URL keeps them ("3,7"), and back
export function hiddenText(ids: number[]): string { return ids.slice().sort((a, b) => a - b).join(","); }
export function readHidden(text: Maybe<string>): number[] {
    return String(text || "").split(",").map(Number).filter((x) => Number.isInteger(x) && x > 0);
}
