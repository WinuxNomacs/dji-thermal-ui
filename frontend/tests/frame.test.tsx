import OlMap from "ol/Map";
import MapBrowserEvent from "ol/MapBrowserEvent";
import ImageLayer from "ol/layer/Image";
import WebGLTileLayer from "ol/layer/WebGLTile";
import type ImageStatic from "ol/source/ImageStatic";
import VectorSource from "ol/source/Vector";
import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserLocale} from "../src/core/format";
import {setUserUnit} from "../src/core/units";
import {captureOrder, changesIn, type FrameInfo, frameTag, listFrames, listTitle, newConversionUrl, readChanges, valuesUrl} from "../src/frame/frame";
import {shortName} from "../src/frame/frame-list";
import {FramePage, type Frames} from "../src/frame/frame-page";
import {FrameReadout, Info} from "../src/frame/panel";
import {Drawing} from "../src/measure/drawing";
import {calls, click, jsonResponse, key, server, ticks, valuesResponse} from "./helpers";

const API = "/api/";
const BASE = API + "conversions/9";
const A = "thermal/a_T.JPG", B = "thermal/b_T.JPG";
const FRAMES: Frames = {
    name: "Nadir", dataset_name: "Roof", description: "temp_c tiff", unit: "C", normalized: true, default_palette: "dji_ironred",
    mosaic_status: "ready", max_pitch: -80,
    palettes: [{key: "dji_ironred", label: "DJI ironred", color_map: [0x000000, 0xff0000]},
               {key: "magma", label: "Magma", color_map: [0x000004, 0xfcfdbf]}],
    flight_zone: {offset: -300},
    frames: [{path: A, pitch: -90, time: "2026:10:12 18:29:50", converted: true, mosaic: 0,
              recorded: {emissivity: 0.91, humidity: 50, lrf: 21.4, reflection: 27.6, ambient: 27.6}},
             {path: B, pitch: -45, time: "2026:10:12 18:30:10", converted: false, mosaic: null, recorded: {}}],
};
const INFO: FrameInfo = {
    frame: A, width: 640, height: 512, distance_source: "rangefinder", notes: [], offset: 0.2, offset_known: true,
    params: {distance: 21.4, humidity: 50, emissivity: 0.91, reflection: 27.1, ambient_temp: 27.1},
    stats: {min: 15.1, max: 32.2, mean: 21.9, percentiles: [17.04, 27.96], histogram: [[1, 2], [15, 25, 33]]},
};
const SAVED = {id: 4, name: "Hot spot", target: "frame", frame: A, geometry: {type: "Point", coordinates: [10, 20]},
               parameters: {}, values: {result: {kind: "Point", valid_pixels: 1, value: 31.5, mean: 31.5}}};
const enc = encodeURIComponent;

const $ = (sel: string) => document.querySelector(sel);
const byId = (id: string) => document.getElementById(id)!;
// The frame shown, as the explorer's list marks it, and the frames it lists
const shownFrame = () => ($("#frames [aria-current=true]") as HTMLElement | null)?.dataset.path;
const listed = () => [...document.querySelectorAll<HTMLElement>("#frames button")].map((b) => b.dataset.path);
// What a pane's map shows: the URL of its values
const valuesOf = (pane: string) => byId(pane).dataset.values || "";
const type = (el: Element, value: string) => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
};

function routes(extra: Record<string, unknown> = {}) {
    return {
        [BASE + "/frames"]: FRAMES,
        [BASE + "/frame?frame=" + enc(A)]: INFO,
        [BASE + "/frame?frame=" + enc(B)]: {...INFO, frame: B},
        [BASE + "/measurements?frame=" + enc(A)]: {measurements: []},
        [BASE + "/measurements?frame=" + enc(B)]: {measurements: []},
        [BASE + "/frame/data?frame=" + enc(A)]: valuesResponse(4, 3),
        [BASE + "/frame/data?frame=" + enc(B)]: valuesResponse(4, 3),
        [BASE + "/frame/data?frame=" + enc(A) + "&emissivity=0.98"]: valuesResponse(4, 3, 21),
        ...extra,
    };
}

async function open(fetchFn: ReturnType<typeof server>) {
    vi.stubGlobal("fetch", fetchFn);
    render(<FramePage api={API} publicUrl="/" id={9} datasetId={5} datasetName="Roof"/>, byId("root"));
    await ticks(40);
}

beforeEach(() => {
    setUserLocale("en-GB");
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
    history.replaceState(null, "", "/conversion/9/frame");
});
afterEach(() => {
    setUserLocale("");
    render(null, byId("root"));
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
    localStorage.clear();
    setUserUnit("C");
});

