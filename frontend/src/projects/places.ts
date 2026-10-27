// Places for a project's location, from OpenStreetMap through the app's server (which keeps to Nominatim's usage
// policy): those a text names, or the one at a point
import {errorText, readJson} from "../core/api";
import type {Location} from "./list";

export interface Places {places: Location[]; service: string; attribution: string}

async function ask(url: string): Promise<Places> {
    let res: Response;
    try {
        res = await fetch(url, {credentials: "same-origin"});
    } catch {
        throw new Error("Could not reach the app to search.");
    }
    const r = await readJson<Places>(res);
    if (!r.ok) throw new Error(errorText(r.data, "The search failed."));
    return r.data;
}

export const findPlaces = (api: string, query: string) => ask(api + "places?q=" + encodeURIComponent(query));

export const placeAt = (api: string, lon: number, lat: number) =>
    ask(api + "places?lon=" + lon.toFixed(7) + "&lat=" + lat.toFixed(7));
