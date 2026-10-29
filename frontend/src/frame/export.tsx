// The frame explorer's export: this frame, measured as the page measures it (as converted, or with the parameters
// changed), coloured as the view for a PNG or an R-JPEG's picture
import {useState} from "preact/hooks";
import {ExportDialog, PictureChoice, VisualChoice} from "../components/export-dialog";
import {type Carried, cannotCarry, colouredFrame, firstOffered, frameFormats, startExport, type ViewAsked} from "../core/exports";
import type {Changes} from "./frame";

interface Props {
    api: string;
    datasetId: number;
    conversion: number;
    frame: string;
    settings: Carried | null;
    changes: Changes;          // the parameters changed, in the conversion's unit ({} when none is)
    view: ViewAsked;
    hasVisual: boolean;
    onClose: () => void;
}

export function frameExportBody(p: Props, format: string, withChanges: boolean, picture: string, visual: boolean) {
    const body: Record<string, unknown> = {format, frames: [p.frame], conversion: p.conversion,
                                           changes: withChanges ? p.changes : {}};
    if (colouredFrame(format, picture)) body.view = p.view;
    if (format.startsWith("rjpeg")) body.picture = picture;
    if (format.startsWith("original") && visual) body.visual = true;
    return body;
}

export function FrameExport(p: Props) {
    const changed = Object.keys(p.changes).length > 0;
    const [withChanges, setWithChanges] = useState(false);
    // Only R-JPEG and Original are refused, and the parameters changed never normalize nor replace values
    const formats = frameFormats([p.frame], cannotCarry(p.settings));
    const [format, setFormat] = useState(() => firstOffered(formats));
    const [picture, setPicture] = useState("view");
    const [visual, setVisual] = useState(false);
    const measured = !format.startsWith("original");

    return (<ExportDialog title="Export this frame" intro={<>“{p.frame}”, in one of these formats.</>}
                          formats={formats} format={format} setFormat={setFormat} onClose={p.onClose}
                          send={() => startExport(p.api + "datasets/" + p.datasetId + "/exports",
                                                  frameExportBody(p, format, withChanges, picture, visual))}>
        {measured && changed && <div class="field" role="radiogroup" aria-label="Measured">
            <span>Measured:</span>
            <label><input type="radio" name="export-changes" value="" checked={!withChanges}
                          onChange={() => setWithChanges(false)}/> As converted</label>
            <label><input type="radio" name="export-changes" value="1" checked={withChanges}
                          onChange={() => setWithChanges(true)}/> With the parameters changed</label>
        </div>}
        {format.startsWith("rjpeg") && <PictureChoice picture={picture} setPicture={setPicture} view="The view's colours"/>}
        {format.startsWith("original") && p.hasVisual && <VisualChoice visual={visual} setVisual={setVisual}/>}
    </ExportDialog>);
}
