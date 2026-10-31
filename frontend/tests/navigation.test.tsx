import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {sendJson} from "../src/core/api";
import {formatCapture, formatCaptureRange, formatDate, setUserLocale, userLocale, zoneLabel, zoneText} from "../src/core/format";
import {type Current, navigationChanged, type NavProject, onNavigationChanged, pathTo} from "../src/core/navigation";
import {mountPage} from "../src/core/page";
import {applyTheme} from "../src/core/theme";
import {NavPane} from "../src/components/nav-pane";
import {Overview} from "../src/dataset/tabs";
import {PreferencesPage} from "../src/preferences/preferences-page";
import {previewScene, SCENE_RANGE, SCENE_SIZE} from "../src/preferences/palette-preview";
import {takenText} from "../src/viewer/view";
import {calls, click, jsonResponse, key, server, ticks} from "./helpers";

const PROJECTS: NavProject[] = [
    {id: 1, name: "Default Project", datasets: []},
    {id: 2, name: "Silos", datasets: [
        {id: 5, name: "Roof", conversions: [
            {id: 9, name: "Built", frames: true, mosaics: true},
            {id: 8, name: "Converted", frames: true, mosaics: false},
            {id: 7, name: "Converting", frames: false, mosaics: false},
        ]},
        {id: 4, name: "Field", conversions: []},
    ]},
];

// The computer's screen: narrow or not, as the browser reports it
let small = false;
const screenListeners: (() => void)[] = [];

beforeEach(() => {
    small = false;
    vi.stubGlobal("matchMedia", (q: string) => ({
        get matches() { return q.includes("max-width") ? small : false; },
        addEventListener: (_: string, l: () => void) => screenListeners.push(l),
        removeEventListener: () => {},
    }));
    localStorage.clear();
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    const el = document.getElementById("root") || document.getElementById("app");
    if (el) render(null, el);
    setUserLocale("");
    vi.unstubAllGlobals();
});

const root = () => document.getElementById("root")!;
const $ = (sel: string) => root().querySelector(sel);
const links = () => [...root().querySelectorAll(".app-nav a")].map((a) => a.textContent!.trim());
const currentLink = () => root().querySelector(".app-nav [aria-current=page]")?.textContent;
function type(el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
}
const fold = (key: string) => $(`.nav-fold[data-key="${key}"]`) as HTMLButtonElement;

async function pane(current: Current = {page: "projects", id: NaN}, fetchFn = server({"/api/navigation": {projects: PROJECTS}})) {
    vi.stubGlobal("fetch", fetchFn);
    render(<NavPane api="/api/" publicUrl="/" current={current}/>, root());
    await ticks();
    return fetchFn;
}

