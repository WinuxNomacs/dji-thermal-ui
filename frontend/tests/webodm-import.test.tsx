import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {type Conversion, conversionLabel, importedChips, importStageText} from "../src/dataset/conversions";
import {ImportDialog, type ImportTask, MAX_FILE_BYTES, processingText} from "../src/dataset/webodm-import";
import {calls, jsonResponse, server, ticks} from "./helpers";

const PROJECTS = {count: 2, projects: [{id: 4, name: "Site A", can_add: true}, {id: 3, name: "Shared", can_add: false}]};
const TASKS: {tasks: ImportTask[]; others: number} = {others: 2, tasks: [
    {id: "t-over", name: "Roof, thermal", created_at: "2026-11-01T10:00:00Z", images: 220, processing_ms: 3900000,
     dsm: true, extent: [-87.1, 42.1, -87.0, 42.2], over: true},
    {id: "t-rgb", name: "Roof, RGB", created_at: "2026-10-30T10:00:00Z", images: 327, processing_ms: 600000,
     dsm: false, extent: null, over: false}]};
const MADE: Conversion = {id: 12, name: "Roof, thermal", settings: {}, status: "converting", stage: {stage: "download"}} as Conversion;

const root = () => document.getElementById("root")!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim();

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    render(null, root());
    vi.unstubAllGlobals();
});

function dialog(routes: Record<string, unknown> = {}) {
    const fetchFn = server({"/api/webodm/projects": PROJECTS, "/api/webodm/projects/4/tasks?dataset=7": TASKS,
                            "/api/webodm/projects/3/tasks?dataset=7": {tasks: [], others: 1}, ...routes} as never);
    vi.stubGlobal("fetch", fetchFn);
    const closed = vi.fn(), imported = vi.fn();
    render(<ImportDialog api="/api/" publicUrl="/" dataset={7} onClose={closed} onImported={imported}/>, root());
    return {fetchFn, closed, imported};
}

const sent = (fetchFn: ReturnType<typeof server>, key: string) =>
    fetchFn.mock.calls.find((c) => (c[1]?.method || "GET") + " " + c[0] === key)![1]!.body;