describe("the frame helpers", () => {
    it("tag a frame with what its list does not say: not converted, in the mosaic, or why the mosaics left it out", () => {
        const [a, b] = FRAMES.frames!;
        const oblique = {path: "c.JPG", pitch: -45, converted: true, mosaic: null};
        const unusable = {path: "d.JPG", pitch: -90, converted: true, mosaic: null};
        expect(frameTag(a, null, -80, true)).toBe("in the mosaic");
        expect(frameTag(a, "mosaic", -80, true)).toBe("");
        // Skipped by a conversion with a pitch limit, or not converted for another reason
        expect(frameTag(b, "oblique", -80, true)).toBe("oblique, -45°, not converted");
        expect(frameTag(b, "oblique", -40, true)).toBe("not converted");
        expect(frameTag(b, null, -80, false)).toBe("not converted");
        expect(frameTag(oblique, "oblique", -80, true)).toBe("oblique, -45°");
        // Above another pitch limit
        expect(frameTag(oblique, "oblique", -40, true)).toBe("left out as unusable");
        expect(frameTag(unusable, "oblique", -80, true)).toBe("left out as unusable");
        expect(frameTag({...unusable, pitch: null}, "oblique", null, true)).toBe("left out as unusable");
        // Before the mosaics are built nothing is left out yet
        expect(frameTag(oblique, null, -80, false)).toBe("");
    });

    it("name a frame under its thumbnail by the end of its name, where a flight's names differ", () => {
        expect(shortName("100MEDIA/DJI_20261022163543_0156_T.JPG")).toBe("…_0156_T.JPG");
        expect(shortName("thermal/a_T.JPG")).toBe("a_T.JPG");
    });

    it("put the frames in the order they were taken, those without a time last", () => {
        const at = (path: string, time?: string) => ({path, time});
        expect(captureOrder([at("c", "2026:10:12 18:30:10"), at("z"), at("b", "2026:10:12 18:29:50"), at("a"),
                             at("a2", "2026:10:12 18:29:50")]).map((f) => f.path)).toEqual(["a2", "b", "c", "a", "z"]);
    });

    it("list the frames the mosaics placed, or all those they left out, converted or not, or all for none", () => {
        const c = {path: "c.JPG", pitch: -50, converted: true, mosaic: null};
        const frames = [...FRAMES.frames!, c];
        expect(listFrames(frames, "mosaic").map((f) => f.path)).toEqual([A]);
        // B was skipped by the conversion's pitch limit, c converted and left out by the mosaics
        expect(listFrames(frames, "oblique").map((f) => f.path)).toEqual([B, "c.JPG"]);
        expect(listFrames(frames, null)).toEqual(frames);
        // None left out: the list is empty, not all of them
        expect(listFrames([FRAMES.frames![0]], "oblique")).toEqual([]);
        // Before the mosaics placed any, all of them
        const unbuilt = frames.map((f) => ({...f, mosaic: null}));
        expect(listFrames(unbuilt, "mosaic")).toEqual(unbuilt);
        expect(listFrames(unbuilt, "oblique")).toEqual(unbuilt);
        expect([listTitle("mosaic"), listTitle("oblique"), listTitle(null)])
            .toEqual(["frames in the mosaic", "oblique frames", "frames"]);
    });

    it("read the changes typed: only those moved from their start, checked against their limits", () => {
        expect(readChanges({emissivity: "0.91", humidity: "", distance: "21.40"}, {emissivity: "0.91", distance: "21.4"}))
            .toEqual({changes: {}});
        expect(readChanges({emissivity: "0.98", distance: " 30 "}, {emissivity: "0.91"})).toEqual({changes: {emissivity: 0.98, distance: 30}});
        expect(readChanges({humidity: "120"})).toEqual({error: "The humidity is between 0 and 100 %", field: "humidity"});
        expect(readChanges({distance: "far"})).toEqual({error: "Distance (m): not a number", field: "distance"});
        expect(readChanges({ambient_temp: "-300"}).error).toBe("A temperature is above absolute zero (-273.15 °C)");
    });

    it("read the temperatures in the user's unit and send them in the conversion's", () => {
        setUserUnit("F");
        expect(readChanges({reflected_temp: "-500"}).error).toBe("A temperature is above absolute zero (-459.67 °F)");
        expect(changesIn({reflected_temp: 68, emissivity: 0.9}, "C")).toEqual({reflected_temp: 20, emissivity: 0.9});
    });

    it("make the values' URL and a new conversion's with the changes", () => {
        expect(newConversionUrl("/p/", 5, 9, {emissivity: 0.98})).toBe("/p/dataset/5?from=9&emissivity=0.98#datasets");
        expect(valuesUrl("/api/", 9, A, {distance: 30})).toBe("/api/conversions/9/frame/data?frame=thermal%2Fa_T.JPG&distance=30");
        expect(valuesUrl("/api/", 9, A, {})).toBe("/api/conversions/9/frame/data?frame=thermal%2Fa_T.JPG");
    });
});