describe("the navigation pane", () => {
    it("lists the projects folded, unfolds them to their flights and those to their datasets, and stops there", async () => {
        await pane();
        expect(links()).toEqual(["Projects", "Default Project", "Silos", "User Preferences", "System Settings", "Storage"]);
        expect(currentLink()).toBe("Projects");
        // A project without flights has nothing to unfold
        expect(fold("p1")).toBeNull();
        click(fold("p2"));
        await ticks(2);
        expect(links()).toEqual(["Projects", "Default Project", "Silos", "Roof", "Field", "User Preferences", "System Settings",
                                 "Storage"]);
        expect(($('a[href="/dataset/5"]'))).not.toBeNull();
        // A flight without datasets has nothing to unfold either
        expect(fold("d4")).toBeNull();
        click(fold("d5"));
        await ticks(2);
        expect(links().slice(3, 8)).toEqual(["Roof", "Built", "Converted", "Converting", "Field"]);
        // No report row: the flight page's header opens it
        expect($('a[href="/dataset/5/report"]')).toBeNull();
        // A dataset opens its mosaics, else its frames, else its flight's Datasets tab, and has nothing under it
        expect($("a[title=Built]")!.getAttribute("href")).toBe("/conversion/9");
        expect($("a[title=Converted]")!.getAttribute("href")).toBe("/conversion/8/frame");
        expect($("a[title=Converting]")!.getAttribute("href")).toBe("/dataset/5#datasets");
        expect(fold("c9")).toBeNull();
        expect(root().querySelectorAll(".app-nav .level-4")).toHaveLength(0);
        // Folded again, with what is under it
        click(fold("p2"));
        await ticks(2);
        expect(links()).toEqual(["Projects", "Default Project", "Silos", "User Preferences", "System Settings", "Storage"]);
    });

    it("marks a flight on its report", async () => {
        await pane({page: "dataset_report", id: 4});
        expect(fold("p2").getAttribute("aria-expanded")).toBe("true");
        expect(currentLink()).toBe("Field");
    });

    it("lists only the projects whose name has every word typed, kept for the next page", async () => {
        await pane({page: "dataset", id: 5});
        const box = $("#nav-search") as HTMLInputElement;
        expect(box.getAttribute("aria-label")).toBe("Filter projects");
        type(box, "SIL");
        await ticks();
        expect(links()).toEqual(["Projects", "Silos", "Roof", "Field", "User Preferences", "System Settings", "Storage"]);
        // The page shown stays marked
        expect(currentLink()).toBe("Roof");
        type(box, "project default");
        await ticks();
        expect(links()).toEqual(["Projects", "Default Project", "User Preferences", "System Settings", "Storage"]);
        type(box, "yard");
        await ticks();
        expect(links()).toEqual(["Projects", "User Preferences", "System Settings", "Storage"]);
        expect($(".nav-none")!.textContent).toBe("No projects match the filter.");
        // Kept from page to page, as the folds are
        expect(localStorage.getItem("thermal-analyzer.nav.search")).toBe("yard");
        render(null, root());
        await pane();
        expect(($("#nav-search") as HTMLInputElement).value).toBe("yard");
        expect(links()).toEqual(["Projects", "User Preferences", "System Settings", "Storage"]);
        // Escape empties it, and it is forgotten
        key($("#nav-search")!, "Escape");
        await ticks();
        expect(($("#nav-search") as HTMLInputElement).value).toBe("");
        // Silos still unfolded, as it was to show the first page
        expect(links()).toEqual(["Projects", "Default Project", "Silos", "Roof", "Field", "User Preferences", "System Settings",
                                 "Storage"]);
        expect(localStorage.getItem("thermal-analyzer.nav.search")).toBeNull();
    });

    it("offers no filter before there are projects", async () => {
        await pane(undefined, server({"/api/navigation": {projects: []}}));
        expect($("#nav-search")).toBeNull();
        expect($(".nav-none")).toBeNull();
    });

    it("keeps what is unfolded for the next visit", async () => {
        await pane();
        click(fold("p2"));
        await ticks(2);
        expect(JSON.parse(localStorage.getItem("thermal-analyzer.nav.expanded")!)).toEqual(["p2"]);
        render(null, root());
        await pane();
        expect(links()).toContain("Roof");
    });

    it("unfolds to the page shown and marks it", async () => {
        await pane({page: "compare", id: 9});
        expect(fold("p2").getAttribute("aria-expanded")).toBe("true");
        expect(fold("d5").getAttribute("aria-expanded")).toBe("true");
        expect(currentLink()).toBe("Built");
        // Folded: the deepest item seen is marked instead
        click(fold("d5"));
        await ticks(2);
        expect(currentLink()).toBe("Roof");
        render(null, root());
        await pane({page: "dataset", id: 4});
        expect(currentLink()).toBe("Field");
        render(null, root());
        await pane({page: "preferences", id: NaN});
        expect(currentLink()).toBe("User Preferences");
        render(null, root());
        await pane({page: "settings", id: NaN});
        expect(currentLink()).toBe("System Settings");
        render(null, root());
        await pane({page: "storage", id: NaN});
        expect(currentLink()).toBe("Storage");
    });

    it("marks a dataset on each of its pages", async () => {
        for (const page of ["viewer", "compare", "conversion_report", "frame"]) {
            localStorage.clear();
            render(null, root());
            await pane({page, id: 9});
            expect(currentLink()).toBe("Built");
        }
        render(null, root());
        await pane({page: "frame", id: 8});
        expect(currentLink()).toBe("Converted");
    });

    it("keeps unfolded what it unfolded to the page shown, so that it folds only when clicked", async () => {
        localStorage.setItem("thermal-analyzer.nav.expanded", JSON.stringify(["p1", "c9", "c9.tools", "settings"]));
        await pane({page: "viewer", id: 9});
        // What an older pane folded (a dataset's groups, System Settings) is forgotten
        expect(JSON.parse(localStorage.getItem("thermal-analyzer.nav.expanded")!)).toEqual(["p1", "p2", "d5"]);
        render(null, root());
        await pane({page: "projects", id: NaN});
        expect(links()).toContain("Built");
    });

    it("lists the settings pages at its foot, each always shown and linked to its page", async () => {
        await pane();
        const settings = [...root().querySelectorAll(".nav-setting a")].map((a) => [a.textContent, a.getAttribute("href")]);
        expect(settings).toEqual([["User Preferences", "/preferences"], ["System Settings", "/settings"],
                                  ["Storage", "/settings/storage"]]);
        expect(root().querySelectorAll(".nav-setting .nav-fold")).toHaveLength(0);
    });

    it("finds what is above the page shown", () => {
        expect(pathTo(PROJECTS, {page: "viewer", id: 9})).toEqual(["p2", "d5"]);
        expect(pathTo(PROJECTS, {page: "conversion_report", id: 9})).toEqual(["p2", "d5"]);
        expect(pathTo(PROJECTS, {page: "frame", id: 7})).toEqual(["p2", "d5"]);
        expect(pathTo(PROJECTS, {page: "dataset_report", id: 5})).toEqual(["p2"]);
        expect(pathTo(PROJECTS, {page: "dataset", id: 5})).toEqual(["p2"]);
        expect(pathTo(PROJECTS, {page: "project", id: 2})).toEqual([]);
        expect(pathTo(PROJECTS, {page: "viewer", id: 99})).toEqual([]);
    });

    it("lists again when a page says what it lists has changed, and says when it cannot", async () => {
        const renamed = [{id: 1, name: "Home", datasets: []}];
        const fetchFn = await pane(undefined, server({"/api/navigation": [{projects: PROJECTS}, {projects: renamed},
                                                                          () => jsonResponse({}, false)]}));
        navigationChanged();
        await ticks();
        expect(links()).toEqual(["Projects", "Home", "User Preferences", "System Settings", "Storage"]);
        navigationChanged();
        await ticks();
        expect(calls(fetchFn)).toEqual(["GET /api/navigation", "GET /api/navigation", "GET /api/navigation"]);
        expect($(".nav-error")!.textContent).toBe("The projects could not be listed.");
        // What it listed is kept
        expect(links()).toContain("Home");
    });

    it("is told of a project, dataset or conversion written, not of a measurement or a preference", async () => {
        const told = vi.fn();
        const stop = onNavigationChanged(told);
        vi.stubGlobal("fetch", server({
            "POST /api/projects": {}, "PATCH /api/datasets/5": {}, "DELETE /api/conversions/9": {},
            "POST /api/conversions/9/mosaics": {}, "POST /api/datasets/5/conversions": {},
            "POST /api/conversions/9/measurements": {}, "PUT /api/preferences": {},
            "DELETE /api/projects/3": () => jsonResponse({}, false),
        }));
        for (const [url, method] of [["/api/projects", "POST"], ["/api/datasets/5", "PATCH"],
                                     ["/api/conversions/9", "DELETE"], ["/api/conversions/9/mosaics", "POST"],
                                     ["/api/datasets/5/conversions", "POST"]]) {
            await sendJson(url, method, {});
        }
        expect(told).toHaveBeenCalledTimes(5);
        await sendJson("/api/conversions/9/measurements", "POST", {});
        await sendJson("/api/preferences", "PUT", {});
        await sendJson("/api/projects/3", "DELETE");      // refused
        expect(told).toHaveBeenCalledTimes(5);
        stop();
    });
});

