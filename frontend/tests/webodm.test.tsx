import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {addedRow, applyPreset, type NodeOption, optionRow, planRows, sentOptions, type TaskInfo, taskLabel,
        type WebODMTask} from "../src/dataset/webodm";
import {WebODMPanel, WebODMTasks} from "../src/dataset/webodm-panel";
import {calls, jsonResponse, server, ticks} from "./helpers";

const OFFERED: NodeOption[] = [
    {name: "radiometric-calibration", type: "enum", value: "camera", domain: ["none", "camera"], help: "Calibration. Default: %(default)s"},
    {name: "orthophoto-resolution", type: "float", value: "5", domain: "positive float", help: "cm/px"},
    {name: "fast-orthophoto", type: "bool", value: "false", domain: "", help: "Skip the dense cloud"},
    {name: "dsm", type: "bool", value: "false", domain: "", help: "Use this tag to build a DSM. Default: %(default)s"},
    {name: "min-num-features", type: "int", value: "10000", domain: "integer", help: "Features"},
];
const INFO: TaskInfo = {
    configured: true, problems: [], warnings: [], frames: 2, bytes: 2048, name: "Roof - Dataset 1",
    project_name: "Site A", process_args: ["-o", "temp_c:tiff"], preset: 7,
    options: [{name: "radiometric-calibration", value: "none", reason: "temperatures already", recommended: true},
              {name: "fast-orthophoto", value: true, reason: "flat ground", recommended: false}],
};
const CHOICES = {
    nodes: [{id: 1, label: "node-odx-1", online: true}, {id: 2, label: "spare", online: false}],
    options: OFFERED,
    presets: [{id: 1, name: "DSM + DTM", system: true, options: [{name: "dsm", value: true}]},
              {id: 7, name: "Thermal", system: false, options: [{name: "orthophoto-resolution", value: "2"}]}],
};
const PROJECTS = {count: 3, projects: [{id: 5, name: "Shared", can_add: false}, {id: 4, name: "Site A", can_add: true},
                                       {id: 3, name: "Other", can_add: true}]};
const TASK: WebODMTask = {id: 9, project_id: 4, project_name: "Site A", task_id: "abc", name: "Roof - Dataset 1",
                          node: "", status: "uploading", progress: 0.5, uploaded: 1024, total: 2048, error: "",
                          link: null};

const root = () => document.getElementById("root")!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim();

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    render(null, root());
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("the WebODM options", () => {
    it("ticks the plan's recommended options, types them as WebODM does, and sends what is ticked", () => {
        const rows = planRows(INFO.options, OFFERED);
        expect(rows.map((r) => [r.name, r.on, r.type, r.value])).toEqual([
            ["radiometric-calibration", true, "enum", "none"], ["fast-orthophoto", false, "bool", true]]);
        expect(rows[0].domain).toEqual(["none", "camera"]);
        expect(sentOptions(rows)).toEqual({options: [{name: "radiometric-calibration", value: "none"}], problem: null});
        // An option the nodes don't offer is text
        expect(optionRow("custom", 3, undefined)).toMatchObject({type: "string", value: "3"});
    });

    it("sends numbers as numbers and says what a value lacks", () => {
        const res = {...addedRow(OFFERED[1]), value: "1.6"};
        const feats = {...addedRow(OFFERED[4]), value: "8000"};
        expect(sentOptions([res, feats]).options).toEqual([{name: "orthophoto-resolution", value: 1.6},
                                                         {name: "min-num-features", value: 8000}]);
        expect(sentOptions([{...res, value: ""}]).problem).toBe("orthophoto-resolution needs a value");
        expect(sentOptions([{...feats, value: "1.5"}]).problem).toBe("min-num-features is a whole number");
        expect(sentOptions([{...res, value: "fine"}]).problem).toBe("orthophoto-resolution is a number");
        expect(sentOptions([{...addedRow(OFFERED[0]), value: "raw"}]).problem)
            .toBe("radiometric-calibration is one of none, camera");
        // A bool added is on
        expect(sentOptions([addedRow(OFFERED[3])]).options).toEqual([{name: "dsm", value: true}]);
    });

    it("applies a preset: its options ticked with its values, added when not listed, the others left", () => {
        const rows = applyPreset(planRows(INFO.options, OFFERED), CHOICES.presets[1], OFFERED);
        expect(rows.map((r) => [r.name, r.on, r.value])).toEqual([
            ["radiometric-calibration", true, "none"], ["fast-orthophoto", false, true], ["orthophoto-resolution", true, "2"]]);
        const again = applyPreset(rows, {id: 3, name: "p", system: false, options: [{name: "fast-orthophoto", value: "false"}]},
                                  OFFERED);
        expect(again[1]).toMatchObject({on: true, value: false});
    });

    it("labels a task by where it is", () => {
        expect(taskLabel(TASK)).toBe("Uploading 50% (1.0 KB of 2.0 KB)");
        expect(taskLabel({...TASK, status: "running", progress: 0.42})).toBe("Processing in WebODM 42%");
        expect(taskLabel({...TASK, status: "gone"})).toBe("Not in WebODM");
    });
});

