// Tests of the findings' helpers: what the form sends, their figures, and those hidden as the URL keeps them
import {afterEach, describe, expect, it} from "vitest";
import {setUserUnit} from "../src/core/units";
import {blankFields, fieldsBody, findingsUrl, hiddenText, readHidden, temperaturesText} from "../src/findings/findings";
import type {SourceFrame} from "../src/sources/sources";
import {readView, viewQuery} from "../src/viewer/view";

afterEach(() => setUserUnit("C"));

const FRAMES = [{frame: "a.JPG"}, {frame: "b.JPG"}] as SourceFrame[];

describe("a finding", () => {
    it("is asked for at its dataset", () => {
        expect(findingsUrl("/api/", 5)).toBe("/api/datasets/5/findings");
        expect(findingsUrl("/api/", 5, 7)).toBe("/api/datasets/5/findings/7");
    });

    it("is sent with its name trimmed, and the frames kept only when some are left out", () => {
        const v = {...blankFields(" Hot "), kept: ["a.JPG", "b.JPG"]};
        expect(fieldsBody(v, FRAMES)).toEqual({name: "Hot", notes: "", severity: "medium", status: "open"});
        expect(fieldsBody(blankFields("Hot"), FRAMES)).not.toHaveProperty("kept");
        expect(fieldsBody({...v, kept: ["b.JPG"]}, FRAMES)).toHaveProperty("kept", ["b.JPG"]);
    });

    it("shows a spot's temperature, an area's maximum and mean, or a Delta T's two spots, with ΔT in the user's unit", () => {
        expect(temperaturesText({value: 31.5, unit: "C"})).toBe("31.50 °C");
        expect(temperaturesText({max: 40, mean: 30, delta_t: 5, unit: "C", approximate: true}))
            .toBe("max 40.00 °C · mean 30.00 °C · ΔT +5.00 °C (corrected, approximate)");
        expect(temperaturesText({first: 20, second: 21.5, delta_t: 1.5, length: 4.3, unit: "C"}))
            .toBe("ΔT +1.5 °C (20.0 °C → 21.5 °C)");
        setUserUnit("F");
        expect(temperaturesText({value: 0, unit: "C"})).toBe("32.00 °F");
    });

    it("is kept hidden in the URL with the others, the switch and the one open", () => {
        expect(hiddenText([7, 3])).toBe("3,7");
        expect(readHidden("3,x,-1,7")).toEqual([3, 7]);
        expect(readHidden(null)).toEqual([]);
        const view = {tab: "as_converted", findings: false, hidden: [3, 7], finding: 9};
        expect(viewQuery(view)).toBe("?tab=as_converted&findings=0&hide=3,7&finding=9");
        expect(readView(viewQuery(view))).toEqual(view);
    });
});
