// How the browser colours the values the server sends (data tiles and frames: float32, NO_DATA where there are none),
// as the server drew its images (thermal_measure.colorize): over a range, toned by the image's curve (gamma, or the
// equalization's), sharpened with an unsharp mask, an isotherm's pixels in the palette and the rest in grey, or each
// source frame in its own colour, or the seams between the source frames as lines. Plain functions, no DOM: the style a WebGL tile layer is drawn with.
import type {ExpressionValue} from "ol/expr/expression";

// Below this is no data (the server's NO_DATA is -1e30: WebGL cannot test for NaN)
export const NO_DATA_BELOW = -1e29;
// The palette's entries along the range, the tone curve baked into them
export const TONE_STEPS = 1024;
// The server's 256 levels of a palette
const LEVELS = 255;
// The unsharp mask's sigma, in the pixels of the values drawn: as the server clamps it, and within a mosaic tile's
// gutter (its 5 × 5 taps reach two sigmas)
export const SIGMA_LIMITS = [0.5, 4];
const TAPS = [-2, -1, 0, 1, 2], WEIGHTS = [1, 4, 6, 4, 1];      // a binomial blur: its variance is the spacing's square

type Rgba = [number, number, number, number];

export interface Colouring {
    colors: number[];                       // the palette, as the API gives it (0xRRGGBBAA)
    range?: [number, number];               // the values at either end of the palette
    shares?: number[] | null;               // the palette's share at values evenly across the range (null: linear)
    sharpen?: number;                       // the unsharp mask's amount (0: none)
    isotherm?: [number, number] | null;     // the values drawn in the palette, the rest in grey
    index?: boolean;                        // each value its own colour (the source frames): colors[value mod length]
    seams?: boolean;                        // only the seams, where the value (a source frame) changes; the rest clear
}

// A seam is drawn two pixels wide, light on the one side and dark on the other, to show over any palette
const SEAM_LIGHT: Rgba = [255, 255, 255, 1], SEAM_DARK: Rgba = [20, 20, 20, 1];
// The neighbours the seam's light side (right and below) and dark side (left and above) are found with
const SEAM_LIGHT_SIDE = [[1, 0], [0, 1]], SEAM_DARK_SIDE = [[-1, 0], [0, -1]];

const rgba = (encoded: number): Rgba => {
    const c = encoded >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, 1];
};

// A share of the range (0 to 1) toned: along shares (interpolated between its samples), else as it is
export function toned(u: number, shares?: number[] | null): number {
    const x = Math.max(0, Math.min(1, u));
    if (!shares || shares.length < 2) return x;
    const at = x * (shares.length - 1), i = Math.min(Math.floor(at), shares.length - 2), f = at - i;
    return shares[i] * (1 - f) + shares[i + 1] * f;
}

// The palette as drawn along the range: TONE_STEPS entries, each the server's level (0 to 255) of its toned share in
// the palette, or in grey
export function tonedPalette(colors: number[], shares?: number[] | null, grey = false): Rgba[] {
    const out: Rgba[] = [];
    for (let i = 0; i < TONE_STEPS; i++) {
        const level = Math.round(toned(i / (TONE_STEPS - 1), shares) * LEVELS);
        out.push(grey ? [level, level, level, 1] : rgba(colors[Math.round(level * (colors.length - 1) / LEVELS)] ?? 0));
    }
    return out;
}

// The isotherm as the server takes it ("above,T", "below,T", "between,A,B") as the values inside it, or null
export function isothermRange(value: string | null | undefined): [number, number] | null {
    const p = String(value || "").split(","), n = p.slice(1).map(Number);
    if (n.some(isNaN)) return null;
    if (p[0] === "above" && n.length === 1) return [n[0], 3e38];
    if (p[0] === "below" && n.length === 1) return [-3e38, n[0]];
    if (p[0] === "between" && n.length === 2) return [n[0], n[1]];
    return null;
}

// The values sent (float32 little-endian, row by row) of a width × height grid
export function decodeValues(buffer: ArrayBuffer, width: number, height: number): Float32Array {
    if (buffer.byteLength !== width * height * 4) throw new Error("Expected " + width + " × " + height + " values");
    const view = new DataView(buffer), out = new Float32Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
    return out;
}

// The unsharp mask's sigma in the pixels drawn, from the raster's pixel and the drawn one (the same unit), clamped
export function sharpenSigma(rasterPixel: number, drawnPixel: number): number {
    const s = rasterPixel > 0 && drawnPixel > 0 ? rasterPixel / drawnPixel : 1;
    return Math.max(SIGMA_LIMITS[0], Math.min(SIGMA_LIMITS[1], s));
}

const value = (dx: ExpressionValue = 0, dy: ExpressionValue = 0): ExpressionValue => ["band", 1, dx, dy];
// NO_DATA_BELOW as a variable: OpenLayers writes a number such as 1e29 into GLSL as 1e+29.0, which does not compile
const NO_DATA: ExpressionValue = ["var", "noData"];
// A value's share of the range, clamped
const share = (v: ExpressionValue): ExpressionValue => ["clamp", ["/", ["-", v, ["var", "low"]], ["var", "span"]], 0, 1];

// The share sharpened: the pixels around it within the gutter blurred (those with no data left out), and its difference
// from them added amount times
function sharpened(): ExpressionValue {
    const sums: ExpressionValue[] = [], weights: ExpressionValue[] = [];
    TAPS.forEach((y, j) => TAPS.forEach((x, i) => {
        const v = value(x ? ["*", x, ["var", "sigma"]] : 0, y ? ["*", y, ["var", "sigma"]] : 0), w = WEIGHTS[i] * WEIGHTS[j];
        const has: ExpressionValue = [">=", v, NO_DATA];
        sums.push(["case", has, ["*", w, share(v)], 0]);
        weights.push(["case", has, w, 0]);
    }));
    const u = share(value()), blurred: ExpressionValue = ["/", ["+", ...sums], ["+", ...weights]];
    return ["clamp", ["+", u, ["*", ["var", "sharpen"], ["-", u, blurred]]], 0, 1];
}

