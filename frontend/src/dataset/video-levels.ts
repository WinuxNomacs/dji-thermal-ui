// A thermal video's frame turned back into levels (0 to 255): the camera drew each level in its palette (DJI's
// ironred), so each pixel's colour is looked up as the level nearest it. Levels are relative: the camera re-ranges
// each frame, so a level is not the same heat from one frame to the next.

const BITS = 5, CELLS = 1 << BITS, SHIFT = 8 - BITS;
export const LEVELS: [number, number] = [0, 255];

// For each colour (its red, green and blue cut to BITS bits), the level whose colour is nearest its cell's centre
export function levelCube(colors: number[]): Uint8Array {
    const table = colors.map((c) => [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255]);
    const cube = new Uint8Array(CELLS * CELLS * CELLS), half = 1 << (SHIFT - 1);
    for (let r = 0; r < CELLS; r++) {
        for (let g = 0; g < CELLS; g++) {
            for (let b = 0; b < CELLS; b++) {
                const x = (r << SHIFT) + half, y = (g << SHIFT) + half, z = (b << SHIFT) + half;
                let best = 0, bestD = Infinity;
                table.forEach(([tr, tg, tb], i) => {
                    const d = (tr - x) ** 2 + (tg - y) ** 2 + (tb - z) ** 2;
                    if (d < bestD) { best = i; bestD = d; }
                });
                cube[(r * CELLS + g) * CELLS + b] = Math.round(best * 255 / Math.max(1, table.length - 1));
            }
        }
    }
    return cube;
}

// A frame's pixels (RGBA, as a canvas gives them) as levels
export function toLevels(rgba: Uint8ClampedArray, cube: Uint8Array, out = new Float32Array(rgba.length / 4)): Float32Array<ArrayBuffer> {
    for (let i = 0, j = 0; j < out.length; i += 4, j++) {
        out[j] = cube[((rgba[i] >> SHIFT) * CELLS + (rgba[i + 1] >> SHIFT)) * CELLS + (rgba[i + 2] >> SHIFT)];
    }
    return out;
}

// The levels' lo-th to hi-th percentile (the Auto range), at least one level wide
export function levelRange(levels: Float32Array, lo = 2, hi = 98): [number, number] {
    if (!levels.length) return LEVELS;
    const counts = new Array(256).fill(0);
    levels.forEach((v) => counts[Math.max(0, Math.min(255, Math.round(v)))]++);
    const at = (pct: number) => {
        const want = pct / 100 * levels.length;
        let seen = 0;
        for (let i = 0; i < 256; i++) {
            seen += counts[i];
            if (seen >= want) return i;
        }
        return 255;
    };
    const a = at(lo), b = at(hi);
    return b > a ? [a, b] : [Math.min(a, 254), Math.min(a, 254) + 1];
}

// The isotherm typed (a mode of ISOTHERM_MODES and its levels) as the levels inside it, null for none, or {error}
export function levelIsotherm(mode: string, a: string, b: string): {range?: [number, number] | null; error?: string} {
    if (!mode) return {range: null};
    const x = parseFloat(a), y = parseFloat(b);
    if (isNaN(x)) return {error: "The isotherm needs a level"};
    if (mode === "above") return {range: [x, Infinity]};
    if (mode === "below") return {range: [-Infinity, x]};
    if (isNaN(y)) return {error: "The isotherm needs two levels"};
    if (!(y > x)) return {error: "The second level must be above the first"};
    return {range: [x, y]};
}
