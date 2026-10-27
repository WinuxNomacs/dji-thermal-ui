import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import {type Mosaics, ViewerPage} from "../src/viewer/viewer-page";
import {calls, click, server, ticks} from "./helpers";

const API = "/api/";
const BASE = API + "conversions/9";
const BOUNDS = [10, 50, 10.001, 50.001];
const MOSAICS: Mosaics = {
    name: "Nadir", dataset_name: "Roof", description: "temp_c tiff", stripped: true, status: "ready", mosaic_status: "ready",
    unit: "C", default_palette: "ironred",
    tabs: [{tab: "as_converted", kind: "as_converted", stats: {percentiles: [20.04, 30.06], min: 15, max: 40}, bounds: BOUNDS, maxzoom: 22},
           {tab: "harmonized", kind: "harmonized", stats: {percentiles: [21, 29], min: 16, max: 39}, bounds: BOUNDS, maxzoom: 22},
           {tab: "source_frame", kind: "as_converted", bounds: BOUNDS, maxzoom: 22},
           {tab: "view_angle", kind: "as_converted", stats: {percentiles: [0, 30], min: 0, max: 40}, bounds: BOUNDS, maxzoom: 22}],
    palettes: [{key: "ironred", label: "Iron red", color_map: [0x000000, 0xff0000]},
               {key: "viridis", label: "Viridis", color_map: [0x440154, 0xfde725]}],
    kinds: {as_converted: {frames: 2, width: 100, height: 80, gsd_m: 0.02, files: ["mosaic_temp_c.tif"]}},
    baselines: {as_converted: {emissivity: 0.95, reflected_temp: 20}, harmonized: {emissivity: 0.95, reflected_temp: 20}},
    frames: ["a_T.JPG", "b_T.JPG"], frame_colors: [1, 2, 3], flown: ["2026:10:12 18:29:50"],
};
const WHOLE = {result: {kind: "Polygon", valid_pixels: 8000, mean: 25, percentiles: [22, 28], histogram: [[1, 2], [20, 25, 30]]}};
const SAVED = {id: 4, name: "Hot spot", target: "harmonized", geometry: {type: "Point", coordinates: [10.0005, 50.0005]},
               parameters: {emissivity: 0.9}, values: {result: {kind: "Point", valid_pixels: 1, value: 31.5, mean: 31.5}}};

const $ = (sel: string) => document.querySelector(sel);
const byId = (id: string) => document.getElementById(id)!;
const dialog = () => $(".page .dialog");
const press = (label: string) => click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === label)!);
const change = (el: Element, value: string, type = "change") => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event(type, {bubbles: true}));
};

function routes(extra: Record<string, unknown> = {}) {
    return {
        [BASE + "/mosaics"]: MOSAICS,
        ["POST " + BASE + "/measure"]: WHOLE,
        [BASE + "/measurements"]: {measurements: []},
        ...extra,
    };
}

async function open(fetchFn: ReturnType<typeof server>) {
    vi.stubGlobal("fetch", fetchFn);
    render(<ViewerPage api={API} publicUrl="/" id={9} datasetId={5} datasetName="Roof" basemaps={[]}/>, byId("root"));
    await ticks(40);
}

const measured = (fetchFn: ReturnType<typeof server>) => fetchFn.mock.calls.filter((c) => c[0] === BASE + "/measure")
    .map((c) => JSON.parse(String(c[1]!.body)));

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
    history.replaceState(null, "", "/conversion/9");
});
afterEach(() => {
    render(null, byId("root"));
    vi.unstubAllGlobals();
    vi.useRealTimers();
    history.replaceState(null, "", "/");
    localStorage.clear();
    setUserUnit("C");
});

