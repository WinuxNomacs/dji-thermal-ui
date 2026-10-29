import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {type MapboxToken, SettingsPage, shortToken, SIGN_UP, TOKENS_PAGE} from "../src/settings/settings-page";
import {calls, jsonResponse, server, ticks} from "./helpers";

const TOKEN = "pk.eyJ1IjoidGVzdCJ9.abcd";
const OTHER = "pk.eyJ1IjoidGVzdCJ9.wxyz";
const FILE = "/home/me/.local/share/dji-thermal-ui/.env";
const NONE: MapboxToken = {token: null, token_source: null, file: FILE};

const root = () => document.getElementById("root")!;
const $ = (sel: string) => root().querySelector(sel) as HTMLElement | null;
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim();

async function page(fetchFn: ReturnType<typeof server>) {
    vi.stubGlobal("fetch", fetchFn);
    render(<SettingsPage api="/api/" publicUrl="/"/>, root());
    await ticks();
    return fetchFn;
}

async function saveToken(value: string) {
    const input = $("#mapbox-token") as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await ticks();
    ($("#save-token") as HTMLButtonElement).closest("form")!.dispatchEvent(new Event("submit", {cancelable: true}));
    await ticks();
}

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    render(null, root());
    vi.unstubAllGlobals();
});

describe("System Settings", () => {
    it("shows a token shortened to its start and its last characters", () => {
        expect(shortToken(TOKEN)).toBe("pk.…abcd");
    });

    it("tells how to get a token, saves one Mapbox accepts, and says where it is written", async () => {
        const saved: MapboxToken = {token: TOKEN, token_source: FILE, file: FILE};
        const fetchFn = await page(server({"/api/settings/mapbox": NONE, "PUT /api/settings/mapbox": saved}));
        expect(text("#mapbox-state")).toContain("No token yet");
        const links = [...root().querySelectorAll("#mapbox-settings a")].map((a) => a.getAttribute("href"));
        expect(links).toEqual(expect.arrayContaining([SIGN_UP, TOKENS_PAGE]));
        expect(text("#mapbox-settings")).toContain("Default public token");
        expect(($("#save-token") as HTMLButtonElement).disabled).toBe(true);

        await saveToken(" " + TOKEN + " ");
        expect(calls(fetchFn)).toEqual(["GET /api/settings/mapbox", "PUT /api/settings/mapbox"]);
        expect(JSON.parse(fetchFn.mock.calls[1][1]!.body as string)).toEqual({token: TOKEN});
        expect(text("#token-saved")).toContain("Mapbox accepted the token, and it is saved in " + FILE);
        expect(text("#mapbox-state")).toBe("The token in use is pk.…abcd, from " + FILE + ". A token saved here replaces it.");
        expect(($("#mapbox-token") as HTMLInputElement).value).toBe("");
        expect($("label[for=mapbox-token]")!.textContent).toBe("New access token");
        // No way to remove it: only to replace it
        expect([...root().querySelectorAll("#mapbox-settings button")].map((b) => b.id)).toEqual(["save-token"]);
    });

    it("says why Mapbox refused a token, keeping it in the field and the one in use", async () => {
        const known: MapboxToken = {token: TOKEN, token_source: FILE, file: FILE};
        const fetchFn = server({"/api/settings/mapbox": known});
        fetchFn.mockImplementation((_url: string, opts?: RequestInit) => opts?.method === "PUT"
            ? jsonResponse({token: "Mapbox refused the token: check that it was copied whole"}, false)
            : jsonResponse(known));
        await page(fetchFn);
        await saveToken(OTHER);
        expect(text("#token-error")).toBe("Mapbox refused the token: check that it was copied whole");
        expect(($("#mapbox-token") as HTMLInputElement).value).toBe(OTHER);
        expect($("#token-saved")).toBeNull();
        expect(text("#mapbox-state")).toContain("pk.…abcd");
    });

    it("shows the environment's token, which is changed there and not here", async () => {
        await page(server({"/api/settings/mapbox": {token: TOKEN, token_source: "environment", file: null}}));
        expect(text("#mapbox-state")).toBe("The token in use is pk.…abcd, from MAPBOX_API_TOKEN in the environment the "
                                           + "app was started from: to change it, change it there.");
        expect($("#mapbox-token")).toBeNull();
    });

    it("links to Storage", async () => {
        await page(server({"/api/settings/mapbox": NONE}));
        expect($('#storage-settings a[href="/settings/storage"]')!.textContent).toBe("Storage");
    });
});
