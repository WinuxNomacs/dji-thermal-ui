// The export dialog the frame explorer, the Files tab and the viewer share: the formats, each with what it is for (one
// that can't carry what is asked disabled, with why), the page's own options under them, and Export, which asks the
// server for the file and lets the browser download it
import {type ComponentChildren, toChildArray} from "preact";
import {useLayoutEffect, useState} from "preact/hooks";
import type {FormatChoice} from "../core/exports";
import {Download} from "./icons";

interface Props {
    title: string;
    intro?: ComponentChildren;
    formats: FormatChoice[];
    format: string;
    setFormat: (format: string) => void;
    children?: ComponentChildren;      // the options of the format chosen
    send: () => Promise<string>;       // "" once the download is on its way, else why it can't be
    onClose: () => void;
}

// An R-JPEG's picture: the view's colours, or DJI's own
export function PictureChoice({picture, setPicture, view}: {picture: string; setPicture: (p: string) => void; view: string}) {
    return (<div class="field" role="radiogroup" aria-label="Its picture">
        <span>Its picture, as photo viewers show it:</span>
        <label><input type="radio" name="export-picture" value="view" checked={picture === "view"}
                      onChange={() => setPicture("view")}/> {view}</label>
        <label><input type="radio" name="export-picture" value="original" checked={picture === "original"}
                      onChange={() => setPicture("original")}/> DJI's own</label>
        <p class="help">DJI's tools colour it from the temperatures either way.</p>
    </div>);
}

// The visual images taken with the frames, with their originals
export function VisualChoice({visual, setVisual}: {visual: boolean; setVisual: (v: boolean) => void}) {
    return (<label class="check"><input type="checkbox" name="export-visual" checked={visual}
                                        onChange={(e) => setVisual(e.currentTarget.checked)}/> With the visual images
        taken with them (the _V JPEGs)</label>);
}

export function ExportDialog({title, intro, formats, format, setFormat, children, send, onClose}: Props) {
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    useLayoutEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    async function exportIt() {
        setBusy(true);
        setError("");
        const why = await send();
        setBusy(false);
        if (why) setError(why); else onClose();
    }

    const chosen = formats.find((f) => f.format === format);
    return (
        <div class="dialog" id="export-dialog" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div class="dialog-inner wide" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
                <h2 id="export-dialog-title">{title}</h2>
                {intro && <p>{intro}</p>}
                <ul class="export-formats" role="radiogroup" aria-label="Format">
                    {formats.map((f) => (<li key={f.format}>
                        <label class={f.disabled ? "text-muted" : ""}>
                            <input type="radio" name="export-format" value={f.format} disabled={!!f.disabled}
                                   checked={f.format === format} onChange={() => setFormat(f.format)}/>
                            <span><strong>{f.label}</strong> <span class="text-muted">{f.text}</span></span>
                        </label>
                    </li>))}
                </ul>
                {formats.some((f) => f.disabled) && <p class="text-muted export-cannot">
                    {formats.find((f) => f.disabled)!.disabled}</p>}
                {toChildArray(children).length > 0 && <div class="export-options">{children}</div>}
                <div class="error" role="alert">{error}</div>
                <div class="dialog-actions">
                    <button type="button" class="button default" id="export-cancel" onClick={onClose}>Cancel</button>
                    <button type="button" class="button primary" id="export-save" disabled={busy || !chosen || !!chosen.disabled}
                            onClick={exportIt}><Download/> {busy ? "Exporting…" : "Export"}</button>
                </div>
            </div>
        </div>
    );
}
