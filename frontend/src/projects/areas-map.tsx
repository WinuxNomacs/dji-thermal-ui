// A project's map: where each of its datasets was flown (named, a click opens the dataset) and the project's location,
// over the basemaps
import Feature from "ol/Feature";
import type OlMap from "ol/Map";
import type VectorSource from "ol/source/Vector";
import Polygon from "ol/geom/Polygon";
import {boundingExtent} from "ol/extent";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import {useEffect, useRef} from "preact/hooks";
import {type Basemap, fitBounds, hoverTips, lonLatToMap, mosaicMap, pointFeature, vectorLayer} from "../map/map";
import type {Area, Location} from "./list";

const COLOR = "#00e5ff";
// The project's location
export const PIN = new Style({image: new CircleStyle({radius: 7, stroke: new Stroke({color: "#fff", width: 2}),
                                               fill: new Fill({color: "#e53935"})})});
const areaStyle = (name: string) => new Style({
    stroke: new Stroke({color: COLOR, width: 2}), fill: new Fill({color: "rgba(0, 229, 255, 0.12)"}),
    text: new Text({text: name, font: "600 13px system-ui, sans-serif", overflow: true,
                    fill: new Fill({color: "#fff"}), stroke: new Stroke({color: "rgba(0, 0, 0, 0.75)", width: 3})}),
});

const MAX_FIT_ZOOM = 18;

interface Props {
    basemaps: Basemap[];
    areas: Area[];
    location: Location | null;
    open: (dataset: number) => void;
}

export function AreasMap({basemaps, areas, location, open}: Props) {
    const el = useRef<HTMLDivElement>(null);
    const map = useRef<OlMap | null>(null);
    const drawn = useRef<VectorSource | null>(null);
    const openRef = useRef(open);
    openRef.current = open;

    useEffect(() => {
        const m = mosaicMap(el.current!, basemaps).map;
        map.current = m;
        drawn.current = vectorLayer(m);
        hoverTips(m);
        m.on("click", (e) => {
            const f = m.forEachFeatureAtPixel(e.pixel, (x) => x.get("dataset") ? x : undefined);
            if (f) openRef.current(f.get("dataset"));
        });
        m.on("pointermove", (e) => {
            if (e.dragging) return;
            const over = m.forEachFeatureAtPixel(e.pixel, (x) => x.get("dataset") ? true : undefined);
            m.getViewport()!.style.cursor = over ? "pointer" : "";
        });
        return () => m.setTarget(undefined);
    }, []);

    // What is drawn, and the map fitted to it, each time it changes (not each time the page loads the project again)
    const drawing = JSON.stringify([areas, location]);
    useEffect(() => {
        const m = map.current!, source = drawn.current!;
        source.clear();
        const points: number[][] = [];
        areas.forEach((a) => {
            const ring = a.ring.map((c) => lonLatToMap(c));
            points.push(...ring);
            const f = new Feature({geometry: new Polygon([ring]), dataset: a.dataset, tip: a.name});
            f.setStyle(areaStyle(a.name));
            source.addFeature(f);
        });
        if (location) {
            const at = lonLatToMap([location.lon, location.lat]);
            points.push(at);
            const pin = pointFeature(at, {tip: location.label || "The project's location"});
            pin.setStyle(PIN);
            source.addFeature(pin);
        }
        if (points.length) {
            const fit = () => {
                if (!fitBounds(m, boundingExtent(points), true, 40)) return false;
                if (m.getView().getZoom()! > MAX_FIT_ZOOM) m.getView().setZoom(MAX_FIT_ZOOM);
                return true;
            };
            if (!fit()) m.once("change:size", fit);
        }
    }, [drawing]);

    return <div class="map project-map" id="project-map" ref={el}/>;
}
