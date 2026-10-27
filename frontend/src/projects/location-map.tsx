// The map a project's location is picked on: the basemaps, the point as a pin, and a click picking another point
import type OlMap from "ol/Map";
import type VectorSource from "ol/source/Vector";
import {useEffect, useRef} from "preact/hooks";
import {type Basemap, lonLatToMap, mapToLonLat, mosaicMap, pointFeature, vectorLayer} from "../map/map";
import {PIN} from "./areas-map";
import type {Location} from "./list";

// The zoom a point found is shown at, close enough to see the buildings
const PLACE_ZOOM = 17;

interface Props {
    basemaps: Basemap[];
    point: Location | null;
    onPick: (lonLat: [number, number]) => void;
}

export function LocationMap({basemaps, point, onPick}: Props) {
    const el = useRef<HTMLDivElement>(null);
    const map = useRef<OlMap | null>(null);
    const drawn = useRef<VectorSource | null>(null);
    const pickRef = useRef(onPick);
    pickRef.current = onPick;

    useEffect(() => {
        const m = mosaicMap(el.current!, basemaps).map;
        map.current = m;
        drawn.current = vectorLayer(m);
        m.on("click", (e) => {
            const [lon, lat] = mapToLonLat(e.coordinate);
            pickRef.current([lon, lat]);
        });
        return () => m.setTarget(undefined);
    }, []);

    // The pin; a point out of sight (one found by a search) is brought into view, close up
    const at = point ? point.lon + "," + point.lat : "";
    useEffect(() => {
        const source = drawn.current!, view = map.current!.getView();
        source.clear();
        if (!point) return;
        const c = lonLatToMap([point.lon, point.lat]);
        const pin = pointFeature(c);
        pin.setStyle(PIN);
        source.addFeature(pin);
        const size = map.current!.getSize();
        const shown = size && size[0] && size[1] ? view.calculateExtent(size) : null;
        const inView = shown && c[0] >= shown[0] && c[0] <= shown[2] && c[1] >= shown[1] && c[1] <= shown[3];
        if (!inView || view.getZoom()! < PLACE_ZOOM - 3) {
            view.setCenter(c);
            view.setZoom(PLACE_ZOOM);
        }
    }, [at]);

    return <div class="map location-map" id="location-map" ref={el}/>;
}