describe("the frame's panel", () => {
    it("says whether the frame's normalization offset is known", () => {
        render(<Info info={INFO} unit="C" normalized={true}/>, byId("root"));
        expect(byId("root").textContent).toContain("offset -0.20 °C applied");
        render(<Info info={{...INFO, offset_known: false}} unit="C" normalized={true}/>, byId("root"));
        expect(byId("root").textContent).toContain("offset is not known");
        expect(byId("root").textContent).toContain("640 × 512 px");
    });

    it("reads out the pixel as converted and with the parameters changed, and their difference", () => {
        render(<FrameReadout point={{inside: true, x: 12.7, y: 3.2, temperature: 20, changed: 21.5}} unit="C"/>, byId("root"));
        expect(byId("root").textContent).toContain("12, 3");
        expect(byId("root").textContent).toContain("Parameters changed21.50 °C");
        expect(byId("root").textContent).toContain("Difference+1.50 °C");
        render(<FrameReadout point={{inside: false}} unit="C"/>, byId("root"));
        expect(byId("root").textContent).toBe("Outside the frame.");
    });
});

describe("the frame page", () => {
    it("shows the first frame with its range, figures, parameters and the way back to the mosaics", async () => {
        const fetchFn = server(routes());
        await open(fetchFn);
        expect(byId("name").textContent).toBe("Nadir: frames");
        expect(shownFrame()).toBe(A);
        // Captured in the flight's local time, labelled with its zone, in the locale chosen
        expect(byId("about").textContent).toBe("12/10/2026, 18:29:50 (UTC−5) · frame 1 of the mosaics");
        expect(byId("mosaics").getAttribute("href")).toBe("/conversion/9?frame=thermal%2Fa_T.JPG");
        expect((byId("range-min") as HTMLInputElement).value).toBe("17");
        expect((byId("range-max") as HTMLInputElement).value).toBe("28");
        expect(valuesOf("map")).toBe(BASE + "/frame/data?frame=thermal%2Fa_T.JPG");
        expect(byId("changed-pane").hidden).toBe(true);
        expect($("[data-section=info]")!.textContent).toContain("640 × 512 px");
        expect($("[data-section=parameters]")!.textContent).toContain("The distance is the rangefinder.");
        expect(($("input[name=emissivity]") as HTMLInputElement).value).toBe("0.91");
        expect($(".map-legend")).toBeNull();
        expect($(".viewer-panel .scale, .frame-panel .scale")!.textContent).toContain("Temperature, °C");
        expect(location.search).toBe("?palette=dji_ironred&min=17&max=28&frame=thermal%2Fa_T.JPG");
        expect(calls(fetchFn)).toContain("GET " + BASE + "/measurements?frame=" + enc(A));
    });

    it("puts the flight's visual photos on the frames' map when switched on, kept for the next visit", async () => {
        const added = vi.spyOn(VectorSource.prototype, "addFeature");
        const placed = {...FRAMES, frames: FRAMES.frames!.map((f, i) => ({...f, lat: 42.1, lon: -88.07 + i * 0.0001})),
                        visual_photos: [{path: "rgb/a_V.JPG", lat: 42.1, lon: -88.07}]};
        await open(server(routes({[BASE + "/frames"]: placed})));
        const tips = () => added.mock.calls.map((c) => c[0].get("tip") as string);
        expect(tips()).toEqual([A, B]);
        const box = byId("locator-visual") as HTMLInputElement;
        expect(box.checked).toBe(false);
        click(box);
        await ticks();
        expect(tips()).toEqual([A, B, "rgb/a_V.JPG"]);
        expect(localStorage.getItem("thermal-analyzer.frame.locator-visual")).toBe("1");
        added.mockRestore();
    });

    it("offers no visual photos on the frames' map when none has a position", async () => {
        await open(server(routes({[BASE + "/frames"]: {...FRAMES, frames: FRAMES.frames!.map((f) => ({...f, lat: 42.1, lon: -88.07}))}})));
        expect($("#locator")).not.toBeNull();
        expect($("#locator-visual")).toBeNull();
    });

    it("shows the frame's visual pair on its switch, kept for the next visit, and the frame where it has none", async () => {
        const pair = {frame: "rgb/a_V.JPG", width: 4032, height: 3024, homography: [4, 0, 0, 0, 4, 0, 0, 0, 1]};
        const added = vi.spyOn(OlMap.prototype, "addLayer");
        await open(server(routes({[BASE + "/frame?frame=" + enc(A)]: {...INFO, visual: pair}})));
        expect(byId("pane-title").textContent).toBe("As converted");
        click($(".frame-camera button[name=visual]")!);
        await ticks(10);
        const layers = added.mock.calls.map((c) => c[0]);
        const image = layers.find((l) => l instanceof ImageLayer) as ImageLayer<ImageStatic>;
        const values = layers.find((l) => l instanceof WebGLTileLayer)!;
        expect(image.getSource()!.getUrl()).toBe(BASE + "/frame/visual?frame=" + enc(A));
        expect(image.getSource()!.getImageExtent()).toEqual([0, -3024, 4032, 0]);
        expect([image.getVisible(), values.getVisible()]).toEqual([true, false]);
        expect(byId("pane-title").textContent).toBe("Visual · a_V.JPG (the readout and the shapes are the thermal frame's)");
        expect($(".map-legend")).toBeNull();
        expect(localStorage.getItem("thermal-analyzer.frame.visual")).toBe("1");
        // B has no visual pair: its frame is shown, without the switch
        click(byId("next"));
        await ticks(40);
        expect($(".frame-camera")).toBeNull();
        expect([image.getVisible(), values.getVisible()]).toEqual([false, true]);
        expect(byId("pane-title").textContent).toBe("As converted");
        added.mockRestore();
    });

    it("shows the frame and its visual pair side by side on Both, the pair's view following the frame's", async () => {
        const pair = {frame: "rgb/a_V.JPG", width: 4032, height: 3024, homography: [4, 0, 0, 0, 4, 0, 0, 0, 1]};
        const added = vi.spyOn(OlMap.prototype, "addLayer");
        await open(server(routes({[BASE + "/frame?frame=" + enc(A)]: {...INFO, visual: pair}})));
        expect(byId("pair-pane").hidden).toBe(true);
        click($(".frame-camera button[name=both]")!);
        await ticks(10);
        expect($(".frame-camera [aria-pressed=true]")!.textContent).toBe("Both");
        expect(byId("pair-pane").hidden).toBe(false);
        expect(byId("pair-pane").querySelector(".frame-pane-title")!.textContent).toBe("Visual · a_V.JPG");
        expect(byId("pane-title").textContent).toBe("As converted");
        expect(localStorage.getItem("thermal-analyzer.frame.visual")).toBe("2");
        const mapOf = (id: string) => (added.mock.contexts as OlMap[]).find((m) => m.getTargetElement()?.id === id)!;
        const [frameMap_, side] = [mapOf("map"), mapOf("map-pair")];
        const image = side.getLayers().getArray().find((l) => l instanceof ImageLayer) as ImageLayer<ImageStatic>;
        expect(image.getSource()!.getUrl()).toBe(BASE + "/frame/visual?frame=" + enc(A));
        expect(image.getVisible()).toBe(true);
        // The frame stays shown on the first pane, with its colour scale
        expect(frameMap_.getLayers().getArray().find((l) => l instanceof WebGLTileLayer)!.getVisible()).toBe(true);
        expect($(".map-legend")).toBeNull();
        // Each view follows the other through the pair (here four visual pixels to a frame's)
        frameMap_.getView().setCenter([100, -50]);
        frameMap_.getView().setResolution(1);
        expect(side.getView().getCenter()).toEqual([400, -200]);
        expect(side.getView().getResolution()).toBeCloseTo(4);
        side.getView().setCenter([200, -100]);
        expect(frameMap_.getView().getCenter()).toEqual([50, -25]);
        // Back to the frame alone
        click($(".frame-camera button[name=thermal]")!);
        await ticks(10);
        expect(byId("pair-pane").hidden).toBe(true);
        expect(image.getVisible()).toBe(false);
        added.mockRestore();
    });

    it("opens the frame, palette and range a link asks for", async () => {
        history.replaceState(null, "", "/conversion/9/frame?palette=magma&min=18&max=32&frame=" + enc(B));
        await open(server(routes()));
        expect(shownFrame()).toBe(B);
        expect((byId("palette") as HTMLSelectElement).value).toBe("magma");
        expect(byId("mosaics").getAttribute("href")).toBe("/conversion/9");
        expect(valuesOf("map")).toBe(BASE + "/frame/data?frame=" + enc(B));
        expect((byId("range-min") as HTMLInputElement).value).toBe("18");
    });

    it("shows only the frames of the list it was opened with, keeping the list in the URL", async () => {
        history.replaceState(null, "", "/conversion/9/frame?list=mosaic");
        await open(server(routes()));
        expect(byId("name").textContent).toBe("Nadir: frames in the mosaic");
        expect(listed()).toEqual([A]);
        expect((byId("next") as HTMLButtonElement).disabled).toBe(true);
        expect(location.search).toMatch(/^\?palette=.*&frame=thermal%2Fa_T.JPG&list=mosaic$/);
    });

    it("switches between all the frames, those in the mosaic and the oblique ones, each with its count", async () => {
        history.replaceState(null, "", "/conversion/9/frame");
        await open(server(routes({[BASE + "/frame?frame=" + enc(B)]: {...INFO, frame: B},
                                  [BASE + "/measurements?frame=" + enc(B)]: {measurements: []},
                                  [BASE + "/frame/data?frame=" + enc(B)]: valuesResponse(4, 3)})));
        const lists = () => [...document.querySelectorAll(".frame-lists button")].map((b) =>
            [b.textContent, b.getAttribute("aria-pressed")]);
        expect(lists()).toEqual([["All 2", "true"], ["In the mosaic 1", "false"], ["Oblique 1", "false"]]);
        expect(listed()).toEqual([A, B]);
        // The frame shown kept when it is in the list chosen, else its first shown
        click($(".frame-lists button[name=mosaic]")!);
        await ticks(40);
        expect(byId("name").textContent).toBe("Nadir: frames in the mosaic");
        expect(listed()).toEqual([A]);
        expect(shownFrame()).toBe(A);
        expect(location.search).toMatch(/&list=mosaic$/);
        click($(".frame-lists button[name=oblique]")!);
        await ticks(40);
        expect(listed()).toEqual([B]);
        expect(shownFrame()).toBe(B);
        click($(".frame-lists button[name=all]")!);
        await ticks(40);
        expect(listed()).toEqual([A, B]);
        expect(shownFrame()).toBe(B);
        expect(location.search).not.toContain("list=");
    });

    it("shows all the frames for a list that has none, and no switch before the mosaics placed frames", async () => {
        const frames = {...FRAMES, frames: FRAMES.frames!.map((f) => ({...f, mosaic: null}))};
        history.replaceState(null, "", "/conversion/9/frame?list=oblique");
        await open(server(routes({[BASE + "/frames"]: frames})));
        expect(byId("name").textContent).toBe("Nadir: frames");
        expect(listed()).toEqual([A, B]);
        expect($(".frame-lists")).toBeNull();
        expect(location.search).not.toContain("list=");
    });

    it("lists as oblique the frames the conversion skipped for their angle, not those in the mosaic", async () => {
        history.replaceState(null, "", "/conversion/9/frame?list=oblique");
        await open(server(routes({[BASE + "/frame?frame=" + enc(B)]: {...INFO, frame: B},
                                  [BASE + "/measurements?frame=" + enc(B)]: {measurements: []},
                                  [BASE + "/frame/data?frame=" + enc(B)]: valuesResponse(4, 3)})));
        expect(byId("name").textContent).toBe("Nadir: oblique frames");
        expect(listed()).toEqual([B]);
        expect(shownFrame()).toBe(B);
    });

    it("lists the frames in the order they were taken, the first shown, as a list or thumbnails kept for the next visit", async () => {
        const C = "thermal/c_T.JPG";
        const frames = {...FRAMES, frames: [...FRAMES.frames!, {path: C, pitch: -40, time: "2026:10:12 18:29:40", converted: true,
                                                                   mosaic: null, recorded: {}}]};
        const fetchFn = server(routes({[BASE + "/frames"]: frames, [BASE + "/frame?frame=" + enc(C)]: {...INFO, frame: C},
                                       [BASE + "/measurements?frame=" + enc(C)]: {measurements: []},
                                       [BASE + "/frame/data?frame=" + enc(C)]: valuesResponse(4, 3)}));
        await open(fetchFn);
        expect(listed()).toEqual([C, A, B]);
        expect(shownFrame()).toBe(C);
        expect(byId("frame").textContent).toBe("c_T.JPG");
        expect(byId("frame-count").textContent).toBe("3 frames");
        expect([...document.querySelectorAll("#frames .frame-item-about")].map((e) => e.textContent)).toEqual([
            "18:29:40 · oblique, -40°", "18:29:50 · in the mosaic", "18:30:10 · oblique, -45°, not converted"]);
        expect($("#frames img")).toBeNull();
        // Choosing one shows it
        click($("#frames [data-path='" + B + "']")!);
        await ticks(40);
        expect(shownFrame()).toBe(B);
        expect(calls(fetchFn)).toContain("GET " + BASE + "/frame?frame=" + enc(B));
        expect(location.search).toContain("frame=thermal%2Fb_T.JPG");
        // As thumbnails, remembered
        click($(".frame-list-head button[name=thumbnails]")!);
        await ticks();
        expect($(".frame-list-head [aria-pressed=true]")!.textContent).toBe("Thumbnails");
        expect([...document.querySelectorAll("#frames img")].map((i) => i.getAttribute("src"))).toEqual(
            [C, A, B].map((f) => API + "datasets/5/thumbnail?file=" + enc(f)));
        expect(localStorage.getItem("thermal-analyzer.frame.thumbnails")).toBe("1");
        render(null, byId("root"));
        await open(fetchFn);
        expect($("#frames.thumbs img")).not.toBeNull();
    });

    it("does not put a measurement answered late on the frame moved to", async () => {
        const start = vi.spyOn(Drawing.prototype, "start");
        let answer: (r: Response) => void = () => undefined;
        const fetchFn = server(routes({["POST " + BASE + "/measure"]: () => new Promise<Response>((r) => { answer = r; })}));
        await open(fetchFn);
        click($(".map-tools [data-tool=point]")!);
        await ticks();
        const d = start.mock.contexts.at(-1) as unknown as Drawing;
        d.stop();
        (d as unknown as {opts: {onDone: (g: unknown) => void}}).opts.onDone({type: "Point", coordinates: [1, 2]});
        await ticks(40);
        key(document.body, "ArrowRight");
        await ticks(40);
        expect(shownFrame()).toBe(B);
        answer(await jsonResponse({result: {kind: "Point", valid_pixels: 1, value: 30, mean: 30}}));
        await ticks(40);
        expect($("#measure-card")).toBeNull();
    });

    it("measures a Delta T on the frame, in pixels", async () => {
        const start = vi.spyOn(Drawing.prototype, "start");
        const result = {kind: "LineString", first: 22.2, second: 27.2, delta_t: 5, length: 5, valid_pixels: 22, reason: null};
        const fetchFn = server(routes({["POST " + BASE + "/measure"]: {result, unit: "C", approximate: false}}));
        await open(fetchFn);
        expect([...document.querySelectorAll(".map-tools [data-tool]")].map((b) => b.getAttribute("data-tool")).at(-1)).toBe("delta");
        click($(".map-tools [data-tool=delta]")!);
        await ticks();
        const d = start.mock.contexts.at(-1) as unknown as Drawing;
        d.stop();
        const line = {type: "LineString", coordinates: [[2.5, 3.5], [7.5, 3.5]]};
        (d as unknown as {opts: {onDone: (g: unknown, s: unknown) => void}}).opts.onDone(line, {kind: "delta"});
        await ticks(40);
        const body = JSON.parse(String(fetchFn.mock.calls.filter((c) => c[0] === BASE + "/measure").at(-1)![1]!.body));
        expect(body).toMatchObject({target: "frame", frame: A, geometry: line, shape: {kind: "delta"}});
        const card = byId("result").textContent;
        expect(card).toContain("Length5 px");
        expect(card).toContain("ΔT+5.00 °C");
    });

    it("measures the frame again with the parameters changed, beside it as converted", async () => {
        const changedInfo = {...INFO, changed: {...INFO, stats: {...INFO.stats, mean: 22.5}}};
        const fetchFn = server(routes({[BASE + "/frame?frame=" + enc(A) + "&emissivity=0.98"]: changedInfo}));
        await open(fetchFn);
        type($("input[name=humidity]")!, "120");
        await ticks();
        click(byId("change-apply"));
        await ticks();
        expect(byId("change-error").textContent).toBe("The humidity is between 0 and 100 %");
        type($("input[name=humidity]")!, "50");
        type($("input[name=emissivity]")!, "0.98");
        await ticks();
        key($("input[name=emissivity]")!, "Enter");
        await ticks(40);
        expect(calls(fetchFn)).toContain("GET " + BASE + "/frame?frame=" + enc(A) + "&emissivity=0.98");
        expect(byId("changed-pane").hidden).toBe(false);
        expect(valuesOf("map")).not.toContain("emissivity");
        expect(valuesOf("map-changed")).toContain("&emissivity=0.98");
        expect(byId("new-conversion").getAttribute("href")).toBe("/dataset/5?from=9&emissivity=0.98#datasets");
        click(byId("change-clear"));
        await ticks(40);
        expect(byId("changed-pane").hidden).toBe(true);
        expect(($("input[name=emissivity]") as HTMLInputElement).value).toBe("0.91");
    });

    it("exports this frame as shown, with the parameters changed when asked", async () => {
        const changedInfo = {...INFO, changed: {...INFO, stats: {...INFO.stats, mean: 22.5}}};
        const fetchFn = server(routes({[BASE + "/frame?frame=" + enc(A) + "&emissivity=0.98"]: changedInfo,
                                       ["POST " + API + "datasets/5/exports"]: {url: "/api/exports/ab"}}));
        const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
        await open(fetchFn);
        type($("input[name=emissivity]")!, "0.98");
        await ticks();
        key($("input[name=emissivity]")!, "Enter");
        await ticks(40);
        click(byId("export"));
        await ticks();
        expect(byId("export-dialog").textContent).toContain("“thermal/a_T.JPG”");
        // The conversion is normalized: its R-JPEGs and originals can't be made
        expect(($("input[name=export-format][value=original]") as HTMLInputElement).disabled).toBe(true);
        const png = $("input[name=export-format][value=png]") as HTMLInputElement;
        png.checked = true;
        png.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        const changed = $("input[name=export-changes][value='1']") as HTMLInputElement;
        changed.checked = true;
        changed.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        click(byId("export-save"));
        await ticks();
        const post = fetchFn.mock.calls.find((c) => c[1]?.method === "POST")!;
        expect(JSON.parse(String(post[1]!.body))).toMatchObject({format: "png", frames: [A], conversion: 9,
            changes: {emissivity: 0.98}, view: {palette: "dji_ironred", gamma: 1, equalize: false, sharpen: 0}});
        expect(download).toHaveBeenCalledTimes(1);
        expect(byId("export-dialog")).toBeNull();
        download.mockRestore();
    });

    it("steps through the frames with the arrows and the buttons, not while typing", async () => {
        const fetchFn = server(routes());
        await open(fetchFn);
        expect((byId("prev") as HTMLButtonElement).disabled).toBe(true);
        key(document.body, "ArrowRight");
        await ticks(40);
        expect(shownFrame()).toBe(B);
        expect(byId("about").textContent).toBe("12/10/2026, 18:30:10 (UTC−5)");
        expect(calls(fetchFn)).toContain("GET " + BASE + "/frame?frame=" + enc(B));
        expect(location.search).toContain("frame=thermal%2Fb_T.JPG");
        key($("input[name=emissivity]")!, "ArrowLeft");
        await ticks();
        expect(shownFrame()).toBe(B);
        click(byId("prev"));
        await ticks(40);
        expect(shownFrame()).toBe(A);
    });

    it("shows the measurements saved on the frame and measures one again with other parameters", async () => {
        const again = {...SAVED, parameters: {emissivity: 0.95}};
        const fetchFn = server(routes({
            [BASE + "/measurements?frame=" + enc(A)]: {measurements: [SAVED]},
            ["PATCH " + BASE + "/measurements/4"]: again,
        }));
        await open(fetchFn);
        expect(byId("csv").getAttribute("href")).toBe(BASE + "/measurements.csv");
        click($("[data-measurement='4'] a")!);
        await ticks();
        expect($(".map-stage #measure-card .measure-card-head")!.textContent).toContain("Hot spot");
        expect(byId("result").textContent).toContain("Saved");
        expect($("#measure-card [name=keep-finding]")).toBeNull();
        click($("[data-measurement='4'] [title='Measure again with other parameters']")!);
        await ticks();
        type($("[data-param-field=emissivity]")!, "0.95");
        await ticks();
        click([...document.querySelectorAll(".params-form button")].find((b) => b.textContent === "Measure again")!);
        await ticks(40);
        const patch = fetchFn.mock.calls.find((c) => c[1]?.method === "PATCH")!;
        expect(JSON.parse(String(patch[1]!.body))).toEqual({parameters: {emissivity: 0.95}});
    });

    it("says when the dataset has no frames", async () => {
        await open(server(routes({[BASE + "/frames"]: {...FRAMES, frames: []}})));
        expect(byId("status").textContent).toBe("The flight has no thermal frames to show.");
    });
});

