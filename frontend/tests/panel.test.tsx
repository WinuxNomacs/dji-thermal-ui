// Tests of the viewer's panel: the folding sections, the readout, the correction's fields, the whole mosaic and the
// report
import {render} from "preact";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {setUserUnit} from "../src/core/units";
import {geometryOf, type Measurement, measurementFigure, resultRows, shapeLabel} from "../src/measure/measure";
import {Controls, correctionStarts, Readout, Report, Section, Whole} from "../src/viewer/panel";
import {click, ticks} from "./helpers";

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    localStorage.clear();
});

const root = () => document.getElementById("root")!;
const text = () => root().textContent || "";

describe("a section of the panel", () => {
    it("remembers being folded and opens folded next time", async () => {
        render(<Section name="image" title="Image"><p>inside</p></Section>, root());
        const details = root().querySelector("details")!;
        expect(details.open).toBe(true);
        details.open = false;
        details.dispatchEvent(new Event("toggle"));
        expect(JSON.parse(localStorage.getItem("thermal-analyzer.viewer.folded")!)).toEqual({image: false});
        render(null, root());
        render(<Section name="image" title="Image"><p>inside</p></Section>, root());
        await ticks();
        expect(root().querySelector("details")!.open).toBe(false);
    });

    it("starts folded where it is meant to, until it is opened, then stays open", async () => {
        render(<Section name="whole" title="This mosaic" folded><p>inside</p></Section>, root());
        const details = root().querySelector("details")!;
        expect(details.open).toBe(false);
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
        render(null, root());
        render(<Section name="whole" title="This mosaic" folded><p>inside</p></Section>, root());
        await ticks();
        expect(root().querySelector("details")!.open).toBe(true);
    });

    it("reads the folded sections as an earlier version kept them", () => {
        localStorage.setItem("thermal-analyzer.viewer.folded", JSON.stringify(["image"]));
        render(<><Section name="image" title="Image"><p/></Section><Section name="cursor" title="Pointer info"><p/></Section></>, root());
        expect([...root().querySelectorAll("details")].map((d) => d.open)).toEqual([false, true]);
    });
});

