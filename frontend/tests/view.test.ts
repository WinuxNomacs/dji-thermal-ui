// Tests of the mosaic viewer's helpers: the view in the URL, the values' URL, the sliders, the colour scale, the
// correction and the PNG export's parts
import {afterEach, describe, expect, it} from "vitest";
import {setUserUnit} from "../src/core/units";
import {gradientCss, gradientStops, paletteCss} from "../src/viewer/canvas";
import {
    defaultRange, fileName, parseRange, readCorrection, readView, reportRows, scaleBar, scaleTicks, sliderGamma,
    sliderPositions, SLIDERS, slidRange, styleGroup, takenText, dataUrl, toneShares, viewQuery, visualRows,
} from "../src/viewer/view";

afterEach(() => setUserUnit("C"));

describe("the view in the URL", () => {
    it("reads the tab, palette, frame, range and adjustments given", () => {
        expect(readView("?tab=harmonized&palette=inferno&min=10&max=20.5&gamma=1.5&equalize=1&frame=DJI_1.JPG"))
            .toEqual({tab: "harmonized", palette: "inferno", frame: "DJI_1.JPG", range: [10, 20.5],
                      adjust: {gamma: 1.5, equalize: true, sharpen: 0}});
    });

    it("leaves out a range that is not one and adjustments out of their limits", () => {
        expect(readView("?min=20&max=10&gamma=9&sharpen=7")).toEqual({});
    });

    it("writes the same view back as a query", () => {
        const view = {tab: "as_converted", range: [1, 2] as [number, number], adjust: {gamma: 2, equalize: false, sharpen: 1},
                      frame: "a b"};
        expect(viewQuery(view)).toBe("?tab=as_converted&min=1&max=2&gamma=2&sharpen=1&frame=a%20b");
        expect(readView(viewQuery(view))).toEqual(view);
        expect(viewQuery({})).toBe("");
    });
});

describe("the values", () => {
    it("ask a temperature tab with its correction", () => {
        expect(dataUrl("/api/", 3, "harmonized", {emissivity: "0.9", reflected_temp: ""}))
            .toBe("/api/conversions/3/mosaics/harmonized/data/{z}/{x}/{y}?emissivity=0.9");
    });

    it("ask the source frames with nothing", () => {
        expect(dataUrl("/api/", 3, "source_frame", {emissivity: "0.9"}))
            .toBe("/api/conversions/3/mosaics/source_frame/data/{z}/{x}/{y}");
    });

    it("share one style between both temperature tabs", () => {
        expect(styleGroup("as_converted")).toBe(styleGroup("harmonized"));
        expect(styleGroup("view_angle")).toBe("view_angle");
    });
});

describe("the range", () => {
    it("starts at the percentiles rounded outwards, in the user's unit", () => {
        expect(defaultRange({tab: "as_converted", stats: {percentiles: [10.04, 19.96]}})).toEqual([10, 20]);
        expect(defaultRange({tab: "x"})).toEqual([0, 1]);
        setUserUnit("F");
        const [lo, hi] = defaultRange({tab: "as_converted", stats: {percentiles: [10, 20]}}, "C");
        expect(lo).toBeCloseTo(10, 1);
        expect(hi).toBeCloseTo(20, 1);
    });

    it("needs a minimum below a maximum", () => {
        expect(parseRange("", "2").error).toBe("The range needs a minimum and a maximum");
        expect(parseRange("3", "2").error).toBe("The maximum must be above the minimum");
        expect(parseRange("1", "2")).toEqual({range: [1, 2]});
    });

    it("moves with the sliders and puts them back where they were", () => {
        const ref: [number, number] = [10, 20], range = slidRange(ref, 0.5, 1);
        expect(range).toEqual([7.5, 12.5]);
        expect(sliderPositions(ref, range)).toEqual({brightness: 0.5, contrast: 1});
        expect(sliderGamma(1)).toBe(2);
        expect(sliderGamma(9)).toBe(5);
    });

    it("steps 5% finer than before and still reaches both ends", () => {
        const before = {brightness: 0.05, contrast: 0.1, gamma: 0.1, sharpen: 0.5};
        Object.entries(SLIDERS).forEach(([name, s]) => {
            const steps = (s.max - s.min) / s.step;
            expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
            expect(s.step / before[name as keyof typeof before]).toBeGreaterThan(0.9);
            expect(s.step / before[name as keyof typeof before]).toBeLessThan(0.96);
        });
        expect(SLIDERS.brightness).toEqual({min: -1, max: 1, step: 2 / 42});
    });
});

