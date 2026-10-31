import OlMap from "ol/Map";
import MapBrowserEvent from "ol/MapBrowserEvent";
import {fromLonLat} from "ol/proj";
import TileLayer from "ol/layer/Tile";
import WebGLTileLayer from "ol/layer/WebGLTile";
import type XYZ from "ol/source/XYZ";
import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import type {Finding} from "../src/findings/findings";
import {SLIDERS} from "../src/viewer/view";
import {type Mosaics, ViewerPage} from "../src/viewer/viewer-page";
import {calls, click, jsonResponse, key, server, ticks, valuesResponse} from "./helpers";

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

const FOUND: Finding = {
    id: 7, dataset: 5, name: "Hot joint", notes: "Loose bolt", severity: "high", status: "open",
    geometry: {type: "Point", coordinates: [10.0005, 50.0005]}, shape: null, conversion: 9, conversion_name: "Nadir",
    tab: "as_converted", temperatures: {value: 31.5, unit: "C", approximate: false}, models: true,
    frames: [{frame: "a_T.JPG", used: true, view_angle: 5, time: "2026:10:12 18:29:50", pixel: [3, 4], kept: true},
             {frame: "b_T.JPG", used: false, view_angle: 12, time: "2026:10:12 18:29:52", pixel: [1, 1], kept: false}],
    created_at: "2026-10-27T09:00:00Z", updated_at: "2026-10-27T09:00:00Z",
};
const FINDINGS = API + "datasets/5/findings";

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
        [FINDINGS]: {findings: []},
        [BASE + "/frame/data?frame=a_T.JPG"]: valuesResponse(10, 8),
        [BASE + "/frame/data?frame=b_T.JPG"]: valuesResponse(10, 8),
        ...extra,
    };
}

async function open(fetchFn: ReturnType<typeof server>) {
    vi.stubGlobal("fetch", fetchFn);
    render(<ViewerPage api={API} publicUrl="/" id={9} datasetId={5} datasetName="Roof" basemaps={[]}/>, byId("root"));
    await ticks(40);
}

// The viewer's map (jsdom draws none, so a click on it is made up), and a server whose points are on frame a west of
// the middle and on b east of it, the sources asked answered with none
function viewerMap(): () => OlMap {
    const viewport = vi.spyOn(OlMap.prototype, "getViewport");
    return () => viewport.mock.contexts[0] as OlMap;
}
function clickMap(m: OlMap, lonLat: number[]) {
    const e = new MapBrowserEvent("click", m, new MouseEvent("click") as PointerEvent);
    e.coordinate = fromLonLat(lonLat);
    m.dispatchEvent(e);
}
function pointing(routed: ReturnType<typeof server>) {
    return vi.fn((url: string, opts?: RequestInit) => {
        if (url.includes("/point?")) {
            const lon = parseFloat(new URLSearchParams(url.split("?")[1]).get("lon")!);
            return Promise.resolve(jsonResponse({valid: true, frame: lon < 10.0005 ? "a_T.JPG" : "b_T.JPG"}));
        }
        if (url.includes("/sources")) return Promise.resolve(jsonResponse({kind: "Point", frames: []}));
        return routed(url, opts);
    }) as unknown as ReturnType<typeof server>;
}
const WEST = [10.0002, 50.0005], EAST = [10.0008, 50.0005];
const OUTLINES = {[BASE + "/mosaics/footprint?frame=a_T.JPG"]: {type: "FeatureCollection", features: []},
                  [BASE + "/mosaics/footprint?frame=b_T.JPG"]: {type: "FeatureCollection", features: []}};

const sent = (fetchFn: ReturnType<typeof server>, method: string) =>
    JSON.parse(String(fetchFn.mock.calls.find((c) => c[1]?.method === method)![1]!.body));
