import OlMap from "ol/Map";
import MapBrowserEvent from "ol/MapBrowserEvent";
import {fromLonLat} from "ol/proj";
import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flightFilesText, isFlightFile} from "../src/core/upload";
import {DatasetPage} from "../src/dataset/dataset-page";
import {flagged, overview} from "../src/dataset/files";
import {formatDuration, frameNumber, nearestPoint, pointAt, pointRows, trackPoints, videosOf, videoTime} from "../src/dataset/videos";
import {click, server, ticks} from "./helpers";

const API = "/api/";
const URL = API + "datasets/5";
const VIDEO = "DCIM/DJI_20261027151837_0001_T_Waypoint1.MP4";
const FIELDS = ["t", "lat", "lon", "alt", "abs_alt", "pitch", "yaw", "heading", "speed"];
const TRACK = {fields: FIELDS, points: [
    [0, 42.1, -88.07, 15.2, 222.8, 0, 36.4, 35.9, 0],
    [1 / 30, 42.10001, -88.07, 15.3, 222.9, -45, 36.4, 35.9, 1.2],
    [2 / 30, 42.10002, -88.07, 15.4, 223.0, -45, 36.4, 35.9, 1.3],
]};
const ROW = {path: VIDEO, kind: "video", reason: "", size: 35760390, duration: 67.967, frames: 2039, fps: 30, width: 640,
             height: 512, utc: "2026-10-27T20:18:38Z", model: "DJI Matrice 4T", track: true, thermal: true, lat: 42.1, lon: -88.07};
const DETAIL = {
    id: 5, name: "Roof", source: "upload", status: "ready", file_count: 3, analyzed: true, conversions: [],
    flight_zone: {offset: -300},
    analysis: {files: [{path: "a_T.JPG", kind: "thermal", lat: 42.1, lon: -88.0701},
                       ROW, {path: "broken.mp4", kind: "video", reason: "Not an MP4 video", size: 4}],
               cameras: [], findings: []},
};

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const tab = (name: string) => $(`[data-tab="${name}"]`);
const readout = () => $$("#video-readout tr").map((tr) => tr.textContent);

function page(fetchFn: ReturnType<typeof server>) {
    vi.stubGlobal("fetch", fetchFn);
    render(<DatasetPage api={API} publicUrl="/" id={5} projectId={4} projectName="Silos"/>, document.getElementById("root")!);
}

const routes = (detail: unknown = DETAIL) => server({[URL]: detail, [API + "preferences"]: {settings: {outputs: []}, defaults: {outputs: []}, products: [], palettes: []},
                                                     [URL + "/video-track?file=" + encodeURIComponent(VIDEO)]: TRACK});

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    render(null, document.getElementById("root")!);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    history.replaceState(null, "", "/");
});

