import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import {type Conversion, parsePrefill, skipReasons} from "../src/dataset/conversions";
import {DatasetPage} from "../src/dataset/dataset-page";
import {type Analysis, fileRows, newestReady, sortRows} from "../src/dataset/files";
import {differences, formProblem, planSettings, resetSetting, type Settings} from "../src/dataset/settings";
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
    max_pitch: null, outputs: ["temp_c:tiff", "pseudo:png"], compression: "deflate", mosaics: true,
};
const PREFERENCES = {
    settings: DEFAULTS, saved: false, defaults: DEFAULTS, palettes: ["whitehot", "ironred"],
    products: [
        {product: "temp_c", description: "float32 temperature in degrees C", formats: ["tiff", "exr"]},
        {product: "pseudo", description: "8-bit RGB pseudo-colour image", formats: ["png", "tiff"]},
        {product: "gray16", description: "uint16 grayscale view", formats: ["png", "tiff"]},
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
const fileNames = () => $$("table.files tbody tr td:first-child").map((td) => td.textContent);

function type(el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
}

function choose(input: HTMLInputElement, files: File[]) {
    Object.defineProperty(input, "files", {value: files, configurable: true});
    input.dispatchEvent(new Event("change", {bubbles: true}));
}

function page(fetchFn: ReturnType<typeof server>, nav = vi.fn()) {
    vi.stubGlobal("fetch", fetchFn);
    render(<DatasetPage api={API} publicUrl="/" id={5} projectId={4} projectName="Silos" nav={nav}/>, byId("root"));
    return nav;
}

// The dataset's own routes, with the conversion settings
const routes = (dataset: unknown = DETAIL, more: Record<string, unknown> = {}) =>
    server({[API + "preferences"]: PREFERENCES, [URL]: dataset, ...more});

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
    it("filters the files by every word of the filter, in any case", () => {
        const view = {show: "all" as const, filter: "T.jpg THERMAL", sort: "path", desc: false};
        expect(fileRows(ANALYSIS, view).map((r) => r.path)).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect(fileRows(ANALYSIS, {...view, filter: "a_ jpg"}).map((r) => r.path)).toEqual(["rgb/a_V.JPG", "thermal/a_T.JPG"]);
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
    it("shows the dataset, its figures and its tabs, the files first", async () => {
        page(routes());
        expect($(".message")!.textContent).toBe("Loading…");
        await ticks();
        expect(byId("name").textContent).toBe("Roof");
        expect(document.title).toBe("Roof · Thermal Analyzer");
        expect($(".figures")!.textContent).toContain("M4T · 640×512 · SN1 · 2 frame(s)");
        expect($$("[role=tab]").map((t) => t.getAttribute("data-tab"))).toEqual(["files", "problems", "webodm", "convert"]);
        expect(selected()).toBe("files");
        expect(tab("files").querySelector(".badge")!.textContent).toBe("3");
        expect(tab("problems").querySelector(".badge")!.textContent).toBe("1");
        expect(tab("convert").querySelector(".badge")!.textContent).toBe("1");
        expect(byId("analyze").textContent).toContain("Analyze again");
        expect(byId("add-images")).not.toBeNull();
        expect(byId("report").getAttribute("href")).toBe("/dataset/5/report");
    });

    it("says when the dataset could not be loaded", async () => {
        page(server({[URL]: () => jsonResponse({}, false)}));
        await ticks();
        expect($(".notice.error[role=alert]")!.textContent).toBe("Could not load the dataset.");
    });

    it("shows only the Convert tab before the analysis", async () => {
        page(routes({...DATASET, status: "new", analyzed: false, analysis: null, conversions: []}));
        await ticks();
        expect(byId("status").textContent).toBe("3 file(s), not analyzed yet.");
        expect($$("[role=tab]").map((t) => t.getAttribute("data-tab"))).toEqual(["convert"]);
        expect(selected()).toBe("convert");
        expect(byId("analyze").textContent).toContain("Analyze");
        expect($(".convert-tab")!.textContent).toContain("No conversions yet.");
    });

    it("opens the tab a link names", async () => {
        history.replaceState(null, "", "/dataset/5#convert");
        page(routes());
        await ticks();
        expect(selected()).toBe("convert");
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
        expect(byId("status").textContent).toContain("Analyzing 3 file(s)…");
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
        expect(byId("status").textContent).toContain("Analyzing");
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
        expect(dialog()!.textContent).toContain("Delete dataset");
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
        expect($(".notice.error")!.textContent).toBe("Choose JPEG images (the flight's R-JPEGs).");
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
        vi.useFakeTimers();
        const busy = {...CONVERSION, id: 10, status: "converting", progress: 0.2, finished_at: null};
        page(routes({...DETAIL, conversions: [busy]}));
        await ticks();
        expect(fileNames()).toEqual(["rgb/a_V.JPG", "thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect($("table.files a")).toBeNull();
        expect($(".files-hint")).not.toBeNull();
        type($<HTMLInputElement>(".files-filter")!, "thermal");
        await ticks();
        expect($(".files-shown")!.textContent).toBe("2 shown");
        vi.advanceTimersByTime(2000);
        await ticks();
        expect($<HTMLInputElement>(".files-filter")!.value).toBe("thermal");
        expect(fileNames()).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);

        render(null, byId("root"));
        page(routes());
        await ticks();
        const link = $<HTMLAnchorElement>("table.files a")!;
        expect(link.getAttribute("href")).toBe("/conversion/9/frame?frame=thermal%2Fa_T.JPG");
        expect($$("table.files a").length).toBe(2);
    });

    it("sorts the files by a column, both ways", async () => {
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
        expect($(".finding .suggestion")!.textContent).toContain("--replace-above");
        click($(".finding-files a")!);
        await ticks();
        expect(selected()).toBe("files");
        expect($<HTMLInputElement>(".files-filter")!.value).toBe("thermal/b_T.JPG");
        expect(fileNames()).toEqual(["thermal/b_T.JPG"]);
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
        expect(selected()).toBe("convert");
        expect($(".convert-message")!.textContent).toBe("The form has the WebODM plan's settings: -o temp_c:tiff --normalize");
        expect(field("normalize").checked).toBe(true);
        expect(field("output-pseudo").checked).toBe(false);
    });
});

describe("the Convert tab", () => {
    it("folds the settings into chips once there are conversions, and unfolds them to edit", async () => {
        page(routes());
        await ticks();
        expect($(".settings-form")).toBeNull();
        expect($(".convert-summary .chips")!.textContent).toBe("dji-thermal-cli's defaults");
        expect(card().querySelector(".chips")!.textContent).toContain("emissivity 0.95");
        click(byId("edit-settings"));
        await ticks();
        expect($(".settings-form")).not.toBeNull();
        expect(byId("edit-settings")).toBeNull();
    });

    it("shows the form at once when there are no conversions", async () => {
        page(routes({...DETAIL, conversions: []}));
        await ticks();
        expect($(".settings-form")).not.toBeNull();
        expect(field("output-temp_c").checked).toBe(true);
        expect($(".field[data-field=emissivity] .help")!.textContent).toBe("recorded 0.91");
    });

    it("marks a changed setting and puts it back at its default", async () => {
        page(routes({...DETAIL, conversions: []}));
        await ticks();
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
        type(field("emissivity"), "0.95");
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

    it("does not send settings the form cannot have, nor what the server refuses", async () => {
        const fetchFn = routes({...DETAIL, conversions: []},
                               {["POST " + URL + "/conversions"]: () => jsonResponse({detail: "No images."}, false)});
        page(fetchFn);
        await ticks();
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
        type(field("emissivity"), "0.95");
        await ticks();
        click(byId("convert-save"));
        await ticks();
        expect(body(fetchFn.mock.calls.find((c) => c[1]?.method === "PUT")![1]).settings.emissivity).toBe(0.95);
        expect($(".convert-message")!.textContent).toBe("Saved: new conversions start from these settings.");
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
        expect($(".convert-message.text-danger")!.textContent).toBe("Could not delete the conversion.");
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
