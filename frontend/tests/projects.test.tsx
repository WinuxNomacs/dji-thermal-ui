import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {type Project, projectDeleteText} from "../src/projects/list";
import {ProjectPage} from "../src/projects/project-page";
import {sendArchive} from "../src/projects/import-dialog";
import {ProjectsPage} from "../src/projects/projects-page";
import {calls, click, jsonResponse, key, server, ticks} from "./helpers";

const API = "/api/";
const SILOS: Project = {
    id: 3, name: "Silos", description: "North farm\nBins 1 to 4", location: {lon: -88.07, lat: 42.1, label: "1 Farm Rd"},
    dataset_count: 2, conversion_count: 3, mosaic_count: 2, measurement_count: 14, size: 5 * 1048576,
    created_at: "2026-10-18T09:00:00Z",
};
const EMPTY: Project = {...SILOS, id: 1, name: "Default Project", description: "", location: null, dataset_count: 0,
                        conversion_count: 0, mosaic_count: 0, measurement_count: 0, size: 0};
const DETAIL = {...SILOS, areas: [{dataset: 5, name: "Roof", ring: [[0, 0], [1, 0], [1, 1], [0, 0]]}]};

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = () => $(".page .dialog:not(#project-form)");
const press = (label: string) => click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === label)!);
const names = () => [...document.querySelectorAll("#projects tbody tr td:first-child a")].map((a) => a.textContent);
const body = (fetchFn: ReturnType<typeof server>, method: string) =>
    JSON.parse(fetchFn.mock.calls.find((c) => c[1]?.method === method)![1]!.body as string);

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
}

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    render(null, byId("root"));
    vi.unstubAllGlobals();
});

function projectsPage(fetchFn: ReturnType<typeof server>, nav = vi.fn()) {
    vi.stubGlobal("fetch", fetchFn);
    render(<ProjectsPage api={API} publicUrl="/" basemaps={[]} nav={nav}/>, byId("root"));
    return nav;
}

function projectPage(fetchFn: ReturnType<typeof server>, nav = vi.fn()) {
    vi.stubGlobal("fetch", fetchFn);
    render(<ProjectPage api={API} publicUrl="/" id={3} basemaps={[]} nav={nav}/>, byId("root"));
    return nav;
}

