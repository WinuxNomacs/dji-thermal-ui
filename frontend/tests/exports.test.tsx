import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cannotCarry, firstOffered, frameFormats, mosaicFormats, originalKind, shownFormat, startExport, viewAsked} from "../src/core/exports";
import {setUserUnit} from "../src/core/units";
import type {Conversion} from "../src/dataset/conversions";
import {FilesExport, filesExportBody, type FilesAsked} from "../src/dataset/export";
import {FrameExport, frameExportBody} from "../src/frame/export";
import {MosaicExport, mosaicExportBody} from "../src/viewer/export";
import {calls, click, key, server, ticks} from "./helpers";

const API = "/api/";
const A = "thermal/a_T.JPG", B = "thermal/b_T.JPG", C = "thermal/c_T.JPG";
const conversion = (id: number, more: Partial<Conversion> = {}): Conversion =>
    ({id, name: "Set " + id, settings: {unit: "C"}, status: "ready", finished_at: "2026-10-2" + id + "T10:00:00Z", ...more});
const ASKED: FilesAsked = {format: "png", which: "all", conversion: 9, palette: "", low: "", high: "", picture: "view", visual: false};

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const byId = (id: string) => document.getElementById(id)!;
const radio = (name: string, value: string) => $(`input[name=${name}][value="${value}"]`) as HTMLInputElement;
const offered = () => [...document.querySelectorAll<HTMLInputElement>("input[name=export-format]")]
    .map((r) => r.value + (r.disabled ? " (off)" : "") + (r.checked ? " *" : ""));
const sent = (fetchFn: ReturnType<typeof server>) =>
    JSON.parse(String(fetchFn.mock.calls.find((c) => c[1]?.method === "POST")![1]!.body));
function choose(el: HTMLInputElement | HTMLSelectElement, value?: string) {
    if (value !== undefined) el.value = value;
    if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) el.checked = !el.checked || el.type === "radio";
    el.dispatchEvent(new Event(el instanceof HTMLInputElement && el.type === "number" ? "input" : "change", {bubbles: true}));
}

let clicked: string[];
beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
    setUserUnit("C");
    clicked = [];
    // jsdom does not download: the address the browser would download from is kept
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.getAttribute("href") + (this.hasAttribute("download") ? " (download)" : ""));
    });
});
afterEach(() => {
    render(null, byId("root"));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the formats offered", () => {
    it("names the originals by their own format", () => {
        expect(originalKind([A, B])).toBe("R-JPG");
        expect(originalKind(["t/a.tif", "t/b.TIFF"])).toBe("TIFF");
        expect(frameFormats([A], "").find((f) => f.format === "original_private")!.label).toBe("Original (R-JPG, Private)");
    });

    it("says why R-JPEG and Original can't carry a normalized dataset or replaced values, pointing to TIFF", () => {
        expect(cannotCarry(null)).toBe("");
        expect(cannotCarry({normalize: false, replace_above: null})).toBe("");
        expect(cannotCarry({normalize: true})).toBe("They can't carry the temperatures a normalized dataset made: TIFF carries them.");
        expect(cannotCarry({replace_below: 0})).toBe("They can't carry replaced temperatures: TIFF carries them.");
        const formats = frameFormats([A], cannotCarry({normalize: true}));
        expect(formats.filter((f) => f.disabled).map((f) => f.format)).toEqual(["rjpeg", "rjpeg_private", "original", "original_private"]);
        expect(firstOffered(formats, "rjpeg")).toBe("png");
        expect(firstOffered(formats, "tiff_private")).toBe("tiff_private");
    });

    it("offers a mosaic as its GeoTIFF, private or not, or a PNG", () => {
        expect(mosaicFormats(false).map((f) => f.format)).toEqual(["png", "tiff", "tiff_private"]);
        expect(mosaicFormats(true)[0].text).toContain("visual mosaic");
        expect(shownFormat("The view.")).toEqual({format: "shown", label: "PNG as shown", text: "The view."});
    });

    it("sends the view as the server takes it, the isotherm only when there is one", () => {
        expect(viewAsked("magma", [18, 32], {gamma: 1.5, sharpen: 0.5}, "between:20,30", {mode: "stepped", width: 2.5, origin: -17.5}))
            .toEqual({palette: "magma", range: [18, 32], gamma: 1.5, sharpen: 0.5, bands: "stepped", band_width: 2.5, band_origin: -17.5,
                      isotherm: "between:20,30"});
        expect(viewAsked("", null, null, "")).toEqual({palette: null, range: null});
    });
});

