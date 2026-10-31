// Tests of the Problems tab's text: each problem in the app's words, its numbers from the files in the user's unit, and
// the New dataset form's setting that fixes it
import {afterEach, describe, expect, it} from "vitest";
import {setUserUnit} from "../src/core/units";
import type {FileRow, Problem} from "../src/dataset/files";
import {describeProblem} from "../src/dataset/problems";

afterEach(() => setUserUnit("C"));

const row = (path: string, more: Partial<FileRow>): FileRow => ({path, kind: "thermal", pitch: -90, ...more});
const problem = (code: string, files: string[] = [], more: Partial<Problem> = {}): Problem =>
    ({code, severity: "warning", message: "the cli's " + code, suggestion: "--a-flag", files, ...more});

describe("a problem's text", () => {
    it("gives an ambient temperature's spread in the user's unit, and normalizing as its fix", () => {
        const rows = [row("a", {ambient: 20.25, reflection: 20.25}), row("b", {ambient: 22.63, reflection: 22.63})];
        setUserUnit("F");
        const t = describeProblem(problem("ambient_temp_varies"), rows);
        expect(t.message).toContain("ambient and reflected temperatures recorded in the frames vary by 4.3 °F (68.5 °F to 72.7 °F)");
        expect(t.message).toContain("They scale");
        expect(t.advice).toBe("Normalize the frames to each other when converting, or set one Ambient and Reflected temperature " +
            "under Measurement.");
        expect(t.fix).toMatchObject({label: "Normalize the frames to each other", checks: {normalize: true}});
    });

    it("names the ambient temperature alone when the reflected one is recorded apart", () => {
        const rows = [row("a", {ambient: 20, reflection: 25}), row("b", {ambient: 23, reflection: 25})];
        expect(describeProblem(problem("ambient_temp_varies"), rows).message)
            .toMatch(/^The ambient temperature recorded in the frames varies by 3\.0 °C .* It scales/);
    });

    it("uses the value most frames have for one emissivity, and shows each file's own", () => {
        const rows = [row("a", {emissivity: 0.95}), row("b", {emissivity: 0.95}), row("c", {emissivity: 0.9})];
        const t = describeProblem(problem("emissivity_differs", ["c"]), rows);
        expect(t.message).toBe("The emissivity recorded in the frames differs: 2 frames at 0.95, 1 frame at other values.");
        expect(t.values).toEqual({c: "0.9"});
        expect(t.fix).toMatchObject({label: "Use one emissivity (0.95)", values: {emissivity: "0.95"}});
    });

    it("keeps the embedded distance as the fix for a rangefinder that reads another", () => {
        const rows = [row("a", {distance: 5, lrf: 20.9}), row("b", {distance: 5, lrf: 21.1})];
        const t = describeProblem(problem("rangefinder_distance"), rows);
        expect(t.message).toBe("The object distance embedded in the frames is 5.0 m, but the rangefinder reads 21.0 m (median). " +
            "The rangefinder's is used by default.");
        expect(t.fix).toMatchObject({label: "Use the embedded distance", values: {distance_mode: "embedded"}});
    });

    it("fixes one distance at the median of the valid rangefinder readings", () => {
        const rows = [row("a", {lrf: 20}), row("b", {lrf: 22}), row("c", {lrf: null}), row("d", {lrf: 0})];
        const t = describeProblem(problem("rangefinder_invalid", ["c", "d"]), rows);
        expect(t.message).toBe("2 frames have no valid rangefinder reading: their embedded distance is used instead.");
        expect(t.fix).toMatchObject({label: "Use one distance (21.0 m)", values: {distance_mode: "fixed", distance: "21"}});
    });

    it("lists a temperature outlier's values once, beside the files, with no button", () => {
        const rows = [row("a", {tmax: 50}), row("b", {tmax: 52}), row("c", {tmax: 31.3, pitch: -45})];
        setUserUnit("F");
        const t = describeProblem(problem("temperature_max_outlier", ["c"]), rows);
        expect(t.message).toBe("1 frame with an unusual maximum temperature (the flight's median 122.0 °F); it is an oblique " +
            "frame, which a mosaic leaves out.");
        expect(t.values).toEqual({c: "88.3 °F"});
        expect(t.advice).toContain("“Replace above” under Adjustments");
        expect(t.fix).toBeUndefined();
    });

    it("offers normalizing for an unusual mean temperature", () => {
        const rows = [row("a", {tmean: 20}), row("b", {tmean: 30})];
        expect(describeProblem(problem("temperature_mean_outlier", ["b"]), rows).fix).toMatchObject({checks: {normalize: true}});
    });

    it("offers to include the oblique frames only when too few nadir frames are left for a mosaic", () => {
        const oblique = [row("o1", {pitch: -45.5}), row("o2", {pitch: -60})];
        const few = describeProblem(problem("oblique", ["o1", "o2"]), [...oblique, row("n1", {})]);
        expect(few.message).toBe("2 frames look less steeply down than -80° and are left out of a mosaic (1 nadir frame remains).");
        expect(few.fix).toMatchObject({label: "Include them", values: {max_pitch: "-45"}});
        const nadir = ["n1", "n2", "n3", "n4", "n5"].map((p) => row(p, {}));
        expect(describeProblem(problem("oblique", ["o1", "o2"]), [...oblique, ...nadir]).fix).toBeUndefined();
    });

    it("keeps dji-thermal-cli's text for a code it doesn't know", () => {
        const t = describeProblem(problem("duplicate", ["a", "b"], {message: "2 files are identical", suggestion: "keep one"}), []);
        expect(t).toEqual({message: "2 files are identical.", advice: "Keep one.", values: {}});
    });
});
