import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fileKind} from "../src/core/format";
import {setUserUnit} from "../src/core/units";
import {type Conversion, parsePrefill, skipReasons} from "../src/dataset/conversions";
import {DatasetPage} from "../src/dataset/dataset-page";
import {FILE_COLUMNS} from "../src/dataset/files";
import {cell} from "../src/dataset/tabs";
import {active, type Analysis, columnType, type Condition, fileRows, filterQuery, filtersFrom, newCondition, newestReady,
        parseFilters, shownAs, SHOWS, sortRows} from "../src/dataset/files";
import {defaultName, differences, formProblem, planSettings, resetSetting, type Settings} from "../src/dataset/settings";
import {calls, click, file, jsonResponse, key, server, ticks} from "./helpers";

const API = "/api/";
const URL = API + "datasets/5";
const DATASET = {
    id: 5, name: "Roof", source: "upload", status: "ready", progress: 1, error: "", file_count: 3, size: 3 * 1048576,
    thermal: 2, not_thermal: 1, errors: 0, warnings: 1, infos: 0, cameras: ["M4T"], analyzed: true,
    analyzed_at: "2026-10-18T10:00:00Z", created_at: "2026-10-18T09:00:00Z",
};
const ANALYSIS: Analysis = {
    version: "1.1.0",
    cameras: [{model: "M4T", serial: "SN1", width: 640, height: 512, frames: 2}],
    files: [
        {path: "thermal/b_T.JPG", kind: "thermal", time: "2026:10:12 18:30:10", alt: 22, pitch: -90, tmin: 15.2, tmax: 50.6,
         tmean: 22, distance: 5, lrf: 21.4, emissivity: 0.91, lat: 42.1},
        {path: "thermal/a_T.JPG", kind: "thermal", time: "2026:10:12 18:29:50", alt: 20, pitch: -45, tmin: 17.3, tmax: 31.5,
         tmean: 21.9, distance: 5, lrf: null, emissivity: 0.91, lat: null},
        {path: "rgb/a_V.JPG", kind: "not_thermal", reason: "not an R-JPEG", size: 4000000},
    ],
    findings: [
        {severity: "warning", code: "temperature_max_outlier", message: "1 image with an unusual <maximum>",
         files: ["thermal/b_T.JPG"], suggestion: "--replace-above"},
        {severity: "info", code: "oblique", message: "1 oblique frame", files: ["thermal/a_T.JPG"], suggestion: ""},
    ],
    webodm: {
        process_command: "dji-thermal-cli process -o temp_c:tiff --normalize", process_args: ["-o", "temp_c:tiff", "--normalize"],
        recommended: {"radiometric-calibration": {value: "none", reason: "already temperatures"}},
        consider: {"fast-orthophoto": {value: true, reason: "flat ground"}},
        notes: ["--normalize: drift"],
        coverage: {frames: 2, gsd_m: 0.0212, area_m2: 363.9, images_per_point_median: 3, area_seen_by_3_or_more_pct: 62.9,
                   equivalent_overlap_pct: 42.3},
        odm_arguments: ["--radiometric-calibration", "none"],
    },
};
const DEFAULTS: Settings = {
    distance: "lrf", humidity: null, emissivity: null, reflected_temp: null, ambient_temp: null, unit: "C", range_min: null,
    range_max: null, palette: null, gimbal_yaw: null, gimbal_pitch: null, gimbal_roll: null, replace_above: null,
    replace_above_value: null, replace_below: null, replace_below_value: null, strip_location: false, normalize: false,
    max_pitch: null, outputs: ["temp_c:tiff", "pseudo:png"], compression: "deflate", rjpeg_picture: "palette",
    mosaics: true, visual: true, visual_gsd: null, visual_height_cell: null,
};
const PREFERENCES = {
    settings: DEFAULTS, saved: false, defaults: DEFAULTS, palettes: ["whitehot", "ironred"],
    products: [
        {product: "temp_c", description: "float32 temperature in degrees C", formats: ["tiff", "exr"]},
        {product: "pseudo", description: "8-bit RGB pseudo-colour image", formats: ["png", "tiff"]},
        {product: "gray16", description: "uint16 grayscale view", formats: ["png", "tiff"]},
        {product: "rjpeg", description: "the source R-JPEG with the measurement parameters", formats: ["jpg"]},
    ],
};
const CONVERSION: Conversion = {
    id: 9, name: "Nadir", settings: {...DEFAULTS, emissivity: 0.95, normalize: true}, description: "temp_c tiff · normalized",
    status: "ready", progress: 1, error: "", converted: 2, skipped: 1, file_count: 2, size: 2097152,
    created_at: "2026-10-18T11:00:00Z", finished_at: "2026-10-18T11:01:00Z", mosaic_status: "ready", mosaic_progress: 1,
    mosaic_error: "", mosaic_files: ["mosaics/as_converted/mosaic_temp_c.tif", "mosaics/harmonized/mosaic_temp_c.tif"],
};
const DETAIL = {...DATASET, analysis: ANALYSIS, conversions: [CONVERSION]};
const NAMES = "abcdefghijk".split("").map((c) => c + "_T.JPG");

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = () => $(".page .dialog");
const press = (label: string) => click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === label)!);
const tab = (name: string) => $(`[data-tab="${name}"]`)!;
const selected = () => $("[role=tab][aria-selected=true]")?.getAttribute("data-tab");
const paths = (opts?: RequestInit) => (opts!.body as FormData).getAll("paths");
const body = (opts?: RequestInit) => JSON.parse(String(opts!.body));
const field = (name: string) => $<HTMLInputElement>(`.settings-form [name="${name}"]`)!;
const card = (id = 9) => $(`.conversion[data-id="${id}"]`)!;
const menuItem = (label: string) => [...card().querySelectorAll(".menu-items a, .menu-items button")]
    .find((el) => el.textContent!.trim() === label) as HTMLElement | undefined;
const names = (filters: Condition[]) => fileRows(ANALYSIS, {filters, sort: "path", desc: false}).map((r) => r.path);
const filterRows = () => $$(".filter-row");
const shownCount = () => $(".files-shown")!.textContent;
const favourites = () => $$(".favourite-name").map((b) => b.textContent!.trim());
const showChosen = () => $<HTMLInputElement>("[name=files-show]:checked")?.value || null;
function change(el: HTMLSelectElement | HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("change", {bubbles: true}));
}
const fileNames = () => $$("table.files tbody tr td:first-child").map((td) => td.textContent);

function type(el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
}

function choose(input: HTMLInputElement, files: File[]) {
    Object.defineProperty(input, "files", {value: files, configurable: true});
    input.dispatchEvent(new Event("change", {bubbles: true}));
}

function page(fetchFn: ReturnType<typeof server>, nav = vi.fn(), palette = "") {
    vi.stubGlobal("fetch", fetchFn);
    render(<DatasetPage api={API} publicUrl="/" id={5} projectId={4} projectName="Silos" palette={palette} nav={nav}/>, byId("root"));
    return nav;
}

// The dataset's own routes, with the conversion settings
const routes = (dataset: unknown = DETAIL, more: Record<string, unknown> = {}) =>
    server({[API + "preferences"]: PREFERENCES, [URL]: dataset, [API + "file-filters"]: {filters: []}, ...more});

// The page opens on the Datasets tab once there are datasets: the Files tab's tests open on it by link
function filesFirst() {
    history.replaceState(null, "", "/dataset/5#files");
}

async function openSettings() {
    click(byId("edit-settings"));
    await ticks();
}

async function openMenu() {
    click(card().querySelector("button[aria-label=More]")!);
    await ticks();
}

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    render(null, byId("root"));
    vi.unstubAllGlobals();
    vi.useRealTimers();
    history.replaceState(null, "", "/");
    localStorage.clear();
    setUserUnit("C");
});