describe("an export asked for", () => {
    it("is downloaded from the address the server gives", async () => {
        const fetchFn = server({["POST /api/datasets/5/exports"]: {url: "/api/exports/ab"}});
        vi.stubGlobal("fetch", fetchFn);
        expect(await startExport("/api/datasets/5/exports", {format: "tiff"})).toBe("");
        expect(sent(fetchFn)).toEqual({format: "tiff"});
        expect(fetchFn.mock.calls[0][1]!.headers).toMatchObject({"X-CSRFToken": "tok"});
        expect(clicked).toEqual(["/api/exports/ab (download)"]);
        expect(document.querySelector("a[download]")).toBeNull();
    });

    it("says why when the server refuses it, and downloads nothing", async () => {
        vi.stubGlobal("fetch", server({["POST /api/x"]: () => Promise.resolve(new Response(JSON.stringify({error: "No frames to export"}), {status: 400}))}));
        expect(await startExport("/api/x", {})).toBe("No frames to export");
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
        expect(await startExport("/api/x", {})).toBe("Could not reach the server.");
        expect(clicked).toEqual([]);
    });
});

describe("the Files tab's export", () => {
    const P = {shown: [A], all: [A, B], conversions: [conversion(9, {settings: {unit: "F"}})]};

    it("sends the frames shown by name, and none for all of them", () => {
        expect(filesExportBody(P, {...ASKED, which: "shown"})).toMatchObject({frames: [A]});
        expect(filesExportBody(P, ASKED)).not.toHaveProperty("frames");
        expect(filesExportBody({...P, shown: [A, B]}, {...ASKED, which: "shown"})).not.toHaveProperty("frames");
        expect(filesExportBody({...P, shown: []}, {...ASKED, which: "shown"})).toBe("No frames to export.");
    });

    it("sends a range typed in the user's unit in the unit the frames are measured in, or none for automatic", () => {
        expect(filesExportBody(P, ASKED)).toEqual({format: "png", conversion: 9, view: {palette: null, range: null}});
        expect(filesExportBody(P, {...ASKED, low: "0", high: "100", palette: "magma"}))
            .toEqual({format: "png", conversion: 9, view: {palette: "magma", range: [32, 212]}});
        expect(filesExportBody(P, {...ASKED, conversion: null, low: "0", high: "10"})).toMatchObject({conversion: null, view: {range: [0, 10]}});
        expect(filesExportBody(P, {...ASKED, low: "5"})).toBe("Type both ends of the range, or neither.");
        expect(filesExportBody(P, {...ASKED, low: "5", high: "5"})).toBe("The range's maximum must be above its minimum.");
    });

    it("asks a view only for a picture coloured as one, and the visual images only with the originals", () => {
        expect(filesExportBody(P, {...ASKED, format: "tiff", low: "5"})).toEqual({format: "tiff", conversion: 9});
        expect(filesExportBody(P, {...ASKED, format: "rjpeg", picture: "original"})).toEqual({format: "rjpeg", conversion: 9, picture: "original"});
        expect(filesExportBody(P, {...ASKED, format: "rjpeg_private"})).toMatchObject({picture: "view", view: {range: null}});
        expect(filesExportBody(P, {...ASKED, format: "original", visual: true})).toEqual({format: "original", conversion: 9, visual: true});
        expect(filesExportBody(P, {...ASKED, format: "tiff", visual: true})).not.toHaveProperty("visual");
    });

    async function openFiles(conversions: Conversion[], preferences: unknown = {palette: "dji_ironred",
        view_palettes: [{key: "dji_ironred", label: "DJI ironred"}, {key: "magma", label: "Magma"}]}) {
        const fetchFn = server({[API + "preferences"]: preferences, ["POST " + API + "datasets/5/exports"]: {url: "/api/exports/cd"}});
        vi.stubGlobal("fetch", fetchFn);
        const onClose = vi.fn();
        render(<FilesExport api={API} datasetId={5} shown={[A]} all={[A, B, C]} conversions={conversions} hasVisual={true}
                            onClose={onClose}/>, byId("root"));
        await ticks();
        return {fetchFn, onClose};
    }

    it("starts with the frames shown, the newest dataset and the preferred palette, and exports them", async () => {
        const {fetchFn, onClose} = await openFiles([conversion(7), conversion(8), conversion(6, {status: "failed"})]);
        expect(radio("export-which", "shown").checked).toBe(true);
        expect(byId("export-dialog").textContent).toContain("One frame, as a file.");
        expect([...($("#export-conversion") as HTMLSelectElement).options].map((o) => o.textContent))
            .toEqual(["The dataset “Set 7”", "The dataset “Set 8”", "The frames' own values"]);
        expect(($("#export-conversion") as HTMLSelectElement).value).toBe("8");
        expect(($("#export-palette") as HTMLSelectElement).value).toBe("dji_ironred");
        choose(radio("export-which", "all"));
        await ticks();
        expect(byId("export-dialog").textContent).toContain("3 frames, as a zip.");
        choose($("#export-palette") as HTMLSelectElement, "magma");
        choose($("#export-low") as HTMLInputElement, "10");
        choose($("#export-high") as HTMLInputElement, "40");
        await ticks();
        click(byId("export-save"));
        await ticks();
        expect(sent(fetchFn)).toEqual({format: "png", conversion: 8, view: {palette: "magma", range: [10, 40]}});
        expect(clicked).toEqual(["/api/exports/cd (download)"]);
        expect(onClose).toHaveBeenCalled();
    });

    it("measures with the frames' own values when the flight has no dataset, and keeps a refusal in the dialog", async () => {
        const {fetchFn, onClose} = await openFiles([], {palette: "", view_palettes: []});
        expect(($("#export-conversion") as HTMLSelectElement).value).toBe("");
        expect(($("#export-palette") as HTMLSelectElement).value).toBe("");
        expect(($("#export-palette") as HTMLSelectElement).options[0].textContent).toBe("The dataset's palette (Ironbow when it has none)");
        choose($("#export-low") as HTMLInputElement, "10");
        await ticks();
        click(byId("export-save"));
        await ticks();
        expect(byId("export-dialog").textContent).toContain("Type both ends of the range, or neither.");
        expect(calls(fetchFn)).not.toContain("POST " + API + "datasets/5/exports");
        expect(onClose).not.toHaveBeenCalled();
    });

    it("turns R-JPEG and Original off for a normalized dataset, and back on for the frames' own values", async () => {
        await openFiles([conversion(9, {settings: {unit: "C", normalize: true}})]);
        choose(radio("export-format", "tiff"));
        await ticks();
        expect(offered()).toEqual(["png", "tiff *", "tiff_private", "rjpeg (off)", "rjpeg_private (off)", "original (off)",
                                   "original_private (off)"]);
        expect(byId("export-dialog").textContent).toContain("a normalized dataset made: TIFF carries them.");
        choose($("#export-conversion") as HTMLSelectElement, "");
        await ticks();
        choose(radio("export-format", "original"));
        await ticks();
        expect(offered()).toContain("original *");
        expect($("#export-conversion")).toBeNull();
        expect($("#export-palette")).toBeNull();
        expect($("input[name=export-visual]")).not.toBeNull();
        choose(radio("export-format", "rjpeg"));
        await ticks();
        expect(radio("export-picture", "view").checked).toBe(true);
        expect($("#export-palette")).not.toBeNull();
        choose(radio("export-picture", "original"));
        await ticks();
        expect($("#export-palette")).toBeNull();
    });
});

