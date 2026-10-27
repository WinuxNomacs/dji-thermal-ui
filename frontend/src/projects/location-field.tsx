// A project's location on its form: an address or place searched for (on Enter, at most once a second: OpenStreetMap's
// Nominatim, credited under the results), or a point clicked on the map and named by its address; the label edited,
// or the location cleared
import {useRef, useState} from "preact/hooks";
import {Search, Trash} from "../components/icons";
import type {Basemap} from "../map/map";
import type {Location} from "./list";
import {LocationMap} from "./location-map";
import {findPlaces, placeAt} from "./places";

// Between two searches at least (ms), as Nominatim asks; the server keeps to it too
const SEARCH_INTERVAL = 1000;

interface Props {
    api: string;
    basemaps: Basemap[];
    location: Location | null;
    onChange: (l: Location | null) => void;
}

export function LocationField({api, basemaps, location, onChange}: Props) {
    const [query, setQuery] = useState("");
    const [found, setFound] = useState<Location[] | null>(null);    // null before a search
    const [credit, setCredit] = useState("");
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const lastSearch = useRef(0);
    const asked = useRef(0);        // the newest request: an older one's answer is dropped

    async function search() {
        const q = query.trim();
        if (!q) return setError("Type an address or a place to search for.");
        if (Date.now() - lastSearch.current < SEARCH_INTERVAL) return;
        lastSearch.current = Date.now();
        const n = ++asked.current;
        setError("");
        setStatus("Searching…");
        try {
            const r = await findPlaces(api, q);
            if (n !== asked.current) return;
            setFound(r.places);
            setCredit("Search by " + r.service + ", " + r.attribution);
            setStatus(r.places.length ? "" : "No places found: try another spelling, or click the site on the map.");
        } catch (e) {
            if (n !== asked.current) return;
            setStatus("");
            setError((e as Error).message);
        }
    }

    async function pick([lon, lat]: [number, number]) {
        const n = ++asked.current;
        onChange({lon, lat, label: ""});
        setFound(null);
        setError("");
        setStatus("Looking up the address…");
        try {
            const r = await placeAt(api, lon, lat);
            if (n !== asked.current) return;
            setCredit("Address by " + r.service + ", " + r.attribution);
            setStatus(r.places.length ? "" : "No address here: name the place below.");
            if (r.places.length) onChange({lon, lat, label: r.places[0].label});
        } catch (e) {
            if (n !== asked.current) return;
            setStatus("");
            setError((e as Error).message + " Name the place below.");
        }
    }

    function choose(p: Location) {
        asked.current++;
        onChange(p);
        setFound(null);
        setStatus("");
    }

    return (
        <div class="field location-field">
            <label for="location-search">Location</label>
            <div class="location-search">
                <input type="search" id="location-search" placeholder="Search an address or a place"
                       value={query} onInput={(e) => setQuery(e.currentTarget.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}/>
                <button type="button" class="button default" id="location-search-button" onClick={search}>
                    <Search/> Search</button>
            </div>
            {found && found.length > 0 && (
                <ul class="location-results" id="location-results">
                    {found.map((p, i) => (
                        <li key={i}><button type="button" onClick={() => choose(p)}>{p.label ||
                            p.lat.toFixed(6) + ", " + p.lon.toFixed(6)}</button></li>
                    ))}
                </ul>
            )}
            {status && <div class="hint" id="location-status" role="status">{status}</div>}
            {error && <div class="field-error" id="location-error" role="alert">{error}</div>}
            <LocationMap basemaps={basemaps} point={location} onPick={pick}/>
            <div class="hint location-credit">
                {credit ? credit + "." : "Search, or click the site on the map."}
            </div>
            {location && (
                <div class="location-chosen">
                    <label for="location-label">Address or place name</label>
                    <div class="location-search">
                        <input type="text" id="location-label" maxLength={255} value={location.label}
                               placeholder="Name the place"
                               onInput={(e) => onChange({...location, label: e.currentTarget.value})}/>
                        <button type="button" class="button default" id="location-clear" title="No location"
                                onClick={() => { asked.current++; setStatus(""); onChange(null); }}>
                            <Trash/> Clear</button>
                    </div>
                    <div class="hint" id="location-point">
                        {location.lat.toFixed(6) + ", " + location.lon.toFixed(6)}</div>
                </div>
            )}
        </div>
    );
}
