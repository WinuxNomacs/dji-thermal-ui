// Tests of the viewer's panel: the folding sections, the readout, the correction's fields, the whole mosaic and the
// report
import {render} from "preact";
import {beforeEach, describe, expect, it, vi} from "vitest";
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
        expect(JSON.parse(localStorage.getItem("thermal-analyzer.viewer.folded")!)).toEqual(["image"]);
        render(null, root());
        render(<Section name="image" title="Image"><p>inside</p></Section>, root());
        await ticks();
        expect(root().querySelector("details")!.open).toBe(false);
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

    it("says when the point is outside the mosaic, and lets a pinned readout follow the cursor again", () => {
        const onFollow = vi.fn();
        render(<Readout point={{valid: false, reason: "outside_raster"}} unit="C" frameUrl="" pinned={true} onFollow={onFollow}/>, root());
        expect(text()).toContain("Outside the mosaic.");
        click(root().querySelector("#follow")!);
        expect(onFollow).toHaveBeenCalled();
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
        render(<Report kind={{files: ["mosaic.tif"]} as never} base="/api/conversions/3"/>, root());
        expect(root().querySelector("a")!.getAttribute("href")).toBe("/api/conversions/3/download?file=mosaic.tif");
    });
});
