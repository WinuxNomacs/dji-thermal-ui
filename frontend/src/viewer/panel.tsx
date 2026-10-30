// The viewer's panel: its folding sections, the colour scale, the image's sliders, the values under the cursor, the
// correction, the whole mosaic's figures and dji-thermal-cli's report
import type {ComponentChildren} from "preact";
import {useState} from "preact/hooks";
import {Download, Image, Warning} from "../components/icons";
import {formatNumber, type Maybe} from "../core/format";
import {convertTemp, unitSymbol, userUnit} from "../core/units";
import {Histogram} from "../measure/charts";
import {type Measured, symbol, temp} from "../measure/measure";
import {gradientCss, type Scale} from "./canvas";
import {type Adjust, EMISSIVITY_RANGE, gammaSlider, inTemperatures, type MosaicTab, reflectedRange, scaleTicks,
        SLIDERS, TAB_HINTS, valueUnit} from "./view";

const FOLDED_KEY = "thermal-analyzer.viewer.folded";

function folded(key: string): string[] {
    try { return JSON.parse(localStorage.getItem(key) || "[]") as string[]; } catch { return []; }
}

interface SectionProps {
    name: string;
    title: ComponentChildren;
    children: ComponentChildren;
    store?: string;                         // where the folded sections are kept (each page its own)
    onToggle?: (open: boolean) => void;
}

// A section of the panel, folded or not as it was left
export function Section({name, title, children, store = FOLDED_KEY, onToggle}: SectionProps) {
    const [open] = useState(() => !folded(store).includes(name));
    const toggle = (e: Event) => {
        const shut = !(e.currentTarget as HTMLDetailsElement).open;
        const kept = folded(store).filter((n) => n !== name).concat(shut ? [name] : []);
        try { localStorage.setItem(store, JSON.stringify(kept)); } catch { /* not kept: it opens again next time */ }
        onToggle?.(!shut);
    };
    return (<details class="section" open={open} data-section={name} onToggle={toggle}>
        <summary><h5>{title}</h5></summary>
        {children}
    </details>);
}

// The colour scale: its caption, the palette as drawn and the values along it
export function ScaleView({scale}: {scale: Maybe<Scale>}) {
    if (!scale) return null;
    return (<div class="scale">
        <div class="scale-caption">{scale.caption}</div>
        <div class="scale-bar" style={{background: gradientCss(scale.colors, scale.shares)}}/>
        <div class="scale-ticks">
            {scaleTicks(scale.shown[0], scale.shown[1], 5).map((t) =>
                <span key={t.at} class={t.at < 0.1 ? "start" : t.at > 0.9 ? "end" : undefined} style={{left: t.at * 100 + "%"}}>{t.label}</span>)}
        </div>
    </div>);
}

export interface Palette {key: string; label: string; color_map?: number[]}

interface ControlsProps {
    tab: MosaicTab; palette: string; palettes: Palette[]; scale: Maybe<Scale>; unit: unknown;
    range: [string, string]; rangeError?: string; frames?: number;
    onPalette: (key: string) => void; onRange: (min: string, max: string) => void; onAuto: () => void;
}