function panel(routes: Record<string, unknown>) {
    const fetchFn = server({"/api/conversions/3/webodm": INFO, "/api/webodm/choices": CHOICES,
                            "/api/webodm/projects": PROJECTS, ...routes});
    vi.stubGlobal("fetch", fetchFn);
    const closed = vi.fn(), made = vi.fn();
    render(<WebODMPanel api="/api/" publicUrl="/" conversion={3} onClose={closed} onMade={made}/>, root());
    return {fetchFn, closed, made};
}

const select = async (sel: string, value: string) => {
    const el = $<HTMLSelectElement>(sel)!;
    el.value = value;
    el.dispatchEvent(new Event("change", {bubbles: true}));
    await ticks();
};
const type = async (sel: string, value: string) => {
    const el = $<HTMLInputElement>(sel)!;
    el.value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
    await ticks();
};
const press = async (action: string) => { $(`[data-action="${action}"]`)!.click(); await ticks(); };
const sent = (fetchFn: ReturnType<typeof server>, key: string) =>
    JSON.parse(fetchFn.mock.calls.find((c) => (c[1]?.method || "GET") + " " + c[0] === key)![1]!.body as string);

describe("Process in WebODM", () => {
    it("makes a task in the project of the app's project's name, with the plan's options, the preset last applied first", async () => {
        const {fetchFn, closed, made} = panel({"POST /api/conversions/3/webodm": {id: 9}});
        await ticks();
        expect(text(".webodm-panel-head")).toContain("2 temperature TIFFs (2.0 KB)");
        expect($<HTMLSelectElement>(".webodm-project-list")!.value).toBe("4");
        expect($<HTMLSelectElement>('[aria-label="A WebODM preset"]')!.value).toBe("7");
        expect([...document.querySelectorAll(".webodm-project-list option")].map((o) => o.textContent))
            .toEqual(["Choose one…", "Shared (view only)", "Site A", "Other"]);
        expect($<HTMLOptionElement>('.webodm-project-list option[value="5"]')!.disabled).toBe(true);
        expect([...document.querySelectorAll(".webodm-node option")].map((o) => o.textContent))
            .toEqual(["Automatic", "node-odx-1", "spare (offline)"]);
        expect($<HTMLInputElement>(".webodm-task-name")!.value).toBe("Roof - Dataset 1");
        await press("apply-preset");
        expect(text(".webodm-message")).toBe("Thermal applied: its options are ticked with its values.");
        await select('[aria-label="Add an option"]', "dsm");
        // ODM's help without its placeholders, for an option the plan gives no reason for
        expect(text('[data-option="dsm"] .webodm-help')).toBe("Use this tag to build a DSM.");
        await select(".webodm-node", "1");
        await press("webodm-start");
        expect(sent(fetchFn, "POST /api/conversions/3/webodm")).toEqual({
            name: "Roof - Dataset 1", node: 1, project: 4, project_name: "Site A", preset: 7,
            options: [{name: "radiometric-calibration", value: "none"}, {name: "orthophoto-resolution", value: 2},
                      {name: "dsm", value: true}]});
        expect(made).toHaveBeenCalled();
        expect(closed).toHaveBeenCalled();
    });

    it("makes a new project, named as typed, and says what WebODM refused", async () => {
        const {fetchFn} = panel({"POST /api/conversions/3/webodm": () => jsonResponse({options: "WebODM did not take it"}, false)});
        await ticks();
        const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        radios[0].click();
        await ticks();
        await type(".webodm-project-name", "Thermal 2026");
        // Unticking an option leaves it out
        document.querySelector<HTMLInputElement>('[aria-label="Send radiometric-calibration"]')!.click();
        await ticks();
        await press("webodm-start");
        expect(sent(fetchFn, "POST /api/conversions/3/webodm")).toMatchObject({project: null, project_name: "Thermal 2026",
                                                                               options: [], node: null});
        expect(text(".webodm-message")).toBe("WebODM did not take it");
    });

    it("searches the account's projects as typed", async () => {
        vi.useFakeTimers();
        const {fetchFn} = panel({"/api/webodm/projects?search=oth": {count: 1, projects: [PROJECTS.projects[2]]}});
        await ticks();
        await type(".webodm-project-search", "oth");
        await vi.advanceTimersByTimeAsync(400);
        await ticks();
        expect(calls(fetchFn)).toContain("GET /api/webodm/projects?search=oth");
        expect([...document.querySelectorAll(".webodm-project-list option")].map((o) => o.textContent))
            .toEqual(["Choose one…", "(the one chosen)", "Other"]);
    });

    it("keeps the ticked options as a preset of the account's own", async () => {
        const {fetchFn} = panel({"POST /api/webodm/presets": {id: 8, presets: [...CHOICES.presets,
                                                                               {id: 8, name: "Mine", system: false, options: []}]}});
        await ticks();
        await type('[aria-label="The preset\'s name"]', "Mine");
        await press("save-preset");
        expect(sent(fetchFn, "POST /api/webodm/presets")).toEqual({name: "Mine",
                                                                    options: [{name: "radiometric-calibration", value: "none"}]});
        expect($<HTMLSelectElement>('[aria-label="A WebODM preset"]')!.value).toBe("8");
        expect(text(".webodm-message")).toBe("Kept in WebODM as the preset Mine.");
    });

    it("says what stops a task, and where to set WebODM up", async () => {
        const {fetchFn} = panel({"/api/conversions/3/webodm": {...INFO, problems: ["The dataset is not converted yet"]}});
        await ticks();
        expect([...document.querySelectorAll(".webodm-problems li")].map((li) => li.textContent))
            .toEqual(["The dataset is not converted yet"]);
        expect(calls(fetchFn)).toEqual(["GET /api/conversions/3/webodm"]);

        render(null, root());
        panel({"/api/conversions/3/webodm": {...INFO, configured: false}});
        await ticks();
        expect($<HTMLAnchorElement>('a[href="/settings#webodm-settings"]')!.textContent).toBe("System Settings › WebODM");
    });

    it("warns where the conversion's settings differ from the plan's", async () => {
        panel({"/api/conversions/3/webodm": {...INFO, warnings: ["Not normalized: seams"]}});
        await ticks();
        expect(text(".webodm-warnings")).toContain("Its settings differ from the WebODM plan's (-o temp_c:tiff):");
        expect(text(".webodm-warnings li")).toBe("Not normalized: seams");
    });

    it("says why WebODM could not be asked", async () => {
        panel({"/api/webodm/choices": () => jsonResponse({error: "WebODM could not be reached"}, false)});
        await ticks();
        expect(text(".webodm-message")).toBe("WebODM could not be reached");
        expect($('[data-action="webodm-start"]')).toBeNull();
    });
});

