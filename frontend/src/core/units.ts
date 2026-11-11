// Temperatures: a conversion's values are in the unit its files were written in (C, F or K); they are shown, and
// typed, in the user's (the unit chosen in the header, given to the page in its settings: setUserUnit)
import {formatNumber, type Maybe} from "./format";

export type Unit = "C" | "F" | "K";

const UNIT_SYMBOLS: Record<Unit, string> = {C: "°C", F: "°F", K: "K"};
const UNIT_SCALE: Record<Unit, number> = {C: 1, F: 1.8, K: 1};
const UNIT_ZERO: Record<Unit, number> = {C: 0, F: 32, K: 273.15};   // 0 °C in each unit

let current: Unit = "C";

export function unitOf(u: unknown): Unit { return typeof u === "string" && u in UNIT_SYMBOLS ? u as Unit : "C"; }
export function userUnit(): Unit { return current; }
export function setUserUnit(u: unknown): void { current = unitOf(u); }
export function unitSymbol(u: unknown): string { return UNIT_SYMBOLS[unitOf(u)]; }

type Value = Maybe<number | string>;

function blankNumber(v: Value): v is null | undefined | "" {
    return v === null || v === undefined || v === "" || isNaN(Number(v));
}

// A temperature from one unit to another (to: the user's when left out)
export function convertTemp<V extends Value>(v: V, from: unknown, to?: unknown): V | number {
    if (blankNumber(v)) return v;
    const f = unitOf(from), t = to === undefined ? userUnit() : unitOf(to);
    if (f === t) return Number(v);
    return (Number(v) - UNIT_ZERO[f]) / UNIT_SCALE[f] * UNIT_SCALE[t] + UNIT_ZERO[t];
}

// A difference of temperatures (a range, ΔT, a standard deviation, an offset): scaled, never shifted
export function convertDelta<V extends Value>(v: V, from: unknown, to?: unknown): V | number {
    if (blankNumber(v)) return v;
    const f = unitOf(from), t = to === undefined ? userUnit() : unitOf(to);
    return Number(v) / UNIT_SCALE[f] * UNIT_SCALE[t];
}

// A temperature in the unit `from`, as the user sees it: "21.50 °F"
export function formatTemp(v: Value, from: unknown, digits = 2): string {
    return formatNumber(convertTemp(v, from), digits, " " + unitSymbol(userUnit()));
}

// A difference in the unit `from`, as the user sees it; signed: with its + when positive
export function formatDelta(v: Value, from: unknown, digits = 2, signed = false): string {
    if (blankNumber(v)) return "";
    // A difference that rounds to nothing is 0, with no sign (not -0.00)
    const d = convertDelta(v, from) as number, shown = Number(d.toFixed(digits)) || 0;
    return (signed && shown > 0 ? "+" : "") + formatNumber(shown, digits, " " + unitSymbol(userUnit()));
}
