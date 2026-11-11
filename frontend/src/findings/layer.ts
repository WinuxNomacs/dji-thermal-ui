// The findings on a map: each spot, area or Delta T in a white-and-black dashed outline that reads on any palette (a
// spot as a ringed dot, a Delta T as its line with a ringed dot at each end), labelled with a tag in its severity's
// colour holding its name; the one opened drawn thicker.
import type {Coordinate} from "ol/coordinate";
import type Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import MultiPoint from "ol/geom/MultiPoint";
import GeoJSON from "ol/format/GeoJSON";
import type OlMap from "ol/Map";
import type {FeatureLike} from "ol/Feature";
import type {Pixel} from "ol/pixel";
import type VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import {lonLatToMap} from "../map/map";
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
    const lines = [new Style({stroke: under}), new Style({stroke: over, fill: new Fill({color: "rgba(255, 255, 255, 0.06)"}), text: label})];
    if (f.geometry.type !== "LineString") return lines;
    // A Delta T's two spots
    const ends = (feature: FeatureLike) => new MultiPoint((feature.getGeometry() as LineString).getCoordinates());
    return [...lines, new Style({geometry: ends, image: new CircleStyle({radius: 5, stroke: under})}),
            new Style({geometry: ends, image: new CircleStyle({radius: 5, stroke: over, fill: new Fill({color: "rgba(255, 255, 255, 0.25)"})})})];
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

// Where a finding is on the map: a spot's place, an area's outline's (a Delta T's ends') mean point
export function centreOf(f: Finding): Coordinate {
    const g = f.geometry;
    const ring = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates[0];
    const xs = ring.map((c) => lonLatToMap(c));
    return [xs.reduce((a, c) => a + c[0], 0) / xs.length, xs.reduce((a, c) => a + c[1], 0) / xs.length];
}
