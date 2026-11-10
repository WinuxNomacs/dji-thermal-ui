import type OlMap from "ol/Map";
import TileState from "ol/TileState";
import type TileLayer from "ol/layer/Tile";
import type XYZ from "ol/source/XYZ";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {type Basemap, loadMapboxTile, TileAvailability, TILEMAP_BLOCK, tileExists} from "../src/map/basemaps";
import {mosaicMap} from "../src/map/map";
import {jsonResponse, ticks} from "./helpers";

const TOKEN = "pk.eyJ1IjoidGVzdCJ9.abc";
const ESRI: Basemap = {label: "ESRI Satellite", url: "https://esri/tile/{z}/{y}/{x}", default: true, maxzoom: 21};
const OSM: Basemap = {label: "OpenStreetMap", url: "https://osm/{z}/{x}/{y}.png", maxzoom: 19, attribution_open: true};
const mapbox = (token: string | null = null): Basemap =>
    ({label: "Mapbox Satellite", type: "mapbox", url: "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}",
      maxzoom: 22, logo: "/static/vendor/mapbox/mapbox-logo.svg", token});

const $ = (sel: string) => document.querySelector(sel);
const select = () => $(".map-basemaps select") as HTMLSelectElement;
const options = () => [...select().options].map((o) => o.textContent);
const shown = () => select().selectedOptions[0].textContent;
const message = () => $(".map-basemaps-message") as HTMLElement;
const logo = () => $(".map-mapbox-logo") as HTMLElement;
const choose = (label: string) => {
    const s = select();
    s.value = [...s.options].find((o) => o.textContent === label)!.value;
    s.dispatchEvent(new Event("change"));
};

let map: OlMap;
const basemapLayers = () => map.getLayers().getArray().filter((l) => l.getZIndex() === -1) as TileLayer[];
const visible = () => basemapLayers().map((l) => l.getVisible());

function open(basemaps: Basemap[]) {
    const el = document.createElement("div");
    document.querySelector(".page")!.appendChild(el);
    map = mosaicMap(el, basemaps).map;
}

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div class="page"></div>';
});
afterEach(() => {
    map?.setTarget(undefined);
    vi.unstubAllGlobals();
});

describe("the basemap switch", () => {
    it("keeps OpenStreetMap's credit open only while OpenStreetMap is shown", () => {
        const open_ = () => $(".ol-attribution")!.classList.contains("ol-uncollapsible");
        open([ESRI, OSM]);
        expect(open_()).toBe(false);
        choose("OpenStreetMap");
        expect(open_()).toBe(true);
        choose("ESRI Satellite");
        expect(open_()).toBe(false);
    });

    it("lists Mapbox only once there is a token, and no way to add or change one", () => {
        open([ESRI, OSM, mapbox()]);
        expect(options()).toEqual(["ESRI Satellite", "OpenStreetMap", "None"]);
        expect([shown(), visible()]).toEqual(["ESRI Satellite", [true, false, false]]);
        expect(logo().hidden).toBe(true);

        document.body.innerHTML = '<div class="page"></div>';
        open([ESRI, OSM, mapbox(TOKEN)]);
        expect(options()).toEqual(["ESRI Satellite", "OpenStreetMap", "Mapbox Satellite", "None"]);
        const attribution = () => $(".ol-attribution")!.classList.contains("ol-uncollapsible");
        expect(attribution()).toBe(false);
        choose("Mapbox Satellite");
        expect([visible(), logo().hidden, attribution()]).toEqual([[false, false, true], false, true]);
        expect((logo().querySelector("img") as HTMLImageElement).getAttribute("src")).toBe("/static/vendor/mapbox/mapbox-logo.svg");
        const url = (basemapLayers()[2].getSource() as XYZ).getUrls()![0];
        expect(url).toBe("https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token=" + TOKEN);
        choose("None");
        expect([visible(), logo().hidden, attribution()]).toEqual([[false, false, false], true, false]);
    });

    it("starts on the preferred basemap, or on none when none is", () => {
        open([{...ESRI, default: false, fallback: true}, {...OSM, default: true}, mapbox()]);
        expect([shown(), visible()]).toEqual(["OpenStreetMap", [false, true, false]]);
        document.body.innerHTML = '<div class="page"></div>';
        open([{...ESRI, default: false, fallback: true}, OSM, mapbox()]);
        expect([shown(), visible()]).toEqual(["None", [false, false, false]]);
    });

    it("offers no Mapbox where the page lists none", () => {
        open([ESRI, OSM]);
        expect(options()).toEqual(["ESRI Satellite", "OpenStreetMap", "None"]);
        expect(logo()).toBeNull();
    });
});