describe("the colour scale", () => {
    it("marks its two ends and round values between them", () => {
        expect(scaleTicks(0, 10).map((t) => t.label)).toEqual(["0.0", "2", "4", "6", "8", "10.0"]);
        expect(scaleTicks(-0.5, 0.5).map((t) => t.label)).toEqual(["-0.5", "-0.2", "0.0", "0.2", "0.5"]);
        expect(scaleTicks(1, 1)).toEqual([]);
    });

    it("labels its ends to 0.1, leaving out a round value too near one to fit", () => {
        const ticks = scaleTicks(21.96, 28.04);
        expect(ticks.map((t) => t.label)).toEqual(["22.0", "24", "26", "28.0"]);
        expect(ticks[0]).toMatchObject({value: 21.96, at: 0});
        expect(ticks.at(-1)).toMatchObject({value: 28.04, at: 1});
        expect(scaleTicks(12.34, 45.67).map((t) => t.label)).toEqual(["12.3", "20", "30", "45.7"]);
    });

    it("draws the palette with the image's tone curve", () => {
        const palette = [0x000000ff, 0xffffffff];
        expect(paletteCss(palette, 0.5)).toBe("rgb(128,128,128)");
        expect(gradientStops(palette, toneShares(1))).toHaveLength(65);
        expect(gradientStops(palette)).toHaveLength(16);
        expect(gradientCss([])).toBe("");
    });
});

describe("the correction", () => {
    it("sends only the values changed from their start", () => {
        expect(readCorrection({emissivity: "0.95", reflected_temp: "20"}, {emissivity: "0.95", reflected_temp: "25"}))
            .toEqual({correction: {reflected_temp: "20"}});
    });

    it("says which field is out of its range", () => {
        expect(readCorrection({emissivity: "2"})).toEqual({error: "The emissivity is between 0.1 and 1", field: "emissivity"});
        expect(readCorrection({reflected_temp: "x"}).field).toBe("reflected_temp");
    });
});

describe("the PNG export", () => {
    it("says when the frames were taken", () => {
        expect(takenText(["2026:09:18 09:02:11", "2026:09:18 08:44:00"])).toBe("2026-09-18 08:44–09:02");
        expect(takenText(["2026:09:18 08:44:00", "2026:09:19 08:44:00"])).toBe("2026-09-18 08:44 – 2026-09-19 08:44");
        expect(takenText([null])).toBe("");
    });

    it("picks a round scale bar", () => {
        expect(scaleBar(0.1, 150)).toEqual({px: 100, label: "10 m"});
        expect(scaleBar(20, 150)).toEqual({px: 100, label: "2 km"});
        expect(scaleBar(0, 150)).toBeNull();
    });

    it("names the file safely", () => {
        expect(fileName(["My field", "harmonized"], ".png")).toBe("My_field-harmonized.png");
        expect(fileName([], ".png")).toBe("view.png");
    });
});

describe("the report", () => {
    it("lists the visual mosaic's frames and size, and why the cameras' offset was not corrected", () => {
        expect(visualRows({pairs: 3, width: 300, height: 200, gsd_m: 0.006, unpaired_thermal: 2,
                           report: {camera_offset: {applied: false, reason: "too few pairs to measure (3 of 5)"}}})).toEqual([
            ["Frames", "3 placed as their thermal frames, 2 thermal without a visual frame"],
            ["Size", "300 × 200 px at 0.6 cm"],
            ["Cameras' offset", "not corrected (too few pairs to measure (3 of 5))"],
        ]);
        expect(visualRows(null)).toEqual([]);
    });

    it("lists the frames, size and seams", () => {
        const rows = reportRows({frames: 10, oblique: 2, width: 100, height: 50, gsd_m: 0.05,
                                 report: {radiometric_seams: {pixels: 5, median_abs_c: 0.2, p95_abs_c: 1}}});
        expect(rows[0]).toEqual(["Frames", "10 placed, 2 oblique left out"]);
        expect(rows[1][0]).toBe("Size");
        expect(rows[2][0]).toBe("Seams");
    });
});
