import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {Project} from "../src/projects/list";
import {ProjectForm} from "../src/projects/project-form";
import {calls, click, jsonResponse, key, server, ticks} from "./helpers";

// The map a point is clicked on, as a button clicking one point
vi.mock("../src/projects/location-map", () => ({
    LocationMap: ({point, onPick}: {point: {lon: number; lat: number} | null; onPick: (c: [number, number]) => void}) => (
        <button type="button" id="fake-map" data-point={point ? point.lon + "," + point.lat : ""}
                onClick={() => onPick([-88.07, 42.1])}/>),
}));

const API = "/api/";
const SEARCH = API + "places?q=";
const AT = API + "places?lon=-88.0700000&lat=42.1000000";
const OSM = {service: "OpenStreetMap Nominatim", attribution: "© OpenStreetMap contributors"};
const FARM = {lon: -88.0701, lat: 42.1002, label: "1 Farm Road, Elgin, Illinois"};
const BARN = {lon: -88.2, lat: 42.3, label: "Red Barn, Elgin"};
const SILOS: Project = {
    id: 3, name: "Silos", description: "", location: null, dataset_count: 0, conversion_count: 0, mosaic_count: 0,
    measurement_count: 0, size: 0,
};

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const results = () => [...document.querySelectorAll("#location-results button")].map((b) => b.textContent);
const saved = (fetchFn: ReturnType<typeof server>) =>
    JSON.parse(fetchFn.mock.calls.find((c) => c[1]?.method === "PATCH")![1]!.body as string);

function type(el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("input", {bubbles: true}));
}

async function search(text: string) {
    type(byId<HTMLInputElement>("location-search"), text);
    await ticks();
    key(byId("location-search"), "Enter");
    await ticks();
}

function form(fetchFn: ReturnType<typeof server>, project: Project = SILOS) {
    vi.stubGlobal("fetch", fetchFn);
    const onSaved = vi.fn();
    render(<ProjectForm api={API} project={project} basemaps={[]} onSaved={onSaved} onClose={vi.fn()}/>, byId("root"));
    return onSaved;
}

beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"]});
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    render(null, byId("root"));
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("a project's location", () => {
    it("is searched for on Enter, credited to OpenStreetMap, and picked from the results", async () => {
        const fetchFn = server({[SEARCH + "1%20Farm%20Rd%2C%20Elgin"]: {...OSM, places: [FARM, BARN]},
                                ["PATCH " + API + "projects/3"]: SILOS});
        form(fetchFn);
        await search(" 1 Farm Rd, Elgin ");
        expect(results()).toEqual([FARM.label, BARN.label]);
        expect(document.querySelector(".location-credit")!.textContent)
            .toBe("Search by OpenStreetMap Nominatim, © OpenStreetMap contributors.");
        // Enter searched, and did not save the form
        expect(calls(fetchFn).some((c) => c.startsWith("PATCH"))).toBe(false);

        click(document.querySelectorAll("#location-results button")[1]);
        await ticks();
        expect(byId("location-results")).toBeNull();
        expect(byId("fake-map").dataset.point).toBe("-88.2,42.3");
        expect(byId<HTMLInputElement>("location-label").value).toBe(BARN.label);
        expect(byId("location-point").textContent).toBe("42.300000, -88.200000");
        click(byId("project-save"));
        await ticks();
        expect(saved(fetchFn).location).toEqual(BARN);
    });

    it("is searched at most once a second", async () => {
        const fetchFn = server({[SEARCH + "silos"]: {...OSM, places: [FARM]}});
        form(fetchFn);
        await search("silos");
        key(byId("location-search"), "Enter");
        await ticks();
        expect(calls(fetchFn)).toHaveLength(1);
        vi.setSystemTime(Date.now() + 1000);
        key(byId("location-search"), "Enter");
        await ticks();
        expect(calls(fetchFn)).toHaveLength(2);
    });

    it("says when nothing was found, when nothing was typed, and why a search failed", async () => {
        const fetchFn = server({
            [SEARCH + "nowhere"]: {...OSM, places: []},
            [SEARCH + "silos"]: () => Promise.resolve({ok: false, status: 502, json: () => Promise.resolve(
                {detail: "OpenStreetMap Nominatim could not be reached: is the computer online?"})} as Response),
        });
        form(fetchFn);
        await search("   ");
        expect(byId("location-error").textContent).toBe("Type an address or a place to search for.");
        expect(calls(fetchFn)).toEqual([]);

        await search("nowhere");
        expect(byId("location-status").textContent).toMatch(/^No places found/);
        expect(byId("location-results")).toBeNull();

        vi.setSystemTime(Date.now() + 1000);
        await search("silos");
        expect(byId("location-error").textContent)
            .toBe("OpenStreetMap Nominatim could not be reached: is the computer online?");
    });

    it("is a point clicked on the map, named by its address, and the name can be changed", async () => {
        const fetchFn = server({[AT]: {...OSM, places: [{lon: -88.07, lat: 42.1, label: FARM.label}]},
                                ["PATCH " + API + "projects/3"]: SILOS});
        form(fetchFn);
        click(byId("fake-map"));
        await ticks(1);
        expect(byId("location-status").textContent).toBe("Looking up the address…");
        await ticks();
        expect(byId<HTMLInputElement>("location-label").value).toBe(FARM.label);
        expect(document.querySelector(".location-credit")!.textContent)
            .toBe("Address by OpenStreetMap Nominatim, © OpenStreetMap contributors.");

        type(byId<HTMLInputElement>("location-label"), " North silos ");
        await ticks();
        click(byId("project-save"));
        await ticks();
        expect(saved(fetchFn).location).toEqual({lon: -88.07, lat: 42.1, label: "North silos"});
    });

    it("keeps a point with no address or whose address could not be asked, to be named by hand", async () => {
        form(server({[AT]: [{...OSM, places: []}, () => jsonResponse({detail: "OpenStreetMap Nominatim refused the search (429)"}, false)]}));
        click(byId("fake-map"));
        await ticks();
        expect(byId("location-status").textContent).toBe("No address here: name the place below.");
        expect(byId<HTMLInputElement>("location-label").value).toBe("");
        click(byId("fake-map"));
        await ticks();
        expect(byId("location-error").textContent)
            .toBe("OpenStreetMap Nominatim refused the search (429) Name the place below.");
        expect(byId("location-point").textContent).toBe("42.100000, -88.070000");
    });

    it("is cleared, and saved as none", async () => {
        const fetchFn = server({["PATCH " + API + "projects/3"]: SILOS});
        form(fetchFn, {...SILOS, location: FARM});
        expect(byId<HTMLInputElement>("location-label").value).toBe(FARM.label);
        click(byId("location-clear"));
        await ticks();
        expect(byId("location-label")).toBeNull();
        expect(byId("fake-map").dataset.point).toBe("");
        click(byId("project-save"));
        await ticks();
        expect(saved(fetchFn).location).toBeNull();
    });
});
