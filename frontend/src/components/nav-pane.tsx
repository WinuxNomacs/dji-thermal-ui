// The navigation pane on the left of every page: the projects, under each its datasets (flights), under each its
// conversions (datasets), under each with frames its Frames, then User Preferences, System Settings and Storage. The
// pages' own tabs and buttons do the rest. Projects, flights and datasets fold; what is folded is kept for the next
// visit, and the page shown is unfolded to (kept so too) and marked: a flight's report marks its flight, a
// conversion's pages the conversion, its frames its Frames. The pane lists again
// when a page says what it lists has changed. A filter under Projects lists only the projects whose name matches;
// like the folds, it is kept from page to page.
import {type ComponentChildren} from "preact";
import {useEffect, useState} from "preact/hooks";
import {conversionHref, conversionKey, type Current, datasetKey, fetchNavigation, framesKey, markedItem, type NavProject,
        onNavigationChanged, pathTo, projectKey, trailTo} from "../core/navigation";
import {matchesSearch} from "../core/search";
import {ChevronDown, ChevronRight, Cog, Folder, HardDrive, Monitor} from "./icons";
import {SearchBox} from "./search-box";

const EXPANDED_KEY = "thermal-analyzer.nav.expanded";
const SEARCH_KEY = "thermal-analyzer.nav.search";

function storedExpanded(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(EXPANDED_KEY) || "[]");
        // Only projects, flights and datasets fold (what else an older pane folded is forgotten)
        return Array.isArray(v) ? v.filter((k) => typeof k === "string" && /^[pdc]\d+$/.test(k)) : [];
    } catch {
        return [];
    }
}

function storeExpanded(keys: Set<string>): void {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...keys])); } catch { /* not remembered */ }
}

function storedSearch(): string {
    try { return localStorage.getItem(SEARCH_KEY) || ""; } catch { return ""; }
}

function storeSearch(query: string): void {
    try {
        if (query) localStorage.setItem(SEARCH_KEY, query); else localStorage.removeItem(SEARCH_KEY);
    } catch { /* not remembered */ }
}

export interface NavPaneProps {
    api: string;
    publicUrl: string;
    current: Current;
    onNavigate?: () => void;    // a link followed (the pane over a narrow page closes)
    onClose?: () => void;       // over a narrow page: its close button
}

interface ItemProps {
    itemKey?: string;           // one that folds: its key; none for a page without anything under it
    expanded: Set<string>;
    toggle: (key: string) => void;
    href: string;
    label: string;
    count?: number;             // how many it holds, shown after its label
    current: boolean;
    level: number;
    onNavigate?: () => void;
    children?: ComponentChildren;
}

function Item({itemKey, expanded, toggle, href, label, count, current, level, onNavigate, children}: ItemProps) {
    const open = !!itemKey && expanded.has(itemKey);
    return (<li class={"nav-item level-" + level}>
        <div class={"nav-row" + (current ? " current" : "")}>
            {itemKey ? <button type="button" class="nav-fold" aria-expanded={open} data-key={itemKey}
                               aria-label={(open ? "Fold " : "Unfold ") + label} onClick={() => toggle(itemKey)}>
                {open ? <ChevronDown/> : <ChevronRight/>}</button> : <span class="nav-fold-space"/>}
            <a href={href} aria-current={current ? "page" : undefined} title={label} onClick={onNavigate}>{label}
                {count !== undefined && <span class="nav-count">{count}</span>}</a>
        </div>
        {open && children}
    </li>);
}

type ItemBase = Pick<ItemProps, "expanded" | "toggle" | "onNavigate">;

// One of the settings pages, at the pane's foot
function SettingsPage({href, label, icon, current, onNavigate}: {href: string; label: string; icon: ComponentChildren;
                                                                current: boolean; onNavigate?: () => void}) {
    return (<li class="nav-item level-0 nav-setting">
        <div class={"nav-row" + (current ? " current" : "")}>
            {icon}<a href={href} aria-current={current ? "page" : undefined} onClick={onNavigate}>{label}</a>
        </div>
    </li>);
}

