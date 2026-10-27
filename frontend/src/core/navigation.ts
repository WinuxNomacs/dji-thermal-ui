// What the navigation pane lists (the API's navigation: the projects, their datasets and the datasets' conversions),
// the page being shown in it, and the pages' word that what it lists has changed
import {readJson} from "./api";

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

// Each item's key in the pane, for what is expanded: "p1", "d4", "c12"
export const projectKey = (id: number) => "p" + id;
export const datasetKey = (id: number) => "d" + id;
export const conversionKey = (id: number) => "c" + id;

const CONVERSION_PAGES = ["viewer", "frame", "compare"];

// The items above the page shown, which are expanded so that it can be seen: its project, dataset and conversion
export function pathTo(projects: NavProject[], current: Current): string[] {
    for (const p of projects) {
        if (current.page === "project" && p.id === current.id) return [];
        for (const d of p.datasets) {
            if (current.page === "dataset" && d.id === current.id) return [projectKey(p.id)];
            for (const c of d.conversions) {
                if (CONVERSION_PAGES.includes(current.page) && c.id === current.id) {
                    return [projectKey(p.id), datasetKey(d.id), conversionKey(c.id)];
                }
            }
        }
    }
    return [];
}

// A conversion's pages, as the pane offers them: its mosaics once built, its frames once converted, and comparing
// its mosaics with another's
export function conversionPages(c: NavConversion, publicUrl: string): {page: string; label: string; href: string}[] {
    const base = publicUrl + "conversion/" + c.id;
    const out: {page: string; label: string; href: string}[] = [];
    if (c.mosaics) out.push({page: "viewer", label: "Mosaics", href: base});
    if (c.frames) out.push({page: "frame", label: "Frames", href: base + "/frame"});
    if (c.mosaics) out.push({page: "compare", label: "Compare", href: base + "/compare"});
    return out;
}
