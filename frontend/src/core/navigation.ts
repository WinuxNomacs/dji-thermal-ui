// What the navigation pane lists (the API's navigation: the projects, their datasets and the datasets' conversions),
// the page being shown in it, and the pages' word that what it lists has changed
import {readJson} from "./api";

// A conversion: whether it has frames (once converted) and mosaics (once built) to open
export interface NavConversion {id: number; name: string; frames: boolean; mosaics: boolean}
export interface NavDataset {id: number; name: string; conversions: NavConversion[]}
export interface NavProject {id: number; name: string; datasets: NavDataset[]}

// The page shown: its entry (templates' data-page) and the id of what it shows
export interface Current {page: string; id: number}

const CHANGED = "thermal-analyzer:navigation";

// Called by a page when it made, renamed or deleted a project, a dataset or a conversion, or a conversion's frames or
// mosaics became ready: the pane lists them again
export function navigationChanged(): void { window.dispatchEvent(new Event(CHANGED)); }

export function onNavigationChanged(f: () => void): () => void {
    window.addEventListener(CHANGED, f);
    return () => window.removeEventListener(CHANGED, f);
}

export async function fetchNavigation(api: string): Promise<NavProject[]> {
    const res = await fetch(api + "navigation", {credentials: "same-origin"});
    const {ok, data} = await readJson<{projects?: NavProject[]}>(res);
    if (!ok || !Array.isArray(data.projects)) throw new Error("not listed: " + res.status);
    return data.projects;
}

// Each item's key in the pane, for what is unfolded and marked: "p1", "d4", "c12", and "f12" for a conversion's Frames
export const projectKey = (id: number) => "p" + id;
export const datasetKey = (id: number) => "d" + id;
export const conversionKey = (id: number) => "c" + id;
export const framesKey = (id: number) => "f" + id;

// Where a conversion's item goes: its mosaics, else its frames, else its flight's Datasets tab
export function conversionHref(c: NavConversion, datasetId: number, publicUrl: string): string {
    const base = publicUrl + "conversion/" + c.id;
    return c.mosaics ? base : c.frames ? base + "/frame" : publicUrl + "dataset/" + datasetId + "#datasets";
}

// The pages of a conversion's: its mosaics, comparing them, its mosaic report and its frames
const CONVERSION_PAGES = ["viewer", "compare", "conversion_report", "frame"];

// The items down to the page shown, from its project: a flight's report shows its flight, a conversion's pages the
// conversion, and its frames its Frames item (when it has frames). Those above it are unfolded so that it can be
// seen, and the deepest of them that can be seen is marked
export function trailTo(projects: NavProject[], current: Current): string[] {
    for (const p of projects) {
        if (current.page === "project" && p.id === current.id) return [projectKey(p.id)];
        for (const d of p.datasets) {
            const above = [projectKey(p.id), datasetKey(d.id)];
            if ((current.page === "dataset" || current.page === "dataset_report") && d.id === current.id) return above;
            const c = CONVERSION_PAGES.includes(current.page) && d.conversions.find((x) => x.id === current.id);
            if (c) return [...above, conversionKey(c.id), ...(current.page === "frame" && c.frames ? [framesKey(c.id)] : [])];
        }
    }
    return [];
}

// The items above the page shown, which are unfolded so that it can be seen
export function pathTo(projects: NavProject[], current: Current): string[] {
    return trailTo(projects, current).slice(0, -1);
}

// The item marked: the deepest down to the page shown that can be seen (every item above it unfolded)
export function markedItem(trail: string[], expanded: Set<string>): string | null {
    const folded = trail.findIndex((k) => !expanded.has(k));
    return trail.length ? trail[folded === -1 ? trail.length - 1 : folded] : null;
}
