// The basemaps under the mosaics and their switch: the settings' (Esri's satellite imagery, OpenStreetMap), and
// Mapbox's satellite imagery once there is a token (the user's own, saved under System Settings). Esri's layer loads no
// tile its tilemap says is missing, so the deepest level it has there is stretched in place of "Map data not yet
// available".
import type ImageTile from "ol/ImageTile";
import type OlMap from "ol/Map";
import type Tile from "ol/Tile";
import TileState from "ol/TileState";
import Attribution from "ol/control/Attribution";
import Control from "ol/control/Control";
import TileLayer from "ol/layer/Tile";
import {toLonLat} from "ol/proj";
import TileWMS from "ol/source/TileWMS";
import XYZ from "ol/source/XYZ";

export interface Basemap {
    label: string; url: string; type?: string; attribution?: string; maxzoom?: number; minzoom?: number;
    subdomains?: string | string[]; layers?: string; styles?: string; format?: string;
    key?: string; default?: boolean;                        // the one shown first (the preferred one)
    fallback?: boolean;                                     // the one a refused Mapbox goes back to (the settings' default)
    tilemap?: string;                                       // Esri's: which tiles exist
    logo?: string; token?: string | null;                   // Mapbox's: its wordmark, and the token
}

// --- Esri's tilemap ---------------------------------------------------------------------------------------------

// The tiles asked about at once: a block this many tiles square
export const TILEMAP_BLOCK = 16;
// The deepest level drawn where the tilemap cannot be read, or does not answer in time (ms)
export const TILEMAP_FALLBACK_ZOOM = 19;
const TILEMAP_TIMEOUT = 5000;
// The levels below the one shown that are loaded too, to stretch where a level has no tile
const STRETCHED_LEVELS = 4;

export interface TileMap {data: number[]; location: {left: number; top: number; width: number; height: number}}

// Whether the tilemap says a tile exists (one outside the block it answered for is taken to exist)
export function tileExists(t: TileMap, x: number, y: number): boolean {
    const {left, top, width, height} = t.location;
    if (x < left || x >= left + width || y < top || y >= top + height) return true;
    return t.data[(y - top) * width + (x - left)] !== 0;
}