describe("the frame explorer's export", () => {
    const VIEW = viewAsked("magma", [18, 32], {gamma: 1, sharpen: 0}, "");
    const props = {api: API, datasetId: 5, conversion: 9, frame: A, settings: null, view: VIEW, hasVisual: true,
                   asShown: async () => "", onClose: () => undefined};

    it("sends this frame with the conversion, as converted or with the parameters changed", () => {
        const p = {...props, changes: {emissivity: 0.98}};
        expect(frameExportBody(p, "tiff", false, "view", false)).toEqual({format: "tiff", frames: [A], conversion: 9, changes: {}});
        expect(frameExportBody(p, "png", true, "view", false))
            .toEqual({format: "png", frames: [A], conversion: 9, changes: {emissivity: 0.98}, view: VIEW});
        expect(frameExportBody(p, "rjpeg", false, "original", false)).toMatchObject({picture: "original"});
        expect(frameExportBody(p, "rjpeg", false, "original", false)).not.toHaveProperty("view");
        expect(frameExportBody(p, "original_private", false, "view", true)).toMatchObject({visual: true});
    });

    it("asks how it is measured only with parameters changed, and closes once it downloads", async () => {
        const fetchFn = server({["POST " + API + "datasets/5/exports"]: {url: "/api/exports/ef"}});
        vi.stubGlobal("fetch", fetchFn);
        const onClose = vi.fn();
        render(<FrameExport {...props} changes={{}} onClose={onClose}/>, byId("root"));
        await ticks();
        expect($("input[name=export-changes]")).toBeNull();
        render(<FrameExport {...props} changes={{emissivity: 0.98}} onClose={onClose}/>, byId("root"));
        await ticks();
        // As shown is the picture the page draws: how it is measured is the page's
        expect(radio("export-format", "shown").checked).toBe(true);
        expect($("input[name=export-changes]")).toBeNull();
        choose(radio("export-format", "png"));
        await ticks();
        expect(radio("export-changes", "").checked).toBe(true);
        choose(radio("export-changes", "1"));
        await ticks();
        click(byId("export-save"));
        await ticks();
        expect(sent(fetchFn)).toEqual({format: "png", frames: [A], conversion: 9, changes: {emissivity: 0.98}, view: VIEW});
        expect(onClose).toHaveBeenCalled();
    });

    it("closes with Escape or a click beside it, without exporting", async () => {
        const fetchFn = server({});
        vi.stubGlobal("fetch", fetchFn);
        const onClose = vi.fn();
        render(<FrameExport {...props} changes={{}} onClose={onClose}/>, byId("root"));
        await ticks();
        key(document.body, "Escape");
        click(byId("export-dialog"));
        click(byId("export-cancel"));
        expect(onClose).toHaveBeenCalledTimes(3);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it("saves the frame as shown through the page, without asking the server, and says why it couldn't", async () => {
        const fetchFn = server({});
        vi.stubGlobal("fetch", fetchFn);
        const asShown = vi.fn().mockResolvedValueOnce("Could not make the image.").mockResolvedValueOnce("");
        const onClose = vi.fn();
        render(<FrameExport {...props} changes={{}} asShown={asShown} onClose={onClose}/>, byId("root"));
        await ticks();
        expect(offered()[0]).toBe("shown *");
        click(byId("export-save"));
        await ticks();
        expect(byId("export-dialog").textContent).toContain("Could not make the image.");
        expect(onClose).not.toHaveBeenCalled();
        click(byId("export-save"));
        await ticks();
        expect(asShown).toHaveBeenCalledTimes(2);
        expect(onClose).toHaveBeenCalled();
        expect(fetchFn).not.toHaveBeenCalled();
    });
});

describe("the viewer's export", () => {
    const VIEW = viewAsked("magma", [18, 32], {gamma: 1, sharpen: 0}, "between:20,30");

    it("sends the view and the correction on a temperature tab, nothing more on the visual one", () => {
        const p = {base: "/api/conversions/9", tab: "harmonized", label: "Harmonized", view: VIEW, correction: {emissivity: 0.9},
                   asShown: async () => "", onClose: () => undefined};
        expect(mosaicExportBody(p, "png")).toEqual({format: "png", view: VIEW, correction: {emissivity: 0.9}});
        expect(mosaicExportBody({...p, tab: "visual", view: null}, "tiff_private")).toEqual({format: "tiff_private"});
    });

    it("exports the tab shown, as shown by default", async () => {
        const fetchFn = server({["POST /api/conversions/9/mosaics/visual/exports"]: {url: "/api/exports/01"}});
        vi.stubGlobal("fetch", fetchFn);
        render(<MosaicExport base="/api/conversions/9" tab="visual" label="Visual" view={null} correction={{}}
                             asShown={async () => ""} onClose={() => undefined}/>, byId("root"));
        await ticks();
        expect(offered()).toEqual(["shown *", "png", "tiff", "tiff_private"]);
        expect(byId("export-dialog").textContent).toContain("The “Visual” mosaic, as shown or whole");
        choose(radio("export-format", "tiff"));
        await ticks();
        click(byId("export-save"));
        await ticks();
        expect(sent(fetchFn)).toEqual({format: "tiff"});
        expect(clicked).toEqual(["/api/exports/01 (download)"]);
    });
});
