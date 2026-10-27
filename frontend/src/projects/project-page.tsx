// A project's page: its name, description and location, edited or deleted (with its datasets); where its datasets
// were flown, on a map; its datasets' findings together; and its datasets
import {useEffect, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {ask} from "../components/dialog";
import {ArrowLeft, MapPin, Pencil, Trash} from "../components/icons";
import {formatDate} from "../core/format";
import {type Finding, statusLabel, temperaturesText} from "../findings/findings";
import {SeverityChip} from "../findings/panel";
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

// The project's findings, each opening the viewer on the mosaics its temperatures were read on (or its dataset's
// newest: plain text when its dataset has none)
function ProjectFindings({items, publicUrl}: {items: Finding[]; publicUrl: string}) {
    return (<section class="project-findings">
        <h2>Findings</h2>
        <div class="table-scroll">
            <table class="table" id="findings">
                <thead><tr><th>Severity</th><th>Name</th><th>Dataset</th><th>Status</th><th>Temperatures</th><th>Saved</th></tr></thead>
                <tbody>{items.map((f) => (<tr key={f.id} data-id={f.id}>
                    <td><SeverityChip severity={f.severity}/></td>
                    <td>{f.opens ? <a href={publicUrl + "conversion/" + f.opens + "?finding=" + f.id}>{f.name}</a> : f.name}
                        {f.notes && <div class="text-muted project-description">{f.notes.split("\n")[0]}</div>}</td>
                    <td><a href={publicUrl + "dataset/" + f.dataset}>{f.dataset_name}</a></td>
                    <td>{statusLabel(f.status)}</td>
                    <td>{temperaturesText(f.temperatures)}</td>
                    <td>{formatDate(f.created_at)}</td>
                </tr>))}</tbody>
            </table>
        </div>
    </section>);
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
        {p && (p.findings || []).length > 0 && <ProjectFindings items={p.findings!} publicUrl={publicUrl}/>}
        {editing && p && <ProjectForm api={api} project={p} basemaps={basemaps} onClose={() => setEditing(false)}
                                      onSaved={() => { setEditing(false); load(); }}/>}
    </>);

    return <DatasetsPage api={api} publicUrl={publicUrl} project={id} top={top} onChange={load} nav={nav}/>;
}
