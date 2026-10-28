import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import type {Finding} from "../src/findings/findings";
import {lonLatToMap} from "../src/map/map";
import {type Ask, drawFigures, type Source} from "../src/report/figures";
import {ConversionReportPage} from "../src/report/conversion-report-page";
import {closeUpExtent, included, MIN_CLOSE_UP, onMosaic, reportStyle, viewText} from "../src/report/mosaic-report";
import type {Mosaics} from "../src/viewer/viewer-page";
import {click, server, ticks, valuesResponse} from "./helpers";

// jsdom has no WebGL: the figures are made up, each named after what it was asked to show
vi.mock("../src/report/figures", () => ({
    drawFigures: vi.fn(async (_s: Source, asks: Ask[]) => Object.fromEntries(asks.map((a) => [a.key, "data:image/png;base64," + a.key]))),
}));

const API = "/api/";
const BASE = API + "conversions/9";
const BOUNDS = [10, 50, 10.001, 50.001];

const MOSAICS: Mosaics = {
    name: "Nadir", dataset_name: "Roof", status: "ready", mosaic_status: "ready", unit: "C", default_palette: "ironred",
    tabs: [{tab: "as_converted", kind: "as_converted", stats: {percentiles: [20, 30]}, bounds: BOUNDS, maxzoom: 22},
           {tab: "harmonized", kind: "harmonized", stats: {percentiles: [21, 29]}, bounds: BOUNDS, maxzoom: 22},
           {tab: "source_frame", kind: "as_converted", bounds: BOUNDS, maxzoom: 22}],
    palettes: [{key: "ironred", label: "Iron red", color_map: [0x000000, 0xff0000]},
               {key: "viridis", label: "Viridis", color_map: [0x440154, 0xfde725]}],
    kinds: {as_converted: {frames: 2, width: 100, height: 80, gsd_m: 0.02},
            harmonized: {frames: 2, width: 100, height: 80, gsd_m: 0.02}},
    frames: ["a_T.JPG", "b_T.JPG"], frame_colors: [1, 2, 3], flown: ["2026:10:12 18:29:50", "2026:10:12 18:31:10"],
};

const DETAIL = {id: 9, name: "Nadir", description: "temp_c tiff · normalized", status: "ready", mosaic_status: "ready",
                settings: {emissivity: 0.9, unit: "C", outputs: ["temp_c:tiff"]}, results: {version: "1.5.0"}, report: {}};
const DATASET = {defaults: {emissivity: null, unit: "C", outputs: ["temp_c:tiff"]},
                 analysis: {files: [{path: "a_T.JPG", kind: "thermal"}, {path: "b_T.JPG", kind: "thermal"}]}};

const spot = {id: 4, name: "Hot spot", target: "harmonized", geometry: {type: "Point", coordinates: [10.0005, 50.0005]},
              comment: "Seen in May too", values: {result: {kind: "Point", valid_pixels: 1, value: 31.5, mean: 31.5}}};
const line = {id: 5, name: "Ridge", target: "as_converted", geometry: {type: "LineString", coordinates: [[10.0002, 50.0002], [10.0008, 50.0008]]},
              values: {result: {kind: "LineString", valid_pixels: 30, mean: 24, min: 20, max: 28, length: 80,
                                profile: {distance: [0, 40, 80], values: [20, 28, 24]}}}};
const onFrame = {id: 6, name: "Frame spot", target: "frame", frame: "a_T.JPG", geometry: {type: "Point", coordinates: [3, 2]},
                 values: {result: {kind: "Point", valid_pixels: 1, value: 40, mean: 40}}};

const finding = (id: number, lon: number): Finding => ({
    id, dataset: 5, name: "Finding " + id, notes: "", severity: "high", status: "open",
    geometry: {type: "Point", coordinates: [lon, 50.0005]}, shape: null, conversion: 9, conversion_name: "Nadir",
    tab: "as_converted", temperatures: {value: 31.5, unit: "C"}, models: true,
    frames: [{frame: "a_T.JPG", used: true, view_angle: 5, kept: true}], created_at: "", updated_at: "",
});

const root = () => document.getElementById("app")!;
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
const text = (s: string) => $(s)?.textContent || "";

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    setUserUnit("C");
    vi.mocked(drawFigures).mockClear();
});

