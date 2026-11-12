// A mosaic report as the page lays it out, from the conversion, its mosaics, its measurements and the dataset's
// findings: the view saved with it (the viewer's, else the mosaics' first tab as it opens), how that colours the
// values, the colour scale, what each close-up is fitted to, and the findings on the mosaic. Plain functions, no DOM.
import {boundingExtent, buffer, getHeight, getWidth} from "ol/extent";
import {type Colouring, scaleStops, SEAMS} from "../map/colour";
import {lonLatToMap} from "../map/map";
import {type Coords, type Geometry, type Measurement} from "../measure/measure";
import {type Finding, SEVERITY_COLORS} from "../findings/findings";
import {centreOf} from "../findings/layer";
import {type Scale} from "../viewer/canvas";
import {bandsOf, isTemperatureTab, readAdjust, sharesOf, shownRange, type Style, tabLabel, valueCaption, valueUnit,
        type View} from "../viewer/view";
import {symbol} from "../measure/measure";
import {defaultStyle, type Mosaics} from "../viewer/viewer-page";
import {formatNumber} from "../core/format";
import {type Typed} from "./text";

// What is saved on the conversion (its "report")
export interface MosaicReportText extends Partial<Typed> {view?: View; left_out?: number[]}

export const MIN_CLOSE_UP = 12;     // a close-up spans this many of the map's metres at least, a spot's too
const MARGIN = 0.6;                 // with this much of its measurement's size again on each side

// The tab and style the report shows: the view saved with it where the mosaics have them, else the first tab's
export function reportStyle(v: Mosaics, view: View | undefined): {tab: string; style: Style} {
    const tabs = (v.tabs || []).map((t) => t.tab);
    const tab = view?.tab && tabs.includes(view.tab) ? view.tab : tabs[0];
    const style = defaultStyle(v, tab);
    if (!view || view.tab !== tab || tab === "source_frame") return {tab, style};
    if (view.palette && (v.palettes || []).some((p) => p.key === view.palette)) style.palette = view.palette;
    if (view.range) style.range = view.range;
    if (view.adjust) style.adjust = readAdjust(view.adjust, isTemperatureTab(tab));
    return {tab, style};
}

// The temperatures' style, for the mosaic measurements on the other temperature tab and the frames: the report's when
// it shows temperatures, else as the temperature tabs open
export function temperatureStyle(v: Mosaics, tab: string, style: Style): Style {
    if (isTemperatureTab(tab)) return style;
    // The first tab of temperatures: as converted, else (an imported orthophoto) WebODM
    return defaultStyle(v, (v.tabs || []).find((t) => isTemperatureTab(t.tab))?.tab || "as_converted");
}

// What the report's mosaic is drawn from: the tab's own values, but on the Source frame tab the as converted
// mosaic's, coloured as the temperatures are, with the seams between its frames over it (as the viewer draws it)
export function underOf(v: Mosaics, tab: string, style: Style): {tab: string; style: Style; seams: boolean} {
    if (tab !== "source_frame" || !(v.tabs || []).some((t) => t.tab === "as_converted")) return {tab, style, seams: false};
    return {tab: "as_converted", style: temperatureStyle(v, tab, style), seams: true};
}

const paletteOf = (v: Mosaics, key: string) => (v.palettes || []).find((p) => p.key === key)?.color_map || [];

// How a tab is coloured in a style: its palette, range and gamma, and on a temperature tab its bands
export function colouringOf(v: Mosaics, tab: string, style: Style): Colouring {
    if (tab === "source_frame") return SEAMS;
    return {colors: paletteOf(v, style.palette), range: style.range, shares: sharesOf(style.adjust), sharpen: style.adjust.sharpen,
            bands: isTemperatureTab(tab) ? bandsOf(style.adjust, v.unit) : null};
}

export function legendOf(v: Mosaics, tab: string, style: Style): Scale | null {
    if (tab === "source_frame") return null;
    const c = colouringOf(v, tab, style);
    return {colors: c.colors, shown: shownRange(tab, style.range, v.unit), shares: c.shares, stops: scaleStops(c),
            caption: valueCaption(tab)};
}

// The view in words: the mosaic, its palette, its range and the adjustments made (on the Source frame tab, those of
// the mosaic under the seams)
export function viewText(v: Mosaics, shownTab: string, shownStyle: Style): string {
    const parts = [tabLabel(shownTab)];
    const {tab, style, seams} = underOf(v, shownTab, shownStyle);
    if (seams) parts.push("the seams between its frames over the " + tabLabel(tab));
    if (tab !== "source_frame") {
        const palette = (v.palettes || []).find((p) => p.key === style.palette);
        const [lo, hi] = shownRange(tab, style.range, v.unit), u = valueUnit(tab);
        parts.push((palette?.label || style.palette) + " palette", formatNumber(lo, 1) + " to " + formatNumber(hi, 1) + u);
        if (style.adjust.gamma !== 1) parts.push("gamma " + style.adjust.gamma);
        if (style.adjust.bands && isTemperatureTab(tab)) {
            parts.push(style.adjust.bands + " every " + style.adjust.bandwidth + " " + symbol());
        }
        if (style.adjust.sharpen) parts.push("sharpened " + style.adjust.sharpen);
    }
    return parts.join(" · ");
}

const ringOf = (g: Geometry): Coords[] =>
    g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates[0];

// What a mosaic measurement's close-up is fitted to (the map's coordinates): the shape, with room around it
export function closeUpExtent(g: Geometry): number[] {
    const e = boundingExtent(ringOf(g).map((c) => lonLatToMap(c)));
    const size = Math.max(getWidth(e), getHeight(e));
    return buffer(e, Math.max((MIN_CLOSE_UP - size) / 2, size * MARGIN));
}

// The measurements the report holds: those not left out, the mosaics' first, each numbered
export function included(items: Measurement[], leftOut: number[] | undefined): Measurement[] {
    const out = items.filter((m) => !(leftOut || []).includes(m.id));
    return [...out.filter((m) => m.target !== "frame"), ...out.filter((m) => m.target === "frame")];
}

// The findings on the mosaic (bounds: west, south, east, north), their centres within it
export function onMosaic<T extends Finding>(findings: T[], bounds: number[] | undefined): T[] {
    if (!bounds) return findings;
    const [w, s, e, n] = mercatorOf(bounds);
    return findings.filter((f) => {
        const [x, y] = centreOf(f);
        return x >= w && x <= e && y >= s && y <= n;
    });
}

const mercatorOf = (b: number[]) => [...lonLatToMap([b[0], b[1]]), ...lonLatToMap([b[2], b[3]])];

// A finding as drawn on the figures: its outline or its spot, numbered, in its severity's colour
export function findingMark(f: Finding & {number: number}) {
    return {geometry: f.geometry, name: "#" + f.number, color: SEVERITY_COLORS[f.severity] || "#dc2626"};
}