describe("the tasks made in WebODM", () => {
    it("lists them with their progress, cancels an upload and takes a task off the list", async () => {
        const fetchFn = server({"POST /api/webodm-tasks/9/cancel": {...TASK, status: "canceled"},
                                "DELETE /api/webodm-tasks/10": {}});
        vi.stubGlobal("fetch", fetchFn);
        const changed = vi.fn();
        render(<WebODMTasks api="/api/" onChange={changed} tasks={[TASK, {...TASK, id: 10, status: "completed",
            link: "http://w/dashboard/?project_task_open=4&project_task_expanded=abc", node: "node-odx-1"}]}/>, root());
        expect(text('[data-task="9"]')).toContain("WebODM: Roof - Dataset 1 in Site A Uploading 50% (1.0 KB of 2.0 KB)");
        expect(text('[data-task="10"]')).toContain("in Site A, on node-odx-1 Completed");
        expect($<HTMLAnchorElement>('[data-task="10"] a')!.target).toBe("_blank");
        $('[data-task="9"] [data-action="webodm-cancel"]')!.click();
        await ticks();
        $('[data-task="10"] [data-action="webodm-forget"]')!.click();
        await ticks();
        expect(calls(fetchFn)).toEqual(["POST /api/webodm-tasks/9/cancel", "DELETE /api/webodm-tasks/10"]);
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it("follows a task queued or running in WebODM, and says when WebODM can't be asked", async () => {
        vi.useFakeTimers();
        const fetchFn = server({"/api/webodm-tasks/9": [{...TASK, status: "running", progress: 0.3, check_error: ""},
                                                        {...TASK, status: "running", progress: 0.3,
                                                         check_error: "WebODM answered 503"},
                                                        {...TASK, status: "completed", progress: 1, check_error: ""}]});
        vi.stubGlobal("fetch", fetchFn);
        render(<WebODMTasks api="/api/" onChange={() => {}} tasks={[{...TASK, status: "queued"}]}/>, root());
        expect(text('[data-task="9"] .badge')).toBe("Queued in WebODM");
        await vi.advanceTimersByTimeAsync(5000);
        await ticks();
        expect(text('[data-task="9"] .badge')).toBe("Processing in WebODM 30%");
        await vi.advanceTimersByTimeAsync(5000);
        await ticks();
        expect(text('[data-task="9"] .text-warning')).toBe("WebODM answered 503");
        await vi.advanceTimersByTimeAsync(5000);
        await ticks();
        expect(text('[data-task="9"] .badge')).toBe("Completed");
        await vi.advanceTimersByTimeAsync(15000);
        expect(calls(fetchFn).length).toBe(3);
    });
});
