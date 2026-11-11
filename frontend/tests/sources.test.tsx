import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {Geometry} from "../src/measure/measure";
import {emptyText, frameName, fromVisual, hasSources, ringToVisual, shareText, type SourceFrame, type Sources, sourcesUrl,
        stepped, svgPoints, toVisual, type VisualPair} from "../src/sources/sources";
import {type SourceGroup, SourcesWindow} from "../src/sources/window";
import {click, key, server, ticks, valuesResponse} from "./helpers";

const byId = (id: string) => document.getElementById(id)!;
const SPOT = {type: "Point" as const, coordinates: [10, 50] as [number, number]};
const AREA = {type: "Polygon" as const, coordinates: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50]]] as [number, number][][]};

const spot = (frames: SourceFrame[], models = true): Sources =>
    ({kind: "Point", geometry: SPOT, models, frames, reason: null, point: {valid: true, temperature: 21.5}});
const FRAMES: SourceFrame[] = [
    {frame: "100MEDIA/DJI_0001_T.JPG", used: true, view_angle: 5, time: "2026:10:12 18:29:50", pixel: [3, 4]},
    {frame: "100MEDIA/DJI_0003_T.JPG", used: false, view_angle: 12.5, time: "2026:10:12 18:29:52", pixel: [7, 1]},
];

function group(res: Sources | null | undefined, extra: Partial<SourceGroup> = {}): SourceGroup {
    return {title: "", res, unit: "C", colouring: {colors: []}, values: (f) => "/values?frame=" + f, curve: () => "",
            href: (f) => "/conversion/9/frame?frame=" + f, ...extra};
}

// A visual frame 4 times the thermal one's pixels, moved by (100, 50), with a little perspective
const PAIR: VisualPair = {frame: "100MEDIA/DJI_0001_V.JPG", width: 40, height: 32,
                          homography: [4, 0, 100, 0, 4, 50, 0.001, 0, 1]};

const win = () => document.querySelector(".sources-window") as HTMLElement;
const current = () => win().querySelector(".sources-list button.active")!.getAttribute("data-frame");

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal("fetch", server({"/values?frame=100MEDIA/DJI_0001_T.JPG": valuesResponse(10, 8),
                                   "/values?frame=100MEDIA/DJI_0003_T.JPG": valuesResponse(10, 8)}));
});
afterEach(() => {
    render(null, byId("root"));
    vi.unstubAllGlobals();
});

describe("the source frames", () => {
    it("are asked for a spot, an area or a Delta T of a mosaic tab, not a line", () => {
        const line: Geometry = {type: "LineString", coordinates: [[1, 2], [3, 4]]};
        expect(sourcesUrl("/api/", 9, "harmonized")).toBe("/api/conversions/9/mosaics/harmonized/sources");
        expect([hasSources(SPOT), hasSources(AREA), hasSources(line), hasSources(line, {kind: "delta"}),
                hasSources(null)]).toEqual([true, true, false, true, false]);
    });

    it("are named by their file, with the share of an area each saw and the mosaic took", () => {
        expect(frameName("100MEDIA/DJI_0001_T.JPG")).toBe("DJI_0001_T.JPG");
        expect(shareText({frame: "a", used: true, view_angle: 2, share: 0.84, used_share: 0.523})).toBe("saw 84% · mosaic 52%");
        expect(shareText({frame: "a", used: false, view_angle: 2, share: 0.004, used_share: 0})).toBe("saw <1%");
        expect(shareText({frame: "a", used: true, view_angle: 2, share: null, used_share: 1})).toBe("mosaic 100%");
        expect(shareText(FRAMES[0])).toBe("");
    });

    it("are stepped through within the list, and their pixels drawn at their centres", () => {
        expect([stepped(0, -1, 3), stepped(0, 1, 3), stepped(2, 1, 3)]).toEqual([0, 1, 2]);
        expect(svgPoints([[0, 0], [9, 7.25]])).toBe("0.5,0.5 9.5,7.8");
    });

    it("are found in their visual pair through its homography, and back", () => {
        const [x, y] = toVisual(PAIR, [10, 20])!;
        expect([x, y]).toEqual([140 / 1.01, 130 / 1.01]);
        const back = fromVisual(PAIR, [x, y])!;
        expect(back[0]).toBeCloseTo(10, 9);
        expect(back[1]).toBeCloseTo(20, 9);
        expect(toVisual(PAIR, [-2000, 0])).toBeNull();
        expect(ringToVisual(PAIR, [[0, 0], [-2000, 0], [1, 0]])).toEqual([[100, 50], [104 / 1.001, 50 / 1.001]]);
    });

    it("say why none is listed", () => {
        expect(emptyText({...spot([]), reason: "outside_raster"})).toBe("Outside the mosaic.");
        expect(emptyText(spot([]))).toBe("No frame is known for this spot.");
        expect(emptyText({...spot([]), reason: "not_recorded"})).toContain("came without its task's cameras");
        expect(emptyText({...spot([]), reason: "no_cameras", error: "WebODM couldn't give the task's cameras: gone."}))
            .toBe("WebODM couldn't give the task's cameras: gone. Try again once WebODM can be reached.");
        expect(emptyText({...spot([]), kind: "Polygon", geometry: AREA})).toBe("No frame is known for this area.");
        expect(emptyText({...spot([]), kind: "LineString"})).toBe("No frame is known for this Delta T.");
    });
});

