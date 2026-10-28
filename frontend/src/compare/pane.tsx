// The compare page's parts: a palette and range (or the difference's palette and reach), and the values of both
// mosaics under the cursor
import {useState} from "preact/hooks";
import {type Maybe} from "../core/format";
import {convertTemp, userUnit} from "../core/units";
import {signed, symbol, temp} from "../measure/measure";
import {type Palette, type Point} from "../viewer/panel";
import {gammaSlider, parseRange, sliderGamma, SLIDERS} from "../viewer/view";
import {type CompareStyle, type DiffStyle} from "./compare";

interface StyleProps {
    style: CompareStyle | DiffStyle;
    palettes: Palette[];
    what: string;                           // what Auto spans: "both mosaics", "this mosaic" or "the difference"
    onChange: (changes: Partial<CompareStyle> & Partial<DiffStyle>, done?: boolean) => void;   // done false: a slider dragged
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
    // The image's adjustments: drawn as a slider is dragged, kept when it is let go
    const adjusted = (e: Event, done: boolean) => {
        const el = e.currentTarget as HTMLInputElement, a = (style as CompareStyle).adjust;
        onChange({adjust: el.name === "gamma" ? {...a, gamma: sliderGamma(el.value)} : {...a, sharpen: parseFloat(el.value) || 0}}, done);
    };
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
                <input type="range" name="gamma" {...SLIDERS.gamma} value={gammaSlider((style as CompareStyle).adjust.gamma)}
                       onInput={(e) => adjusted(e, false)} onChange={(e) => adjusted(e, true)}/>
            </label>
            <label><input type="checkbox" name="equalize" checked={(style as CompareStyle).adjust.equalize}
                          onChange={(e) => onChange({adjust: {...(style as CompareStyle).adjust, equalize: e.currentTarget.checked}})}/> Equalize</label>
            <label class="slider" title="Brings out edges (an unsharp mask)">Sharpen
                <input type="range" name="sharpen" {...SLIDERS.sharpen} value={(style as CompareStyle).adjust.sharpen}
                       onInput={(e) => adjusted(e, false)} onChange={(e) => adjusted(e, true)}/>
            </label>
        </>}
        {error && <span class="text-danger">{error}</span>}
    </div>);
}

const has = (p: Maybe<Point>): boolean => !!p && !!p.valid && p.temperature !== null && p.temperature !== undefined;

// The values of both mosaics at a point, and A − B (each in its own unit; the difference in the user's) unless
// difference is false
export function DifferenceReadout({a, b, aUnit, bUnit, difference = true}: {a: Maybe<Point>; b: Maybe<Point>; aUnit: unknown;
                                                                           bUnit: unknown; difference?: boolean}) {
    const value = (p: Maybe<Point>, unit: unknown) => has(p) ? temp(p!.temperature, unit) :
        p?.reason === "outside_raster" ? "outside the mosaic" : "no data";
    const rows: [string, string][] = [
        ["A", value(a, aUnit)], ["B", value(b, bUnit)],
        ...(!difference ? [] : [["A − B", has(a) && has(b) ? signed((convertTemp(a!.temperature, aUnit) as number) - (convertTemp(b!.temperature, bUnit) as number),
                                           userUnit()) : "no data"] as [string, string]]),
    ];
    return (<table class="table values"><tbody>
        {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
    </tbody></table>);
}
