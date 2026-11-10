import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {onAnswerChanged} from "../src/core/answer";
import {uploadName} from "../src/core/upload";
import {deleteText} from "../src/core/format";
import {DatasetsPage} from "../src/datasets/datasets-page";
import {type Dataset, droppedFiles, filesCell, sortDatasets} from "../src/datasets/list";
import {matchesSearch, matchesText} from "../src/core/search";
import {calls, click, jsonResponse, server, ticks} from "./helpers";

const API = "/api/";
const DATASET: Dataset = {
    id: 5, name: "Roof", source: "upload", status: "ready", progress: 1, error: "",
    file_count: 3, size: 3 * 1048576, thermal: 2, not_thermal: 1, errors: 0, warnings: 1,
    analyzed: true, created_at: "2026-10-18T09:00:00Z",
};
const LIST = {datasets: [DATASET]};
const LIST_URL = API + "datasets?project=3";
const NAMES = "abcdefghijk".split("").map((c) => c + "_T.JPG");

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = () => $(".page .dialog:not(#new-dataset)");
const press = (label: string) => click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === label)!);
const names = () => [...document.querySelectorAll("#datasets tbody tr td:first-child a")].map((a) => a.textContent);
const paths = (opts?: RequestInit) => (opts!.body as FormData).getAll("paths");

function type(el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
}

function page(fetchFn: ReturnType<typeof server>, nav = vi.fn()) {
    vi.stubGlobal("fetch", fetchFn);
    render(<DatasetsPage api={API} publicUrl="/" project={3} nav={nav}/>, byId("root"));
    return nav;
}

// Opens New Dataset with images chosen: k_T.JPG goes in a request of its own (ten images to a request)
async function choose(files: string[]) {
    await ticks();
    click(byId("new-dataset-button"));
    await ticks();
    type(byId("new-name"), "Roof");
    const input = byId<HTMLInputElement>("new-files");
    Object.defineProperty(input, "files", {value: files.map((n) => new File(["x"], n))});
    input.dispatchEvent(new Event("change", {bubbles: true}));
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
});