describe("the projects page", () => {
    it("lists the projects with their location, datasets and size, and searches them", async () => {
        projectsPage(server({[API + "projects"]: {projects: [EMPTY, SILOS]}}));
        expect(byId("message").textContent).toBe("Loading…");
        await ticks();
        expect(names()).toEqual(["Default Project", "Silos"]);
        const row = $('tr[data-id="3"]')!;
        expect(row.querySelector("a")!.getAttribute("href")).toBe("/project/3");
        // The description's first line, and the location's label
        expect(row.textContent).toContain("North farm");
        expect(row.textContent).not.toContain("Bins 1 to 4");
        expect(row.textContent).toContain("1 Farm Rd");
        expect(row.textContent).toContain("5.0 MB");
        // Flights, datasets and findings counted, 0 too
        const counts = (id: number) => [3, 4, 5].map((n) => $(`tr[data-id="${id}"] td:nth-child(${n})`)!.textContent);
        expect(counts(3)).toEqual(["2", "3", "0"]);
        expect(counts(1)).toEqual(["0", "0", "0"]);

        type(byId<HTMLInputElement>("search"), "silo");
        await ticks();
        expect(names()).toEqual(["Silos"]);
        type(byId<HTMLInputElement>("search"), "barn");
        await ticks();
        expect(byId("message").textContent).toBe("No projects match the search.");
    });

    it("makes a project and opens it, after asking for a name", async () => {
        const fetchFn = server({[API + "projects"]: {projects: [EMPTY]}, ["POST " + API + "projects"]: SILOS});
        const nav = projectsPage(fetchFn);
        await ticks();
        click(byId("new-project-button"));
        await ticks();
        click(byId("project-save"));
        await ticks();
        expect(byId("project-error").textContent).toBe("Give the project a name.");
        expect(calls(fetchFn)).not.toContain("POST " + API + "projects");

        type(byId<HTMLInputElement>("project-name"), " Silos ");
        type(byId<HTMLTextAreaElement>("project-description"), "North farm");
        await ticks();
        key(byId("project-name"), "Enter");
        await ticks();
        expect(body(fetchFn, "POST")).toEqual({name: "Silos", description: "North farm", location: null});
        expect(nav).toHaveBeenCalledWith("/project/3");
    });

    it("edits a project, says why it was not saved, and closes on Escape", async () => {
        const fetchFn = server({[API + "projects"]: {projects: [SILOS]},
                                ["PATCH " + API + "projects/3"]: [() => jsonResponse({name: ["Too long"]}, false), SILOS]});
        projectsPage(fetchFn);
        await ticks();
        click($(".edit")!);
        await ticks();
        expect(byId<HTMLInputElement>("project-name").value).toBe("Silos");
        expect(byId<HTMLTextAreaElement>("project-description").value).toBe(SILOS.description);
        type(byId<HTMLInputElement>("project-name"), "Grain silos");
        await ticks();
        click(byId("project-save"));
        await ticks();
        expect(byId("project-error").textContent).toBe("Too long");
        click(byId("project-save"));
        await ticks();
        expect(body(fetchFn, "PATCH").name).toBe("Grain silos");
        expect(byId("project-form")).toBeNull();
        expect(calls(fetchFn).filter((c) => c === "GET " + API + "projects")).toHaveLength(2);

        click($(".edit")!);
        await ticks();
        key(document.body, "Escape");
        await ticks();
        expect(byId("project-form")).toBeNull();
    });

    it("says what deleting a project takes with it, and the space freed, before deleting it", async () => {
        const fetchFn = server({[API + "projects"]: {projects: [SILOS]}, ["DELETE " + API + "projects/3"]: {}});
        projectsPage(fetchFn);
        await ticks();
        click($(".delete")!);
        await ticks();
        const text = dialog()!.textContent;
        expect(text).toContain("“Silos” is deleted with its 2 flights, 3 datasets, 2 mosaics and 14 measurements.");
        expect(text).toContain("5.0 MB of disk space is freed.");
        expect(text).toContain("cannot be undone");
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("DELETE " + API + "projects/3");
        click($(".delete")!);
        await ticks();
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + API + "projects/3");
    });

    it("words a delete for a project with nothing in it, or a dataset alone", () => {
        expect(projectDeleteText(EMPTY)).toEqual(["“Default Project” has no flights.", "This cannot be undone."]);
        expect(projectDeleteText({...EMPTY, dataset_count: 1})[0]).toBe("“Default Project” is deleted with its 1 flight.");
        expect(projectDeleteText({...EMPTY, dataset_count: 1})[1]).toBe(
            "The images of flights read from a folder stay in their folders.");
    });
});

