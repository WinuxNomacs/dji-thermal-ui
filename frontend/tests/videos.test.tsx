import OlMap from "ol/Map";
import MapBrowserEvent from "ol/MapBrowserEvent";
import {fromLonLat} from "ol/proj";
import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flightFilesText, isFlightFile} from "../src/core/upload";
import {DatasetPage} from "../src/dataset/dataset-page";
import {flagged, overview} from "../src/dataset/files";
import {DJI_IRONRED} from "../src/dataset/ironbow";
import {frameName, framePlace, lookOf, numberedFrames, type SavedFrame, START_LOOK} from "../src/dataset/video-frames";
import {levelCube, levelIsotherm, levelRange, toLevels} from "../src/dataset/video-levels";
import {formatDuration, frameNumber, keyAction, loopBack, nearestPoint, nextSpeed, pointAt, pointRows, speedLabel,
        steppedTime, trackPoints, VIDEO_PALETTE, videoPalettes, videosOf, videoTime} from "../src/dataset/videos";
import {calls, click, jsonResponse, server, ticks} from "./helpers";

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

const PALETTES = [{key: "dji_ironred", label: "DJI ironred"}, {key: "dji_whitehot", label: "DJI whitehot", color_map: [0x000000ff, 0xffffffff]},
                  {key: "gray", label: "Gray", color_map: [0x000000ff, 0xffffffff]}];
