// A measure's charts: a line's profile (with a cursor that follows the chart or the line on the map) and a histogram
import {useState} from "preact/hooks";
import {type Maybe} from "../core/format";
import {type Histogram as Hist, isValue, lengthText, type Profile as Prof, temp} from "./measure";

const W = 260;
const PROFILE_H = 80, PAD = 3;
const HISTOGRAM_H = 64;
const NO_CURSOR = "Move the cursor over the chart or the line.";

// A line per stretch with data
function linePath(values: Maybe<number>[], x: (i: number) => number, y: (v: number) => number): string {
    let d = "", on = false;
    values.forEach((v, i) => {
        if (!isValue(v)) { on = false; return; }
        d += (on ? " L" : " M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
        on = true;
    });
    return d.trim();
}

// The frames a mosaic's profile was read from, as a strip of their stretches
function FramesStrip({frames}: {frames: Maybe<string>[]}) {
    const runs: {frame: Maybe<string>; count: number}[] = [];
    frames.forEach((f) => {
        const last = runs[runs.length - 1];
        if (last && last.frame === f) last.count++;
        else runs.push({frame: f, count: 1});
    });
    return (<div class="profile-frames">{runs.map((r, i) => {
        const name = r.frame === null || r.frame === undefined ? "" : String(r.frame);
        return <span class={name ? "profile-frame-" + (i % 2) : "profile-frame-none"}
                     style={{width: (r.count / frames.length * 100).toFixed(2) + "%"}}
                     title={name ? "Frame " + name.split("/").pop() : "No frame"}/>;
    })}</div>);
}

interface ProfileProps {
    profile: Prof;
    unit: unknown;
    other?: Maybe<Prof>;            // a second profile (parameters changed) drawn over it
    names?: [string, string];       // the two profiles' names in the readout (two mosaics compared)
    pixels?: boolean;               // a frame: distances in pixels
    index?: number | null;          // the sample the cursor is at on the map's line
    onIndex?: (i: number | null) => void;   // the cursor moved over the chart (null: it left)
}

// A line's profile (evenly spaced samples, null where there is no data) as a line chart, with its hottest and coldest
// samples, a cursor and, on a mosaic, the frames each stretch was read from
export function Profile({profile, unit, other, names, pixels, index, onIndex}: ProfileProps) {
    const [hovered, setHovered] = useState<number | null>(null);
    const n = profile.values.length;
    if (n < 2) return null;
    const others = other && other.values && other.values.length === n ? other.values : null;
    const all = profile.values.concat(others || []).filter(isValue);
    if (!all.length) return <p class="message">No data along the line.</p>;
    let lo = Math.min(...all), hi = Math.max(...all);
    if (hi === lo) { lo -= 0.5; hi += 0.5; }
    const x = (i: number) => i / (n - 1) * W;
    const y = (v: number) => PAD + (hi - v) / (hi - lo) * (PROFILE_H - 2 * PAD);
    const values = profile.values.filter(isValue);
    const marks = values.length ? ([["profile-max", Math.max(...values)], ["profile-min", Math.min(...values)]] as const) : [];
    const at = hovered !== null ? hovered : (index === undefined || index === null || index < 0 ? null : index);

    function move(e: MouseEvent) {
        const box = (e.currentTarget as SVGElement).getBoundingClientRect();
        const f = box.width ? (e.clientX - box.left) / box.width : 0;
        const i = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
        setHovered(i);
        onIndex?.(i);
    }

    function leave() {
        setHovered(null);
        onIndex?.(null);
    }

    let readout = NO_CURSOR;
    if (at !== null) {
        const v = profile.values[at];
        const shown = isValue(v) ? temp(v, unit) : "no data";
        const parts = [lengthText(profile.distance[at], pixels), names ? names[0] + " " + shown : shown];
        if (others && isValue(others[at])) parts.push((names ? names[1] : "changed") + " " + temp(others[at], unit));
        if (profile.frames && profile.frames[at]) parts.push(String(profile.frames[at]).split("/").pop()!);
        readout = parts.join(" · ");
    }

    return (<div class="profile">
        <div class="profile-chart">
            <svg viewBox={"0 0 " + W + " " + PROFILE_H} preserveAspectRatio="none" role="img"
                 aria-label="Temperature along the line" onMouseMove={move} onMouseLeave={leave}>
                <path class="profile-line" d={linePath(profile.values, x, y)}/>
                {others && <path class="profile-changed" d={linePath(others, x, y)}/>}
                {marks.map(([cls, v]) => {
                    const i = profile.values.indexOf(v);
                    return <circle class={cls} cx={x(i).toFixed(1)} cy={y(v).toFixed(1)} r="2.5"/>;
                })}
                <line class="profile-cursor" x1={at === null ? 0 : x(at).toFixed(1)} x2={at === null ? 0 : x(at).toFixed(1)}
                      y1="0" y2={PROFILE_H} visibility={at === null ? "hidden" : "visible"}/>
            </svg>
            <div class="profile-temps"><span>{temp(hi, unit, 1)}</span><span>{temp(lo, unit, 1)}</span></div>
        </div>
        <div class="chart-axis"><span>0</span><span>{lengthText(profile.distance[n - 1], pixels)}</span></div>
        {profile.frames && <FramesStrip frames={profile.frames}/>}
        <div class="profile-readout message">{readout}</div>
    </div>);
}

// A histogram (counts, edges) as a bar chart; other: a second one drawn over it as a line, on the same scale
export function Histogram({hist, unit, other}: {hist: Maybe<Hist>; unit: unknown; other?: Maybe<Hist>}) {
    if (!hist || !hist[0] || !hist[0].length) return null;
    const H = HISTOGRAM_H;
    const all = [hist].concat(other && other[0] ? [other] : []);
    const lo = Math.min(...all.map((h) => h[1][0]));
    const hi = Math.max(...all.map((h) => h[1][h[1].length - 1]));
    const top = Math.max(...all.map((h) => Math.max(...h[0]))) || 1;
    const x = (v: number) => hi > lo ? (v - lo) / (hi - lo) * W : 0;
    const y = (c: number) => H - c / top * H;
    const points: string[] = [];
    if (other && other[0]) {
        other[0].forEach((c, i) => {
            points.push(x(other[1][i]).toFixed(1) + "," + y(c).toFixed(1));
            points.push(x(other[1][i + 1]).toFixed(1) + "," + y(c).toFixed(1));
        });
    }
    return (<div class="histogram">
        <svg viewBox={"0 0 " + W + " " + H} preserveAspectRatio="none" role="img" aria-label="Histogram">
            <g class="histogram-bars">{hist[0].map((c, i) => {
                const x0 = x(hist[1][i]), x1 = x(hist[1][i + 1]);
                return <rect x={x0.toFixed(1)} y={y(c).toFixed(1)} width={Math.max(0.5, x1 - x0).toFixed(1)}
                             height={(H - y(c)).toFixed(1)}/>;
            })}</g>
            {points.length > 0 && <polyline class="histogram-changed" points={points.join(" ")}/>}
        </svg>
        <div class="chart-axis"><span>{temp(lo, unit, 1)}</span><span>{temp(hi, unit, 1)}</span></div>
    </div>);
}
