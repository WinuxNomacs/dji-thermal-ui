import fs from "node:fs";
import path from "node:path";
import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Header, helpUrl} from "../src/components/header";
import {mountPage} from "../src/core/page";
import {applyTheme} from "../src/core/theme";
import {userUnit} from "../src/core/units";
import {calls, click, jsonResponse, server, ticks} from "./helpers";

// The computer's colours, as the browser reports them; changed by setDark
let dark = false;
const listeners: (() => void)[] = [];
function setDark(d: boolean) { dark = d; listeners.forEach((l) => l()); }

beforeEach(() => {
    dark = false;
    vi.stubGlobal("matchMedia", (q: string) => ({
        get matches() { return q.includes("dark") && dark; },
        addEventListener: (_: string, l: () => void) => listeners.push(l),
    }));
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.removeAttribute("data-theme");
});
afterEach(() => vi.unstubAllGlobals());

const root = () => document.getElementById("root")!;
const themeButton = (label: string) => root().querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
const pressed = () => [...root().querySelectorAll("[aria-pressed=true]")].map((b) => b.getAttribute("aria-label"));
const shownTheme = () => document.documentElement.getAttribute("data-theme");

function header(fetchFn: ReturnType<typeof server>, reload = vi.fn()) {
    vi.stubGlobal("fetch", fetchFn);
    render(<Header api="/api/" publicUrl="/" unit="F" theme="system" version="0.2.0" reload={reload}/>, root());
    return reload;
}

describe("the header", () => {
    it("saves a new unit for the app and shows the page again in it", async () => {
        const fetchFn = server({"PUT /api/preferences": {unit: "C"}});
        const reload = header(fetchFn);
        const select = root().querySelector("select")!;
        expect(select.value).toBe("F");
        select.value = "C";
        select.dispatchEvent(new Event("change"));
        await ticks();
        expect(calls(fetchFn)).toEqual(["PUT /api/preferences"]);
        expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string)).toEqual({unit: "C"});
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("keeps the unit shown when the new one is not saved", async () => {
        const reload = header(server({"PUT /api/preferences": () => jsonResponse({}, false)}));
        const select = root().querySelector("select")!;
        select.value = "K";
        select.dispatchEvent(new Event("change"));
        await ticks();
        expect(reload).not.toHaveBeenCalled();
        expect(select.disabled).toBe(false);
        expect(select.value).toBe("F");
    });

    it("switches to light or dark at once and saves it, following the computer's otherwise", async () => {
        const fetchFn = server({"PUT /api/preferences": {}});
        header(fetchFn);
        applyTheme("system");
        expect(pressed()).toEqual(["As the computer"]);
        expect(shownTheme()).toBe("light");
        setDark(true);
        expect(shownTheme()).toBe("dark");

        click(themeButton("Light"));
        await ticks();
        expect(shownTheme()).toBe("light");
        expect(pressed()).toEqual(["Light"]);
        expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string)).toEqual({theme: "light"});
        // The computer's change no longer matters
        setDark(false);
        setDark(true);
        expect(shownTheme()).toBe("light");
    });

    it("goes back to the theme it had when the new one is not saved", async () => {
        header(server({"PUT /api/preferences": () => jsonResponse({}, false)}));
        applyTheme("system");
        click(themeButton("Dark"));
        expect(shownTheme()).toBe("dark");
        await ticks();
        expect(shownTheme()).toBe("light");
        expect(pressed()).toEqual(["As the computer"]);
    });
});

describe("a page", () => {
    it("starts from its template's settings: the unit, the theme, and its own data", () => {
        document.body.innerHTML = '<div id="app" data-api="/api/" data-public="/" data-unit="K" ' +
            'data-theme-choice="dark" data-version="0.2.0" data-id="7"></div>';
        let id: string | undefined;
        mountPage(({data}) => { id = data.id; return <p>content</p>; });
        expect(userUnit()).toBe("K");
        expect(shownTheme()).toBe("dark");
        expect(id).toBe("7");
        expect(document.querySelector("#app header .app-version")!.textContent).toBe("0.2.0");
        expect(document.querySelector("#app main")!.textContent).toBe("content");
        expect((document.querySelector("#app-unit") as HTMLSelectElement).value).toBe("K");
    });
});

describe("the header's Help", () => {
    const pages = {
        "/": "/help/guide/projects/",
        "/project/3": "/help/guide/projects/",
        "/dataset/4": "/help/guide/flights/",
        "/dataset/4/report": "/help/guide/reports/",
        "/conversion/2": "/help/guide/mosaics/",
        "/conversion/2/frame": "/help/guide/frames/",
        "/conversion/2/report": "/help/guide/reports/",
        "/conversion/2/compare": "/help/guide/compare/",
        "/preferences": "/help/guide/settings/",
        "/settings": "/help/guide/settings/",
        "/settings/storage": "/help/guide/storage/",
    };

    it("opens the guide's page for the page shown, else the documentation's start", () => {
        for (const [page, help] of Object.entries(pages)) expect(helpUrl("/", page)).toBe(help);
        expect(helpUrl("/", "/somewhere/else")).toBe("/help/");
        expect(helpUrl("/app/", "/app/conversion/2")).toBe("/app/help/guide/mosaics/");
    });

    it("opens a page the documentation has", () => {
        for (const help of new Set(Object.values(pages))) {
            const page = help.replace(/^\/help\/(.*)\/$/, "$1.md");
            expect(fs.existsSync(path.resolve(import.meta.dirname, "../../docs", page)), page).toBe(true);
        }
    });

    it("is a link in the header, opening in a new tab", () => {
        header(server({}));
        const link = root().querySelector("a.app-help") as HTMLAnchorElement;
        expect(link.textContent).toBe(" Help");
        expect(link.getAttribute("href")).toBe("/help/guide/projects/");
        expect(link.target).toBe("_blank");
    });
});

