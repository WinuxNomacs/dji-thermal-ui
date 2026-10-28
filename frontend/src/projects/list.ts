// The projects' data: a project as the API sums it up, and what deleting one takes with it
import {count, formatBytes} from "../core/format";
import {type Finding} from "../findings/findings";

export interface Location {lon: number; lat: number; label: string}

export interface Project {
    id: number;
    name: string;
    description: string;
    location: Location | null;
    dataset_count: number;
    conversion_count: number;
    mosaic_count: number;
    measurement_count: number;
    finding_count?: number;
    size: number;                   // the bytes the app keeps for its datasets
    created_at?: string | null;
    updated_at?: string | null;
}

// Where one of its datasets was flown: a closed lon/lat ring
export interface Area {dataset: number; name: string; ring: [number, number][]}

// findings: its datasets' findings, each with its dataset's name and the conversion it opens on
export interface ProjectDetail extends Project {areas: Area[]; findings?: Finding[]}

// What deleting a project takes with it, paragraph by paragraph
export function projectDeleteText(p: Project): string[] {
    if (!p.dataset_count) return ["“" + p.name + "” has no flights.", "This cannot be undone."];
    const with_ = [count(p.dataset_count, "flight", "flights")];
    if (p.conversion_count) with_.push(count(p.conversion_count, "dataset", "datasets"));
    if (p.mosaic_count) with_.push(count(p.mosaic_count, "mosaic", "mosaics"));
    if (p.measurement_count) with_.push(count(p.measurement_count, "measurement", "measurements"));
    if (p.finding_count) with_.push(count(p.finding_count, "finding", "findings"));
    const list = with_.slice(0, -1).join(", ") + (with_.length > 1 ? " and " : "") + with_[with_.length - 1];
    return [
        "“" + p.name + "” is deleted with its " + list + ".",
        (p.size ? formatBytes(p.size) + " of disk space is freed. " : "") +
            "The images of flights read from a folder stay in their folders.",
        "This cannot be undone.",
    ];
}