describe("a flight's videos", () => {
    it("are a flight's files: MP4s are uploaded with the images and counted apart", () => {
        const files = [new File([""], "a_T.JPG"), new File([""], "DJI_0001_T.MP4"), new File([""], "notes.txt")];
        expect(files.filter(isFlightFile).map((f) => f.name)).toEqual(["a_T.JPG", "DJI_0001_T.MP4"]);
        expect(flightFilesText(files.filter(isFlightFile))).toBe("1 image(s) and 1 video(s)");
        expect(flightFilesText([files[0]])).toBe("1 image(s)");
    });

    it("are counted apart from other files, and only one that can't be read is a problem", () => {
        expect(videosOf(DETAIL.analysis.files).map((v) => v.path)).toEqual([VIDEO, "broken.mp4"]);
        const o = overview(DETAIL.analysis);
        expect([o.frames, o.videos, o.other]).toEqual([1, 2, 0]);
        expect(flagged(ROW, {})).toBe(false);
        expect(flagged(DETAIL.analysis.files[2], {})).toBe(true);
    });

    it("say how long they are and when they started, in the flight's time zone", () => {
        expect(formatDuration(67.967)).toBe("1:08");
        expect(formatDuration(3723)).toBe("1:02:03");
        expect(formatDuration(33.333, 2)).toBe("0:33.33");
        expect(formatDuration(null)).toBe("");
        expect(videoTime("2026-10-27T20:18:38Z", {offset: -300})).toMatch(/\b(15|3):18:38.* UTC−5$/);
        expect(videoTime("2026-10-27T20:18:38Z", {offset: null})).toMatch(/\b(20|8):18:38.* UTC$/);
        expect(videoTime("", null)).toBe("");
    });

    it("find the frame shown at a moment and the point nearest a place", () => {
        const points = trackPoints(TRACK);
        expect(points[1]).toMatchObject({t: 1 / 30, lat: 42.10001, pitch: -45});
        expect(pointAt(points, 0.05)!.t).toBe(1 / 30);
        expect(pointAt(points, 1 / 30)!.t).toBe(1 / 30);
        expect(pointAt(points, -1)!.t).toBe(0);
        expect(pointAt(points, 99)!.t).toBe(2 / 30);
        expect(pointAt([], 1)).toBeNull();
        expect(nearestPoint([[0, 0], null, [10, 0]], [8, 1])).toBe(2);
        expect(nearestPoint([[0, 0], [10, 0]], [5, 50], 10)).toBe(-1);
        expect(frameNumber(1, 30)).toBe(30);
        expect(pointRows(points[1], 1 / 30, 30)).toEqual([
            ["Time", "0:00.03 · frame 2"], ["Height", "15.3 m above take-off"], ["Gimbal pitch", "-45.0°"],
            ["Gimbal yaw", "36.4°"], ["Heading", "35.9°"], ["Speed", "1.2 m/s"], ["Position", "42.100010, -88.070000"]]);
    });

    it("are listed on a Videos tab, the first played beside the map of its track, which a click seeks in", async () => {
        const viewport = vi.spyOn(OlMap.prototype, "getViewport");
        const fetchFn = routes();
        page(fetchFn);
        await ticks();
        expect(tab("videos")!.textContent).toBe("Videos 2");
        click(tab("videos")!);
        await ticks(10);
        const items = $$(".video-item");
        expect(items.map((b) => b.querySelector(".video-name")!.textContent)).toEqual(["DJI_20261027151837_0001_T_Waypoint1.MP4", "broken.mp4"]);
        expect(items[0].getAttribute("aria-pressed")).toBe("true");
        expect(items[0].textContent).toContain("1:08 · 640×512 · 34 MB");
        expect(items[0].textContent).toContain("DJI Matrice 4T");
        expect(items[1].hasAttribute("disabled")).toBe(true);
        expect(items[1].textContent).toContain("Can't be played: Not an MP4 video");

        const video = $<HTMLVideoElement>("#video")!;
        const file = encodeURIComponent(VIDEO);
        expect(video.getAttribute("src")).toBe(URL + "/video?file=" + file);
        expect(video.getAttribute("poster")).toBe(URL + "/video-cover?file=" + file);
        expect(readout()[0]).toBe("Time0:00.00 · frame 1");
        expect(readout()).toContain("Gimbal pitch0.0°");

        // The readout follows the frame shown
        video.currentTime = 0.05;
        video.dispatchEvent(new Event("timeupdate"));
        await ticks();
        expect(readout()[0]).toBe("Time0:00.05 · frame 2");
        expect(readout()).toContain("Gimbal pitch-45.0°");

        // A click near the track's last point goes to its moment; one far from it does nothing
        const map = [...new Set(viewport.mock.contexts as OlMap[])][0];
        const clickAt = (lonLat: number[]) => {
            const e = new MapBrowserEvent("click", map, new MouseEvent("click") as PointerEvent);
            e.coordinate = fromLonLat(lonLat);
            map.dispatchEvent(e);
        };
        map.getView().setResolution(0.1);
        clickAt([-88.07, 42.10002]);
        expect(video.currentTime).toBeCloseTo(2 / 30);
        clickAt([-88.0, 42.2]);
        expect(video.currentTime).toBeCloseTo(2 / 30);
    });

    it("leave no Videos tab on a flight without any", async () => {
        page(routes({...DETAIL, analysis: {...DETAIL.analysis, files: [DETAIL.analysis.files[0]]}}));
        await ticks();
        expect(tab("files")).not.toBeNull();
        expect(tab("videos")).toBeNull();
    });
});
