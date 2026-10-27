import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import {autoRange, autoReach, type Comparable, compareQuery, differenceTileUrl, firstTab, frameImageUrl, mosaicGroups,
        readCompare} from "../src/compare/compare";
import {ComparePage} from "../src/compare/compare-page";
import {DifferenceReadout, Picked} from "../src/compare/pane";
import {type Mosaics} from "../src/viewer/viewer-page";
import {calls, click, key, server, ticks} from "./helpers";

const API = "/api/";
const BOUNDS = [10, 50, 10.01, 50.01];
const LIST: Comparable[] = [
    {id: 9, name: "Nadir", dataset: 5, dataset_name: "Roof", unit: "C", tabs: ["as_converted", "harmonized"]},
    {id: 12, name: "Other", dataset: 6, dataset_name: "Field", unit: "F", tabs: ["as_converted"]},
];
const PALETTES = [{key: "ironred", label: "Iron red", color_map: [0x000000, 0xff0000]},
                  {key: "magma", label: "Magma", color_map: [0x000004, 0xfcfdbf]}];
const mosaics = (name: string, unit: string, tabs: [string, number[]][]): Mosaics => ({
    name, status: "ready", mosaic_status: "ready", unit, default_palette: "ironred", palettes: PALETTES,
    tabs: tabs.map(([tab, percentiles]) => ({tab, stats: {percentiles}, bounds: BOUNDS, maxzoom: 20})),
});
const NADIR = mosaics("Nadir", "C", [["as_converted", [17.04, 27.96]], ["harmonized", [18, 26]]]);
const OTHER = mosaics("Other", "F", [["as_converted", [60, 90]]]);
const DIFF_PALETTES = [{key: "rdbu", label: "Red–blue", color_map: [0x0000ff, 0xff0000]}];
const DIFF = {unit: "C", bounds: BOUNDS, range: [-1.23, 1.23], palettes: DIFF_PALETTES};

const $ = (sel: string) => document.querySelector(sel) as HTMLInputElement | null;
const byId = (id: string) => document.getElementById(id)!;
const choose = (el: Element, value: string) => {
    (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new Event("change", {bubbles: true}));
};

function routes(extra: Record<string, unknown> = {}) {
    return {
        [API + "conversions/9/comparable"]: [LIST],       // a list of one answer: the list
        [API + "conversions/9/mosaics"]: NADIR,
        [API + "conversions/12/mosaics"]: OTHER,
        ...extra,
    };
}

async function open(fetchFn: ReturnType<typeof server>, otherId = 9) {
    vi.stubGlobal("fetch", fetchFn);
    render(<ComparePage api={API} publicUrl="/" id={9} otherId={otherId} name="Nadir" datasetName="Roof" basemaps={[]}/>,
           byId("root"));
    await ticks(40);
}

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    history.replaceState(null, "", "/conversion/9/compare");
});
afterEach(() => {
    render(null, byId("root"));
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
    setUserUnit("C");
});

describe("the compare helpers", () => {
    it("read the view from the URL and write it back, the split kept between its limits", () => {
        expect(readCompare("?b=12&a=3&a_tab=harmonized&b_tab=as_converted&diff=b&split=95")).toEqual(
            {a: 3, b: 12, a_tab: "harmonized", b_tab: "as_converted", diff: "b", split: 80});
        expect(readCompare("?a=x&diff=c&split=no")).toEqual({});
        expect(compareQuery({a: 9, b: 12, a_tab: "as_converted", b_tab: "as_converted", diff: "", split: 50}, 9))
            .toBe("?b=12&a_tab=as_converted&b_tab=as_converted");
        expect(compareQuery({a: 3, b: 9, a_tab: "harmonized", b_tab: "as_converted", diff: "a", split: 35}, 9))
            .toBe("?b=9&a=3&a_tab=harmonized&b_tab=as_converted&diff=a&split=35");
    });

    it("group the mosaics by dataset and start a pane on the tab wanted, else another than the other pane's", () => {
        expect(mosaicGroups(LIST).map((g) => [g.name, g.items.map((c) => c.id)])).toEqual([["Roof", [9]], ["Field", [12]]]);
        expect(firstTab(LIST[0], "harmonized")).toBe("harmonized");
        expect(firstTab(LIST[0], "view_angle", "as_converted")).toBe("harmonized");
        expect(firstTab(LIST[1], undefined, "as_converted")).toBe("as_converted");
    });

    it("give the Auto range that holds both mosaics, in the user's unit whatever their own", () => {
        expect(autoRange([{tab: NADIR.tabs![0], unit: "C"}])).toEqual([17, 28]);
        expect(autoRange([{tab: NADIR.tabs![0], unit: "C"}, {tab: OTHER.tabs![0], unit: "F"}])).toEqual([15.5, 32.3]);
        expect(autoRange([])).toEqual([0, 1]);
    });

    it("give the difference's reach in the user's unit, and its tiles' range in A's", () => {
        expect(autoReach({unit: "C", range: [-1.23, 1.23]})).toBe(1.3);
        expect(autoReach({unit: "C", range: null})).toBe(1);
        setUserUnit("F");
        expect(autoReach({unit: "C", range: [-1.23, 1.23]})).toBe(2.3);
        expect(differenceTileUrl(API, 9, "as_converted", 12, "as_converted", {palette: "rdbu", reach: 1.8}, "C")).toBe(
            API + "conversions/9/mosaics/as_converted/difference/tiles/{z}/{x}/{y}?b=12&b_tab=as_converted&color_map=rdbu&rescale=-1,1");
    });

    it("draw a frame in the range shown, in its conversion's unit", () => {
        setUserUnit("F");
        expect(frameImageUrl(API, 9, "a.JPG", {palette: "magma", range: [32, 212], adjust: {gamma: 2, equalize: false, sharpen: 0}}, "C"))
            .toBe(API + "conversions/9/frame/image.png?frame=a.JPG&color_map=magma&rescale=0,100&gamma=2");
    });
});