describe("the conversion settings", () => {
    it("reads the WebODM plan's arguments onto the defaults, without changing them", () => {
        const s = planSettings(["-o", "temp_c:tif,pseudo", "--max-pitch", "-80", "--normalize", "--emissivity", "0.9"], DEFAULTS);
        expect(s).toEqual({...DEFAULTS, outputs: ["temp_c:tiff", "pseudo"], max_pitch: -80, normalize: true, emissivity: 0.9});
        expect(DEFAULTS.normalize).toBe(false);
    });

    it("reads the plan's temperatures in its unit, into the settings' unit", () => {
        const f = {...DEFAULTS, unit: "F"};
        expect(planSettings(["--reflected-temp", "20"], f).reflected_temp).toBeCloseTo(68);
        expect(planSettings(["--unit", "k", "--ambient-temp", "293.15"], f).ambient_temp).toBeCloseTo(68);
        expect(planSettings(["--unit", "F", "--ambient-temp", "68"], DEFAULTS).ambient_temp).toBeCloseTo(20);
    });

    it("tells what differs from the defaults and where it is off the plan, in the unit shown", () => {
        const plan = planSettings(["-o", "temp_c:tiff", "-o", "pseudo", "--normalize"], DEFAULTS);
        const s = {...DEFAULTS, emissivity: .95, reflected_temp: 20, range_min: 10, range_max: 60,
                   outputs: ["temp_c:tiff", "pseudo:tiff"]};
        expect(differences(s, DEFAULTS, plan, "F").map((d) => [d.key, d.text, d.changed, d.offPlan])).toEqual([
            ["outputs", "temp_c:tiff, pseudo:tiff", true, false],
            ["emissivity", "emissivity 0.95", true, false],
            ["reflected_temp", "reflected 68 °F", true, false],
            ["normalize", "not normalized", false, true],
            ["range", "range 50 to 140 °F", true, false],
        ]);
        expect(differences(DEFAULTS, DEFAULTS, null, "C")).toEqual([]);
        expect(differences({...DEFAULTS, unit: "K"}, DEFAULTS, null, "C").map((d) => d.key)).toEqual(["unit"]);
    });

    it("names a dataset after the settings that change its temperatures or mosaics, after a name taken", () => {
        const s = {...DEFAULTS, normalize: true, max_pitch: -60, emissivity: 0.9, palette: "ironred", outputs: ["gray16:png"],
                   compression: "none", visual: false};
        expect(defaultName(s, DEFAULTS, [])).toBe("Emissivity 0.9 · normalized · pitch ≤ -60°");
        expect(defaultName({...DEFAULTS, mosaics: false}, DEFAULTS, [])).toBe("No mosaics");
        expect(defaultName({...DEFAULTS, palette: "ironred"}, DEFAULTS, [])).toBe("Default settings");
        expect(defaultName(DEFAULTS, DEFAULTS, ["Default settings", "Default settings (2)"])).toBe("Default settings (3)");
    });

    it("puts one setting back at its default, the unit converting the temperatures back", () => {
        const s = {...DEFAULTS, unit: "K", range_min: 283.15, range_max: 333.15, emissivity: .95, gimbal_yaw: 10};
        expect(resetSetting(s, DEFAULTS, "range")).toEqual({...s, range_min: null, range_max: null});
        expect(resetSetting(s, DEFAULTS, "gimbal").gimbal_yaw).toBeNull();
        const back = resetSetting({...s, reflected_temp: 293.15}, DEFAULTS, "unit");
        expect(back.unit).toBe("C");
        expect(back.reflected_temp).toBeCloseTo(20);
        expect(back.range_min).toBeCloseTo(10);
    });

    it("refuses settings with no output, half a colour range or no fixed distance", () => {
        expect(formProblem(DEFAULTS)).toBeNull();
        expect(formProblem({...DEFAULTS, outputs: []})).toMatch(/at least one output/);
        expect(formProblem({...DEFAULTS, range_min: 10})).toMatch(/both ends/);
        expect(formProblem({...DEFAULTS, distance: ""})).toMatch(/distance/);
    });
});

describe("the dataset's files and conversions", () => {
    it("show a frame's distance as embedded / the rangefinder's, and a visual photo's rangefinder alone", () => {
        const col = FILE_COLUMNS.find((c) => c.key === "distance")!;
        expect(cell({path: "a_T.JPG", kind: "thermal", distance: 5, lrf: 21.4}, col)).toBe("5.0 m / 21.4 m");
        expect(cell({path: "a_T.JPG", kind: "thermal", distance: 5}, col)).toBe("5.0 m");
        expect(cell({path: "a_V.JPG", kind: "not_thermal", distance: null, lrf: 20.7}, col)).toBe("20.7 m");
        expect(cell({path: "a_V.JPG", kind: "not_thermal"}, col)).toBe("");
    });

    it("filters the files by every word of a text condition, in any case, or by none of them", () => {
        const view = {filters: [{key: "path", op: "has" as const, value: "T.jpg THERMAL"}], sort: "path", desc: false};
        expect(fileRows(ANALYSIS, view).map((r) => r.path)).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect(names([{key: "path", op: "has", value: "a_ jpg"}])).toEqual(["rgb/a_V.JPG", "thermal/a_T.JPG"]);
        expect(names([{key: "path", op: "not", value: "rgb b_"}])).toEqual(["thermal/a_T.JPG"]);
        expect(names([{key: "time", op: "has", value: "2026-10-12 18:30"}])).toEqual(["thermal/b_T.JPG"]);
    });

    it("shows only the files matching every condition, numbers compared in the unit shown", () => {
        expect(names([{key: "alt", op: "le", value: "20"}])).toEqual(["thermal/a_T.JPG"]);
        expect(names([{key: "alt", op: "ge", value: "20"}, {key: "tmin", op: "lt", value: "16"}])).toEqual(["thermal/b_T.JPG"]);
        expect(names([{key: "emissivity", op: "gt", value: "0.9"}])).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        setUserUnit("F");
        expect(names([{key: "tmin", op: "gt", value: "60"}])).toEqual(["thermal/a_T.JPG"]);
    });

    it("compares = and ≠ at the digits shown", () => {
        expect(names([{key: "tmean", op: "eq", value: "21.9"}])).toEqual(["thermal/a_T.JPG"]);
        expect(names([{key: "tmean", op: "ne", value: "21.9"}])).toEqual(["thermal/b_T.JPG"]);
    });

    it("leaves out a file without the value, and filters nothing by a condition still being typed", () => {
        expect(names([{key: "alt", op: "lt", value: "100"}])).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect(names([{key: "alt", op: "lt", value: ""}, {key: "path", op: "has", value: " "}])).toHaveLength(3);
        expect(active({key: "alt", op: "lt", value: "-"})).toBe(false);
    });

    it("filters by kind and problems", () => {
        expect(names([{key: "kind", op: "in", value: ["visual"]}])).toEqual(["rgb/a_V.JPG"]);
        expect(names([{key: "kind", op: "in", value: []}])).toEqual([]);
        expect(names([{key: "problems", op: "is", value: true}])).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
    });

    it("tells which button's filter is set, if any", () => {
        expect(shownAs([])).toBe("all");
        expect(shownAs([{key: "kind", op: "in", value: ["thermal"]}])).toBe("thermal");
        expect(shownAs([{key: "kind", op: "in", value: ["visual"]}])).toBeNull();
        expect(shownAs([{key: "problems", op: "is", value: true}, {key: "path", op: "has", value: ""}])).toBe("flagged");
        expect(SHOWS.map(([s]) => s)).toEqual(["all", "thermal", "flagged"]);
    });

    it("writes the filter in a link or a favourite and reads it back, leaving out what it does not know", () => {
        const filters: Condition[] = [{key: "alt", op: "le", value: "20.5"}, {key: "kind", op: "in", value: ["thermal", "visual"]},
                                      {key: "problems", op: "is", value: false}, {key: "path", op: "has", value: "a.b c"}];
        const query = filterQuery(filters);
        expect(query).toEqual(["alt.le.20.5", "kind.in.thermal,visual", "problems.is.no", "path.has.a.b c"]);
        const search = "?" + query.map((q) => "filter=" + encodeURIComponent(q)).join("&") + "&filter=size.gt.1&filter=alt.has.2";
        expect(parseFilters(search)).toEqual(filters);
        expect(filtersFrom([...query, "size.gt.1"])).toEqual(filters);
        expect(newCondition("kind")).toEqual({key: "kind", op: "in", value: []});
        expect(columnType("tmin")).toBe("number");
    });

    it("reads the Thermal frame column's filter, from before Kind said it alone, as Kind", () => {
        expect(filtersFrom(["thermal_frame.is.yes"])).toEqual([{key: "kind", op: "in", value: ["thermal"]}]);
        const others = filtersFrom(["thermal_frame.is.no"])[0].value as string[];
        expect(others).toContain("visual");
        expect(others).not.toContain("thermal");
        expect(names(filtersFrom(["thermal_frame.is.no"]))).toEqual(["rgb/a_V.JPG"]);
    });

    it("calls a JPEG that is not thermal and named as DJI names a visual image visual", () => {
        expect(fileKind({path: "rgb/a_V.JPG", kind: "not_thermal"})).toBe("visual");
        expect(fileKind({path: "rgb/a_W.jpeg", kind: "not_thermal"})).toBe("visual");
        expect(fileKind({path: "rgb/a_Z.JPG", kind: "not_thermal"})).toBe("not_thermal");
        expect(fileKind({path: "rgb/a_V.JPG", kind: "corrupt"})).toBe("corrupt");
        expect(fileKind({path: "a_T.JPG", kind: "thermal"})).toBe("thermal");
    });

    it("sorts with what has nothing to sort by last, both ways", () => {
        expect(sortRows([{v: 2}, {v: null}, {v: 1}], "v", false).map((r) => r.v)).toEqual([1, 2, null]);
        expect(sortRows([{v: 2}, {v: null}, {v: 1}], "v", true).map((r) => r.v)).toEqual([2, 1, null]);
    });

    it("opens the frames in the newest ready conversion", () => {
        expect(newestReady([CONVERSION])!.id).toBe(9);
        expect(newestReady([{...CONVERSION, status: "failed"}])).toBeNull();
    });

    it("counts why images were skipped, the most common first", () => {
        expect(skipReasons([
            {path: "a", ok: false, reason: "oblique (gimbal pitch -45 above -80)"},
            {path: "b", ok: false, reason: "no DJI thermal data found (not an R-JPEG)"},
            {path: "c", ok: false, reason: "oblique (gimbal pitch -30 above -80)"},
            {path: "d", ok: true},
        ])).toEqual([["oblique", 2], ["no DJI thermal data found", 1]]);
    });

    it("reads a link's request to start from a conversion with some measurements changed", () => {
        expect(parsePrefill("?from=9&emissivity=0.98&distance=12&palette=x&humidity=")).toEqual(
            {from: 9, changes: {emissivity: 0.98, distance: 12}});
        expect(parsePrefill("?emissivity=0.98")).toBeNull();
    });
});

