import TileLayer from "ol/layer/Tile";
import WebGLTileLayer from "ol/layer/WebGLTile";
import type XYZ from "ol/source/XYZ";
import OlMap from "ol/Map";
import MapBrowserEvent from "ol/MapBrowserEvent";
import {fromLonLat} from "ol/proj";
import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import {autoRange, autoReach, type Comparable, comparedTabs, compareQuery, dataTab, differenceDataUrl, firstTab, frameCurveUrl,
        frameDataUrl, mosaicGroups, reachIn, readCompare} from "../src/compare/compare";
import {ComparePage} from "../src/compare/compare-page";
import {DifferenceReadout} from "../src/compare/pane";
import type {Finding} from "../src/findings/findings";
import {type Mosaics} from "../src/viewer/viewer-page";
import {calls, click, jsonResponse, key, server, ticks, valuesResponse} from "./helpers";

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
const FOUND: Finding = {
    id: 7, dataset: 5, name: "Hot joint", notes: "Loose bolt", severity: "high", status: "open",
    geometry: {type: "Point", coordinates: [10.005, 50.005]}, shape: null, conversion: 9, conversion_name: "Nadir",
    tab: "as_converted", temperatures: {value: 31.5, unit: "C", approximate: false}, models: true,
    frames: [{frame: "a_T.JPG", used: true, view_angle: 5, time: "2026:10:12 18:29:50", pixel: [3, 4], kept: true},
             {frame: "b_T.JPG", used: false, view_angle: 12, time: "2026:10:12 18:29:52", pixel: [1, 1], kept: false}],
    created_at: "2026-10-27T09:00:00Z", updated_at: "2026-10-27T09:00:00Z",
};
const FINDINGS = (dataset: number) => API + "datasets/" + dataset + "/findings";
const SOURCES = {kind: "Point", geometry: FOUND.geometry, models: true, reason: null, frames: FOUND.frames,
                 point: {valid: true, temperature: 31.5}};

const $ = (sel: string) => document.querySelector(sel) as HTMLInputElement | null;
const byId = (id: string) => document.getElementById(id)!;
const choose = (el: Element, value: string) => {
    (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new Event("change", {bubbles: true}));
};
const form = () => $(".finding-form form") as unknown as HTMLFormElement;
const submit = () => form().dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
const sent = (fetchFn: ReturnType<typeof server>, method: string, url: string) =>
    fetchFn.mock.calls.filter((c) => c[0] === url && c[1]?.method === method).map((c) => JSON.parse(String(c[1]!.body)));

// The panes' maps, A's first, as the page makes them (jsdom draws no map, so a click on one is made up)
function panesMaps(): OlMap[] {
    const viewport = vi.spyOn(OlMap.prototype, "getViewport");
    return new Proxy([], {get: (_, i) => [...new Set(viewport.mock.contexts as OlMap[])][i as unknown as number]});
}
function clickMap(m: OlMap, lonLat: number[]) {
    const e = new MapBrowserEvent("click", m, new MouseEvent("click") as PointerEvent);
    e.coordinate = fromLonLat(lonLat);
    m.dispatchEvent(e);
}

