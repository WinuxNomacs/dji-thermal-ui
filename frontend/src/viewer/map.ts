// What a map of mosaics starts with: the basemaps to choose from (the settings' BASEMAPS), its scale, and a place for
// the colour scale; the viewer's and the compare page's
import L from "leaflet";

export interface Basemap {
    label: string; url: string; type?: string; attribution?: string; maxzoom?: number; minzoom?: number;
    subdomains?: string | string[]; layers?: string; styles?: string; format?: string; default?: boolean;
}

// The basemaps (the default one shown, else none) with their switch, and the map's scale
export function addBasemaps(m: L.Map, basemaps: Basemap[]): void {
    const layers: Record<string, L.Layer> = {};
    let chosen: L.Layer | null = null;
    basemaps.forEach((bm) => {
        const opts: L.TileLayerOptions = {attribution: bm.attribution || bm.label, maxZoom: 26, maxNativeZoom: bm.maxzoom || 21,
                                          minZoom: bm.minzoom || 0, subdomains: bm.subdomains || []};
        const l = bm.type === "wms" ? L.tileLayer.wms(bm.url, {...opts, layers: bm.layers || "0", styles: bm.styles || "default",
                                                               format: bm.format || "image/png"}) : L.tileLayer(bm.url, opts);
        layers[bm.label] = l;
        if (bm.default && !chosen) chosen = l;
    });
    layers.None = L.layerGroup();
    (chosen || layers.None).addTo(m);
    L.control.layers(layers, {}, {position: "topright"}).addTo(m);
    L.control.scale({imperial: false}).addTo(m);
}

// The colour scale's place on the map (bottom right), for the page to render into
export function addLegend(m: L.Map): HTMLDivElement {
    const el = L.DomUtil.create("div", "map-legend leaflet-control") as HTMLDivElement;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    const control = new L.Control({position: "bottomright"});
    control.onAdd = () => el;
    control.addTo(m);
    return el;
}
