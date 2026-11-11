// What measuring shows on the viewer and frame pages: the tools' toolbar on the map, the card of the shape drawn, the
// isotherm, a measure's figures and charts, and the saved measurements (with two of them compared)
import {useState} from "preact/hooks";
import {Circle, Crosshairs, DeltaT, Flag, Images, Info, Minus, Pencil, Polygon, Save, Sliders, Square, Trash} from "../components/icons";
import {Histogram, Profile} from "./charts";
import {HINTS, isDelta, ISOTHERM_MODES, isothermText, type Measured, type Measurement, measurementFigure, type ParamField, paramsText,
        type Result, resultRows, shapeLabel, shownTemp, symbol, targetLabel, type Tool, TOOLS} from "./measure";

const TOOL_ICONS: Record<Tool, typeof Crosshairs> = {point: Crosshairs, line: Minus, area: Polygon, box: Square, circle: Circle,
                                                     delta: DeltaT};
const APPROXIMATE = "Approximate: corrected for the parameters changed with the thermal correction model, not measured " +
    "again by dji-thermal-cli.";

interface ToolbarProps {
    tool: Tool | null;
    count: number;                      // the points drawn so far
    onTool: (t: Tool | null) => void;   // a tool picked (null: the one on put away)
    onFinish: () => void;
    tools?: [Tool, string][];           // the tools offered: all of them unless given
    label?: string;
    compact?: boolean;                  // the hint only as a tooltip, where there is no room to write it
    hints?: Record<Tool, string>;       // what each tool does: the temperatures' unless given
}

// The tools, on the map along its top edge: an icon each, named in its tooltip; while one is on, its hint, Finish
// for a line or an area, and Cancel
export function Toolbar({tool, count, onTool, onFinish, tools = TOOLS, label = "Drawing tools", compact = false,
                         hints = HINTS}: ToolbarProps) {
    return (<div class="measure-toolbar map-tools">
        <div class="button-group tools" role="group" aria-label={label}>
            {tools.map(([t, name]) => {
                const ToolIcon = TOOL_ICONS[t];
                return (<button key={t} type="button" class={"button default small" + (tool === t ? " active" : "")}
                                data-tool={t} aria-pressed={tool === t} title={name} aria-label={name}
                                onClick={() => onTool(tool === t ? null : t)}><ToolIcon/></button>);
            })}
        </div>
        {tool && <div class="tool-hint" title={compact ? hints[tool] : undefined}>
            {!compact && <span>{hints[tool]}</span>}
            {(tool === "line" || tool === "area") &&
                <button type="button" class="button primary small" disabled={count < (tool === "line" ? 2 : 3)}
                        onClick={onFinish}>Finish</button>}
            <button type="button" class="button default small" onClick={() => onTool(null)}>Cancel</button>
        </div>}
    </div>);
}

// What was drawn (or the saved measurement shown), measured
export interface Measuring {res?: Measured | null; error?: string; saved?: Measurement | null; shape?: Measured["shape"]}

interface CardProps {
    m: Measuring;
    unit: unknown;
    labels?: [string, string];          // the two results' names, with parameters changed
    compared?: boolean;                 // two mosaics' results (the compare page): their difference the first's minus the second's
    note?: string;                      // a line above the figures
    pixels?: boolean;                   // a frame: sizes in pixels
    index?: number | null;
    onIndex?: (i: number | null) => void;
    name: string;                       // the name typed to save it
    error?: string;
    onName: (name: string) => void;
    onSave: () => void;
    onKeep?: () => void;                // kept as a finding (a spot, an area or a Delta T of a mosaic)
    onSources?: () => void;             // the frames that saw it, in a window
    onClose: () => void;
}

