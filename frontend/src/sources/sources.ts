// The source frames of a spot or an area of a mosaic (…/mosaics/<tab>/sources): what the pop-out lists and how it marks
// the spot or area in a frame. Plain functions, no DOM.
import {type Maybe} from "../core/format";
import {type Geometry} from "../measure/measure";
import {type Point} from "../viewer/panel";

// A thermal frame's visual frame, from the visual mosaic: its size, and the homography taking a pixel of the thermal
// frame to its pixel (9 numbers, row by row, up to scale; the server's thermal_mosaics.homography)
export interface VisualPair {
    frame: string;
    width: number;
    height: number;
    homography: number[];
}

// A frame that saw the spot or area: its pixel there (a spot; centres at whole numbers, null when not known) or the
// area's outline in its pixels and the shares of the area it saw and the mosaic took from it (an area; share null when
// the mosaic has no frame models); and its visual pair, when there is one
export interface SourceFrame {
    frame: string;
    used: boolean;
    view_angle: Maybe<number>;
    time?: string;
    pixel?: Maybe<[number, number]>;
    share?: Maybe<number>;
    used_share?: number;
    outline?: [number, number][][];
    visual?: Maybe<VisualPair>;
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
    if (s.reason === "not_recorded") return "WebODM's orthophoto doesn't record which frames each pixel comes from.";
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

// A thermal frame's pixel in its visual pair, or null where the visual camera could not see it (behind it)
export function toVisual(pair: VisualPair, p: [number, number]): [number, number] | null {
    const h = pair.homography, w = h[6] * p[0] + h[7] * p[1] + h[8];
    if (!(w > 0)) return null;
    return [(h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w];
}

// A ring of thermal pixels in the visual pair (its straight edges stay straight), the vertices it could not see left out
export function ringToVisual(pair: VisualPair, ring: [number, number][]): [number, number][] {
    return ring.map((p) => toVisual(pair, p)).filter((p): p is [number, number] => p !== null);
}

// A pixel of the visual pair in its thermal frame (the homography inverted), or null where the thermal camera could not
// see it (behind it)
export function fromVisual(pair: VisualPair, p: [number, number]): [number, number] | null {
    const [a, b, c, d, e, f, g, h, i] = pair.homography;
    const inverse = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f,
                     d * h - e * g, b * g - a * h, a * e - b * d];
    const w = inverse[6] * p[0] + inverse[7] * p[1] + inverse[8], det = a * inverse[0] + b * inverse[3] + c * inverse[6];
    if (!(w * det > 0)) return null;
    return [(inverse[0] * p[0] + inverse[1] * p[1] + inverse[2]) / w, (inverse[3] * p[0] + inverse[4] * p[1] + inverse[5]) / w];
}
