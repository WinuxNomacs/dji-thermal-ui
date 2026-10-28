// The findings' form (saving a spot or an area as a finding, or changing one) and their list in the viewer's panel,
// with the switch that shows or hides them all on the map and each one's own.
import {useLayoutEffect, useRef, useState} from "preact/hooks";
import {Eye, EyeOff, Flag, Map as MapIcon, Pencil, Trash} from "../components/icons";
import {type Maybe} from "../core/format";
import {frameName, type SourceFrame} from "../sources/sources";
import {type Finding, type FindingFields, SEVERITIES, SEVERITY_COLORS, severityLabel, STATUSES, statusLabel,
        temperaturesText} from "./findings";

export function SeverityChip({severity}: {severity: string}) {
    return <span class="chip severity" style={{background: SEVERITY_COLORS[severity as Finding["severity"]]}}>
        {severityLabel(severity)}</span>;
}

interface FormProps {
    title: string;
    fields: FindingFields;
    frames: Maybe<SourceFrame[]>;       // undefined while they are asked, null when they could not be
    error?: string;
    onSave: (fields: FindingFields) => void;
    onCancel: () => void;
}

// The form, over the page: name, notes, severity, status and the frames to keep (all ticked to start with)
export function FindingForm({title, fields, frames, error, onSave, onCancel}: FormProps) {
    const [v, setV] = useState(fields);
    const name = useRef<HTMLInputElement>(null);
    const kept = (f: string) => !v.kept || v.kept.includes(f);
    const set = (changes: Partial<FindingFields>) => setV((x) => ({...x, ...changes}));

    useLayoutEffect(() => {
        name.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onCancel();
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    function keep(frame: string, on: boolean) {
        const all = (frames || []).map((f) => f.frame), now = v.kept || all;
        set({kept: on ? all.filter((f) => f === frame || now.includes(f)) : now.filter((f) => f !== frame)});
    }

    return (<div class="dialog" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
        <div class="dialog-inner finding-form" role="dialog" aria-modal="true" aria-labelledby="finding-title">
            <form onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
                <h2 id="finding-title">{title}</h2>
                <div class="field">
                    <label for="finding-name">Name</label>
                    <input type="text" id="finding-name" name="name" maxLength={255} ref={name} value={v.name}
                           onInput={(e) => set({name: e.currentTarget.value})}/>
                </div>
                <div class="field">
                    <label for="finding-notes">Notes</label>
                    <textarea id="finding-notes" name="notes" rows={3} maxLength={10000} value={v.notes}
                              onInput={(e) => set({notes: e.currentTarget.value})}/>
                </div>
                <div class="finding-choices">
                    <div class="field">
                        <label for="finding-severity">Severity</label>
                        <select id="finding-severity" name="severity" value={v.severity}
                                onChange={(e) => set({severity: e.currentTarget.value as FindingFields["severity"]})}>
                            {SEVERITIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                    </div>
                    <div class="field">
                        <label for="finding-status">Status</label>
                        <select id="finding-status" name="status" value={v.status}
                                onChange={(e) => set({status: e.currentTarget.value as FindingFields["status"]})}>
                            {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                    </div>
                </div>
                <fieldset class="finding-frames">
                    <legend>Frames kept with it</legend>
                    {frames === undefined ? <p class="message">Finding the frames…</p> :
                        frames === null ? <p class="text-danger">Could not find the frames.</p> :
                        !frames.length ? <p class="message">No frame is known for it.</p> :
                        <ul>{frames.map((f) => <li key={f.frame}><label>
                            <input type="checkbox" name="kept" value={f.frame} checked={kept(f.frame)}
                                   onChange={(e) => keep(f.frame, e.currentTarget.checked)}/>
                            {" "}{frameName(f.frame)}{f.used && <span class="chip">in the mosaic</span>}
                        </label></li>)}</ul>}
                </fieldset>
                {error && <div class="text-danger" role="alert">{error}</div>}
                <div class="dialog-actions">
                    <button type="button" class="button default" onClick={onCancel}>Cancel</button>
                    <button type="submit" class="button primary" disabled={frames === undefined}>Save</button>
                </div>
            </form>
        </div>
    </div>);
}

interface ListProps {
    items: Finding[];
    shown: boolean;                     // the switch: all of them on the map, or none
    hidden: number[];                   // those hidden one by one
    opened: number | null;
    onShown: (on: boolean) => void;
    onHide: (id: number, hide: boolean) => void;
    onOpen: (f: Finding) => void;
    onEdit: (f: Finding) => void;
    onDelete: (f: Finding) => void;
}

// The dataset's findings: the switch, then a line each with its severity, name, status and figures
export function Findings({items, shown, hidden, opened, onShown, onHide, onOpen, onEdit, onDelete}: ListProps) {
    return (<div class="findings-list">
        <label class="findings-switch">
            <input type="checkbox" name="findings" checked={shown} onChange={(e) => onShown(e.currentTarget.checked)}/>
            {" "}Show the findings on the map
        </label>
        {!items.length ? <p class="message">No findings yet: open the source frames of a spot or an area, or a saved
            measurement, and save it as a finding.</p> :
        <ul class="findings">{items.map((f) => {
            const off = hidden.includes(f.id);
            return (<li key={f.id} class={(f.id === opened ? "active" : "") + (off || !shown ? " off" : "")} data-finding={f.id}>
                <SeverityChip severity={f.severity}/>{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); onOpen(f); }}><strong>{f.name}</strong></a>{" "}
                <span class="text-muted">{statusLabel(f.status)}</span>
                <div class="measurement-figure">{temperaturesText(f.temperatures)}</div>
                <button type="button" class="icon-button" name="hide" title={off ? "Show on the map" : "Hide from the map"}
                        aria-pressed={off} disabled={!shown} onClick={() => onHide(f.id, !off)}>
                    {off ? <EyeOff/> : <Eye/>}</button>
                <button type="button" class="icon-button" name="edit" title="Change" onClick={() => onEdit(f)}><Pencil/></button>
                <button type="button" class="icon-button" name="delete" title="Delete" onClick={() => onDelete(f)}><Trash/></button>
            </li>);
        })}</ul>}
    </div>);
}

// A finding as the source frames window heads it: its severity, status, notes and figures (viewer: a link to it there)
export function FindingAbout({f, onEdit, viewer}: {f: Finding; onEdit: () => void; viewer?: string}) {
    return (<div class="finding-about">
        <div class="finding-about-head">
            <SeverityChip severity={f.severity}/> <strong>{f.name}</strong>
            <span class="text-muted">{statusLabel(f.status)}</span>
            <span class="finding-about-actions">
                {viewer && <a class="button default small" href={viewer} title="Open the finding in the viewer"><MapIcon/> Viewer</a>}
                <button type="button" class="button default small" name="edit" onClick={onEdit}><Pencil/> Change</button>
            </span>
        </div>
        <div class="measurement-figure">{temperaturesText(f.temperatures)}</div>
        {f.notes && <p class="finding-notes">{f.notes}</p>}
    </div>);
}

// Above the source frames of a spot or an area: the button that saves it as a finding
export function SaveFinding({onSave}: {onSave: () => void}) {
    return (<div class="sources-actions">
        <button type="button" class="button default small" name="save-finding" onClick={onSave}
                title="Keep this spot or area, its temperatures and frames, as a finding of the flight"><Flag/> Save as finding</button>
    </div>);
}
