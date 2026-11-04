import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import {type FileRow} from "../src/dataset/files";
import {DatasetReportPage} from "../src/report/dataset-report-page";
import {fileOf, numbered, reportText, settingsSummary, temperatureSummary, todayText} from "../src/report/report";
import {calls, click, server, ticks} from "./helpers";

const API = "/api/";
const URL = API + "datasets/5";
const FINDINGS = API + "datasets/5/findings";

const FILES: FileRow[] = [
    {path: "thermal/a_T.JPG", kind: "thermal", time: "2026:10:12 18:29:50", alt: 20, tmin: 10, tmax: 30, tmean: 20,
     distance: 5, emissivity: 0.95, humidity: 70, reflection: 23, ambient: 25, lat: 42.1, lon: -88.1},
    {path: "thermal/b_T.JPG", kind: "thermal", time: "2026:10:12 18:30:10", alt: 22, tmin: 12, tmax: 50, tmean: 22,
     distance: 5, emissivity: 0.95, humidity: 70, reflection: 23, ambient: 25, lat: 42.1001, lon: -88.1001},
    {path: "thermal/c_T.JPG", kind: "thermal", time: "2026:10:12 18:30:30", alt: 22, tmin: 8, tmax: 40, tmean: 21,
     distance: 10, emissivity: 0.9, humidity: null, reflection: 23, ambient: 25, lat: 42.1002, lon: -88.1},
    {path: "rgb/a_V.JPG", kind: "not_thermal", reason: "not an R-JPEG", emissivity: 0.5},
];

const DATASET = {
    id: 5, project: 2, name: "Roof", source: "upload", status: "ready", file_count: 4, size: 4 * 1048576,
    analyzed: true, analyzed_at: "2026-10-18T10:00:00Z", created_at: "2026-10-18T09:00:00Z",
    analysis: {
        version: "1.5.0", cameras: [{model: "M4T", width: 640, height: 512, frames: 3}], files: FILES,
        findings: [{severity: "warning", code: "temperature_max_outlier", message: "1 image with an unusual maximum",
                    files: ["thermal/b_T.JPG"], suggestion: "--replace-above"}],
        webodm: {coverage: {frames: 3, gsd_m: 0.0212, area_m2: 363.9, equivalent_overlap_pct: 42.3},
                 recommended: {"radiometric-calibration": {value: "none", reason: "already temperatures"}},
                 process_command: "dji-thermal-cli process"},
    },
    flight_area: [[-88.1, 42.1], [-88.1001, 42.1001], [-88.1, 42.1002], [-88.1, 42.1]],
    flight_zone: {offset: -300, label: "UTC−5"},
    conversions: [{id: 9, name: "Nadir", settings: {}, description: "temp_c tiff · normalized", status: "ready",
                   converted: 3, mosaic_status: "ready", finished_at: "2026-10-18T11:01:00Z"}],
    report: {},
};

const finding = (id: number, name: string, kept: string[]) => ({
    id, dataset: 5, name, notes: id === 3 ? "Wet insulation" : "", severity: id === 3 ? "high" : "low", status: "open",
    geometry: {type: "Point", coordinates: [-88.1, 42.1]}, conversion: 9, conversion_name: "Nadir", tab: "as_converted",
    temperatures: {value: 31.5, unit: "C"}, models: false, created_at: "", updated_at: "",
    frames: kept.map((f) => ({frame: f, used: true, view_angle: 2, kept: true})).concat(
        [{frame: "thermal/c_T.tif", used: false, view_angle: 9, kept: false}]),
});

const root = () => document.getElementById("app")!;
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
const text = (s: string) => $(s)?.textContent || "";

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    setUserUnit("C");
});

