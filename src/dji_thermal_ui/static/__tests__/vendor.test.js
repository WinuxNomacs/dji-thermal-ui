const path = require("path");

test("the vendored Leaflet is 1.3.1, the version the scripts are written for", () => {
    const L = require(path.join(__dirname, "../vendor/leaflet/leaflet.js"));
    expect(L.version).toBe("1.3.1");
    expect(typeof L.map).toBe("function");
});

const fs = require("fs");
const vendor = path.join(__dirname, "../vendor");

test("the vendored Bootstrap is 3.4.1's CSS, with its licence", () => {
    const css = fs.readFileSync(path.join(vendor, "bootstrap/css/bootstrap.min.css"), "utf8");
    expect(css.slice(0, 40)).toContain("Bootstrap v3.4.1");
    expect(fs.existsSync(path.join(vendor, "bootstrap/LICENSE"))).toBe(true);
});

test("the vendored Font Awesome is Free 5.15.4, with the fonts its solid and regular icons need", () => {
    const css = fs.readFileSync(path.join(vendor, "fontawesome/css/all.min.css"), "utf8");
    expect(css.slice(0, 80)).toContain("Font Awesome Free 5.15.4");
    ["fa-solid-900.woff2", "fa-regular-400.woff2"].forEach((font) => {
        expect(css).toContain("../webfonts/" + font);
        expect(fs.existsSync(path.join(vendor, "fontawesome/webfonts", font))).toBe(true);
    });
    expect(fs.existsSync(path.join(vendor, "fontawesome/LICENSE.txt"))).toBe(true);
});