describe("the page around the content", () => {
    function mount() {
        document.body.innerHTML = '<div id="app" data-page="dataset" data-id="5" data-api="/api/" data-public="/" ' +
            'data-unit="C" data-theme-choice="light" data-locale="en-GB" data-version="0.5.0"></div>';
        vi.stubGlobal("fetch", server({"/api/navigation": {projects: PROJECTS}}));
        mountPage(() => <p>content</p>);
    }
    const app = () => document.getElementById("app")!;
    const toggle = () => app().querySelector("#nav-toggle") as HTMLButtonElement;

    it("shows the pane beside the content, hidden and shown as a whole and kept so for the next visit", async () => {
        mount();
        await ticks();
        expect(userLocale()).toBe("en-GB");
        expect(app().querySelector(".app-body .app-nav [aria-current=page]")!.textContent).toBe("Roof");
        expect(app().querySelector("main")!.textContent).toBe("content");
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        // Beside the page, it needs no close button: the header's switch hides it
        expect(app().querySelector(".app-nav .close")).toBeNull();
        click(toggle());
        await ticks(2);
        expect(app().querySelector(".app-nav")).toBeNull();
        expect(localStorage.getItem("thermal-analyzer.nav.shown")).toBe("0");
        render(null, app());
        mount();
        await ticks();
        expect(app().querySelector(".app-nav")).toBeNull();
        click(toggle());
        await ticks();
        expect(app().querySelector(".app-nav")).not.toBeNull();
        render(null, app());
    });

    it("hides and shows the pane by the tab on its edge too, kept for the next visit", async () => {
        mount();
        await ticks();
        const tab = () => app().querySelector("#nav-tab") as HTMLButtonElement;
        expect(tab().getAttribute("aria-expanded")).toBe("true");
        expect(tab().title).toBe("Hide the navigation");
        click(tab());
        await ticks(2);
        expect(app().querySelector(".app-nav")).toBeNull();
        expect(tab().getAttribute("aria-expanded")).toBe("false");
        expect(tab().title).toBe("Show the navigation");
        expect(toggle().getAttribute("aria-expanded")).toBe("false");
        expect(localStorage.getItem("thermal-analyzer.nav.shown")).toBe("0");
        click(tab());
        await ticks();
        expect(app().querySelector(".app-nav")).not.toBeNull();
        expect(localStorage.getItem("thermal-analyzer.nav.shown")).toBe("1");
        render(null, app());
    });

    it("on a narrow screen, opens the pane over the page, and closes it on a link or beside it", async () => {
        small = true;
        mount();
        await ticks();
        expect(app().querySelector(".app-nav")).toBeNull();
        // No tab: over the page, the pane has its own close button
        expect(app().querySelector("#nav-tab")).toBeNull();
        click(toggle());
        await ticks();
        expect(app().querySelector(".app-body.narrow .app-nav")).not.toBeNull();
        click(app().querySelector(".nav-backdrop")!);
        await ticks(2);
        expect(app().querySelector(".app-nav")).toBeNull();
        click(toggle());
        await ticks();
        click(app().querySelector(".app-nav .close")!);
        await ticks(2);
        expect(app().querySelector(".app-nav")).toBeNull();
        click(toggle());
        await ticks();
        const link = app().querySelector('.app-nav a[href="/preferences"]')!;
        link.addEventListener("click", (e) => e.preventDefault());
        click(link);
        await ticks(2);
        expect(app().querySelector(".app-nav")).toBeNull();
        // Not kept: the next page starts with it hidden, the wide screen's choice untouched
        expect(localStorage.getItem("thermal-analyzer.nav.shown")).toBeNull();
        render(null, app());
    });
});