const form = () => $(".finding-form form") as HTMLFormElement;
const submit = () => form().dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
const ticked = () => [...form().querySelectorAll<HTMLInputElement>("input[name=kept]")].map((x) => x.value + ":" + x.checked);

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
    vi.restoreAllMocks();
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
        expect($(".breadcrumb a")!.getAttribute("href")).toBe("/dataset/5#datasets");
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Mosaic");
        expect((byId("range-min") as HTMLInputElement).value).toBe("20");
        expect((byId("range-max") as HTMLInputElement).value).toBe("30.1");
        expect(calls(fetchFn)).toEqual(expect.arrayContaining(["GET " + BASE + "/mosaics", "POST " + BASE + "/measure",
                                                               "GET " + BASE + "/measurements"]));
        expect(measured(fetchFn)[0]).toEqual({target: "as_converted", geometry: null, isotherm: "", parameters: {}});
        expect($("[data-section=whole]")!.textContent).toContain("25.00 °C");
        expect($(".viewer-panel .scale")!.textContent).toContain("Temperature, °C");
        expect($(".map-legend")!.textContent).toBe("");
        expect([...document.querySelectorAll(".viewer-panel [data-section]")].map((x) => x.getAttribute("data-section")).slice(0, 3))
            .toEqual(["image", "cursor", "sources"]);
        expect($("[data-section=cursor]")!.textContent).toContain("Pointer info");
        expect(location.search).toBe("?tab=as_converted&palette=ironred&min=20&max=30.1");
    });

    it("opens on Harmonized when the frames disagree, saying why, unless a link names a tab", async () => {
        const kinds = {as_converted: {...MOSAICS.kinds!.as_converted,
                                      report: {frame_offsets: {offset_c: {min: -11.7, max: 15.6, p5_p95_span: 21}}}}};
        setUserUnit("F");
        await open(server(routes({[BASE + "/mosaics"]: {...MOSAICS, kinds}})));
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Harmonized");
        expect(byId("evened").textContent).toContain("Opened on Harmonized: the frames differ by up to 49 °F where");
        expect(byId("evened").textContent).toContain("Mosaic shows each frame as converted.");
        expect($("[data-tab=harmonized]")!.getAttribute("title")).toBe("The frames evened out to match each other");
        expect(location.search).toContain("?tab=harmonized");
        click($("#evened .close")!);
        await ticks(2);
        expect($("#evened")).toBeNull();

        render(null, byId("root"));
        history.replaceState(null, "", "/conversion/9?tab=as_converted");
        await open(server(routes({[BASE + "/mosaics"]: {...MOSAICS, kinds}})));
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Mosaic");
        expect($("#evened")).toBeNull();
    });

    it("opens on Mosaic, with no notice, when the frames agree", async () => {
        const kinds = {as_converted: {...MOSAICS.kinds!.as_converted,
                                      report: {frame_offsets: {offset_c: {min: -1.1, max: 6, p5_p95_span: 1.6}}}}};
        await open(server(routes({[BASE + "/mosaics"]: {...MOSAICS, kinds}})));
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Mosaic");
        expect($("#evened")).toBeNull();
    });

    it("shows the visual mosaic's tiles on its tab, the readout and source frames the as converted mosaic's", async () => {
        history.replaceState(null, "", "/conversion/9?tab=visual");
        const visual = {bounds: BOUNDS, minzoom: 18, maxzoom: 23, files: ["mosaics/visual/mosaic_visual.tif"], pairs: 2,
                        width: 300, height: 240, gsd_m: 0.006, unused_visual: 1,
                        report: {frames_used: 2, camera_offset: {applied: true, pairs_used: 5, boresight_deg: {pitch: 0.25, yaw: -0.29},
                                                                 offset_before_m: {median: 0.104}, residual_m: {median: 0.024}}}};
        const added = vi.spyOn(OlMap.prototype, "addLayer");
        const fetchFn = server(routes({[BASE + "/mosaics"]: {...MOSAICS, visual}}));
        await open(fetchFn);
        const layers = added.mock.calls.map((c) => c[0]);
        const tiles = layers.find((l) => l instanceof TileLayer) as TileLayer<XYZ>;
        const values = layers.find((l) => l instanceof WebGLTileLayer)!;
        expect(tiles.getSource()!.getUrls()).toEqual([BASE + "/mosaics/visual/tiles/{z}/{x}/{y}.png"]);
        expect([tiles.getVisible(), values.getVisible()]).toEqual([true, false]);
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Visual");
        expect(byId("visual-hint").textContent).toContain("Pointer info gives the Mosaic tab's temperatures.");
        expect($("#palette")).toBeNull();
        expect($("[data-section=measure]")).toBeNull();
        expect($(".map-legend")!.textContent).toBe("");
        const mosaic = $("[data-section=report]")!.textContent;
        expect(mosaic).toContain("2 placed as their thermal frames, 1 visual not used");
        expect(mosaic).toContain("pitch +0.25°, yaw -0.29° from 5 pairs: the mosaics 10.4 cm apart before, 2.4 cm after (median)");
        expect(mosaic).toContain("mosaics/visual/mosaic_visual.tif");
        expect(location.search).toBe("?tab=visual");
        expect(measured(fetchFn)[0].target).toBe("as_converted");
        click($("[data-tab=harmonized]")!);
        await ticks(10);
        expect([tiles.getVisible(), values.getVisible()]).toEqual([false, true]);
        expect($("#palette")).not.toBeNull();
        expect(location.search).toContain("?tab=harmonized");
        added.mockRestore();
    });

    it("has no Visual tab without a visual mosaic", async () => {
        history.replaceState(null, "", "/conversion/9?tab=visual");
        await open(server(routes()));
        expect($("[data-tab=visual]")).toBeNull();
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Mosaic");
    });

    it("lets go of the frame kept with a second click on it, or with Esc", async () => {
        const map = viewerMap(), fetchFn = pointing(server(routes(OUTLINES)));
        await open(fetchFn);
        clickMap(map(), WEST);
        await ticks(40);
        expect(byId("readout").textContent).toContain("a_T.JPG");
        expect(location.search).toContain("frame=a_T.JPG");
        clickMap(map(), EAST);
        await ticks(40);
        expect(location.search).toContain("frame=b_T.JPG");
        clickMap(map(), EAST);
        await ticks(40);
        expect(byId("readout").textContent).toContain("Move the cursor over the mosaic.");
        expect(location.search).not.toContain("frame=");
        clickMap(map(), WEST);
        await ticks(40);
        expect(location.search).toContain("frame=a_T.JPG");
        key(document.body, "Escape");
        await ticks();
        expect(byId("readout").textContent).toContain("Move the cursor over the mosaic.");
        expect(location.search).not.toContain("frame=");
    });

    it("draws the Source frame tab as the mosaic with the seams over it, and a second click opens no frames", async () => {
        const map = viewerMap(), fetchFn = pointing(server(routes(OUTLINES)));
        await open(fetchFn);
        const webgl = () => map().getLayers().getArray().filter((l) => l instanceof WebGLTileLayer).length;
        expect(webgl()).toBe(1);
        click($("[data-tab=source_frame]")!);
        await ticks();
        expect(byId("map").dataset.values).toBe(BASE + "/mosaics/as_converted/data/{z}/{x}/{y}");
        expect(webgl()).toBe(2);
        expect($(".viewer-panel .scale")!.textContent).toContain("Temperature, °C");
        const asked = () => calls(fetchFn).filter((c) => c.includes("/sources")).length;
        clickMap(map(), WEST);
        await ticks(40);
        expect(asked()).toBe(1);
        expect(location.search).toContain("frame=a_T.JPG");
        clickMap(map(), WEST);
        await ticks(40);
        expect(asked()).toBe(1);
        expect(location.search).not.toContain("frame=");
        click($("[data-tab=as_converted]")!);
        await ticks();
        expect(webgl()).toBe(1);
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
        expect(map.querySelector(".ol-viewport")).not.toBeNull();
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

    it("exports the mosaic tab shown, coloured as the view", async () => {
        history.replaceState(null, "", "/conversion/9?tab=harmonized&palette=viridis&min=18&max=32&gamma=1.5");
        const fetchFn = server(routes({["POST " + BASE + "/mosaics/harmonized/exports"]: {url: "/api/exports/ab"}}));
        const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
        await open(fetchFn);
        click(byId("export"));
        await ticks();
        click(byId("export-save"));
        await ticks();
        const post = fetchFn.mock.calls.find((c) => String(c[0]).endsWith("/exports"))!;
        expect(JSON.parse(String(post[1]!.body))).toEqual({format: "png", correction: {},
            view: {palette: "viridis", range: [18, 32], gamma: 1.5, equalize: false, sharpen: 0}});
        expect(download).toHaveBeenCalledTimes(1);
        expect(byId("export-dialog")).toBeNull();
    });

    it("opens its report with the view shown, saved with the report first", async () => {
        history.replaceState(null, "", "/conversion/9?tab=harmonized&palette=viridis&min=18&max=32&gamma=1.5");
        const fetchFn = server(routes({["PATCH " + BASE]: {id: 9}}));
        const nav = vi.fn();
        vi.stubGlobal("fetch", fetchFn);
        render(<ViewerPage api={API} publicUrl="/" id={9} datasetId={5} datasetName="Roof" basemaps={[]} nav={nav}/>, byId("root"));
        await ticks(40);
        click(byId("report"));
        await ticks();
        expect(sent(fetchFn, "PATCH")).toEqual({report: {view: {tab: "harmonized", palette: "viridis", range: [18, 32],
            adjust: {gamma: 1.5, equalize: false, sharpen: 0}, findings: true, hidden: []}}});
        expect(nav).toHaveBeenCalledWith("/conversion/9/report");
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
        expect($(".viewer-panel")!.textContent).toContain("2 frames. The mosaic is in the Mosaic tab's palette and range.");
        expect($("[data-section=measure]")).toBeNull();
        expect(location.search).toBe("?tab=source_frame");
    });

    it("shows WebODM's DSM on a Heights tab, in viridis and metres, with no measuring", async () => {
        const heights = {tab: "heights", kind: "dsm", stats: {percentiles: [0.4, 9.86], min: 0, max: 12.3}, bounds: BOUNDS,
                         maxzoom: 22};
        const fetchFn = server(routes({[BASE + "/mosaics"]: {...MOSAICS, tabs: [...MOSAICS.tabs!, heights]}}));
        await open(fetchFn);
        click($("[data-tab=heights]")!);
        await ticks();
        expect($("[role=tab][aria-selected=true]")!.textContent).toBe("Heights");
        expect((byId("palette") as HTMLSelectElement).value).toBe("viridis");
        expect([(byId("range-min") as HTMLInputElement).value, (byId("range-max") as HTMLInputElement).value]).toEqual(["0.4", "9.9"]);
        const panel = $(".viewer-panel")!.textContent;
        expect(panel).toContain("WebODM's DSM");
        expect(panel).toContain("This mosaic: 0.0 to 12.3 m");
        expect($("[data-section=measure]")).toBeNull();
        expect(calls(fetchFn).some((c) => c.includes("/heights/curve"))).toBe(false);
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

    it("draws the image as a slider is dragged, setting the range without compiling the style again", async () => {
        const restyled = vi.spyOn(WebGLTileLayer.prototype, "setStyle");
        const varied = vi.spyOn(WebGLTileLayer.prototype, "updateStyleVariables");
        await open(server(routes()));
        click(byId("auto"));
        await ticks();
        restyled.mockClear();
        change($("input[name=brightness]")!, "0.5", "input");
        await ticks();
        expect(varied.mock.lastCall![0]).toMatchObject({low: 19, span: 6});
        expect(restyled).not.toHaveBeenCalled();
        change($("input[name=gamma]")!, "1", "input");
        await ticks();
        expect(restyled).toHaveBeenCalledTimes(1);
        expect(location.search).not.toContain("gamma");
        change($("input[name=gamma]")!, "1");
        await ticks();
        expect(location.search).toContain("gamma=2");
        change($("input[name=sharpen]")!, String(SLIDERS.sharpen.step * 3), "input");
        await ticks();
        expect((restyled.mock.lastCall![0] as {variables: Record<string, number>}).variables.sharpen).toBeCloseTo(1.36, 2);
        expect([...document.querySelectorAll(".slider-value")].at(-1)!.textContent).toBe("1.4");
        vi.restoreAllMocks();
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

describe("the findings in the viewer", () => {
    it("lists the dataset's findings, opens the one a link asks for with its kept frames, and keeps what is shown in the URL", async () => {
        history.replaceState(null, "", "/conversion/9?finding=7");
        await open(server(routes({[FINDINGS]: {findings: [FOUND]}})));
        expect($("[data-section=findings]")!.textContent).toContain("Findings (1)");
        expect($("[data-finding='7']")!.textContent).toContain("High Hot joint Open");
        const about = $(".sources-window .finding-about")!.textContent;
        expect(about).toContain("Hot joint");
        expect(about).toContain("31.50 °C");
        expect(about).toContain("Loose bolt");
        expect($(".sources-what")!.textContent).toBe("Spot · 1 frame");
        expect($("[name=save-finding]")).toBeNull();
        expect(location.search).toContain("finding=7");

        click($("[data-finding='7'] button[name=hide]")!);
        await ticks();
        expect(location.search).toContain("hide=7");
        click($("input[name=findings]")!);
        await ticks();
        expect(location.search).toContain("findings=0");
        expect(($("[data-finding='7'] button[name=hide]") as HTMLButtonElement).disabled).toBe(true);
    });

    it("changes a finding in its form, sending the frames kept, and asks for a name", async () => {
        const changed = {...FOUND, severity: "critical", frames: FOUND.frames.map((f) => ({...f, kept: true}))};
        const fetchFn = server(routes({[FINDINGS]: [{findings: [FOUND]}, {findings: [changed]}],
                                       ["PATCH " + FINDINGS + "/7"]: changed}));
        await open(fetchFn);
        click($("[data-finding='7'] a")!);
        await ticks();
        click($(".finding-about button[name=edit]")!);
        await ticks();
        expect(($("#finding-name") as HTMLInputElement).value).toBe("Hot joint");
        expect(ticked()).toEqual(["a_T.JPG:true", "b_T.JPG:false"]);

        change($("#finding-name")!, " ", "input");
        await ticks();
        submit();
        await ticks();
        expect($(".finding-form [role=alert]")!.textContent).toBe("Name the finding to save it");
        expect(calls(fetchFn)).not.toContain("PATCH " + FINDINGS + "/7");

        change($("#finding-name")!, "Hot joint", "input");
        change($("#finding-severity")!, "critical");
        click(form().querySelector("input[value='b_T.JPG']")!);
        await ticks();
        submit();
        await ticks(40);
        expect(sent(fetchFn, "PATCH")).toEqual({name: "Hot joint", notes: "Loose bolt", severity: "critical", status: "open",
                                                kept: ["a_T.JPG", "b_T.JPG"]});
        expect($(".finding-form")).toBeNull();
        expect($(".finding-about")!.textContent).toContain("Critical");
        expect($(".sources-what")!.textContent).toBe("Spot · 2 frames");
    });

    it("saves a saved measurement as a finding with the frames picked, and deletes a finding after asking", async () => {
        const saved = {...FOUND, id: 8, name: "Hot spot", severity: "medium", tab: "harmonized"};
        const fetchFn = server(routes({
            [BASE + "/measurements"]: {measurements: [SAVED]},
            [FINDINGS]: [{findings: []}, {findings: [saved]}, {findings: []}],
            ["POST " + BASE + "/mosaics/harmonized/sources"]: {kind: "Point", geometry: SAVED.geometry, models: true,
                reason: null, frames: FOUND.frames, point: {valid: true, temperature: 31.5}},
            ["POST " + FINDINGS]: saved,
            ["DELETE " + FINDINGS + "/8"]: {},
        }));
        await open(fetchFn);
        expect($("[data-section=findings]")!.textContent).toContain("No findings yet");
        click($("[data-measurement='4'] button[name=finding]")!);
        await ticks(40);
        expect(($("#finding-name") as HTMLInputElement).value).toBe("Hot spot");
        expect(ticked()).toEqual(["a_T.JPG:true", "b_T.JPG:true"]);
        click(form().querySelector("input[value='b_T.JPG']")!);
        await ticks();
        submit();
        await ticks(40);
        const posted = fetchFn.mock.calls.filter((c) => c[0] === FINDINGS && c[1]?.method === "POST")
            .map((c) => JSON.parse(String(c[1]!.body)));
        expect(posted).toEqual([{name: "Hot spot", notes: "", severity: "medium", status: "open", kept: ["a_T.JPG"],
                                 measurement: 4}]);
        expect($(".sources-window .finding-about")!.textContent).toContain("Hot spot");

        click($("[data-finding='8'] button[name=delete]")!);
        await ticks();
        expect(dialog()!.textContent).toContain("Delete the finding Hot spot?");
        press("Delete");
        await ticks(40);
        expect(calls(fetchFn)).toContain("DELETE " + FINDINGS + "/8");
        expect($(".sources-window")).toBeNull();
        expect($("[data-section=findings]")!.textContent).toContain("No findings yet");
    });
});
