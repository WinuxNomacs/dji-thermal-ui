const path = require("path");

test("the vendored Leaflet is 1.3.1, the version the scripts are written for", () => {
    const L = require(path.join(__dirname, "../vendor/leaflet/leaflet.js"));
    expect(L.version).toBe("1.3.1");
    expect(typeof L.map).toBe("function");
});
