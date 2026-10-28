import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {sendJson} from "../src/core/api";
import {formatCapture, formatCaptureRange, formatDate, setUserLocale, userLocale, zoneLabel, zoneText} from "../src/core/format";
import {navigationChanged, type NavProject, onNavigationChanged, pathTo} from "../src/core/navigation";
import {mountPage} from "../src/core/page";
import {applyTheme} from "../src/core/theme";
import {NavPane} from "../src/components/nav-pane";
import {Overview} from "../src/dataset/tabs";
import {PreferencesPage} from "../src/preferences/preferences-page";
import {takenText} from "../src/viewer/view";
import {calls, click, jsonResponse, server, ticks} from "./helpers";

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
const fold = (key: string) => $(`.nav-fold[data-key="${key}"]`) as HTMLButtonElement;

async function pane(current = {page: "projects", id: NaN}, fetchFn = server({"/api/navigation": {projects: PROJECTS}})) {
    vi.stubGlobal("fetch", fetchFn);
    render(<NavPane api="/api/" publicUrl="/" current={current}/>, root());
    await ticks();
    return fetchFn;
}

describe("the navigation pane", () => {
    it("lists the projects folded, and unfolds each level to what is under it", async () => {
        await pane();
        expect(links()).toEqual(["Projects", "Default Project", "Silos", "User Preferences"]);
        expect(currentLink()).toBe("Projects");
        // A project without datasets has nothing to unfold
        expect(fold("p1")).toBeNull();
        click(fold("p2"));
        await ticks(2);
        expect(links()).toEqual(["Projects", "Default Project", "Silos", "Roof", "Field", "User Preferences"]);
        expect(($('a[href="/dataset/5"]'))).not.toBeNull();
        click(fold("d5"));
        await ticks(2);
        expect(links().slice(4, 8)).toEqual(["Report", "Built", "Converted", "Converting"]);
        expect($('a[title=Report]')!.getAttribute("href")).toBe("/dataset/5/report");
        // A conversion opens its mosaics, else its frames, else its dataset's Convert tab; one still converting has
        // nothing under it yet
        expect($("a[title=Built]")!.getAttribute("href")).toBe("/conversion/9");
        expect($("a[title=Converted]")!.getAttribute("href")).toBe("/conversion/8/frame");
        expect($("a[title=Converting]")!.getAttribute("href")).toBe("/dataset/5#convert");
        expect(fold("c7")).toBeNull();
        click(fold("c9"));
        await ticks(2);
        expect(links().slice(5, 9)).toEqual(["Built", "Mosaics", "Frames", "Compare"]);
        expect($('a[href="/conversion/9/compare"]')).not.toBeNull();
        click(fold("c8"));
        await ticks(2);
        expect(links().slice(9, 11)).toEqual(["Converted", "Frames"]);
        // Folded again, with what is under it
        click(fold("p2"));
        await ticks(2);
        expect(links()).toEqual(["Projects", "Default Project", "Silos", "User Preferences"]);
    });

    it("unfolds a dataset's report to it and marks it, even for a dataset without conversions", async () => {
        await pane({page: "dataset-report", id: 4});
        expect(fold("p2").getAttribute("aria-expanded")).toBe("true");
        expect(fold("d4").getAttribute("aria-expanded")).toBe("true");
        expect(currentLink()).toBe("Report");
        expect($('a[aria-current=page]')!.getAttribute("href")).toBe("/dataset/4/report");
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
        expect(currentLink()).toBe("Compare");
        // The conversion folded: it is marked instead
        click(fold("c9"));
        await ticks(2);
        expect(currentLink()).toBe("Built");
        render(null, root());
        await pane({page: "dataset", id: 4});
        expect(currentLink()).toBe("Field");
        render(null, root());
        await pane({page: "preferences", id: NaN});
        expect(currentLink()).toBe("User Preferences");
    });

    it("finds what is above the page shown", () => {
        expect(pathTo(PROJECTS, {page: "viewer", id: 8})).toEqual(["p2", "d5", "c8"]);
        expect(pathTo(PROJECTS, {page: "frame", id: 7})).toEqual(["p2", "d5", "c7"]);
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
        expect(links()).toEqual(["Projects", "Home", "User Preferences"]);
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

    it("on a narrow screen, opens the pane over the page, and closes it on a link or beside it", async () => {
        small = true;
        mount();
        await ticks();
        expect(app().querySelector(".app-nav")).toBeNull();
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

    it("offers only the computer's locale when the list cannot be had", async () => {
        await page(server({"/api/preferences": () => Promise.reject(new Error("offline"))}));
        expect(root().querySelectorAll("#pref-locale option").length).toBe(1);
    });
});