describe("the datasets list", () => {
    it("sorts by any column, both ways, with what has nothing to sort by last", () => {
        const a = {...DATASET, id: 1, name: "b", size: 5, last_activity: "2026-10-20T00:00:00Z"};
        const b = {...DATASET, id: 2, name: "A", size: 9, last_activity: null, analyzed: false};
        const c = {...DATASET, id: 3, name: "c", size: 1, last_activity: "2026-10-21T00:00:00Z", errors: 2};
        const ids = (key: string, desc: boolean) => sortDatasets([a, b, c], key, desc).map((d) => d.id);
        expect(ids("name", false)).toEqual([2, 1, 3]);
        expect(ids("name", true)).toEqual([3, 1, 2]);
        expect(ids("size", true)).toEqual([2, 1, 3]);
        expect(ids("activity", true)).toEqual([3, 1, 2]);
        expect(ids("activity", false)).toEqual([1, 3, 2]);
        expect(ids("problems", true)).toEqual([3, 1, 2]);
    });

    it("counts a dataset's visual images apart from its other files", () => {
        const d = {...DATASET, analyzed: true, status: "ready", thermal: 327};
        expect(filesCell({...d, not_thermal: 328, visual: 327})).toBe("327 thermal · 327 visual · 1 other");
        expect(filesCell({...d, not_thermal: 327, visual: 327})).toBe("327 thermal · 327 visual");
        expect(filesCell({...d, not_thermal: 2})).toBe("327 thermal · 2 other");
    });

    it("searches the datasets' names, every word anywhere", () => {
        expect(matchesSearch(DATASET, "")).toBe(true);
        expect(matchesSearch(DATASET, "roof")).toBe(true);
        expect(matchesSearch(DATASET, "of RO")).toBe(true);
        expect(matchesSearch(DATASET, "yard")).toBe(false);
    });

    it("matches a search across several texts, each word in any of them", () => {
        expect(matchesText(["Emissivity", "How much heat a surface gives off"], "heat EMISS")).toBe(true);
        expect(matchesText(["Emissivity", null, undefined], "")).toBe(true);
        expect(matchesText(["Emissivity", "Distance"], "emissivity distance")).toBe(true);
        expect(matchesText("Emissivity", "humidity")).toBe(false);
        // Not across the boundary between two texts
        expect(matchesText(["roof", "top"], "ftop")).toBe(false);
    });

    it("shows a dataset's progress, files and problems, with its actions", async () => {
        page(server({[LIST_URL]: {datasets: [
            {...DATASET, name: "<i>x</i>", conversion_count: 3, conversions_ready: 2},
            {...DATASET, id: 6, source: "folder", folder: "/data/flight3", conversion_count: 1, conversions_ready: 1},
            {...DATASET, id: 7, status: "analyzing", progress: 0.3, created_at: "2026-10-17T09:00:00Z"},
        ]}}));
        await ticks();
        const row = (id: number) => $(`tr[data-id="${id}"]`)!;
        expect(row(5).querySelector("a")!.getAttribute("href")).toBe("/dataset/5");
        expect(row(5).querySelector("a")!.textContent).toBe("<i>x</i>");
        expect(row(5).textContent).toContain("2 thermal · 1 other");
        expect(row(5).querySelector(".badge.warning")!.textContent).toBe("1");
        expect(row(5).querySelector("[title='2 datasets ready of 3']")!.textContent).toBe("2/3");
        // The actions named in the row's menu, Delete last
        expect(row(5).querySelector(".menu-items")).toBeNull();
        click(row(5).querySelector("[aria-label='More for <i>x</i>']")!);
        await ticks();
        expect([...row(5).querySelectorAll(".menu-items button")].map((b) => b.textContent))
            .toEqual(["Rename", "Analyze again", "Move to another project", "Delete"]);
        expect(row(5).querySelector("[data-action=delete]")!.className).toBe("text-danger");
        expect(row(5).querySelector("td:nth-child(6)")!.textContent).toBe("0");
        expect(row(6).querySelector(".text-success[title='1 dataset ready of 1']")).not.toBeNull();
        expect(row(6).querySelector("svg[role=img] title")!.textContent).toBe("Read in place from /data/flight3");
        expect(row(7).querySelector<HTMLElement>(".progress-bar")!.style.width).toBe("30%");
        click(row(7).querySelector("[aria-expanded]")!);
        await ticks();
        expect(row(5).querySelector(".menu-items")).toBeNull();
        expect(row(7).querySelector("[data-action=analyze]")).toBeNull();
    });

    it("lists the datasets and polls while one is analyzed", async () => {
        vi.useFakeTimers();
        const other = {...DATASET, id: 6, name: "Yard", status: "analyzing", progress: 0.5};
        const fetchFn = server({[LIST_URL]: {datasets: [DATASET, other]}});
        page(fetchFn);
        await ticks();
        expect(fetchFn).toHaveBeenCalledWith(LIST_URL, {credentials: "same-origin"});
        expect(document.querySelectorAll("#datasets tbody tr").length).toBe(2);
        vi.runOnlyPendingTimers();
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("shows a dataset being converted as such, and polls until it is done", async () => {
        vi.useFakeTimers();
        const fetchFn = server({[LIST_URL]: [{datasets: [{...DATASET, busy: true}]}, LIST]});
        page(fetchFn);
        await ticks();
        expect($("#datasets tbody tr")!.textContent).toContain("Converting");
        vi.runOnlyPendingTimers();
        await ticks();
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect($("#datasets tbody tr")!.textContent).not.toContain("Converting");
        vi.runOnlyPendingTimers();
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("filters the list by the search and sorts it by the header clicked", async () => {
        const yard = {...DATASET, id: 6, name: "Yard", created_at: "2026-10-19T09:00:00Z", conversion_count: 2,
                      conversions_ready: 1, last_activity: "2026-10-21T08:00:00Z"};
        page(server({[LIST_URL]: {datasets: [yard, DATASET]}}));
        await ticks();
        expect(names()).toEqual(["Yard", "Roof"]);
        const th = (key: string) => $(`th[data-sort=${key}]`)!;
        expect(th("created").getAttribute("aria-sort")).toBe("descending");
        expect($("#datasets tbody tr")!.textContent).toContain("1/2");

        click(th("name").querySelector("button")!);
        await ticks();
        expect(names()).toEqual(["Roof", "Yard"]);
        expect(th("name").getAttribute("aria-sort")).toBe("ascending");
        expect(th("name").querySelector(".sort-icon.up")).not.toBeNull();
        expect(th("created").getAttribute("aria-sort")).toBe("none");
        click(th("name").querySelector("button")!);
        await ticks();
        expect(names()).toEqual(["Yard", "Roof"]);

        type(byId("search"), "yar");
        await ticks();
        expect(names()).toEqual(["Yard"]);
        type(byId("search"), "nothing");
        await ticks();
        expect(byId("datasets")).toBeNull();
        expect(byId("message").textContent).toBe("No flights match the search.");
    });

    it("says why when the datasets could not be loaded", async () => {
        page(server({[LIST_URL]: () => Promise.resolve(new Response(JSON.stringify({detail: "Broken"}), {status: 400}))}));
        await ticks();
        expect($("[role=alert]")!.textContent).toBe("Broken");
        expect(byId("message")).toBeNull();
    });

    it("tells the app when it doesn't answer, and asks again until it does", async () => {
        vi.useFakeTimers();
        const heard: boolean[] = [];
        const off = onAnswerChanged((s) => heard.push(s));
        try {
            let calls = 0;
            const fetchFn = vi.fn(() => ++calls === 1 ? Promise.reject(new TypeError("offline")) : jsonResponse({datasets: []}));
            page(fetchFn as unknown as ReturnType<typeof server>);
            await vi.advanceTimersByTimeAsync(200);
            expect(heard).toEqual([true]);
            await vi.advanceTimersByTimeAsync(3000);
            expect(calls).toBe(2);
            expect(heard).toEqual([true, false]);
        } finally {
            off();
            vi.useRealTimers();
        }
    });

    it("says there are no datasets yet, and offers uploading images", async () => {
        page(server({[LIST_URL]: {datasets: []}}));
        expect(byId("message").textContent).toBe("Loading…");
        await ticks();
        expect(byId("message").textContent).toMatch(/No flights in this project yet/);
        click(byId("new-dataset-button"));
        await ticks();
        expect(byId("new-dataset-title").textContent).toBe("New thermal flight");
        expect(byId("new-upload").hidden).toBe(false);
        click(byId("new-cancel"));
        await ticks();
        expect(byId("new-dataset")).toBeNull();
    });

    it("opens New Dataset with the images dropped on the page, a dropped folder's read through", async () => {
        page(server({[LIST_URL]: {datasets: []}}));
        await ticks();
        const drag = (type: string, dataTransfer: object) => {
            const e = new Event(type, {bubbles: true, cancelable: true});
            Object.assign(e, {dataTransfer});
            $(".page")!.dispatchEvent(e);
            return e;
        };
        // A folder "flight" holding one image and a sub folder with another, read a part at a time
        const fileEntry = (path: string, size: number) => ({isFile: true, fullPath: path,
            file: (ok: (f: File) => void) => ok(new File([new Uint8Array(size)], path.split("/").pop()!))});
        const folder = (path: string, children: object[]) => ({isFile: false, fullPath: path, createReader: () => {
            const parts = [children.slice(0, 1), children.slice(1)];
            return {readEntries: (ok: (e: object[]) => void) => ok(parts.shift() || [])};
        }});
        const tree = folder("/flight", [fileEntry("/flight/a_T.JPG", 4),
                                        folder("/flight/sub", [fileEntry("/flight/sub/b_T.JPG", 6)]),
                                        fileEntry("/flight/notes.txt", 1)]);
        const transfer = {types: ["Files"], items: [{webkitGetAsEntry: () => tree}], files: []};

        expect(drag("dragenter", transfer).defaultPrevented).toBe(true);
        await ticks();
        expect(byId("drop-hint")).not.toBeNull();
        expect(drag("dragover", {types: ["text/plain"]}).defaultPrevented).toBe(false);
        drag("drop", transfer);
        await ticks(40);
        expect(byId("drop-hint")).toBeNull();
        expect(byId("new-chosen").textContent).toBe("2 image(s), 10 B (1 other file(s) left out)");
        expect(byId<HTMLInputElement>("new-name").value).toBe("flight");

        // Dropped images alone
        const files = await droppedFiles({files: [new File(["abc"], "c_T.JPG")]});
        expect(files.map((f) => f.name)).toEqual(["c_T.JPG"]);
        const nested = await droppedFiles(transfer as never);
        expect(nested.map(uploadName)).toEqual(["a_T.JPG", "sub/b_T.JPG", "notes.txt"]);
    });

    it("offers no folder read in place: images and folders chosen are uploaded", async () => {
        page(server({[LIST_URL]: {datasets: []}}));
        await ticks();
        click(byId("new-dataset-button"));
        await ticks();
        expect($("input[name=new-source]")).toBeNull();
        expect(byId("new-folder-path")).toBeNull();
        expect(byId("new-files")).not.toBeNull();
        expect(byId("new-dir")).not.toBeNull();
    });

    it("picks a folder with Choose a folder", async () => {
        // As browsers have it (jsdom does not): a yes or no reflected in the attribute, so "" would turn it off
        Object.defineProperty(HTMLInputElement.prototype, "webkitdirectory", {configurable: true,
            get() { return this.hasAttribute("webkitdirectory"); },
            set(on: unknown) { if (on) this.setAttribute("webkitdirectory", ""); else this.removeAttribute("webkitdirectory"); }});
        try {
            page(server({[LIST_URL]: {datasets: []}}));
            await ticks();
            click(byId("new-dataset-button"));
            await ticks();
            expect(byId("new-dir").hasAttribute("webkitdirectory")).toBe(true);
        } finally {
            delete (HTMLInputElement.prototype as {webkitdirectory?: boolean}).webkitdirectory;
        }
    });

    it("says that files chosen without a JPEG among them cannot make a flight, when chosen and on Create", async () => {
        const fetchFn = server({[LIST_URL]: {datasets: []}});
        page(fetchFn);
        await choose(["a_T_temp_c.tiff", "b_T_temp_c.tiff"]);
        const said = "None of the 2 files chosen is a JPEG or an MP4: a flight is made of a DJI drone's R-JPEGs (the " +
            "_T.JPG files) and its videos, and other files (TIFFs among them) are left out.";
        expect(byId("new-chosen").textContent).toBe("0 image(s), 0 B (2 other file(s) left out)");
        expect(byId("new-error").textContent).toBe(said);
        click(byId("new-create"));
        await ticks();
        expect(byId("new-error").textContent).toBe(said);
        expect(fetchFn.mock.calls.map((c) => c[0])).not.toContain(API + "datasets");
    });

    it("says why a dataset could not be created", async () => {
        page(server({[LIST_URL]: {datasets: []},
                     ["POST " + API + "datasets"]: () => jsonResponse({name: ["A name is required"]}, false)}));
        await choose(["a_T.JPG"]);
        expect(byId("new-chosen").textContent).toMatch(/1 image/);
        click(byId("new-create"));
        await ticks();
        expect(byId("new-error").textContent).toBe("A name is required");
        expect(byId("new-dataset")).not.toBeNull();
        expect(byId<HTMLButtonElement>("new-create").disabled).toBe(false);
    });
});

// Chooses an action in the first row's "…" menu
async function act(what: string) {
    click($("tr[data-id] [aria-expanded]")!);
    await ticks();
    click($(`[data-action=${what}]`)!);
    await ticks();
}

describe("the datasets list's actions, and an upload that does not all arrive", () => {
    it("renames a dataset in the page's dialog", async () => {
        const fetchFn = server({[LIST_URL]: LIST, ["PATCH " + API + "datasets/5"]: DATASET});
        page(fetchFn);
        await ticks();
        await act("rename");
        const field = dialog()!.querySelector("input")!;
        expect(field.value).toBe("Roof");
        type(field, " Roof east ");
        press("Rename");
        await ticks();
        const patch = fetchFn.mock.calls.find((c) => c[1]?.method === "PATCH")!;
        expect(JSON.parse(patch[1]!.body as string)).toEqual({name: "Roof east"});
        expect(dialog()).toBeNull();
    });

    it("moves a dataset to another project, or says there is none to move it to", async () => {
        const projects = {projects: [{id: 3, name: "Silos"}, {id: 7, name: "Barns"}, {id: 9, name: "Yard"}]};
        const fetchFn = server({[LIST_URL]: LIST, [API + "projects"]: [projects, {projects: [{id: 3, name: "Silos"}]}],
                                ["PATCH " + API + "datasets/5"]: DATASET});
        page(fetchFn);
        await ticks();
        await act("move");
        // The others only, the first chosen
        const select = byId<HTMLSelectElement>("move-to");
        expect([...select.options].map((o) => o.textContent)).toEqual(["Barns", "Yard"]);
        select.value = "9";
        select.dispatchEvent(new Event("change", {bubbles: true}));
        press("Move");
        await ticks();
        const patch = fetchFn.mock.calls.find((c) => c[1]?.method === "PATCH")!;
        expect(JSON.parse(patch[1]!.body as string)).toEqual({project: 9});
        expect(calls(fetchFn).filter((c) => c === "GET " + LIST_URL)).toHaveLength(2);

        await act("move");
        expect(dialog()!.textContent).toContain("There is no other project");
        press("OK");
        await ticks();
        expect(calls(fetchFn).filter((c) => c.startsWith("PATCH"))).toHaveLength(1);
    });

    it("analyzes a dataset again, and says when it could not", async () => {
        const fetchFn = server({[LIST_URL]: LIST,
                                ["POST " + API + "datasets/5/analyze"]: () => jsonResponse({detail: "Busy"}, false)});
        page(fetchFn);
        await ticks();
        await act("analyze");
        expect(calls(fetchFn)).toContain("POST " + API + "datasets/5/analyze");
        expect($("[role=alert]")!.textContent).toBe("Busy");
    });

    it("says what deleting a dataset takes with it before deleting it", async () => {
        const d = {...DATASET, conversion_count: 2, mosaic_count: 1, measurement_count: 14};
        const fetchFn = server({[LIST_URL]: {datasets: [d]}, ["DELETE " + API + "datasets/5"]: {}});
        page(fetchFn);
        await ticks();
        await act("delete");
        const text = dialog()!.textContent;
        expect(text).toContain("“Roof” and its 3 images are deleted.");
        expect(text).toContain("With it: 2 datasets, 1 mosaic and 14 measurements.");
        expect(text).toContain("cannot be undone");
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("DELETE " + API + "datasets/5");

        await act("delete");
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + API + "datasets/5");
        expect(deleteText({...DATASET, source: "folder", folder: "/data/roof"})[0])
            .toBe("“Roof” is deleted from DJI Thermal Analyzer. Its server folder (/data/roof) is left as it is.");
    });

    it("stops when images could not be sent, and analyzes once they are sent again", async () => {
        let failing = true;
        const fetchFn = server({
            [LIST_URL]: LIST, ["POST " + API + "datasets"]: {...DATASET, id: 8},
            ["POST " + API + "datasets/8/upload"]: (_: string, opts?: RequestInit) =>
                failing && paths(opts).includes("k_T.JPG") ? jsonResponse({}, false) :
                    jsonResponse({saved: paths(opts).length}),
            ["POST " + API + "datasets/8/analyze"]: {},
        });
        const nav = page(fetchFn);
        await choose(NAMES);
        click(byId("new-create"));
        await ticks(60);

        expect(calls(fetchFn)).not.toContain("POST " + API + "datasets/8/analyze");
        expect(byId("new-error").textContent).toBe(
            "1 image could not be sent: k_T.JPG. 10 images arrived: send the others again, or analyze without them.");
        expect(byId("new-create")).toBeNull();
        expect(byId("new-retry")).not.toBeNull();
        expect(byId("new-without")).not.toBeNull();
        expect(byId<HTMLButtonElement>("new-cancel").disabled).toBe(false);

        failing = false;
        click(byId("new-retry"));
        await ticks(60);
        const uploads = fetchFn.mock.calls.filter((c) => c[0] === API + "datasets/8/upload");
        expect(paths(uploads[uploads.length - 1][1])).toEqual(["k_T.JPG"]);
        expect(calls(fetchFn)).toContain("POST " + API + "datasets/8/analyze");
        expect(nav).toHaveBeenCalledWith("/dataset/8");
    });

    it("analyzes without the images that could not be sent", async () => {
        const fetchFn = server({
            [LIST_URL]: LIST, ["POST " + API + "datasets"]: {...DATASET, id: 8},
            ["POST " + API + "datasets/8/upload"]: (_: string, opts?: RequestInit) =>
                paths(opts).includes("k_T.JPG") ? jsonResponse({}, false) : jsonResponse({saved: paths(opts).length}),
            ["POST " + API + "datasets/8/analyze"]: {},
        });
        const nav = page(fetchFn);
        await choose(NAMES);
        click(byId("new-create"));
        await ticks(60);
        click(byId("new-without"));
        await ticks();
        expect(calls(fetchFn)).toContain("POST " + API + "datasets/8/analyze");
        expect(nav).toHaveBeenCalledWith("/dataset/8");
    });

    it("offers only to send the images again when none arrived", async () => {
        page(server({
            [LIST_URL]: LIST, ["POST " + API + "datasets"]: {...DATASET, id: 8},
            ["POST " + API + "datasets/8/upload"]: () => jsonResponse({}, false),
        }));
        await choose(["a_T.JPG"]);
        click(byId("new-create"));
        await ticks(60);
        expect(byId("new-error").textContent).toMatch(/None arrived/);
        expect(byId("new-retry")).not.toBeNull();
        expect(byId("new-without")).toBeNull();
    });

    it("cancels an upload under way, deleting the new dataset with the images sent so far", async () => {
        const fetchFn = server({
            [LIST_URL]: LIST, ["POST " + API + "datasets"]: {...DATASET, id: 8},
            // The requests hang until they are aborted
            ["POST " + API + "datasets/8/upload"]: (_: string, opts?: RequestInit) => new Promise((_ok, fail) =>
                opts!.signal!.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")))),
            ["DELETE " + API + "datasets/8"]: {},
        });
        page(fetchFn);
        await choose(NAMES);
        click(byId("new-create"));
        await ticks();
        expect(byId("new-progress-text").textContent).toBe("Uploading 0 of 11 images (0%)");
        expect(byId<HTMLButtonElement>("new-cancel").disabled).toBe(false);
        const leaving = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(leaving);
        expect(leaving.defaultPrevented).toBe(true);

        click(byId("new-cancel"));
        await ticks();
        expect(dialog()!.textContent).toContain("The images sent so far are deleted with the flight.");
        press("Delete it");
        await ticks(60);
        expect(calls(fetchFn)).toContain("DELETE " + API + "datasets/8");
        expect(calls(fetchFn)).not.toContain("POST " + API + "datasets/8/analyze");
        expect(byId("new-dataset")).toBeNull();
        const after = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
    });
});