const routes = (detail: unknown = DETAIL) => server({[URL]: detail, [API + "preferences"]: {settings: {outputs: []}, defaults: {outputs: []}, products: [], palettes: [],
                                                                                           view_palettes: PALETTES},
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
        // As the browser gives the frames' times (to the microsecond), against the track's (to 0.1 ms)
        expect(frameNumber(0.033333, 30)).toBe(1);
        expect(frameNumber(66.633333, 30)).toBe(1999);
        expect(pointAt(trackPoints({fields: FIELDS, points: [[0], [0.0333], [0.0667]]}), 0.066667)!.t).toBe(0.0667);
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

    it("are turned back into the camera's levels through its palette, relative and ranged by their percentiles", () => {
        const cube = levelCube(DJI_IRONRED);
        const rgba = (c: number) => [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, 255];
        const levels = [0, 14, 128, 200, 255];
        const frame = new Uint8ClampedArray(levels.flatMap((l) => rgba(DJI_IRONRED[l])));
        toLevels(frame, cube).forEach((v, i) => expect(Math.abs(v - levels[i])).toBeLessThanOrEqual(3));
        // A colour off the palette (as the video's compression leaves them) takes the nearest level
        const [r, g, b] = rgba(DJI_IRONRED[128]);
        expect(Math.abs(toLevels(new Uint8ClampedArray([r - 6, g + 5, b + 4, 255]), cube)[0] - 128)).toBeLessThanOrEqual(4);

        const spread = Float32Array.from({length: 100}, (_, i) => i < 1 ? 0 : i >= 99 ? 255 : 50 + i);
        expect(levelRange(spread)).toEqual([51, 147]);
        expect(levelRange(new Float32Array(10).fill(255))).toEqual([254, 255]);
        expect(levelRange(new Float32Array(0))).toEqual([0, 255]);

        expect(levelIsotherm("", "", "")).toEqual({range: null});
        expect(levelIsotherm("above", "200", "")).toEqual({range: [200, Infinity]});
        expect(levelIsotherm("below", "40", "")).toEqual({range: [-Infinity, 40]});
        expect(levelIsotherm("between", "40", "90")).toEqual({range: [40, 90]});
        expect(levelIsotherm("between", "90", "40").error).toBe("The second level must be above the first");
        expect(levelIsotherm("above", "", "").error).toBe("The isotherm needs a level");
    });

    it("step by frames, play slower or faster, loop between two points and answer to keys", () => {
        expect(steppedTime(0, 1, 30, 10)).toBeCloseTo(1.5 / 30);
        expect(steppedTime(1.5 / 30, -1, 30, 10)).toBeCloseTo(0.5 / 30);
        expect(steppedTime(0.2, -30, 30, 10)).toBeCloseTo(0.5 / 30);
        expect(steppedTime(9.99, 30, 30, 10)).toBeCloseTo(299.5 / 30);
        expect(steppedTime(2, 30, 30, 10)).toBeCloseTo(90.5 / 30);

        expect(nextSpeed(1, -1)).toBe(0.5);
        expect(nextSpeed(0.125, -1)).toBe(0.125);
        expect(nextSpeed(2, 1)).toBe(2);
        expect(nextSpeed(0.3, 1)).toBe(0.5);
        expect(speedLabel(0.125)).toBe("⅛×");

        const loop = {start: 2, end: 4, on: true};
        expect(loopBack(4, loop)).toBe(2);
        expect(loopBack(1, loop)).toBe(2);
        expect(loopBack(3, loop)).toBeNull();
        expect(loopBack(5, {...loop, on: false})).toBeNull();
        expect(loopBack(5, {...loop, end: 1})).toBeNull();

        expect(keyAction({key: " "})).toBe("play");
        expect(keyAction({key: "ArrowLeft"})).toBe("back");
        expect(keyAction({key: "ArrowRight", shiftKey: true})).toBe("forward-second");
        expect(keyAction({key: "I", shiftKey: true})).toBe("in");
        expect(keyAction({key: "+"})).toBe("faster");
        expect(keyAction({key: "-"})).toBe("slower");
        expect(keyAction({key: "l", ctrlKey: true})).toBeNull();
        expect(keyAction({key: "x"})).toBeNull();

        const list = videoPalettes(PALETTES);
        expect(list.map((p) => p.key)).toEqual([VIDEO_PALETTE, "dji_whitehot", "gray"]);
        expect(list[0].color_map).toBe(DJI_IRONRED);
        expect(videoPalettes(undefined).map((p) => p.key)).toEqual([VIDEO_PALETTE]);
    });

    it("are stepped, slowed and looped from the buttons and the keys, and recoloured in the levels' palette", async () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
            Object.defineProperty(this, "paused", {value: false, configurable: true});
            this.dispatchEvent(new Event("play"));
            return Promise.resolve();
        });
        vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
            Object.defineProperty(this, "paused", {value: true, configurable: true});
            this.dispatchEvent(new Event("pause"));
        });
        page(routes());
        await ticks();
        click(tab("videos")!);
        await ticks(10);
        const video = $<HTMLVideoElement>("#video")!;
        const key = (k: string, shiftKey = false) => document.body.dispatchEvent(new KeyboardEvent("keydown", {key: k, shiftKey, bubbles: true}));

        click($("#forward")!);
        expect(video.currentTime).toBeCloseTo(1.5 / 30);
        key("ArrowRight", true);
        expect(video.currentTime).toBeCloseTo(31.5 / 30);
        key("ArrowLeft");
        expect(video.currentTime).toBeCloseTo(30.5 / 30);
        click($("#back-second")!);
        expect(video.currentTime).toBeCloseTo(0.5 / 30);

        key(" ");
        await ticks();
        expect(play).toHaveBeenCalledTimes(1);
        expect($("#play")!.getAttribute("title")).toBe("Pause (Space)");
        key(" ");
        await ticks();
        expect($("#play")!.getAttribute("title")).toBe("Play (Space)");

        key("-");
        await ticks();
        expect(video.playbackRate).toBe(0.5);
        expect($<HTMLSelectElement>("#speed")!.value).toBe("0.5");

        video.currentTime = 2;
        key("i");
        video.currentTime = 4;
        key("o");
        key("l");
        await ticks();
        expect($("#in")!.textContent).toBe("In 0:02.00");
        expect($("#out")!.textContent).toBe("Out 0:04.00");
        expect($("#loop")!.getAttribute("aria-pressed")).toBe("true");
        // An in point after the out point leaves the loop without an out point
        video.currentTime = 5;
        click($("#in")!);
        await ticks();
        expect($("#out")!.textContent).toBe("Out");

        // Recoloured: the levels' palette, range and isotherm, never temperatures
        expect($("#video-look")).toBeNull();
        click($('[name="recoloured"]')!);
        await ticks();
        expect($("#video-recoloured")!.hasAttribute("hidden")).toBe(false);
        expect(video.hasAttribute("controls")).toBe(false);
        const palette = $<HTMLSelectElement>("#palette")!;
        expect([...palette.options].map((o) => o.textContent)).toEqual(["DJI ironred", "DJI whitehot", "Gray"]);
        expect(palette.value).toBe(VIDEO_PALETTE);
        expect([$<HTMLInputElement>("#range-min")!.value, $<HTMLInputElement>("#range-max")!.value]).toEqual(["0", "255"]);
        expect($("#video-look")!.textContent).toContain("Level (relative)");
        expect($("#video-look")!.textContent).not.toMatch(/°[CF]/);
        click($('[name="original"]')!);
        await ticks();
        expect($("#video-look")).toBeNull();
        expect(video.hasAttribute("controls")).toBe(true);
    });

    it("save a frame's picture as shown and as filmed, name it, attach it to a finding, show it again and delete it", async () => {
        const saved = (over: Partial<SavedFrame>): SavedFrame => ({id: 3, dataset: 5, video: VIDEO, time: 1.5 / 30, frame: 2,
            point: {lat: 42.10001, lon: -88.07, alt: 15.3, pitch: -45}, name: "Frame 2 (0:00.05)", notes: "", finding: null,
            finding_name: "", created_at: "", look: {recoloured: false}, ...over});
        const elsewhere = saved({id: 1, video: "other.mp4", name: "Another video's"});
        const fetchFn = server({[URL]: DETAIL, [API + "preferences"]: {settings: {outputs: []}, defaults: {outputs: []}, products: [], palettes: [],
                                                         view_palettes: PALETTES},
                                [URL + "/video-track?file=" + encodeURIComponent(VIDEO)]: TRACK,
                                [URL + "/video-frames"]: {frames: [elsewhere]}, [URL + "/findings"]: {findings: [{id: 7, name: "Roof leak"}]},
                                ["POST " + URL + "/video-frames"]: saved({}),
                                ["PATCH " + URL + "/video-frames/3"]: [saved({name: "Warm window"}),
                                    saved({name: "Warm window", finding: 7, finding_name: "Roof leak",
                                           look: {recoloured: true, palette: "gray", range: [10, 90]}})],
                                ["DELETE " + URL + "/video-frames/3"]: () => jsonResponse({})});
        vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
            return {canvas: this, drawImage() {}, putImageData() {}, getImageData: () => ({data: new Uint8ClampedArray(8)})} as never;
        });
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(new Blob(["png"], {type: "image/png"})));
        vi.stubGlobal("ImageData", class { constructor(public data: unknown, public width: number, public height: number) {} });
        page(fetchFn);
        await ticks();
        click(tab("videos")!);
        await ticks(10);
        const video = $<HTMLVideoElement>("#video")!;
        // A frame of 2 × 1 pixels on screen
        for (const [k, v] of [["videoWidth", 2], ["videoHeight", 1], ["readyState", 4]] as const) {
            Object.defineProperty(video, k, {value: v, configurable: true});
        }
        expect($("#video-saved")!.textContent).toContain("None yet");
        click($("#forward")!);
        video.dispatchEvent(new Event("loadeddata"));
        await ticks();
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "s", bubbles: true}));
        await ticks(30);
        const post = fetchFn.mock.calls.find((c) => c[1]?.method === "POST")!;
        const body = post[1]!.body as FormData;
        expect([body.get("video"), body.get("frame"), body.get("name")]).toEqual([VIDEO, "2", "Frame 2 (0:00.05)"]);
        expect(parseFloat(body.get("time") as string)).toBeCloseTo(1.5 / 30);
        expect(JSON.parse(body.get("look") as string)).toMatchObject({recoloured: false, palette: VIDEO_PALETTE, range: [0, 255]});
        expect(body.get("picture")).toBeInstanceOf(Blob);
        expect(body.get("original")).toBeInstanceOf(Blob);
        expect((post[1]!.headers as Record<string, string>)["X-CSRFToken"]).toBe("tok");

        // Listed under its video only, and counted on it
        expect($$("#video-saved li").map((li) => li.dataset.frame)).toEqual(["3"]);
        expect($("#video-saved img")!.getAttribute("src")).toBe(URL + "/video-frames/3/picture");
        expect($("#video-saved")!.textContent).toContain("0:00.05 · frame 2 · 42.100010, -88.070000 · 15.3 m up · gimbal -45°");
        expect($(`.video-item[data-path="${VIDEO}"]`)!.textContent).toContain("1 frame saved");

        const nameField = $<HTMLInputElement>('#video-saved [aria-label="Name"]')!;
        nameField.value = "Warm window";
        nameField.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        const finding = $<HTMLSelectElement>('#video-saved [aria-label="Finding"]')!;
        expect([...finding.options].map((o) => o.textContent)).toEqual(["No finding", "Roof leak"]);
        finding.value = "7";
        finding.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        const patches = fetchFn.mock.calls.filter((c) => c[1]?.method === "PATCH").map((c) => JSON.parse(c[1]!.body as string));
        expect(patches).toEqual([{name: "Warm window"}, {finding: 7}]);

        // Shown again: the video at its time, as it was shown
        video.currentTime = 5;
        click($(".video-saved-picture")!);
        await ticks();
        expect(video.currentTime).toBeCloseTo(1.5 / 30);
        expect($('[name="recoloured"]')!.getAttribute("aria-pressed")).toBe("true");
        expect($<HTMLSelectElement>("#palette")!.value).toBe("gray");
        expect([$<HTMLInputElement>("#range-min")!.value, $<HTMLInputElement>("#range-max")!.value]).toEqual(["10", "90"]);

        click($('#video-saved [name="delete"]')!);
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + URL + "/video-frames/3");
        expect($("#video-saved")!.textContent).toContain("None yet");
    });

    it("keep how a saved frame was shown, its name, where it was taken, and number it for reports", () => {
        expect(keyAction({key: "s"})).toBe("save");
        expect(keyAction({key: "s", ctrlKey: true})).toBeNull();
        expect(frameName(371, 12.333)).toBe("Frame 371 (0:12.33)");
        expect(lookOf(undefined)).toEqual({look: START_LOOK, recoloured: false});
        const kept = lookOf({recoloured: true, palette: "gray", range: [20, 80], adjust: {gamma: 2, equalize: false, sharpen: 1},
                             isotherm: {mode: "above", a: "180"}});
        expect(kept.recoloured).toBe(true);
        expect(kept.look).toEqual({palette: "gray", range: [20, 80], ref: [20, 80], adjust: {gamma: 2, equalize: false, sharpen: 1},
                                   isotherm: {mode: "above", a: "180"}});
        // What isn't a look is left as it starts
        expect(lookOf({range: "wide" as never, isotherm: 3 as never}).look).toEqual(START_LOOK);
        expect(framePlace({lat: 42.1, lon: -88.07, alt: 15.24, pitch: -45.4})).toBe("42.100000, -88.070000 · 15.2 m up · gimbal -45°");
        expect(framePlace({lat: null, lon: null, alt: 15})).toBe("15.0 m up");
        expect(framePlace(null)).toBe("");
        const f = (id: number, video: string, time: number) => ({id, video, time}) as SavedFrame;
        expect(numberedFrames([f(1, "b.mp4", 1), f(2, "a.mp4", 9), f(3, "a.mp4", 2)]).map((x) => [x.id, x.number]))
            .toEqual([[3, "V1"], [2, "V2"], [1, "V3"]]);
    });

    it("leave no Videos tab on a flight without any", async () => {
        page(routes({...DETAIL, analysis: {...DETAIL.analysis, files: [DETAIL.analysis.files[0]]}}));
        await ticks();
        expect(tab("files")).not.toBeNull();
        expect(tab("videos")).toBeNull();
    });
});
