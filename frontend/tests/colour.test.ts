// Tests of how the browser colours the values the server sends: the tone curve, the palettes it is baked into, the
// isotherm, the values read, the unsharp mask's sigma, the WebGL style and the same colouring without WebGL
import {describe, expect, it} from "vitest";
import {colourStyle, colourValues, decodeValues, isothermRange, readValues, sharpenSigma, TONE_STEPS, toned,
        tonedPalette} from "../src/map/colour";

const BLACK_WHITE = [0x000000ff, 0xffffffff];
// The API's palettes have 256 colours: one per level
const GREYS = Array.from({length: 256}, (_, i) => ((i << 24) | (i << 16) | (i << 8) | 255) >>> 0);
const NONE = -1e30;
const pixel = (rgba: Uint8ClampedArray, i: number) => Array.from(rgba.slice(i * 4, i * 4 + 4));

describe("the tone curve", () => {
    it("leaves a share as it is without one, clamped", () => {
        expect(toned(0.3)).toBe(0.3);
        expect(toned(-1)).toBe(0);
        expect(toned(2, null)).toBe(1);
    });

    it("follows the shares between their samples", () => {
        expect(toned(0.5, [0, 0.8, 1])).toBeCloseTo(0.8);
        expect(toned(0.25, [0, 0.8, 1])).toBeCloseTo(0.4);
        expect(toned(1, [0, 0.8, 1])).toBe(1);
    });

    it("is baked into the palette as the server's levels, or in grey", () => {
        const p = tonedPalette(BLACK_WHITE, [0, 1, 1]);
        expect(p.length).toBe(TONE_STEPS);
        expect(p[0]).toEqual([0, 0, 0, 1]);
        expect(p[TONE_STEPS / 2]).toEqual([255, 255, 255, 1]);
        const grey = tonedPalette(BLACK_WHITE, null, true);
        expect(grey[TONE_STEPS - 1]).toEqual([255, 255, 255, 1]);
        expect(grey[Math.round((TONE_STEPS - 1) / 2)]).toEqual([128, 128, 128, 1]);
    });
});

describe("the isotherm", () => {
    it("is the values inside it", () => {
        expect(isothermRange("above,25")).toEqual([25, 3e38]);
        expect(isothermRange("below,-3.5")).toEqual([-3e38, -3.5]);
        expect(isothermRange("between,20,30")).toEqual([20, 30]);
    });

    it("is none when there is none or it does not read", () => {
        expect(isothermRange("")).toBeNull();
        expect(isothermRange(null)).toBeNull();
        expect(isothermRange("above,x")).toBeNull();
        expect(isothermRange("between,20")).toBeNull();
    });
});

describe("the values", () => {
    it("are read as little-endian float32, row by row", () => {
        const buffer = new ArrayBuffer(8), view = new DataView(buffer);
        view.setFloat32(0, 21.5, true);
        view.setFloat32(4, NONE, true);
        expect(Array.from(decodeValues(buffer, 2, 1))).toEqual([21.5, Math.fround(NONE)]);
        expect(() => decodeValues(buffer, 3, 1)).toThrow("Expected 3 × 1 values");
    });

    it("are read from a response with their size", async () => {
        const res = new Response(new Float32Array([1, 2, 3, 4, 5, 6]).buffer, {headers: {"X-Width": "3", "X-Height": "2"}});
        const v = await readValues(res);
        expect([v.width, v.height, v.values[5]]).toEqual([3, 2, 6]);
        await expect(readValues(new Response("", {status: 404}))).rejects.toThrow();
    });
});

describe("the unsharp mask", () => {
    it("reaches the raster's pixel in those drawn, within its limits", () => {
        expect(sharpenSigma(2, 1)).toBe(2);
        expect(sharpenSigma(1, 4)).toBe(0.5);
        expect(sharpenSigma(100, 1)).toBe(4);
        expect(sharpenSigma(0, 1)).toBe(1);
    });
});

describe("the WebGL style", () => {
    it("colours the share of the range through the toned palette, nothing where there is no data", () => {
        const s = colourStyle({colors: BLACK_WHITE, range: [10, 30]});
        expect(s.variables).toEqual({noData: -1e29, low: 10, span: 20});
        const text = JSON.stringify(s.color);
        expect(text).toContain('["<",["band",1,0,0],["var","noData"]]');
        // No number GLSL could not read (OpenLayers writes 1e29 as 1e+29.0)
        expect(text).not.toMatch(/\de[-+]?\d/);
        expect(text).toContain('"palette"');
        expect(text).not.toContain("sharpen");
    });

    it("sharpens and draws an isotherm only when asked, with variables to change them by", () => {
        const s = colourStyle({colors: BLACK_WHITE, range: [10, 30], sharpen: 2, isotherm: [20, 3e38]}, 9);
        expect(s.variables).toEqual({noData: -1e29, low: 10, span: 20, sharpen: 2, sigma: 4, isoLow: 20, isoHigh: 3e38});
        expect(JSON.stringify(s.color)).not.toMatch(/\de[-+]?\d/);
        expect(JSON.stringify(s.color)).toContain('["var","sigma"]');
    });

    it("colours the source frames each in its own colour", () => {
        const s = colourStyle({colors: BLACK_WHITE, index: true});
        expect(s.variables).toEqual({noData: -1e29});
        expect(JSON.stringify(s.color)).toContain('["%",["round",["band",1,0,0]],2]');
    });
});

describe("the colouring without WebGL", () => {
    it("colours across the range, clamped, and leaves no data clear", () => {
        const rgba = colourValues(new Float32Array([10, 20, 30, 40, NONE]), 5, 1, {colors: GREYS, range: [10, 30]});
        expect(pixel(rgba, 0)).toEqual([0, 0, 0, 255]);
        expect(pixel(rgba, 1)).toEqual([128, 128, 128, 255]);
        expect(pixel(rgba, 2)).toEqual([255, 255, 255, 255]);
        expect(pixel(rgba, 3)).toEqual([255, 255, 255, 255]);
        expect(pixel(rgba, 4)).toEqual([0, 0, 0, 0]);
    });

    it("draws outside the isotherm in grey", () => {
        const red = [0x000000ff, 0xff0000ff];
        const rgba = colourValues(new Float32Array([15, 30]), 2, 1, {colors: red, range: [10, 30], isotherm: [20, 3e38]});
        expect(pixel(rgba, 0)).toEqual([64, 64, 64, 255]);
        expect(pixel(rgba, 1)).toEqual([255, 0, 0, 255]);
    });

    it("sharpens an edge: each side pushed away from the other", () => {
        const values = new Float32Array(25).map((_, i) => i % 5 < 2 ? 15 : 25);
        const flat = colourValues(values, 5, 5, {colors: GREYS, range: [10, 30]});
        const sharp = colourValues(values, 5, 5, {colors: GREYS, range: [10, 30], sharpen: 1});
        expect(sharp[(2 * 5 + 1) * 4]).toBeLessThan(flat[(2 * 5 + 1) * 4]);
        expect(sharp[(2 * 5 + 2) * 4]).toBeGreaterThan(flat[(2 * 5 + 2) * 4]);
    });

    it("colours the source frames each in its own colour", () => {
        const rgba = colourValues(new Float32Array([0, 1, 2]), 3, 1, {colors: [0x112233ff, 0x445566ff], index: true});
        expect([pixel(rgba, 0), pixel(rgba, 1), pixel(rgba, 2)])
            .toEqual([[0x11, 0x22, 0x33, 255], [0x44, 0x55, 0x66, 255], [0x11, 0x22, 0x33, 255]]);
    });
});