afterEach(() => {
    render(null, root());
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function page(dataset: object = DATASET, findings: object[] = [], more: Record<string, unknown> = {}) {
    const fetchFn = server({[URL]: dataset, [FINDINGS]: {findings}, ...more});
    vi.stubGlobal("fetch", fetchFn);
    const print = vi.fn();
    render(<DatasetReportPage api={API} publicUrl="/" id={5} projectName="Silos" location="Farm Rd 4" author="A. Inspector"
                              basemaps={[]} today="2026-10-28" print={print}/>, root());
    await ticks();
    return {fetchFn, print};
}

function type(el: HTMLElement, value: string) {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
}

describe("the report's figures", () => {
    it("are filled in with the dataset's name, the author last typed and today until typed", () => {
        expect(reportText(undefined, "Roof", "A. Inspector", "2026-10-28"))
            .toEqual({title: "Roof", author: "A. Inspector", date: "2026-10-28", notes: "", appendix: false, visual: false});
        // What was typed is kept, even when it was cleared
        expect(reportText({title: "Survey", author: "", appendix: true}, "Roof", "A. Inspector", "2026-10-28"))
            .toEqual({title: "Survey", author: "", date: "2026-10-28", notes: "", appendix: true, visual: false});
        expect(todayText(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    });

    it("sum up each setting's values across the thermal frames, the most frames first", () => {
        const s = settingsSummary(FILES);
        expect(s.map((x) => x.setting.key)).toEqual(["emissivity", "distance", "humidity", "reflection", "ambient"]);
        expect(s[0].values).toEqual([{text: "0.95", frames: 2}, {text: "0.90", frames: 1}]);   // the RGB file is left out
        expect(s[1].values).toEqual([{text: "5.0 m", frames: 2}, {text: "10.0 m", frames: 1}]);
        expect(s[2]).toMatchObject({values: [{text: "70 %", frames: 2}], missing: 1});
        expect(s[3].values).toEqual([{text: "23.0 °C", frames: 3}]);
        expect(s[0].range).toBeUndefined();
        // Many values (measured at each frame) are given as their range
        const many = settingsSummary([20, 21.5, 22, 23, 24, 25, 26.2].map((t, i) => ({path: "f" + i, kind: "thermal", ambient: t})));
        expect(many[0].range).toEqual({from: "20.0 °C", to: "26.2 °C"});
        expect(settingsSummary([{path: "a", kind: "thermal"}])).toEqual([]);
        expect(settingsSummary(undefined)).toEqual([]);
    });

    it("give the frames' temperatures as their lowest, median and highest", () => {
        expect(temperatureSummary(FILES)).toEqual([
            {label: "Frame minimum", lowest: 8, median: 10, highest: 12},
            {label: "Frame mean", lowest: 20, median: 21, highest: 22},
            {label: "Frame maximum", lowest: 30, median: 40, highest: 50},
        ]);
        expect(temperatureSummary([{path: "a", kind: "thermal"}])).toEqual([]);
    });

    it("number the findings in the order they were saved", () => {
        expect(numbered([{id: 7}, {id: 3}]).map((f) => [f.id, f.number])).toEqual([[3, 1], [7, 2]]);
    });

    it("find the dataset's file a frame is, by its path or another extension", () => {
        expect(fileOf("thermal/a_T.JPG", FILES)).toBe("thermal/a_T.JPG");
        expect(fileOf("thermal/b_T.tif", FILES)).toBe("thermal/b_T.JPG");
        expect(fileOf("thermal/z_T.tif", FILES)).toBeNull();
    });
});

describe("the dataset report", () => {
    it("lays out each section from the dataset and its findings", async () => {
        await page(DATASET, [finding(7, "Hot vent", ["thermal/a_T.JPG"]), finding(3, "Wet patch", ["thermal/b_T.tif", "thermal/x.tif"])]);
        expect(($("#report-title") as HTMLInputElement).value).toBe("Roof");
        expect(($("#report-author") as HTMLInputElement).value).toBe("A. Inspector");
        expect(($("#report-date") as HTMLInputElement).value).toBe("2026-10-28");
        expect(text(".report-project")).toBe("Silos · Farm Rd 4 · flight Roof");
        expect(text("#report-dataset")).toContain("M4T");
        expect($("#report-map")).not.toBeNull();
        expect(text("#report-where")).toContain("3 frames with a position, and the findings by their numbers");
        expect(text("#report-coverage")).toContain("2.1 cm/px");
        expect(text("#report-coverage")).not.toContain("radiometric");      // the coverage only, not the task options
        expect(text("#report-problems")).toContain("1 frame with an unusual maximum temperature (the flight's median 40.0 °C)");
        expect(document.querySelector("#report-problems .finding-fix")).toBeNull();
        expect($("#report-problems a")).toBeNull();                         // listed, not links to a tab
        expect(text(".report-settings")).toContain("0.95 (2), 0.90 (1)");
        expect(text(".report-settings")).toContain("70 % (2), not recorded (1)");
        expect(text(".report-temperatures")).toContain("Frame maximum30.0 °C40.0 °C50.0 °C");
        expect(text("#report-conversions")).toContain("Nadirtemp_c tiff · normalizedConverted · 3 converted");
        // The findings numbered as saved, the same numbers on the map, with their kept frames' thumbnails
        expect($$(".report-findings tbody tr").map((r) => r.dataset.finding + " " + r.children[1].textContent))
            .toEqual(["1 Wet patchWet insulation", "2 Hot vent"]);
        expect(text(".report-findings")).toContain("31.50 °C");
        expect($$(".report-thumbs figcaption").map((x) => x.textContent)).toEqual(["1. Wet patch: 1 frame kept", "2. Hot vent: 1 frame kept"]);
        expect($$(".report-thumb img").map((x) => x.getAttribute("src")))
            .toEqual([URL + "/thumbnail?file=thermal%2Fb_T.JPG", URL + "/thumbnail?file=thermal%2Fa_T.JPG"]);
        // Notes, empty, are left out of the print; the appendix is off
        expect($("#report-notes-section")!.classList.contains("empty")).toBe(true);
        expect($("#report-appendix-table")).toBeNull();
    });

    it("shows the video frames saved, numbered on the map, and those attached to a finding with it", async () => {
        const frame = (id: number, video: string, time: number, over: object = {}) => ({id, dataset: 5, video, time,
            frame: Math.floor(time * 30) + 1, point: {lat: 42.1001, lon: -88.1, alt: 15.3, pitch: -45}, name: "Frame " + id,
            notes: "", look: {recoloured: true}, finding: null, finding_name: "", created_at: "", ...over});
        await page(DATASET, [finding(3, "Wet patch", ["thermal/b_T.tif"])], {[URL + "/video-frames"]: {frames: [
            frame(8, "DCIM/b_T.MP4", 2, {point: null, notes: "Warm eave"}),
            frame(6, "DCIM/a_T.MP4", 12.5, {finding: 3, finding_name: "Wet patch", look: {recoloured: false}})]}});
        expect(text("#report-where")).toContain("3 frames with a position, the findings by their numbers, and the saved video frames (V1, V2…)");
        const shown = $$(".report-video-frame");
        expect(shown.map((x) => x.dataset.videoFrame)).toEqual(["V1", "V2"]);
        expect(shown[0].querySelector("img")!.getAttribute("src")).toBe(URL + "/video-frames/6/picture");
        expect(shown[0].textContent).toContain("V1. Frame 6a_T.MP4 · 0:12.50 · frame 376");
        expect(shown[0].textContent).toContain("42.100100, -88.100000 · 15.3 m up · gimbal -45°");
        expect(shown[0].textContent).toContain("With finding 1 Wet patch");
        expect(shown[1].textContent).toContain("b_T.MP4 · 0:02.00 · frame 61 · recoloured");
        expect(shown[1].textContent).toContain("Warm eave");
        expect(text("#report-video-frames")).toContain("not temperatures");
        // The finding shows the one attached to it beside its kept frames
        expect(text(".report-thumbs figcaption")).toBe("1. Wet patch: 1 frame kept, 1 video frame");
        expect($(".report-video-thumb img")!.getAttribute("src")).toBe(URL + "/video-frames/6/picture");
    });

    it("shows the text saved on the dataset rather than what fills it in", async () => {
        await page({...DATASET, report: {title: "Roof survey", author: "", notes: "Seen from the north", appendix: true}});
        expect(($("#report-title") as HTMLInputElement).value).toBe("Roof survey");
        expect(($("#report-author") as HTMLInputElement).value).toBe("");
        expect($(".report-author")!.classList.contains("empty")).toBe(true);
        expect(($("#report-notes") as HTMLTextAreaElement).value).toBe("Seen from the north");
        expect(($("#report-appendix") as HTMLInputElement).checked).toBe(true);
        expect($$(".report-files tbody tr").length).toBe(3);                   // the thermal frames only
    });

    it("saves what is typed once typing pauses, the fields typed together", async () => {
        vi.useFakeTimers();
        const {fetchFn} = await page(DATASET, [], {["PATCH " + URL]: DATASET});
        expect(text(".report-saved")).toBe("Typed text is saved as you type");
        type($("#report-title")!, "Roof survey");
        type($("#report-notes")!, "Wet");
        await vi.advanceTimersByTimeAsync(300);
        expect(calls(fetchFn)).not.toContain("PATCH " + URL);
        expect(text(".report-saved")).toBe("Saving…");
        await vi.advanceTimersByTimeAsync(400);
        await ticks();
        const patches = fetchFn.mock.calls.filter((c) => c[1]?.method === "PATCH");
        expect(patches.map((c) => JSON.parse(c[1]!.body as string))).toEqual([{report: {title: "Roof survey", notes: "Wet"}}]);
        expect(text(".report-saved")).toBe("Saved");
        expect(text(".report-title .report-value")).toBe("Roof survey");
    });

    it("says when the text could not be saved", async () => {
        vi.useFakeTimers();
        await page(DATASET, [], {["PATCH " + URL]: () => Promise.resolve(new Response(
            JSON.stringify({report: ["The date is a day as YYYY-MM-DD"]}), {status: 400}))});
        type($("#report-date")!, "2026-13-01");
        await vi.advanceTimersByTimeAsync(700);
        await ticks();
        expect(text(".report-saved")).toContain("The date is a day as YYYY-MM-DD");
    });

    it("appends the frames' table when switched on, saved at once", async () => {
        vi.useFakeTimers();
        const {fetchFn} = await page(DATASET, [], {["PATCH " + URL]: DATASET});
        click($("#report-appendix")!);
        await vi.advanceTimersByTimeAsync(0);
        await ticks();
        expect($$(".report-files tbody tr").map((r) => r.children[0].textContent))
            .toEqual(["a_T.JPG", "b_T.JPG", "c_T.JPG"]);
        expect($$(".report-files th").map((x) => x.textContent)).not.toContain("Kind");
        const patches = fetchFn.mock.calls.filter((c) => c[1]?.method === "PATCH");
        expect(patches.map((c) => JSON.parse(c[1]!.body as string))).toEqual([{report: {appendix: true}}]);
    });

    it("puts the visual photos with a position on the map when switched on, saved at once", async () => {
        vi.useFakeTimers();
        const files = [...FILES, {path: "rgb/b_V.JPG", kind: "not_thermal", reason: "not an R-JPEG", lat: 42.1, lon: -88.1}];
        const withVisual = {...DATASET, analysis: {...DATASET.analysis, files}};
        const {fetchFn} = await page(withVisual, [], {["PATCH " + URL]: withVisual});
        expect(text("#report-where")).not.toContain("visual");
        click($("#report-visual")!);
        await vi.advanceTimersByTimeAsync(0);
        await ticks();
        expect(text("#report-where")).toContain("3 frames with a position, and 1 visual photo (orange squares)");
        const patches = fetchFn.mock.calls.filter((c) => c[1]?.method === "PATCH");
        expect(patches.map((c) => JSON.parse(c[1]!.body as string))).toEqual([{report: {visual: true}}]);
    });

    it("puts a flight's visual photos on the map without asking when it has no thermal frames", async () => {
        const files = [{path: "rgb/a_V.JPG", kind: "not_thermal", lat: 42.1, lon: -88.1},
                       {path: "rgb/b_V.JPG", kind: "not_thermal", lat: 42.1, lon: -88.2}];
        await page({...DATASET, analysis: {...DATASET.analysis, files}});
        expect($("#report-visual")).toBeNull();
        expect(text("#report-where")).toContain("2 visual photos (orange squares)");
    });

    it("offers no visual photos' layer when none has a position", async () => {
        await page();
        expect($("#report-visual")).toBeNull();
    });

    it("prints from its button", async () => {
        const {print} = await page();
        click($("#print")!);
        expect(print).toHaveBeenCalledOnce();
    });

    it("says what a dataset not analyzed, without positions or findings, has none of", async () => {
        await page({...DATASET, analysis: {}, flight_area: null, conversions: []});
        expect($(".report-head")).not.toBeNull();
        expect(text("#report-dataset")).toContain("Not analyzed");
        expect(text("#report-where")).toContain("None of the frames records where it was taken");
        expect($("#report-map")).toBeNull();
        expect($("#report-coverage")).toBeNull();
        expect($("#report-problems")).toBeNull();
        expect($("#report-frames")).toBeNull();
        expect(text("#report-conversions")).toContain("None made");
        expect(text("#report-findings")).toContain("None saved");
    });

    it("says when the dataset could not be loaded", async () => {
        await page({error: "gone"}, [], {[URL]: () => Promise.resolve(new Response("{}", {status: 404}))});
        expect(text("[role=alert]")).toBe("Could not load the flight.");
    });
});
