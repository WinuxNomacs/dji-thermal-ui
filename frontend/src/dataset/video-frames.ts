// A video's frames saved: where each was in the video and where the drone was, how it was shown, and the finding it
// joins. The server keeps two pictures of each: as shown when saved, and the original frame.
import {formatNumber, type Maybe} from "../core/format";
import type {IsothermState} from "../measure/result";
import {type Adjust, defaultAdjust} from "../viewer/view";
import {LEVELS} from "./video-levels";
import {formatDuration, VIDEO_PALETTE} from "./videos";

// How a frame is recoloured: the palette, the range and the one the sliders move it from, the adjustments, the isotherm
export interface Look {palette: string; range: [number, number]; ref: [number, number]; adjust: Adjust; isotherm: IsothermState}
export const START_LOOK: Look = {palette: VIDEO_PALETTE, range: LEVELS, ref: LEVELS, adjust: defaultAdjust(), isotherm: {mode: ""}};

// What a saved frame keeps of how it was shown
export interface SavedLook extends Partial<Look> {recoloured?: boolean}

export interface SavedFrame {
    id: number;
    dataset: number;
    video: string;              // the video's path in the flight
    time: number;               // seconds from its start
    frame: number;              // from 1
    point: Maybe<Record<string, Maybe<number>>>;    // the track's point at that time (lat, lon, alt, pitch, yaw...)
    name: string;
    notes: string;
    look: SavedLook;
    finding: number | null;
    finding_name: string;
    created_at: string;
}

export const framesUrl = (url: string) => url + "/video-frames";
export const pictureUrl = (url: string, id: number, original = false) =>
    framesUrl(url) + "/" + id + "/picture" + (original ? "?original=1" : "");

// The name a frame is saved with to start with
export function frameName(frame: number, t: number): string {
    return "Frame " + frame + " (" + formatDuration(t, 2) + ")";
}

const pair = (v: unknown): v is [number, number] =>
    Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && isFinite(x));

// A saved frame's look as the tab shows it again: what it kept over the look to start with
export function lookOf(saved: Maybe<SavedLook>): {look: Look; recoloured: boolean} {
    const s = saved || {};
    return {recoloured: !!s.recoloured, look: {
        palette: typeof s.palette === "string" ? s.palette : START_LOOK.palette,
        range: pair(s.range) ? s.range : START_LOOK.range,
        ref: pair(s.ref) ? s.ref : pair(s.range) ? s.range : START_LOOK.ref,
        adjust: {...START_LOOK.adjust, ...(s.adjust && typeof s.adjust === "object" ? s.adjust : {})},
        isotherm: s.isotherm && typeof s.isotherm === "object" && typeof s.isotherm.mode === "string" ? s.isotherm : START_LOOK.isotherm,
    }};
}

// Where the drone was: position, height above take-off and the gimbal's pitch
export function framePlace(point: SavedFrame["point"]): string {
    if (!point) return "";
    const n = (k: string) => typeof point[k] === "number" ? point[k] as number : null;
    const lat = n("lat"), lon = n("lon"), alt = n("alt"), pitch = n("pitch");
    return [lat !== null && lon !== null ? formatNumber(lat, 6) + ", " + formatNumber(lon, 6) : "",
            alt !== null ? formatNumber(alt, 1) + " m up" : "",
            pitch !== null ? "gimbal " + formatNumber(pitch, 0) + "°" : ""].filter(Boolean).join(" · ");
}

// Saved frames in the order they are numbered in a report (V1, V2...): by video, then time
export function numberedFrames(frames: SavedFrame[]): (SavedFrame & {number: string})[] {
    return [...frames].sort((a, b) => a.video.localeCompare(b.video) || a.time - b.time || a.id - b.id)
        .map((f, i) => ({...f, number: "V" + (i + 1)}));
}