// The style a WebGL tile layer colours its values with, and the variables it reads (sigma: the unsharp mask's, in the
// pixels drawn, updated as the map zooms)
export function colourStyle(c: Colouring, sigma = 1): {color: ExpressionValue; variables: Record<string, number>} {
    const v = value(), none: ExpressionValue = [0, 0, 0, 0];
    if (c.seams) {
        // where the frame changes between two pixels with data (the mosaic's edge is not a seam)
        const changed = (sides: number[][]): ExpressionValue => ["any", ...sides.map(([dx, dy]): ExpressionValue => {
            const n = value(dx, dy);
            return ["all", [">=", n, NO_DATA], ["!=", ["round", n], ["round", v]]];
        })];
        return {color: ["case", ["<", v, NO_DATA], none, changed(SEAM_LIGHT_SIDE), SEAM_LIGHT, changed(SEAM_DARK_SIDE),
                        SEAM_DARK, none], variables: {noData: NO_DATA_BELOW}};
    }
    if (c.index) {
        const colors = c.colors.map(rgba);
        return {color: ["case", ["<", v, NO_DATA], none, ["palette", ["%", ["round", v], colors.length], colors]],
                variables: {noData: NO_DATA_BELOW}};
    }
    const range = c.range || [0, 1], sharpen = c.sharpen || 0;
    const variables: Record<string, number> = {noData: NO_DATA_BELOW, low: range[0], span: range[1] - range[0] || 1};
    let u = share(v);
    if (sharpen > 0) {
        u = sharpened();
        Object.assign(variables, {sharpen, sigma: Math.max(SIGMA_LIMITS[0], Math.min(SIGMA_LIMITS[1], sigma))});
    }
    const step: ExpressionValue = ["round", ["*", u, TONE_STEPS - 1]];
    let color: ExpressionValue = ["palette", step, tonedPalette(c.colors, c.shares)];
    if (c.isotherm) {
        Object.assign(variables, {isoLow: c.isotherm[0], isoHigh: c.isotherm[1]});
        color = ["case", ["all", [">=", v, ["var", "isoLow"]], ["<=", v, ["var", "isoHigh"]]], color,
                 ["palette", step, tonedPalette(c.colors, c.shares, true)]];
    }
    return {color: ["case", ["<", v, NO_DATA], none, color], variables};
}

// The values of a response (see decodeValues), its width and height in X-Width and X-Height
export async function readValues(res: Response): Promise<{values: Float32Array; width: number; height: number}> {
    if (!res.ok) throw new Error("The values could not be loaded");
    const width = parseInt(res.headers.get("X-Width") || "", 10), height = parseInt(res.headers.get("X-Height") || "", 10);
    return {values: decodeValues(await res.arrayBuffer(), width, height), width, height};
}

// The values coloured as colourStyle has the GPU colour them, as RGBA bytes (for a small image drawn without WebGL)
export function colourValues(values: Float32Array, width: number, height: number, c: Colouring, sigma = 1): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * height * 4);
    const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? -Infinity : values[y * width + x];
    const put = (i: number, rgb: Rgba) => { out.set([rgb[0], rgb[1], rgb[2], 255], i * 4); };
    if (c.seams) {
        const changed = (x: number, y: number, sides: number[][]) => sides.some(([dx, dy]) => {
            const n = at(x + dx, y + dy);
            return n >= NO_DATA_BELOW && Math.round(n) !== Math.round(at(x, y));
        });
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!(at(x, y) >= NO_DATA_BELOW)) continue;
                if (changed(x, y, SEAM_LIGHT_SIDE)) put(y * width + x, SEAM_LIGHT);
                else if (changed(x, y, SEAM_DARK_SIDE)) put(y * width + x, SEAM_DARK);
            }
        }
        return out;
    }
    if (c.index) {
        const colors = c.colors.map(rgba), n = colors.length;
        values.forEach((v, i) => { if (v >= NO_DATA_BELOW && n) put(i, colors[((Math.round(v) % n) + n) % n]); });
        return out;
    }
    const range = c.range || [0, 1], span = range[1] - range[0] || 1, sharpen = c.sharpen || 0;
    const s = Math.max(SIGMA_LIMITS[0], Math.min(SIGMA_LIMITS[1], sigma));
    const share = (v: number) => Math.max(0, Math.min(1, (v - range[0]) / span));
    const palette = tonedPalette(c.colors, c.shares), grey = c.isotherm ? tonedPalette(c.colors, c.shares, true) : palette;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const v = at(x, y);
            if (!(v >= NO_DATA_BELOW)) continue;
            let u = share(v);
            if (sharpen > 0) {
                let sum = 0, weight = 0;
                TAPS.forEach((dy, j) => TAPS.forEach((dx, i) => {
                    const n = at(x + Math.round(dx * s), y + Math.round(dy * s)), w = WEIGHTS[i] * WEIGHTS[j];
                    if (n >= NO_DATA_BELOW) { sum += w * share(n); weight += w; }
                }));
                u = Math.max(0, Math.min(1, u + sharpen * (u - sum / weight)));
            }
            const step = Math.round(u * (TONE_STEPS - 1)), inside = !c.isotherm || (v >= c.isotherm[0] && v <= c.isotherm[1]);
            put(y * width + x, (inside ? palette : grey)[step]);
        }
    }
    return out;
}