describe("the frames of a visual mosaic of its own", () => {
    const V1 = "rgb/a_V.JPG", V2 = "rgb/b_V.JPG", V3 = "rgb/c_V.JPG";
    const VISUAL: Frames = {
        name: "Visual mosaic", dataset_name: "RGB", mosaic_status: "ready", max_pitch: -80, flight_zone: {offset: -300},
        visual_only: true,
        frames: [{path: V2, pitch: -90, time: "2026:10:12 18:30:10", lat: 42.1, lon: -88.07, converted: true, mosaic: 1,
                  recorded: {alt: 30.5}},
                 {path: V1, pitch: -90, time: "2026:10:12 18:29:50", lat: 42.1, lon: -88.07, converted: true, mosaic: 0,
                  recorded: {alt: 30.4}},
                 {path: V3, pitch: -30, time: "2026:10:12 18:30:30", converted: true, mosaic: null, recorded: {}}],
    };

    it("shows each visual photo as taken, in the order they were taken, stepped with ← and →, with no temperatures", async () => {
        const fetchFn = server({[BASE + "/frames"]: VISUAL});
        await open(fetchFn);
        expect(byId("photo").getAttribute("src")).toBe(BASE + "/frame/visual?frame=" + enc(V1) + "&size=1600");
        expect(listed()).toEqual([V1, V2, V3]);
        expect(byId("name").textContent).toBe("Visual mosaic: frames");
        const recorded = byId("recorded").textContent;
        expect(recorded).toContain("Height above take-off30.4 m");
        expect(recorded).toContain("In the mosaicframe 1");
        expect(byId("full-size").getAttribute("href")).toBe(BASE + "/frame/visual?frame=" + enc(V1));
        expect(calls(fetchFn).some((c) => c.includes("/frame?frame=") || c.includes("/frame/data"))).toBe(false);
        key(document.body, "ArrowRight");
        await ticks();
        expect(byId("photo").getAttribute("src")).toContain(enc(V2));
        expect(location.search).toBe("?frame=" + enc(V2));
        click(byId("next"));
        await ticks();
        expect(byId("recorded").textContent).toContain("In the mosaicno");
        expect((byId("next") as HTMLButtonElement).disabled).toBe(true);
        expect($("#palette")).toBeNull();
    });
});