function routes(extra: Record<string, unknown> = {}) {
    return {
        [API + "conversions/9/comparable"]: [LIST],       // a list of one answer: the list
        [API + "conversions/9/mosaics"]: NADIR,
        [API + "conversions/12/mosaics"]: OTHER,
        [FINDINGS(5)]: {findings: []},
        [FINDINGS(6)]: {findings: []},
        [API + "conversions/9/frame/data?frame=a_T.JPG"]: valuesResponse(10, 8),
        [API + "conversions/12/frame/data?frame=a_T.JPG"]: valuesResponse(10, 8),
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
    vi.restoreAllMocks();
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

    it("keep the findings hidden and the one open in each pane in the URL", () => {
        expect(readCompare("?b=12&findings=0&a_finding=7&b_finding=0")).toEqual({b: 12, findings: false, a_finding: 7});
        expect(readCompare("?findings=1&b_finding=x")).toEqual({});
        expect(compareQuery({a: 9, b: 12, a_tab: "as_converted", b_tab: "as_converted", findings: false, a_finding: null,
                             b_finding: 8}, 9)).toBe("?b=12&a_tab=as_converted&b_tab=as_converted&findings=0&b_finding=8");
    });

    it("keep the overlay, its opacity and its swipe in the URL, between their limits", () => {
        expect(readCompare("?b=12&overlay=b&opacity=140&swipe=-5")).toEqual({b: 12, overlay: "b", opacity: 100, swipe: 0});
        expect(readCompare("?overlay=c&opacity=x")).toEqual({});
        expect(readCompare("?diff=a&overlay=b")).toEqual({diff: "a"});
        expect(compareQuery({a: 9, b: 12, a_tab: "visual", b_tab: "as_converted", overlay: "b", opacity: 60, swipe: 50}, 9))
            .toBe("?b=12&a_tab=visual&b_tab=as_converted&overlay=b&opacity=60");
        // Without the overlay its opacity and swipe are left out
        expect(compareQuery({a: 9, b: 12, a_tab: "as_converted", b_tab: "as_converted", overlay: "", opacity: 60, swipe: 20}, 9))
            .toBe("?b=12&a_tab=as_converted&b_tab=as_converted");
    });

    it("offer a conversion's visual mosaic where it has one, read on its as converted values", () => {
        expect(comparedTabs({...LIST[0], visual: true})).toEqual(["as_converted", "harmonized", "visual"]);
        expect(comparedTabs(LIST[0])).toEqual(["as_converted", "harmonized"]);
        expect(comparedTabs({...LIST[0], tabs: ["harmonized"], visual: true})).toEqual(["harmonized"]);
        expect(firstTab({...LIST[0], visual: true}, "visual")).toBe("visual");
        expect(firstTab(LIST[0], "visual")).toBe("as_converted");
        expect([dataTab("visual"), dataTab("harmonized")]).toEqual(["as_converted", "harmonized"]);
    });

    it("group the mosaics by dataset (another project's named) and start a pane on the tab wanted, else another than the other pane's", () => {
        expect(mosaicGroups(LIST).map((g) => [g.name, g.items.map((c) => c.id)])).toEqual([["Roof", [9]], ["Field", [12]]]);
        // Another project's datasets are named with it
        const projects = [{...LIST[0], project: 1, project_name: "Silos"}, {...LIST[1], project: 2, project_name: "Barns"}];
        expect(mosaicGroups(projects, 1).map((g) => g.name)).toEqual(["Roof", "Barns · Field"]);
        expect(firstTab(LIST[0], "harmonized")).toBe("harmonized");
        expect(firstTab(LIST[0], "view_angle", "as_converted")).toBe("harmonized");
        expect(firstTab(LIST[1], undefined, "as_converted")).toBe("as_converted");
    });

    it("give the Auto range that holds both mosaics, in the user's unit whatever their own", () => {
        expect(autoRange([{tab: NADIR.tabs![0], unit: "C"}])).toEqual([17, 28]);
        expect(autoRange([{tab: NADIR.tabs![0], unit: "C"}, {tab: OTHER.tabs![0], unit: "F"}])).toEqual([15.5, 32.3]);
        expect(autoRange([])).toEqual([0, 1]);
    });

    it("give the difference's reach in the user's unit, and in A's for its values", () => {
        expect(autoReach({unit: "C", range: [-1.23, 1.23]})).toBe(1.3);
        expect(autoReach({unit: "C", range: null})).toBe(1);
        setUserUnit("F");
        expect(autoReach({unit: "C", range: [-1.23, 1.23]})).toBe(2.3);
        expect(reachIn(1.8, "C")).toBe(1);
        expect(differenceDataUrl(API, 9, "as_converted", 12, "as_converted")).toBe(
            API + "conversions/9/mosaics/as_converted/difference/data/{z}/{x}/{y}?b=12&b_tab=as_converted");
    });

    it("ask a frame's values, and its tone curve in the range shown in its conversion's unit", () => {
        setUserUnit("F");
        expect(frameDataUrl(API, 9, "a b.JPG")).toBe(API + "conversions/9/frame/data?frame=a%20b.JPG");
        expect(frameCurveUrl(API, 9, "a.JPG", {palette: "magma", range: [32, 212], adjust: {gamma: 2, equalize: true, sharpen: 0}}, "C"))
            .toBe(API + "conversions/9/frame/curve?frame=a.JPG&rescale=0,100&gamma=2&equalize=1");
    });
});