// The card on the map for the shape drawn: its temperatures and chart, and what can be done with it
export function MeasureCard(p: CardProps) {
    const m = p.m, valid = !!m.res?.result?.valid_pixels;
    const isotherm = (m.saved?.values as {isotherm?: string} | undefined)?.isotherm;
    return (<section class="measure-card" id="measure-card" aria-label="Measurement">
        <div class="measure-card-head">
            <strong>{m.saved ? m.saved.name : "Measurement"}</strong>
            <button type="button" class="close" name="close" title="Close (Esc)" aria-label="Close" onClick={p.onClose}>×</button>
        </div>
        <div class="measure-card-body" id="result">
            {m.error ? <p class="text-danger">{m.error}</p> :
                m.res === undefined ? <p class="message">Measuring…</p> : <>
                    {m.saved && <div class="message">Saved{isotherm ? ", isotherm " + isothermText(isotherm, p.unit) : ""}</div>}
                    {p.note && <div class="message measure-note">{p.note}</div>}
                    <ResultView res={m.res} unit={p.unit} shape={m.shape} labels={p.labels} compared={p.compared} pixels={p.pixels}
                                index={p.index} onIndex={p.onIndex}/>
                </>}
            {valid && (p.onKeep || p.onSources) && <div class="inline measure-card-actions">
                {p.onKeep && <button type="button" class="button primary small" name="keep-finding" onClick={p.onKeep}
                                     title="Keep this spot, area or Delta T, its figures and frames, as a finding of the flight">
                    <Flag/> Keep as finding</button>}
                {p.onSources && <button type="button" class="button default small" name="sources" onClick={p.onSources}
                                        title="The frames that saw it, in a window"><Images/> Source frames</button>}
            </div>}
            {valid && !m.saved && <div class="inline measure-save" id="save">
                <input type="text" name="name" maxLength={255} placeholder="Name" aria-label="Measurement name" value={p.name}
                       onInput={(e) => p.onName(e.currentTarget.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") p.onSave(); }}/>
                <button type="button" class="button default small" name="save" onClick={p.onSave}><Save/> Save measurement</button>
            </div>}
            {p.error && <div class="text-danger" id="measure-error">{p.error}</div>}
        </div>
    </section>);
}

export interface IsothermState {mode: string; a?: string; b?: string}

// The isotherm: the pixels above, below or between temperatures (typed in the user's unit) keep the palette.
// onChange(state, field): field is the one changed (mode, a or b).
// what: the values' name; unit: theirs (the temperature's symbol unless given)
export function Isotherm({state, error, onChange, what = "Temperature", unit}: {state: IsothermState; error?: string;
                         onChange: (s: IsothermState, field: string) => void; what?: string; unit?: string}) {
    const mode = state.mode;
    return (<div class="isotherm">
        <select aria-label="Isotherm" value={mode} onChange={(e) => onChange({...state, mode: e.currentTarget.value}, "mode")}>
            {ISOTHERM_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="number" step="0.1" title={what} aria-label={what} hidden={!mode} value={state.a ?? ""}
               onChange={(e) => onChange({...state, a: e.currentTarget.value}, "a")}/>
        <input type="number" step="0.1" title="Up to" aria-label="Up to" hidden={mode !== "between"} value={state.b ?? ""}
               onChange={(e) => onChange({...state, b: e.currentTarget.value}, "b")}/>
        {mode && <span class="unit">{unit ?? symbol()}</span>}
        <div class="text-danger" role="alert">{error || ""}</div>
        {mode && <div class="message">Its pixels keep the palette, the rest is grey.</div>}
    </div>);
}

function ResultTable({head, rows, two}: {head?: string[]; rows: ReturnType<typeof resultRows>; two: boolean}) {
    return (<table class="table result">
        {head && <thead><tr><th/>{head.map((h) => <th>{h}</th>)}</tr></thead>}
        <tbody>{rows.map((r) => (<tr key={r.label}>
            <th>{r.label}</th>
            {two ? [0, 1].map((i) => <td>{r.values[i] === undefined ? "" : r.values[i]}</td>) : r.values.map((v) => <td>{v}</td>)}
            {two && <td>{r.difference || ""}</td>}
        </tr>))}</tbody>
    </table>);
}

interface ResultProps {
    res: Measured | null | undefined;
    unit: unknown;
    labels?: [string, string];          // the columns' names when parameters were changed
    compared?: boolean;                 // two mosaics' results: their difference the first's minus the second's
    shape?: Measured["shape"];
    pixels?: boolean;                   // a frame: sizes in pixels
    index?: number | null;              // a line's profile: the sample the cursor is at on the map
    onIndex?: (i: number | null) => void;
}

// A measure's figures (as converted, and with the parameters changed), its kind, and a line's profile or an area's
// histogram
export function ResultView({res, unit, labels, compared, shape, pixels, index, onIndex}: ResultProps) {
    const a = res && res.result;
    if (!res || !a) return null;
    if (!a.valid_pixels) return <p class="message">{a.reason === "outside_raster" ? "Outside the mosaic." : "No data there."}</p>;
    const results: Result[] = res.changed ? [a, res.changed] : [a];
    const two = results.length === 2;
    const names = labels || ["As converted", "Changed"];
    const kind = shapeLabel(a, shape || res.shape);
    return (<div class="measure-result">
        {kind && <div class="result-kind">{kind}</div>}
        <ResultTable head={two ? [names[0], names[1], compared ? names[0] + " − " + names[1] : "Difference"] : undefined}
                     rows={resultRows(results, unit, pixels, compared)} two={two}/>
        {res.approximate && <p class="message"><Info/> {APPROXIMATE}</p>}
        {a.profile && <Profile profile={a.profile} unit={unit} other={res.changed && res.changed.profile} pixels={pixels}
                               names={compared && two ? names : undefined} index={index} onIndex={onIndex}/>}
        <Histogram hist={a.histogram} unit={unit} other={res.changed && res.changed.histogram}/>
    </div>);
}

// Two saved measurements side by side, with their difference (b - a)
export function Comparison({a, b, unit}: {a: Measurement; b: Measurement; unit: unknown}) {
    const ra = a.values?.result, rb = b.values?.result;
    if (!ra || !rb) return null;
    return (<div class="measure-compare">
        <ResultTable head={[a.name, b.name, "Difference"]} rows={resultRows([ra, rb], unit, a.target === "frame")} two={true}/>
    </div>);
}

interface ParamsFormProps {
    m: Measurement;
    fields: ParamField[];
    unit: unknown;
    // Measures again with the values typed (by key; empty: the conversion's own): resolves to an error, or null
    onSave: (values: Record<string, string>) => Promise<string | null>;
    onCancel: () => void;
}

// A saved measurement's parameters, to measure it again with others
export function ParamsForm({m, fields, unit, onSave, onCancel}: ParamsFormProps) {
    const p = m.parameters || {};
    const [values, setValues] = useState<Record<string, string>>(() => {
        const out: Record<string, string> = {};
        fields.forEach((f) => {
            const v = p[f[0]];
            out[f[0]] = v === null || v === undefined ? "" : (f[3] ? shownTemp(v, unit) : String(v));
        });
        return out;
    });
    const [error, setError] = useState("");

    async function save() {
        setError("Measuring…");
        setError((await onSave(values)) || "");
    }

    return (<div class="params-form">
        {fields.map((f) => (<label key={f[0]}>{f[1]}{f[3] ? " (" + symbol() + ")" : ""}{" "}
            <input type="number" step={f[2]} data-param-field={f[0]} value={values[f[0]]} placeholder="As converted"
                   onInput={(e) => setValues({...values, [f[0]]: e.currentTarget.value})}/></label>))}
        <div class="text-danger" role="alert">{error}</div>
        <button type="button" class="button primary small" onClick={save}>Measure again</button>{" "}
        <button type="button" class="button default small" onClick={onCancel}>Cancel</button>
    </div>);
}

interface MeasurementsProps {
    items: Measurement[];
    unit: unknown;
    current: number | null;             // the one shown
    compared: number[];                 // the ids ticked to compare, two at most
    editing: number | null;             // the one whose parameters are being changed
    fields: ParamField[];               // the parameters one can change (none: no Measure again)
    onShow: (m: Measurement) => void;
    onCompare: (id: number, on: boolean) => void;
    onEdit: (id: number | null) => void;
    onRename: (m: Measurement) => void;
    onDelete: (m: Measurement) => void;
    onRemeasure: (m: Measurement, values: Record<string, string>) => Promise<string | null>;
    onFinding?: (m: Measurement) => void;   // saved as a finding (a spot, an area or a Delta T on a mosaic)
}

// The saved measurements: a line each with its name, where it was measured and its main figure, then the two ticked
// compared
export function Measurements(props: MeasurementsProps) {
    const {items, unit, current, compared, editing, fields} = props;
    if (!items.length) return <p class="message">No measurements saved yet.</p>;
    const picked = compared.map((id) => items.find((m) => m.id === id)).filter((m): m is Measurement => !!m);
    return (<div class="measurements-list">
        <ul class="measurements">{items.map((m) => {
            const r = m.values?.changed || m.values?.result || {};
            const params = paramsText(m.parameters, fields, unit);
            return (<li key={m.id} class={m.id === current ? "active" : ""} data-measurement={m.id}>
                <input type="checkbox" title="Compare" aria-label={"Compare " + m.name} checked={compared.includes(m.id)}
                       onChange={(e) => props.onCompare(m.id, e.currentTarget.checked)}/>{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); props.onShow(m); }}><strong>{m.name}</strong></a>{" "}
                <span class="text-muted">{shapeLabel(r, m.values?.shape) + " · " + targetLabel(m)}</span>
                <div class="measurement-figure">{measurementFigure(m, unit)}</div>
                {params && <div class="measurement-params text-muted">Measured with {params}</div>}
                {m.comment && <div class="measurement-comment text-muted">{m.comment}</div>}
                {fields.length > 0 && <button type="button" class="icon-button" title="Measure again with other parameters"
                                              onClick={() => props.onEdit(editing === m.id ? null : m.id)}><Sliders/></button>}
                {props.onFinding && m.target !== "frame" &&
                    (m.geometry?.type === "Point" || m.geometry?.type === "Polygon" || isDelta(m.values?.shape)) &&
                    <button type="button" class="icon-button" name="finding" title="Save as finding"
                            onClick={() => props.onFinding!(m)}><Flag/></button>}
                <button type="button" class="icon-button" title="Rename" onClick={() => props.onRename(m)}><Pencil/></button>
                <button type="button" class="icon-button" title="Delete" onClick={() => props.onDelete(m)}><Trash/></button>
                {editing === m.id && <ParamsForm m={m} fields={fields} unit={unit} onSave={(v) => props.onRemeasure(m, v)}
                                                 onCancel={() => props.onEdit(null)}/>}
            </li>);
        })}</ul>
        {picked.length === 2 ? <Comparison a={picked[0]} b={picked[1]} unit={unit}/> :
            items.length >= 2 && <p class="message">Tick two to compare them.</p>}
    </div>);
}
