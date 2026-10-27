import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import {changesIn, type FrameInfo, frameLabel, newConversionUrl, readChanges, valuesUrl} from "../src/frame/frame";
import {FramePage, type Frames} from "../src/frame/frame-page";
import {FrameReadout, Info} from "../src/frame/panel";
import {calls, click, key, server, ticks, valuesResponse} from "./helpers";

const API = "/api/";
const BASE = API + "conversions/9";
const A = "thermal/a_T.JPG", B = "thermal/b_T.JPG";
const FRAMES: Frames = {
    name: "Nadir", dataset_name: "Roof", description: "temp_c tiff", unit: "C", normalized: true, default_palette: "dji_ironred",
    palettes: [{key: "dji_ironred", label: "DJI ironred", color_map: [0x000000, 0xff0000]},
               {key: "magma", label: "Magma", color_map: [0x000004, 0xfcfdbf]}],
    frames: [{path: A, pitch: -90, time: "18:29:50", converted: true, mosaic: 0,
              recorded: {emissivity: 0.91, humidity: 50, lrf: 21.4, reflection: 27.6, ambient: 27.6}},
             {path: B, pitch: -45, time: "18:30:10", converted: false, mosaic: null, recorded: {}}],
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
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
    history.replaceState(null, "", "/conversion/9/frame");
});
afterEach(() => {
    render(null, byId("root"));
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
    localStorage.clear();
    setUserUnit("C");
});

describe("the frame helpers", () => {
    it("label a frame with whether it is in the mosaics, oblique or not converted", () => {
        expect(frameLabel(FRAMES.frames![0])).toBe("thermal/a_T.JPG (in the mosaics)");
        expect(frameLabel(FRAMES.frames![1])).toBe("thermal/b_T.JPG (oblique, -45°, not converted)");
        expect(frameLabel({path: "c.JPG", pitch: -90, converted: true, mosaic: null})).toBe("c.JPG");
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
        expect(newConversionUrl("/p/", 5, 9, {emissivity: 0.98})).toBe("/p/dataset/5?from=9&emissivity=0.98#convert");
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
        expect((byId("frame") as HTMLSelectElement).value).toBe(A);
        expect(byId("about").textContent).toBe("18:29:50 · frame 1 of the mosaics");
        expect(byId("mosaics").getAttribute("href")).toBe("/conversion/9?frame=thermal%2Fa_T.JPG");
        expect((byId("range-min") as HTMLInputElement).value).toBe("17");
        expect((byId("range-max") as HTMLInputElement).value).toBe("28");
        expect(valuesOf("map")).toBe(BASE + "/frame/data?frame=thermal%2Fa_T.JPG");
        expect(byId("changed-pane").hidden).toBe(true);
        expect($("[data-section=info]")!.textContent).toContain("640 × 512 px");
        expect($("[data-section=parameters]")!.textContent).toContain("The distance is the rangefinder.");
        expect(($("input[name=emissivity]") as HTMLInputElement).value).toBe("0.91");
        expect($(".map-legend")!.textContent).toContain("Temperature, °C");
        expect(location.search).toBe("?palette=dji_ironred&min=17&max=28&frame=thermal%2Fa_T.JPG");
        expect(calls(fetchFn)).toContain("GET " + BASE + "/measurements?frame=" + enc(A));
    });

    it("opens the frame, palette and range a link asks for", async () => {
        history.replaceState(null, "", "/conversion/9/frame?palette=magma&min=18&max=32&frame=" + enc(B));
        await open(server(routes()));
        expect((byId("frame") as HTMLSelectElement).value).toBe(B);
        expect((byId("palette") as HTMLSelectElement).value).toBe("magma");
        expect(byId("mosaics").getAttribute("href")).toBe("/conversion/9");
        expect(valuesOf("map")).toBe(BASE + "/frame/data?frame=" + enc(B));
        expect((byId("range-min") as HTMLInputElement).value).toBe("18");
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
        expect(byId("new-conversion").getAttribute("href")).toBe("/dataset/5?from=9&emissivity=0.98#convert");
        click(byId("change-clear"));
        await ticks(40);
        expect(byId("changed-pane").hidden).toBe(true);
        expect(($("input[name=emissivity]") as HTMLInputElement).value).toBe("0.91");
    });

    it("steps through the frames with the arrows and the buttons, not while typing", async () => {
        const fetchFn = server(routes());
        await open(fetchFn);
        expect((byId("prev") as HTMLButtonElement).disabled).toBe(true);
        key(document.body, "ArrowRight");
        await ticks(40);
        expect((byId("frame") as HTMLSelectElement).value).toBe(B);
        expect(byId("about").textContent).toBe("18:30:10");
        expect(calls(fetchFn)).toContain("GET " + BASE + "/frame?frame=" + enc(B));
        expect(location.search).toContain("frame=thermal%2Fb_T.JPG");
        key($("input[name=emissivity]")!, "ArrowLeft");
        await ticks();
        expect((byId("frame") as HTMLSelectElement).value).toBe(B);
        click(byId("prev"));
        await ticks(40);
        expect((byId("frame") as HTMLSelectElement).value).toBe(A);
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
        expect(byId("result").textContent).toContain("Saved as Hot spot");
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
        expect(byId("status").textContent).toBe("The dataset has no thermal frames to show.");
    });
});