// What the tab shows, its palette and its range
export function Controls(p: ControlsProps) {
    const t = p.tab.tab, temperature = inTemperatures(t), s = p.tab.stats, u = valueUnit(t);
    const hint = <p class="hint">{TAB_HINTS[t] || ""}</p>;
    if (t === "source_frame") {
        return (<>{hint}<ScaleView scale={p.scale}/><p class="message">{p.frames || 0} frames. The mosaic is in the Mosaic
            tab's palette and range. The cursor names the frame under it; a click keeps it, outlines it and opens the frames
            that saw it, and a second click on it or Esc lets go of it.</p></>);
    }
    const conv = (x: Maybe<number>) => temperature ? convertTemp(x, p.unit) as number : x;
    const typed = (min: string, max: string) => p.onRange(min, max);
    return (<>
        {hint}
        <label class="field">Palette
            <select id="palette" value={p.palette} onChange={(e) => p.onPalette(e.currentTarget.value)}>
                {p.palettes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
        </label>
        <ScaleView scale={p.scale}/>
        <div class="range">
            <input type="number" step="0.1" id="range-min" title="Minimum" value={p.range[0]}
                   onChange={(e) => typed(e.currentTarget.value, p.range[1])}/>
            <span>to</span>
            <input type="number" step="0.1" id="range-max" title="Maximum" value={p.range[1]}
                   onChange={(e) => typed(p.range[0], e.currentTarget.value)}/>
            <span>{temperature ? unitSymbol(userUnit()) : u.trim()}</span>
            <button type="button" class="button default small" id="auto" title="The 2nd to 98th percentile of this mosaic"
                    onClick={p.onAuto}>Auto</button>
        </div>
        {p.rangeError && <div class="text-danger" id="range-error">{p.rangeError}</div>}
        {s && <div class="message">{t === "frame" ? "This frame" : "This mosaic"}: {formatNumber(conv(s.min), 1)} to {formatNumber(conv(s.max), 1,
            temperature ? " " + symbol() : u)}</div>}
    </>);
}

interface ImageProps {
    adjust: Adjust; brightness: number; contrast: number; temperature: boolean;
    onSlide: (brightness: number, contrast: number, done: boolean) => void;
    onGamma: (slider: string, done: boolean) => void; onSharpen: (v: number, done: boolean) => void;
    onTone: (equalize: boolean) => void; onReset: () => void;
}

// How the image is drawn: brightness and contrast move the range, gamma and the tone curve share out the colours.
// While a slider is dragged it reports done false (the image redrawn), and true when it is let go (the change kept).
export function ImageControls(p: ImageProps) {
    const slide = (e: Event, done: boolean) => {
        const el = e.currentTarget as HTMLInputElement, x = parseFloat(el.value);
        if (el.name === "brightness") p.onSlide(x, p.contrast, done); else p.onSlide(p.brightness, x, done);
    };
    const a = p.adjust;
    return (<>
        <label class="slider" title="Moves the range down (brighter) or up">Brightness
            <input type="range" name="brightness" {...SLIDERS.brightness} value={p.brightness}
                   onInput={(e) => slide(e, false)} onChange={(e) => slide(e, true)}/>
        </label>
        <label class="slider" title="Narrows the range (more contrast) or widens it">Contrast
            <input type="range" name="contrast" {...SLIDERS.contrast} value={p.contrast}
                   onInput={(e) => slide(e, false)} onChange={(e) => slide(e, true)}/>
        </label>
        <label class="slider" title="Above 1 brightens the cooler part of the range">Gamma
            <input type="range" name="gamma" {...SLIDERS.gamma} value={gammaSlider(a.gamma)}
                   onInput={(e) => p.onGamma(e.currentTarget.value, false)} onChange={(e) => p.onGamma(e.currentTarget.value, true)}/>
            <span class="slider-value">{a.gamma.toFixed(2)}</span>
        </label>
        <label class="slider" title="Brings out edges (an unsharp mask)">Sharpening
            <input type="range" name="sharpen" {...SLIDERS.sharpen} value={a.sharpen}
                   onInput={(e) => p.onSharpen(parseFloat(e.currentTarget.value) || 0, false)}
                   onChange={(e) => p.onSharpen(parseFloat(e.currentTarget.value) || 0, true)}/>
            <span class="slider-value">{formatNumber(a.sharpen, 1)}</span>
        </label>
        <div class="inline">
            <select aria-label="Tone" value={a.equalize ? "equalize" : "linear"}
                    title="Equalized spreads the colours over the temperatures the whole image has most of"
                    onChange={(e) => p.onTone(e.currentTarget.value === "equalize")}>
                <option value="linear">Linear</option>
                {p.temperature && <option value="equalize">Equalized</option>}
            </select>
            <button type="button" class="button default small" id="reset" title="The Auto range, no adjustments"
                    onClick={p.onReset}>Reset</button>
        </div>
        <p class="message">How the image is drawn: the {p.temperature ? "temperatures" : "values"} stay as they are.</p>
    </>);
}

export interface Point {
    valid?: boolean; reason?: string; temperature?: number | null; frame?: string | null;
    frame_pixel?: [number, number] | null; view_angle?: number | null;
    height?: number | null; base_m?: number | null;     // the ground's, above WebODM's DSM's lowest ground (base_m)
}

// The values under the cursor, or at the point clicked (pinned)
export function Readout({point, unit, frameUrl, pinned, onFollow}: {point: Maybe<Point>; unit: unknown; frameUrl: string;
                                                                    pinned: boolean; onFollow: () => void}) {
    const follow = pinned && <button type="button" class="button default small" id="follow" onClick={onFollow}>Follow the cursor</button>;
    if (point === undefined) return <span class="message">Move the cursor over the mosaic.</span>;
    if (!point || !point.valid) {
        return (<><span class="message">{point && point.reason === "outside_raster" ? "Outside the mosaic." : "No data here."}</span>
            {follow}</>);
    }
    // A frame a link asked for has no temperature: only its name
    const rows: [string, string, string?][] = "temperature" in point ? [["Temperature", point.temperature === null ||
        point.temperature === undefined ? "no data" : temp(point.temperature, unit)]] : [];
    if (point.frame !== null && point.frame !== undefined) rows.push(["Frame", point.frame]);
    if (point.frame_pixel) rows.push(["Frame pixel", "x " + point.frame_pixel[0] + ", y " + point.frame_pixel[1]]);
    if (point.view_angle !== null && point.view_angle !== undefined) rows.push(["View angle", formatNumber(point.view_angle, 1, "°")]);
    if ("height" in point) rows.push(heightRow(point.height, point.base_m));
    return (<>
        <table class="table values"><tbody>
            {rows.map(([k, v, title]) => <tr key={k}><th>{k}</th><td title={title}>{v}</td></tr>)}
        </tbody></table>
        <div class="inline">
            {point.frame && <a class="button default small" id="open-frame" href={frameUrl + encodeURIComponent(point.frame)}>
                <Image/> Open this frame</a>}
            {follow}
        </div>
    </>);
}

// The ground's height as the readout gives it: above the DSM's lowest ground, and as WebODM gives it in the tooltip
export function heightRow(height: Maybe<number>, base: Maybe<number>): [string, string, string?] {
    if (height === null || height === undefined) return ["Ground height", "no data"];
    return ["Ground height", formatNumber(height, 1, " m"),
            base === null || base === undefined ? undefined : formatNumber(base + height, 1, " m as WebODM gives it")];
}

export type Baseline = {emissivity?: number | null; reflected_temp?: number | null};

// Where the correction's fields start: the conversion's own parameters, the reflected temperature in the user's unit
export function correctionStarts(baseline: Maybe<Baseline>, unit: unknown): Record<string, string> {
    const b = baseline || {};
    return {emissivity: formatNumber(b.emissivity, 2), reflected_temp: formatNumber(convertTemp(b.reflected_temp, unit) as number, 1)};
}

interface CorrectionProps {
    values: Record<string, string>; starts: Record<string, string>; error?: string; field?: string;
    onInput: (key: string, value: string) => void; onChange: (key: string, value: string) => void;
}

// The emissivity and reflected temperature the temperature mosaics are corrected for
export function Correction(p: CorrectionProps) {
    const rr = reflectedRange();
    const fields: [string, string, string, number[], string][] = [
        ["emissivity", "Emissivity", "0.01", EMISSIVITY_RANGE, ""],
        ["reflected_temp", "Reflected temperature", "0.1", rr, symbol()]];
    return (<>
        {fields.map(([key, label, step, range, unit]) => {
            const value = p.values[key] ?? p.starts[key];
            return (<label key={key} class={"field" + (p.field === key ? " has-error" : "")}>{label}
                <span class="inline">
                    <input type="number" name={key} step={step} min={range[0]} max={range[1]} placeholder={p.starts[key]} value={value}
                           onInput={(e) => p.onInput(key, e.currentTarget.value)} onChange={(e) => p.onChange(key, e.currentTarget.value)}/>
                    {unit && <span>{unit}</span>}
                </span>
            </label>);
        })}
        {p.error && <div class="text-danger" id="correction-error">{p.error}</div>}
        <p class="message">Approximate: the mosaics are corrected with the thermal correction model, not measured again. The
            frames measure exactly (open one from the readout).</p>
    </>);
}

// The whole mosaic, as corrected: its mean, its 2nd to 98th percentile, the isotherm's share and the histogram
export function Whole({whole, unit}: {whole: Maybe<Measured>; unit: unknown}) {
    const a = whole && whole.result;
    if (!a) return null;
    const p = a.percentiles;
    return (<>
        <table class="table values"><tbody>
            <tr><th>Mean</th><td>{temp(a.mean, unit)}</td></tr>
            <tr><th>2nd to 98th percentile</th><td>{temp(p && p[0], unit, 1)} to {temp(p && p[1], unit, 1)}</td></tr>
            {a.isotherm && <tr><th>In the isotherm</th><td>{formatNumber((a.isotherm.share || 0) * 100, 1, " %")}</td></tr>}
        </tbody></table>
        <Histogram hist={a.histogram} unit={unit}/>
        {whole.approximate && <p class="message">Corrected (approximate).</p>}
    </>);
}

// What dji-thermal-cli reports about the mosaic, and its files to download
// A mosaic's report (rows: as reportRows or visualRows give them) and its files to download
export function Report({rows, files, base}: {rows: [string, string][]; files: Maybe<string[]>; base: string}) {
    files = files || [];
    return (<>
        {rows.length > 0 && <table class="table values"><tbody>
            {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
        </tbody></table>}
        {files.length > 0 && <ul class="files">
            {files.map((f) => <li key={f}><a href={base + "/download?file=" + encodeURIComponent(f)}><Download/> {f}</a></li>)}
        </ul>}
    </>);
}

// How the mosaics are coming along, or why there are none
export function MosaicStatus({v}: {v: {status: string; mosaic_status: string; mosaic_error?: string | null;
                                        mosaic_progress?: number | null; label: string}}) {
    if (v.status === "converting") {
        return <div class="status text-muted" id="status">The images are being converted: the mosaics are built next.</div>;
    }
    if (v.mosaic_status === "building") {
        const pct = Math.round((v.mosaic_progress || 0) * 100);
        return (<div class="status" id="status">
            <div class="progress"><div class="progress-bar" style={{width: Math.max(pct, 3) + "%"}}/></div>
            {v.label}
        </div>);
    }
    if (v.mosaic_status === "failed") return <div class="status text-danger" id="status"><Warning/> The mosaics failed: {v.mosaic_error}</div>;
    if (v.mosaic_status === "canceled") return <div class="status text-muted" id="status">Building the mosaics was canceled.</div>;
    if (v.status !== "ready") {
        return <div class="status text-muted" id="status">The images were not converted: there is nothing to make mosaics of.</div>;
    }
    if (v.mosaic_status !== "ready") return <div class="status text-muted" id="status">This dataset has no mosaics.</div>;
    return null;
}
