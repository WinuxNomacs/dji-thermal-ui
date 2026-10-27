// A project's page: its name, description and location, edited or deleted (with its datasets); where its datasets
// were flown, on a map; and its datasets
import {useEffect, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {ask} from "../components/dialog";
import {ArrowLeft, MapPin, Pencil, Trash} from "../components/icons";
import {DatasetsPage} from "../datasets/datasets-page";
import type {Basemap} from "../map/map";
import {AreasMap} from "./areas-map";
import {type ProjectDetail, projectDeleteText} from "./list";
import {ProjectForm} from "./project-form";

interface Props {
    api: string;
    publicUrl: string;
    id: number;
    basemaps: Basemap[];
    nav?: (url: string) => void;
}

export function ProjectPage({api, publicUrl, id, basemaps, nav = (url) => { location.href = url; }}: Props) {
    const [project, setProject] = useState<ProjectDetail | null>(null);
    const [notice, setNotice] = useState("");
    const [editing, setEditing] = useState(false);

    async function load() {
        try {
            const res = await fetch(api + "projects/" + id, {credentials: "same-origin"});
            if (!res.ok) throw new Error();
            setProject(await res.json());
        } catch {
            setNotice("Could not load the project.");
        }
    }

    useEffect(() => { load(); }, []);

    async function remove() {
        if (!project || !await ask("Delete project", projectDeleteText(project), "Delete", "danger")) return;
        const r = await readJson(await sendJson(api + "projects/" + id, "DELETE"));
        if (r.ok) return nav(publicUrl);
        setNotice(errorText(r.data, "Could not delete the project."));
    }

    const p = project;
    const top = (<>
        <div class="breadcrumb"><a href={publicUrl}><ArrowLeft/> Projects</a></div>
        <div class="page-header">
            <h1 id="project-name">{p ? p.name : ""}</h1>
            <div class="page-actions">
                <button type="button" class="button default" id="edit-project" disabled={!p}
                        onClick={() => setEditing(true)}><Pencil/> Edit</button>
                <button type="button" class="button default" id="delete-project" disabled={!p}
                        onClick={remove}><Trash/> Delete</button>
            </div>
        </div>
        {notice && <div class="notice error" role="alert">{notice}</div>}
        {p && (p.description || p.location) && (
            <div class="project-about">
                {p.location && <p class="project-location"><MapPin class="icon text-muted"/>{" "}
                    {p.location.label || p.location.lat.toFixed(6) + ", " + p.location.lon.toFixed(6)}</p>}
                {p.description && <p class="project-description" id="project-description">{p.description}</p>}
            </div>
        )}
        {p && (p.areas.length || p.location) ? (
            <AreasMap basemaps={basemaps} areas={p.areas} location={p.location}
                      open={(dataset) => nav(publicUrl + "dataset/" + dataset)}/>
        ) : null}
        {editing && p && <ProjectForm api={api} project={p} basemaps={basemaps} onClose={() => setEditing(false)}
                                      onSaved={() => { setEditing(false); load(); }}/>}
    </>);

    return <DatasetsPage api={api} publicUrl={publicUrl} project={id} top={top} onChange={load} nav={nav}/>;
}
