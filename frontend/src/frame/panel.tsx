// The frame page's panel: the parameters the frame is measured again with, the frame's own figures, and the values
// under the cursor
import {Play, Refresh} from "../components/icons";
import {formatNumber, type Maybe} from "../core/format";
import {convertTemp} from "../core/units";
import {Histogram} from "../measure/charts";
import {signed, symbol, temp} from "../measure/measure";
import {CHANGES, type Changes, DISTANCE_SOURCES, type FrameInfo, limits} from "./frame";

interface ParamsProps {
    info: Maybe<FrameInfo>;
    recorded: Maybe<Record<string, Maybe<number>>>;     // as the camera recorded them
    starts: Record<string, string>;                     // what the frame was measured with (changeStarts)
    values: Record<string, string>;                     // what is typed in the fields
    changes: Changes;                                   // those applied
    newUrl: string;                                     // a new conversion with the changes
    error?: string;
    field?: string;
    onInput: (key: string, value: string) => void;
    onApply: () => void;
    onClear: () => void;
}

// The frame's parameters: as recorded, as measured with, and to change to. Each field starts at the value it was
// measured with, so its arrows step from there; Enter in one measures again.
export function Params(p: ParamsProps) {
    const params = p.info?.params || {}, any = Object.keys(p.changes).length > 0;
    return (<>
        <table class="table values params">
            <thead><tr><th/><th title="As the camera recorded it (the distance: the rangefinder's)">Recorded</th>
                <th>Measured with</th><th>Change to</th></tr></thead>
            <tbody>{CHANGES.map(([key, label, step, isTemp, sdkKey, recordedKey]) => {
                const digits = key === "emissivity" ? 2 : 1, range = limits(key);
                const rec = (p.recorded || {})[recordedKey];
                return (<tr key={key} class={p.field === key ? "has-error" : undefined}>
                    <th>{label}{isTemp ? " (" + symbol() + ")" : ""}</th>
                    <td>{formatNumber(isTemp ? convertTemp(rec, "C") as Maybe<number> : rec, digits)}</td>
                    <td>{formatNumber(isTemp ? convertTemp(params[sdkKey], "C") as Maybe<number> : params[sdkKey], digits)}</td>
                    <td><input type="number" name={key} step={step} min={range[0]} max={range[1] ?? undefined}
                               value={p.values[key]} onInput={(e) => p.onInput(key, e.currentTarget.value)}
                               onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); p.onApply(); } }}/></td>
                </tr>);
            })}</tbody>
        </table>
        {p.info?.distance_source && <p class="message">The distance is {DISTANCE_SOURCES[p.info.distance_source] ||
            p.info.distance_source}.</p>}
        {p.error && <div class="text-danger" id="change-error">{p.error}</div>}
        <div class="inline">
            <button type="button" class="button primary small" id="change-apply" onClick={p.onApply}><Refresh/> Measure again</button>
            {any && <>
                <button type="button" class="button default small" id="change-clear" onClick={p.onClear}>Clear</button>
                <a class="button default small" id="new-conversion" href={p.newUrl}><Play/> New conversion with these</a>
            </>}
        </div>
        <p class="message">dji-thermal-cli measures the frame again with the parameters changed: exact, as converting with
            them would.</p>
    </>);
}

// The frame's size, range and mean, its normalization, and its histogram (with the parameters changed over it)
export function Info({info, unit, normalized}: {info: Maybe<FrameInfo>; unit: unknown; normalized?: boolean}) {
    if (!info) return null;
    const s = info.stats || {};
    const rows: [string, string][] = [
        ["Size", info.width + " × " + info.height + " px"],
        ["Range", temp(s.min, unit, 1) + " to " + temp(s.max, unit, 1)],
        ["Mean", temp(s.mean, unit)],
    ];
    if (normalized) {
        rows.push(["Normalization", info.offset_known ? "offset " + signed(-(info.offset || 0), unit) + " applied" :
            "its offset is not known (converted before the app kept them): shown without it"]);
    }
    return (<>
        <table class="table values"><tbody>
            {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
        </tbody></table>
        <Histogram hist={s.histogram} unit={unit} other={info.changed?.stats?.histogram}/>
        {(info.notes || []).length > 0 && <p class="message">{info.notes!.join("; ")}</p>}
    </>);
}

export interface FramePoint {inside?: boolean; x?: number; y?: number; temperature?: number | null; changed?: number | null}

// The values under the cursor: as converted, and with the parameters changed
export function FrameReadout({point, unit}: {point: Maybe<FramePoint>; unit: unknown}) {
    if (point === undefined) return <span class="message">Move the cursor over the frame.</span>;
    if (!point || !point.inside) return <span class="message">Outside the frame.</span>;
    const t = point.temperature, c = point.changed;
    const rows: [string, string][] = [["x, y", Math.floor(point.x || 0) + ", " + Math.floor(point.y || 0)],
                                      ["As converted", t === null || t === undefined ? "no data" : temp(t, unit)]];
    if (c !== undefined) {
        rows.push(["Parameters changed", c === null ? "no data" : temp(c, unit)]);
        if (c !== null && t !== null && t !== undefined) rows.push(["Difference", signed(c - t, unit)]);
    }
    return (<table class="table values"><tbody>
        {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
    </tbody></table>);
}