describe("the viewer page", () => {
    it("shows the first mosaic with its range, the whole mosaic measured and the saved measurements", async () => {
        const fetchFn = server(routes());
        await open(fetchFn);
        expect(byId("name").textContent).toBe("Nadir");
        expect($(".subtitle")!.textContent).toBe("temp_c tiff · location stripped from the downloads");
        expect($(".breadcrumb a")!.getAttribute("href")).toBe("/dataset/5#convert");
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("As converted");
        expect((byId("range-min") as HTMLInputElement).value).toBe("20");
        expect((byId("range-max") as HTMLInputElement).value).toBe("30.1");
        expect(calls(fetchFn)).toEqual(expect.arrayContaining(["GET " + BASE + "/mosaics", "POST " + BASE + "/measure",
                                                               "GET " + BASE + "/measurements"]));
        expect(measured(fetchFn)[0]).toEqual({target: "as_converted", geometry: null, isotherm: "", parameters: {}});
        expect($("[data-section=whole]")!.textContent).toContain("25.00 °C");
        expect($(".map-legend")!.textContent).toContain("Temperature, °C");
        expect(location.search).toBe("?tab=as_converted&palette=ironred&min=20&max=30.1");
    });

    it("keeps its map when a notice appears above it", async () => {
        const fetchFn = server(routes({["POST " + BASE + "/mosaics"]: () => Promise.resolve({ok: false, status: 400,
            json: () => Promise.resolve({error: "Busy"})} as Response)}));
        await open(fetchFn);
        const map = byId("map");
        click(byId("build"));
        await ticks(40);
        expect($(".notice")!.textContent).toBe("Busy");
        expect(byId("map")).toBe(map);
        expect(map.classList.contains("leaflet-container")).toBe(true);
    });

    it("opens the view a link asks for: its tab, palette, range and frame", async () => {
        history.replaceState(null, "", "/conversion/9?tab=harmonized&palette=viridis&min=18&max=32&frame=a_T.JPG");
        const fetchFn = server(routes({[BASE + "/mosaics/footprint?frame=a_T.JPG"]: {type: "FeatureCollection", features: []}}));
        await open(fetchFn);
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Harmonized");
        expect((byId("palette") as HTMLSelectElement).value).toBe("viridis");
        expect((byId("range-min") as HTMLInputElement).value).toBe("18");
        expect(byId("readout").textContent).toContain("a_T.JPG");
        expect(byId("readout").textContent).not.toContain("Temperature");
        expect(byId("open-frame").getAttribute("href")).toBe("/conversion/9/frame?frame=a_T.JPG");
        expect(calls(fetchFn)).toContain("GET " + BASE + "/mosaics/footprint?frame=a_T.JPG");
        expect(location.search).toBe("?tab=harmonized&palette=viridis&min=18&max=32&frame=a_T.JPG");
        click(byId("follow"));
        await ticks();
        expect(byId("readout").textContent).toContain("Move the cursor over the mosaic.");
        expect(location.search).not.toContain("frame=");
    });

    it("keeps one palette and range for both temperature mosaics, and none for the frames' tab", async () => {
        const fetchFn = server(routes());
        await open(fetchFn);
        change(byId("palette"), "viridis");
        await ticks();
        click($("[data-tab=harmonized]")!);
        await ticks();
        expect((byId("palette") as HTMLSelectElement).value).toBe("viridis");
        expect(measured(fetchFn).at(-1).target).toBe("harmonized");
        click($("[data-tab=source_frame]")!);
        await ticks();
        expect(document.getElementById("palette")).toBeNull();
        expect($(".viewer-panel")!.textContent).toContain("2 frames, coloured");
        expect($("[data-section=measure]")).toBeNull();
        expect(location.search).toBe("?tab=source_frame");
    });

    it("refuses a range whose maximum is not above its minimum, and Auto takes the whole mosaic's percentiles", async () => {
        await open(server(routes()));
        change(byId("range-max"), "10");
        await ticks();
        expect(byId("range-error").textContent).toBe("The maximum must be above the minimum");
        expect((byId("range-max") as HTMLInputElement).value).toBe("10");
        expect(location.search).toContain("max=30.1");
        change(byId("range-max"), "35");
        await ticks();
        expect(document.getElementById("range-error")).toBeNull();
        expect(location.search).toContain("min=20&max=35");
        click(byId("auto"));
        await ticks();
        expect(location.search).toContain("min=22&max=28");
    });

    it("moves the range with the brightness slider, drawing it when let go", async () => {
        await open(server(routes()));
        // From the Auto range (the whole mosaic's 22 to 28), half its width down
        click(byId("auto"));
        await ticks();
        const slider = $("input[name=brightness]")!;
        change(slider, "0.5", "input");
        await ticks();
        expect((byId("range-min") as HTMLInputElement).value).toBe("19");
        expect((byId("range-max") as HTMLInputElement).value).toBe("25");
        expect(location.search).toContain("min=22&max=28");
        change(slider, "0.5");
        await ticks();
        expect(location.search).toContain("min=19&max=25");
    });

    it("starts an isotherm from the top of the range, and measures the whole mosaic again with it", async () => {
        const fetchFn = server(routes());
        await open(fetchFn);
        change($("select[aria-label=Isotherm]")!, "above");
        await ticks();
        expect(($("input[aria-label=Temperature]") as HTMLInputElement).value).toBe("27.6");
        expect(measured(fetchFn).at(-1).isotherm).toBe("above,27.6");
        change($("input[aria-label=Temperature]")!, "");
        await ticks();
        expect($(".isotherm [role=alert]")!.textContent).toBe("The isotherm needs a temperature");
    });

    it("applies the correction typed once typing pauses, and marks a value out of range", async () => {
        vi.useFakeTimers();
        const fetchFn = server(routes());
        await open(fetchFn);
        const field = $("input[name=emissivity]")!;
        change(field, "0.9", "input");
        await ticks();
        expect(measured(fetchFn).length).toBe(1);
        vi.advanceTimersByTime(400);
        await ticks();
        expect(measured(fetchFn).at(-1).parameters).toEqual({emissivity: "0.9"});
        change(field, "2");
        await ticks();
        expect(byId("correction-error").textContent).toBe("The emissivity is between 0.1 and 1");
        expect(field.closest("label")!.classList.contains("has-error")).toBe(true);
        expect(measured(fetchFn).length).toBe(2);
    });

    it("shows a saved measurement on its own mosaic, and deletes it after asking", async () => {
        const fetchFn = server(routes({
            [BASE + "/measurements"]: [{measurements: [SAVED]}, {measurements: []}],
            ["DELETE " + BASE + "/measurements/4"]: {},
        }));
        await open(fetchFn);
        expect(byId("csv").getAttribute("href")).toBe(BASE + "/measurements.csv");
        expect(byId("geojson")).not.toBeNull();
        click($("[data-measurement='4'] a")!);
        await ticks();
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Harmonized");
        expect(byId("result").textContent).toContain("Saved as Hot spot");
        expect(byId("result").textContent).toContain("31.50 °C");
        click($("[data-measurement='4'] button[title=Delete]")!);
        await ticks();
        expect(dialog()!.textContent).toContain("Delete the measurement Hot spot?");
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + BASE + "/measurements/4");
        expect($("[data-section=saved]")!.textContent).toContain("No measurements saved yet.");
        expect(byId("result").textContent).not.toContain("Saved as");
    });

    it("follows the mosaics being built until they are ready", async () => {
        vi.useFakeTimers();
        const building = {...MOSAICS, mosaic_status: "building", mosaic_progress: 0.4,
                          stage: {stage: "align", step: 2, steps: 5, done: 3, total: 9, unit: "pairs"}};
        const fetchFn = server(routes({[BASE + "/mosaics"]: [building, MOSAICS]}));
        await open(fetchFn);
        expect(byId("status").textContent).toContain("Building the mosaics: step 2 of 5, aligning, 3/9 pairs…");
        expect(byId("cancel")).not.toBeNull();
        expect(document.getElementById("build")).toBeNull();
        expect(($(".viewer-main") as HTMLElement).hidden).toBe(true);
        vi.advanceTimersByTime(2000);
        await ticks(40);
        expect(document.getElementById("status")).toBeNull();
        expect(byId("build").textContent).toContain("Build the mosaics again");
        expect(($(".viewer-main") as HTMLElement).hidden).toBe(false);
    });

    it("builds the mosaics again, and says why when it cannot", async () => {
        const fetchFn = server(routes({["POST " + BASE + "/mosaics"]: () =>
            Promise.resolve({ok: false, status: 400, json: () => Promise.resolve({detail: "Busy"})} as Response)}));
        await open(fetchFn);
        click(byId("build"));
        await ticks();
        expect(calls(fetchFn)).toContain("POST " + BASE + "/mosaics");
        expect($(".notice.error")!.textContent).toBe("Busy");
    });
});
