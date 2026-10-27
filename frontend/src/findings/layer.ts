// The findings on a map: each spot or area in a white-and-black dashed outline that reads on any palette (a spot as a
// ringed dot), labelled with a tag in its severity's colour holding its name; the one opened drawn thicker.
import type Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type OlMap from "ol/Map";
import type {Pixel} from "ol/pixel";
import type VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import {type Finding, SEVERITY_COLORS} from "./findings";

function styles(f: Finding, opened: boolean): Style[] {
    const width = opened ? 3 : 2;
    const under = new Stroke({color: "rgba(0, 0, 0, 0.85)", width: width + 2});
    const over = new Stroke({color: "#fff", width, lineDash: [6, 5]});
    const label = new Text({
        text: f.name, font: "600 12px system-ui, sans-serif", fill: new Fill({color: "#fff"}),
        backgroundFill: new Fill({color: SEVERITY_COLORS[f.severity] || SEVERITY_COLORS.medium}),
        backgroundStroke: new Stroke({color: "rgba(0, 0, 0, 0.6)", width: 1}),
        padding: [2, 5, 1, 5], offsetY: f.geometry.type === "Point" ? -18 : 0, overflow: true,
    });
    if (f.geometry.type === "Point") {
        return [new Style({image: new CircleStyle({radius: 7, stroke: under})}),
                new Style({image: new CircleStyle({radius: 7, stroke: over, fill: new Fill({color: "rgba(255, 255, 255, 0.25)"})}),
                           text: label})];
    }
    return [new Style({stroke: under}), new Style({stroke: over, fill: new Fill({color: "rgba(255, 255, 255, 0.06)"}), text: label})];
}

// The findings shown drawn on a layer's source (opened: the one in the window)
export function drawFindings(source: VectorSource, items: Finding[], opened: number | null) {
    source.clear();
    const reader = new GeoJSON();
    items.forEach((f) => {
        const read = reader.readFeature({type: "Feature", geometry: f.geometry, properties: {finding: f.id}},
                                        {featureProjection: "EPSG:3857"});
        (Array.isArray(read) ? read : [read]).forEach((x) => {
            x.setStyle(styles(f, f.id === opened));
            source.addFeature(x as Feature);
        });
    });
}

// The finding drawn at a pixel of the map, if any (the topmost)
export function findingAt(map: OlMap, pixel: Pixel, source: VectorSource): number | null {
    let found: number | null = null;
    map.forEachFeatureAtPixel(pixel, (x) => {
        if (found === null && source.hasFeature(x as Feature) && typeof x.get("finding") === "number") found = x.get("finding");
    }, {hitTolerance: 4});
    return found;
}
