// The app's landing page: the projects, each a site's datasets together, searched; New Project, a project imported
// (from an archive another's page exported), changed or deleted (with its datasets, after saying what goes with it)
import {useEffect, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {count, formatBytes, formatDate} from "../core/format";
import {ask} from "../components/dialog";
import {MapPin, Pencil, Plus, Trash, Upload} from "../components/icons";
import {matchesSearch} from "../datasets/list";
import type {Basemap} from "../map/map";
import {ImportDialog} from "./import-dialog";
import {type Project, projectDeleteText} from "./list";
import {ProjectForm} from "./project-form";

interface Props {
    api: string;
    publicUrl: string;
    basemaps: Basemap[];
    nav?: (url: string) => void;
}

export function ProjectsPage({api, publicUrl, basemaps, nav = (url) => { location.href = url; }}: Props) {
    const [projects, setProjects] = useState<Project[] | null>(null);       // null until first loaded
    const [notice, setNotice] = useState("");
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState<Project | "new" | null>(null);
    const [importing, setImporting] = useState(false);

    async function load() {
        try {
            const res = await fetch(api + "projects", {credentials: "same-origin"});
            setProjects((await res.json()).projects);
        } catch {
            setNotice("Could not load the projects.");
        }
    }

    useEffect(() => { load(); }, []);

    async function remove(p: Project) {
        if (!await ask("Delete project", projectDeleteText(p), "Delete", "danger")) return;
        const r = await readJson(await sendJson(api + "projects/" + p.id, "DELETE"));
        setNotice(r.ok ? "" : errorText(r.data, "Could not delete the project."));
        load();
    }

    function saved(p: Project) {
        const made = editing === "new";
        setEditing(null);
        if (made) return nav(publicUrl + "project/" + p.id);
        load();
    }

    const shown = (projects || []).filter((p) => matchesSearch(p, query.trim()));
    const message = projects === null ? (notice ? "" : "Loading…") :
        !shown.length ? "No projects match the search." : "";

    return (
        <div class="page projects">
            <div class="page-header">
                <h1>Projects</h1>
                <div class="page-actions">
                    <input type="search" id="search" placeholder="Search projects" aria-label="Search projects"
                           value={query} onInput={(e) => setQuery(e.currentTarget.value)}/>
                    <button type="button" class="button default" id="import-project-button" disabled={!projects}
                            onClick={() => setImporting(true)}><Upload/> Import</button>
                    <button type="button" class="button primary" id="new-project-button"
                            onClick={() => setEditing("new")}><Plus/> New Project</button>
                </div>
            </div>

            {notice && <div class="notice error" role="alert">{notice}</div>}
            {message && <div class="message" id="message">{message}</div>}

            {shown.length > 0 && (
                <div class="table-scroll">
                    <table class="table" id="projects">
                        <thead><tr>
                            <th>Name</th><th>Location</th><th>Flights</th>
                            <th title="Datasets of its flights">Datasets</th>
                            <th title="Findings saved on its flights">Findings</th>
                            <th title="The disk space its flights take in the app">Size</th><th>Created</th>
                            <th><span class="sr-only">Actions</span></th>
                        </tr></thead>
                        <tbody>
                            {shown.map((p) => (
                                <tr key={p.id} data-id={p.id}>
                                    <td><a href={publicUrl + "project/" + p.id}>{p.name || "(untitled)"}</a>
                                        {p.description && <div class="text-muted project-description">
                                            {p.description.split("\n")[0]}</div>}</td>
                                    <td>{p.location && <span title={p.location.lat.toFixed(6) + ", " +
                                                                    p.location.lon.toFixed(6)}>
                                        <MapPin class="icon text-muted"/> {p.location.label || "A point on the map"}
                                    </span>}</td>
                                    <td>{p.dataset_count}</td>
                                    <td>{p.conversion_count || ""}</td>
                                    <td>{p.finding_count || ""}</td>
                                    <td>{p.size ? formatBytes(p.size) : ""}</td>
                                    <td>{formatDate(p.created_at)}</td>
                                    <td class="actions">
                                        <button type="button" class="icon-button edit" title="Edit" aria-label="Edit"
                                                onClick={() => setEditing(p)}><Pencil/></button>
                                        <button type="button" class="icon-button delete"
                                                title={"Delete, with its " + count(p.dataset_count, "flight", "flights")}
                                                aria-label="Delete" onClick={() => remove(p)}><Trash/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {editing && <ProjectForm api={api} basemaps={basemaps} project={editing === "new" ? undefined : editing}
                                     onSaved={saved} onClose={() => setEditing(null)}/>}
            {importing && <ImportDialog api={api} taken={(projects || []).map((p) => p.name)}
                                        onClose={() => setImporting(false)}
                                        onImported={(p) => nav(publicUrl + "project/" + p.id)}/>}
        </div>
    );
}
