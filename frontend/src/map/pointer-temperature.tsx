// Temperature On Pointer (the box in Pointer info's heading, on the viewer and the frame page): the temperature Pointer
// info reads, in a small tip beside the pointer once it rests, and no tip where there is no temperature. Off until
// ticked, then remembered in this browser.
import type {Coordinate} from "ol/coordinate";
import type OlMap from "ol/Map";
import Overlay from "ol/Overlay";
import {useState} from "preact/hooks";
import {temp} from "../measure/measure";

export const POINTER_TEMPERATURE_KEY = "thermal-analyzer.pointer-temperature";

// Whether the box is ticked, and ticking it (remembered)
export function usePointerTemperature(): [boolean, (on: boolean) => void] {
    const [on, setOn] = useState(() => {
        try { return localStorage.getItem(POINTER_TEMPERATURE_KEY) === "1"; } catch { return false; }
    });
    const change = (next: boolean) => {
        setOn(next);
        try { localStorage.setItem(POINTER_TEMPERATURE_KEY, next ? "1" : "0"); } catch { /* kept for this visit only */ }
    };
    return [on, change];
}

// The tip on a map: show(at, text) puts it beside the place at, below right of the pointer; hide() takes it away
export interface PointerTip {show: (at: Coordinate, text: string) => void; hide: () => void}

export function pointerTip(map: OlMap): PointerTip {
    const el = document.createElement("div");
    el.className = "map-tip pointer-temperature";
    el.hidden = true;
    const tip = new Overlay({element: el, offset: [14, 14], positioning: "top-left", stopEvent: false});
    map.addOverlay(tip);
    return {
        show: (at, text) => {
            el.textContent = text;
            tip.setPosition(at);
            el.hidden = false;
        },
        hide: () => { el.hidden = true; },
    };
}

// What the tip says for a temperature read there, or null where there is none (no tip)
export function pointerText(t: unknown, unit: unknown): string | null {
    return typeof t === "number" && Number.isFinite(t) ? temp(t, unit) : null;
}

// The box (in Pointer info's heading; by the compare page's isotherm)
export function PointerTemperatureBox({on, onChange, title = "The temperature under the pointer, beside it, once it rests"}:
                                      {on: boolean; onChange: (on: boolean) => void; title?: string}) {
    return (<label class="pointer-temperature-box" title={title} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" id="pointer-temperature" checked={on}
               onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}/>
        Temperature On Pointer
    </label>);
}

// Pointer info's heading, with the box at its right
export function PointerHead({on, onChange}: {on: boolean; onChange: (on: boolean) => void}) {
    return (<span class="measurements-head"><span>Pointer info</span><PointerTemperatureBox on={on} onChange={onChange}/></span>);
}