describe("Temperature On Pointer on the frame page", () => {
    it("shows the frame's temperature beside the pointer once ticked, and none outside the frame", async () => {
        localStorage.setItem("thermal-analyzer.pointer-temperature", "1");
        const added = vi.spyOn(OlMap.prototype, "addLayer");
        const routed = server(routes());
        const fetchFn = vi.fn((url: string, opts?: RequestInit) => {
            if (url.includes("/frame/point?")) {
                const x = parseFloat(new URLSearchParams(url.split("?")[1]).get("x")!);
                return Promise.resolve(jsonResponse(x < 2 ? {inside: true, x, y: 1, temperature: 30.25} : {inside: false}));
            }
            return routed(url, opts);
        }) as unknown as ReturnType<typeof server>;
        await open(fetchFn);
        const m = (added.mock.contexts as OlMap[]).find((x) => x.getTargetElement()?.id === "map")!;
        const move = (at: number[]) => {
            const e = new MapBrowserEvent("pointermove", m, new MouseEvent("pointermove") as PointerEvent);
            e.coordinate = at;
            m.dispatchEvent(e);
        };
        const tip = () => byId("map").querySelector(".map-tip.pointer-temperature") as HTMLElement;
        expect((byId("pointer-temperature") as HTMLInputElement).checked).toBe(true);
        move([1, -1]);
        await new Promise((r) => setTimeout(r, 200));
        await ticks(20);
        expect([tip().hidden, tip().textContent]).toEqual([false, "30.25 °C"]);
        move([3, -1]);
        await new Promise((r) => setTimeout(r, 200));
        await ticks(20);
        expect(byId("readout").textContent).toContain("Outside the frame.");
        expect(tip().hidden).toBe(true);
    });
});

