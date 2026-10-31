// Tests of the viewer's panel: the folding sections, the readout, the correction's fields, the whole mosaic and the
// report
import {render} from "preact";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {resultRows} from "../src/measure/measure";
import {correctionStarts, Readout, Report, Section, Whole} from "../src/viewer/panel";
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

describe("the readout", () => {
    it("shows the temperature, the frame and its pixel, with a link to open the frame", () => {
        render(<Readout point={{valid: true, temperature: 21.46, frame: "DJI_0001_T.JPG", frame_pixel: [12, 34], view_angle: 7.25}}
                        unit="C" frameUrl="/conversion/3/frame?frame=" pinned={false} onFollow={() => {}}/>, root());
        expect(text()).toContain("Temperature21.46 °C");
        expect(text()).toContain("Frame pixelx 12, y 34");
        expect(text()).toContain("View angle7.3°");
        expect(root().querySelector("#open-frame")!.getAttribute("href")).toBe("/conversion/3/frame?frame=DJI_0001_T.JPG");
        expect(root().querySelector("#follow")).toBeNull();
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
