// The viewer's export: the mosaic tab shown, as its GeoTIFF, without its map position, or coloured as the view at full
// resolution (with the correction as the tiles are asked)
import {useState} from "preact/hooks";
import {ExportDialog} from "../components/export-dialog";
import {mosaicFormats, startExport, type ViewAsked} from "../core/exports";
import type {Extra} from "./view";

interface Props {
    base: string;              // the conversion's API address
    tab: string;
    label: string;             // the tab's name
    view: ViewAsked | null;    // none on the visual tab
    correction: Extra;
    onClose: () => void;
}

export function mosaicExportBody(p: Props, format: string) {
    const body: Record<string, unknown> = {format};
    if (p.view) Object.assign(body, {view: p.view, correction: p.correction});
    return body;
}

export function MosaicExport(p: Props) {
    const formats = mosaicFormats(!p.view);
    const [format, setFormat] = useState("png");
    return (<ExportDialog title="Export the mosaic" intro={<>The “{p.label}” mosaic, whole, in one of these formats.</>}
                          formats={formats} format={format} setFormat={setFormat} onClose={p.onClose}
                          send={() => startExport(p.base + "/mosaics/" + p.tab + "/exports", mosaicExportBody(p, format))}/>);
}
