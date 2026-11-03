// The viewer's export: the mosaic tab shown, as shown (drawn by the page), as its GeoTIFF, without its map position, or
// coloured as the view at full resolution (with the correction as the tiles are asked)
import {useState} from "preact/hooks";
import {ExportDialog} from "../components/export-dialog";
import {AS_SHOWN, mosaicFormats, shownFormat, startExport, type ViewAsked} from "../core/exports";
import type {Extra} from "./view";

interface Props {
    base: string;              // the conversion's API address
    tab: string;
    label: string;             // the tab's name
    view: ViewAsked | null;    // none on the visual tab
    correction: Extra;
    asShown: () => Promise<string>;    // the view drawn and saved: "" once saved, else why it couldn't be
    onClose: () => void;
}

export function mosaicExportBody(p: Props, format: string) {
    const body: Record<string, unknown> = {format};
    if (p.view) Object.assign(body, {view: p.view, correction: p.correction});
    return body;
}

export function MosaicExport(p: Props) {
    const formats = [shownFormat("The mosaic as you see it, with its title, date, saved measurements, colour scale and " +
                                 "scale bar (the basemap left out): to share."), ...mosaicFormats(!p.view)];
    const [format, setFormat] = useState(AS_SHOWN);
    return (<ExportDialog title="Export the mosaic" intro={<>The “{p.label}” mosaic, as shown or whole, in one of these formats.</>}
                          formats={formats} format={format} setFormat={setFormat} onClose={p.onClose}
                          send={() => format === AS_SHOWN ? p.asShown()
                              : startExport(p.base + "/mosaics/" + p.tab + "/exports", mosaicExportBody(p, format))}/>);
}
