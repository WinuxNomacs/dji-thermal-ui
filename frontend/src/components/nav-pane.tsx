// The navigation pane on the left of every page: the projects, under each its datasets, under each its conversions
// with their tools, mosaics and frames, and User Preferences last. Each level folds; what is folded is kept for the
// next visit, and the page shown is always unfolded to and marked (down to the viewer's tab or the frame page's list
// it shows). The pane lists again when a page says what it lists has changed.
import {type ComponentChildren} from "preact";
import {useEffect, useState} from "preact/hooks";
import {conversionHref, conversionItems, conversionKey, type Current, datasetKey, fetchNavigation, markedItem,
        type NavItem, type NavProject, onNavigationChanged, onPartChanged, partOf, pathTo, projectKey,
        trailTo} from "../core/navigation";
import {ChevronDown, ChevronRight, Cog, Folder} from "./icons";

const EXPANDED_KEY = "thermal-analyzer.nav.expanded";

function storedExpanded(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(EXPANDED_KEY) || "[]");
        return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
    } catch {
        return [];
    }
}

function storeExpanded(keys: Set<string>): void {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...keys])); } catch { /* not remembered */ }
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

// An item from the conversion's, with those under it
function Pages({x, level, marked, item}: {x: NavItem; level: number; marked: string | null; item: ItemBase}) {
    return (<Item itemKey={x.items?.length ? x.key : undefined} {...item} level={level} href={x.href} label={x.label}
                  count={x.count} current={marked === x.key}>
        {x.items && <ul>{x.items.map((y) => <Pages key={y.key} x={y} level={level + 1} marked={marked} item={item}/>)}</ul>}
    </Item>);
}

type ItemBase = Pick<ItemProps, "expanded" | "toggle" | "onNavigate">;

export function NavPane({api, publicUrl, current: page, onNavigate, onClose}: NavPaneProps) {
    // The part of the page shown, as its URL has it now
    const [part, setPart] = useState(() => page.part ?? partOf(page.page, location.search));
    const current = {...page, part};
    const [projects, setProjects] = useState<NavProject[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [expanded, setExpanded] = useState(() => new Set(storedExpanded()));

    useEffect(() => {
        let first = true;
        async function load() {
            try {
                const listed = await fetchNavigation(api);
                setProjects(listed);
                setFailed(false);
                if (first) {
                    // The page shown is unfolded to
                    first = false;
                    setExpanded((before) => new Set([...before, ...pathTo(listed, current)]));
                }
            } catch {
                setFailed(true);
            }
        }
        load();
        return onNavigationChanged(load);
    }, [api]);

    // Another part of the page shown (the viewer's tab changed): marked, and unfolded to
    useEffect(() => onPartChanged(() => {
        const next = partOf(page.page, location.search);
        setPart(next);
        if (projects) setExpanded((before) => new Set([...before, ...pathTo(projects, {...page, part: next})]));
    }), [projects]);

    function toggle(key: string) {
        setExpanded((before) => {
            const next = new Set(before);
            if (next.has(key)) next.delete(key); else next.add(key);
            storeExpanded(next);
            return next;
        });
    }

    const is = (name: string) => current.page === name;
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
                {projects && <ul>{projects.map((p) => (
                    <Item key={p.id} itemKey={p.datasets.length ? projectKey(p.id) : undefined} {...item} level={1}
                          href={publicUrl + "project/" + p.id} label={p.name || "(untitled)"} current={marked === projectKey(p.id)}>
                        <ul>{p.datasets.map((d) => (
                            <Item key={d.id} itemKey={datasetKey(d.id)} {...item} level={2}
                                  href={publicUrl + "dataset/" + d.id} label={d.name || "(untitled)"}
                                  current={marked === datasetKey(d.id)}>
                                <ul><Item key="report" {...item} level={3} href={publicUrl + "dataset/" + d.id + "/report"}
                                          label="Report" current={marked === datasetKey(d.id) + ".report"}/>
                                    {d.conversions.map((c) => {
                                        const items = conversionItems(c, publicUrl);
                                        return (<Item key={c.id} itemKey={items.length ? conversionKey(c.id) : undefined} {...item}
                                                      level={3} href={conversionHref(c, d.id, publicUrl)} label={c.name}
                                                      current={marked === conversionKey(c.id)}>
                                            <ul>{items.map((x) => <Pages key={x.key} x={x} level={4} marked={marked} item={item}/>)}</ul>
                                        </Item>);
                                    })}</ul>
                            </Item>))}</ul>
                    </Item>))}</ul>}
                {failed && <p class="nav-error text-muted">The projects could not be listed.</p>}
            </li>
            <li class="nav-item level-0 nav-preferences">
                <div class={"nav-row" + (is("preferences") ? " current" : "")}>
                    <Cog/><a href={publicUrl + "preferences"} aria-current={is("preferences") ? "page" : undefined}
                             onClick={onNavigate}>User Preferences</a>
                </div>
            </li>
        </ul>
    </nav>);
}