async function readTileMap(url: string): Promise<TileMap | null> {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), TILEMAP_TIMEOUT);
    try {
        const res = await fetch(url, {signal: abort.signal});
        if (!res.ok) return null;
        const t = await res.json();
        return Array.isArray(t?.data) && t.location ? t : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// The tiles of a layer that exist, asked once for each block of each level
export class TileAvailability {
    private blocks = new Map<string, Promise<TileMap | null>>();

    constructor(private url: string) {}

    has(z: number, x: number, y: number): Promise<boolean> {
        const row = Math.floor(y / TILEMAP_BLOCK) * TILEMAP_BLOCK, col = Math.floor(x / TILEMAP_BLOCK) * TILEMAP_BLOCK;
        const key = z + "/" + row + "/" + col;
        let block = this.blocks.get(key);
        if (!block) {
            block = readTileMap(`${this.url}/${key}/${TILEMAP_BLOCK}/${TILEMAP_BLOCK}`);
            this.blocks.set(key, block);
        }
        return block.then((t) => t ? tileExists(t, x, y) : z <= TILEMAP_FALLBACK_ZOOM);
    }
}

// --- Mapbox -----------------------------------------------------------------------------------------------------

export const MAPBOX_REFUSED: Record<number, string> = {
    401: "Mapbox refused the token: change it under System Settings",
    403: "Mapbox refused the token here (its URL restrictions, or the account)",
    429: "The Mapbox account's limit is reached for now",
};

// Mapbox's attribution, with "Improve this map" at the place shown
const mapboxAttributions = (frameState: {viewState: {center: number[]; zoom: number}}) => {
    const [lon, lat] = toLonLat(frameState.viewState.center), z = Math.round(frameState.viewState.zoom);
    const a = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    return [a("https://www.mapbox.com/about/maps/", "© Mapbox"),
            a("https://www.openstreetmap.org/copyright", "© OpenStreetMap"),
            a(`https://apps.mapbox.com/feedback/#/${lon.toFixed(5)}/${lat.toFixed(5)}/${z}`, "<strong>Improve this map</strong>"),
            a("https://www.maxar.com/", "© Maxar")];
};

// A Mapbox tile, fetched so that a refusal is known by its status (refused: 401, 403 or 429)
export function loadMapboxTile(tile: Tile, src: string, refused: (status: number) => void) {
    fetch(src).then(async (res) => {
        if (!res.ok) {
            if (MAPBOX_REFUSED[res.status]) refused(res.status);
            tile.setState(TileState.ERROR);
            return;
        }
        const url = URL.createObjectURL(await res.blob());
        const img = (tile as ImageTile).getImage() as HTMLImageElement;
        const free = () => URL.revokeObjectURL(url);
        img.addEventListener("load", free, {once: true});
        img.addEventListener("error", free, {once: true});
        img.src = url;
    }).catch(() => tile.setState(TileState.ERROR));
}

const mapboxUrl = (bm: Basemap) => bm.url + "?access_token=" + encodeURIComponent(bm.token || "");

// --- the layers and their switch --------------------------------------------------------------------------------

function basemapLayer(bm: Basemap, refused: (status: number) => void): TileLayer {
    const opts = {attributions: bm.attribution || bm.label, maxZoom: bm.maxzoom || 21, minZoom: bm.minzoom || 0};
    if (bm.type === "wms") {
        return new TileLayer({source: new TileWMS({url: bm.url, attributions: opts.attributions,
            params: {LAYERS: bm.layers || "0", STYLES: bm.styles || "default", FORMAT: bm.format || "image/png", VERSION: "1.1.1"}})});
    }
    if (bm.type === "mapbox") {
        return new TileLayer({source: new XYZ({...opts, attributions: mapboxAttributions,
                                               url: mapboxUrl(bm), tileSize: 512,
                                               tileLoadFunction: (tile, src) => loadMapboxTile(tile, src, refused)})});
    }
    // {s} (as Leaflet wrote basemap URLs): one URL for each subdomain
    const subdomains = typeof bm.subdomains === "string" ? bm.subdomains.split("") : bm.subdomains || [];
    const urls = bm.url.includes("{s}") && subdomains.length ? subdomains.map((s) => bm.url.replace("{s}", s)) : [bm.url];
    if (!bm.tilemap) return new TileLayer({source: new XYZ({...opts, urls})});
    const available = new TileAvailability(bm.tilemap);
    return new TileLayer({preload: STRETCHED_LEVELS, source: new XYZ({...opts, urls, tileLoadFunction: (tile, src) => {
        const [z, x, y] = tile.getTileCoord();
        available.has(z, x, y).then((ok) => {
            if (ok) ((tile as ImageTile).getImage() as HTMLImageElement).src = src;
            else tile.setState(TileState.ERROR);
        });
    }})});
}

// The basemaps under everything else (the default one shown, else none), and their switch (top right): Mapbox is
// listed once it has a token. When its tiles are refused, the map goes back to the basemap shown before it, or to the
// fallback when it was the first shown.
export function addBasemaps(map: OlMap, basemaps: Basemap[]) {
    const mapboxAt = basemaps.findIndex((bm) => bm.type === "mapbox");
    const fallbackAt = basemaps.findIndex((bm, i) => bm.fallback && i !== mapboxAt);
    const before = () => previous === mapboxAt ? fallbackAt : previous;
    const mapboxBm = basemaps[mapboxAt];
    let wasRefused = false;
    const refused = (status: number) => {
        if (wasRefused) return;
        wasRefused = true;
        if (shown === mapboxAt) show(before());
        message.textContent = MAPBOX_REFUSED[status];
        message.hidden = false;
    };
    const layers = basemaps.map((bm) => {
        const l = basemapLayer(bm, refused);
        l.setZIndex(-1);
        l.setVisible(false);
        map.addLayer(l);
        return l;
    });

    const el = document.createElement("div");
    el.className = "map-basemaps ol-unselectable ol-control";
    const select = document.createElement("select");
    select.name = "basemap";
    select.title = "The map under the mosaic";
    const message = document.createElement("div");
    message.className = "map-basemaps-message";
    message.setAttribute("role", "status");
    message.hidden = true;
    el.append(select, message);
    map.addControl(new Control({element: el}));

    // Mapbox's wordmark (bottom left) while its imagery is shown
    const logo = document.createElement("a");
    logo.className = "map-mapbox-logo ol-unselectable";
    logo.href = "https://www.mapbox.com/";
    logo.target = "_blank";
    logo.rel = "noopener";
    logo.hidden = true;
    if (mapboxBm?.logo) {
        const img = document.createElement("img");
        img.src = mapboxBm.logo;
        img.alt = "Mapbox";
        img.width = 88;
        img.height = 23;
        logo.appendChild(img);
        map.addControl(new Control({element: logo}));
    }

    // Mapbox's attribution stays open while its imagery is shown (the control would look at the hidden layers too)
    const attribution = map.getControls().getArray().find((c) => c instanceof Attribution) as Attribution | undefined;

    let shown = -1, previous = -1;
    function show(i: number) {
        if (i !== shown) previous = shown;
        shown = i;
        layers.forEach((l, j) => l.setVisible(j === i));
        const isMapbox = i >= 0 && i === mapboxAt;
        logo.hidden = !isMapbox;
        attribution?.setCollapsible(!isMapbox);
        options();
    }

    function options() {
        select.replaceChildren();
        const add = (value: string, label: string) => {
            const o = document.createElement("option");
            o.value = value;
            o.textContent = label;
            select.appendChild(o);
        };
        basemaps.forEach((bm, i) => { if (i !== mapboxAt || bm.token) add(String(i), bm.label); });
        add("-1", "None");
        select.value = String(shown);
    }

    select.addEventListener("change", () => {
        message.hidden = true;
        show(Number(select.value));
    });

    show(basemaps.findIndex((bm) => bm.default && (bm.type !== "mapbox" || bm.token)));
    previous = shown;
}