describe("the compare parts", () => {
    it("read both mosaics under the cursor and their difference in the user's unit", () => {
        render(<DifferenceReadout a={{valid: true, temperature: 20}} b={{valid: true, temperature: 70}} aUnit="C" bUnit="F"/>, byId("root"));
        expect(byId("root").textContent).toBe("A20.00 °CB21.11 °CA − B-1.11 °C");
        render(<DifferenceReadout a={{valid: false, reason: "outside_raster"}} b={null} aUnit="C" bUnit="F"/>, byId("root"));
        expect(byId("root").textContent).toBe("Aoutside the mosaicBno dataA − Bno data");
    });

    it("show a picked point's frame with a link to it, or why there is none", () => {
        const close = vi.fn();
        render(<Picked onClose={close} frames={[
            {title: "A · Roof · Nadir", unit: "C", image: "/img.png", href: "/conversion/9/frame?frame=a.JPG",
             point: {valid: true, temperature: 21.5, frame: "a.JPG", frame_pixel: [3, 4]}},
            {title: "B · Field · Other", unit: "F", image: "", href: "", point: {valid: true, temperature: 70, frame: null}},
        ]}/>, byId("root"));
        const root = byId("root");
        expect(root.querySelector("img")!.getAttribute("src")).toBe("/img.png");
        expect(root.querySelector("a")!.getAttribute("href")).toBe("/conversion/9/frame?frame=a.JPG");
        expect(root.textContent).toContain("21.50 °C");
        expect(root.textContent).toContain("No frame is known for this point.");
        click(root.querySelector('button[name="close"]')!);
        expect(close).toHaveBeenCalled();
    });
});

