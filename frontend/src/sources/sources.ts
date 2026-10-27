// The source frames of a spot or an area of a mosaic (…/mosaics/<tab>/sources): what the pop-out lists and how it marks
// the spot or area in a frame. Plain functions, no DOM.
import {type Maybe} from "../core/format";
import {type Geometry} from "../measure/measure";
import {type Point} from "../viewer/panel";

// A frame that saw the spot or area: its pixel there (a spot; centres at whole numbers, null when not known) or the
// area's outline in its pixels and the shares of the area it saw and the mosaic took from it (an area; share null when
// the mosaic has no frame models)
export interface SourceFrame {
    frame: string;
    used: boolean;
    view_angle: Maybe<number>;
    time?: string;
    pixel?: Maybe<[number, number]>;
    share?: Maybe<number>;
    used_share?: number;
    outline?: [number, number][][];
}

// models: the mosaic knows every frame that saw it, else it lists only those it used (built before dji-thermal-cli 1.5.0)
export interface Sources {
    kind: "Point" | "Polygon";
    geometry: Geometry;
    models: boolean;
    frames: SourceFrame[];
    reason: Maybe<string>;
    point?: Point;
}

export const NO_MODELS = "Only the frames the mosaic used are listed: build the mosaics again to list every frame " +
    "that saw it.";

// The geometries the pop-out takes: a spot or an area (box and circle included), not a line
export const hasSources = (g: Maybe<Geometry>): boolean => !!g && (g.type === "Point" || g.type === "Polygon");

export function sourcesUrl(api: string, id: number, tab: string): string {
    return api + "conversions/" + id + "/mosaics/" + tab + "/sources";
}

// A frame's file name without its folders
export function frameName(path: string): string {
    return path.split("/").pop() || path;
}

// Why no frame is listed
export function emptyText(s: Sources): string {
    if (s.reason === "outside_raster") return "Outside the mosaic.";
    return s.kind === "Point" ? "No frame is known for this spot." : "No frame is known for this area.";
}

const percent = (x: number) => x > 0 && x < 0.01 ? "<1%" : Math.round(x * 100) + "%";

// How much of an area a frame saw, and how much of it the mosaic took from it ("" for a spot)
export function shareText(f: SourceFrame): string {
    const parts: string[] = [];
    if (f.share !== null && f.share !== undefined) parts.push("saw " + percent(f.share));
    if (f.used && f.used_share) parts.push("mosaic " + percent(f.used_share));
    return parts.join(" · ");
}

// The next frame stepped to (by: −1 or 1), kept within the list
export function stepped(index: number, by: number, count: number): number {
    return Math.max(0, Math.min(count - 1, index + by));
}

// The frame's pixels as an SVG drawn over the whole frame (a viewBox of its width and height) places them: a pixel's
// centre is half a pixel in from its corner
export function svgPoints(ring: [number, number][]): string {
    return ring.map(([x, y]) => (x + 0.5).toFixed(1) + "," + (y + 0.5).toFixed(1)).join(" ");
}