describe("Delta T Around Pointer on the frame page", () => {
    it("asks for a circle in the frame's pixels once ticked, outlines it and shows its figures", async () => {
        const added = vi.spyOn(OlMap.prototype, "addLayer");
        const routed = server(routes());
        const fetchFn = vi.fn((url: string, opts?: RequestInit) => {
            if (url.includes("/frame/point?")) {
                const r = new URLSearchParams(url.split("?")[1]).get("around");
                return Promise.resolve(jsonResponse({inside: true, x: 1, y: 1, temperature: 30.25,
                    ...(r ? {around: {radius: parseFloat(r), pixels: 300, mean: 29, min: 27, max: 31, delta_t: 1.25}} : {})}));
            }
            return routed(url, opts);
        }) as unknown as ReturnType<typeof server>;
        await open(fetchFn);
        const m = (added.mock.contexts as OlMap[]).find((x) => x.getTargetElement()?.id === "map")!;
        const move = (at: number[]) => {
            const e = new MapBrowserEvent("pointermove", m, new MouseEvent("pointermove") as PointerEvent);
            e.coordinate = at;
            m.dispatchEvent(e);
        };
        const rest = async () => { await new Promise((r) => setTimeout(r, 200)); await ticks(20); };
        const points = () => calls(fetchFn).filter((c) => c.includes("/frame/point?"));
        const outline = () => (m.getLayers().getArray().find((l) => l.getZIndex() === 13) as unknown as
            {getSource: () => {getFeatures: () => {getGeometry: () => {getExtent: () => number[]}}[]}}).getSource().getFeatures();
        const box = byId("pointer-delta") as HTMLInputElement;
        expect(box.checked).toBe(false);
        move([1, -1]);
        await rest();
        expect(points().at(-1)).not.toContain("around=");

        click(box);
        await ticks();
        const slider = document.querySelector("[name=pointer-delta-radius]") as HTMLInputElement;
        // It stops at every pixel from 3 to 50: 10 at first
        expect([slider.value, slider.min, slider.max]).toEqual(["7", "0", "47"]);
        move([1, -1]);
        // 10 px of the frame each way
        const e = outline()[0].getGeometry().getExtent();
        expect((e[2] - e[0]) / 2).toBeCloseTo(10, 1);
        await rest();
        expect(points().at(-1)).toContain("around=10");
        expect(byId("pointer-delta-figures").textContent).toContain("ΔT+1.25 °C");
        const deltaTip = document.querySelector(".pointer-delta-tip") as HTMLElement;
        expect([deltaTip.hidden, deltaTip.textContent]).toEqual([false, "ΔT +1.25 °C"]);
        expect(localStorage.getItem("thermal-analyzer.pointer-delta-radius.frame")).toBeNull();
        slider.value = "17";
        slider.dispatchEvent(new Event("input", {bubbles: true}));
        await ticks();
        expect(localStorage.getItem("thermal-analyzer.pointer-delta-radius.frame")).toBe("20");
        m.getViewport()!.dispatchEvent(new MouseEvent("mouseleave"));
        expect(outline()).toHaveLength(0);
        expect(deltaTip.hidden).toBe(true);
    });
});