describe("the compare parts", () => {
    it("read both mosaics under the cursor and their difference in the user's unit", () => {
        render(<DifferenceReadout a={{valid: true, temperature: 20}} b={{valid: true, temperature: 70}} aUnit="C" bUnit="F"/>, byId("root"));
        expect(byId("root").textContent).toBe("A20.00 °CB21.11 °CA − B-1.11 °C");
        render(<DifferenceReadout a={{valid: false, reason: "outside_raster"}} b={null} aUnit="C" bUnit="F"/>, byId("root"));
        expect(byId("root").textContent).toBe("Aoutside the mosaicBno dataA − Bno data");
        render(<DifferenceReadout a={{valid: true, temperature: 20}} b={{valid: true, temperature: 70}} aUnit="C" bUnit="F"
                                  difference={false}/>, byId("root"));
        expect(byId("root").textContent).toBe("A20.00 °CB21.11 °C");
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
        expect(calls(fetchFn)).toEqual(["GET " + API + "conversions/9/comparable", "GET " + API + "conversions/9/mosaics",
                                        "GET " + FINDINGS(5)]);
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
        expect(byId("map-a").dataset.values).toBe(API + "conversions/9/mosaics/as_converted/data/{z}/{x}/{y}");
        expect(byId("map-b").dataset.values)
            .toBe(API + "conversions/9/mosaics/as_converted/difference/data/{z}/{x}/{y}?b=12&b_tab=as_converted");
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

    it("draws both panes as the gamma slider is dragged, asking for the equalized curves once it is let go", async () => {
        const fetchFn = server(routes());
        await open(fetchFn, 12);
        const equalize = $("#shared input[name=equalize]")!;
        equalize.checked = true;
        equalize.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks(20);
        const curves = () => calls(fetchFn).filter((c) => c.includes("/curve")).length;
        const asked = curves(), restyled = vi.spyOn(WebGLTileLayer.prototype, "setStyle");
        const gamma = $("#shared input[name=gamma]")!;
        gamma.value = "1";
        gamma.dispatchEvent(new Event("input", {bubbles: true}));
        await ticks(20);
        expect(restyled).toHaveBeenCalledTimes(2);
        expect(gamma.value).toBe("1");
        expect(curves()).toBe(asked);
        gamma.dispatchEvent(new Event("change", {bubbles: true}));
        await ticks(20);
        expect(calls(fetchFn).filter((c) => c.includes("/curve")).slice(asked).every((c) => c.includes("gamma=2"))).toBe(true);
        expect(curves()).toBe(asked + 2);
        vi.restoreAllMocks();
    });

    it("says when the mosaics do not overlap", async () => {
        await open(server(routes({[API + "conversions/9/mosaics/as_converted/difference?b=9&b_tab=harmonized"]:
            {unit: "C", bounds: null, range: null, palettes: DIFF_PALETTES}})));
        choose($("#pane-b select[name=show]")!, "diff");
        await ticks(40);
        expect(byId("pane-b").querySelector(".compare-note")!.textContent).toBe("These mosaics do not overlap.");
        // Above the map, which stays as it was, with no colour scale
        expect(byId("pane-b").querySelector(".compare-note + .compare-stage .ol-scale-line")).not.toBeNull();
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
        expect(byId("status").textContent!.trim()).toBe("This dataset has no mosaics to compare.");
        expect((document.querySelector(".compare-main") as HTMLElement).hidden).toBe(true);
    });

    it("says when the mosaics could not be loaded", async () => {
        await open(server(routes({[API + "conversions/9/mosaics"]: () => Promise.reject(new Error("down"))})));
        expect(byId("status").textContent!.trim()).toBe("Could not load the mosaics.");
        expect(byId("status").getAttribute("role")).toBe("alert");
    });
});

describe("visual mosaics on the compare page", () => {
    const VISUAL_LIST = [{...LIST[0], visual: true}, LIST[1]];
    const WITH_VISUAL = {...NADIR, visual: {bounds: BOUNDS, minzoom: 15, maxzoom: 22}};
    const visualRoutes = (extra: Record<string, unknown> = {}) => routes({
        [API + "conversions/9/comparable"]: [VISUAL_LIST], [API + "conversions/9/mosaics"]: WITH_VISUAL, ...extra});
    const tiles = (m: OlMap) => m.getLayers().getArray().filter((l) => l instanceof TileLayer && !(l instanceof WebGLTileLayer) &&
        String((l as TileLayer<XYZ>).getSource()?.getUrls()?.[0]).includes("/visual/tiles/")) as TileLayer<XYZ>[];
    const values = (m: OlMap) => m.getLayers().getArray().filter((l) => l instanceof WebGLTileLayer) as WebGLTileLayer[];

    it("shows a conversion's visual mosaic in a pane, with no palette and no difference, read on its as converted values", async () => {
        history.replaceState(null, "", "/conversion/9/compare?b=12&diff=b");
        const fetchFn = server(visualRoutes({
            [API + "conversions/9/mosaics/as_converted/difference?b=12&b_tab=as_converted"]: DIFF,
            ["POST " + API + "conversions/9/mosaics/as_converted/sources"]: SOURCES,
        }));
        const maps = panesMaps();
        await open(fetchFn, 12);
        expect($("#pane-b select[name=show]")!.value).toBe("diff");
        expect(Array.from(document.querySelectorAll("#pane-a select[name=mosaic] option")).map((o) => (o as HTMLOptionElement).value))
            .toEqual(["9:as_converted", "9:harmonized", "9:visual", "12:as_converted"]);
        choose($("#pane-a select[name=mosaic]")!, "9:visual");
        await ticks(40);
        // The difference is shown no more, nor offered
        expect($("#pane-b select[name=show]")!.value).toBe("mosaic");
        expect(($("#pane-b select[name=show] option[value=diff]") as unknown as HTMLOptionElement).disabled).toBe(true);
        expect(location.search).toBe("?b=12&a_tab=visual&b_tab=as_converted");
        expect(tiles(maps[0]).map((l) => l.getSource()!.getUrls()![0])).toEqual([API + "conversions/9/mosaics/visual/tiles/{z}/{x}/{y}.png"]);
        expect(tiles(maps[0])[0].getVisible()).toBe(true);
        expect(values(maps[0])).toEqual([]);
        // The shared palette is B's, and A has no colour scale
        expect($("#shared input[name=min]")!.value).toBe("15.5");
        expect((byId("pane-a").querySelector(".map-legend") as HTMLElement).hidden).toBe(true);
        // Its source frames are the as converted mosaic's, the window offering their visual pairs; the tools are on the
        // pane's map, Spot and Area only
        expect([...byId("pane-a").querySelectorAll(".compare-stage .map-tools [data-tool]")].map((x) => x.getAttribute("data-tool")))
            .toEqual(["point", "area"]);
        expect(byId("pane-a").querySelector(".compare-head [data-tool]")).toBeNull();
        click($("#pane-a [data-tool=point]")!);
        await ticks();
        clickMap(maps[0], [10.005, 50.005]);
        await ticks(40);
        expect(calls(fetchFn)).toContain("POST " + API + "conversions/9/mosaics/as_converted/sources");
        expect($("[data-window=compare-a] .sources-groups")?.textContent ?? $("[data-window=compare-a]")!.textContent).toContain("Visual");
        expect($("[data-window=compare-a] .sources-camera")).not.toBeNull();
    });

    it("draws A over B in one pane, faded and swiped as asked, with both values under the cursor", async () => {
        history.replaceState(null, "", "/conversion/9/compare?b=12&a_tab=visual&overlay=b&opacity=60");
        const maps = panesMaps();
        await open(server(visualRoutes()), 12);
        expect($("#pane-b select[name=show]")!.value).toBe("overlay");
        // B's values under A's visual tiles, which are faded and cut at the line
        const [under] = values(maps[1]), [over] = tiles(maps[1]);
        expect(under.getZIndex()).toBe(0);
        expect(over.getZIndex()).toBe(1);
        expect(over.getOpacity()).toBeCloseTo(0.6);
        expect(under.getOpacity()).toBe(1);
        expect($("#pane-b input[name=opacity]")!.value).toBe("60");
        expect(byId("swipe-b").style.left).toBe("50%");
        expect($("#pane-a .compare-overlay")).toBeNull();
        const opacity = $("#pane-b input[name=opacity]")!;
        opacity.value = "25";
        opacity.dispatchEvent(new Event("input", {bubbles: true}));
        key(byId("swipe-b"), "ArrowRight");
        await ticks();
        expect(tiles(maps[1])[0].getOpacity()).toBeCloseTo(0.25);
        expect(byId("swipe-b").getAttribute("aria-valuenow")).toBe("55");
        expect(location.search).toBe("?b=12&a_tab=visual&b_tab=as_converted&overlay=b&opacity=25&swipe=55");
        // The colour scale is B's, the one temperature mosaic drawn
        expect(byId("pane-b").querySelector(".map-legend")!.textContent).toContain("B · Mosaic");

        // Back to B's mosaic alone: A's tiles go, B's values stay whole
        choose($("#pane-b select[name=show]")!, "mosaic");
        await ticks(40);
        expect(tiles(maps[1])).toEqual([]);
        expect(values(maps[1])).toEqual([under]);
        expect(byId("swipe-b" as string)).toBeNull();
        expect(location.search).toBe("?b=12&a_tab=visual&b_tab=as_converted");
    });

    it("reads both mosaics in an overlay of two temperature mosaics, without their difference", async () => {
        history.replaceState(null, "", "/conversion/9/compare?b=12&overlay=a");
        const routed = server(visualRoutes());
        // Each mosaic's value under the cursor, wherever it is
        const fetchFn = vi.fn((url: string, opts?: RequestInit) => !url.includes("/point?") ? routed(url, opts) :
            Promise.resolve(jsonResponse({valid: true, temperature: url.includes("/12/") ? 70 : 20})));
        const maps = panesMaps();
        await open(fetchFn as unknown as ReturnType<typeof server>, 12);
        expect(values(maps[0]).map((l) => [l.getZIndex(), l.getOpacity()])).toEqual([[0, 1], [1, 1]]);
        expect(byId("pane-a").querySelector(".map-legend")!.textContent).toContain("A · Mosaic");
        maps[0].dispatchEvent(Object.assign(new MapBrowserEvent("pointermove", maps[0], new MouseEvent("pointermove") as PointerEvent),
                                            {coordinate: fromLonLat([10.005, 50.005])}));
        await new Promise((resolve) => setTimeout(resolve, 150));
        await ticks(40);
        expect(byId("pane-a").querySelector(".compare-readout")!.textContent).toBe("A20.00 °CB21.11 °C");
    });
});

describe("the findings on the compare page", () => {
    it("opens the finding a link asks for in its pane, changes it, and keeps the switch in the URL", async () => {
        history.replaceState(null, "", "/conversion/9/compare?b=12&a_finding=7");
        const changed = {...FOUND, severity: "critical"};
        const fetchFn = server(routes({[FINDINGS(5)]: [{findings: [FOUND]}, {findings: [changed]}],
                                       ["PATCH " + FINDINGS(5) + "/7"]: changed}));
        await open(fetchFn, 12);
        expect(calls(fetchFn)).toContain("GET " + FINDINGS(6));
        const about = $("[data-window=compare-a] .finding-about")!;
        expect(about.textContent).toContain("Hot joint");
        expect(about.querySelector("a")!.getAttribute("href")).toBe("/conversion/9?finding=7");
        expect($("[data-window=compare-a] .sources-what")!.textContent).toBe("Spot · 1 frame");
        expect($("[name=save-finding]")).toBeNull();
        expect(location.search).toBe("?b=12&a_tab=as_converted&b_tab=as_converted&a_finding=7");

        click(byId("findings"));
        await ticks();
        expect(byId("findings").getAttribute("aria-pressed")).toBe("false");
        expect(location.search).toContain("&findings=0&a_finding=7");

        click(about.querySelector("button[name=edit]")!);
        await ticks();
        choose($("#finding-severity")!, "critical");
        await ticks();
        submit();
        await ticks(40);
        expect(sent(fetchFn, "PATCH", FINDINGS(5) + "/7")).toEqual([{name: "Hot joint", notes: "Loose bolt", severity: "critical",
                                                                    status: "open", kept: ["a_T.JPG"]}]);
        expect($("[data-window=compare-a] .finding-about")!.textContent).toContain("Critical");
    });

    it("saves a spot drawn in a pane as a finding of its mosaic's dataset, measured on it", async () => {
        const saved = {...FOUND, id: 8, name: "Cold corner"};
        const fetchFn = server(routes({
            ["POST " + API + "conversions/9/mosaics/as_converted/sources"]: SOURCES,
            [FINDINGS(5)]: [{findings: []}, {findings: [saved]}],
            ["POST " + FINDINGS(5)]: saved,
        }));
        const maps = panesMaps();
        await open(fetchFn, 12);
        click($("#pane-a [data-tool=point]")!);
        await ticks();
        expect(byId("pane-a").classList.contains("picking")).toBe(true);
        clickMap(maps[0], [10.005, 50.005]);
        await ticks(40);
        expect($("#pane-a [data-tool=point]")!.getAttribute("aria-pressed")).toBe("false");
        expect($("[data-window=compare-a] .sources-what")!.textContent).toBe("Spot · 2 frames");

        click($("[data-window=compare-a] [name=save-finding]")!);
        await ticks();
        const name = $("#finding-name")!;
        name.value = "Cold corner";
        name.dispatchEvent(new Event("input", {bubbles: true}));
        await ticks();
        submit();
        await ticks(40);
        const [body] = sent(fetchFn, "POST", FINDINGS(5));
        expect(body.geometry.coordinates[0]).toBeCloseTo(10.005, 9);
        expect(body.geometry.coordinates[1]).toBeCloseTo(50.005, 9);
        expect({...body, geometry: body.geometry.type}).toEqual({name: "Cold corner", notes: "", severity: "medium", status: "open",
                                                                 conversion: 9, tab: "as_converted", geometry: "Point", parameters: {}});
        expect($("[data-window=compare-a] .finding-about")!.textContent).toContain("Cold corner");
        expect(location.search).toContain("a_finding=8");
    });

    it("saves from each mosaic of a difference to that mosaic's dataset", async () => {
        const saved = {...FOUND, id: 9, dataset: 6, conversion: 12, name: "Warm patch"};
        const fetchFn = server(routes({
            [API + "conversions/9/mosaics/as_converted/difference?b=12&b_tab=as_converted"]: DIFF,
            ["POST " + API + "conversions/9/mosaics/as_converted/sources"]: SOURCES,
            ["POST " + API + "conversions/12/mosaics/as_converted/sources"]: {...SOURCES, frames: [FOUND.frames[0]]},
            [FINDINGS(6)]: [{findings: []}, {findings: [saved]}],
            ["POST " + FINDINGS(6)]: saved,
        }));
        const maps = panesMaps();
        await open(fetchFn, 12);
        choose($("#pane-b select[name=show]")!, "diff");
        await ticks(40);
        click($("#pane-b [data-tool=point]")!);
        await ticks();
        clickMap(maps[1], [10.005, 50.005]);
        await ticks(40);
        const groups = document.querySelectorAll("[data-window=compare-b] .sources-groups button");
        expect([...groups].map((b) => b.textContent)).toEqual(["A · Nadir · Mosaic", "B · Other · Mosaic"]);
        click(groups[1]);
        await ticks();
        expect($("[data-window=compare-b] .sources-what")!.textContent).toBe("Spot · 1 frame");
        click($("[data-window=compare-b] [name=save-finding]")!);
        await ticks();
        const name = $("#finding-name")!;
        name.value = "Warm patch";
        name.dispatchEvent(new Event("input", {bubbles: true}));
        await ticks();
        submit();
        await ticks(40);
        expect(sent(fetchFn, "POST", FINDINGS(6)).map((b) => [b.conversion, b.tab])).toEqual([[12, "as_converted"]]);
        expect(sent(fetchFn, "POST", FINDINGS(5))).toEqual([]);
        expect($("[data-window=compare-b] .finding-about")!.textContent).toContain("Warm patch");
        expect(location.search).toContain("b_finding=9");
    });
});
