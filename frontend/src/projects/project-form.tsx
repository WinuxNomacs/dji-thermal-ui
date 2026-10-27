// A project's form, to make one or change it: its name and description (its location is kept as it is)
import {useLayoutEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import type {Project} from "./list";

interface Props {
    api: string;
    project?: Project;                          // the one changed; a new one when left out
    onSaved: (p: Project) => void;
    onClose: () => void;
}

export function ProjectForm({api, project, onSaved, onClose}: Props) {
    const [name, setName] = useState(project ? project.name : "");
    const [description, setDescription] = useState(project ? project.description : "");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    useLayoutEffect(() => {
        nameRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    async function save() {
        if (!name.trim()) return setError("Give the project a name.");
        setError("");
        setSaving(true);
        const body = {name: name.trim(), description};
        const r = await readJson<Project>(await sendJson(api + "projects" + (project ? "/" + project.id : ""),
                                                         project ? "PATCH" : "POST", body));
        setSaving(false);
        if (!r.ok) return setError(errorText(r.data, "Could not save the project."));
        onSaved(r.data);
    }

    return (
        <div class="dialog" id="project-form" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div class="dialog-inner" role="dialog" aria-modal="true" aria-labelledby="project-form-title">
                <h2 id="project-form-title">{project ? "Edit project" : "New project"}</h2>
                <div class="field">
                    <label for="project-name">Name</label>
                    <input type="text" id="project-name" maxLength={255} value={name} ref={nameRef}
                           onInput={(e) => setName(e.currentTarget.value)}
                           onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}/>
                </div>
                <div class="field">
                    <label for="project-description">Description</label>
                    <textarea id="project-description" rows={4} maxLength={10000} value={description}
                              placeholder="The site, what is inspected, who it is for"
                              onInput={(e) => setDescription(e.currentTarget.value)}/>
                </div>
                <div class="error" id="project-error" role="alert">{error}</div>
                <div class="dialog-actions">
                    <button type="button" class="button default" id="project-cancel" onClick={onClose}>Cancel</button>
                    <button type="button" class="button primary" id="project-save" disabled={saving}
                            onClick={save}>{project ? "Save" : "Create"}</button>
                </div>
            </div>
        </div>
    );
}
