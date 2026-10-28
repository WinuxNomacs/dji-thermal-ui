// What the navigation pane lists (the API's navigation: the projects, their datasets and the datasets' conversions),
// the page being shown in it, and the pages' word that what it lists, or the part of the page shown, has changed
import {tabLabel} from "../viewer/tab-labels";
import {readJson} from "./api";

// A conversion's mosaics, once built: the viewer's tabs, and how many frames they placed and left out
export interface NavConversion {id: number; name: string; frames: boolean; mosaics: boolean; tabs?: string[];
                                in_mosaic?: number; oblique?: number}
export interface NavDataset {id: number; name: string; conversions: NavConversion[]}
export interface NavProject {id: number; name: string; datasets: NavDataset[]}

// The page shown: its entry (templates' data-page), the id of what it shows, and the part of it shown (the viewer's
// tab, the frame page's list), from its URL
export interface Current {page: string; id: number; part?: string | null}

// A page in the pane: its key (see projectKey), and the pages under it, for one that folds
export interface NavItem {key: string; label: string; href: string; count?: number; items?: NavItem[]}

const CHANGED = "thermal-analyzer:navigation";
const PART_CHANGED = "thermal-analyzer:part";

// Called by a page when it made, renamed or deleted a project, a dataset or a conversion, or a conversion's frames or
// mosaics became ready: the pane lists them again
export function navigationChanged(): void { window.dispatchEvent(new Event(CHANGED)); }

export function onNavigationChanged(f: () => void): () => void {
    window.addEventListener(CHANGED, f);
    return () => window.removeEventListener(CHANGED, f);
}

// Called by a page when the part of it shown changed in its URL (another tab, another list): the pane marks it
export function partChanged(): void { window.dispatchEvent(new Event(PART_CHANGED)); }

export function onPartChanged(f: () => void): () => void {
    window.addEventListener(PART_CHANGED, f);
    return () => window.removeEventListener(PART_CHANGED, f);
}

// The part of a page its URL shows: the viewer's tab, the frame page's list
export function partOf(page: string, search: string): string | null {
    const q = new URLSearchParams(search);
    return page === "viewer" ? q.get("tab") : page === "frame" ? q.get("list") : null;
}

export async function fetchNavigation(api: string): Promise<NavProject[]> {
    const res = await fetch(api + "navigation", {credentials: "same-origin"});
    const {ok, data} = await readJson<{projects?: NavProject[]}>(res);
    if (!ok || !Array.isArray(data.projects)) throw new Error("not listed: " + res.status);
    return data.projects;
}

// Each item's key in the pane, for what is expanded and marked: "p1", "d4", "c12", and under a conversion its groups
// and their pages ("c12.mosaics", "c12.mosaics.harmonized")
export const projectKey = (id: number) => "p" + id;
export const datasetKey = (id: number) => "d" + id;
export const conversionKey = (id: number) => "c" + id;

// The frame page's lists, once there are mosaics: the frames they placed, and those they left out for their angle
// (or as unusable)
export const FRAME_LISTS: [string, string][] = [["mosaic", "Mosaic"], ["oblique", "Oblique"]];

// What the pane offers under a conversion: its tools (comparing its mosaics with another's, its mosaic report), its
// mosaics (the viewer's tabs) once built, and its frames once converted (in the mosaic or oblique, once there are
// mosaics)
export function conversionItems(c: NavConversion, publicUrl: string): NavItem[] {
    const base = publicUrl + "conversion/" + c.id, key = conversionKey(c.id);
    const out: NavItem[] = [];
    if (c.mosaics) {
        out.push({key: key + ".tools", label: "Tools", href: base + "/compare", items: [
            {key: key + ".tools.compare", label: "Compare", href: base + "/compare"},
            {key: key + ".tools.report", label: "Report", href: base + "/report"},
        ]});
        out.push({key: key + ".mosaics", label: "Mosaics", href: base, items: (c.tabs || []).map((tab) => (
            {key: key + ".mosaics." + tab, label: tabLabel(tab), href: base + "?tab=" + encodeURIComponent(tab)}))});
    }
    if (c.frames) {
        const counts: Record<string, number | undefined> = {mosaic: c.in_mosaic, oblique: c.oblique};
        out.push({key: key + ".frames", label: "Frames", href: base + "/frame", items: c.mosaics ? FRAME_LISTS.map(([list, label]) => (
            {key: key + ".frames." + list, label, href: base + "/frame?list=" + list, count: counts[list]})) : undefined});
    }
    return out;
}

// Where a conversion's own item goes: its mosaics, else its frames, else its dataset's Convert tab
export function conversionHref(c: NavConversion, datasetId: number, publicUrl: string): string {
    const base = publicUrl + "conversion/" + c.id;
    return c.mosaics ? base : c.frames ? base + "/frame" : publicUrl + "dataset/" + datasetId + "#convert";
}

// The page of a conversion's that each pane group holds, and the part of it a page of the group shows
const GROUPS: Record<string, string> = {compare: "tools", conversion_report: "tools", viewer: "mosaics", frame: "frames"};
const TOOLS: Record<string, string> = {compare: "compare", conversion_report: "report"};

// The items down to the page shown, from its project: those above it are expanded so that it can be seen, and the
// deepest of them that can be seen is marked
export function trailTo(projects: NavProject[], current: Current): string[] {
    for (const p of projects) {
        if (current.page === "project" && p.id === current.id) return [projectKey(p.id)];
        for (const d of p.datasets) {
            const above = [projectKey(p.id), datasetKey(d.id)];
            if (current.page === "dataset" && d.id === current.id) return above;
            if (current.page === "dataset_report" && d.id === current.id) return [...above, datasetKey(d.id) + ".report"];
            for (const c of d.conversions) {
                const group = GROUPS[current.page];
                if (!group || c.id !== current.id) continue;
                const items = conversionItems(c, "");
                const g = items.find((x) => x.key === conversionKey(c.id) + "." + group);
                const trail = [...above, conversionKey(c.id)];
                if (!g) return trail;
                const part = TOOLS[current.page] || current.part;
                const leaf = g.items?.find((x) => x.key === g.key + "." + part);
                return [...trail, g.key, ...(leaf ? [leaf.key] : [])];
            }
        }
    }
    return [];
}

// The items above the page shown, which are expanded so that it can be seen
export function pathTo(projects: NavProject[], current: Current): string[] {
    return trailTo(projects, current).slice(0, -1);
}

// The item marked: the deepest down to the page shown that can be seen (every item above it expanded)
export function markedItem(trail: string[], expanded: Set<string>): string | null {
    const folded = trail.findIndex((k) => !expanded.has(k));
    return trail.length ? trail[folded === -1 ? trail.length - 1 : folded] : null;
}