export function NavPane({api, publicUrl, current, onNavigate, onClose}: NavPaneProps) {
    const [projects, setProjects] = useState<NavProject[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [expanded, setExpanded] = useState(() => new Set(storedExpanded()));
    const [query, setQuery] = useState(storedSearch);

    useEffect(() => {
        let first = true;
        async function load() {
            try {
                const listed = await fetchNavigation(api);
                setProjects(listed);
                setFailed(false);
                if (first) {
                    // The page shown is unfolded to, and stays so as if unfolded by hand
                    first = false;
                    setExpanded((before) => {
                        const next = new Set([...before, ...pathTo(listed, current)]);
                        if (next.size > before.size) storeExpanded(next);
                        return next;
                    });
                }
            } catch {
                setFailed(true);
            }
        }
        load();
        return onNavigationChanged(load);
    }, [api]);

    function toggle(key: string) {
        setExpanded((before) => {
            const next = new Set(before);
            if (next.has(key)) next.delete(key); else next.add(key);
            storeExpanded(next);
            return next;
        });
    }

    function search(q: string) {
        setQuery(q);
        storeSearch(q);
    }

    const is = (name: string) => current.page === name;
    const shown = projects?.filter((p) => matchesSearch(p, query.trim())) ?? null;
    const marked = projects ? markedItem(trailTo(projects, current), expanded) : null;
    const item: ItemBase = {expanded, toggle, onNavigate};

    return (<nav class="app-nav" id="app-nav" aria-label="Projects and preferences">
        {onClose && <div class="nav-close"><button type="button" class="close" aria-label="Close the navigation"
                                                   title="Close the navigation" onClick={onClose}>×</button></div>}
        <ul class="nav-tree">
            <li class="nav-item level-0">
                <div class={"nav-row nav-home" + (is("projects") ? " current" : "")}>
                    <Folder/><a href={publicUrl} aria-current={is("projects") ? "page" : undefined} onClick={onNavigate}>
                        Projects</a>
                </div>
                {projects && projects.length > 0 && <div class="nav-search">
                    <SearchBox id="nav-search" label="Filter projects" query={query} setQuery={search}/></div>}
                {shown && !shown.length && projects!.length > 0 && <p class="nav-none text-muted">No projects match the filter.</p>}
                {shown && <ul>{shown.map((p) => (
                    <Item key={p.id} itemKey={p.datasets.length ? projectKey(p.id) : undefined} {...item} level={1}
                          href={publicUrl + "project/" + p.id} label={p.name || "(untitled)"} current={marked === projectKey(p.id)}>
                        <ul>{p.datasets.map((d) => (
                            <Item key={d.id} itemKey={d.conversions.length ? datasetKey(d.id) : undefined} {...item} level={2}
                                  href={publicUrl + "dataset/" + d.id} label={d.name || "(untitled)"}
                                  current={marked === datasetKey(d.id)}>
                                <ul>{d.conversions.map((c) => (
                                    <Item key={c.id} itemKey={c.frames ? conversionKey(c.id) : undefined} {...item} level={3}
                                          href={conversionHref(c, d.id, publicUrl)} label={c.name} current={marked === conversionKey(c.id)}>
                                        <ul><Item {...item} level={4} href={publicUrl + "conversion/" + c.id + "/frame"} label="Frames"
                                                  current={marked === framesKey(c.id)}/></ul>
                                    </Item>))}</ul>
                            </Item>))}</ul>
                    </Item>))}</ul>}
                {failed && <p class="nav-error text-muted">The projects could not be listed.</p>}
            </li>
            <SettingsPage href={publicUrl + "preferences"} label="User Preferences" icon={<Cog/>} current={is("preferences")}
                          onNavigate={onNavigate}/>
            <SettingsPage href={publicUrl + "settings"} label="System Settings" icon={<Monitor/>} current={is("settings")}
                          onNavigate={onNavigate}/>
            <SettingsPage href={publicUrl + "settings/storage"} label="Storage" icon={<HardDrive/>} current={is("storage")}
                          onNavigate={onNavigate}/>
        </ul>
    </nav>);
}
