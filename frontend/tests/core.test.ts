import {afterEach, describe, expect, it, vi} from "vitest";
import {escapeHtml, formatBytes, median, mosaicLabel, stageText, statusLabel} from "../src/core/format";
import {convertDelta, convertTemp, formatDelta, formatTemp, setUserUnit, userUnit} from "../src/core/units";
import {batchTimeout, batches, uploadFiles, uploadName} from "../src/core/upload";
import {errorText, readJson} from "../src/core/api";
import {file, jsonResponse, ticks} from "./helpers";

afterEach(() => vi.useRealTimers());

// The parts of an upload request: [field, the file's name or the path sent]
const parts = (opts: RequestInit) =>
    [...(opts.body as FormData).entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name]);

describe("formatting", () => {
    it("says which stage a normalization or a mosaic is at", () => {
        const align = {stage: "align", step: 3, steps: 6, round: 2, rounds: 3, done: 812, total: 1840, unit: "pairs"};
        expect(stageText(align)).toBe("step 3 of 6, aligning (round 2/3), 812/1840 pairs");
        expect(stageText({stage: "write", step: 6, steps: 6, done: 1, total: 2, unit: "files"}))
            .toBe("step 6 of 6, writing, 1/2 files");
        expect(stageText({})).toBe("");
        expect(stageText(undefined)).toBe("");
        expect(mosaicLabel({stage: align})).toBe("Building the mosaics: step 3 of 6, aligning (round 2/3), 812/1840 pairs…");
        expect(mosaicLabel({stage: {}})).toBe("Building the mosaics…");
    });

    it("formats sizes and statuses, and escapes HTML", () => {
        expect(formatBytes(3 * 1048576)).toBe("3.0 MB");
        expect(formatBytes(512)).toBe("512 B");
        expect(statusLabel({status: "analyzing", progress: 0.42})).toBe("Analyzing 42%");
        expect(statusLabel({status: "new", analyzed: true})).toMatch(/analyze again/);
        expect(escapeHtml('<b a="1">')).toBe("&lt;b a=&quot;1&quot;&gt;");
    });

    it("finds the median of the values given, leaving out the missing ones", () => {
        expect(median([3, null, 1, 2])).toBe(2);
        expect(median([4, 1, undefined, 2, 3])).toBe(2.5);
        expect(median([null])).toBe(null);
    });
});

describe("temperatures", () => {
    afterEach(() => setUserUnit("C"));

    it("converts temperatures between units, and differences by scaling alone", () => {
        expect(convertTemp(100, "C", "F")).toBeCloseTo(212);
        expect(convertTemp(212, "F", "K")).toBeCloseTo(373.15);
        expect(convertTemp(0, "K", "C")).toBeCloseTo(-273.15);
        expect(convertTemp("", "C", "F")).toBe("");
        expect(convertDelta(10, "C", "F")).toBeCloseTo(18);
        expect(convertDelta(18, "F", "K")).toBeCloseTo(10);
        expect(convertDelta(10, "C", "K")).toBe(10);
    });

    it("shows temperatures in the user's unit, Celsius when the page gives none or an unknown one", () => {
        expect(userUnit()).toBe("C");
        expect(formatTemp(21.5, "C")).toBe("21.50 °C");
        setUserUnit("F");
        expect(formatTemp(21.5, "C")).toBe("70.70 °F");
        expect(formatDelta(-0.5, "C", 1, true)).toBe("-0.9 °F");
        expect(formatDelta(0.5, "C", 1, true)).toBe("+0.9 °F");
        setUserUnit("K");
        expect(formatTemp(32, "F", 1)).toBe("273.1 K");
        setUserUnit("X");
        expect(userUnit()).toBe("C");
    });
});

describe("the API", () => {
    it("reads a response's JSON, or nothing when it has none, and finds a DRF error's message", async () => {
        expect(await readJson(await jsonResponse({a: 1}))).toEqual({ok: true, data: {a: 1}});
        const broken = {ok: false, json: () => Promise.reject(new Error("not JSON"))} as unknown as Response;
        expect(await readJson(broken)).toEqual({ok: false, data: {}});
        expect(errorText({name: ["Too long."]}, "x")).toBe("Too long.");
        expect(errorText({detail: "Not found."}, "x")).toBe("Not found.");
        expect(errorText({}, "Could not save.")).toBe("Could not save.");
    });
});