describe("the source frames window", () => {
    it("shows the frame the mosaic used first with the spot marked, and the others in a list", async () => {
        render(<SourcesWindow name="t" groups={[group(spot(FRAMES))]} onClose={() => undefined}/>, byId("root"));
        await ticks();
        expect(win().querySelector(".sources-what")!.textContent).toBe("Spot · 2 frames");
        expect(win().querySelector("canvas")!.dataset.values).toBe("/values?frame=100MEDIA/DJI_0001_T.JPG");
        const mark = win().querySelector(".frame-mark") as HTMLElement;
        expect([mark.style.left, mark.style.top]).toEqual(["35%", "56.25%"]);
        expect(win().querySelector("a")!.getAttribute("href")).toBe("/conversion/9/frame?frame=100MEDIA/DJI_0001_T.JPG");
        expect(win().textContent).toContain("The mosaic here: 21.50 °C");
        const rows = Array.from(win().querySelectorAll(".sources-list li")).map((li) => li.textContent);
        expect(rows[0]).toContain("DJI_0001_T.JPGin the mosaic");
        expect(rows[0]).toContain("5° off nadir");
        expect(rows[1]).not.toContain("in the mosaic");
        expect(win().textContent).not.toContain("build the mosaics again");
        expect(document.activeElement).toBe(win());
    });

    it("shows a frame's visual pair on its switch, the spot where the visual camera saw it", async () => {
        const frames = [{...FRAMES[0], visual: {...PAIR, homography: [4, 0, 0, 0, 4, 0, 0, 0, 1]}}, FRAMES[1]];
        render(<SourcesWindow name="t" visual groups={[group(spot(frames), {visual: (f) => "/visual?frame=" + f})]}
                              onClose={() => undefined}/>, byId("root"));
        await ticks();
        const img = win().querySelector(".frame-image.visual img") as HTMLImageElement;
        expect(img.getAttribute("src")).toBe("/visual?frame=100MEDIA/DJI_0001_T.JPG");
        expect(win().querySelector("canvas")).toBeNull();
        // The thermal pixel (3, 4) is the visual (12, 16): its centre 12.5 of 40 across, 16.5 of 32 down
        const mark = win().querySelector(".frame-mark") as HTMLElement;
        expect([mark.style.left, mark.style.top]).toEqual(["31.25%", "51.56%"]);
        // A frame without a pair shows its thermal frame, the switch off
        key(win(), "ArrowRight");
        await ticks();
        expect(win().querySelector("canvas")).not.toBeNull();
        expect((win().querySelector('.sources-camera button[name="visual"]') as HTMLButtonElement).disabled).toBe(true);
        key(win(), "ArrowLeft");
        await ticks();
        click(win().querySelector('.sources-camera button[name="thermal"]')!);
        await ticks();
        expect(win().querySelector("canvas")!.dataset.values).toBe("/values?frame=100MEDIA/DJI_0001_T.JPG");
        expect(win().querySelector('.sources-camera button[name="thermal"]')!.getAttribute("aria-pressed")).toBe("true");
    });

    it("has no camera switch where the frames have no visual pairs to show", async () => {
        render(<SourcesWindow name="t" groups={[group(spot(FRAMES))]} onClose={() => undefined}/>, byId("root"));
        await ticks();
        expect(win().querySelector(".sources-camera")).toBeNull();
    });

    it("steps through the frames with its buttons, the arrow keys and the list", async () => {
        render(<SourcesWindow name="t" groups={[group(spot(FRAMES))]} onClose={() => undefined}/>, byId("root"));
        await ticks();
        expect((win().querySelector('button[name="previous"]') as HTMLButtonElement).disabled).toBe(true);
        click(win().querySelector('button[name="next"]')!);
        await ticks();
        expect(current()).toBe("100MEDIA/DJI_0003_T.JPG");
        expect(win().querySelector(".sources-count")!.textContent).toBe("2 of 2");
        expect(win().querySelector("canvas")!.dataset.values).toBe("/values?frame=100MEDIA/DJI_0003_T.JPG");
        key(win(), "ArrowRight");
        await ticks();
        expect(current()).toBe("100MEDIA/DJI_0003_T.JPG");
        key(win(), "ArrowLeft");
        await ticks();
        expect(current()).toBe("100MEDIA/DJI_0001_T.JPG");
        click(win().querySelectorAll(".sources-list button")[1]);
        await ticks();
        expect(current()).toBe("100MEDIA/DJI_0003_T.JPG");
    });

    it("outlines an area in each frame, with the shares", async () => {
        const res: Sources = {kind: "Polygon", geometry: AREA, models: true, reason: null, frames: [
            {...FRAMES[0], pixel: undefined, share: 0.8, used_share: 0.48, outline: [[[1, 1], [5, 1], [5, 4]]]}]};
        render(<SourcesWindow name="t" groups={[group(res)]} onClose={() => undefined}/>, byId("root"));
        await ticks();
        expect(win().querySelector(".frame-mark")).toBeNull();
        expect(win().querySelector(".frame-outline")!.getAttribute("viewBox")).toBe("0 0 10 8");
        expect(win().querySelector(".frame-outline polygon")!.getAttribute("points")).toBe("1.5,1.5 5.5,1.5 5.5,4.5");
        expect(win().querySelector(".sources-list")!.textContent).toContain("saw 80% · mosaic 48%");
        expect(win().querySelector(".sources-what")!.textContent).toBe("Area · 1 frame");
    });

    it("says when the mosaic lists only the frames it used, and when the spot is not known", async () => {
        render(<SourcesWindow name="t" groups={[group(spot([{...FRAMES[0], pixel: null}], false))]}
                              onClose={() => undefined}/>, byId("root"));
        await ticks();
        expect(win().textContent).toContain("build the mosaics again to list every frame that saw it");
        expect(win().textContent).toContain("The spot is not marked");
        expect(win().querySelector(".frame-mark")).toBeNull();
    });

    it("says while the frames are asked, when they could not be, and when there are none", () => {
        render(<SourcesWindow name="t" groups={[group(undefined)]} onClose={() => undefined}/>, byId("root"));
        expect(win().textContent).toContain("Finding the frames…");
        render(<SourcesWindow name="t" groups={[group(null, {error: "Not found."})]} onClose={() => undefined}/>, byId("root"));
        expect(win().textContent).toContain("Not found.");
        render(<SourcesWindow name="t" groups={[group({...spot([]), reason: "outside_raster"})]} onClose={() => undefined}/>,
               byId("root"));
        expect(win().textContent).toContain("Outside the mosaic.");
    });

    it("shows each mosaic's frames of a difference in turn", async () => {
        const b = spot([FRAMES[1]]);
        render(<SourcesWindow name="t" onClose={() => undefined} groups={[group(spot(FRAMES), {title: "A · Roof"}),
                                                                       group(b, {title: "B · Field"})]}/>, byId("root"));
        await ticks();
        const tabs = win().querySelectorAll(".sources-groups button");
        expect(Array.from(tabs).map((x) => x.textContent)).toEqual(["A · Roof", "B · Field"]);
        click(tabs[1]);
        await ticks();
        expect(current()).toBe("100MEDIA/DJI_0003_T.JPG");
    });

    it("is closed by its button or Esc, and moved by its title within the page", async () => {
        const close = vi.fn();
        render(<SourcesWindow name="moved" groups={[group(spot(FRAMES))]} onClose={close}/>, byId("root"));
        await ticks();
        const head = win().querySelector(".sources-head")!;
        head.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, clientX: 20, clientY: 90}));
        document.dispatchEvent(new MouseEvent("pointermove", {clientX: 120, clientY: 190}));
        document.dispatchEvent(new MouseEvent("pointerup", {}));
        await ticks();
        // (jsdom gives the window no size: it is held at its corner)
        expect([win().style.left, win().style.top]).toEqual(["100px", "100px"]);
        document.dispatchEvent(new MouseEvent("pointermove", {clientX: 500, clientY: 500}));
        await ticks();
        expect(win().style.left).toBe("100px");
        // Kept where it was moved to when it opens again
        render(null, byId("root"));
        render(<SourcesWindow name="moved" groups={[group(spot(FRAMES))]} onClose={close}/>, byId("root"));
        expect(win().style.left).toBe("100px");
        click(win().querySelector('button[name="close"]')!);
        key(win(), "Escape");
        expect(close).toHaveBeenCalledTimes(2);
    });
});
