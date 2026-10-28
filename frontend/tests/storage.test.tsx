import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {share, type Storage, StoragePage, storageRows} from "../src/storage/storage-page";
import {calls, click, jsonResponse, server, ticks} from "./helpers";

const MB = 1024 * 1024;
const STORAGE: Storage = {
    path: "/home/me/.local/share/dji-thermal-ui", total: 300 * MB, free: 5000 * MB, database: 2 * MB, other: 1024,
    left_behind: 0,
    projects: [
        {id: 1, name: "Default Project", size: 0, flights: []},
        {id: 2, name: "Roof", size: 297 * MB, flights: [
            {id: 4, name: "East", size: 97 * MB, files: 300, in_place: null},
            {id: 5, name: "West", size: 200 * MB, files: 650, in_place: null}]},
        {id: 3, name: "Silos", size: 1 * MB, flights: [{id: 6, name: "Read in place", size: MB, files: 4, in_place: 900 * MB}]},
    ],
};

const root = () => document.getElementById("root")!;
const $ = (sel: string) => root().querySelector(sel) as HTMLElement | null;
const rowsShown = () => [...root().querySelectorAll("#storage-table tbody tr")].map((tr) =>
    [...tr.children].map((td) => td.textContent!.trim()).join(" | "));

async function page(fetchFn = server({"/api/storage": STORAGE})) {
    vi.stubGlobal("fetch", fetchFn);
    render(<StoragePage api="/api/" publicUrl="/"/>, root());
    await ticks();
    return fetchFn;
}

beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; });
afterEach(() => {
    render(null, root());
    vi.unstubAllGlobals();
});

describe("the storage helpers", () => {
    it("list the projects largest first, each with its flights largest first, then the database and the rest", () => {
        const rows = storageRows(STORAGE, "/");
        expect(rows.map((r) => r.key)).toEqual(["p2", "f5", "f4", "p3", "f6", "p1", "database", "other"]);
        expect(rows[0]).toMatchObject({kind: "project", label: "Roof", href: "/project/2", note: "2 flights"});
        expect(rows[1]).toMatchObject({kind: "flight", label: "West", href: "/dataset/5", note: "650 files"});
        // A folder flight's images are where it reads them, not counted
        expect(rows[4].note).toBe("images read in place: 900 MB, not counted");
        // Files left behind by a flight no longer there, when there are any
        expect(storageRows({...STORAGE, left_behind: 5 * MB}, "/").map((r) => r.key)).toContain("left");
    });

    it("give each part's share of the total", () => {
        expect([share(150, 300), share(1, 300), share(0, 300), share(5, 0)]).toEqual(["50%", "<1%", "", ""]);
    });
});

describe("the Storage page", () => {
    it("shows the data folder, its size and the free space, and each project's and flight's size", async () => {
        await page();
        expect($("#data-path")!.textContent).toBe("/home/me/.local/share/dji-thermal-ui");
        expect($("#storage-total")!.textContent).toBe("300 MB on disk; 4.9 GB free on its drive.");
        expect(rowsShown()).toEqual([
            "Roof | 297 MB | 99% | 2 flights", "West | 200 MB |  | 650 files", "East | 97 MB |  | 300 files",
            "Silos | 1.0 MB | <1% | 1 flight", "Read in place | 1.0 MB |  | images read in place: 900 MB, not counted",
            "Default Project | 0 B |  | 0 flights", "Database | 2.0 MB | <1% | ", "Other | 1.0 KB | <1% | the secret key and anything else in the folder"]);
        expect($("#storage-sum")!.textContent).toBe("300 MB");
        expect($('[data-key="f5"] a')!.getAttribute("href")).toBe("/dataset/5");
    });

    it("measures again when asked", async () => {
        const fetchFn = await page();
        click($("#measure")!);
        await ticks();
        expect(calls(fetchFn).filter((c) => c === "GET /api/storage").length).toBe(2);
    });

    it("says when the data folder could not be measured", async () => {
        await page(server({"/api/storage": () => jsonResponse({}, false)}));
        expect($("[role=alert]")!.textContent).toBe("Could not measure the data folder.");
        expect($("#storage-table")).toBeNull();
    });
});
