// The Files tab's export: the frames the filter shows, or all of them, measured with a dataset of the flight (the
// newest by default) or with the frames' own values, coloured with a palette and a range shared by all of them for a
// PNG or an R-JPEG's picture
import {useEffect, useState} from "preact/hooks";
import {ExportDialog, PictureChoice, VisualChoice} from "../components/export-dialog";
import {cannotCarry, colouredFrame, firstOffered, frameFormats, startExport} from "../core/exports";
import {convertTemp, unitSymbol, userUnit} from "../core/units";
import type {Conversion} from "./conversions";
import {newestReady} from "./files";

interface Props {
    api: string;
    datasetId: number;
    shown: string[];           // the thermal frames the filter shows
    all: string[];             // every thermal frame of the flight
    conversions: Conversion[];
    hasVisual: boolean;
    onClose: () => void;
}

interface PaletteChoice {key: string; label: string}

export interface FilesAsked {
    format: string;
    which: "shown" | "all";
    conversion: number | null;
    palette: string;           // "": the server's default (the preferred palette, else the dataset's, else Ironbow)
    low: string;               // the range typed, in the user's unit ("" and "": shared, automatic)
    high: string;
    picture: string;
    visual: boolean;
}

// The request for the frames asked, or why it can't be made. The range is sent in the unit the frames are measured in
// (the dataset's, else the user's)
export function filesExportBody(p: Pick<Props, "shown" | "all" | "conversions">, a: FilesAsked): Record<string, unknown> | string {
    const frames = a.which === "all" ? p.all : p.shown;
    if (!frames.length) return "No frames to export.";
    const body: Record<string, unknown> = {format: a.format, conversion: a.conversion};
    if (a.which === "shown" && frames.length < p.all.length) body.frames = frames;
    if (colouredFrame(a.format, a.picture)) {
        let range: [number, number] | null = null;
        if (a.low.trim() !== "" || a.high.trim() !== "") {
            const low = Number(a.low), high = Number(a.high);
            if (a.low.trim() === "" || a.high.trim() === "" || !isFinite(low) || !isFinite(high)) return "Type both ends of the range, or neither.";
            if (high <= low) return "The range's maximum must be above its minimum.";
            const unit = p.conversions.find((c) => c.id === a.conversion)?.settings.unit || userUnit();
            range = [Number(convertTemp(low, userUnit(), unit)), Number(convertTemp(high, userUnit(), unit))];
        }
        body.view = {palette: a.palette || null, range};
    }
    if (a.format.startsWith("rjpeg")) body.picture = a.picture;
    if (a.format.startsWith("original") && a.visual) body.visual = true;
    return body;
}

export function FilesExport(p: Props) {
    const ready = p.conversions.filter((c) => c.status === "ready");
    const [asked, setAsked] = useState<FilesAsked>(() => ({
        format: "", which: p.shown.length && p.shown.length < p.all.length ? "shown" : "all",
        conversion: newestReady(ready)?.id ?? null, palette: "", low: "", high: "", picture: "view", visual: false,
    }));
    const [palettes, setPalettes] = useState<PaletteChoice[]>([]);
    const [preferred, setPreferred] = useState("");
    const set = (next: Partial<FilesAsked>) => setAsked((a) => ({...a, ...next}));

    // The palettes to choose from, and the preferred one to start with
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(p.api + "preferences", {credentials: "same-origin"});
                if (!res.ok) return;
                const data = await res.json() as {palette?: string; view_palettes?: PaletteChoice[]};
                setPalettes(data.view_palettes || []);
                if (data.palette) {
                    setPreferred(data.palette);
                    setAsked((a) => ({...a, palette: data.palette!}));
                }
            } catch { /* the default palette, then */ }
        })();
    }, []);

    const settings = ready.find((c) => c.id === asked.conversion)?.settings || null;
    const frames = asked.which === "all" ? p.all : p.shown;
    const formats = frameFormats(frames, cannotCarry(settings));
    const format = formats.some((f) => f.format === asked.format && !f.disabled) ? asked.format : firstOffered(formats);
    const measured = !format.startsWith("original");
    const coloured = colouredFrame(format, asked.picture);
    const symbol = unitSymbol(userUnit());

    function send() {
        const body = filesExportBody(p, {...asked, format});
        return typeof body === "string" ? Promise.resolve(body) : startExport(p.api + "datasets/" + p.datasetId + "/exports", body);
    }

    return (<ExportDialog title="Export frames" formats={formats} format={format} setFormat={(f) => set({format: f})}
                          send={send} onClose={p.onClose}
                          intro={frames.length === 1 && !(asked.visual && format.startsWith("original")) ? "One frame, as a file."
                              : frames.length + (frames.length === 1 ? " frame" : " frames") + ", as a zip."}>
        <div class="field" role="radiogroup" aria-label="Frames">
            <span>Frames:</span>
            {p.shown.length < p.all.length && <label><input type="radio" name="export-which" value="shown"
                checked={asked.which === "shown"} disabled={!p.shown.length} onChange={() => set({which: "shown"})}/> The
                {" " + p.shown.length} shown</label>}
            <label><input type="radio" name="export-which" value="all" checked={asked.which === "all"}
                          onChange={() => set({which: "all"})}/> All {p.all.length}</label>
        </div>
        {measured && <div class="field">
            <label for="export-conversion">Measured with</label>
            <select id="export-conversion" value={asked.conversion ?? ""}
                    onChange={(e) => set({conversion: e.currentTarget.value ? Number(e.currentTarget.value) : null})}>
                {ready.map((c) => <option key={c.id} value={c.id}>The dataset “{c.name}”</option>)}
                <option value="">The frames' own values</option>
            </select>
        </div>}
        {coloured && <div class="field">
            <label for="export-palette">Palette</label>
            <select id="export-palette" value={asked.palette} onChange={(e) => set({palette: e.currentTarget.value})}>
                {!preferred && <option value="">The dataset's palette (Ironbow when it has none)</option>}
                {palettes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
        </div>}
        {coloured && <div class="field">
            <label for="export-low">Range ({symbol})</label>
            <span><input type="number" id="export-low" step="any" value={asked.low} placeholder="Auto"
                         onInput={(e) => set({low: e.currentTarget.value})}/> to <input type="number" id="export-high"
                step="any" value={asked.high} placeholder="Auto" onInput={(e) => set({high: e.currentTarget.value})}/></span>
            <p class="help">Shared by every frame, so a colour is the same temperature in all of them. Left empty: from the
                2nd to the 98th percentile of the frames' temperatures.</p>
        </div>}
        {format.startsWith("rjpeg") && <PictureChoice picture={asked.picture} setPicture={(x) => set({picture: x})}
                                                      view="The palette's colours"/>}
        {format.startsWith("original") && p.hasVisual && <VisualChoice visual={asked.visual} setVisual={(v) => set({visual: v})}/>}
    </ExportDialog>);
}