describe("uploading", () => {
    it("uploads an image under its place in the folder chosen, without that folder's own name", () => {
        expect(uploadName(file("x_T.JPG", 1, "Flight 3/thermal/x_T.JPG"))).toBe("thermal/x_T.JPG");
        expect(uploadName(file("x_T.JPG"))).toBe("x_T.JPG");
    });

    it("splits uploads into batches by count and size, a large image going alone", () => {
        const f = (size: number) => ({name: "a.JPG", size});
        expect(batches([f(1), f(1), f(1)], 2, 100).map((b) => b.length)).toEqual([2, 1]);
        expect(batches([f(10), f(200), f(10)], 10, 100).map((b) => b.length)).toEqual([1, 1, 1]);
    });

    it("uploads only the JPEGs, sends each one's path, retries a failed request and reports what could not be sent", async () => {
        const files = [file("a.JPG", 10, "f/t/a.JPG"), file("notes.txt"), file("b.jpeg", 10)];
        let n = 0;
        const fetchFn = vi.fn((_url: string, opts: RequestInit) => {
            n++;
            if (n === 1) return jsonResponse({}, false);    // sent again
            return jsonResponse({saved: parts(opts).filter((p) => p[0] === "images").length});
        });
        const progress = vi.fn();
        const r = await uploadFiles(fetchFn, "/up", "tok", files, progress);
        expect(r).toEqual({saved: 2, failed: [], canceled: false});
        expect(parts(fetchFn.mock.calls[1][1])).toEqual(
            [["images", "a.JPG"], ["paths", "t/a.JPG"], ["images", "b.jpeg"], ["paths", "b.jpeg"]]);
        expect(fetchFn.mock.calls[1][1].headers).toEqual({"X-CSRFToken": "tok"});
        expect(progress).toHaveBeenLastCalledWith({sent: 2, total: 2, bytesSent: 20, bytesTotal: 20});

        const failing = vi.fn(() => Promise.reject(new Error("offline")));
        expect(await uploadFiles(failing, "/up", "tok", files))
            .toEqual({saved: 0, failed: [files[0], files[2]], canceled: false});
        expect(failing).toHaveBeenCalledTimes(3);
    });

    it("does not count a batch that failed as sent, so the progress stops short of the images missing", async () => {
        const files = Array.from({length: 12}, (_, i) => file(i + ".JPG"));
        const fetchFn = vi.fn((_url: string, opts: RequestInit) => {
            const names = parts(opts).filter((p) => p[0] === "images").map((p) => p[1]);
            if (names.includes("11.JPG")) return jsonResponse({}, false);
            return jsonResponse({saved: names.length});
        });
        const progress = vi.fn();
        const r = await uploadFiles(fetchFn, "/up", "tok", files, progress);
        expect(r.saved).toBe(10);
        expect(r.failed).toEqual(files.slice(10));
        expect(progress).toHaveBeenCalledTimes(1);
        expect(progress).toHaveBeenLastCalledWith({sent: 10, total: 12, bytesSent: 10, bytesTotal: 12});
    });

    it("gives up on a request that never answers after its timeout, sends it again, then counts its images as failed", async () => {
        vi.useFakeTimers();
        const files = [file("a.JPG", 1048576)];
        const timeout = batchTimeout(1048576);
        expect(timeout).toBe(30000 + 8192);
        const stalled = vi.fn((_url: string, _opts: RequestInit) => new Promise<Response>(() => {}));   // ignores its signal too
        let r = null;
        uploadFiles(stalled, "/up", "tok", files).then((v) => { r = v; });
        await ticks();
        expect(stalled).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(timeout);
        await ticks();
        expect(stalled.mock.calls[0][1].signal!.aborted).toBe(true);
        expect(stalled).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(timeout);
        await ticks();
        vi.advanceTimersByTime(timeout);
        await ticks();
        expect(stalled).toHaveBeenCalledTimes(3);
        expect(r).toEqual({saved: 0, failed: files, canceled: false});

        // A request that answers late, but before its timeout, is not sent again
        let answer: (r: Response) => void = () => {};
        const slow = vi.fn(() => new Promise<Response>((res) => { answer = res; }));
        r = null;
        uploadFiles(slow, "/up", "tok", files).then((v) => { r = v; });
        await ticks();
        vi.advanceTimersByTime(timeout - 1);
        answer(await jsonResponse({saved: 1}));
        await ticks();
        expect(slow).toHaveBeenCalledTimes(1);
        expect(r).toEqual({saved: 1, failed: [], canceled: false});
    });

    it("cancels an upload: aborts the requests in flight, sends no more, and returns every image not saved", async () => {
        const files = Array.from({length: 40}, (_, i) => file(i + ".JPG"));
        const fetchFn = vi.fn((_url: string, _opts: RequestInit) => new Promise<Response>(() => {}));
        const progress = vi.fn();
        const cancel = new AbortController();
        const upload = uploadFiles(fetchFn, "/up", "tok", files, progress, {signal: cancel.signal});
        await ticks();
        expect(fetchFn).toHaveBeenCalledTimes(3);           // the requests at once, a batch still waiting
        cancel.abort();
        const r = await upload;
        expect(fetchFn).toHaveBeenCalledTimes(3);
        expect(fetchFn.mock.calls.every((c) => c[1].signal!.aborted)).toBe(true);
        expect(r.canceled).toBe(true);
        expect(r.saved).toBe(0);
        expect(r.failed.length).toBe(40);
        expect(progress).not.toHaveBeenCalled();
    });
});