describe("a project's page", () => {
    const routes = (project: unknown = DETAIL, more = {}) =>
        server({[API + "projects/3"]: project, [API + "datasets?project=3"]: {datasets: []}, ...more});

    it("shows the project, the map of where its datasets were flown, and its datasets", async () => {
        projectPage(routes());
        await ticks();
        expect(byId("project-name").textContent).toBe("Silos");
        expect(byId("project-description").textContent).toBe(SILOS.description);
        expect($(".project-location")!.textContent).toContain("1 Farm Rd");
        expect(byId("project-map")).not.toBeNull();
        expect(byId("message").textContent).toMatch(/No flights in this project yet/);
        expect($(".breadcrumb a")!.getAttribute("href")).toBe("/");
    });

    it("lists its datasets' findings, each opening the viewer on its mosaics when there are any", async () => {
        const finding = {id: 7, dataset: 5, dataset_name: "Roof", name: "Hot joint", notes: "Loose bolt\nNorth side",
                         severity: "high", status: "reviewed", temperatures: {value: 31.5, unit: "C"},
                         created_at: "2026-10-27T09:00:00Z", opens: 9};
        projectPage(routes({...DETAIL, findings: [finding, {...finding, id: 8, name: "Old", notes: "", opens: null}]}));
        await ticks();
        const rows = [...document.querySelectorAll("#findings tbody tr")];
        expect(rows[0].textContent).toContain("High");
        expect(rows[0].textContent).toContain("Reviewed");
        expect(rows[0].textContent).toContain("31.50 °C");
        expect(rows[0].textContent).toContain("Loose bolt");
        expect(rows[0].textContent).not.toContain("North side");
        expect(rows[0].querySelector("a")!.getAttribute("href")).toBe("/conversion/9?finding=7");
        expect(rows[0].querySelectorAll("a")[1].getAttribute("href")).toBe("/dataset/5");
        expect(rows[1].querySelectorAll("a")).toHaveLength(1);
        expect(rows[1].textContent).toContain("Old");
    });

    it("has no findings table without findings", async () => {
        projectPage(routes({...DETAIL, findings: []}));
        await ticks();
        expect(byId("findings")).toBeNull();
    });

    it("has no map without a location or a dataset flown", async () => {
        projectPage(routes({...EMPTY, id: 3, areas: []}));
        await ticks();
        expect(byId("project-name").textContent).toBe("Default Project");
        expect(byId("project-map")).toBeNull();
        expect($(".project-about")).toBeNull();
    });

    it("edits the project and shows it again", async () => {
        const fetchFn = routes([DETAIL, {...DETAIL, name: "Grain silos"}], {["PATCH " + API + "projects/3"]: SILOS});
        projectPage(fetchFn);
        await ticks();
        click(byId("edit-project"));
        await ticks();
        type(byId<HTMLInputElement>("project-name"), "Grain silos");
        await ticks();
        click(byId("project-save"));
        await ticks();
        expect(byId("project-name").textContent).toBe("Grain silos");
    });

    it("warns which chosen flights would go without their images, and still lets them be exported", async () => {
        const flights = [{id: 5, name: "Roof", busy: false, bytes: 1024, images_missing: true},
                         {id: 6, name: "Wall", busy: false, bytes: 1024, images_missing: false}];
        projectPage(routes(DETAIL, {[API + "projects/3/export"]: {flights}}));
        await ticks();
        click(byId("export-project-button"));
        await ticks();
        expect(byId("export-missing").textContent).toContain("The images of Roof can't");
        expect(byId("export-save").getAttribute("href")).toBe("/api/projects/3/export.tar");
        const box = document.querySelector<HTMLInputElement>("[name=export-flight]")!;
        box.checked = false;
        box.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect(document.getElementById("export-missing")).toBeNull();
    });

    it("exports all its flights by default, with their sizes, a busy one not offered", async () => {
        const flights = [{id: 5, name: "Roof", busy: false, bytes: 3 * 1024 ** 3}, {id: 6, name: "Wall", busy: false, bytes: 1024 ** 3},
                         {id: 7, name: "Barn", busy: true, bytes: null}];
        projectPage(routes(DETAIL, {[API + "projects/3/export"]: {flights}}));
        await ticks();
        click(byId("export-project-button"));
        await ticks();
        const boxes = [...document.querySelectorAll<HTMLInputElement>("[name=export-flight]")];
        expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, false], [true, false], [false, true]]);
        expect(byId("export-project").textContent).toContain("Roof 3.0 GB");
        expect(byId("export-project").textContent).toContain("Barn (busy: still being analyzed or converted)");
        expect(byId("export-total").textContent).toBe("About 4.0 GB.");
        // The busy flight left out by name; then one flight only
        expect(byId("export-save").getAttribute("href")).toBe("/api/projects/3/export.tar?flights=5,6");
        boxes[0].checked = false;
        boxes[0].dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect(byId("export-total").textContent).toBe("About 1.0 GB.");
        expect(byId("export-save").getAttribute("href")).toBe("/api/projects/3/export.tar?flights=6");
        expect(byId("export-save").hasAttribute("download")).toBe(true);
        boxes[1].checked = false;
        boxes[1].dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect(byId("export-total").textContent).toBe("No flight chosen: only the project itself is exported.");
        expect(byId("export-save").getAttribute("href")).toBe("/api/projects/3/export.tar?flights=");
        key(document.body, "Escape");
        await ticks();
        expect(byId("export-project")).toBeNull();
    });

    it("exports the whole project by its plain address when every flight is chosen, and closes", async () => {
        projectPage(routes(DETAIL, {[API + "projects/3/export"]: {flights: [{id: 5, name: "Roof", busy: false, bytes: 2048}]}}));
        await ticks();
        click(byId("export-project-button"));
        await ticks();
        const save = byId("export-save");
        expect(save.getAttribute("href")).toBe("/api/projects/3/export.tar");
        save.addEventListener("click", (e) => e.preventDefault());
        click(save);
        await ticks();
        expect(byId("export-project")).toBeNull();
    });

    it("says so when the flights cannot be listed, and offers no export", async () => {
        projectPage(routes(DETAIL, {[API + "projects/3/export"]: () => Promise.resolve(new Response("", {status: 500}))}));
        await ticks();
        click(byId("export-project-button"));
        await ticks();
        expect(byId("export-project").textContent).toContain("Could not list the project's flights.");
        expect(byId("export-save")).toBeNull();
    });

    it("deletes the project after asking, and goes back to the projects", async () => {
        const fetchFn = routes(DETAIL, {["DELETE " + API + "projects/3"]: {}});
        const nav = projectPage(fetchFn);
        await ticks();
        click(byId("delete-project"));
        await ticks();
        expect(dialog()!.textContent).toContain("“Silos” is deleted with its 2 flights");
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + API + "projects/3");
        expect(nav).toHaveBeenCalledWith("/");
    });
});

