import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {checkText, lastMoveText, type MoveCheck, share, type Storage, StoragePage, storageRows, waitForMove}
    from "../src/storage/storage-page";
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

async function page(fetchFn = server({"/api/storage": STORAGE}), reload = () => {}) {
    vi.stubGlobal("fetch", fetchFn);
    render(<StoragePage api="/api/" publicUrl="/" reload={reload}/>, root());
    await ticks();
    return fetchFn;
}

const NEW: MoveCheck = {path: "/mnt/big/thermal", kind: "new", same_drive: true, needed: 0, free: 9000 * MB,
                        projects: [], problems: []};
const DATA: MoveCheck = {...NEW, kind: "data", same_drive: false, needed: 300 * MB, projects: [
    {id: 1, name: "Barn", flights: 2, size: 50 * MB}, {id: 2, name: "Shed", flights: 0, size: 0}]};

async function type(value: string) {
    const input = $("#move-path") as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await ticks();
}

const press = (label: string) =>
    click([...document.querySelectorAll(".dialog button")].find((b) => b.textContent === label)!);
const body = (fetchFn: ReturnType<typeof server>, k: string) =>
    JSON.parse(fetchFn.mock.calls.find((c) => (c[1]?.method || "GET") + " " + c[0] === k)![1]!.body as string);

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

    it("checks a folder typed, then moves the data folder there, the projects chosen imported, and reloads", async () => {
        vi.useFakeTimers();
        try {
            const reload = vi.fn();
            const moved = {...STORAGE, last_move: {state: "moved", from: STORAGE.path, to: DATA.path, replaced: null,
                                                   at: Date.now() / 1000 + 5, imported: [], error: null}};
            const fetchFn = await page(server({
                "/api/storage": [STORAGE, () => Promise.reject(new Error("restarting")), moved],
                "POST /api/storage/check": DATA, "POST /api/storage/move": DATA}), reload);
            expect($("#move-folder")).toBeNull();
            await type(" /mnt/big/thermal ");
            click($("#check-folder")!);
            await ticks();
            expect(body(fetchFn, "POST /api/storage/check")).toEqual({path: "/mnt/big/thermal"});
            expect($("#move-check")!.textContent).toContain("another data folder of this app, with 2 projects");
            expect($("#move-check")!.textContent).toContain("300 MB are copied there (8.8 GB free)");
            // Every project is chosen at first; one left out
            const boxes = [...root().querySelectorAll("#move-projects input")] as HTMLInputElement[];
            expect(boxes.map((b) => b.checked)).toEqual([true, true]);
            click(boxes[1]);
            await ticks();

            click($("#move-folder")!);
            await ticks();
            press("Move");
            await ticks();
            expect(body(fetchFn, "POST /api/storage/move")).toEqual({path: "/mnt/big/thermal", projects: [1]});
            expect($("#moving")!.textContent).toContain("the server is restarting");
            for (let i = 0; i < 2; i++) {
                await vi.advanceTimersByTimeAsync(1000);
                await ticks();
            }
            expect(reload).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("forgets a check once the folder typed changes, and says what stops a move", async () => {
        await page(server({"/api/storage": STORAGE, "POST /api/storage/check": [NEW, {...NEW, kind: "other",
            problems: ["That folder holds other files."]}]}));
        await type("/mnt/big/thermal");
        click($("#check-folder")!);
        await ticks();
        expect($("#move-folder")).not.toBeNull();
        await type("/mnt/big/other");
        expect($("#move-folder")).toBeNull();
        click($("#check-folder")!);
        await ticks();
        expect($("#move-problems")!.textContent).toBe("That folder holds other files.");
        expect($("#move-folder")).toBeNull();
    });

    it("does not move when the dialog is canceled", async () => {
        const fetchFn = await page(server({"/api/storage": STORAGE, "POST /api/storage/check": NEW}));
        await type("/mnt/big/thermal");
        click($("#check-folder")!);
        await ticks();
        click($("#move-folder")!);
        await ticks();
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("POST /api/storage/move");
    });

    it("says the folder is set by the command, with nothing to move", async () => {
        await page(server({"/api/storage": {...STORAGE, set_by: "environment"}}));
        expect($("#move-set-by")!.textContent).toContain("--data-dir");
        expect($("#move-path")).toBeNull();
    });

    it("shows how the last move went until it is dismissed", async () => {
        const last = {state: "moved" as const, from: "/a", to: "/b", replaced: "/b/replaced-2026-10-28", at: 1,
                      imported: [{name: "Barn", flights: 2}], error: null};
        const fetchFn = await page(server({"/api/storage": {...STORAGE, last_move: last},
                                           "DELETE /api/storage/move": {}}));
        expect($("#last-move")!.textContent).toContain("The data folder was moved from /a to /b.");
        click($("#dismiss-move")!);
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE /api/storage/move");
        expect($("#last-move")).toBeNull();
    });
});

describe("the move helpers", () => {
    it("say what a check found", () => {
        expect(checkText(NEW)).toEqual(["There is no such folder yet: it will be made.",
                                        "It is on the same drive: the files are moved, not copied."]);
        expect(checkText({...NEW, kind: "empty"})[0]).toBe("The folder is empty.");
    });

    it("say how the last move went", () => {
        const m = {state: "moved" as const, from: "/a", to: "/b", replaced: "/b/replaced-2026-10-28", at: 1,
                   imported: [{name: "Barn", flights: 2}, {name: "Shed", flights: 1}], error: null};
        expect(lastMoveText(m)).toEqual(["The data folder was moved from /a to /b.",
            "Imported: Barn (2 flights), Shed (1 flight).",
            "What the folder held before is set aside in /b/replaced-2026-10-28, but for the files of the projects imported."]);
        expect(lastMoveText({...m, imported: [], error: "disk gone"})).toEqual(["The data folder was moved from /a to /b.",
            "Not all the projects chosen could be imported: disk gone",
            "What the folder held before is set aside in /b/replaced-2026-10-28."]);
        expect(lastMoveText({...m, imported: [], replaced: null, left_behind: "Could not remove all of the old folder: in use"}))
            .toEqual(["The data folder was moved from /a to /b.",
                      "Could not remove all of the old folder: in use. What is left of /a is no longer used: it can be deleted."]);
        expect(lastMoveText({...m, state: "failed", error: "Permission denied"}))
            .toEqual(["The data folder was not moved to /b: Permission denied"]);
    });

    it("says once when a move is taking long, and goes on waiting", async () => {
        vi.useFakeTimers();
        try {
            const slow = vi.fn();
            vi.stubGlobal("fetch", server({"/api/storage": {...STORAGE, last_move: {at: 10}}}));
            waitForMove("/api/", 20, vi.fn(), 1000, slow);
            await vi.advanceTimersByTimeAsync(119000);
            expect(slow).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(5000);
            expect(slow).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("wait for a move newer than when it was asked, not the last one before", async () => {
        vi.useFakeTimers();
        try {
            const reload = vi.fn();
            vi.stubGlobal("fetch", server({"/api/storage": [{...STORAGE, last_move: {at: 10}}, {...STORAGE, last_move: {at: 50}}]}));
            const done = waitForMove("/api/", 20, reload);
            await vi.advanceTimersByTimeAsync(1000);
            expect(reload).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1000);
            await done;
            expect(reload).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
