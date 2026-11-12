// The exports' formats as the dialog offers them (each with what it is for, and why it can't be chosen when it can't),
// the view the server colours a PNG or an R-JPEG's picture with, and an export asked for and downloaded
import {errorText, readJson, sendJson} from "./api";
import type {Maybe} from "./format";
import type {Bands} from "../map/colour";

export interface FormatChoice {format: string; label: string; text: string; disabled?: string}

// What a dataset's settings do that only a TIFF can carry: normalizing, and values replaced
export interface Carried {normalize?: unknown; replace_above?: unknown; replace_below?: unknown}

// The view as the server takes it (exports.check_view): the palette's key, the range, the adjustments (the bands in the
// values' unit) and the isotherm
export interface ViewAsked {
    palette?: string | null; range?: [number, number] | null; gamma?: number; sharpen?: number;
    bands?: string; band_width?: number; band_origin?: number; isotherm?: string | null;
}

const PRIVATE = "without the location, the serial numbers and the names";
const TIFF_HINT = "TIFF carries them";

// The originals' own format, from their names: DJI's R-JPEGs, or the radiometric TIFFs some cameras write
export function originalKind(paths: string[]): string {
    return paths.length && paths.every((p) => /\.tiff?$/i.test(p)) ? "TIFF" : "R-JPG";
}

// Why R-JPEG and Original can't carry what the settings make, or "" when they can
export function cannotCarry(settings: Maybe<Carried>): string {
    if (!settings) return "";
    if (settings.normalize) return "They can't carry the temperatures a normalized dataset made: " + TIFF_HINT + ".";
    const set = (v: unknown) => v !== null && v !== undefined && v !== "";
    if (set(settings.replace_above) || set(settings.replace_below)) return "They can't carry replaced temperatures: " + TIFF_HINT + ".";
    return "";
}

// A frame's (or several frames') formats, R-JPEG and Original disabled with the reason when they can't carry the values
export function frameFormats(paths: string[], cannot: string): FormatChoice[] {
    const own = originalKind(paths);
    const off = cannot || undefined;
    return [
        {format: "png", label: "PNG", text: "An image coloured as the view, one pixel per sensor pixel: to look at, not to measure."},
        {format: "tiff", label: "TIFF", text: "The temperatures as 32-bit numbers, for GIS and analysis."},
        {format: "tiff_private", label: "TIFF (Private)", text: "The same, " + PRIVATE + "."},
        {format: "rjpeg", label: "R-JPEG", disabled: off,
         text: "DJI's radiometric JPEG with the dataset's parameters, so DJI's tools measure as the app does."},
        {format: "rjpeg_private", label: "R-JPEG (Private)", disabled: off, text: "The same, " + PRIVATE + "."},
        {format: "original", label: "Original (" + own + ")", disabled: off, text: "The source files exactly as the drone took them."},
        {format: "original_private", label: "Original (" + own + ", Private)", disabled: off,
         text: "The source files, still radiometric, " + PRIVATE + "."},
    ];
}

// A mosaic's formats: its GeoTIFF, without its map position, or coloured as the view
export function mosaicFormats(visual: boolean): FormatChoice[] {
    return [
        {format: "png", label: "PNG", text: visual ? "The visual mosaic as an image, at full resolution."
            : "The mosaic coloured as the view, at full resolution: to look at, not to measure."},
        {format: "tiff", label: "GeoTIFF", text: visual ? "The visual mosaic with its map position, for GIS."
            : "The mosaic's values with its map position, for GIS and analysis."},
        {format: "tiff_private", label: "TIFF (Private)", text: "The same values without the map position."},
    ];
}

// The view as the page shows it, drawn in the browser rather than made by the server
export const AS_SHOWN = "shown";

export function shownFormat(text: string): FormatChoice {
    return {format: AS_SHOWN, label: "PNG as shown", text};
}

// The first format that can be chosen, the one asked if it can
export function firstOffered(formats: FormatChoice[], wanted?: string): string {
    const ok = formats.filter((f) => !f.disabled);
    return (ok.find((f) => f.format === wanted) || ok[0] || formats[0]).format;
}

// A frame format coloured as a view (a PNG, or an R-JPEG whose picture is the view): its palette and range are asked
export function colouredFrame(format: string, picture: string): boolean {
    return format === "png" || ((format === "rjpeg" || format === "rjpeg_private") && picture === "view");
}

export function viewAsked(palette: Maybe<string>, range: Maybe<[number, number]>, adjust?: Maybe<{gamma: number; sharpen: number}>,
                          isotherm?: Maybe<string>, bands?: Maybe<Bands>): ViewAsked {
    const v: ViewAsked = {palette: palette || null, range: range || null};
    if (adjust) Object.assign(v, {gamma: adjust.gamma, sharpen: adjust.sharpen});
    if (bands) Object.assign(v, {bands: bands.mode, band_width: bands.width, band_origin: bands.origin});
    if (isotherm) v.isotherm = isotherm;
    return v;
}

// The export asked for (POST), then downloaded by the browser from the address the server gives: "" once it is on its
// way, else why it can't be
export async function startExport(url: string, body: unknown, doc: Document = document): Promise<string> {
    let r;
    try {
        r = await readJson<{url?: string}>(await sendJson(url, "POST", body));
    } catch {
        return "Could not reach the server.";
    }
    if (!r.ok || !r.data.url) return errorText(r.data, "Could not export.");
    const a = doc.createElement("a");
    a.href = r.data.url;
    a.download = "";
    doc.body.appendChild(a);
    a.click();
    a.remove();
    return "";
}