describe("a project's import", () => {
    const ARCHIVE = {name: "Silos", proposed: "Silos (2)", flights: [{name: "Roof", file_count: 654, conversions: 2}]};
    const status = (code: number, data: unknown) => () => Promise.resolve(new Response(JSON.stringify(data), {status: code}));

    function choose(f: File) {
        const input = byId<HTMLInputElement>("import-file");
        Object.defineProperty(input, "files", {value: [f], configurable: true});
        input.dispatchEvent(new Event("change", {bubbles: true}));
    }

    it("sends an archive a piece at a time, from where the server stopped, and a piece that fails again", async () => {
        const fetchFn = server({
            "PUT /api/imports/ab?offset=0": {received: 4, project: null},
            "PUT /api/imports/ab?offset=4": [() => Promise.reject(new Error("Failed to fetch")), status(409, {received: 6})],
            "PUT /api/imports/ab?offset=6": {received: 10, project: ARCHIVE},
        });
        const heard: unknown[] = [];
        await sendArchive(fetchFn, "/api/imports/ab", "tok", new Blob(["0123456789"]), (n, p) => heard.push([n, p?.name]),
                          undefined, 4);
        expect(calls(fetchFn)).toEqual(["PUT /api/imports/ab?offset=0", "PUT /api/imports/ab?offset=4",
                                        "PUT /api/imports/ab?offset=4", "PUT /api/imports/ab?offset=6"]);
        expect(heard).toEqual([[4, undefined], [10, "Silos"]]);
        const init = fetchFn.mock.calls[0][1]!;
        expect([(init.body as Blob).size, (init.headers as Record<string, string>)["X-CSRFToken"]]).toEqual([4, "tok"]);
    });

    it("stops with the server's reason when it refuses the archive, or after failing three times", async () => {
        const refused = server({"PUT /api/imports/ab?offset=0": status(400, {error: "This is not a tar archive"})});
        await expect(sendArchive(refused, "/api/imports/ab", "tok", new Blob(["01"]), () => {})).rejects
            .toThrow("This is not a tar archive");
        const down = server({"PUT /api/imports/ab?offset=0": () => Promise.reject(new Error("Failed to fetch"))});
        await expect(sendArchive(down, "/api/imports/ab", "tok", new Blob(["01"]), () => {})).rejects.toThrow("Failed to fetch");
        expect(down.mock.calls.length).toBe(3);
    });

    it("imports an archive as a new project, a name in use replaced by a free one the user can change", async () => {
        const fetchFn = server({
            [API + "projects"]: {projects: [EMPTY, SILOS]},
            [`POST ${API}imports`]: {id: "ab"},
            [`PUT ${API}imports/ab?offset=0`]: {received: 10, project: ARCHIVE},
            [`POST ${API}imports/ab`]: {id: 9},
        });
        const nav = projectsPage(fetchFn);
        await ticks();
        click(byId("import-project-button"));
        await ticks();
        expect(byId<HTMLButtonElement>("import-save").disabled).toBe(true);
        choose(new File(["0123456789"], "Silos.tar"));
        await ticks();
        expect(body(fetchFn, "POST")).toEqual({size: 10});
        const text = byId("import-project").textContent;
        expect(text).toContain("“Silos”, with 1 flight:");
        expect(text).toContain("Roof (654 images, 2 datasets)");
        expect(byId("import-name-help").textContent).toContain("A project is already named “Silos”");
        expect(byId<HTMLInputElement>("import-name").value).toBe("Silos (2)");
        expect(byId("import-progress-text").textContent).toBe("Received 10 B.");
        // A name in use is not offered
        type(byId<HTMLInputElement>("import-name"), "Default Project ");
        await ticks();
        expect(byId("import-name-help").textContent).toContain("A project is already named “Default Project”: choose another");
        expect(byId<HTMLButtonElement>("import-save").disabled).toBe(true);
        type(byId<HTMLInputElement>("import-name"), " North silos ");
        await ticks();
        click(byId("import-save"));
        await ticks();
        expect(JSON.parse(fetchFn.mock.calls.at(-1)![1]!.body as string)).toEqual({name: "North silos"});
        expect(nav).toHaveBeenCalledWith("/project/9");
    });

    it("stays usable when the app stops answering, starting an import or finishing it", async () => {
        const down = () => Promise.reject(new Error("Failed to fetch"));
        const fetchFn = server({
            [API + "projects"]: {projects: [EMPTY]},
            [`POST ${API}imports`]: [down, {id: "ab"}],
            [`PUT ${API}imports/ab?offset=0`]: {received: 4, project: ARCHIVE},
            [`POST ${API}imports/ab`]: down,
        });
        projectsPage(fetchFn);
        await ticks();
        click(byId("import-project-button"));
        await ticks();
        choose(new File(["0123"], "Silos.tar"));
        await ticks();
        expect(byId("import-error").textContent).toContain("did not answer");
        expect(byId<HTMLInputElement>("import-file").disabled).toBe(false);
        choose(new File(["0123"], "Silos.tar"));
        await ticks();
        click(byId("import-save"));
        await ticks();
        expect(byId("import-error").textContent).toContain("did not answer");
        expect(byId<HTMLButtonElement>("import-cancel").disabled).toBe(false);
        expect(byId<HTMLButtonElement>("import-save").disabled).toBe(false);
    });

    it("says why an archive is refused, and another can be chosen", async () => {
        const fetchFn = server({
            [API + "projects"]: {projects: [EMPTY]},
            [`POST ${API}imports`]: {id: "ab"},
            [`PUT ${API}imports/ab?offset=0`]: status(400, {error: "This is not a project exported by dji-thermal-ui"}),
        });
        projectsPage(fetchFn);
        await ticks();
        click(byId("import-project-button"));
        await ticks();
        choose(new File(["0123"], "photo.tar"));
        await ticks();
        expect(byId("import-error").textContent).toBe("This is not a project exported by dji-thermal-ui");
        expect(byId<HTMLInputElement>("import-file").disabled).toBe(false);
        expect(byId("import-archive")).toBeNull();
    });

    it("stops the import when closed, what was sent removed", async () => {
        const fetchFn = server({
            [API + "projects"]: {projects: [EMPTY]},
            [`POST ${API}imports`]: {id: "ab"},
            [`PUT ${API}imports/ab?offset=0`]: {received: 4, project: ARCHIVE},
            [`DELETE ${API}imports/ab`]: () => Promise.resolve(new Response(null, {status: 204})),
        });
        projectsPage(fetchFn);
        await ticks();
        click(byId("import-project-button"));
        await ticks();
        choose(new File(["0123"], "Silos.tar"));
        await ticks();
        key(document.body, "Escape");
        await ticks();
        expect(byId("import-project")).toBeNull();
        expect(calls(fetchFn)).toContain(`DELETE ${API}imports/ab`);
    });
});