describe("the range's D-pad", () => {
    const controls = (range: [string, string], onRange: (min: string, max: string) => void, tab = "as_converted",
                      stats: object = {min: 0, max: 50}, onAuto = () => {}) =>
        render(<Controls tab={{tab, stats}} palette="ironbow" palettes={[]} scale={null} unit="C"
                         range={range} onPalette={() => {}} onRange={onRange} onAuto={onAuto}/>, root());
    const button = (k: string) => root().querySelector<HTMLButtonElement>("#span-" + k)!;

    it("step the range as typed, in the user's unit, within the image's own lowest and highest temperatures", () => {
        setUserUnit("F");
        const onRange = vi.fn();
        controls(["50", "112"], onRange);
        expect([...root().querySelectorAll(".dpad button")].map((b) => b.id))
            .toEqual(["span-raise", "span-narrow", "auto", "span-widen", "span-lower"]);
        expect(root().querySelector(".dpad")!.textContent).toBe("RaiseNarrowAutoWidenLower");
        expect(root().querySelector<HTMLLabelElement>("label[for=span-lower]")!.control).toBe(button("lower"));
        click(button("lower"));
        expect(onRange).toHaveBeenLastCalledWith("43.8", "105.8");
        click(button("raise"));
        expect(onRange).toHaveBeenLastCalledWith("56.2", "118.2");
        click(button("widen"));
        expect(onRange).toHaveBeenLastCalledWith("46.9", "115.1");
        setUserUnit("C");
    });

    it("are disabled where a step would change nothing, or the range is not one", () => {
        setUserUnit("C");
        controls(["0", "50"], () => {});
        expect(["narrow", "widen", "lower", "raise"].map((k) => button(k).disabled)).toEqual([false, true, false, false]);
        controls(["", "50"], () => {});
        expect(button("narrow").disabled).toBe(true);
    });

    it("greys out its arrows without the image's own lowest and highest values, and keeps Auto at its centre", () => {
        const onAuto = vi.fn();
        controls(["0", "50"], () => {}, "as_converted", {}, onAuto);
        expect(["narrow", "widen", "lower", "raise"].map((k) => button(k).disabled)).toEqual([true, true, true, true]);
        click(root().querySelector("#auto")!);
        expect(onAuto).toHaveBeenCalledOnce();
        expect(root().querySelector(".range #auto")).toBeNull();
    });

    it("comes after the line of the image's own values, which is straight under the colour scale", () => {
        controls(["0", "50"], () => {});
        const group = root().querySelector(".scale-group")!;
        expect(group.textContent).toBe("This mosaic: 0.0 to 50.0 °C");
        expect(group.compareDocumentPosition(root().querySelector(".range")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("works on a tab that is not in temperatures, in its own values", () => {
        const onRange = vi.fn();
        controls(["10", "20"], onRange, "view_angle");
        click(button("raise"));
        expect(onRange).toHaveBeenLastCalledWith("11", "21");
    });
});

describe("the readout", () => {
    it("shows the temperature, the frame and its pixel, with Open frame only once the point is kept", () => {
        const point = {valid: true, temperature: 21.46, frame: "DJI_0001_T.JPG", frame_pixel: [12, 34] as [number, number], view_angle: 7.25};
        render(<Readout point={point} unit="C" frameUrl="/conversion/3/frame?frame=" pinned={false} onFollow={() => {}}/>, root());
        expect(text()).toContain("Temperature21.46 °C");
        expect(text()).toContain("Frame pixelx 12, y 34");
        expect(text()).toContain("View angle7.3°");
        expect(root().querySelector("#open-frame")).toBeNull();
        expect(root().querySelector("#follow")).toBeNull();
        render(<Readout point={point} unit="C" frameUrl="/conversion/3/frame?frame=" pinned={true} onFollow={() => {}}/>, root());
        const open = root().querySelector("#open-frame")!;
        expect(open.textContent).toBe(" Open frame");
        expect(open.getAttribute("href")).toBe("/conversion/3/frame?frame=DJI_0001_T.JPG");
        expect(root().querySelector("#follow")).not.toBeNull();
    });

    it("gives the ground's height above the DSM's lowest ground, as WebODM gives it in its tooltip", () => {
        render(<Readout point={{valid: true, temperature: 21.46, frame: null, height: 8.24, base_m: 312.1}}
                        unit="C" frameUrl="" pinned={false} onFollow={() => {}}/>, root());
        const cell = [...root().querySelectorAll("tr")].find((r) => r.textContent!.startsWith("Ground height"))!
            .querySelector("td")!;
        expect(cell.textContent).toBe("8.2 m");
        expect(cell.title).toBe("320.3 m as WebODM gives it");
        render(<Readout point={{valid: true, height: null, base_m: 312.1}} unit="C" frameUrl="" pinned={false}
                        onFollow={() => {}}/>, root());
        expect(text()).toContain("Ground heightno data");
        expect(text()).not.toContain("Temperature");
    });

    it("says when the point is outside the mosaic, and lets a pinned readout follow the cursor again", () => {
        const onFollow = vi.fn();
        render(<Readout point={{valid: false, reason: "outside_raster"}} unit="C" frameUrl="" pinned={true} onFollow={onFollow}/>, root());
        expect(text()).toContain("Outside the mosaic.");
        click(root().querySelector("#follow")!);
        expect(onFollow).toHaveBeenCalled();
    });
});

describe("a measure's heights", () => {
    const rows = (results: Parameters<typeof resultRows>[0]) =>
        resultRows(results, "C").filter((r) => /height/i.test(r.label)).map((r) => [r.label, ...r.values, r.difference]);

    it("give a spot's ground height and an area's lowest, mean and highest, with their difference when compared", () => {
        expect(rows([{kind: "Point", value: 20, valid_pixels: 1, height: 4.26}])).toEqual([["Ground height", "4.3 m", undefined]]);
        expect(rows([{kind: "Polygon", mean: 20, valid_pixels: 9, heights: {min: 0.5, mean: 3, max: 7.25}},
                     {kind: "Polygon", mean: 21, valid_pixels: 9, heights: {min: 1, mean: 2, max: 7.25}}])).toEqual([
            ["Lowest height", "0.5 m", "1.0 m", "+0.5 m"], ["Mean height", "3.0 m", "2.0 m", "-1.0 m"],
            ["Highest height", "7.3 m", "7.3 m", "0.0 m"]]);
    });

    it("are left out without a DSM", () => {
        expect(rows([{kind: "Polygon", mean: 20, valid_pixels: 9}])).toEqual([]);
    });
});

describe("a measure's figures", () => {
    it("leave out the surroundings and the ΔT with them that a measurement saved before kept", () => {
        const old = {kind: "Polygon", mean: 30, min: 25, max: 40, std: 2, surroundings: 25, delta_t: 5, area: 4, valid_pixels: 9};
        const labels = resultRows([old as Parameters<typeof resultRows>[0][0]], "C").map((r) => r.label);
        expect(labels).toEqual(["Area", "Mean", "Min", "Max", "Std dev", "Pixels"]);
        expect(measurementFigure({id: 1, name: "Roof", target: "as_converted", values: {result: old}}, "C")).toBe("30.0 °C");
    });

    it("compared with a Delta T, give the Delta T's ΔT alone, not the surroundings' one a measurement saved before kept", () => {
        const old = {kind: "Point", value: 30, mean: 30, std: 1, surroundings: 25, delta_t: 5, valid_pixels: 9};
        const delta = {kind: "LineString", first: 20, second: 21.5, delta_t: 1.5, length: 4.3, valid_pixels: 2};
        const dt = resultRows([old, delta] as Parameters<typeof resultRows>[0], "C").find((r) => r.label === "ΔT")!;
        expect([...dt.values, dt.difference]).toEqual(["", "+1.50 °C", undefined]);
    });
});

describe("a Delta T", () => {
    const RESULT = {kind: "LineString", first: 20, second: 21.5, delta_t: 1.5, length: 4.3, valid_pixels: 2};

    it("is a line of exactly two spots", () => {
        expect(geometryOf("delta", [[1, 2]])).toBeNull();
        expect(geometryOf("delta", [[1, 2], [3, 4]])).toEqual({type: "LineString", coordinates: [[1, 2], [3, 4]]});
    });

    it("shows its length, its two spots and ΔT, compared with its difference", () => {
        const rows = (results: Parameters<typeof resultRows>[0]) =>
            resultRows(results, "C").map((r) => [r.label, ...r.values, r.difference]);
        expect(rows([RESULT])).toEqual([["Length", "4.30 m", undefined], ["First spot", "20.00 °C", undefined],
                                        ["Second spot", "21.50 °C", undefined], ["ΔT", "+1.50 °C", undefined]]);
        expect(rows([RESULT, {...RESULT, second: 22, delta_t: 2}])[3]).toEqual(["ΔT", "+1.50 °C", "+2.00 °C", "+0.50 °C"]);
    });

    it("is listed saved with its ΔT and its two spots", () => {
        const m: Measurement = {id: 1, name: "Joint", target: "as_converted", values: {result: RESULT, shape: {kind: "delta"}}};
        expect(measurementFigure(m, "C")).toBe("ΔT +1.5 °C (20.0 °C → 21.5 °C)");
        expect(measurementFigure({...m, values: {result: {...RESULT, delta_t: null}, shape: {kind: "delta"}}}, "C")).toBe("ΔT no data");
    });

    it("across two datasets is listed with the other dataset named, and labelled as such", () => {
        const m: Measurement = {id: 2, name: "Seam", target: "as_converted",
                                values: {result: RESULT, shape: {kind: "across", own: 0, other: 12, other_target: "harmonized"}},
                                other: {id: 12, name: "Default settings", dataset: 6, dataset_name: "Roof, May"}};
        expect(measurementFigure(m, "C")).toBe("ΔT +1.5 °C (20.0 °C → 21.5 °C) · across to Roof, May · Default settings");
        expect(shapeLabel(RESULT, m.values!.shape)).toBe("Delta T across");
    });
});

describe("the correction", () => {
    it("starts from the conversion's own emissivity and reflected temperature", () => {
        expect(correctionStarts({emissivity: 0.95, reflected_temp: 23}, "C")).toEqual({emissivity: "0.95", reflected_temp: "23.0"});
    });
});

describe("the whole mosaic", () => {
    it("shows the mean, the 2nd to 98th percentile and the isotherm's share", () => {
        const whole = {approximate: true, result: {mean: 20, percentiles: [10, 30], isotherm: {share: 0.125}, valid_pixels: 4}};
        render(<Whole whole={whole as never} unit="C"/>, root());
        expect(text()).toContain("2nd to 98th percentile10.0");
        expect(text()).toContain("In the isotherm12.5 %");
        expect(text()).toContain("Corrected (approximate).");
    });
});

describe("the report", () => {
    it("links each of the mosaic's files for download", () => {
        render(<Report rows={[]} files={["mosaic.tif"]} base="/api/conversions/3"/>, root());
        expect(root().querySelector("a")!.getAttribute("href")).toBe("/api/conversions/3/download?file=mosaic.tif");
    });
});