afterEach(() => {
    render(null, root());
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function routes(more: Record<string, unknown> = {}) {
    return {
        [BASE]: DETAIL, [BASE + "/mosaics"]: MOSAICS, [BASE + "/measurements"]: {measurements: [spot, line, onFrame]},
        [API + "datasets/5"]: DATASET, [API + "datasets/5/findings"]: {findings: [finding(8, 10.0005), finding(3, 10.0004), finding(9, 11)]},
        [BASE + "/frame/data?frame=a_T.JPG"]: valuesResponse(10, 8), ...more,
    };
}

async function page(more: Record<string, unknown> = {}) {
    const fetchFn = server(routes(more));
    vi.stubGlobal("fetch", fetchFn);
    const print = vi.fn();
    render(<ConversionReportPage api={API} publicUrl="/" id={9} datasetId={5} datasetName="Roof" projectName="Silos"
                                 location="Farm Rd 4" author="A. Inspector" today="2026-10-28" print={print}/>, root());
    await ticks(60);
    return {fetchFn, print};
}

const asked = () => vi.mocked(drawFigures).mock.calls.flatMap((c) => c[1].map((a) => a.key));
const patches = (fetchFn: ReturnType<typeof server>, url: string) => fetchFn.mock.calls
    .filter((c) => c[0] === url && c[1]?.method === "PATCH").map((c) => JSON.parse(String(c[1]!.body)));

describe("the mosaic report's figures", () => {
    it("show the view saved with the report, else the first tab as it opens", () => {
        expect(reportStyle(MOSAICS, undefined)).toEqual({tab: "as_converted",
            style: {palette: "ironred", range: [20, 30], adjust: {gamma: 1, equalize: false, sharpen: 0}}});
        const saved = reportStyle(MOSAICS, {tab: "harmonized", palette: "viridis", range: [18, 32],
                                            adjust: {gamma: 1.5, equalize: true, sharpen: 1}});
        expect(saved).toEqual({tab: "harmonized", style: {palette: "viridis", range: [18, 32],
                                                          adjust: {gamma: 1.5, equalize: true, sharpen: 1}}});
        expect(viewText(MOSAICS, saved.tab, saved.style)).toBe("Harmonized · Viridis palette · 18.0 to 32.0 °C · gamma 1.5 · " +
                                                              "equalized · sharpened 1");
        // A tab or palette the mosaics no longer have is not shown
        expect(reportStyle(MOSAICS, {tab: "view_angle", palette: "x"}).tab).toBe("as_converted");
        expect(reportStyle(MOSAICS, {tab: "harmonized", palette: "x"}).style.palette).toBe("ironred");
    });

    it("fit each close-up to its measurement, with room around it, a spot's at the least size", () => {
        const at = lonLatToMap([10.0005, 50.0005]);
        const e = closeUpExtent({type: "Point", coordinates: [10.0005, 50.0005]});
        expect(e[2] - e[0]).toBeCloseTo(MIN_CLOSE_UP);
        expect((e[0] + e[2]) / 2).toBeCloseTo(at[0]);
        const l = closeUpExtent(line.geometry as never), [a, b] = line.geometry.coordinates.map((c) => lonLatToMap(c as [number, number]));
        const size = Math.max(b[0] - a[0], b[1] - a[1]);
        expect(l[2] - l[0]).toBeCloseTo(b[0] - a[0] + 2 * 0.6 * size);
        expect(l[3] - l[1]).toBeCloseTo(b[1] - a[1] + 2 * 0.6 * size);
    });

    it("hold the measurements not left out, those on the mosaics first, and the findings on the mosaic", () => {
        expect(included([onFrame, spot, line] as never, [5]).map((m) => m.id)).toEqual([4, 6]);
        expect(onMosaic([finding(8, 10.0005), finding(9, 11)], BOUNDS).map((f) => f.id)).toEqual([8]);
    });
});

describe("the mosaic report", () => {
    it("lays out the mosaic, each measurement, the findings on it, and the settings", async () => {
        await page();
        expect(($("#report-title") as HTMLInputElement).value).toBe("Roof · Nadir");
        expect(($("#report-author") as HTMLInputElement).value).toBe("A. Inspector");
        expect(text(".report-project")).toContain("Silos · Farm Rd 4 · flight Roof · dataset Nadir · flown 2026-10-12 18:29–18:31");
        expect(text("#report-mosaic .report-caption")).toContain("Mosaic · Iron red palette · 20.0 to 30.0 °C");
        // The figures: the mosaic, and each measurement's close-up on its own mosaic or frame
        expect(asked().sort()).toEqual(["m4", "m5", "m6", "main"]);
        expect($("#report-mosaic img")!.getAttribute("src")).toBe("data:image/png;base64,main");
        const main = vi.mocked(drawFigures).mock.calls.find((c) => c[1][0].key === "main")!;
        expect(main[1][0].marks.map((m) => m.name)).toEqual(["M1", "M2", "#1", "#2"]);
        expect(main[0].values).toMatchObject({kind: "tiles", url: BASE + "/mosaics/as_converted/data/{z}/{x}/{y}"});
        const frame = vi.mocked(drawFigures).mock.calls.find((c) => c[1][0].key === "m6")!;
        expect(frame[0].values).toMatchObject({kind: "frame", key: "a_T.JPG", width: 10, height: 8});
        // The measurements numbered, the mosaics' first, with their figures, charts and comments
        expect($$(".report-measurements-table tbody tr").map((r) => r.children[0].textContent + " " + r.children[1].textContent))
            .toEqual(["M1 Hot spot", "M2 Ridge", "M3 Frame spot"]);
        expect(text(".report-measurements-table")).toContain("Seen in May too");
        expect($$(".report-measurement h3").map((h) => h.firstChild!.textContent)).toEqual(["M1. ", "M2. ", "M3. "]);
        expect($('[data-measurement="5"] svg')).not.toBeNull();                // the line's profile
        expect(($('[data-measurement="4"] textarea') as HTMLTextAreaElement).value).toBe("Seen in May too");
        // The findings on the mosaic, numbered as saved; the one off it left out
        expect($$(".report-findings tbody tr").map((r) => r.children[1].textContent)).toEqual(["Finding 3", "Finding 8"]);
        expect(text("#report-method")).toContain("temp_c tiff · normalized");
        expect(text("#report-method")).toContain("Changed from the defaultsemissivity 0.9");
        expect(text("#report-method")).toContain("dji-thermal-cli1.5.0");
        expect($("#print")!.hasAttribute("disabled")).toBe(false);
    });

    it("leaves a measurement out, saved at once, and draws the mosaic again without it", async () => {
        vi.useFakeTimers();
        const {fetchFn} = await page({["PATCH " + BASE]: DETAIL});
        const box = $('[data-measurement="4"] .report-leave-out input')!;
        click(box);
        await vi.advanceTimersByTimeAsync(0);
        await ticks(20);
        expect(patches(fetchFn, BASE)).toEqual([{report: {left_out: [4]}}]);
        expect($('[data-measurement="4"]')!.classList.contains("left-out")).toBe(true);
        expect($('[data-measurement="4"] img')).toBeNull();
        expect($$(".report-measurements-table tbody tr").map((r) => r.children[1].textContent)).toEqual(["Ridge", "Frame spot"]);
        const mains = vi.mocked(drawFigures).mock.calls.filter((c) => c[1][0].key === "main");
        expect(mains.length).toBe(2);
        expect(mains[1][1][0].marks.map((m) => m.name)).toEqual(["M1", "#1", "#2"]);
    });

    it("saves a measurement's comment once typing pauses", async () => {
        vi.useFakeTimers();
        const {fetchFn} = await page({["PATCH " + BASE + "/measurements/5"]: {...line, comment: "Damp"}});
        const area = $('[data-measurement="5"] textarea') as HTMLTextAreaElement;
        area.value = "Damp";
        area.dispatchEvent(new Event("input", {bubbles: true}));
        await vi.advanceTimersByTimeAsync(700);
        await ticks();
        expect(patches(fetchFn, BASE + "/measurements/5")).toEqual([{comment: "Damp"}]);
        expect(text(".report-saved")).toBe("Comment saved");
        expect(text(".report-measurements-table")).toContain("Damp");
    });

    it("shows the view saved with it, and asks for the equalization's curve", async () => {
        const view = {tab: "harmonized", palette: "viridis", range: [18, 32], adjust: {gamma: 1, equalize: true, sharpen: 0}};
        const {fetchFn} = await page({[BASE]: {...DETAIL, report: {title: "Roof survey", view}},
                                      [BASE + "/mosaics/harmonized/curve?rescale=18,32&equalize=1"]: {shares: [0, 0.2, 1]}});
        expect(($("#report-title") as HTMLInputElement).value).toBe("Roof survey");
        expect(text("#report-mosaic .report-caption")).toContain("Harmonized · Viridis palette · 18.0 to 32.0 °C · equalized");
        expect(fetchFn.mock.calls.map((c) => c[0])).toContain(BASE + "/mosaics/harmonized/curve?rescale=18,32&equalize=1");
        const main = vi.mocked(drawFigures).mock.calls.find((c) => c[1][0].key === "main")!;
        expect(main[0].colouring.shares).toEqual([0, 0.2, 1]);
        expect($(".report-bar a")!.getAttribute("href")).toBe("/conversion/9?tab=harmonized&palette=viridis&min=18&max=32&equalize=1");
    });

    it("says when the mosaics are not built, or none were measured", async () => {
        await page({[BASE + "/mosaics"]: {...MOSAICS, mosaic_status: "", tabs: []}, [BASE + "/measurements"]: {measurements: []}});
        expect(text(".page")).toContain("The mosaics are not built");
        expect(asked()).toEqual([]);
        render(null, root());
        await page({[BASE + "/measurements"]: {measurements: []}});
        expect(text("#report-measurements")).toContain("None saved");
        expect(asked()).toEqual(["main"]);
    });

    it("waits for its figures before it can be printed", async () => {
        let finish: (x: Record<string, string>) => void = () => undefined;
        vi.mocked(drawFigures).mockImplementationOnce(() => new Promise((r) => { finish = r; }));
        const {print} = await page({[BASE + "/measurements"]: {measurements: []}});
        expect($("#print")!.hasAttribute("disabled")).toBe(true);
        expect(text(".report-saved")).toBe("Drawing the figures…");
        finish({main: "data:image/png;base64,main"});
        await ticks();
        expect($("#print")!.hasAttribute("disabled")).toBe(false);
        click($("#print")!);
        expect(print).toHaveBeenCalledOnce();
    });
});
