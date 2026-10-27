// The compare page's parts: a palette and range (or the difference's palette and reach), and the values of both
// mosaics under the cursor
import {useState} from "preact/hooks";
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
