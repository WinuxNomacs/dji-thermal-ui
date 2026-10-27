// The compare page's parts: a palette and range (or the difference's palette and reach), the values of both mosaics
// under the cursor, and the source frames of a point picked
import {useState} from "preact/hooks";
import {Image} from "../components/icons";
import {type Maybe} from "../core/format";
import {convertTemp, userUnit} from "../core/units";
import {signed, symbol, temp} from "../measure/measure";
import {type Palette, type Point} from "../viewer/panel";
import {gammaSlider, parseRange, SHARPEN_MAX, sliderGamma} from "../viewer/view";
import {type CompareStyle, type DiffStyle} from "./compare";

interface StyleProps {
    style: CompareStyle | DiffStyle;
    palettes: Palette[];
    what: string;                           // what Auto spans: "both mosaics", "this mosaic" or "the difference"
    onChange: (changes: Partial<CompareStyle> & Partial<DiffStyle>) => void;
    onAuto: () => void;
}

// A palette and range with the image's adjustments, or the difference's palette and reach: the fields keep what was
// typed while it is not a range
export function StyleBar({style, palettes, what, onChange, onAuto}: StyleProps) {
    const [text, setText] = useState<string[] | null>(null);
    const [error, setError] = useState("");
    const diff = "reach" in style;
    const typed = (values: string[]) => {
        if (diff) {
            const reach = parseFloat(values[0]);
            if (!(reach > 0)) { setText(values); return setError("The difference shown must be above 0"); }
            setText(null);
            setError("");
            return onChange({reach});
        }
        const r = parseRange(values[0], values[1]);
        if (r.error) { setText(values); return setError(r.error); }
        setText(null);
        setError("");
        onChange({range: r.range});
    };
    const auto = () => { setText(null); setError(""); onAuto(); };
    const shown = text || (diff ? [String(style.reach)] : (style as CompareStyle).range.map(String));
    const autoButton = <button type="button" class="button default small" name="auto"
                               title={"The 2nd to 98th percentile of " + what} onClick={auto}>Auto</button>;
    return (<div class="compare-style">
        <label>Palette <select name="palette" value={style.palette} onChange={(e) => onChange({palette: e.currentTarget.value})}>
            {palettes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select></label>
        {diff ? <span class="range">± <input type="number" step="0.1" min="0.1" name="reach" value={shown[0]}
                                              title="The difference at either end of the palette"
                                              onChange={(e) => typed([e.currentTarget.value])}/> {symbol()} {autoButton}</span> : <>
            <span class="range">
                <input type="number" step="0.1" name="min" title="Minimum" value={shown[0]}
                       onChange={(e) => typed([e.currentTarget.value, shown[1]])}/> to <input
                       type="number" step="0.1" name="max" title="Maximum" value={shown[1]}
                       onChange={(e) => typed([shown[0], e.currentTarget.value])}/> {symbol()} {autoButton}
            </span>
            <label class="slider" title="Above 1 brightens the cooler part of the range">Gamma
                <input type="range" name="gamma" min="-2.3" max="2.3" step="0.1" value={gammaSlider((style as CompareStyle).adjust.gamma)}
                       onChange={(e) => onChange({adjust: {...(style as CompareStyle).adjust, gamma: sliderGamma(e.currentTarget.value)}})}/>
            </label>
            <label><input type="checkbox" name="equalize" checked={(style as CompareStyle).adjust.equalize}
                          onChange={(e) => onChange({adjust: {...(style as CompareStyle).adjust, equalize: e.currentTarget.checked}})}/> Equalize</label>
            <label class="slider" title="Brings out edges (an unsharp mask)">Sharpen
                <input type="range" name="sharpen" min="0" max={SHARPEN_MAX} step="0.5" value={(style as CompareStyle).adjust.sharpen}
                       onChange={(e) => onChange({adjust: {...(style as CompareStyle).adjust,
                                                           sharpen: parseFloat(e.currentTarget.value) || 0}})}/>
            </label>
        </>}
        {error && <span class="text-danger">{error}</span>}
    </div>);
}

const has = (p: Maybe<Point>): boolean => !!p && !!p.valid && p.temperature !== null && p.temperature !== undefined;

// The values of both mosaics at a point, and A − B (each in its own unit; the difference in the user's)
export function DifferenceReadout({a, b, aUnit, bUnit}: {a: Maybe<Point>; b: Maybe<Point>; aUnit: unknown; bUnit: unknown}) {
    const value = (p: Maybe<Point>, unit: unknown) => has(p) ? temp(p!.temperature, unit) :
        p?.reason === "outside_raster" ? "outside the mosaic" : "no data";
    const rows: [string, string][] = [
        ["A", value(a, aUnit)], ["B", value(b, bUnit)],
        ["A − B", has(a) && has(b) ? signed((convertTemp(a!.temperature, aUnit) as number) - (convertTemp(b!.temperature, bUnit) as number),
                                           userUnit()) : "no data"],
    ];
    return (<table class="table values"><tbody>
        {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
    </tbody></table>);
}

// A source frame of the point picked: its image with the pixel marked, its temperature and a link to it
export interface PickedFrame {title: string; point: Maybe<Point>; unit: unknown; image: string; href: string}

function FrameImage({src, alt, pixel}: {src: string; alt: string; pixel: Maybe<[number, number]>}) {
    const [size, setSize] = useState<[number, number] | null>(null);
    return (<div class="compare-frame-image">
        <img alt={alt} src={src} onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}/>
        {pixel && size && size[0] > 0 && size[1] > 0 && <span class="compare-mark" style={{
            left: ((pixel[0] + 0.5) / size[0] * 100).toFixed(2) + "%", top: ((pixel[1] + 0.5) / size[1] * 100).toFixed(2) + "%"}}/>}
    </div>);
}

function Frame({f}: {f: PickedFrame}) {
    const p = f.point;
    let body;
    if (!p || !p.valid) body = <p class="message">{p && p.reason === "outside_raster" ? "Outside the mosaic." : "No data here."}</p>;
    else if (!p.frame) body = <p class="message">No frame is known for this point.</p>;
    else {
        body = (<>
            <FrameImage src={f.image} alt={p.frame} pixel={p.frame_pixel}/>
            <table class="table values"><tbody>
                <tr><th>Temperature</th><td>{p.temperature === null || p.temperature === undefined ? "no data" : temp(p.temperature, f.unit)}</td></tr>
                <tr><th>Frame</th><td>{p.frame}</td></tr>
            </tbody></table>
            {!p.frame_pixel && <p class="message">The pixel is not marked: build this conversion's mosaics again to know it.</p>}
            <a class="button default small" href={f.href}><Image/> Open this frame</a>
        </>);
    }
    return <div class="compare-frame"><div class="compare-frame-title">{f.title}</div>{body}</div>;
}

// The point picked in a pane: its mosaic's source frame, or A's and B's for the difference
export function Picked({frames, onClose}: {frames: PickedFrame[]; onClose: () => void}) {
    return (<div class="compare-pick">
        <div class="compare-pick-head"><strong>Picked point</strong>
            <button type="button" class="close" name="close" title="Close" aria-label="Close" onClick={onClose}>×</button></div>
        <div class="compare-frames">{frames.map((f, i) => <Frame key={i} f={f}/>)}</div>
    </div>);
}