describe("the compare page", () => {
    it("compares the conversion with its other tab when no other is given, with one range for both", async () => {
        const fetchFn = server(routes());
        await open(fetchFn);
        expect($("#pane-a select[name=mosaic]")!.value).toBe("9:as_converted");
        expect($("#pane-b select[name=mosaic]")!.value).toBe("9:harmonized");
        expect(Array.from(document.querySelectorAll("#pane-a optgroup")).map((g) => g.getAttribute("label"))).toEqual(["Roof", "Field"]);
        expect($("#shared input[name=min]")!.value).toBe("17");
        expect($("#shared input[name=max]")!.value).toBe("28");
        expect($("#pane-a .compare-style")).toBeNull();
        expect(location.search).toBe("?b=9&a_tab=as_converted&b_tab=harmonized");
        expect(byId("status" as string)).toBeNull();
        expect(calls(fetchFn)).toEqual(["GET " + API + "conversions/9/comparable", "GET " + API + "conversions/9/mosaics"]);
    });

    it("opens the other conversion and the view a link gives", async () => {
        history.replaceState(null, "", "/conversion/9/compare?b=12&a_tab=harmonized&split=30");
        await open(server(routes()), 12);
        expect($("#pane-a select[name=mosaic]")!.value).toBe("9:harmonized");
        expect($("#pane-b select[name=mosaic]")!.value).toBe("12:as_converted");
        expect(byId("pane-a").style.flexBasis).toBe("30%");
        expect(location.search).toBe("?b=12&a_tab=harmonized&b_tab=as_converted&split=30");
    });

    it("shows the difference in one pane at a time, with its own palette and reach", async () => {
        const fetchFn = server(routes({[API + "conversions/9/mosaics/as_converted/difference?b=12&b_tab=as_converted"]: DIFF}));
        await open(fetchFn, 12);
        choose($("#pane-b select[name=show]")!, "diff");
        await ticks(40);
        expect($("#pane-b input[name=reach]")!.value).toBe("1.3");
        expect(Array.from(document.querySelectorAll("#pane-b select[name=palette] option")).map((o) => o.textContent)).toEqual(["Red–blue"]);
        expect($("#shared input[name=min]")).not.toBeNull();     // A still shows its mosaic
        expect(location.search).toBe("?b=12&a_tab=as_converted&b_tab=as_converted&diff=b");
        // A difference in A takes it from B
        choose($("#pane-a select[name=show]")!, "diff");
        await ticks(40);
        expect($("#pane-a select[name=show]")!.value).toBe("diff");
        expect($("#pane-b select[name=show]")!.value).toBe("mosaic");
        expect($("#pane-a input[name=reach]")!.value).toBe("1.3");
        // Asked once for the pair
        expect(calls(fetchFn).filter((c) => c.includes("/difference")).length).toBe(1);
        const reach = $("#pane-a input[name=reach]")!;
        reach.value = "0";
        reach.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect(byId("pane-a").querySelector(".text-danger")!.textContent).toBe("The difference shown must be above 0");
    });

    it("says when the mosaics do not overlap", async () => {
        await open(server(routes({[API + "conversions/9/mosaics/as_converted/difference?b=9&b_tab=harmonized"]:
            {unit: "C", bounds: null, range: null, palettes: DIFF_PALETTES}})));
        choose($("#pane-b select[name=show]")!, "diff");
        await ticks(40);
        expect(byId("pane-b").querySelector(".compare-note")!.textContent).toBe("These mosaics do not overlap.");
        // Above the map, which stays as it was, with no colour scale
        expect(byId("pane-b").querySelector(".compare-note + .compare-map .leaflet-control-scale")).not.toBeNull();
        expect((byId("pane-b").querySelector(".map-legend") as HTMLElement).hidden).toBe(true);
    });

    it("gives each pane its own palette and range once they are no longer shared", async () => {
        await open(server(routes()), 12);
        expect($("#shared input[name=min]")!.value).toBe("15.5");
        click(byId("lock"));
        await ticks();
        expect(byId("lock").textContent).toBe(" Each pane its own");
        expect($("#shared")).toBeNull();
        const min = $("#pane-a input[name=min]")!;
        expect(min.value).toBe("15.5");
        min.value = "20";
        min.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect($("#pane-a input[name=min]")!.value).toBe("20");
        expect($("#pane-b input[name=min]")!.value).toBe("15.5");
        click(byId("pane-a").querySelector("button[name=auto]")!);
        await ticks();
        expect($("#pane-a input[name=min]")!.value).toBe("17");
        const max = $("#pane-b input[name=max]")!;
        max.value = "10";
        max.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks();
        expect(byId("pane-b").querySelector(".text-danger")!.textContent).toBe("The maximum must be above the minimum");
        expect($("#pane-b input[name=max]")!.value).toBe("10");
    });

    it("unlinks the panes and moves the split with the keys, within its limits", async () => {
        await open(server(routes()));
        click(byId("link"));
        await ticks();
        expect(byId("link").textContent).toBe(" Unlinked");
        expect(byId("link").getAttribute("aria-pressed")).toBe("false");
        key(byId("split"), "ArrowRight");
        await ticks();
        expect(location.search).toContain("&split=55");
        for (let i = 0; i < 10; i++) key(byId("split"), "ArrowLeft");
        await ticks();
        expect(byId("split").getAttribute("aria-valuenow")).toBe("20");
    });

    it("changes a pane's mosaic, loading its conversion's", async () => {
        const fetchFn = server(routes());
        await open(fetchFn);
        choose($("#pane-b select[name=mosaic]")!, "12:as_converted");
        await ticks(40);
        expect(calls(fetchFn)).toContain("GET " + API + "conversions/12/mosaics");
        expect($("#pane-b select[name=mosaic]")!.value).toBe("12:as_converted");
        expect(location.search).toBe("?b=12&a_tab=as_converted&b_tab=as_converted");
    });

    it("says when the conversion has no mosaics to compare", async () => {
        await open(server(routes({[API + "conversions/9/comparable"]: [[LIST[1]]]})));
        expect(byId("status").textContent!.trim()).toBe("This conversion has no mosaics to compare.");
        expect((document.querySelector(".compare-main") as HTMLElement).hidden).toBe(true);
    });

    it("says when the mosaics could not be loaded", async () => {
        await open(server(routes({[API + "conversions/9/mosaics"]: () => Promise.reject(new Error("down"))})));
        expect(byId("status").textContent!.trim()).toBe("Could not load the mosaics.");
        expect(byId("status").getAttribute("role")).toBe("alert");
    });
});