describe("the dataset page", () => {
    it("shows the dataset, its figures and its tabs, the datasets first once it has some", async () => {
        page(routes());
        expect($(".message")!.textContent).toBe("Loading…");
        await ticks();
        expect(byId("name").textContent).toBe("Roof");
        expect(document.title).toBe("Roof · DJI Thermal Analyzer");
        expect($(".figures")!.textContent).toContain("M4T · 640×512 · SN1 · 2 frame(s)");
        expect($(".figures")!.textContent).toContain("Thermal frames2 (and 1 visual)");
        expect($$("[role=tab]").map((t) => t.getAttribute("data-tab"))).toEqual(["files", "problems", "webodm", "datasets"]);
        expect(selected()).toBe("datasets");
        expect(tab("files").querySelector(".badge")!.textContent).toBe("3");
        expect(tab("problems").querySelector(".badge")!.textContent).toBe("1");
        expect(tab("datasets").querySelector(".badge")!.textContent).toBe("1");
        expect(tab("datasets").textContent).toContain("Datasets");
        expect(byId("next-step")).toBeNull();
        expect(byId("analyze").textContent).toContain("Analyze again");
        expect(byId("add-images")).not.toBeNull();
        expect(byId("report").getAttribute("href")).toBe("/dataset/5/report");
    });

    it("says when the dataset could not be loaded", async () => {
        page(server({[URL]: () => jsonResponse({}, false)}));
        await ticks();
        expect($(".notice.error[role=alert]")!.textContent).toBe("Could not load the flight.");
    });

    it("opens on the files with the next step shown once analyzed, the step opening the Datasets tab", async () => {
        page(routes({...DETAIL, conversions: []}));
        await ticks();
        expect(selected()).toBe("files");
        expect(byId("next-step").textContent).toContain("Next: make a dataset.");
        expect(byId("next-step").textContent).toContain("2 thermal frames");
        click(byId("next-convert"));
        await ticks();
        expect(selected()).toBe("datasets");
        expect(byId("convert-start")).not.toBeNull();
        expect($(".settings-form")).toBeNull();
    });

    it("shows only the Datasets tab before the analysis, and no tabs while the first analysis runs", async () => {
        page(routes([{...DATASET, status: "new", analyzed: false, analysis: null, conversions: []},
                     {...DATASET, status: "analyzing", progress: 0.2, analyzed: false, analysis: null, conversions: []}],
                    {["POST " + URL + "/analyze"]: {...DATASET, status: "analyzing", progress: 0.2, analyzed: false,
                                                    analysis: null, conversions: []}}));
        await ticks();
        expect(byId("status").textContent).toBe("3 file(s), not analyzed yet.");
        expect($$("[role=tab]").map((t) => t.getAttribute("data-tab"))).toEqual(["datasets"]);
        expect(selected()).toBe("datasets");
        expect(byId("analyze").textContent).toContain("Analyze");
        expect($(".convert-tab")!.textContent).toContain("No datasets yet");
        expect(byId("next-step")).toBeNull();
        click(byId("analyze"));
        await ticks();
        expect($$("[role=tab]")).toHaveLength(0);
        expect($(".convert-tab")).toBeNull();
    });

    it("opens the tab a link names, the Datasets tab by its old name too", async () => {
        history.replaceState(null, "", "/dataset/5#convert");
        page(routes());
        await ticks();
        expect(selected()).toBe("datasets");
        click(tab("problems"));
        await ticks();
        expect(selected()).toBe("problems");
        expect($$(".finding").length).toBe(2);
    });

    it("follows the analysis until it is done, and cancels it", async () => {
        vi.useFakeTimers();
        const fetchFn = routes([{...DETAIL, status: "analyzing", progress: 0.5}, {...DETAIL, status: "analyzing", progress: 0.5}, DETAIL],
                               {["POST " + URL + "/cancel"]: {...DETAIL, status: "canceled"}});
        page(fetchFn);
        await ticks();
        expect(byId("status").textContent).toContain("Reading the images: 50% of 3 files read…");
        expect(byId("cancel").textContent).toContain("Cancel the analysis");
        expect(byId("status").textContent).toContain("50%");
        expect(byId("analyze")).toBeNull();
        expect(byId("add-images")).toBeNull();
        vi.advanceTimersByTime(2000);
        await ticks();
        expect(calls(fetchFn).filter((c) => c === "GET " + URL).length).toBe(2);
        click(byId("cancel"));
        await ticks();
        expect(byId("status").textContent).toBe("The analysis was canceled.");
        vi.advanceTimersByTime(10000);
        await ticks();
        expect(calls(fetchFn).filter((c) => c === "GET " + URL).length).toBe(2);
    });

    it("starts the analysis, and says when it could not", async () => {
        const fetchFn = routes(DETAIL, {["POST " + URL + "/analyze"]: [() => jsonResponse({detail: "Busy."}, false),
                                                                      {...DETAIL, status: "analyzing", progress: 0}]});
        page(fetchFn);
        await ticks();
        click(byId("analyze"));
        await ticks();
        expect($(".notice.error")!.textContent).toBe("Busy.");
        click(byId("analyze"));
        await ticks();
        expect($(".notice.error")).toBeNull();
        expect(byId("status").textContent).toContain("Reading the images");
    });

    it("renames the dataset, and deletes it to go back to the list", async () => {
        const fetchFn = routes(DETAIL, {["PATCH " + URL]: {...DETAIL, name: "Barn"}, ["DELETE " + URL]: {}});
        const nav = page(fetchFn);
        await ticks();
        click(byId("rename"));
        await ticks();
        const input = dialog()!.querySelector("input")!;
        input.value = "Barn";
        press("Rename");
        await ticks();
        expect(body(fetchFn.mock.calls.find((c) => c[1]?.method === "PATCH")![1])).toEqual({name: "Barn"});
        expect(byId("name").textContent).toBe("Barn");

        click(byId("delete"));
        await ticks();
        expect(dialog()!.textContent).toContain("Delete flight");
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("DELETE " + URL);
        click(byId("delete"));
        await ticks();
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + URL);
        expect(nav).toHaveBeenCalledWith("/project/4");
    });

    it("copies a link to the dataset, or shows it to copy when the clipboard refuses", async () => {
        const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
        vi.stubGlobal("navigator", {...navigator, clipboard: {writeText}});
        page(routes());
        await ticks();
        click(byId("copy-link"));
        await ticks();
        expect(writeText).toHaveBeenCalledWith(location.origin + "/dataset/5");
        expect(byId("copy-link").textContent).toContain("Copied");
        click(byId("copy-link"));
        await ticks();
        expect(dialog()!.querySelector("input")!.value).toBe(location.origin + "/dataset/5");
        press("Close");
        await ticks();
        expect(dialog()).toBeNull();
    });

    it("adds images, analyzes them, and sends again only those that failed", async () => {
        let failing = true;
        const fetchFn = routes(DETAIL, {
            ["POST " + URL + "/upload"]: (_: string, opts?: RequestInit) =>
                failing && paths(opts).includes("k_T.JPG") ? jsonResponse({}, false) : jsonResponse({saved: paths(opts).length}),
            ["POST " + URL + "/analyze"]: {...DETAIL, status: "analyzing", progress: 0},
        });
        page(fetchFn);
        await ticks();
        choose(byId("add-images").querySelector("input")!, NAMES.map((n) => file(n)));
        await ticks(200);
        expect(calls(fetchFn)).toContain("POST " + URL + "/analyze");
        expect(byId("add-failed").textContent).toContain("k_T.JPG");
        failing = false;
        click(byId("add-failed").querySelector("button")!);
        await ticks(200);
        const uploads = fetchFn.mock.calls.filter((c) => c[0] === URL + "/upload");
        expect(paths(uploads[uploads.length - 1][1])).toEqual(["k_T.JPG"]);
        expect(byId("add-failed")).toBeNull();
    });

    it("asks for JPEG images when none were chosen", async () => {
        const fetchFn = routes();
        page(fetchFn);
        await ticks();
        choose(byId("add-images").querySelector("input")!, [file("notes.txt")]);
        await ticks();
        expect($(".notice.error")!.textContent).toBe("Choose JPEG images (the flight's R-JPEGs) or the drone's MP4 videos.");
        expect(calls(fetchFn)).not.toContain("POST " + URL + "/upload");
    });

    it("keeps the images sent when an upload is canceled, without analyzing them", async () => {
        // The first request is saved, the second never answers
        const fetchFn = routes(DETAIL, {
            ["POST " + URL + "/upload"]: [(_: string, opts?: RequestInit) => jsonResponse({saved: paths(opts).length}),
                                          () => new Promise<Response>(() => {})],
        });
        page(fetchFn);
        await ticks();
        choose(byId("add-images").querySelector("input")!, NAMES.map((n) => file(n)));
        await ticks();
        expect(byId("add-progress").textContent).toContain("Uploading 10 of 11 images");
        click(byId("add-progress").querySelector("button")!);
        await ticks(200);
        expect(byId("add-progress")).toBeNull();
        expect(calls(fetchFn)).not.toContain("POST " + URL + "/analyze");
        expect(byId("add-failed").textContent).toContain("Upload canceled: 10 images were sent and kept");
        expect(byId("add-failed").textContent).toContain("1 image was not sent.");
    });

    it("lists the files, linked to their frames once a conversion is ready, and keeps the filter through the polls", async () => {
        filesFirst();
        vi.useFakeTimers();
        const busy = {...CONVERSION, id: 10, status: "converting", progress: 0.2, finished_at: null};
        page(routes({...DETAIL, conversions: [busy]}));
        await ticks();
        expect(fileNames()).toEqual(["rgb/a_V.JPG", "thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect($("table.files a")).toBeNull();
        expect($(".files-hint")).not.toBeNull();
        click(byId("add-filter"));
        await ticks();
        type($<HTMLInputElement>(".filter-value")!, "thermal");
        await ticks();
        expect($(".files-shown")!.textContent).toBe("2 shown");
        vi.advanceTimersByTime(2000);
        await ticks();
        expect($<HTMLInputElement>(".filter-value")!.value).toBe("thermal");
        expect(fileNames()).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);

        render(null, byId("root"));
        page(routes());
        await ticks();
        const link = $<HTMLAnchorElement>("table.files a")!;
        expect(link.getAttribute("href")).toBe("/conversion/9/frame?frame=thermal%2Fa_T.JPG");
        expect($$("table.files a").length).toBe(2);
    });

    it("shows a file's picture and details beside the list as the pointer passes over its name or thumbnail", async () => {
        filesFirst();
        localStorage.setItem("thermalAnalyzer.thumbnails", "1");
        page(routes());
        await ticks();
        const row = (path: string) => $$("table.files tbody tr").find((tr) => tr.textContent!.includes(path))!;
        const enter = async (el: Element) => { el.dispatchEvent(new MouseEvent("mouseenter")); await ticks(); };
        const shown = () => $(".files-detail-name")?.textContent ?? null;
        expect($<HTMLInputElement>(".files-hover-detail")!.checked).toBe(true);
        expect(shown()).toBeNull();

        await enter(row("thermal/a_T.JPG").children[1]);
        expect(shown()).toBe("thermal/a_T.JPG");
        expect($<HTMLImageElement>(".files-detail img")!.getAttribute("src")).toBe(URL + "/thumbnail?file=thermal%2Fa_T.JPG&size=preview");
        expect($(".files-detail-open a")!.getAttribute("href")).toBe("/conversion/9/frame?frame=thermal%2Fa_T.JPG");
        const details = $(".files-detail-columns")!.textContent!;
        expect(details).toContain("Emissivity");
        expect(details).toContain("0.91");
        await enter(row("rgb/a_V.JPG").querySelector("td.thumb")!);
        expect(shown()).toBe("rgb/a_V.JPG");
        expect($(".files-detail-open a")).toBeNull();

        // Closed, it stays shut until another row is hovered
        click($(".files-detail .close")!);
        await ticks();
        expect(shown()).toBeNull();
        await enter(row("rgb/a_V.JPG").children[1]);
        expect(shown()).toBeNull();
        await enter(row("thermal/b_T.JPG").children[1]);
        expect(shown()).toBe("thermal/b_T.JPG");
        await enter(row("rgb/a_V.JPG").children[1]);
        expect(shown()).toBe("rgb/a_V.JPG");

        // Unchecked, hovering shows nothing, and the box is remembered
        click($(".files-hover-detail")!);
        await ticks();
        expect(shown()).toBeNull();
        expect(localStorage.getItem("thermalAnalyzer.hoverDetail")).toBe("0");
        await enter(row("thermal/b_T.JPG").children[1]);
        expect(shown()).toBeNull();
    });

    it("keeps a selected file in the pane until it is deselected, whatever is hovered", async () => {
        filesFirst();
        localStorage.setItem("thermalAnalyzer.thumbnails", "1");
        page(routes());
        await ticks();
        const row = (path: string) => $$("table.files tbody tr").find((tr) => tr.textContent!.includes(path))!;
        const enter = async (el: Element) => { el.dispatchEvent(new MouseEvent("mouseenter")); await ticks(); };
        const shown = () => $(".files-detail-name")?.textContent ?? null;

        // Hovering on: a selected row holds the pane; clicked again, the pane follows the pointer again
        click(row("thermal/b_T.JPG").children[3]);
        await ticks();
        expect(row("thermal/b_T.JPG").classList.contains("selected")).toBe(true);
        expect(shown()).toBe("thermal/b_T.JPG");
        await enter(row("thermal/a_T.JPG").children[1]);
        expect(shown()).toBe("thermal/b_T.JPG");
        click(row("thermal/b_T.JPG").children[3]);
        await ticks();
        expect(row("thermal/b_T.JPG").classList.contains("selected")).toBe(false);
        expect(shown()).toBe("thermal/a_T.JPG");

        // Its thumbnail selects it too; Escape deselects and closes
        click(row("rgb/a_V.JPG").querySelector(".thumb-button")!);
        await ticks();
        expect(row("rgb/a_V.JPG").querySelector(".thumb-button")!.getAttribute("aria-pressed")).toBe("true");
        expect(shown()).toBe("rgb/a_V.JPG");
        key(document.body, "Escape");
        await ticks();
        expect(shown()).toBeNull();
        expect($$("table.files tr.selected").length).toBe(0);

        // Hovering off: only a selected row opens the pane, and unchecking the box keeps it
        click(row("thermal/a_T.JPG").children[3]);
        await ticks();
        click($(".files-hover-detail")!);
        await ticks();
        expect(shown()).toBe("thermal/a_T.JPG");
        await enter(row("thermal/b_T.JPG").children[1]);
        expect(shown()).toBe("thermal/a_T.JPG");
        click($(".files-detail .close")!);
        await ticks();
        expect(shown()).toBeNull();
        await enter(row("thermal/b_T.JPG").children[1]);
        expect(shown()).toBeNull();
    });

    it("colours the thermal pictures with the preferred palette, the visual photos as they are", async () => {
        filesFirst();
        localStorage.setItem("thermalAnalyzer.thumbnails", "1");
        page(routes(), vi.fn(), "dji_ironred");
        await ticks();
        const row = (path: string) => $$("table.files tbody tr").find((tr) => tr.textContent!.includes(path))!;
        const thumb = (path: string) => row(path).querySelector("td.thumb img")!.getAttribute("src");
        expect(thumb("thermal/a_T.JPG")).toBe(URL + "/thumbnail?file=thermal%2Fa_T.JPG&palette=dji_ironred");
        expect(thumb("rgb/a_V.JPG")).toBe(URL + "/thumbnail?file=rgb%2Fa_V.JPG");
        click(row("thermal/a_T.JPG").children[3]);
        await ticks();
        expect($<HTMLImageElement>(".files-detail img")!.getAttribute("src"))
            .toBe(URL + "/thumbnail?file=thermal%2Fa_T.JPG&palette=dji_ironred&size=preview");
    });

    it("shows the pane's file at its own size over the page, fitting the window, zoomed and panned", async () => {
        filesFirst();
        page(routes(), vi.fn(), "magma");
        await ticks();
        const row = (path: string) => $$("table.files tbody tr").find((tr) => tr.textContent!.includes(path))!;
        click(row("thermal/a_T.JPG").children[3]);
        await ticks();
        click($(".files-full-size")!);
        await ticks();
        const img = $<HTMLImageElement>(".full-size-stage img")!;
        expect(img.getAttribute("src")).toBe(URL + "/thumbnail?file=thermal%2Fa_T.JPG&palette=magma&size=full");
        expect($(".full-size-name")!.textContent).toBe("thermal/a_T.JPG");
        expect($(".full-size-loading")).not.toBeNull();

        // Loaded (640 x 512) on a 1280 x 1024 stage: twice its size, centred; 1:1 and back to the fit
        $(".full-size-stage")!.getBoundingClientRect = () => ({left: 0, top: 0, width: 1280, height: 1024}) as DOMRect;
        Object.defineProperties(img, {naturalWidth: {value: 640}, naturalHeight: {value: 512}});
        img.dispatchEvent(new Event("load"));
        await ticks();
        expect($(".full-size-dims")!.textContent).toBe("640 × 512 px, 200 %");
        expect(img.style.width).toBe("1280px");
        click($(".full-size-actual")!);
        await ticks();
        expect([img.style.width, img.style.transform]).toEqual(["640px", "translate(320px, 256px)"]);

        // The wheel zooms about the pointer, dragging pans
        $(".full-size-stage")!.dispatchEvent(new WheelEvent("wheel", {deltaY: -100, clientX: 320, clientY: 256, bubbles: true, cancelable: true}));
        await ticks();
        expect([img.style.width, img.style.transform]).toEqual(["800px", "translate(320px, 256px)"]);
        const stage = $(".full-size-stage")!;
        stage.dispatchEvent(new PointerEvent("pointerdown", {button: 0, pointerId: 1, clientX: 100, clientY: 100, bubbles: true}));
        stage.dispatchEvent(new PointerEvent("pointermove", {pointerId: 1, clientX: 130, clientY: 90, bubbles: true}));
        stage.dispatchEvent(new PointerEvent("pointerup", {pointerId: 1, bubbles: true}));
        await ticks();
        expect(img.style.transform).toBe("translate(350px, 246px)");
        click($(".full-size-fit")!);
        await ticks();
        expect(img.style.width).toBe("1280px");

        // Escape closes it, and only it: the pane stays
        key(document.body, "Escape");
        await ticks();
        expect($(".full-size")).toBeNull();
        expect($(".files-detail-name")!.textContent).toBe("thermal/a_T.JPG");
        click($(".files-full-size")!);
        await ticks();
        click($(".full-size .close")!);
        await ticks();
        expect($(".full-size")).toBeNull();
    });

    it("sorts the files by a column, both ways", async () => {
        filesFirst();
        page(routes());
        await ticks();
        const sort = () => $("th[data-sort=alt] button")!;
        click(sort());
        await ticks();
        expect($("th[data-sort=alt]")!.getAttribute("aria-sort")).toBe("ascending");
        expect(fileNames()).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG", "rgb/a_V.JPG"]);
        click(sort());
        await ticks();
        expect($("th[data-sort=alt]")!.getAttribute("aria-sort")).toBe("descending");
        expect(fileNames()).toEqual(["thermal/b_T.JPG", "thermal/a_T.JPG", "rgb/a_V.JPG"]);
    });

    it("opens the Files tab on a problem's file", async () => {
        page(routes());
        await ticks();
        click(tab("problems"));
        await ticks();
        expect($(".finding .suggestion")!.textContent).toContain("“Replace above” under Adjustments");
        expect($(".finding .badge")!.getAttribute("title")).toBe("dji-thermal-cli's code: temperature_max_outlier");
        expect($(".finding-files a")!.textContent).toBe("thermal/b_T.JPG 50.6 °C");
        click($(".finding-files a")!);
        await ticks();
        expect(selected()).toBe("files");
        expect($<HTMLInputElement>(".filter-value")!.value).toBe("thermal/b_T.JPG");
        expect(fileNames()).toEqual(["thermal/b_T.JPG"]);
    });

    it("opens the New dataset form with a problem's fix set, converting nothing", async () => {
        filesFirst();
        const fetchFn = routes();
        page(fetchFn);
        await ticks();
        click(tab("problems"));
        await ticks();
        const fixes = [...document.querySelectorAll<HTMLButtonElement>(".finding-fix button")];
        expect(fixes.map((b) => b.textContent!.trim())).toEqual(["Include them"]);
        click(fixes[0]);
        await ticks();
        expect(selected()).toBe("datasets");
        expect($<HTMLInputElement>("input[name=max_pitch]")!.value).toBe("-45");
        expect($(".convert-settings")!.textContent).toContain(
            "Only frames with a gimbal pitch at or below -45° are used. Convert when the rest is as you want it.");
        expect(fetchFn.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")).toHaveLength(0);
    });

    it("starts the filter from a button, shown as its condition to change from there", async () => {
        filesFirst();
        page(routes());
        await ticks();
        expect(showChosen()).toBe("all");
        expect(filterRows()).toHaveLength(0);
        click($("[name=files-show][value=thermal]")!);
        await ticks();
        expect(filterRows().map((r) => r.dataset.key)).toEqual(["kind"]);
        expect($(".filter-row")!.textContent).toContain("Thermal");
        expect(shownCount()).toBe("2 shown");
        click($("[name=files-show][value=flagged]")!);
        await ticks();
        expect(filterRows().map((r) => r.dataset.key)).toEqual(["problems"]);
        expect(fileNames()).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        click($("[name=files-show][value=all]")!);
        await ticks();
        expect(filterRows()).toHaveLength(0);
        expect(shownCount()).toBe("3 shown");
    });

    it("adds conditions on any column, with the comparisons that column has, and clears them", async () => {
        filesFirst();
        page(routes());
        await ticks();
        click(byId("add-filter"));
        await ticks();
        change($<HTMLSelectElement>(".filter-row [name=column]")!, "alt");
        await ticks();
        const ops = () => [...$<HTMLSelectElement>(".filter-row [name=op]")!.options].map((o) => o.textContent);
        expect(ops()).toEqual(["=", "≠", "<", "≤", ">", "≥"]);
        expect($(".filter-row")!.textContent).toContain("m");
        change($<HTMLSelectElement>(".filter-row [name=op]")!, "le");
        await ticks();
        type($<HTMLInputElement>(".filter-value")!, "20");
        await ticks();
        expect(fileNames()).toEqual(["thermal/a_T.JPG"]);
        expect(new URLSearchParams(location.search).getAll("filter")).toEqual(["alt.le.20"]);
        click(byId("add-filter"));
        await ticks();
        change($$(".filter-row [name=column]")[1] as HTMLSelectElement, "pitch");
        await ticks();
        type($$(".filter-value")[1] as HTMLInputElement, "-50");
        await ticks();
        change($$(".filter-row [name=op]")[1] as HTMLSelectElement, "lt");
        await ticks();
        expect(fileNames()).toEqual([]);
        click($$(".filter-row button[aria-label='Remove this filter']")[0]);
        await ticks();
        expect(fileNames()).toEqual(["thermal/b_T.JPG"]);
        click(byId("clear-filters"));
        await ticks();
        expect(shownCount()).toBe("3 shown");
        expect(location.search).toBe("");
    });

    it("filters by kind from the Kind column's checkboxes, All checking or unchecking every kind", async () => {
        filesFirst();
        page(routes());
        await ticks();
        click($("th[data-sort=kind] .kind-button")!);
        await ticks();
        const box = (name: string) => $<HTMLInputElement>(`th[data-sort=kind] .kind-items [name="${name}"]`)!;
        expect([...document.querySelectorAll("th .kind-items label")].map((l) => l.textContent!.trim())).toEqual(["All", "Thermal", "Visual"]);
        expect([box("all").checked, box("thermal").checked, box("visual").checked]).toEqual([true, true, true]);
        click(box("visual"));
        await ticks();
        expect([box("all").checked, box("thermal").checked, box("visual").checked]).toEqual([false, true, false]);
        expect(fileNames()).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect(filterRows().map((r) => r.dataset.key)).toEqual(["kind"]);
        expect($(".filter-row .kind-button")!.textContent).toContain("Thermal");
        click(box("all"));
        await ticks();
        expect([box("all").checked, box("thermal").checked, box("visual").checked]).toEqual([true, true, true]);
        expect(filterRows()).toHaveLength(0);
        expect(shownCount()).toBe("3 shown");
        click(box("all"));
        await ticks();
        expect([box("thermal").checked, box("visual").checked]).toEqual([false, false]);
        expect(shownCount()).toBe("0 shown");
        click(box("visual"));
        await ticks();
        expect(fileNames()).toEqual(["rgb/a_V.JPG"]);
        key(document.body, "Escape");
        await ticks();
        expect($("th .kind-items")).toBeNull();
    });

    it("names each file's problems in one column, their sentences as tooltips, and reads the filter from a link", async () => {
        history.replaceState(null, "", "/dataset/5?filter=problems.is.yes#files");
        page(routes());
        await ticks();
        expect(showChosen()).toBe("flagged");
        expect(fileNames()).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        click($("[name=files-show][value=all]")!);
        await ticks();
        expect($$("table.files thead th").map((th) => th.textContent)).not.toContain("Thermal frame");
        expect($$("table.files thead th").some((th) => th.textContent === "Notes")).toBe(false);
        const problems = $$("table.files tbody td.problems");
        expect(problems.map((td) => td.textContent!.trim())).toEqual(["", "Oblique", "Unusual max"]);
        const badge = problems[2].querySelector(".badge")!;
        expect(badge.className).toContain("warning");
        expect(badge.getAttribute("title")).toContain("unusual maximum");
        expect(badge.getAttribute("title")).not.toContain("<maximum>");
        expect(location.search).toBe("");
        expect(location.hash).toBe("#files");
    });

    it("chooses a favourite filter in place of the filter shown, and marks it while the filter is its own", async () => {
        filesFirst();
        const saved = [{name: "Low", filters: ["alt.le.20"]}, {name: "Visual", filters: ["kind.in.visual", "gone.eq.1"]}];
        page(routes(DETAIL, {[API + "file-filters"]: {filters: saved}}));
        await ticks();
        click($("[name=files-show][value=thermal]")!);
        await ticks();
        click(byId("favourites"));
        await ticks();
        expect(favourites()).toEqual(["Low", "Visual"]);
        click($$(".favourite-name")[0]);
        await ticks();
        expect($(".favourite-items")).toBeNull();
        expect(fileNames()).toEqual(["thermal/a_T.JPG"]);
        expect(filterRows().map((r) => r.dataset.key)).toEqual(["alt"]);
        expect(byId("favourites").textContent).toContain("Low");
        click(byId("favourites"));
        await ticks();
        expect($(".favourite-name[aria-current=true]")!.textContent).toContain("Low");
        click($$(".favourite-name")[1]);
        await ticks();
        expect(fileNames()).toEqual(["rgb/a_V.JPG"]);
        expect(filterRows().map((r) => r.dataset.key)).toEqual(["kind"]);
        click(byId("add-filter"));
        await ticks();
        expect(byId("favourites").textContent).toContain("Visual");
        click($("[name=files-show][value=all]")!);
        await ticks();
        expect(byId("favourites").textContent).toContain("Favourites");
    });

    it("saves the filter under a new name, never over a favourite of that name", async () => {
        filesFirst();
        const fetchFn = routes(DETAIL, {
            [API + "file-filters"]: {filters: [{name: "Low", filters: ["alt.le.20"]}]},
            ["POST " + API + "file-filters"]: [
                () => Promise.resolve({ok: false, status: 409, json: () => Promise.resolve({name: ["taken"]})} as Response),
                {filters: [{name: "Low", filters: ["alt.le.20"]}, {name: "Problems", filters: ["problems.is.yes"]}]}],
        });
        page(fetchFn);
        await ticks();
        click(byId("favourites"));
        await ticks();
        expect($<HTMLButtonElement>("#save-favourite")!.disabled).toBe(true);
        click(byId("favourites"));
        click($("[name=files-show][value=flagged]")!);
        await ticks();
        click(byId("add-filter"));
        await ticks();
        click(byId("favourites"));
        await ticks();
        click(byId("save-favourite"));
        await ticks();
        type($<HTMLInputElement>("#dialog-field")!, " Low ");
        press("Save");
        await ticks();
        expect(body(fetchFn.mock.calls.at(-1)![1])).toEqual({name: "Low", filters: ["problems.is.yes"]});
        expect(dialog()!.querySelector(".field-error")!.textContent).toContain("already named “Low”");
        type($<HTMLInputElement>("#dialog-field")!, "Problems");
        press("Save");
        await ticks();
        expect(dialog()).toBeNull();
        expect(calls(fetchFn).filter((c) => c.startsWith("POST"))).toHaveLength(2);
        expect(byId("favourites").textContent).toContain("Problems");
    });

    it("deletes a favourite once asked, keeping the filter shown", async () => {
        const fetchFn = routes(DETAIL, {
            [API + "file-filters"]: {filters: [{name: "Low & wide", filters: ["alt.le.20"]}]},
            ["DELETE " + API + "file-filters?name=Low%20%26%20wide"]: {filters: []},
        });
        history.replaceState(null, "", "/dataset/5?filter=alt.le.20#files");
        page(fetchFn);
        await ticks();
        click(byId("favourites"));
        await ticks();
        click($("button[aria-label='Delete Low & wide']")!);
        await ticks();
        press("Cancel");
        await ticks();
        expect(calls(fetchFn).some((c) => c.startsWith("DELETE"))).toBe(false);
        click(byId("favourites"));
        await ticks();
        click($("button[aria-label='Delete Low & wide']")!);
        await ticks();
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + API + "file-filters?name=Low%20%26%20wide");
        expect(fileNames()).toEqual(["thermal/a_T.JPG"]);
        click(byId("favourites"));
        await ticks();
        expect(favourites()).toEqual([]);
        expect($(".favourite-items")!.textContent).toContain("No favourites yet.");
    });

    it("exports the thermal frames the filter shows, measured with the newest dataset", async () => {
        const fetchFn = routes(DETAIL, {["POST " + URL + "/exports"]: {url: "/api/exports/ab"}});
        const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
        history.replaceState(null, "", "/dataset/5?filter=alt.le.20#files");
        page(fetchFn);
        await ticks();
        click(byId("export-frames"));
        await ticks();
        expect(byId("export-dialog").textContent).toContain("The 1 shown");
        expect(byId("export-dialog").textContent).toContain("All 2");
        expect($<HTMLSelectElement>("#export-conversion")!.value).toBe("9");
        // The newest dataset is normalized: its R-JPEGs and originals can't be made
        expect($<HTMLInputElement>("input[name=export-format][value=rjpeg]")!.disabled).toBe(true);
        // The originals with the flight's visual images, measured with nothing
        change($<HTMLSelectElement>("#export-conversion")!, "");
        await ticks();
        click($("input[name=export-format][value=original]")!);
        await ticks();
        expect($("input[name=export-visual]")).not.toBeNull();
        click($("input[name=export-format][value=png]")!);
        await ticks();
        change($<HTMLSelectElement>("#export-conversion")!, "9");
        await ticks();
        click(byId("export-save"));
        await ticks();
        expect(body(fetchFn.mock.calls.find((c) => c[1]?.method === "POST")![1]))
            .toEqual({format: "png", conversion: 9, frames: ["thermal/a_T.JPG"], view: {palette: null, range: null}});
        expect(download).toHaveBeenCalledTimes(1);
        expect(byId("export-dialog")).toBeNull();
        download.mockRestore();
    });

    it("shows the WebODM plan, copies its options and converts with its settings", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", {...navigator, clipboard: {writeText}});
        page(routes());
        await ticks();
        click(tab("webodm"));
        await ticks();
        expect($(".plan-tab .figures")!.textContent).toContain("2.1 cm/px");
        expect($("table.options")!.textContent).toContain("radiometric-calibration");
        expect($("pre.command")!.textContent).toBe("dji-thermal-cli process -o temp_c:tiff --normalize");
        click($(".odm-args button.copy")!);
        await ticks();
        expect(writeText).toHaveBeenCalledWith("--radiometric-calibration none");
        expect($(".odm-args button.copy")!.textContent).toContain("Copied");

        click(byId("plan-convert"));
        await ticks();
        expect(selected()).toBe("datasets");
        expect($(".convert-message")!.textContent).toBe("The form has the WebODM plan's settings: -o temp_c:tiff --normalize");
        expect(field("normalize").checked).toBe(true);
        expect(field("output-pseudo").checked).toBe(false);
    });
});