describe("dates and times", () => {
    it("are shown in the locale chosen, or the computer's", () => {
        const at = "2026-10-22T21:35:16Z";
        setUserLocale("en-GB");
        expect(formatDate(at)).toBe(new Date(at).toLocaleString("en-GB"));
        setUserLocale("de-DE");
        expect(formatDate(at)).toBe(new Date(at).toLocaleString("de-DE"));
        setUserLocale("not a locale!");
        expect(userLocale()).toBe("");
        expect(formatDate(at)).toBe(new Date(at).toLocaleString());
    });

    it("show a frame's capture time as recorded, in the flight's local time", () => {
        setUserLocale("en-GB");
        expect(formatCapture("2026:10:22 16:34:57")).toBe("22/10/2026, 16:34:57");
        expect(formatCapture("2026:10:22 16:34:57", "time")).toBe("16:34:57");
        expect(formatCapture("2026:10:22 16:34:57", "both", "en-US")).toBe("10/22/2026, 4:34:57 PM");
        expect(formatCapture("16:34:57")).toBe("16:34:57");
        expect(formatCapture(null)).toBe("");
        expect(formatCaptureRange("2026:10:22 16:34:57", "2026:10:22 16:58:10")).toBe("22/10/2026, 16:34:57 to 16:58:10");
        expect(formatCaptureRange("2026:10:22 23:58:00", "2026:10:23 00:10:00"))
            .toBe("22/10/2026, 23:58:00 to 23/10/2026, 00:10:00");
        expect(formatCaptureRange("2026:10:22 16:34:57", "2026:10:22 16:34:57")).toBe("22/10/2026, 16:34:57");
    });

    it("label a flight's times with its time zone, or say it is unknown", () => {
        expect(zoneLabel(-300)).toBe("UTC−5");
        expect(zoneLabel(330)).toBe("UTC+5:30");
        expect(zoneLabel(-570)).toBe("UTC−9:30");
        expect(zoneLabel(0)).toBe("UTC");
        expect(zoneText({offset: 345})).toBe("UTC+5:45");
        expect(zoneText({offset: null, reason: "x"})).toBe("time zone unknown");
        expect(zoneText(undefined)).toBe("time zone unknown");
        // The exports: the same in every locale, with the zone when it is known
        expect(takenText(["2026:09:18 09:02:11", "2026:09:18 08:44:00"], {offset: -300})).toBe("2026-09-18 08:44–09:02 UTC−5");
        expect(takenText(["2026:09:18 09:02:11"], {offset: null})).toBe("2026-09-18 09:02");
        expect(takenText([], {offset: -300})).toBe("");
    });

    it("say on the dataset page when the flight was made, where", () => {
        setUserLocale("en-GB");
        const analysis = {files: [{path: "a", kind: "thermal", time: "2026:10:22 16:34:57"},
                                  {path: "b", kind: "thermal", time: "2026:10:22 16:58:10"}]};
        render(<Overview d={{analysis, flight_zone: {offset: -300}}}/>, root());
        expect(root().textContent).toContain("Captured22/10/2026, 16:34:57 to 16:58:10 · UTC−5");
        render(<Overview d={{analysis, flight_zone: {offset: null, reason: "Analyze the dataset again to find it"}}}/>, root());
        expect(root().textContent).toContain("16:58:10 · time zone unknown (analyze the dataset again to find it)");
    });
});

