// A flight's videos as the Videos tab shows them: their rows of the analysis, their length and time, and their track
// (a point per frame, from DJI's metadata in the MP4), with the point at a moment and the moment nearest a place
import {type FlightZone, formatCapture, formatNumber, type Maybe, zoneLabel} from "../core/format";
import type {FileRow} from "./files";

export interface VideoRow extends FileRow {
    size?: number | null;
    duration?: number | null;
    frames?: number | null;
    fps?: number | null;
    width?: number | null;
    height?: number | null;
    utc?: string | null;
    model?: string | null;
    track?: boolean;
    thermal?: boolean;
}

// What the server sends of a track: the columns, and a row per frame
export interface Track {fields: string[]; points: (number | null)[][]}

export interface TrackPoint {
    t: number;                  // seconds from the start
    lat: number | null;
    lon: number | null;
    alt: number | null;         // m above take-off
    abs_alt: number | null;
    pitch: number | null;       // the gimbal's
    yaw: number | null;
    heading: number | null;     // the aircraft's
    speed: number | null;
}

export function videosOf(files: Maybe<FileRow[]>): VideoRow[] {
    return (files || []).filter((f) => f.kind === "video") as VideoRow[];
}

// "1:08", "1:02:03"; with digits, the seconds' fraction too ("0:33.33")
export function formatDuration(seconds: Maybe<number>, digits = 0): string {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return "";
    const whole = digits ? seconds : Math.round(seconds);
    const h = Math.floor(whole / 3600), m = Math.floor(whole % 3600 / 60), s = whole % 60;
    const secs = s.toFixed(digits).padStart(digits ? digits + 3 : 2, "0");
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + secs;
}

// When a video started, in the flight's time zone when it is known ("27/10/2026, 15:18:38 UTC−5"), else in UTC
export function videoTime(utc: Maybe<string>, zone: Maybe<FlightZone>): string {
    const d = utc ? new Date(utc) : null;
    if (!d || isNaN(d.getTime())) return "";
    const offset = zone && zone.offset !== null && zone.offset !== undefined ? zone.offset : 0;
    const local = new Date(d.getTime() + offset * 60000).toISOString().replace("Z", "");
    return formatCapture(local) + " " + zoneLabel(offset);
}

export function trackPoints(track: Maybe<Track>): TrackPoint[] {
    if (!track) return [];
    return track.points.map((row) => Object.fromEntries(track.fields.map((f, i) => [f, row[i]])) as unknown as TrackPoint);
}

// The frame shown at moment t: the last point at or before it (the first before the first)
export function pointAt(points: TrackPoint[], t: number): TrackPoint | null {
    if (!points.length) return null;
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (points[mid].t <= t + 1e-6) lo = mid;
        else hi = mid - 1;
    }
    return points[lo];
}

// The index of the point nearest a place (in the same units as where, with the points placed by placed), or -1
// when none is within reach
export function nearestPoint(placed: (number[] | null)[], where: number[], reach = Infinity): number {
    let best = -1, bestD = reach * reach;
    placed.forEach((p, i) => {
        if (!p) return;
        const d = (p[0] - where[0]) ** 2 + (p[1] - where[1]) ** 2;
        if (d <= bestD) {
            best = i;
            bestD = d;
        }
    });
    return best;
}

// The frame a moment is in: 0 for the first
export function frameNumber(t: number, fps: Maybe<number>): number {
    return fps ? Math.floor(t * fps + 1e-6) : 0;
}

// What the readout says of the frame shown: [label, value] rows
export function pointRows(p: TrackPoint | null, t: number, fps: Maybe<number>): [string, string][] {
    const rows: [string, string][] = [["Time", formatDuration(t, 2) + (fps ? " · frame " + (frameNumber(t, fps) + 1) : "")]];
    if (!p) return rows;
    const add = (label: string, v: Maybe<number>, digits: number, unit: string) => {
        if (v !== null && v !== undefined) rows.push([label, formatNumber(v, digits, unit)]);
    };
    add("Height", p.alt, 1, " m above take-off");
    add("Gimbal pitch", p.pitch, 1, "°");
    add("Gimbal yaw", p.yaw, 1, "°");
    add("Heading", p.heading, 1, "°");
    add("Speed", p.speed, 1, " m/s");
    if (p.lat !== null && p.lon !== null) rows.push(["Position", formatNumber(p.lat, 6) + ", " + formatNumber(p.lon, 6)]);
    return rows;
}