describe("the Datasets tab", () => {
    it("lists the datasets above the new one's settings, folded into chips, unfolds them to edit, and folds them again", async () => {
        page(routes());
        await ticks();
        expect($(".settings-form")).toBeNull();
        expect($(".convert-summary .chips")!.textContent).toBe("dji-thermal-cli's defaults");
        expect(card().querySelector(".chips")!.textContent).toContain("emissivity 0.95");
        expect(card().compareDocumentPosition(byId("convert-start")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(byId("edit-settings").textContent).toBe("Change settings");
        expect(byId("convert-save")).toBeNull();
        click(byId("edit-settings"));
        await ticks();
        expect($(".settings-form")).not.toBeNull();
        expect(byId("edit-settings").textContent).toBe("Hide settings");
        expect(byId("edit-settings").getAttribute("aria-expanded")).toBe("true");
        // Folded again, the values chosen kept
        click(field("normalize"));
        await ticks();
        click(byId("edit-settings"));
        await ticks();
        expect($(".settings-form")).toBeNull();
        expect(byId("edit-settings").textContent).toBe("Change settings");
        click(byId("edit-settings"));
        await ticks();
        expect(field("normalize").checked).toBe(true);
    });

    it("keeps the form folded with no datasets too, the Convert button above it, its outputs named for what they are", async () => {
        page(routes({...DETAIL, conversions: []}));
        await ticks();
        expect($(".settings-form")).toBeNull();
        await openSettings();
        expect(byId("convert-start").compareDocumentPosition($(".settings-form")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(field("output-temp_c").checked).toBe(true);
        const output = field("output-temp_c").closest("label")!;
        expect(output.textContent).toContain("Temperatures (°C), for measuring");
        expect(output.querySelector("code.output-cli")!.textContent).toBe("temp_c");
        expect(output.getAttribute("title")).toContain("float32");
        expect($(".field[data-field=emissivity] .help")!.textContent).toBe("recorded 0.91");
    });

    it("leaves out of the object distance's help the distances not known", async () => {
        page(routes({...DATASET, status: "new", analyzed: false, analysis: null, conversions: []}));
        await ticks();
        await openSettings();
        expect($(".field[data-field=distance_mode] .help")).toBeNull();
    });

    it("marks a changed setting and puts it back at its default", async () => {
        page(routes({...DETAIL, conversions: []}));
        await ticks();
        await openSettings();
        type(field("emissivity"), "0.95");
        await ticks();
        expect($(".field[data-field=emissivity]")!.classList.contains("changed")).toBe(true);
        expect($(".convert-summary .chips")!.textContent).toBe("emissivity 0.95");
        click($(".field[data-field=emissivity] .mark-note a")!);
        await ticks();
        expect(field("emissivity").value).toBe("");
        expect($(".field[data-field=emissivity]")!.classList.contains("changed")).toBe(false);
    });

    it("starts a conversion with the form's settings, marked fresh, and follows it", async () => {
        vi.useFakeTimers();
        const started = {...CONVERSION, id: 11, name: "Warm", status: "converting", progress: 0, finished_at: null,
                         mosaic_status: null, mosaic_files: []};
        const fetchFn = routes([{...DETAIL, conversions: []}, {...DETAIL, conversions: [started]},
                                {...DETAIL, conversions: [{...started, status: "ready", progress: 1, mosaic_status: "ready"}]}],
                               {["POST " + URL + "/conversions"]: started});
        page(fetchFn);
        await ticks();
        await openSettings();
        type(field("emissivity"), "0.95");
        await ticks();
        expect(byId<HTMLInputElement>("convert-name").placeholder).toBe("Emissivity 0.95");
        type(byId<HTMLInputElement>("convert-name"), " Warm ");
        await ticks();
        click(byId("convert-start"));
        await ticks();
        const post = fetchFn.mock.calls.find((c) => c[0] === URL + "/conversions")!;
        expect(body(post[1])).toEqual({name: "Warm", settings: {...DEFAULTS, emissivity: 0.95}});
        expect(card(11).classList.contains("fresh")).toBe(true);
        expect(card(11).querySelector(".badge")!.textContent).toBe("Converting");
        expect(card(11).textContent).toContain("Starting…");
        expect(card(11).querySelector("[data-action=cancel]")).not.toBeNull();
        vi.advanceTimersByTime(2000);
        await ticks();
        expect(card(11).querySelector(".badge")!.textContent).toBe("Converted");
        expect(card(11).querySelector(".conversion-actions a")!.textContent).toBe("View mosaics");
        vi.advanceTimersByTime(4000);
        await ticks();
        expect(card(11).classList.contains("fresh")).toBe(false);
        expect(calls(fetchFn).filter((c) => c === "GET " + URL).length).toBe(3);
    });

    it("offers the visual mosaic with the mosaics when the dataset has visual images, and sends it switched off", async () => {
        const fetchFn = routes({...DETAIL, conversions: []}, {["POST " + URL + "/conversions"]: {...CONVERSION, id: 12}});
        page(fetchFn);
        await ticks();
        await openSettings();
        const visual = $<HTMLInputElement>("input[name=visual]")!;
        expect(visual.checked).toBe(true);
        expect($(".field[data-field=visual]")!.textContent).toContain("1 visual image");
        click($<HTMLInputElement>("input[name=mosaics]")!);
        await ticks();
        expect($("input[name=visual]")).toBeNull();
        click($<HTMLInputElement>("input[name=mosaics]")!);
        await ticks();
        click($<HTMLInputElement>("input[name=visual]")!);
        await ticks();
        expect($(".convert-summary .chips")!.textContent).toBe("no visual mosaic");
        click(byId("convert-start"));
        await ticks();
        const post = fetchFn.mock.calls.find((c) => c[0] === URL + "/conversions")!;
        expect(body(post[1])).toEqual({name: "Default settings", settings: {...DEFAULTS, visual: false}});
    });

    it("offers an R-JPEG output's picture once it is chosen, and sends it", async () => {
        const fetchFn = routes({...DETAIL, conversions: []}, {["POST " + URL + "/conversions"]: {...CONVERSION, id: 12}});
        page(fetchFn);
        await ticks();
        await openSettings();
        expect($("select[name=rjpeg_picture]")).toBeNull();
        click($<HTMLInputElement>("input[name=output-rjpeg]")!);
        await ticks();
        const picture = $<HTMLSelectElement>("select[name=rjpeg_picture]")!;
        expect(picture.value).toBe("palette");
        change(picture, "original");
        await ticks();
        expect($(".convert-summary .chips")!.textContent).toContain("R-JPEGs with DJI's picture");
        click(byId("convert-start"));
        await ticks();
        const post = fetchFn.mock.calls.find((c) => c[0] === URL + "/conversions")!;
        expect(body(post[1])).toEqual({name: "Default settings", settings: {...DEFAULTS, rjpeg_picture: "original",
                                                            outputs: ["temp_c:tiff", "pseudo:png", "rjpeg:jpg"]}});
    });

    it("does not offer the visual mosaic without visual images", async () => {
        page(routes({...DETAIL, analysis: {...ANALYSIS, files: ANALYSIS.files!.filter((f) => f.kind === "thermal")},
                     conversions: []}));
        await ticks();
        expect($("input[name=visual]")).toBeNull();
    });

    it("does not send settings the form cannot have, nor what the server refuses", async () => {
        const fetchFn = routes({...DETAIL, conversions: []},
                               {["POST " + URL + "/conversions"]: () => jsonResponse({detail: "No images."}, false)});
        page(fetchFn);
        await ticks();
        await openSettings();
        type(field("range_min"), "10");
        await ticks();
        click(byId("convert-start"));
        await ticks();
        expect($(".convert-message.text-danger")!.textContent).toBe("Give both ends of the colour range, or neither.");
        expect(calls(fetchFn)).not.toContain("POST " + URL + "/conversions");
        type(field("range_min"), "");
        await ticks();
        click(byId("convert-start"));
        await ticks();
        expect($(".convert-message.text-danger")!.textContent).toBe("No images.");
    });

    it("saves the settings as the defaults, and resets them", async () => {
        // as the API answers: the settings only, not what can be chosen
        const saved = {settings: {...DEFAULTS, emissivity: 0.95}, saved: true};
        const fetchFn = routes({...DETAIL, conversions: []}, {["PUT " + API + "preferences"]: saved,
                                                              ["DELETE " + API + "preferences"]: {settings: DEFAULTS, saved: false}});
        page(fetchFn);
        await ticks();
        await openSettings();
        type(field("emissivity"), "0.95");
        await ticks();
        click(byId("convert-save"));
        await ticks();
        expect(body(fetchFn.mock.calls.find((c) => c[1]?.method === "PUT")![1]).settings.emissivity).toBe(0.95);
        expect($(".convert-message")!.textContent).toBe("Saved: new datasets start from these settings.");
        expect($(".convert-settings")!.textContent).toContain("Starting from your saved defaults.");
        click(byId("convert-reset"));
        await ticks();
        press("Reset");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + API + "preferences");
        expect(field("emissivity").value).toBe("");
        expect($(".convert-message")!.textContent).toBe("Back to dji-thermal-cli's defaults.");
        expect($(".convert-settings")!.textContent).toContain("temp_c");    // the products are still offered
    });

    it("fills the form from a link's conversion and changes, its temperatures in the user's unit", async () => {
        setUserUnit("F");
        history.replaceState(null, "", "/dataset/5?from=9&reflected_temp=80.6");
        const fetchFn = routes(DETAIL, {["POST " + URL + "/conversions"]: {...CONVERSION, id: 12}});
        page(fetchFn);
        await ticks();
        expect(field("reflected_temp").value).toBe("80.6");
        expect(field("emissivity").value).toBe("0.95");
        expect($(".convert-message")!.textContent).toMatch(/Nadir's settings, with reflected temp 80\.6/);
        click(byId("convert-start"));
        await ticks();
        const post = fetchFn.mock.calls.find((c) => c[0] === URL + "/conversions")!;
        expect(body(post[1]).settings.reflected_temp).toBeCloseTo(27);
    });

    it("shows a conversion's main action by its state", async () => {
        const cases: [Partial<Conversion>, string, string | null][] = [
            [{}, "View mosaics", "/conversion/9"],
            [{mosaic_status: null, mosaic_files: []}, "Frames", "/conversion/9/frame"],
            [{status: "failed", error: "boom", mosaic_status: null}, "Use settings", null],
            [{status: "converting", progress: 0.4}, "Cancel", null],
            [{mosaic_status: "building"}, "Cancel", null],
        ];
        for (const [change, label, href] of cases) {
            page(routes({...DETAIL, conversions: [{...CONVERSION, ...change}]}));
            await ticks();
            const main = card().querySelector(".conversion-actions > a, .conversion-actions > button")!;
            expect(main.textContent!.trim()).toBe(label);
            expect(main.getAttribute("href")).toBe(href);
            render(null, byId("root"));
        }
    });

    it("tells how the mosaics stand", async () => {
        const cases: [Partial<Conversion>, string | null][] = [
            [{mosaic_status: "failed", mosaic_error: "no overlap"}, "The mosaics failed: no overlap"],
            [{mosaic_status: "canceled"}, "Building the mosaics was canceled."],
            [{mosaic_status: null}, "No mosaics."],
            [{mosaic_status: "building"}, "Building the mosaics…"],
            [{}, null],
        ];
        for (const [change, text] of cases) {
            page(routes({...DETAIL, conversions: [{...CONVERSION, ...change}]}));
            await ticks();
            expect(card().querySelector(".mosaic-status")?.textContent ?? null).toBe(text);
            render(null, byId("root"));
        }
    });

    it("opens a conversion's menu, and closes it on a click beside it, Escape or a link chosen", async () => {
        page(routes());
        await ticks();
        await openMenu();
        expect(card().querySelector("[aria-expanded=true]")).not.toBeNull();
        expect(menuItem("Compare with…")!.getAttribute("href")).toBe("/conversion/9/compare");
        expect(menuItem("Download all")!.getAttribute("href")).toBe("/api/conversions/9/download");
        expect(menuItem("Build mosaics")).toBeUndefined();
        click(document.body);
        await ticks();
        expect(card().querySelector(".menu-items")).toBeNull();
        await openMenu();
        key(document.body, "Escape");
        await ticks();
        expect(card().querySelector(".menu-items")).toBeNull();
        await openMenu();
        const download = menuItem("Download all")!;
        download.addEventListener("click", (e) => e.preventDefault());     // jsdom does not download
        click(download);
        await ticks();
        expect(card().querySelector(".menu-items")).toBeNull();
    });

    it("lists the tasks made in WebODM, and opens Process in WebODM from a converted dataset's menu", async () => {
        const task = {id: 4, project_id: 2, project_name: "Site", task_id: "t", name: "Roof - Nadir", node: "",
                      status: "completed", progress: 1, uploaded: 10, total: 10, error: "", link: "http://w/dashboard/"};
        page(routes({...DETAIL, conversions: [{...CONVERSION, webodm_tasks: [task]}]},
                    {[API + "conversions/9/webodm"]: {configured: false, problems: [], warnings: [], options: [],
                                                      frames: 2, bytes: 10, name: "n", project_name: "p",
                                                      process_args: [], preset: null}}));
        await ticks();
        expect(card().querySelector(".webodm-task")!.textContent).toContain("WebODM: Roof - Nadir in Site Completed");
        await openMenu();
        click(menuItem("Process in WebODM")!);
        await ticks();
        expect(card().querySelector(".webodm-panel")!.textContent).toContain("WebODM is not set up yet");
        click([...card().querySelectorAll<HTMLButtonElement>(".webodm-panel button")].find((b) => b.textContent === "Close")!);
        await ticks();
        expect(card().querySelector(".webodm-panel")).toBeNull();
    });

    it("says the WebODM orthophoto is on the viewer, opens it without mosaics, and removes it", async () => {
        const orthophoto = {task: 4, task_name: "Roof - Nadir", downloaded_at: "2026-10-29T22:00:00Z"};
        const fetchFn = routes({...DETAIL, conversions: [{...CONVERSION, mosaic_status: "", orthophoto}]},
                               {["DELETE " + API + "conversions/9/orthophoto"]: {...CONVERSION, orthophoto: null}});
        page(fetchFn);
        await ticks();
        expect(card().querySelector(".webodm-shown")!.textContent!.replace(/\s+/g, " ").trim())
            .toBe("WebODM's orthophoto of Roof - Nadir is on the viewer's WebODM tab. Remove");
        expect(card().querySelector<HTMLAnchorElement>(".conversion-actions a.primary")!.textContent).toBe("View mosaics");
        click(card().querySelector<HTMLElement>('[data-action="orthophoto-remove"]')!);
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + API + "conversions/9/orthophoto");
    });

    it("says WebODM's DSM is here, projects the mosaics onto it on the cell typed, offers them again, and removes it", async () => {
        const dsm = {task: 4, task_name: "Roof - Nadir", downloaded_at: "2026-10-30T10:00:00Z", use: true, height_cell: 16,
                     pixel_m: 0.05};
        const conversion = {...CONVERSION, dsm, mosaics_dsm: null, mosaics_gsd_m: 0.015};
        const fetchFn = routes({...DETAIL, conversions: [conversion]}, {
            ["PATCH " + API + "conversions/9/dsm"]: conversion, ["DELETE " + API + "conversions/9/dsm"]: conversion,
            ["POST " + API + "conversions/9/mosaics"]: conversion});
        page(fetchFn);
        await ticks();
        const line = () => card().querySelector(".webodm-dsm-line")!.textContent!.replace(/\s+/g, " ").trim();
        expect(line()).toMatch(/^WebODM's DSM of Roof - Nadir is here\. Project the mosaics onto it, on height cells of px /);
        expect(line()).toContain("(about 24 cm). Remove");
        expect(card().querySelector(".dsm-built")!.textContent!.replace(/\s+/g, " ").trim())
            .toBe("The mosaics were built on their own heights. Rebuild mosaics");
        const cell = card().querySelector<HTMLInputElement>(".dsm-cell")!;
        cell.value = "4";
        cell.dispatchEvent(new Event("input", {bubbles: true}));
        cell.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect(line()).toContain("The cell is a whole number of pixels, 8 to 1024.");
        cell.value = "32";
        cell.dispatchEvent(new Event("input", {bubbles: true}));
        cell.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect(line()).toContain("(about 48 cm)");
        click(card().querySelector<HTMLElement>('[data-action="dsm-use"]')!);
        await ticks();
        click(card().querySelector<HTMLElement>('[data-action="dsm-build"]')!);
        await ticks();
        click(card().querySelector<HTMLElement>('[data-action="dsm-remove"]')!);
        await ticks();
        const sentBodies = fetchFn.mock.calls.filter((c) => c[1]?.method === "PATCH").map((c) => JSON.parse(c[1]!.body as string));
        expect(sentBodies).toEqual([{height_cell: 32}, {use: false}]);
        expect(calls(fetchFn)).toContain("POST " + API + "conversions/9/mosaics");
        expect(calls(fetchFn)).toContain("DELETE " + API + "conversions/9/dsm");
    });

    it("says nothing of building again when the mosaics were built as the DSM is set", async () => {
        const dsm = {task: 4, task_name: "Roof - Nadir", downloaded_at: "", use: true, height_cell: 16, pixel_m: 0.05};
        page(routes({...DETAIL, conversions: [{...CONVERSION, dsm, mosaics_dsm: {task_name: "Roof - Nadir", height_cell: 16}}]}));
        await ticks();
        expect(card().querySelector(".dsm-built")).toBeNull();
    });

    it("offers Process in WebODM only once a dataset is converted", async () => {
        page(routes({...DETAIL, conversions: [{...CONVERSION, status: "failed", mosaic_status: null}]}));
        await ticks();
        await openMenu();
        expect(menuItem("Process in WebODM")).toBeUndefined();
    });

    it("makes a flight of visual images only into datasets that are its visual mosaic, with that mosaic's settings only", async () => {
        const rgb = {...DETAIL, thermal: 0, analysis: {...ANALYSIS, webodm: null, files: [ANALYSIS.files![2]]}, conversions: []};
        const fetchFn = routes(rgb, {["POST " + URL + "/conversions"]: {...CONVERSION, id: 12, visual_only: true}});
        page(fetchFn);
        await ticks();
        expect($(".convert-settings")!.textContent).toContain("a new dataset is their mosaic");
        expect(byId("convert-start").textContent).toContain("Make mosaic");
        expect(byId<HTMLInputElement>("convert-name").placeholder).toBe("Visual mosaic");
        await openSettings();
        expect($$(".settings-form [data-field]").map((f) => f.dataset.field)).toEqual(
            ["max_pitch", "visual_gsd", "visual_height_cell", "strip_location"]);
        expect(byId("convert-save")).toBeNull();
        type(field("visual_gsd"), "0.5");
        await ticks();
        type(field("visual_height_cell"), "4");
        await ticks();
        click(byId("convert-start"));
        await ticks();
        expect($(".convert-message")!.textContent).toBe("The height cells are a whole number of pixels, 8 to 1024.");
        expect(calls(fetchFn)).not.toContain("POST " + URL + "/conversions");
        type(field("visual_height_cell"), "16");
        await ticks();
        expect($(".convert-summary .chips")!.textContent).toBe("0.5 cm pixelsheight cells 16 px");
        expect(byId<HTMLInputElement>("convert-name").placeholder).toBe("Visual mosaic · 0.5 cm pixels · height cells 16 px");
        click(byId("convert-start"));
        await ticks();
        const post = fetchFn.mock.calls.find((c) => c[0] === URL + "/conversions")!;
        expect(body(post[1])).toEqual({name: "Visual mosaic · 0.5 cm pixels · height cells 16 px",
                                       settings: {max_pitch: null, visual_gsd: 0.005, visual_height_cell: 16, strip_location: false}});
    });

    it("lists a visual mosaic of its own as ready, with its mosaic's files, and no frames, compare or WebODM", async () => {
        const files = ["mosaics/visual/mosaic_visual.json", "mosaics/visual/mosaic_visual.tif"];
        const visual = {...CONVERSION, visual_only: true, converted: 0, skipped: 0, mosaic_files: files,
                        settings: {...DEFAULTS, visual_only: true, visual_gsd: 0.005}};
        page(routes({...DETAIL, conversions: [visual]}, {[API + "conversions/9"]: {...visual, results: {files: []}}}));
        await ticks();
        expect(card().querySelector(".badge")!.textContent).toBe("Ready");
        expect(card().querySelector(".conversion-actions a.primary")!.textContent).toBe("View mosaic");
        expect([...card().querySelectorAll(".chip")].map((c) => c.textContent)).toEqual(["Visual mosaic", "0.5 cm pixels"]);
        expect(card().querySelector(".figures-line")!.textContent).not.toContain("converted");
        await openMenu();
        ["Frames", "Compare with…", "Process in WebODM"].forEach((label) => expect(menuItem(label)).toBeUndefined());
        click(menuItem("Files")!);
        await ticks();
        expect(card().querySelector(".results")!.textContent).toBe("Mosaics: visual/mosaic_visual.json, visual/mosaic_visual.tif");
    });

    it("unfolds what a conversion wrote per image", async () => {
        const detail = {...CONVERSION, results: {
            files: [{path: "a_T.JPG", ok: true, outputs: ["sub/a_T_temp_c.tiff"], notes: [], distance: 21.4, distance_source: "lrf"},
                    {path: "b_T.JPG", ok: false, reason: "oblique (gimbal pitch -45 above -80)", outputs: [], notes: []}],
            normalization: {ambient_c: 20, reflected_c: 20, frames: 2, without_offset: 0, offset_min: -0.2, offset_max: 0.3},
        }};
        page(routes(DETAIL, {[API + "conversions/9"]: detail}));
        await ticks();
        await openMenu();
        click(menuItem("Files")!);
        await ticks();
        const results = card().querySelector(".results")!;
        const link = [...results.querySelectorAll("a")].find((a) => a.textContent === "a_T_temp_c.tiff")!;
        expect(link.getAttribute("href")).toBe("/api/conversions/9/download?file=sub%2Fa_T_temp_c.tiff");
        expect(results.textContent).toContain("oblique (gimbal pitch -45 above -80)");
        expect(results.querySelector(".skip-reasons")!.textContent).toBe("Skipped: oblique (1).");
        expect(results.textContent).toContain("distance 21.4 m (lrf)");
        expect(results.querySelector(".normalization")!.textContent).toContain("offsets -0.20 to 0.30 °C");
        expect(results.querySelector(".mosaic-files")!.textContent).toBe(
            "Mosaics: as_converted/mosaic_temp_c.tif, harmonized/mosaic_temp_c.tif");
        expect(results.querySelector("a[href='/conversion/9/frame?frame=a_T.JPG']")).not.toBeNull();
    });

    it("fills the form with a conversion's settings", async () => {
        page(routes({...DETAIL, conversions: [{...CONVERSION, status: "failed", mosaic_status: null}]}));
        await ticks();
        click(card().querySelector("[data-action=use]")!);
        await ticks();
        expect($(".convert-message")!.textContent).toBe("The form has Nadir's settings.");
        expect(field("emissivity").value).toBe("0.95");
        expect(field("normalize").checked).toBe(true);
    });

    it("builds the mosaics, cancels, renames and deletes a conversion, saying when the server refuses", async () => {
        const base = API + "conversions/9";
        const fetchFn = routes({...DETAIL, conversions: [{...CONVERSION, mosaic_status: null, mosaic_files: []}]}, {
            ["POST " + base + "/mosaics"]: () => jsonResponse({detail: "Nothing to stitch."}, false),
            ["POST " + base + "/cancel"]: {},
            ["PATCH " + base]: {},
            ["DELETE " + base]: [() => jsonResponse({}, false), {}],
        });
        page(fetchFn);
        await ticks();
        await openMenu();
        click(menuItem("Build mosaics")!);
        await ticks();
        expect($(".convert-message.text-danger")!.textContent).toBe("Nothing to stitch.");

        await openMenu();
        click(menuItem("Rename")!);
        await ticks();
        dialog()!.querySelector("input")!.value = "Nadir 2";
        press("Rename");
        await ticks();
        expect(body(fetchFn.mock.calls.find((c) => c[1]?.method === "PATCH")![1])).toEqual({name: "Nadir 2"});

        await openMenu();
        click(menuItem("Delete")!);
        await ticks();
        expect(dialog()!.textContent).toContain("Delete Nadir and its files? This cannot be undone.");
        press("Delete");
        await ticks();
        expect($(".convert-message.text-danger")!.textContent).toBe("Could not delete the dataset.");
        await openMenu();
        click(menuItem("Delete")!);
        await ticks();
        press("Delete");
        await ticks();
        expect(calls(fetchFn).filter((c) => c === "DELETE " + base).length).toBe(2);
        // Each action loads the dataset again
        expect(calls(fetchFn).filter((c) => c === "GET " + URL).length).toBe(5);
    });

    it("cancels a conversion while it runs", async () => {
        const fetchFn = routes({...DETAIL, conversions: [{...CONVERSION, status: "converting", progress: 0.5}]},
                               {["POST " + API + "conversions/9/cancel"]: {}});
        page(fetchFn);
        await ticks();
        expect(card().querySelector(".badge")!.textContent).toBe("Converting 50%");
        click(card().querySelector("[data-action=cancel]")!);
        await ticks();
        expect(calls(fetchFn)).toContain("POST " + API + "conversions/9/cancel");
    });
});