describe("Import from WebODM", () => {
    it("browses the projects' completed tasks with their previews, those over the flight first, and imports the one chosen with its DSM", async () => {
        const {fetchFn, closed, imported} = dialog({"POST /api/datasets/7/import/webodm": MADE});
        await ticks();
        expect(all(".webodm-project-list button").map((b) => b.textContent)).toEqual(["Site A", "Shared"]);
        expect($('[data-webodm-project="4"]')!.getAttribute("aria-pressed")).toBe("true");
        const cards = all(".webodm-task-card");
        expect(cards.map((c) => c.dataset.task)).toEqual(["t-over", "t-rgb"]);
        expect(cards[0].querySelector("img")!.getAttribute("src")).toBe("/api/webodm/projects/4/tasks/t-over/preview?size=256");
        expect([...cards[0].querySelectorAll(".chip")].map((c) => c.textContent)).toEqual(["Over this flight", "Orthophoto", "DSM"]);
        expect([...cards[1].querySelectorAll(".chip")].map((c) => c.textContent)).toEqual(["Orthophoto"]);
        expect(text(".webodm-tasks > p")).toBe("2 other tasks (running, failed, or without an orthophoto) aren't listed.");
        // The first is chosen, shown larger with its details, its DSM ticked
        expect(cards[0].getAttribute("aria-pressed")).toBe("true");
        expect($(".webodm-chosen img")!.getAttribute("src")).toBe("/api/webodm/projects/4/tasks/t-over/preview?size=640");
        expect(text(".webodm-chosen table")).toContain("Images220");
        expect(text(".webodm-chosen table")).toContain("Processed in1 h 05 min");
        expect($<HTMLInputElement>("#import-dsm")!.checked).toBe(true);
        expect($<HTMLInputElement>("#import-name")!.placeholder).toBe("Roof, thermal");
        $("#import-start")!.click();
        await ticks();
        expect(JSON.parse(sent(fetchFn, "POST /api/datasets/7/import/webodm") as string))
            .toEqual({project: 4, task: "t-over", dsm: true, name: ""});
        expect(imported).toHaveBeenCalledWith(MADE);
        expect(closed).toHaveBeenCalled();
    });

    it("chooses another task, which has no DSM, and another project, which has none to list", async () => {
        const {fetchFn} = dialog({"POST /api/datasets/7/import/webodm": MADE});
        await ticks();
        $('[data-task="t-rgb"]')!.click();
        await ticks();
        expect($("#import-dsm")).toBeNull();
        const name = $<HTMLInputElement>("#import-name")!;
        name.value = "RGB of the roof";
        name.dispatchEvent(new Event("input", {bubbles: true}));
        await ticks();
        $("#import-start")!.click();
        await ticks();
        expect(JSON.parse(sent(fetchFn, "POST /api/datasets/7/import/webodm") as string))
            .toEqual({project: 4, task: "t-rgb", dsm: false, name: "RGB of the roof"});
        render(null, root());
        dialog();
        await ticks();
        $('[data-webodm-project="3"]')!.click();
        await ticks();
        expect(text(".webodm-tasks")).toBe("No completed task with an orthophoto.1 other task (running, failed, or without an orthophoto) isn't listed.");
        expect($<HTMLButtonElement>("#import-start")!.disabled).toBe(true);
    });

    it("says why WebODM can't be asked and where to set it up, and what refused the import", async () => {
        dialog({"/api/webodm/projects": () => jsonResponse({error: "WebODM is not set up: give its address"}, false)});
        await ticks();
        expect(text("#import-problem")).toBe("WebODM is not set up: give its address System Settings › WebODM");
        expect($("#import-problem a")!.getAttribute("href")).toBe("/settings#webodm-settings");
        render(null, root());
        const {imported} = dialog({"POST /api/datasets/7/import/webodm": () => jsonResponse({task: "WebODM has no completed task"}, false)});
        await ticks();
        $("#import-start")!.click();
        await ticks();
        expect(text(".import-message")).toBe("WebODM has no completed task");
        expect(imported).not.toHaveBeenCalled();
    });

    it("imports a GeoTIFF downloaded from WebODM's page with its DSM, and refuses one too big to send", async () => {
        const {fetchFn, imported} = dialog({"POST /api/datasets/7/import/file": MADE});
        await ticks();
        $("#import-from-file")!.click();
        await ticks();
        expect($(".webodm-browser")).toBeNull();
        $("#import-start")!.click();
        await ticks();
        expect(text(".import-message")).toBe("Choose the orthophoto's GeoTIFF.");
        const pick = (sel: string, file: File) => {
            Object.defineProperty($(sel)!, "files", {value: [file], configurable: true});
            $(sel)!.dispatchEvent(new Event("change", {bubbles: true}));
        };
        const big = new File(["x"], "huge.tif");
        Object.defineProperty(big, "size", {value: MAX_FILE_BYTES + 1});
        pick("#import-orthophoto", big);
        await ticks();
        $("#import-start")!.click();
        await ticks();
        expect(text(".import-message")).toContain("huge.tif is 1.0 GB: a file can be up to 1.0 GB");
        pick("#import-orthophoto", new File(["ortho"], "roof-orthophoto.tif"));
        pick("#import-dsm-file", new File(["dsm"], "roof-dsm.tif"));
        await ticks();
        expect($<HTMLInputElement>("#import-name")!.placeholder).toBe("roof-orthophoto");
        $("#import-start")!.click();
        await ticks();
        const body = sent(fetchFn, "POST /api/datasets/7/import/file") as FormData;
        expect((body.get("orthophoto") as File).name).toBe("roof-orthophoto.tif");
        expect((body.get("dsm") as File).name).toBe("roof-dsm.tif");
        expect(body.get("name")).toBeNull();
        expect(imported).toHaveBeenCalledWith(MADE);
        expect(calls(fetchFn)).not.toContain("POST /api/datasets/7/import/webodm");
    });

    it("closes with Escape", async () => {
        const {closed} = dialog();
        await ticks();
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
        expect(closed).toHaveBeenCalled();
    });
});

describe("an imported dataset", () => {
    it("is labelled, followed and described by where it came from and what it holds", () => {
        const c = {...MADE, imported: {from: "webodm", project_name: "Site A", task_name: "Roof", dsm: true}} as Conversion;
        expect(conversionLabel(c)).toBe("Importing");
        expect(conversionLabel({...c, progress: 0.4})).toBe("Importing 40%");
        expect(conversionLabel({...c, status: "ready"})).toBe("Imported");
        expect(importStageText({stage: "download", asset: "dsm"})).toBe("Downloading the DSM from WebODM…");
        expect(importStageText({stage: "read"})).toBe("Reading the orthophoto…");
        expect(importedChips({...c.imported!, kind: "thermal"})).toEqual(["From WebODM", "Site A › Roof", "Temperatures", "DSM"]);
        expect(importedChips({from: "file", file: "roof.tif", kind: "visual"})).toEqual(["From a file", "roof.tif", "Colours"]);
        expect(processingText(40000)).toBe("40 s");
        expect(processingText(null)).toBe("");
    });
});