describe("Mapbox's tiles", () => {
    const fakeTile = () => {
        const img = document.createElement("img");
        return {img, tile: {getImage: () => img, setState: vi.fn(), getTileCoord: () => [1, 0, 0]}};
    };

    it("are refused with a reason, and the switch goes back to the basemap before", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", {status: 401}))));
        open([ESRI, OSM, mapbox(TOKEN)]);
        choose("Mapbox Satellite");
        const {tile} = fakeTile();
        (basemapLayers()[2].getSource() as XYZ).getTileLoadFunction()(tile as never, "https://api.mapbox.com/t");
        await ticks();
        expect(tile.setState).toHaveBeenCalledWith(TileState.ERROR);
        expect([shown(), logo().hidden, message().hidden]).toEqual(["ESRI Satellite", true, false]);
        expect(message().textContent).toContain("Mapbox refused the token");
        // Another basemap chosen: the message goes
        choose("OpenStreetMap");
        expect(message().hidden).toBe(true);
    });

    it("refused on a map that started on them, go to the fallback basemap rather than none", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", {status: 401}))));
        open([{...ESRI, default: false, fallback: true}, OSM, {...mapbox(TOKEN), default: true}]);
        expect([shown(), logo().hidden]).toEqual(["Mapbox Satellite", false]);
        const {tile} = fakeTile();
        (basemapLayers()[2].getSource() as XYZ).getTileLoadFunction()(tile as never, "https://api.mapbox.com/t");
        await ticks();
        expect([shown(), visible()]).toEqual(["ESRI Satellite", [true, false, false]]);
    });

    it("are shown from what was fetched, and a missing one is no refusal", async () => {
        const refused = vi.fn();
        vi.stubGlobal("URL", Object.assign(URL, {createObjectURL: () => "blob:tile", revokeObjectURL: vi.fn()}));
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(new Blob(["jpg"]), {status: 200}))));
        const a = fakeTile();
        loadMapboxTile(a.tile as never, "https://api.mapbox.com/t", refused);
        await ticks();
        expect(a.img.getAttribute("src")).toBe("blob:tile");

        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", {status: 404}))));
        const b = fakeTile();
        loadMapboxTile(b.tile as never, "https://api.mapbox.com/t", refused);
        await ticks();
        expect(b.tile.setState).toHaveBeenCalledWith(TileState.ERROR);
        expect(refused).not.toHaveBeenCalled();
    });
});

describe("Esri's tilemap", () => {
    const answer = (left: number, top: number, data: number[]) =>
        ({data, location: {left, top, width: 2, height: data.length / 2}, valid: true});

    it("says which tiles of its block exist, and takes those outside it to exist", () => {
        const t = answer(10, 20, [1, 0, 0, 1]);
        expect([tileExists(t, 10, 20), tileExists(t, 11, 20), tileExists(t, 10, 21), tileExists(t, 11, 21)])
            .toEqual([true, false, false, true]);
        expect(tileExists(t, 12, 20)).toBe(true);
    });

    it("is asked once for each block of each level", async () => {
        const fetchFn = vi.fn((url: string) => jsonResponse(url.includes("/20/") ? answer(32, 16, [0, 0, 0, 0])
                                                                                  : answer(32, 16, [1, 1, 1, 1])));
        vi.stubGlobal("fetch", fetchFn);
        const a = new TileAvailability("https://esri/tilemap");
        expect(await Promise.all([a.has(19, 33, 17), a.has(19, 32, 16), a.has(20, 33, 17)])).toEqual([true, true, false]);
        expect(await a.has(20, 32, 16)).toBe(false);
        expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
            `https://esri/tilemap/19/16/32/${TILEMAP_BLOCK}/${TILEMAP_BLOCK}`,
            `https://esri/tilemap/20/16/32/${TILEMAP_BLOCK}/${TILEMAP_BLOCK}`]);
    });

    it("lets the layer stop at zoom 19 when it cannot be read, or does not answer in time", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", {status: 502}))));
        const a = new TileAvailability("https://esri/tilemap");
        expect([await a.has(19, 0, 0), await a.has(20, 0, 0)]).toEqual([true, false]);

        vi.useFakeTimers();
        vi.stubGlobal("fetch", vi.fn((_: string, opts: RequestInit) => new Promise((_resolve, reject) =>
            opts.signal!.addEventListener("abort", () => reject(opts.signal!.reason)))));
        const slow = new TileAvailability("https://esri/tilemap");
        const answers = Promise.all([slow.has(19, 0, 0), slow.has(21, 0, 0)]);
        await vi.advanceTimersByTimeAsync(5000);
        expect(await answers).toEqual([true, false]);
        vi.useRealTimers();
    });

    it("leaves a tile it says is missing unloaded, for the level above it to be stretched", async () => {
        vi.stubGlobal("fetch", vi.fn((url: string) => jsonResponse(url.includes("/21/") ? answer(0, 0, [0, 0, 0, 0])
                                                                                         : answer(0, 0, [1, 1, 1, 1]))));
        open([{...ESRI, tilemap: "https://esri/tilemap"}]);
        const layer = basemapLayers()[0];
        expect(layer.getPreload()).toBe(4);
        const load = (layer.getSource() as XYZ).getTileLoadFunction();
        const [missing, there] = [fakeTile(21), fakeTile(20)];
        load(missing.tile as never, "https://esri/tile/21/0/0");
        load(there.tile as never, "https://esri/tile/20/0/0");
        await ticks();
        expect(missing.tile.setState).toHaveBeenCalledWith(TileState.ERROR);
        expect(missing.img.getAttribute("src")).toBeNull();
        expect(there.img.getAttribute("src")).toBe("https://esri/tile/20/0/0");
    });

    function fakeTile(z: number) {
        const img = document.createElement("img");
        return {img, tile: {getImage: () => img, setState: vi.fn(), getTileCoord: () => [z, 0, 0]}};
    }
});
