import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {uploadName} from "../src/core/upload";
import {deleteText} from "../src/core/format";
import {DatasetsPage} from "../src/datasets/datasets-page";
import {type Dataset, droppedFiles, matchesSearch, sortDatasets} from "../src/datasets/list";
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

    it("searches the datasets' names, every word anywhere", () => {
        expect(matchesSearch(DATASET, "")).toBe(true);
        expect(matchesSearch(DATASET, "roof")).toBe(true);
        expect(matchesSearch(DATASET, "of RO")).toBe(true);
        expect(matchesSearch(DATASET, "yard")).toBe(false);
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
        expect(row(5).querySelector("[title='2 conversions ready of 3']")!.textContent).toBe("2/3");
        expect(row(5).querySelector(".rename")!.getAttribute("aria-label")).toBe("Rename");
        expect(row(5).querySelector(".delete")!.getAttribute("aria-label")).toBe("Delete");
        expect(row(6).querySelector(".text-success[title='1 conversion ready of 1']")).not.toBeNull();
        expect(row(6).querySelector("svg[role=img] title")!.textContent).toBe("Read in place from /data/flight3");
        expect(row(7).querySelector<HTMLElement>(".progress-bar")!.style.width).toBe("30%");
        expect(row(7).querySelector(".analyze")).toBeNull();
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
        expect(byId("message").textContent).toBe("No datasets match the search.");
    });

    it("says when the datasets could not be loaded", async () => {
        page(vi.fn(() => Promise.reject(new Error("offline"))) as unknown as ReturnType<typeof server>);
        await ticks();
        expect($("[role=alert]")!.textContent).toBe("Could not load the datasets.");
        expect(byId("message")).toBeNull();
    });

    it("says there are no datasets yet, and offers uploading images or a folder on this computer", async () => {
        page(server({[LIST_URL]: {datasets: []}}));
        expect(byId("message").textContent).toBe("Loading…");
        await ticks();
        expect(byId("message").textContent).toMatch(/No datasets in this project yet/);
        click(byId("new-dataset-button"));
        await ticks();
        expect(byId("new-dataset-title").textContent).toBe("New thermal dataset");
        expect(byId("new-upload").hidden).toBe(false);
        expect(byId("new-folder").hidden).toBe(true);
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

    it("creates a folder dataset and opens it", async () => {
        const fetchFn = server({[LIST_URL]: {datasets: []},
                                ["POST " + API + "datasets"]: {...DATASET, id: 8, source: "folder"}});
        const nav = page(fetchFn);
        await ticks();
        click(byId("new-dataset-button"));
        await ticks();
        type(byId("new-name"), "Flight 3");
        const folder = $<HTMLInputElement>("input[name=new-source][value=folder]")!;
        folder.checked = true;
        folder.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect(byId("new-folder").hidden).toBe(false);
        click(byId("new-create"));
        await ticks();
        expect(byId("new-error").textContent).toMatch(/folder.s path/);

        type(byId("new-folder-path"), "/data/flight3");
        await ticks();
        click(byId("new-create"));
        await ticks();
        const [url, opts] = fetchFn.mock.calls[1];
        expect(url).toBe(API + "datasets");
        expect(JSON.parse(opts!.body as string)).toEqual({name: "Flight 3", source: "folder", folder: "/data/flight3", project: 3});
        expect((opts!.headers as Record<string, string>)["X-CSRFToken"]).toBe("tok");
        expect(nav).toHaveBeenCalledWith("/dataset/8");
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

describe("the datasets list's actions, and an upload that does not all arrive", () => {
    it("renames a dataset in the page's dialog", async () => {
        const fetchFn = server({[LIST_URL]: LIST, ["PATCH " + API + "datasets/5"]: DATASET});
        page(fetchFn);
        await ticks();
        click($(".rename")!);
        await ticks();
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
        click($(".move")!);
        await ticks();
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

        click($(".move")!);
        await ticks();
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
        click($(".analyze")!);
        await ticks();
        expect(calls(fetchFn)).toContain("POST " + API + "datasets/5/analyze");
        expect($("[role=alert]")!.textContent).toBe("Busy");
    });

    it("says what deleting a dataset takes with it before deleting it", async () => {
        const d = {...DATASET, conversion_count: 2, mosaic_count: 1, measurement_count: 14};
        const fetchFn = server({[LIST_URL]: {datasets: [d]}, ["DELETE " + API + "datasets/5"]: {}});
        page(fetchFn);
        await ticks();
        click($(".delete")!);
        await ticks();
        const text = dialog()!.textContent;
        expect(text).toContain("“Roof” and its 3 images are deleted.");
        expect(text).toContain("With it: 2 conversions, 1 mosaic and 14 measurements.");
        expect(text).toContain("cannot be undone");
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("DELETE " + API + "datasets/5");

        click($(".delete")!);
        await ticks();
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + API + "datasets/5");
        expect(deleteText({...DATASET, source: "folder", folder: "/data/roof"})[0])
            .toBe("“Roof” is deleted from the Thermal Analyzer. Its server folder (/data/roof) is left as it is.");
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
        expect(dialog()!.textContent).toContain("The images sent so far are deleted with the dataset.");
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