describe("the preferences page", () => {
    const LOCALES = ["en-US", "en-GB", "de-DE"];

    async function page(fetchFn = server({"/api/preferences": {locales: LOCALES}, "PUT /api/preferences": {}}),
                        reload = vi.fn()) {
        vi.stubGlobal("fetch", fetchFn);
        render(<PreferencesPage api="/api/" unit="F" theme="system" locale="" reload={reload}/>, root());
        await ticks();
        return {fetchFn, reload};
    }
    const sent = (fetchFn: ReturnType<typeof server>) =>
        fetchFn.mock.calls.filter((c) => c[1]?.method === "PUT").map((c) => JSON.parse(c[1]!.body as string));
    const select = (id: string, value: string) => {
        const el = $("#" + id) as HTMLSelectElement;
        el.value = value;
        el.dispatchEvent(new Event("change", {bubbles: true}));
    };

    it("offers the computer's locale and the app's, each with an example, and saves the one chosen", async () => {
        const {fetchFn} = await page();
        const options = [...root().querySelectorAll("#pref-locale option")].map((o) => o.textContent);
        expect(options[0]).toBe("As the computer (" + new Date(Date.UTC(2026, 9, 22, 16, 34, 57)).toLocaleString(undefined, {timeZone: "UTC"}) + ")");
        expect(options[2]).toBe("English (United Kingdom) (22/10/2026, 16:34:57)");
        expect(options[3]).toBe("Deutsch (Deutschland) (22.10.2026, 16:34:57)");
        select("pref-locale", "de-DE");
        await ticks();
        expect(sent(fetchFn)).toEqual([{locale: "de-DE"}]);
        expect(userLocale()).toBe("de-DE");
        expect($("#preferences-status")!.textContent).toBe("Saved.");
    });

    it("filters its sections by every word typed, in their titles, labels, help or choices", async () => {
        await page();
        const box = $("#section-filter") as HTMLInputElement;
        expect(box.getAttribute("aria-label")).toBe("Filter the preferences");
        const shown = () => [...root().querySelectorAll<HTMLElement>("fieldset.preference")].filter((f) => !f.hidden)
            .map((f) => f.querySelector("legend")!.textContent);
        expect(shown()).toEqual(["Temperatures", "Palette", "Theme", "Dates and times"]);
        type(box, "THEME");
        await ticks();
        expect(shown()).toEqual(["Theme"]);
        // A choice's name, a help text's words in any order
        type(box, "deutsch");
        await ticks();
        expect(shown()).toEqual(["Dates and times"]);
        type(box, "compare viewer");
        await ticks();
        expect(shown()).toEqual(["Palette"]);
        type(box, "yard");
        await ticks();
        expect(shown()).toEqual([]);
        expect($(".section-none")!.textContent).toBe("Nothing here matches the filter.");
        key(box, "Escape");
        await ticks();
        expect(box.value).toBe("");
        expect(shown()).toEqual(["Temperatures", "Palette", "Theme", "Dates and times"]);
        expect($(".section-none")).toBeNull();
    });

    it("applies a theme at once, the header's switch following, and goes back when it is not saved", async () => {
        const {fetchFn} = await page(server({"/api/preferences": {locales: LOCALES},
                                             "PUT /api/preferences": [{}, () => jsonResponse({}, false)]}));
        applyTheme("system");
        click($('input[value="dark"]')!);
        await ticks();
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
        expect(sent(fetchFn)).toEqual([{theme: "dark"}]);
        expect(($('input[value="dark"]') as HTMLInputElement).checked).toBe(true);
        click($('input[value="light"]')!);
        await ticks();
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
        expect(($('input[value="dark"]') as HTMLInputElement).checked).toBe(true);
        expect($("#preferences-status")!.className).toBe("text-danger");
    });

    it("shows the page again in a new unit, and keeps the unit when it is not saved", async () => {
        const {reload} = await page();
        select("pref-unit", "C");
        await ticks();
        expect(reload).toHaveBeenCalledTimes(1);
        render(null, root());
        const failed = await page(server({"/api/preferences": {locales: LOCALES},
                                          "PUT /api/preferences": () => jsonResponse({}, false)}));
        select("pref-unit", "K");
        await ticks();
        expect(failed.reload).not.toHaveBeenCalled();
        expect(($("#pref-unit") as HTMLSelectElement).value).toBe("F");
    });

    it("offers the palettes the maps can start with, the saved one chosen, and saves another or goes back", async () => {
        const palettes = [{key: "dji_ironred", label: "DJI ironred"}, {key: "magma", label: "Magma"}];
        const {fetchFn} = await page(server({"/api/preferences": {locales: LOCALES, palette: "magma", view_palettes: palettes},
                                             "PUT /api/preferences": [{}, () => jsonResponse({}, false)]}));
        const options = [...root().querySelectorAll("#pref-palette option")].map((o) => o.textContent);
        expect(options).toEqual(["As each flight's images", "DJI ironred", "Magma"]);
        expect(($("#pref-palette") as HTMLSelectElement).value).toBe("magma");
        select("pref-palette", "dji_ironred");
        await ticks();
        expect(sent(fetchFn)).toEqual([{palette: "dji_ironred"}]);
        expect($("#preferences-status")!.textContent).toBe("Saved.");
        select("pref-palette", "");
        await ticks();
        expect(sent(fetchFn)).toEqual([{palette: "dji_ironred"}, {palette: ""}]);
        expect(($("#pref-palette") as HTMLSelectElement).value).toBe("dji_ironred");
        expect($("#preferences-status")!.className).toBe("text-danger");
    });

    it("offers the basemaps the maps can start with, the saved one chosen, and saves another", async () => {
        const basemaps = [{key: "esri", label: "ESRI Satellite"}, {key: "osm", label: "OpenStreetMap"},
                          {key: "none", label: "None"}];
        const {fetchFn} = await page(server({"/api/preferences": {locales: LOCALES, basemap: "esri", basemaps},
                                             "PUT /api/preferences": {}}));
        const options = () => [...root().querySelectorAll("#pref-basemap option")].map((o) => o.textContent);
        expect(options()).toEqual(["ESRI Satellite", "OpenStreetMap", "None"]);
        expect(($("#pref-basemap") as HTMLSelectElement).value).toBe("esri");
        expect($("#basemap-preference")!.textContent).toContain("Mapbox Satellite is offered once its token is saved under System Settings");
        select("pref-basemap", "osm");
        await ticks();
        expect(sent(fetchFn)).toEqual([{basemap: "osm"}]);
        expect(($("#pref-basemap") as HTMLSelectElement).value).toBe("osm");
    });

    it("lists Mapbox once it has a token, and says when a preferred Mapbox has lost its token", async () => {
        const withMapbox = [{key: "esri", label: "ESRI Satellite"}, {key: "mapbox", label: "Mapbox Satellite"},
                            {key: "none", label: "None"}];
        await page(server({"/api/preferences": {locales: LOCALES, basemap: "mapbox", basemaps: withMapbox}}));
        expect($("#basemap-preference")!.textContent).not.toContain("is offered once a token");
        expect(($("#pref-basemap") as HTMLSelectElement).value).toBe("mapbox");

        render(null, root());
        await page(server({"/api/preferences": {locales: LOCALES, basemap: "mapbox",
                                                basemaps: [withMapbox[0], withMapbox[2]]}}));
        expect(($("#pref-basemap") as HTMLSelectElement).selectedOptions[0].textContent)
            .toBe("Mapbox Satellite (no token: ESRI Satellite)");
    });

    it("offers only the computer's locale and the images' palettes when the list cannot be had", async () => {
        await page(server({"/api/preferences": () => Promise.reject(new Error("offline"))}));
        expect(root().querySelectorAll("#pref-locale option").length).toBe(1);
        expect(root().querySelectorAll("#pref-palette option").length).toBe(1);
        expect($("#palette-preview")).toBeNull();
    });

    it("shows the palette chosen on a made-up scene, the images' own for each flight's, a note for a DJI one not at hand", async () => {
        const drawn: Uint8ClampedArray[] = [];
        vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray) {} });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            {putImageData: (d: {data: Uint8ClampedArray}) => drawn.push(d.data)} as unknown as CanvasRenderingContext2D);
        const ramp = (from: number, to: number) => Array.from({length: 256}, (_, i) =>
            ((Math.round(from + (to - from) * i / 255) * 0x10101) << 8 | 255) >>> 0);
        const palettes = [{key: "dji_ironred", label: "DJI ironred", color_map: ramp(0, 255)},
                          {key: "dji_arctic", label: "DJI arctic"},
                          {key: "gray_r", label: "Black hot", color_map: ramp(255, 0)}];
        await page(server({"/api/preferences": {locales: LOCALES, palette: "", view_palettes: palettes,
                                                images_palette: "dji_ironred"},
                           "PUT /api/preferences": {}}));
        const caption = () => $("#palette-preview figcaption")?.textContent || "";
        expect(caption()).toMatch(/^DJI ironred \(as the newest flight's images\), on a made-up roof/);
        expect($("#palette-preview canvas")!.getAttribute("aria-label")).toBe("DJI ironred on a made-up roof");
        expect(drawn.length).toBe(1);
        expect(drawn[0].length).toBe(SCENE_SIZE[0] * SCENE_SIZE[1] * 4);
        expect([...$("#palette-preview .palette-scale-ends")!.children].map((e) => e.textContent)).toEqual(["10 °C", "60 °C"]);
        select("pref-palette", "gray_r");
        await ticks();
        expect(caption()).toMatch(/^Black hot, on a made-up roof/);
        expect(drawn.length).toBe(2);
        expect(drawn[1][0]).toBeGreaterThan(drawn[0][0]);         // the cool ground light in black hot, dark in ironred
        select("pref-palette", "dji_arctic");
        await ticks();
        expect($("#palette-preview canvas")).toBeNull();
        expect($("#palette-preview")!.textContent).toMatch(/^DJI arctic is read from a flight's images/);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
});

describe("the palette preview's scene", () => {
    it("is the same every time, within its range, its vents hottest and its skylight cooler than the roof", () => {
        const [w, h] = SCENE_SIZE, scene = previewScene();
        expect(scene).toEqual(previewScene());
        const at = (u: number, v: number) => scene[Math.floor(v * h) * w + Math.floor(u * w)];
        expect(Math.min(...scene)).toBeGreaterThanOrEqual(SCENE_RANGE[0]);
        expect(Math.max(...scene)).toBeLessThanOrEqual(SCENE_RANGE[1]);
        expect(at(0.32, 0.36)).toBeGreaterThan(50);
        expect(at(0.45, 0.55)).toBeGreaterThan(at(0.7, 0.68));
        expect(at(0.65, 0.38)).toBeLessThan(at(0.4, 0.25));
        expect(at(0.5, 0.25)).toBeGreaterThan(at(0.05, 0.5));
    });
});
