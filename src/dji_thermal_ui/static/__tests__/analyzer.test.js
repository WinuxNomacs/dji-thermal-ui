const fs = require('fs');
const path = require('path');
const core = require('../analyzer_core');
window.ThermalAnalyzerCore = core;
const datasets = require('../datasets');
const conversions = require('../conversions');
window.ThermalAnalyzerConversions = conversions;
const dataset = require('../dataset');
const measure = require('../measure');
window.ThermalAnalyzerMeasure = measure;
const viewer = require('../viewer');
window.ThermalAnalyzerViewer = viewer;
const frame = require('../frame');
const compare = require('../compare');

// A page's markup from its Django template, with the template tags filled in as the views do
function page(name) {
    const t = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', name), 'utf8');
    const start = t.indexOf('{% block content %}') + 19;
    const body = t.slice(start, t.indexOf('{% endblock %}', start));
    return body
        .replace(/<script[^>]*><\/script>/g, '')
        .replace('{% csrf_token %}', '<input name="csrfmiddlewaretoken" value="tok">')
        .replace(/\{\{ api \}\}/g, '/api/')
        .replace(/\{\{ public \}\}/g, '/')
        .replace(/\{\{ dataset\.id \}\}/g, '5')
        .replace(/\{\{ dataset\.name \}\}/g, 'Roof')
        .replace(/\{\{ conversion\.id \}\}/g, '9')
        .replace(/\{\{ conversion\.name \}\}/g, 'Nadir')
        .replace(/\{\{ other\.id \}\}/g, '12')
        .replace(/\{\{ basemaps\|json_script:"ta-basemaps" \}\}/g, '');
}

const jsonResponse = (data, ok = true) => Promise.resolve({ok, json: () => Promise.resolve(data)});
const flush = () => new Promise(r => setTimeout(r, 0));
// Lets the promises of a fetch and its JSON settle, with fake timers too
const ticks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
afterEach(() => jest.useRealTimers());
const click = el => el.dispatchEvent(new MouseEvent("click", {bubbles: true}));
const change = el => el.dispatchEvent(new Event("change", {bubbles: true}));
const input = el => el.dispatchEvent(new Event("input", {bubbles: true}));
// The pages' dialog, and pressing one of its buttons
const askDialog = () => document.querySelector(".ta-ask");
const press = label => click([].filter.call(askDialog().querySelectorAll("button"), b => b.textContent === label)[0]);

// A fake server: "METHOD url" (or just the url, for GET) to a list of responses, each answered once in turn and the
// last one again after that. Its calls are fetchFn.mock.calls.
function server(routes) {
    const left = {};
    Object.keys(routes).forEach(k => { left[k.indexOf(" ") > 0 ? k : "GET " + k] = [].concat(routes[k]); });
    return jest.fn((url, opts) => {
        const key = ((opts && opts.method) || "GET") + " " + url;
        const queue = left[key];
        if (!queue) return Promise.reject(new Error("unexpected " + key));
        const r = queue.length > 1 ? queue.shift() : queue[0];
        return typeof r === "function" ? r(url, opts) : jsonResponse(r);
    });
}
const calls = fetchFn => fetchFn.mock.calls.map(c => ((c[1] && c[1].method) || "GET") + " " + c[0]);

const DATASET = {
    id: 5, name: "Roof", source: "upload", status: "ready", progress: 1, error: "",
    file_count: 3, size: 3 * 1048576, thermal: 2, not_thermal: 1, errors: 0, warnings: 1, infos: 0, cameras: ["M4T"],
    analyzed: true, analyzed_at: "2026-10-18T10:00:00Z", created_at: "2026-10-18T09:00:00Z"
};

const ANALYSIS = {
    version: "1.1.0",
    summary: {files: {thermal: 2, not_thermal: 1}, error: 0, warning: 1, info: 1},
    cameras: [{model: "M4T", serial: "SN1", width: 640, height: 512, frames: 2}],
    files: [
        {path: "thermal/b_T.JPG", kind: "thermal", time: "2026:10:12 18:30:10", alt: 22, pitch: -90, tmin: 15.2, tmax: 50.6, tmean: 22, distance: 5, lrf: 21.4, emissivity: 0.91, lat: 42.1},
        {path: "thermal/a_T.JPG", kind: "thermal", time: "2026:10:12 18:29:50", alt: 20, pitch: -45, tmin: 17.3, tmax: 31.5, tmean: 21.9, distance: 5, lrf: null, emissivity: 0.91, lat: null},
        {path: "rgb/a_V.JPG", kind: "not_thermal", reason: "not an R-JPEG", size: 4000000}
    ],
    findings: [
        {severity: "warning", code: "temperature_max_outlier", message: "1 image with an unusual <maximum>", files: ["thermal/b_T.JPG"], suggestion: "--replace-above"},
        {severity: "info", code: "oblique", message: "1 oblique frame", files: ["thermal/a_T.JPG"], suggestion: ""}
    ],
    webodm: {
        process_command: "dji-thermal-cli process -o temp_c:tiff --normalize",
        process_args: ["-o", "temp_c:tiff", "--normalize"],
        recommended: {"radiometric-calibration": {value: "none", reason: "already temperatures"}},
        consider: {"fast-orthophoto": {value: true, reason: "flat ground"}},
        notes: ["--normalize: drift"],
        coverage: {frames: 2, gsd_m: 0.0212, area_m2: 363.9, images_per_point_median: 3, area_seen_by_3_or_more_pct: 62.9, equivalent_overlap_pct: 42.3},
        odm_arguments: ["--radiometric-calibration", "none"]
    }
};

const DEFAULTS = {
    distance: "lrf", humidity: null, emissivity: null, reflected_temp: null, ambient_temp: null, unit: "C", range_min: null,
    range_max: null, palette: null, gimbal_yaw: null, gimbal_pitch: null, gimbal_roll: null, replace_above: null,
    replace_above_value: null, replace_below: null, replace_below_value: null, strip_location: false, normalize: false,
    max_pitch: null, outputs: ["temp_c:tiff", "pseudo:png"], compression: "deflate", mosaics: true
};
const PREFERENCES = {
    settings: DEFAULTS, saved: false, defaults: DEFAULTS, palettes: ["whitehot", "ironred"],
    products: [
        {product: "temp_c", description: "float32 temperature in degrees C", formats: ["tiff", "exr"]},
        {product: "pseudo", description: "8-bit RGB pseudo-colour image", formats: ["png", "tiff"]},
        {product: "gray16", description: "uint16 grayscale view", formats: ["png", "tiff"]}
    ]
};
const CONVERSION = {
    id: 9, dataset: 5, name: "Nadir", settings: Object.assign({}, DEFAULTS, {emissivity: 0.95, normalize: true}),
    description: "temp_c tiff · normalized", status: "ready", progress: 1, error: "", converted: 2, skipped: 1,
    file_count: 2, size: 2097152, created_at: "2026-10-18T11:00:00Z", finished_at: "2026-10-18T11:01:00Z",
    mosaic_status: "ready", mosaic_progress: 1, mosaic_error: "",
    mosaic_files: ["mosaics/as_converted/mosaic_temp_c.tif", "mosaics/harmonized/mosaic_temp_c.tif"]
};

describe("analyzer core", () => {
    it("says which stage a normalization or a mosaic is at, and which mosaic", () => {
        const align = {stage: "align", step: 3, steps: 6, round: 2, rounds: 3, done: 812, total: 1840, unit: "pairs"};
        expect(core.stageText(align)).toBe("step 3 of 6, aligning (round 2/3), 812/1840 pairs");
        expect(core.stageText({stage: "write", step: 6, steps: 6, done: 1, total: 2, unit: "files"})).toBe("step 6 of 6, writing, 1/2 files");
        expect(core.stageText({})).toBe("");
        expect(core.stageText(undefined)).toBe("");
        expect(core.mosaicLabel({mosaic_progress: 0.4, stage: align}))
            .toBe("Building the mosaics: step 3 of 6, aligning (round 2/3), 812/1840 pairs…");
        expect(core.mosaicLabel({mosaic_progress: 0, stage: {}})).toBe("Building the mosaics…");
    });

    it("formats sizes, statuses and EXIF capture times", () => {
        expect(core.formatBytes(3 * 1048576)).toBe("3.0 MB");
        expect(core.formatBytes(512)).toBe("512 B");
        expect(core.statusLabel({status: "analyzing", progress: 0.42})).toBe("Analyzing 42%");
        expect(core.statusLabel({status: "new", analyzed: true})).toMatch(/analyze again/);
        expect(dataset.captureTime("2026:10:12 18:29:50")).toBe("2026-10-12 18:29:50");
        expect(core.escapeHtml('<b a="1">')).toBe("&lt;b a=&quot;1&quot;&gt;");
    });

    it("converts temperatures between units, and differences by scaling alone", () => {
        expect(core.convertTemp(100, "C", "F")).toBeCloseTo(212);
        expect(core.convertTemp(212, "F", "K")).toBeCloseTo(373.15);
        expect(core.convertTemp(0, "K", "C")).toBeCloseTo(-273.15);
        expect(core.convertTemp("", "C", "F")).toBe("");
        expect(core.convertDelta(10, "C", "F")).toBeCloseTo(18);
        expect(core.convertDelta(18, "F", "K")).toBeCloseTo(10);
        expect(core.convertDelta(10, "C", "K")).toBe(10);
    });

    it("shows temperatures in the user's unit, Celsius when the page gives none", () => {
        expect(core.userUnit()).toBe("C");
        expect(core.formatTemp(21.5, "C")).toBe("21.50 °C");
        window.__temperatureUnit = "F";
        expect(core.formatTemp(21.5, "C")).toBe("70.70 °F");
        expect(core.formatDelta(-0.5, "C", 1, true)).toBe("-0.9 °F");
        expect(core.formatDelta(0.5, "C", 1, true)).toBe("+0.9 °F");
        window.__temperatureUnit = "K";
        expect(core.formatTemp(32, "F", 1)).toBe("273.1 K");
        window.__temperatureUnit = "X";
        expect(core.userUnit()).toBe("C");
        delete window.__temperatureUnit;
    });

    it("uploads an image under its place in the folder chosen, without that folder's own name", () => {
        expect(core.uploadName({name: "x_T.JPG", webkitRelativePath: "Flight 3/thermal/x_T.JPG"})).toBe("thermal/x_T.JPG");
        expect(core.uploadName({name: "x_T.JPG", webkitRelativePath: ""})).toBe("x_T.JPG");
    });

    it("splits uploads into batches by count and size, a large image going alone", () => {
        const f = (size) => ({name: "a.JPG", size});
        expect(core.batches([f(1), f(1), f(1)], 2, 100).map(b => b.length)).toEqual([2, 1]);
        expect(core.batches([f(10), f(200), f(10)], 10, 100).map(b => b.length)).toEqual([1, 1, 1]);
    });

    it("uploads only the JPEGs, sends each one's path, retries a failed request and reports what could not be sent", async () => {
        class FD { constructor() { this.parts = []; } append(k, v, n) { this.parts.push([k, n || v]); } }
        const files = [{name: "a.JPG", size: 10, webkitRelativePath: "f/t/a.JPG"}, {name: "notes.txt", size: 1}, {name: "b.jpeg", size: 10}];
        let calls = 0;
        const fetchFn = jest.fn((url, opts) => {
            calls++;
            if (calls === 1) return Promise.resolve({ok: false, json: () => Promise.resolve({})});   // retried
            return jsonResponse({saved: opts.body.parts.filter(p => p[0] === "images").length});
        });
        const progress = jest.fn();
        const r = await core.uploadFiles(fetchFn, "/up", "tok", files, progress, FD);
        expect(r).toEqual({saved: 2, failed: [], canceled: false});
        const body = fetchFn.mock.calls[1][1].body.parts;
        expect(body).toEqual([["images", "a.JPG"], ["paths", "t/a.JPG"], ["images", "b.jpeg"], ["paths", "b.jpeg"]]);
        expect(progress).toHaveBeenLastCalledWith({sent: 2, total: 2, bytesSent: 20, bytesTotal: 20});

        const failing = jest.fn(() => Promise.reject(new Error("offline")));
        expect(await core.uploadFiles(failing, "/up", "tok", files, null, FD)).toEqual({saved: 0, failed: [files[0], files[2]], canceled: false});
        expect(failing).toHaveBeenCalledTimes(3);
    });

    it("does not count a batch that failed as sent, so the progress stops short of the images missing", async () => {
        class FD { constructor() { this.parts = []; } append(k, v, n) { this.parts.push([k, n || v]); } }
        const files = Array.from({length: 12}, (_, i) => ({name: i + ".JPG", size: 1}));
        const fetchFn = jest.fn((url, opts) => {
            const names = opts.body.parts.filter(p => p[0] === "images").map(p => p[1]);
            if (names.includes("11.JPG")) return Promise.resolve({ok: false, json: () => Promise.resolve({})});
            return jsonResponse({saved: names.length});
        });
        const progress = jest.fn();
        const r = await core.uploadFiles(fetchFn, "/up", "tok", files, progress, FD);
        expect(r.saved).toBe(10);
        expect(r.failed).toEqual(files.slice(10));
        expect(progress).toHaveBeenCalledTimes(1);
        expect(progress).toHaveBeenLastCalledWith({sent: 10, total: 12, bytesSent: 10, bytesTotal: 12});
    });

    it("gives up on a request that never answers after its timeout, sends it again, then counts its images as failed", async () => {
        jest.useFakeTimers();
        class FD { append() {} }
        const files = [{name: "a.JPG", size: 1048576}];
        expect(core.batchTimeout(1048576)).toBe(30000 + 8192);
        const stalled = jest.fn(() => new Promise(() => {}));    // ignores its signal too
        let r = null;
        core.uploadFiles(stalled, "/up", "tok", files, null, FD).then(v => { r = v; });
        await ticks();
        expect(stalled).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(core.batchTimeout(1048576));
        await ticks();
        expect(stalled.mock.calls[0][1].signal.aborted).toBe(true);
        expect(stalled).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(core.batchTimeout(1048576));
        await ticks();
        jest.advanceTimersByTime(core.batchTimeout(1048576));
        await ticks();
        expect(stalled).toHaveBeenCalledTimes(3);
        expect(r).toEqual({saved: 0, failed: files, canceled: false});

        // A request that answers late, but before its timeout, is not sent again
        let answer;
        const slow = jest.fn(() => new Promise(res => { answer = res; }));
        r = null;
        core.uploadFiles(slow, "/up", "tok", files, null, FD).then(v => { r = v; });
        await ticks();
        jest.advanceTimersByTime(core.batchTimeout(1048576) - 1);
        answer({ok: true, json: () => Promise.resolve({saved: 1})});
        await ticks();
        expect(slow).toHaveBeenCalledTimes(1);
        expect(r).toEqual({saved: 1, failed: [], canceled: false});
    });

    it("cancels an upload: aborts the requests in flight, sends no more, and returns every image not saved", async () => {
        class FD { append() {} }
        const files = Array.from({length: 40}, (_, i) => ({name: i + ".JPG", size: 1}));
        const fetchFn = jest.fn(() => new Promise(() => {}));
        const progress = jest.fn();
        const cancel = new AbortController();
        const upload = core.uploadFiles(fetchFn, "/up", "tok", files, progress, FD, {signal: cancel.signal});
        await ticks();
        expect(fetchFn).toHaveBeenCalledTimes(3);       // PARALLEL requests, a batch still waiting
        cancel.abort();
        const r = await upload;
        expect(fetchFn).toHaveBeenCalledTimes(3);
        expect(fetchFn.mock.calls.every(c => c[1].signal.aborted)).toBe(true);
        expect(r.canceled).toBe(true);
        expect(r.saved).toBe(0);
        expect(r.failed.length).toBe(40);
        expect(progress).not.toHaveBeenCalled();
    });

    it("finds the median of the values given, leaving out the missing ones", () => {
        expect(core.median([3, null, 1, 2])).toBe(2);
        expect(core.median([4, 1, undefined, 2, 3])).toBe(2.5);
        expect(core.median([null])).toBe(null);
    });
});

describe("the pages' dialog", () => {
    beforeEach(() => {
        document.body.innerHTML = '<div class="ta-page"><button id="opener">Open</button></div>';
    });
    const shown = () => document.querySelector(".ta-page .ta-dialog.ta-ask");
    const button = label => [].find.call(shown().querySelectorAll("button"), b => b.textContent === label);
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", {key: k, bubbles: true}));

    it("asks before doing something, with its own wording, in the page's theme", async () => {
        const opener = document.getElementById("opener");
        opener.focus();
        const answer = core.ask(document, "Delete <Roof>?", ["Its 2 conversions go with it.", "The images stay."], "Delete", "danger");
        expect(shown().querySelector(".ta-dialog-inner").classList.contains("theme-secondary")).toBe(true);
        expect(shown().querySelector("h4").textContent).toBe("Delete <Roof>?");
        expect([].map.call(shown().querySelectorAll("p"), p => p.textContent)).toEqual(["Its 2 conversions go with it.", "The images stay."]);
        expect(button("Delete").className).toContain("btn-danger");
        expect(document.activeElement).toBe(button("Delete"));
        click(button("Delete"));
        expect(await answer).toBe(true);
        expect(shown()).toBe(null);
        expect(document.activeElement).toBe(opener);

        const canceled = core.ask(document, "Delete?", "", "Delete", "danger");
        click(button("Cancel"));
        expect(await canceled).toBe(false);
        const dismissed = core.ask(document, "Delete?", "", "Delete", "danger");
        key(document.activeElement, "Escape");
        expect(await dismissed).toBe(false);
        const beside = core.ask(document, "Delete?", "", "Delete", "danger");
        click(shown());
        expect(await beside).toBe(false);
    });

    it("asks for a new name, Enter renaming, and gives nothing back for the same name or a blank one", async () => {
        let answer = core.askName(document, "Rename dataset", "Roof");
        const field = shown().querySelector("input");
        expect(field.value).toBe("Roof");
        expect(document.activeElement).toBe(field);
        field.value = "  Roof east ";
        key(field, "Enter");
        expect(await answer).toBe("Roof east");

        answer = core.askName(document, "Rename dataset", "Roof");
        click(button("Rename"));
        expect(await answer).toBe(null);
        answer = core.askName(document, "Rename dataset", "Roof");
        shown().querySelector("input").value = " ";
        click(button("Rename"));
        expect(await answer).toBe(null);
        answer = core.askName(document, "Rename dataset", "Roof");
        shown().querySelector("input").value = "Other";
        key(shown().querySelector("input"), "Escape");
        expect(await answer).toBe(null);
    });
});

describe("datasets list", () => {
    beforeEach(() => {
        document.body.innerHTML = page('datasets.html');
    });

    it("shows a dataset's progress, files and problems, with its actions", () => {
        const row = datasets.datasetRow(DATASET, "/");
        expect(row).toContain('href="/dataset/5"');
        expect(row).toContain("2 thermal · 1 other");
        expect(row).toContain('class="label label-warning"');
        expect(row).toContain('class="ta-rename"');
        expect(row).toContain('class="ta-delete"');
        expect(row).not.toContain("/0<");
        expect(datasets.datasetRow(Object.assign({}, DATASET, {conversion_count: 3, conversions_ready: 2}), "/p/"))
            .toContain('title="2 conversions ready of 3">2/3</span>');
        expect(datasets.datasetRow(Object.assign({}, DATASET, {conversion_count: 1, conversions_ready: 1}), "/p/")).toContain('class="text-success" title="1 conversion ready of 1"');

        expect(datasets.datasetRow(Object.assign({}, DATASET, {name: "<i>x</i>"}), "/p/")).toContain("&lt;i&gt;x&lt;/i&gt;");
        expect(datasets.datasetRow(Object.assign({}, DATASET, {source: "folder", folder: "/data/flight3"}), "/p/"))
            .toContain('title="Read in place from /data/flight3"');

        const running = datasets.datasetRow(Object.assign({}, DATASET, {status: "analyzing", progress: 0.3}), "/p/");
        expect(running).toContain("width: 30%");
        expect(running).not.toContain("ta-analyze");
    });

    it("lists the datasets and polls while one is analyzed", async () => {
        jest.useFakeTimers();
        const other = Object.assign({}, DATASET, {id: 6, name: "Yard", status: "analyzing", progress: 0.5});
        const fetchFn = jest.fn(() => jsonResponse({datasets: [DATASET, other]}));
        datasets.init(document, fetchFn);
        await ticks();

        expect(fetchFn).toHaveBeenCalledWith("/api/datasets", {credentials: "same-origin"});
        expect(document.querySelectorAll("#ta-body tr").length).toBe(2);

        jest.runOnlyPendingTimers();
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("sorts by any column, both ways, with what has nothing to sort by last", () => {
        const a = Object.assign({}, DATASET, {id: 1, name: "b", size: 5, last_activity: "2026-10-20T00:00:00Z"});
        const b = Object.assign({}, DATASET, {id: 2, name: "A", size: 9, last_activity: null, analyzed: false});
        const c = Object.assign({}, DATASET, {id: 3, name: "c", size: 1, last_activity: "2026-10-21T00:00:00Z", errors: 2});
        const ids = (key, desc) => datasets.sortDatasets([a, b, c], key, desc).map(d => d.id);
        expect(ids("name", false)).toEqual([2, 1, 3]);
        expect(ids("name", true)).toEqual([3, 1, 2]);
        expect(ids("size", true)).toEqual([2, 1, 3]);
        expect(ids("activity", true)).toEqual([3, 1, 2]);
        expect(ids("activity", false)).toEqual([1, 3, 2]);
        expect(ids("problems", true)).toEqual([3, 1, 2]);
    });

    it("searches the datasets' names, every word anywhere", () => {
        expect(datasets.matchesSearch(DATASET, "")).toBe(true);
        expect(datasets.matchesSearch(DATASET, "roof")).toBe(true);
        expect(datasets.matchesSearch(DATASET, "of RO")).toBe(true);
        expect(datasets.matchesSearch(DATASET, "yard")).toBe(false);
    });

    it("filters the list by the search and sorts it by the header clicked", async () => {
        const yard = Object.assign({}, DATASET, {id: 6, name: "Yard", created_at: "2026-10-19T09:00:00Z",
                                                 conversion_count: 2, conversions_ready: 1, last_activity: "2026-10-21T08:00:00Z"});
        datasets.init(document, jest.fn(() => jsonResponse({datasets: [yard, DATASET]})));
        await flush();
        const names = () => [].map.call(document.querySelectorAll("#ta-body tr td:first-child a"), a => a.textContent);
        expect(names()).toEqual(["Yard", "Roof"]);
        const created = document.querySelector("th[data-sort=created]");
        expect(created.getAttribute("aria-sort")).toBe("descending");
        expect(document.querySelector("#ta-body tr").textContent).toContain("1/2");

        const name = document.querySelector("th[data-sort=name]");
        click(name);
        expect(names()).toEqual(["Roof", "Yard"]);
        expect(name.getAttribute("aria-sort")).toBe("ascending");
        expect(name.querySelector(".fa-caret-up")).not.toBeNull();
        expect(created.getAttribute("aria-sort")).toBe("none");
        click(name);
        expect(names()).toEqual(["Yard", "Roof"]);

        const search = document.getElementById("ta-search");
        search.value = "yar";
        search.dispatchEvent(new Event("input"));
        expect(names()).toEqual(["Yard"]);
        search.value = "nothing";
        search.dispatchEvent(new Event("input"));
        expect(document.getElementById("ta-table").hidden).toBe(true);
        expect(document.getElementById("ta-message").textContent).toBe("No datasets match the search.");
    });

    it("opens New Dataset with the images dropped on the page, a dropped folder's read through", async () => {
        datasets.init(document, jest.fn(() => jsonResponse({datasets: []})));
        await flush();
        const drag = (type, dataTransfer) => {
            const e = new Event(type, {bubbles: true, cancelable: true});
            e.dataTransfer = dataTransfer;
            document.getElementById("ta-datasets").dispatchEvent(e);
            return e;
        };
        // A folder "flight" holding one image and a sub folder with another, read a part at a time
        const fileEntry = (path, size) => ({isFile: true, fullPath: path, file: ok => ok({name: path.split("/").pop(), size})});
        const folder = (path, children) => ({isFile: false, fullPath: path, createReader: () => {
            const parts = [children.slice(0, 1), children.slice(1)];
            return {readEntries: ok => ok(parts.shift() || [])};
        }});
        const tree = folder("/flight", [fileEntry("/flight/a_T.JPG", 4), folder("/flight/sub", [fileEntry("/flight/sub/b_T.JPG", 6)]),
                                        fileEntry("/flight/notes.txt", 1)]);
        const transfer = {types: ["Files"], items: [{webkitGetAsEntry: () => tree}], files: []};

        expect(drag("dragenter", transfer).defaultPrevented).toBe(true);
        expect(document.getElementById("ta-drop-hint").hidden).toBe(false);
        expect(drag("dragover", {types: ["text/plain"]}).defaultPrevented).toBe(false);
        drag("drop", transfer);
        expect(document.getElementById("ta-drop-hint").hidden).toBe(true);
        await flush();

        expect(document.getElementById("ta-new-dialog").hidden).toBe(false);
        expect(document.getElementById("ta-new-chosen").textContent).toBe("2 image(s), 10 B (1 other file(s) left out)");
        expect(document.getElementById("ta-new-name").value).toBe("flight");

        // Dropped images alone
        const files = await datasets.droppedFiles({files: [{name: "c_T.JPG", size: 3}]});
        expect(files.map(f => f.name)).toEqual(["c_T.JPG"]);
        const nested = await datasets.droppedFiles(transfer);
        expect(nested.map(f => core.uploadName(f))).toEqual(["a_T.JPG", "sub/b_T.JPG", "notes.txt"]);
    });

    it("says there are no datasets yet, and offers uploading images or a folder on this computer", async () => {
        datasets.init(document, jest.fn(() => jsonResponse({datasets: []})));
        await flush();
        expect(document.getElementById("ta-new").disabled).toBe(false);
        expect(document.getElementById("ta-message").textContent).toMatch(/No datasets yet/);

        click(document.getElementById("ta-new"));
        expect(document.getElementById("ta-new-source-group").hidden).toBe(false);
        expect(document.getElementById("ta-new-upload").hidden).toBe(false);
        expect(document.getElementById("ta-new-folder").hidden).toBe(true);
    });

    it("creates a folder dataset and opens it", async () => {
        const nav = jest.fn();
        const fetchFn = jest.fn()
            .mockImplementationOnce(() => jsonResponse({datasets: []}))
            .mockImplementationOnce(() => jsonResponse(Object.assign({}, DATASET, {id: 8, source: "folder"})));
        datasets.init(document, fetchFn, nav);
        await flush();

        click(document.getElementById("ta-new"));
        document.getElementById("ta-new-name").value = "Flight 3";
        const folder = document.querySelector("input[name=ta-new-source][value=folder]");
        folder.checked = true;
        folder.dispatchEvent(new Event("change"));
        expect(document.getElementById("ta-new-folder").hidden).toBe(false);
        click(document.getElementById("ta-new-create"));
        expect(document.getElementById("ta-new-error").textContent).toMatch(/folder.s path/);

        document.getElementById("ta-new-folder-path").value = "/data/flight3";
        click(document.getElementById("ta-new-create"));
        await flush();
        const [url, opts] = fetchFn.mock.calls[1];
        expect(url).toBe("/api/datasets");
        expect(JSON.parse(opts.body)).toEqual({name: "Flight 3", source: "folder", folder: "/data/flight3"});
        expect(opts.headers["X-CSRFToken"]).toBe("tok");
        expect(nav).toHaveBeenCalledWith("/dataset/8");
    });

    it("says why a dataset could not be created", async () => {
        const fetchFn = jest.fn()
            .mockImplementationOnce(() => jsonResponse({datasets: []}))
            .mockImplementationOnce(() => jsonResponse({name: ["A name is required"]}, false))
            .mockImplementation(() => jsonResponse({datasets: []}));
        datasets.init(document, fetchFn, jest.fn());
        await flush();
        click(document.getElementById("ta-new"));
        document.getElementById("ta-new-name").value = "Roof";
        // Choosing images
        const input = document.getElementById("ta-new-files");
        Object.defineProperty(input, "files", {value: [{name: "a_T.JPG", size: 5}]});
        input.dispatchEvent(new Event("change"));
        expect(document.getElementById("ta-new-chosen").textContent).toMatch(/1 image/);
        click(document.getElementById("ta-new-create"));
        await flush(); await flush();
        expect(document.getElementById("ta-new-error").textContent).toBe("A name is required");
        expect(document.getElementById("ta-new-dialog").hidden).toBe(false);
    });
});

describe("datasets list actions and an upload that does not all arrive", () => {
    const LIST = {datasets: [DATASET]};
    const API = "/api/";
    beforeEach(() => {
        document.body.innerHTML = page('datasets.html');
    });

    // Opens New Dataset with images chosen: k_T.JPG goes in a request of its own (ten images to a request)
    async function choose(names) {
        await flush();
        click(document.getElementById("ta-new"));
        document.getElementById("ta-new-name").value = "Roof";
        const input = document.getElementById("ta-new-files");
        Object.defineProperty(input, "files", {value: names.map(n => new File(["x"], n))});
        change(input);
    }
    const NAMES = "abcdefghijk".split("").map(c => c + "_T.JPG");
    const paths = opts => opts.body.getAll("paths");

    it("shows a dataset being converted as such, polls until it is done, and labels its icon links", async () => {
        jest.useFakeTimers();
        const fetchFn = server({[API + "datasets"]: [{datasets: [Object.assign({}, DATASET, {busy: true})]}, LIST]});
        datasets.init(document, fetchFn);
        await ticks();
        expect(document.querySelector("#ta-body tr").textContent).toContain("Converting");
        expect(document.querySelector(".ta-delete").getAttribute("aria-label")).toBe("Delete");
        jest.runOnlyPendingTimers();
        await ticks();
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(document.querySelector("#ta-body tr").textContent).not.toContain("Converting");
        jest.runOnlyPendingTimers();
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("renames a dataset in the page's dialog", async () => {
        const fetchFn = server({[API + "datasets"]: LIST, ["PATCH " + API + "datasets/5"]: DATASET});
        datasets.init(document, fetchFn);
        await flush();
        click(document.querySelector(".ta-rename"));
        expect(document.getElementById("ta-ask-field").value).toBe("Roof");
        document.getElementById("ta-ask-field").value = " Roof east ";
        press("Rename");
        await flush();
        const patch = fetchFn.mock.calls.filter(c => c[1] && c[1].method === "PATCH")[0];
        expect(JSON.parse(patch[1].body)).toEqual({name: "Roof east"});
        expect(askDialog()).toBeNull();
    });

    it("says what deleting a dataset takes with it before deleting it", async () => {
        const d = Object.assign({}, DATASET, {conversion_count: 2, mosaic_count: 1, measurement_count: 14});
        const fetchFn = server({[API + "datasets"]: {datasets: [d]}, ["DELETE " + API + "datasets/5"]: {}});
        datasets.init(document, fetchFn);
        await flush();
        click(document.querySelector(".ta-delete"));
        const text = askDialog().textContent;
        expect(text).toContain("“Roof” and its 3 images are deleted.");
        expect(text).toContain("With it: 2 conversions, 1 mosaic and 14 measurements.");
                expect(text).toContain("cannot be undone");
        press("Cancel");
        await flush();
        expect(calls(fetchFn)).not.toContain("DELETE " + API + "datasets/5");

        click(document.querySelector(".ta-delete"));
        press("Delete");
        await flush();
        expect(calls(fetchFn)).toContain("DELETE " + API + "datasets/5");

        expect(core.deleteText(Object.assign({}, DATASET, {source: "folder", folder: "/data/roof"}))[0])
            .toBe("“Roof” is deleted from the Thermal Analyzer. Its server folder (/data/roof) is left as it is.");
    });

    it("stops when images could not be sent, and analyzes once they are sent again", async () => {
        let failing = true;
        const nav = jest.fn();
        const fetchFn = server({
            [API + "datasets"]: LIST, ["POST " + API + "datasets"]: Object.assign({}, DATASET, {id: 8}),
            ["POST " + API + "datasets/8/upload"]: (url, opts) => failing && paths(opts).includes("k_T.JPG") ?
                jsonResponse({}, false) : jsonResponse({saved: paths(opts).length}),
            ["POST " + API + "datasets/8/analyze"]: {}
        });
        datasets.init(document, fetchFn, nav);
        await choose(NAMES);
        click(document.getElementById("ta-new-create"));
        await flush(); await flush();

        expect(calls(fetchFn)).not.toContain("POST " + API + "datasets/8/analyze");
        expect(document.getElementById("ta-new-error").textContent).toBe(
            "1 image could not be sent: k_T.JPG. 10 images arrived: send the others again, or analyze without them.");
        expect(document.getElementById("ta-new-create").hidden).toBe(true);
        expect(document.getElementById("ta-new-retry").hidden).toBe(false);
        expect(document.getElementById("ta-new-without").hidden).toBe(false);
        expect(document.getElementById("ta-new-cancel").disabled).toBe(false);

        failing = false;
        click(document.getElementById("ta-new-retry"));
        await flush(); await flush();
        const uploads = fetchFn.mock.calls.filter(c => c[0] === API + "datasets/8/upload");
        expect(paths(uploads[uploads.length - 1][1])).toEqual(["k_T.JPG"]);
        expect(calls(fetchFn)).toContain("POST " + API + "datasets/8/analyze");
        expect(nav).toHaveBeenCalledWith("/dataset/8");
    });

    it("analyzes without the images that could not be sent, and offers only to send them again when none arrived", async () => {
        const nav = jest.fn();
        const fetchFn = server({
            [API + "datasets"]: LIST, ["POST " + API + "datasets"]: Object.assign({}, DATASET, {id: 8}),
            ["POST " + API + "datasets/8/upload"]: (url, opts) => paths(opts).includes("k_T.JPG") ?
                jsonResponse({}, false) : jsonResponse({saved: paths(opts).length}),
            ["POST " + API + "datasets/8/analyze"]: {}
        });
        datasets.init(document, fetchFn, nav);
        await choose(NAMES);
        click(document.getElementById("ta-new-create"));
        await flush(); await flush();
        click(document.getElementById("ta-new-without"));
        await flush();
        expect(calls(fetchFn)).toContain("POST " + API + "datasets/8/analyze");
        expect(nav).toHaveBeenCalledWith("/dataset/8");

        document.body.innerHTML = page('datasets.html');
        datasets.init(document, server({
            [API + "datasets"]: LIST, ["POST " + API + "datasets"]: Object.assign({}, DATASET, {id: 8}),
            ["POST " + API + "datasets/8/upload"]: () => jsonResponse({}, false)
        }), jest.fn());
        await choose(["a_T.JPG"]);
        click(document.getElementById("ta-new-create"));
        await flush(); await flush();
        expect(document.getElementById("ta-new-error").textContent).toMatch(/None arrived/);
        expect(document.getElementById("ta-new-retry").hidden).toBe(false);
        expect(document.getElementById("ta-new-without").hidden).toBe(true);
    });

    it("cancels an upload under way, deleting the new dataset with the images sent so far", async () => {
        const fetchFn = server({
            [API + "datasets"]: LIST, ["POST " + API + "datasets"]: Object.assign({}, DATASET, {id: 8}),
            // The requests hang until they are aborted
            ["POST " + API + "datasets/8/upload"]: () => new Promise(() => {}),
            ["DELETE " + API + "datasets/8"]: {}
        });
        datasets.init(document, fetchFn, jest.fn());
        await choose(NAMES);
        click(document.getElementById("ta-new-create"));
        await flush();
        expect(document.getElementById("ta-new-cancel").disabled).toBe(false);
        const leaving = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(leaving);
        expect(leaving.defaultPrevented).toBe(true);

        click(document.getElementById("ta-new-cancel"));
        expect(askDialog().textContent).toContain("The images sent so far are deleted with the dataset.");
        press("Delete it");
        await flush(); await flush();
        expect(calls(fetchFn)).toContain("DELETE " + API + "datasets/8");
        expect(calls(fetchFn)).not.toContain("POST " + API + "datasets/8/analyze");
        expect(document.getElementById("ta-new-dialog").hidden).toBe(true);
        const after = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
    });
});

describe("a dataset's page", () => {
    beforeEach(() => {
        window.location.hash = "";    // a link clicked in an earlier test would choose the tab
        document.body.innerHTML = page('dataset.html');
    });

    it("sums up the frames, cameras, temperatures and capture times", () => {
        const o = dataset.overview(ANALYSIS);
        expect(o).toMatchObject({frames: 2, other: 1, tmin: 15.2, tmax: 50.6, first: "2026-10-12 18:29:50", last: "2026-10-12 18:30:10", altitude: 21, gps: 1});
        const html = dataset.overviewHtml(Object.assign({}, DATASET, {analysis: ANALYSIS}));
        expect(html).toContain("M4T · 640×512 · SN1 · 2 frame(s)");
        expect(html).toContain("15.2 °C to 50.6 °C");
        expect(html).toContain("dji-thermal-cli 1.1.0");
    });

    it("lists the files sorted, with the problems that name them, and filters them", () => {
        let html = dataset.filesHtml(ANALYSIS, {sort: "tmax", desc: true});
        expect(html.indexOf("thermal/b_T.JPG")).toBeLessThan(html.indexOf("thermal/a_T.JPG"));
        expect(html).toContain("5.0 m / 21.4 m");
        expect(html).toContain('title="1 image with an unusual &lt;maximum&gt;">temperature_max_outlier');
        expect(html).toContain("not an R-JPEG");

        html = dataset.filesHtml(ANALYSIS, {show: "thermal"});
        expect(html).not.toContain("rgb/a_V.JPG");
        expect(html).toContain("2 shown");
        html = dataset.filesHtml(ANALYSIS, {show: "flagged"});
        expect(html).toContain("2 shown");    // the outlier and the oblique frame
    });

    it("sorts missing values last either way", () => {
        const rows = [{v: 2}, {v: null}, {v: 1}];
        expect(dataset.sortRows(rows, "v").map(r => r.v)).toEqual([1, 2, null]);
        expect(dataset.sortRows(rows, "v", true).map(r => r.v)).toEqual([2, 1, null]);
    });

    it("shows the problems with what addresses them, and the WebODM plan", () => {
        const problems = dataset.problemsHtml(ANALYSIS);
        expect(problems).toContain("alert-warning");
        expect(problems).toContain("--replace-above");
        expect(problems).toContain("<code>thermal/b_T.JPG</code>");
        expect(dataset.problemsHtml({findings: []})).toMatch(/no problems/);

        const plan = dataset.planHtml(ANALYSIS);
        expect(plan).toContain("2.1 cm/px");
        expect(plan).toContain("<code>radiometric-calibration</code>");
        expect(plan).toContain("--radiometric-calibration none");
        expect(plan).toContain("dji-thermal-cli process -o temp_c:tiff --normalize");
        expect(dataset.planHtml({})).toMatch(/No plan/);
    });

    const FRAMES = "/conversion/";
    const READY = [Object.assign({}, CONVERSION, {id: 7, finished_at: "2026-10-18T10:01:00Z"}), CONVERSION,
                   Object.assign({}, CONVERSION, {id: 11, status: "converting", finished_at: null})];
    afterEach(() => { window.localStorage.clear(); delete navigator.clipboard; });

    it("filters the files by every word of a name, and links each thermal frame to its frame page", () => {
        expect(dataset.newestReady(READY).id).toBe(9);
        expect(dataset.newestReady([READY[2]])).toBe(null);
        expect(dataset.fileRows(ANALYSIS, {filter: "T.jpg THERMAL"}).map(f => f.path)).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect(dataset.fileRows(ANALYSIS, {filter: "a_ jpg"}).map(f => f.path)).toEqual(["rgb/a_V.JPG", "thermal/a_T.JPG"]);

        let html = dataset.filesHtml(ANALYSIS, {frames: FRAMES + "9/frame"});
        expect(html).toContain('data-href="' + FRAMES + '9/frame?frame=thermal%2Fa_T.JPG"');
        expect(html).toContain('<a href="' + FRAMES + '9/frame?frame=thermal%2Fb_T.JPG">');
        expect(html).not.toContain("frame=rgb");    // not a thermal frame: no frame to open
        expect(html).not.toContain("ta-files-hint");
        expect(html).not.toContain("ta-thumb");
        html = dataset.filesHtml(ANALYSIS, {thumbs: "/t?file="});
        expect(html).not.toContain("data-href");
        expect(html).toContain("ta-files-hint");
        expect(html).toContain('<img loading="lazy" alt="" src="/t?file=rgb%2Fa_V.JPG">');
    });

    it("opens a frame from its row, filters while typing through the polls, and remembers the thumbnails", async () => {
        jest.useFakeTimers();
        const nav = jest.fn();
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: READY}),
                                "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn, nav);
        await ticks();
        const tab = document.getElementById("ta-tab-files");
        expect(tab.querySelector(".ta-files-hint")).toBe(null);

        click(tab.querySelector('tr[data-href*="b_T"] td:last-child'));
        expect(nav).toHaveBeenCalledWith(FRAMES + "9/frame?frame=thermal%2Fb_T.JPG");

        const filter = tab.querySelector(".ta-files-filter");
        filter.value = "rgb";
        filter.dispatchEvent(new Event("input", {bubbles: true}));
        expect(tab.querySelectorAll("tbody tr").length).toBe(1);
        expect(tab.querySelector(".ta-files-shown").textContent).toBe("1 shown");
        // A conversion still running polls the dataset: the filter being typed in stays
        jest.runOnlyPendingTimers();
        await ticks();
        expect(calls(fetchFn).filter(c => c === "GET " + URL5).length).toBe(2);
        expect(tab.querySelector(".ta-files-filter")).toBe(filter);

        const thumbs = tab.querySelector(".ta-files-thumbs");
        thumbs.checked = true;
        change(thumbs);
        expect(tab.querySelector(".ta-thumb img").getAttribute("src")).toBe(URL5 + "/thumbnail?file=rgb%2Fa_V.JPG");
        expect(window.localStorage.getItem("thermalAnalyzer.thumbnails")).toBe("1");

        document.body.innerHTML = page('dataset.html');
        dataset.init(document, fetchFn, nav);
        await ticks();
        expect(document.querySelector(".ta-files-thumbs").checked).toBe(true);
        expect(document.querySelectorAll(".ta-thumb img").length).toBe(3);
        jest.clearAllTimers();    // no more polls into the next test's page
    });

    it("leaves the files unlinked, pointing to the Convert tab, until a conversion is ready", async () => {
        jest.useFakeTimers();    // the conversion running polls
        const nav = jest.fn();
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [READY[2]]}),
                                "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn, nav);
        await ticks();
        const tab = document.getElementById("ta-tab-files");
        expect(tab.querySelector(".ta-files-hint").textContent).toMatch(/Convert tab/);
        click(tab.querySelector("tbody td"));
        expect(nav).not.toHaveBeenCalled();
        jest.clearAllTimers();    // no more polls into the next test's page
    });

    it("shows a problem's file on the Files tab, filtered to it", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS}), "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        click(document.querySelector('#ta-tabs a[data-tab="problems"]'));
        document.querySelector('#ta-tab-files input[value="thermal"]').checked = true;
        change(document.querySelector('#ta-tab-files input[value="thermal"]'));

        click(document.querySelector('#ta-tab-problems a[data-file="thermal/b_T.JPG"] code'));
        const tab = document.getElementById("ta-tab-files");
        expect(tab.hidden).toBe(false);
        expect(document.getElementById("ta-tab-problems").hidden).toBe(true);
        expect(tab.querySelector(".ta-files-filter").value).toBe("thermal/b_T.JPG");
        expect(tab.querySelector('input[value="all"]').checked).toBe(true);
        expect([...tab.querySelectorAll("tbody tr")].map(r => r.className)).toEqual(["ta-kind-thermal"]);
    });

    it("copies the plan's options and command, and offers to convert with its settings", async () => {
        navigator.clipboard = {writeText: jest.fn(() => Promise.resolve())};
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS}), "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        const buttons = document.querySelectorAll("#ta-tab-webodm .ta-copy");
        expect(buttons.length).toBe(2);
        click(buttons[0].querySelector("i"));
        click(buttons[1]);
        await flush();
        expect(navigator.clipboard.writeText.mock.calls).toEqual([["--radiometric-calibration none"],
                                                                  ["dji-thermal-cli process -o temp_c:tiff --normalize"]]);
        expect(buttons[1].textContent).toMatch(/Copied/);
        expect(document.getElementById("ta-plan-convert")).not.toBe(null);
        const noArgs = Object.assign({}, ANALYSIS, {webodm: Object.assign({}, ANALYSIS.webodm, {process_args: null})});
        expect(dataset.planHtml(noArgs)).not.toContain("ta-plan-convert");
    });

    it("loads the dataset, switches tabs and polls while it is analyzed", async () => {
        jest.useFakeTimers();
        const analyzing = Object.assign({}, DATASET, {status: "analyzing", progress: 0.4, analysis: {}, analyzed: false});
        const fetchFn = server({
            "/api/datasets/5": [analyzing,
                Object.assign({}, DATASET, {analysis: ANALYSIS})],
            "/api/preferences": PREFERENCES
        });
        dataset.init(document, fetchFn);
        await ticks();

        expect(fetchFn.mock.calls[0][0]).toBe("/api/datasets/5");
        expect(document.getElementById("ta-status").innerHTML).toContain("40%");
        // Before the analysis, only the Convert tab: converting needs none
        expect(document.getElementById("ta-tabs").hidden).toBe(false);
        expect(document.querySelector('#ta-tabs a[data-tab="files"]').parentNode.hidden).toBe(true);
        expect(document.getElementById("ta-tab-convert").hidden).toBe(false);
        expect(document.getElementById("ta-cancel").hidden).toBe(false);
        expect(document.getElementById("ta-add").hidden).toBe(true);

        jest.runOnlyPendingTimers();
        await ticks();
        expect(document.getElementById("ta-tabs").hidden).toBe(false);
        expect(document.getElementById("ta-tab-files").hidden).toBe(false);    // the files once analyzed
        expect(document.getElementById("ta-cancel").hidden).toBe(true);
        expect(document.getElementById("ta-add").hidden).toBe(false);
        expect(document.getElementById("ta-problems-count").textContent).toBe("1");

        click(document.querySelector('#ta-tabs a[data-tab="webodm"]'));
        expect(document.getElementById("ta-tab-webodm").hidden).toBe(false);
        expect(document.getElementById("ta-tab-files").hidden).toBe(true);
    });

    it("cancels a running analysis", async () => {
        const fetchFn = server({
            "/api/datasets/5": Object.assign({}, DATASET, {status: "analyzing", analysis: {}}),
            "/api/preferences": PREFERENCES,
            "POST /api/datasets/5/cancel": Object.assign({}, DATASET, {status: "canceled", analysis: {}})
        });
        dataset.init(document, fetchFn);
        await flush();
        click(document.getElementById("ta-cancel"));
        await flush();
        expect(calls(fetchFn)).toContain("POST /api/datasets/5/cancel");
        expect(document.getElementById("ta-status").textContent).toMatch(/canceled/);
    });

    const URL5 = "/api/datasets/5";
    const NAMES = "abcdefghijk".split("").map(c => c + "_T.JPG");
    const paths = opts => opts.body.getAll("paths");
    function addImages(names) {
        const input = document.getElementById("ta-add-files");
        Object.defineProperty(input, "files", {value: names.map(n => new File(["x"], n)), configurable: true});
        change(input);
    }

    it("renames, deletes and shares the link in the page's dialog", async () => {
        const nav = jest.fn();
        const d = Object.assign({}, DATASET, {analysis: ANALYSIS, conversion_count: 1, mosaic_count: 1, measurement_count: 0});
        const fetchFn = server({[URL5]: d, "/api/preferences": PREFERENCES,
                                ["PATCH " + URL5]: Object.assign({}, d, {name: "Roof east"}), ["DELETE " + URL5]: {}});
        dataset.init(document, fetchFn, nav);
        await flush();

        click(document.getElementById("ta-rename"));
        document.getElementById("ta-ask-field").value = "Roof east";
        press("Rename");
        await flush();
        expect(JSON.parse(fetchFn.mock.calls.find(c => c[1] && c[1].method === "PATCH")[1].body)).toEqual({name: "Roof east"});
        expect(document.getElementById("ta-name").textContent).toBe("Roof east");

        click(document.getElementById("ta-delete"));
        expect(askDialog().textContent).toContain("With it: 1 conversion and 1 mosaic.");
        press("Delete");
        await flush();
        expect(calls(fetchFn)).toContain("DELETE " + URL5);
        expect(nav).toHaveBeenCalledWith("/");

        // No clipboard here: the link is shown to copy by hand
        click(document.getElementById("ta-copy-link"));
        expect(document.getElementById("ta-ask-field").value).toBe(window.location.origin + "/dataset/5");
        expect(document.getElementById("ta-ask-field").readOnly).toBe(true);
        press("Close");
        expect(askDialog()).toBeNull();
    });

    it("names the added images that could not be sent, and sends only them again", async () => {
        let failing = true;
        const fetchFn = server({
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS}), "/api/preferences": PREFERENCES,
            ["POST " + URL5 + "/upload"]: (url, opts) => failing && paths(opts).includes("k_T.JPG") ?
                jsonResponse({}, false) : jsonResponse({saved: paths(opts).length}),
            ["POST " + URL5 + "/analyze"]: Object.assign({}, DATASET, {analysis: ANALYSIS})
        });
        dataset.init(document, fetchFn);
        await flush();
        addImages(NAMES);
        await flush(); await flush();
        expect(calls(fetchFn)).toContain("POST " + URL5 + "/analyze");
        expect(document.getElementById("ta-add-failed").hidden).toBe(false);
        expect(document.getElementById("ta-add-failed-text").textContent).toBe("1 image could not be sent: k_T.JPG.");

        failing = false;
        click(document.getElementById("ta-add-retry"));
        await flush(); await flush();
        const uploads = fetchFn.mock.calls.filter(c => c[0] === URL5 + "/upload");
        expect(paths(uploads[uploads.length - 1][1])).toEqual(["k_T.JPG"]);
        expect(calls(fetchFn).filter(c => c === "POST " + URL5 + "/analyze").length).toBe(2);
        expect(document.getElementById("ta-add-failed").hidden).toBe(true);
    });

    it("cancels adding images, keeping those already sent", async () => {
        const fetchFn = server({
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS}), "/api/preferences": PREFERENCES,
            // k_T.JPG's request hangs until it is aborted
            ["POST " + URL5 + "/upload"]: (url, opts) => paths(opts).includes("k_T.JPG") ?
                new Promise(() => {}) : jsonResponse({saved: paths(opts).length})
        });
        dataset.init(document, fetchFn);
        await flush();
        addImages(NAMES);
        await flush();
        expect(document.getElementById("ta-add-progress").hidden).toBe(false);
        expect(document.getElementById("ta-add").hidden).toBe(true);
        const leaving = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(leaving);
        expect(leaving.defaultPrevented).toBe(true);

        click(document.getElementById("ta-add-cancel"));
        await flush(); await flush();
        expect(document.getElementById("ta-add-progress").hidden).toBe(true);
        expect(calls(fetchFn).filter(c => c.startsWith("DELETE") || c.endsWith("/analyze"))).toEqual([]);
        expect(document.getElementById("ta-add-failed-text").textContent).toBe(
            "Upload canceled: 10 images were sent and kept (analyze again to include them), 1 image was not sent.");
        expect(document.getElementById("ta-add").hidden).toBe(false);
        const after = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
    });
});

describe("a dataset's conversions", () => {
    const URL5 = "/api/datasets/5";
    beforeEach(() => {
        document.body.innerHTML = page('dataset.html');
    });
    const form = () => document.getElementById("ta-convert-form");
    const input = name => form().querySelector('[name="' + name + '"]');

    afterEach(() => { delete window.__temperatureUnit; window.history.replaceState(null, "", "/"); });

    it("shows what the flight recorded beside each measurement parameter, in the user's unit", () => {
        const rec = conversions.recorded(Object.assign({}, ANALYSIS, {files: ANALYSIS.files.concat(
            [{path: "c_T.JPG", kind: "thermal", distance: 7, lrf: 20, humidity: 50, emissivity: 0.95, reflection: 20, ambient: 25}])}));
        expect(rec).toMatchObject({distance: 5, lrf: 20.7, emissivity: 0.91, reflection: 20});
        window.__temperatureUnit = "F";
        // The files in kelvin: the form is still in the user's unit
        document.body.innerHTML = '<div id="f">' + conversions.formHtml(Object.assign({}, DEFAULTS, {unit: "K"}), PREFERENCES, rec) + "</div>";
        const html = document.getElementById("f").innerHTML;
        expect(html).toContain("Embedded 5.0 m, rangefinder 20.7 m");
        expect(html).toContain("Reflected temperature (°F)");
        expect(html).toContain("recorded 68.0 °F");      // 20 °C
        expect(html).toContain("recorded 0.91");
        expect(html).toContain("Relative humidity (%)");
        expect(html).toContain("Colour range (°F)");
        expect(document.querySelector('[name="unit"]').value).toBe("K");
    });

    it("puts the colours first, above the outputs, the default naming the images' own palette", () => {
        const files = palettes => palettes.map((p, i) => ({path: i + "_T.JPG", kind: "thermal", palette: p}));
        const own = analysis => {
            document.body.innerHTML = '<div id="f">' + conversions.formHtml(DEFAULTS, PREFERENCES, conversions.recorded(analysis)) + "</div>";
            return document.querySelector('[name="palette"] option[value=""]').textContent;
        };
        expect(own({files: files(["ironred", "ironred"])})).toBe("Each image's own (ironred)");
        expect(own({files: files(["whitehot", "ironred", "ironred", ""])})).toBe("Each image's own (ironred on 2, whitehot on 1)");
        expect(own(ANALYSIS)).toBe("Each image's own");
        const sections = [].map.call(document.querySelectorAll("#f > .ta-section"), el => el.querySelector("h4").textContent);
        expect(sections).toEqual(["Colours", "Outputs", "Measurement", "Frames", "Adjustments"]);
        const colours = document.querySelector("#f > .ta-section");
        expect(colours.tagName).toBe("DIV");
        expect(colours.querySelector('[name="palette"]')).not.toBe(null);
        expect(colours.querySelector('[name="range_min"]')).not.toBe(null);
        expect([].map.call(document.querySelectorAll('[name="palette"] option'), o => o.value)).toEqual(["", "whitehot", "ironred"]);
    });

    it("shows the temperatures in the user's unit and reads them back in the files'", () => {
        window.__temperatureUnit = "F";
        const s = Object.assign({}, DEFAULTS, {unit: "C", reflected_temp: 20, range_min: 10, range_max: 60,
            replace_above: 150, replace_above_value: "nodata", replace_below: -10, replace_below_value: 0});
        document.body.innerHTML = '<div id="ta-convert-form">' + conversions.formHtml(s, PREFERENCES, {}) + "</div>";
        expect(input("reflected_temp").value).toBe("68");
        expect(input("range_min").value).toBe("50");
        expect(input("range_max").value).toBe("140");
        expect(input("replace_above").value).toBe("302");
        expect(input("replace_below").value).toBe("14");
        expect(input("replace_below_value").value).toBe("32");
        expect(conversions.readForm(form())).toEqual(s);

        // What is typed is given in the files' unit, here kelvin
        input("unit").value = "K";
        input("ambient_temp").value = "77";
        const read = conversions.readForm(form());
        expect(read).toMatchObject({unit: "K", reflected_temp: 293.15, ambient_temp: 298.15, range_min: 283.15, replace_above_value: "nodata"});
    });

    it("chooses the user's unit for the files when the settings name none", () => {
        window.__temperatureUnit = "K";
        document.body.innerHTML = '<div id="ta-convert-form">' + conversions.formHtml(Object.assign({}, DEFAULTS, {unit: undefined}), PREFERENCES, {}) + "</div>";
        expect(input("unit").value).toBe("K");
        expect(form().innerHTML).toContain("Reflected temperature (K)");
    });

    it("reads the form back as the settings it shows", () => {
        const s = Object.assign({}, DEFAULTS, {distance: 12.5, emissivity: 0.95, palette: "ironred", range_min: 10, range_max: 60,
            replace_above: 150, replace_above_value: "nodata", normalize: true, max_pitch: -80, outputs: ["temp_c:exr", "gray16:png"]});
        document.body.innerHTML = '<div id="f">' + conversions.formHtml(s, PREFERENCES, {}) + "</div>";
        const read = conversions.readForm(document.getElementById("f"));
        expect(read).toEqual(Object.assign({}, s));
        expect(conversions.formProblem(read)).toBe(null);
        expect(conversions.formProblem(Object.assign({}, read, {outputs: []}))).toMatch(/at least one output/);
        expect(conversions.formProblem(Object.assign({}, read, {distance: ""}))).toMatch(/distance/);
        expect(conversions.formProblem(Object.assign({}, read, {range_max: null}))).toMatch(/colour range/);
    });

    it("fills the settings from the WebODM plan's process command", () => {
        const s = conversions.planSettings(["-o", "temp_c:tif,pseudo", "--max-pitch", "-80", "--normalize", "--emissivity", "0.9"], DEFAULTS);
        expect(s).toEqual(Object.assign({}, DEFAULTS, {outputs: ["temp_c:tiff", "pseudo"], max_pitch: -80, normalize: true, emissivity: 0.9}));
        expect(DEFAULTS.normalize).toBe(false);
    });

    it("gives the plan's temperatures in the settings' unit, °C when the plan names no unit", () => {
        const f = Object.assign({}, DEFAULTS, {unit: "F"});
        expect(conversions.planSettings(["--reflected-temp", "20"], f).reflected_temp).toBe(68);
        expect(conversions.planSettings(["--unit", "k", "--ambient-temp", "293.15"], f).ambient_temp).toBe(68);
        expect(conversions.planSettings(["--unit", "F", "--ambient-temp", "68"], DEFAULTS).ambient_temp).toBe(20);
    });

    it("fills the form from a frame's link, its temperatures typed in the user's unit", async () => {
        window.__temperatureUnit = "F";
        window.history.replaceState(null, "", "/p/dataset/5?from=9&reflected_temp=80.6");
        const fetchFn = server({
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION]}),
            "/api/preferences": PREFERENCES
        });
        dataset.init(document, fetchFn);
        await ticks();
        expect(input("reflected_temp").value).toBe("80.6");
        expect(input("emissivity").value).toBe("0.95");
        expect(document.getElementById("ta-convert-message").textContent).toMatch(/Nadir's settings, with reflected temp 80\.6/);
        expect(conversions.readForm(form()).reflected_temp).toBe(27);
    });

    it("lists what settings change dji-thermal-cli's defaults, in the user's unit, and which leave the WebODM plan", () => {
        window.__temperatureUnit = "F";
        const plan = conversions.planSettings(["-o", "temp_c:tiff", "-o", "pseudo", "--normalize"], DEFAULTS);
        const s = Object.assign({}, DEFAULTS, {emissivity: 0.95, reflected_temp: 20, range_min: 10, range_max: 60,
            outputs: ["temp_c:tiff", "pseudo:tiff"]});
        const diffs = conversions.differences(s, DEFAULTS, plan, "F");
        expect(diffs.map(d => [d.key, d.text, d.changed, d.offPlan])).toEqual([
            ["outputs", "temp_c:tiff, pseudo:tiff", true, false],   // the plan's pseudo names no format, so any one is on it
            ["emissivity", "emissivity 0.95", true, false],
            ["reflected_temp", "reflected 68 °F", true, false],
            ["normalize", "not normalized", false, true],
            ["range", "range 50 to 140 °F", true, false]
        ]);
        expect(conversions.differences(DEFAULTS, DEFAULTS, null, "C")).toEqual([]);
        // The same temperature in another unit is no change, but the unit is
        expect(conversions.differences(Object.assign({}, DEFAULTS, {unit: "K"}), DEFAULTS, null, "C").map(d => d.key)).toEqual(["unit"]);

        const chips = document.createElement("div");
        chips.innerHTML = conversions.chipsHtml(diffs, "the defaults");
        expect(chips.querySelectorAll(".ta-chip-changed").length).toBe(4);
        expect(chips.querySelector(".ta-chip-off-plan").getAttribute("title")).toBe("The WebODM plan: normalized");
        expect(conversions.chipsHtml([], "the defaults")).toContain("the defaults");
    });

    it("puts a changed setting back to its default, in the files' unit", () => {
        const s = Object.assign({}, DEFAULTS, {unit: "K", range_min: 283.15, range_max: 333.15, emissivity: 0.95, gimbal_yaw: 10});
        expect(conversions.resetSetting(s, DEFAULTS, "range")).toEqual(Object.assign({}, s, {range_min: null, range_max: null}));
        expect(conversions.resetSetting(s, DEFAULTS, "gimbal").gimbal_yaw).toBe(null);
        const back = conversions.resetSetting(Object.assign({}, s, {reflected_temp: 293.15}), DEFAULTS, "unit");
        expect(back.unit).toBe("C");
        expect(back.reflected_temp).toBeCloseTo(20);
        expect(back.range_min).toBeCloseTo(10);
    });

    it("folds the form into a summary once the dataset has conversions, and marks and resets what changed", async () => {
        window.__temperatureUnit = "F";
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION], defaults: DEFAULTS}),
                                "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        const summary = document.getElementById("ta-convert-summary");
        expect(form().hidden).toBe(true);
        // The form starts from the defaults: what it shows are the plan's settings it leaves
        expect([...summary.querySelectorAll(".ta-chip-off-plan")].map(c => c.getAttribute("data-key"))).toEqual(["outputs", "normalize"]);
        expect(summary.querySelector(".ta-chip-changed")).toBe(null);
        // Each card says what its conversion changed
        const card = document.querySelector('.ta-conversion[data-id="9"] .ta-conversion-chips');
        expect([...card.querySelectorAll(".ta-chip")].map(c => c.textContent)).toEqual(["emissivity 0.95", "normalized"]);

        click(summary.querySelector('[data-act="edit"]'));
        expect(form().hidden).toBe(false);
        expect(summary.querySelector('[data-act="edit"]')).toBe(null);
        input("reflected_temp").value = "68";
        input("reflected_temp").dispatchEvent(new Event("input", {bubbles: true}));
        expect(summary.querySelector('[data-key="reflected_temp"]').textContent).toBe("reflected 68 °F");
        const field = input("reflected_temp").closest(".ta-field");
        expect(field.classList.contains("ta-changed")).toBe(true);
        // The plan normalizes, the form does not
        expect(input("normalize").closest(".checkbox").classList.contains("ta-off-plan")).toBe(true);

        click(field.querySelector('[data-reset="reflected_temp"]'));
        expect(input("reflected_temp").value).toBe("");
        expect(input("reflected_temp").closest(".ta-field").classList.contains("ta-changed")).toBe(false);
        expect(summary.querySelector('[data-key="reflected_temp"]')).toBe(null);
        expect(form().hidden).toBe(false);
    });

    it("opens the Convert tab with the WebODM plan's settings, marked as changed, without converting", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION], defaults: DEFAULTS}),
                                "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        expect(form().hidden).toBe(true);
        click(document.getElementById("ta-plan-convert"));
        expect(document.getElementById("ta-tab-convert").hidden).toBe(false);
        expect(document.getElementById("ta-tab-webodm").hidden).toBe(true);
        expect(input("normalize").checked).toBe(true);
        expect(document.querySelector('#ta-convert-summary [data-key="normalize"]').classList.contains("ta-chip-changed")).toBe(true);
        expect(document.querySelector("#ta-convert-summary .ta-chip-off-plan")).toBe(null);
        expect(calls(fetchFn).filter(c => c.indexOf("POST") === 0)).toEqual([]);
    });

    it("opens the form at once for a dataset without conversions", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [], defaults: DEFAULTS}),
                                "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        expect(form().hidden).toBe(false);
        expect(document.querySelector('#ta-convert-summary [data-act="edit"]')).toBe(null);
    });

    it("opens a conversion's menu, and closes it on another click or Esc", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION], defaults: DEFAULTS}),
                                "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        const toggle = () => document.querySelector('.ta-conversion[data-id="9"] [data-act="menu"]');
        const isOpen = () => toggle().parentNode.classList.contains("open");
        click(toggle());
        expect(isOpen()).toBe(true);
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        click(toggle());
        expect(isOpen()).toBe(false);
        click(toggle());
        click(document.body);
        expect(isOpen()).toBe(false);
        click(toggle());
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(isOpen()).toBe(false);
        expect(toggle().getAttribute("aria-expanded")).toBe("false");
    });

    it("lists the conversions with their downloads, and each one's files", () => {
        const base = "/api/conversions/";
        const running = Object.assign({}, CONVERSION, {id: 10, name: "Run", status: "converting", progress: 0.3});
        let html = conversions.listHtml([running, CONVERSION], base, null);
        expect(html).toContain("Converting 30%");
        const starting = Object.assign({}, running, {progress: 0, settings: Object.assign({}, DEFAULTS, {normalize: true})});
        expect(conversions.listHtml([starting], base, null)).toContain("Normalizing: comparing the frames' overlaps");
        const normalizing = Object.assign({}, starting, {stage: {stage: "frames", step: 2, steps: 5, done: 40, total: 217, unit: "files"}});
        expect(conversions.listHtml([normalizing], base, null)).toContain("Normalizing: step 2 of 5, reading frames, 40/217 files…");
        expect(html).toContain('href="' + base + '9/download"');
        expect(html).not.toContain(base + '10/download');
        expect(html).toContain("2 converted, 1 skipped");
        expect(html).toContain('data-act="cancel"');
        expect(html).toContain('data-act="use"');
        expect(conversions.listHtml([], base)).toMatch(/No conversions yet/);

        const files = conversions.resultsHtml(Object.assign({}, CONVERSION, {results: {
            files: [{path: "a_T.JPG", ok: true, outputs: ["sub/a_T_temp_c.tiff"], notes: [], distance: 21.4, distance_source: "lrf"},
                    {path: "b_T.JPG", ok: false, reason: "oblique (gimbal pitch -45 above -80)", outputs: [], notes: []}],
            normalization: {ambient_c: 20, reflected_c: 20, frames: 2, without_offset: 0, offset_min: -0.2, offset_max: 0.3}}}), base);
        expect(files).toContain('href="' + base + '9/download?file=sub%2Fa_T_temp_c.tiff">a_T_temp_c.tiff</a>');
        expect(files).toContain("oblique (gimbal pitch -45 above -80)");
        expect(files).toContain("Skipped: oblique (1).");
        expect(conversions.skipReasons([{ok: false, reason: "oblique (gimbal pitch -45 above -80)"}, {ok: false, reason: "no DJI thermal data found (not an R-JPEG)"},
            {ok: false, reason: "oblique (gimbal pitch -30 above -80)"}, {ok: true}])).toEqual([["oblique", 2], ["no DJI thermal data found", 1]]);
        expect(files).toContain("distance 21.4 m (lrf)");
        expect(files).toContain("offsets -0.20 to 0.30 °C");
    });

    it("converts with the form's settings, polls while it runs, and saves or resets the user's defaults", async () => {
        jest.useFakeTimers();
        const converting = Object.assign({}, CONVERSION, {id: 10, name: "Conversion 2", status: "converting", progress: 0.5});
        const fetchFn = server({
            [URL5]: [Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION]}),
                Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [converting, CONVERSION]}),
                Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [Object.assign({}, converting, {status: "ready"}), CONVERSION]})],
            "/api/preferences": Object.assign({}, PREFERENCES, {settings: Object.assign({}, DEFAULTS, {emissivity: 0.9}), saved: true}),
            ["POST " + URL5 + "/conversions"]: converting,
            "PUT /api/preferences": (u, o) => jsonResponse({settings: JSON.parse(o.body).settings, saved: true}),
            "DELETE /api/preferences": {settings: DEFAULTS, saved: false}
        });
        dataset.init(document, fetchFn);
        await ticks();

        // The form starts from the user's saved defaults
        expect(document.getElementById("ta-convert-count").textContent).toBe("1");
        expect(document.getElementById("ta-convert-origin").textContent).toMatch(/your saved defaults/);
        expect(input("emissivity").value).toBe("0.9");
        expect(document.getElementById("ta-convert-plan").hidden).toBe(false);

        input("normalize").checked = true;
        document.getElementById("ta-convert-name").value = "Normalized";
        click(document.getElementById("ta-convert-start"));
        await ticks();
        const post = fetchFn.mock.calls.find(c => c[1] && c[1].method === "POST");
        expect(JSON.parse(post[1].body)).toMatchObject({name: "Normalized", settings: {emissivity: 0.9, normalize: true}});
        expect(document.getElementById("ta-conversions").innerHTML).toContain("Converting 50%");
        expect(document.querySelector('.ta-conversion[data-id="10"]').classList).toContain("ta-conversion-new");

        // Polled while it converts, and no longer once it is done
        jest.runOnlyPendingTimers();
        await ticks();
        expect(document.getElementById("ta-conversions").innerHTML).not.toContain("Converting");
        const loads = calls(fetchFn).filter(c => c === "GET " + URL5).length;
        jest.runOnlyPendingTimers();
        await ticks();
        expect(calls(fetchFn).filter(c => c === "GET " + URL5).length).toBe(loads);

        input("humidity").value = "60";
        click(document.getElementById("ta-convert-save"));
        await ticks();
        const put = fetchFn.mock.calls.find(c => c[1] && c[1].method === "PUT");
        expect(JSON.parse(put[1].body).settings.humidity).toBe(60);
        expect(document.getElementById("ta-convert-message").textContent).toMatch(/Saved/);

        click(document.getElementById("ta-convert-reset"));
        expect(askDialog().textContent).toContain("Your saved defaults are forgotten.");
        press("Reset");
        await ticks();
        expect(input("emissivity").value).toBe("");
        expect(input("humidity").value).toBe("");
        expect(document.getElementById("ta-convert-origin").textContent).toMatch(/dji-thermal-cli's defaults/);

        // A conversion's settings, and the WebODM plan's, fill the form
        click(document.querySelector('.ta-conversion[data-id="9"] button[data-act="use"]'));
        expect(input("emissivity").value).toBe("0.95");
        expect(input("normalize").checked).toBe(true);
        click(document.getElementById("ta-convert-plan"));
        expect(input("emissivity").value).toBe("");
        expect(form().querySelector('input[name="output"][value="pseudo"]').checked).toBe(false);
    });

    it("shows a started conversion at once, before the dataset reloads", async () => {
        const started = Object.assign({}, CONVERSION, {id: 10, name: "Conversion 2", status: "converting", progress: 0});
        let reload;
        const fetchFn = server({
            [URL5]: [Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION]}),
                     () => new Promise(r => { reload = r; })],
            "/api/preferences": PREFERENCES,
            ["POST " + URL5 + "/conversions"]: started
        });
        dataset.init(document, fetchFn);
        await ticks();
        click(document.getElementById("ta-convert-start"));
        await ticks();
        expect(reload).toBeDefined();   // the reload has not answered yet
        const card = document.querySelector('.ta-conversion[data-id="10"]');
        expect(card.classList).toContain("ta-conversion-new");
        expect(card.textContent).toContain("Conversion 2");
        expect(document.getElementById("ta-convert-count").textContent).toBe("2");
    });

    it("renames, cancels and deletes a conversion in the page's dialog, and says when the server refuses", async () => {
        const converting = Object.assign({}, CONVERSION, {status: "converting", progress: 0.2});
        const C9 = "/api/conversions/9";
        const fetchFn = server({
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [converting]}),
            "/api/preferences": PREFERENCES,
            ["PATCH " + C9]: () => jsonResponse({name: ["Too long"]}, false),
            ["POST " + C9 + "/cancel"]: () => jsonResponse({error: "Already finished"}, false),
            ["DELETE " + C9]: () => jsonResponse({error: "Not allowed"}, false)
        });
        dataset.init(document, fetchFn);
        await ticks();
        const act = a => click(document.querySelector('.ta-conversion[data-id="9"] button[data-act="' + a + '"]'));
        const message = () => document.getElementById("ta-convert-message").textContent;
        expect(document.querySelector('button[data-act="delete"]').getAttribute("aria-label")).toBe("Delete " + CONVERSION.name);

        act("rename");
        document.getElementById("ta-ask-field").value = "New name";
        press("Rename");
        await ticks();
        expect(JSON.parse(fetchFn.mock.calls.find(c => c[1] && c[1].method === "PATCH")[1].body)).toEqual({name: "New name"});
        expect(message()).toContain("Too long");

        act("cancel");
        await ticks();
        expect(message()).toContain("Already finished");

        act("delete");
        expect(askDialog().textContent).toContain("Delete " + CONVERSION.name + " and its files?");
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("DELETE " + C9);
        act("delete");
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + C9);
        expect(message()).toContain("Not allowed");
    });

    it("refuses incomplete settings before sending them", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: []}),
                                "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await flush();
        [].forEach.call(form().querySelectorAll('input[name="output"]'), c => { c.checked = false; });
        click(document.getElementById("ta-convert-start"));
        expect(document.getElementById("ta-convert-message").textContent).toMatch(/at least one output/);
        input("distance_mode").value = "fixed";
        change(input("distance_mode"));
        expect(input("distance").hidden).toBe(false);
        expect(calls(fetchFn).some(c => c.indexOf("POST") === 0)).toBe(false);
    });

});

describe("a conversion's mosaics on the dataset page", () => {
    beforeEach(() => { document.body.innerHTML = page("dataset.html"); });
    const URL5 = "/api/datasets/5";

    it("says how the mosaics are going, and only when there is something to say", () => {
        const html = c => conversions.mosaicHtml(Object.assign({}, CONVERSION, c));
        expect(html({mosaic_status: "building", mosaic_progress: 0})).toContain("Building the mosaics…");
        expect(html({mosaic_status: "building", mosaic_progress: 0.1, stage: {stage: "composite", step: 4, steps: 6, done: 3, total: 42, unit: "frames"}}))
            .toContain("Building the mosaics: step 4 of 6, compositing, 3/42 frames…");
        expect(html({mosaic_status: "failed", mosaic_error: "No frames to mosaic."})).toContain("The mosaics failed: No frames to mosaic.");
        expect(html({mosaic_status: ""})).toContain("No mosaics.");
        expect(html({})).toBe("");
        expect(html({status: "failed", mosaic_status: ""})).toBe("");
    });

    it("gives each conversion one main action by its state, and the rest in its menu", () => {
        const viewer = "/conversion/", base = "/api/conversions/";
        const actions = c => {
            const el = document.createElement("div");
            el.innerHTML = conversions.actionsHtml(Object.assign({}, CONVERSION, c), base, null, viewer, null);
            const main = el.firstElementChild;
            return {main: main.classList.contains("ta-menu") ? null : main,
                    items: [...el.querySelectorAll(".dropdown-menu > li > *")].map(i => i.getAttribute("data-act") || i.getAttribute("href"))};
        };
        let a = actions({});
        expect(a.main.getAttribute("href")).toBe(viewer + "9");
        expect(a.items).toEqual([viewer + "9/frame", viewer + "9/compare", base + "9/download", "files", "use", "rename", "delete"]);
        a = actions({mosaic_status: ""});
        expect(a.main.getAttribute("href")).toBe(viewer + "9/frame");
        expect(a.items).toContain("mosaics");
        expect(actions({mosaic_status: "failed"}).items).toContain("mosaics");
        expect(actions({mosaic_status: "building"}).main.getAttribute("data-act")).toBe("cancel");
        expect(actions({status: "converting"}).main.getAttribute("data-act")).toBe("cancel");
        expect(actions({status: "failed", mosaic_status: ""}).main.getAttribute("data-act")).toBe("use");
        expect(actions({status: "canceled", mosaic_status: "", file_count: 0}).items).toEqual(["files", "rename", "delete"]);
    });

    it("builds the mosaics of a conversion without them, and polls until they are built", async () => {
        jest.useFakeTimers();
        const without = Object.assign({}, CONVERSION, {mosaic_status: "", mosaic_files: []});
        const building = Object.assign({}, CONVERSION, {mosaic_status: "building", mosaic_progress: 0});
        const fetchFn = server({
            [URL5]: [Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [without]}),
                     Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [building]}),
                     Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION]})],
            "/api/preferences": PREFERENCES,
            "POST /api/conversions/9/mosaics": building
        });
        dataset.init(document, fetchFn);
        await ticks();
        const list = document.getElementById("ta-conversions");
        click(list.querySelector('button[data-act="mosaics"]'));
        await ticks();
        expect(calls(fetchFn)).toContain("POST /api/conversions/9/mosaics");
        expect(list.innerHTML).toContain("Building the mosaics");
        expect(list.querySelector('button[data-act="cancel"]')).not.toBe(null);
        jest.runOnlyPendingTimers();
        await ticks();
        expect(list.innerHTML).toContain("View mosaics");
    });

    it("opens the Convert tab when the viewer links back to it", async () => {
        window.location.hash = "#convert";
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION]}),
                                "/api/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await flush();
        window.location.hash = "";
        expect(document.getElementById("ta-tab-convert").hidden).toBe(false);
        expect(document.getElementById("ta-tab-files").hidden).toBe(true);
    });

    it("reads the mosaics option from the form, on by default", () => {
        document.body.innerHTML = '<div id="f">' + conversions.formHtml(DEFAULTS, PREFERENCES, {}) + "</div>";
        const box = document.querySelector('#f input[name="mosaics"]');
        expect(box.checked).toBe(true);
        box.checked = false;
        expect(conversions.readForm(document.getElementById("f")).mosaics).toBe(false);
    });

    it("lists the mosaic files with the conversion's files", () => {
        const html = conversions.resultsHtml(Object.assign({}, CONVERSION, {results: {files: [{path: "a_T.JPG", ok: true, outputs: ["a.tiff"], notes: []}]}}),
                                             "/api/conversions/");
        expect(html).toContain('download?file=mosaics%2Fharmonized%2Fmosaic_temp_c.tif');
        expect(html).toContain(">harmonized/mosaic_temp_c.tif<");
    });
});

// A Leaflet stand-in that records the layers' URLs, the shapes drawn and each map's handlers (L.handlers: the last map's)
function fakeLeaflet() {
    const L = {layers: [], images: [], maps: [], shapes: [], handlers: {}};
    const addable = o => Object.assign(o, {addTo: jest.fn(g => { if (g && g.items) g.items.push(o); return o; })});
    L.map = jest.fn(el => {
        // Each event's handlers (all of them, as Leaflet calls them), called together
        const handlers = {}, listeners = {};
        const on = (ev, fn) => {
            (listeners[ev] = listeners[ev] || []).push(fn);
            handlers[ev] = e => listeners[ev].forEach(f => f(e));
        };
        // 400 × 300 pixels, 5 cm each; a latlng [lat, lng] is at x = lng, y = lat on the map
        const m = {handlers, on, fitBounds: jest.fn(), setView: jest.fn(), removeLayer: jest.fn(),
                   getCenter: () => [0, 0], getZoom: () => 0, invalidateSize: jest.fn(),
                   doubleClickZoom: {enable: jest.fn(), disable: jest.fn()}, dragging: {enable: jest.fn(), disable: jest.fn()},
                   getContainer: () => el, getSize: () => ({x: 400, y: 300}), containerPointToLatLng: p => [p[1], p[0]],
                   distance: (a, b) => Math.abs(b[1] - a[1]) * 0.05, latLngToContainerPoint: ll => ({x: ll[1], y: ll[0]})};
        L.maps.push(m);
        L.handlers = handlers;
        return m;
    });
    L.CRS = {Simple: {}};
    L.tileLayer = jest.fn((url, opts) => {
        const tiles = document.createElement("div");
        tiles.appendChild(loadedImage());
        const layer = addable({urls: [url], opts, setUrl: u => layer.urls.push(u), getContainer: () => tiles});
        L.layers.push(layer);
        return layer;
    });
    L.tileLayer.wms = jest.fn(() => addable({}));
    L.imageOverlay = jest.fn((url, bounds) => {
        const el = loadedImage();
        const image = addable({urls: [url], bounds, setUrl: u => image.urls.push(u), setBounds: b => { image.bounds = b; }, getElement: () => el});
        L.images.push(image);
        return image;
    });
    L.layerGroup = () => addable({items: [], clearLayers() { this.items.length = 0; }});
    const shape = kind => (where, opts) => {
        const o = addable({kind, where, opts, handlers: {}, bindTooltip: jest.fn(), setStyle: jest.fn(), bringToFront: jest.fn(),
                              setLatLng: jest.fn(ll => { o.where = ll; return o; })});
        o.on = (ev, fn) => { o.handlers[ev] = fn; return o; };
        L.shapes.push(o);
        return o;
    };
    L.circleMarker = shape("circle");
    L.polyline = shape("line");
    L.polygon = shape("polygon");
    // A custom control is added through its onAdd, as Leaflet does; L.controls keeps them
    L.controls = [];
    L.control = Object.assign(jest.fn(opts => {
        const c = {opts, addTo: jest.fn(m => { c.el = c.onAdd ? c.onAdd(m) : null; return c; })};
        L.controls.push(c);
        return c;
    }), {layers: () => addable({}), scale: () => addable({})});
    L.geoJSON = jest.fn((data, opts) => addable({data, opts, getBounds: () => ({isValid: () => true})}));
    L.latLngBounds = (a, b) => b === undefined ? a : [a, b];
    return L;
}

// An image as loaded (jsdom loads none)
function loadedImage() {
    const img = document.createElement("img");
    Object.defineProperty(img, "naturalWidth", {value: 256});
    Object.defineProperty(img, "complete", {value: true});
    return img;
}

// jsdom has no canvas: what is drawn on one is recorded ([what, ...arguments]), and the PNG saved is the link clicked
function recordCanvas() {
    const drawn = [], saved = [];
    const g = new Proxy({}, {
        get: (t, k) => t[k] || (t[k] = (...a) => {
            drawn.push([k, ...a]);
            if (k === "createLinearGradient") return {addColorStop: (...stop) => drawn.push(["addColorStop", ...stop])};
        }),
        set: (t, k, value) => { drawn.push([k, value]); return true; }
    });
    const spies = [jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(g),
                   jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { saved.push(this.download); })];
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(["png"])); };
    URL.createObjectURL = jest.fn(() => "blob:png");
    URL.revokeObjectURL = jest.fn();
    const texts = () => drawn.filter(d => d[0] === "fillText").map(d => d[1]);
    return {drawn, saved, texts, restore: () => spies.forEach(s => s.mockRestore())};
}

describe("the mosaic viewer", () => {
    const BASE = "/api/conversions/9";
    const TAB = (tab, stats) => ({tab, kind: tab === "harmonized" ? "harmonized" : "as_converted", bounds: [-88.1, 42.1, -88.0, 42.2],
                                  minzoom: 19, maxzoom: 22, stats});
    const KIND = {frames: 42, oblique: 175, unusable: 0, width: 1370, height: 1640, gsd_m: 0.021, normalization: null,
                  files: ["mosaics/as_converted/mosaic_temp_c.tif"],
                  report: {radiometric_seams: {pixels: 10, median_abs_c: 0.298, p95_abs_c: 2.748},
                           misalignment: {pairs: 458, median_m: 0.077, p90_m: 0.478},
                           frame_offsets: {offset_c: {min: -0.362, max: 1.761}, normalized: false,
                                           overlap_difference_c: {median_abs: 0.292, median_abs_after_offsets: 0.247}}}};
    const VIEW = Object.assign({}, CONVERSION, {
        unit: "C", stripped: false, frames: ["thermal/a_T.JPG", "thermal/b_T.JPG"],
        tabs: [TAB("as_converted", {min: 5.6, max: 32.9, percentiles: [15.43, 26.08]}),
               TAB("harmonized", {min: 5.6, max: 32.9, percentiles: [15.51, 25.65]}),
               TAB("source_frame", null), TAB("view_angle", {min: 0, max: 22.5, percentiles: [0.9, 19.83]})],
        kinds: {as_converted: KIND, harmonized: Object.assign({}, KIND, {normalization: [27.1, 27.1]})},
        palettes: [{key: "dji_ironred", label: "DJI ironred", color_map: [0x000000ff, 0xffffffff]},
                   {key: "magma", label: "Magma", color_map: [0x000000ff, 0xff0000ff]},
                   {key: "viridis", label: "Viridis", color_map: [0x440154ff, 0xfde725ff]}],
        default_palette: "dji_ironred", frame_colors: [0xff0000ff, 0x00ff00ff, 0x0000ffff]
    });

    const WHOLE = {unit: "C", approximate: false, result: {kind: "mosaic", valid_pixels: 1000, mean: 20.8, min: 5.6, max: 32.9,
                   percentiles: [15.51, 25.65], histogram: [[1, 3, 1], [5, 15, 25, 35]]}};
    const ANALYSIS_ROUTES = {["POST " + BASE + "/measure"]: WHOLE, [BASE + "/measurements"]: {measurements: []}};
    const mosaicLayer = L => L.layers[L.layers.length - 1];
    const lastUrl = L => { const u = mosaicLayer(L).urls; return u[u.length - 1]; };

    beforeEach(() => { document.body.innerHTML = page("viewer.html"); });

    it("works out ranges, tile URLs and legends", () => {
        expect(viewer.defaultRange(VIEW.tabs[0])).toEqual([15.4, 26.1]);
        expect(viewer.defaultRange({stats: null})).toEqual([0, 1]);
        expect(viewer.parseRange("20", "10").error).toMatch(/above the minimum/);
        expect(viewer.parseRange("", "10").error).toMatch(/minimum and a maximum/);
        expect(viewer.parseRange("10", "20.5").range).toEqual([10, 20.5]);
        expect(viewer.tileUrl("/api/", 9, "harmonized", {palette: "dji_ironred", range: [15, 26]}))
            .toBe("/api/conversions/9/mosaics/harmonized/tiles/{z}/{x}/{y}?color_map=dji_ironred&rescale=15,26");
        expect(viewer.tileUrl("/api/", 9, "source_frame", {})).toBe("/api/conversions/9/mosaics/source_frame/tiles/{z}/{x}/{y}");
        expect(viewer.gradientCss([0x000000ff, 0xffffffff])).toMatch(/^linear-gradient\(to right, rgb\(0,0,0\), .*rgb\(255,255,255\)\)$/);
        expect(viewer.styleGroup("harmonized")).toBe(viewer.styleGroup("as_converted"));
        // The range is kept in the conversion's unit and shown in the user's (°C here)
        expect(viewer.shownRange("as_converted", [32, 212], "F")).toEqual([0, 100]);
        expect(viewer.shownRange("view_angle", [1, 20], "F")).toEqual([1, 20]);
    });

    it("puts round temperatures on the colour scale", () => {
        const ticks = viewer.scaleTicks(15.4, 26.1, 5);
        expect(ticks.map(t => t.label)).toEqual(["17.5", "20.0", "22.5", "25.0"]);
        ticks.forEach(t => { expect(t.at).toBeGreaterThanOrEqual(0); expect(t.at).toBeLessThanOrEqual(1); });
        expect(viewer.scaleTicks(0.12, 0.31, 4).map(t => t.label)).toEqual(["0.15", "0.20", "0.25", "0.30"]);
        expect(viewer.scaleTicks(-2, 2, 4).map(t => t.label)).toEqual(["-2", "-1", "0", "1", "2"]);
        const html = viewer.legendHtml([0x000000ff, 0xffffffff], [15.4, 26.1], "Temperature, °C");
        expect(html).toContain('class="ta-legend-caption">Temperature, °C<');
        expect(html).toContain("linear-gradient");
        expect(html).toContain('<span class="ta-tick" style="left: 19.6%;">17.5</span>');
        expect(viewer.legendHtml(null, [0, 1])).toBe("");
        expect(viewer.styleGroup("view_angle")).not.toBe(viewer.styleGroup("as_converted"));
    });

    it("words when the frames were taken, a scale bar's length and a file name for the image", () => {
        expect(viewer.takenText(["2026:09:18 09:02:10", "2026:09:18 08:44:42", ""])).toBe("2026-09-18 08:44–09:02");
        expect(viewer.takenText(["2026:09:18 23:58:00", "2026:09:19 00:03:00"])).toBe("2026-09-18 23:58 – 2026-09-19 00:03");
        expect(viewer.takenText(["2026:09:18 08:44:42"])).toBe("2026-09-18 08:44");
        expect(viewer.takenText(["not a time"])).toBe("");
        expect(viewer.takenText(undefined)).toBe("");
        expect(viewer.scaleBar(0.05, 120)).toEqual({px: 100, label: "5 m"});
        expect(viewer.scaleBar(0.3, 120)).toEqual({px: 20 / 0.3, label: "20 m"});
        expect(viewer.scaleBar(10, 120)).toEqual({px: 100, label: "1 km"});
        expect(viewer.scaleBar(0.001, 120).label).toBe("0.1 m");
        expect(viewer.scaleBar(0, 120)).toBe(null);
        expect(viewer.fileName(["Roof east", "Flight 3", "As converted"], ".png")).toBe("Roof_east-Flight_3-As_converted.png");
        expect(viewer.fileName(["", "..."], ".png")).toBe("view.png");
    });

    it("exports the mosaic as shown as a PNG: its tiles, its saved measurements, the colour scale, a title, the date and a scale bar", async () => {
        const L = fakeLeaflet();
        const SAVED = [{id: 1, name: "Hot spot", target: "as_converted", geometry: {type: "Point", coordinates: [120, 80]}, values: {}},
                       {id: 2, name: "Roof", target: "as_converted", geometry: {type: "Polygon", coordinates: [[[10, 10], [50, 10], [50, 40], [10, 10]]]}, values: {}},
                       {id: 3, name: "Elsewhere", target: "harmonized", geometry: {type: "Point", coordinates: [1, 1]}, values: {}}];
        const fetchFn = server(Object.assign({}, ANALYSIS_ROUTES, {
            [BASE + "/mosaics"]: Object.assign({}, VIEW, {dataset_name: "Roof east", flown: ["2026:09:18 08:44:42", "2026:09:18 09:02:10"]}),
            [BASE + "/measurements"]: {measurements: SAVED}}));
        await viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        const png = document.getElementById("ta-viewer-png");
        expect(png.hidden).toBe(false);
        const canvas = recordCanvas();
        try {
            click(png);
            expect(canvas.saved).toEqual(["Roof_east-Nadir-As_converted.png"]);
            const texts = canvas.texts();
            expect(texts[0]).toBe("Roof east · " + VIEW.name + " · As converted");
            expect(texts[1]).toMatch(/^Flown 2026-09-18 08:44–09:02 · exported \d{4}-\d\d-\d\d$/);
            // The mosaic's tiles, not the basemap's
            expect(canvas.drawn.filter(d => d[0] === "drawImage").length).toBe(1);
            // The measurements saved on this tab, named, where they are on the map
            expect(texts).toContain("Hot spot");
            expect(texts).toContain("Roof");
            expect(texts).not.toContain("Elsewhere");
            expect(canvas.drawn).toContainEqual(["arc", 120, 80, 6, 0, 2 * Math.PI]);
            // 5 m across 100 pixels, and the colour scale's caption and ticks
            expect(texts).toContain("5 m");
            expect(canvas.drawn).toContainEqual(["lineTo", 112, expect.any(Number)]);
            expect(texts).toEqual(expect.arrayContaining(["Temperature, °C", "17.5", "20.0", "22.5", "25.0"]));
            expect(canvas.drawn.filter(d => d[0] === "addColorStop").length).toBe(16);
        } finally {
            canvas.restore();
        }
    });

    it("describes the values under the cursor and the mosaic's report", () => {
        expect(viewer.readoutHtml({valid: true, temperature: 23.072, frame: "thermal/b_T.JPG", view_angle: 4.27}, "C"))
            .toMatch(/23\.07 °C.*thermal\/b_T\.JPG.*4\.3°/);
        // The frame's pixel the point was read from, when the mosaic keeps it
        expect(viewer.readoutHtml({valid: true, temperature: 23, frame: "thermal/b_T.JPG", frame_pixel: [312, 7], view_angle: 4}, "C"))
            .toMatch(/b_T\.JPG.*Frame pixel.*x 312, y 7.*View angle/);
        expect(viewer.readoutHtml({valid: true, temperature: 23, frame: "thermal/b_T.JPG", frame_pixel: null}, "C")).not.toContain("Frame pixel");
        expect(viewer.readoutHtml({valid: false, reason: "outside_raster"}, "C")).toContain("Outside the mosaic");
        expect(viewer.readoutHtml({valid: false, reason: "nodata"}, "C")).toContain("No data here");
        const report = viewer.reportHtml(KIND);
        expect(report).toContain("42 placed, 175 oblique left out");
        expect(report).toContain("median 0.30 °C, 95% under 2.75 °C");
        expect(report).toContain("median 7.7 cm, 90% under 47.8 cm (458 overlapping pairs)");
        expect(report).toContain("-0.36 to 1.76 °C");
        expect(viewer.reportHtml(Object.assign({}, KIND, {normalization: [27.1, 27.2]}))).toContain("ambient 27.1 °C");
        // The surface the frames were projected onto: heights measured from their parallax, a DSM, or a plane
        const heights = h => viewer.reportHtml(Object.assign({}, KIND, {report: {heights: h}}));
        expect(heights({method: "parallax between overlapping frames", cell_m: 1.344, cells: 525, observed_cells: 171,
                        range_m: [-0.5, 6.01]})).toContain("-0.5 to 6.0 m above the ground plane, measured in 171 of 525 cells of 1.3 m");
        expect(heights({method: "DSM", file: "dsm.tif", cell_m: 1.3, cells: 525, observed_cells: 525, range_m: [0, 5.5]}))
            .toContain("0.0 to 5.5 m above the ground plane, from the DSM dsm.tif");
        expect(heights({method: "plane", reason: "not asked for"})).toContain("a ground plane (not asked for)");
        expect(viewer.reportHtml(KIND)).not.toContain("Heights");
        expect(viewer.statusHtml({status: "ready", mosaic_status: "building", mosaic_progress: 0.6}).text).toContain("Building the mosaics…");
        const building = viewer.statusHtml({status: "ready", mosaic_status: "building", mosaic_progress: 0.72,
            stage: {stage: "check", step: 6, steps: 7, done: 5, total: 9, unit: "pairs"}}).text;
        expect(building).toContain('style="width: 72%;"');
        expect(building).toContain("Building the mosaics: step 6 of 7, checking alignment, 5/9 pairs…");
        expect(viewer.statusHtml({status: "ready", mosaic_status: "failed", mosaic_error: "boom"}).text).toContain("failed: boom");
        expect(viewer.statusHtml({status: "ready", mosaic_status: ""}).text).toContain("no mosaics");
        expect(viewer.statusHtml({status: "ready", mosaic_status: "ready"}).text).toBe("");
    });

    it("shows a tab per mosaic, with the palette and range changed live", async () => {
        const L = fakeLeaflet();
        const fetchFn = server(Object.assign({[BASE + "/mosaics"]: VIEW}, ANALYSIS_ROUTES));
        await viewer.init({doc: document, fetchFn, L, basemaps: [{label: "OSM", url: "https://t/{z}/{x}/{y}.png", "default": true}]});
        expect(document.getElementById("ta-viewer-main").hidden).toBe(false);
        expect(document.getElementById("ta-viewer-tabs").textContent).toBe("As convertedHarmonizedSource frameView angle");
        expect(lastUrl(L)).toBe("/api/conversions/9/mosaics/as_converted/tiles/{z}/{x}/{y}?color_map=dji_ironred&rescale=15.4,26.1");
        expect(mosaicLayer(L).opts.maxNativeZoom).toBe(23);
        // The colour scale, on the map and in the panel, in the user's unit
        const mapScale = () => L.controls[0].el;
        expect(L.controls[0].opts.position).toBe("bottomright");
        expect(mapScale().hidden).toBe(false);
        expect(mapScale().textContent).toBe("Temperature, °C17.520.022.525.0");
        expect(document.getElementById("ta-viewer-scale").textContent).toBe("17.520.022.525.0");

        // A new palette and range redraw the layer, without reloading the page's data
        const palette = document.getElementById("ta-viewer-palette");
        palette.value = "magma";
        change(palette);
        expect(lastUrl(L)).toContain("color_map=magma&rescale=15.4,26.1");
        document.getElementById("ta-viewer-min").value = "18";
        change(document.getElementById("ta-viewer-min"));
        expect(lastUrl(L)).toContain("rescale=18,26.1");
        // The scales follow the range
        expect(mapScale().textContent).toBe("Temperature, °C1820222426");
        expect(document.getElementById("ta-viewer-scale").textContent).toBe("1820222426");
        const urls = mosaicLayer(L).urls.length;
        document.getElementById("ta-viewer-max").value = "10";
        change(document.getElementById("ta-viewer-max"));
        expect(document.getElementById("ta-viewer-range-error").textContent).toMatch(/above the minimum/);
        expect(mosaicLayer(L).urls.length).toBe(urls);

        // The harmonized mosaic keeps the same scale, to compare; the view angles have their own
        click(document.querySelector('a[data-tab="harmonized"]'));
        expect(lastUrl(L)).toContain("/harmonized/tiles/{z}/{x}/{y}?color_map=magma&rescale=18,26.1");
        expect(document.getElementById("ta-viewer-report").textContent).toContain("ambient 27.1 °C");
        click(document.querySelector('a[data-tab="view_angle"]'));
        expect(lastUrl(L)).toContain("/view_angle/tiles/{z}/{x}/{y}?color_map=viridis&rescale=0.9,19.9");
        expect(mapScale().textContent).toBe("View angle, °51015");
        click(document.querySelector('a[data-tab="source_frame"]'));
        expect(lastUrl(L)).toBe("/api/conversions/9/mosaics/source_frame/tiles/{z}/{x}/{y}");
        expect(document.getElementById("ta-viewer-palette")).toBe(null);
        expect(mapScale().hidden).toBe(true);

        click(document.querySelector('a[data-tab="as_converted"]'));
        await ticks();
        click(document.getElementById("ta-viewer-auto"));
        // Auto: the whole mosaic's percentiles, as measured (with the correction, when there is one)
        expect(lastUrl(L)).toContain("rescale=15.5,25.7");
        expect(calls(fetchFn).filter(c => c === "GET " + BASE + "/mosaics").length).toBe(1);
    });

    it("works out how the image is drawn: the adjustments' query, the sliders' range and the legend's curve", () => {
        expect(viewer.adjustQuery({gamma: 1.5, equalize: true, sharpen: 2})).toBe("&gamma=1.5&equalize=1&sharpen=2");
        expect(viewer.adjustQuery(viewer.defaultAdjust())).toBe("");
        expect(viewer.tileUrl("/api/", 9, "harmonized", {palette: "magma", range: [15, 26], adjust: {gamma: 2, equalize: false, sharpen: 1}}))
            .toBe("/api/conversions/9/mosaics/harmonized/tiles/{z}/{x}/{y}?color_map=magma&rescale=15,26&gamma=2&sharpen=1");
        // Brightness moves the range down by a share of its width, contrast halves it per step
        expect(viewer.slidRange([10, 20], 0.5, 1)).toEqual([7.5, 12.5]);
        expect(viewer.slidRange([10, 20], 0, 0)).toEqual([10, 20]);
        expect(viewer.sliderPositions([10, 20], [7.5, 12.5])).toEqual({brightness: 0.5, contrast: 1});
        expect(viewer.sliderPositions([10, 20], [100, 101])).toEqual({brightness: -1, contrast: 2});
        // The gamma slider is in powers of two, within 0.2 to 5
        expect([viewer.sliderGamma(0), viewer.sliderGamma(1), viewer.sliderGamma(-5)]).toEqual([1, 2, 0.2]);
        const tone = viewer.toneShares(2);
        expect([tone.length, tone[0], tone[16], tone[64]]).toEqual([65, 0, 0.5, 1]);
        // The legend's gradient bends with the shares: a stop per share, else 16 evenly
        const grey = Array.from({length: 256}, (x, i) => ((i << 24) | (i << 16) | (i << 8) | 0xff) >>> 0);
        expect(viewer.gradientStops(grey, [0, 0.25, 1])).toEqual(["rgb(0,0,0)", "rgb(64,64,64)", "rgb(255,255,255)"]);
        expect(viewer.gradientStops(grey).length).toBe(16);
        expect(viewer.legendHtml(grey, [0, 10], "", [0, 0.25, 1])).toContain("linear-gradient(to right, rgb(0,0,0), rgb(64,64,64), rgb(255,255,255))");
        // Equalization only for temperatures
        const html = viewer.imageHtml({gamma: 2, equalize: true, sharpen: 1}, {brightness: 0.5, contrast: 1}, true);
        document.body.innerHTML = html;
        expect(document.getElementById("ta-image-brightness").value).toBe("0.5");
        expect(document.getElementById("ta-image-gamma").value).toBe("1");
        expect(document.getElementById("ta-image-gamma-value").textContent).toBe("2.00");
        expect(document.getElementById("ta-image-tone").value).toBe("equalized");
        expect(viewer.imageHtml(viewer.defaultAdjust(), {brightness: 0, contrast: 0}, false)).not.toContain("equalized");
    });

    it("draws the image brighter, with more contrast, gamma, sharpening or equalization, and resets it", async () => {
        const L = fakeLeaflet();
        const CURVE = BASE + "/mosaics/as_converted/curve?rescale=10.4,20.6&gamma=2&equalize=1";
        const fetchFn = server(Object.assign({[BASE + "/mosaics"]: VIEW, [CURVE]: {shares: [0, 0.9, 1]}}, ANALYSIS_ROUTES));
        await viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        const $ = id => document.getElementById(id), mapScale = () => L.controls[0].el.innerHTML;
        expect($("ta-viewer-image-section").hidden).toBe(false);
        expect($("ta-image-tone").textContent).toBe("LinearEqualized");

        // Dragging a slider shows the range and legend as it goes, and redraws when let go
        const plain = mapScale(), urls = mosaicLayer(L).urls.length;
        $("ta-image-gamma").value = "1";
        input($("ta-image-gamma"));
        expect($("ta-image-gamma-value").textContent).toBe("2.00");
        expect(mapScale()).not.toBe(plain);
        expect(mosaicLayer(L).urls.length).toBe(urls);
        change($("ta-image-gamma"));
        expect(lastUrl(L)).toContain("&gamma=2");
        // Brightness and contrast move the range from Auto's (the whole mosaic's 15.5 to 25.7)
        $("ta-image-brightness").value = "0.5";
        input($("ta-image-brightness"));
        expect([$("ta-viewer-min").value, $("ta-viewer-max").value]).toEqual(["10.4", "20.6"]);
        change($("ta-image-brightness"));
        expect(lastUrl(L)).toContain("rescale=10.4,20.6&gamma=2");
        $("ta-image-sharpen").value = "1.5";
        input($("ta-image-sharpen"));
        expect($("ta-image-sharpen-value").textContent).toBe("1.5");
        change($("ta-image-sharpen"));
        expect(lastUrl(L)).toContain("&gamma=2&sharpen=1.5");
        $("ta-image-sharpen").value = "0";
        change($("ta-image-sharpen"));

        // Equalized: the legend bends as the server's curve says
        $("ta-image-tone").value = "equalized";
        change($("ta-image-tone"));
        await ticks();
        expect(lastUrl(L)).toContain("rescale=10.4,20.6&gamma=2&equalize=1");
        expect(calls(fetchFn)).toContain("GET " + CURVE);
        expect(mapScale()).toContain("linear-gradient(to right, rgb(0,0,0), rgb(230,230,230), rgb(255,255,255))");

        // The view angles have their own adjustments, and no equalization; the frames' tab none at all
        click(document.querySelector('a[data-tab="view_angle"]'));
        expect(lastUrl(L)).not.toContain("gamma");
        expect($("ta-image-tone").textContent).toBe("Linear");
        click(document.querySelector('a[data-tab="source_frame"]'));
        expect($("ta-viewer-image-section").hidden).toBe(true);
        click(document.querySelector('a[data-tab="as_converted"]'));
        expect(lastUrl(L)).toContain("&gamma=2&equalize=1");

        click($("ta-image-reset"));
        expect(lastUrl(L)).toBe(BASE + "/mosaics/as_converted/tiles/{z}/{x}/{y}?color_map=dji_ironred&rescale=15.5,25.7");
        expect($("ta-image-tone").value).toBe("linear");
        // The legend straight again (its ticks at Auto's range, not the one the page opened with)
        const gradient = html => html.match(/linear-gradient\([^;]*\)/)[0];
        expect(gradient(mapScale())).toBe(gradient(plain));
    });

    it("reads the values under the cursor", async () => {
        jest.useFakeTimers();
        const L = fakeLeaflet();
        const fetchFn = server(Object.assign({
            [BASE + "/mosaics"]: VIEW,
            [BASE + "/mosaics/as_converted/point?lon=-88.05&lat=42.15"]: {valid: true, temperature: 21.5, frame: "thermal/a_T.JPG", view_angle: 2}
        }, ANALYSIS_ROUTES));
        viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        L.handlers.mousemove({latlng: {lng: -88.04, lat: 42.14}});
        L.handlers.mousemove({latlng: {lng: -88.05, lat: 42.15}});
        jest.runOnlyPendingTimers();
        await ticks();
        // Only where the cursor rested
        expect(calls(fetchFn).filter(c => c.indexOf("/point") > 0).length).toBe(1);
        expect(document.getElementById("ta-viewer-readout").textContent).toContain("21.50 °C");
        L.handlers.mouseout();
        expect(document.getElementById("ta-viewer-readout").textContent).toContain("Move the cursor");
    });

    it("builds missing mosaics and follows them until they are built", async () => {
        jest.useFakeTimers();
        const L = fakeLeaflet();
        const fetchFn = server(Object.assign({
            [BASE + "/mosaics"]: [Object.assign({}, VIEW, {mosaic_status: "", tabs: []}),
                                  Object.assign({}, VIEW, {mosaic_status: "building", mosaic_progress: 0, tabs: []}), VIEW],
            ["POST " + BASE + "/mosaics"]: Object.assign({}, CONVERSION, {mosaic_status: "building"})
        }, ANALYSIS_ROUTES));
        viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        expect(document.getElementById("ta-viewer-main").hidden).toBe(true);
        expect(document.getElementById("ta-viewer-status").textContent).toContain("no mosaics");
        click(document.getElementById("ta-viewer-build"));
        await ticks();
        expect(document.getElementById("ta-viewer-status").textContent).toContain("Building the mosaics");
        expect(document.getElementById("ta-viewer-cancel").hidden).toBe(false);
        jest.runOnlyPendingTimers();
        await ticks();
        expect(document.getElementById("ta-viewer-main").hidden).toBe(false);
        expect(L.map).toHaveBeenCalledTimes(1);
    });

});

describe("measuring", () => {
    const AREA = {kind: "Polygon", area: 11.45, perimeter: 13.68, valid_pixels: 26308, min: 10.83, max: 26.91, mean: 23.2,
                  std: 1.41, surroundings: 22.68, delta_t: 0.51, isotherm: {pixels: 1679, share: 0.0638},
                  histogram: [[2, 5, 1], [10, 15, 20, 27]], min_location: [-88.07, 42.1], max_location: [-88.06, 42.1]};

    it("turns what is drawn into the geometry the API takes", () => {
        expect(measure.geometryOf("point", [[1, 2]])).toEqual({type: "Point", coordinates: [1, 2]});
        expect(measure.geometryOf("line", [[1, 2]])).toBe(null);
        expect(measure.geometryOf("line", [[1, 2], [3, 4]])).toEqual({type: "LineString", coordinates: [[1, 2], [3, 4]]});
        expect(measure.geometryOf("area", [[0, 0], [1, 0]])).toBe(null);
        expect(measure.geometryOf("area", [[0, 0], [1, 0], [1, 1]]).coordinates[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
    });

    it("checks an isotherm and names it", () => {
        expect(measure.isothermParam("", "", "")).toEqual({value: ""});
        expect(measure.isothermParam("above", "25", "")).toEqual({value: "above,25"});
        expect(measure.isothermParam("above", "", "").error).toMatch(/needs a temperature/);
        expect(measure.isothermParam("between", "20", "18").error).toMatch(/above the first/);
        expect(measure.isothermParam("between", "18", "20")).toEqual({value: "between,18,20"});
        expect(measure.isothermText("between,18,20", "C")).toBe("between 18 and 20 °C");
    });

    describe("in the user's temperature unit", () => {
        afterEach(() => { delete window.__temperatureUnit; });

        it("takes an isotherm typed in the user's unit and sends it in the conversion's", () => {
            window.__temperatureUnit = "F";
            expect(measure.isothermParam("above", "77", "", "C")).toEqual({value: "above,25"});
            expect(measure.isothermParam("between", "32", "212", "K")).toEqual({value: "between,273.15,373.15"});
            expect(measure.isothermText("between,18,20", "C")).toBe("between 64.4 and 68 °F");
            expect(measure.isothermHtml({mode: "above", a: 77})).toContain("<span>°F</span>");
        });

        it("shows a measure's temperatures in the user's unit, its differences scaled but not shifted", () => {
            window.__temperatureUnit = "F";
            const html = measure.resultHtml({result: AREA}, "C");
            expect(html).toMatch(/Mean<\/th><td>73\.76 °F/);
            expect(html).toMatch(/Std dev<\/th><td>2\.54 °F/);
            expect(html).toMatch(/ΔT<\/th><td>\+0\.92 °F/);
            expect(html).toContain("<span>50.0 °F</span><span>80.6 °F</span>");
            window.__temperatureUnit = "K";
            expect(measure.measurementsHtml([{id: 1, name: "Roof", target: "harmonized", values: {result: AREA}}], "C"))
                .toContain("296.3 K, ΔT +0.5 K");
        });
    });

    it("shows what an area measures, and a frame's figures side by side with the parameters changed", () => {
        const html = measure.resultHtml({result: AREA, unit: "C"}, "C");
        expect(html).toContain("11.45 m²");
        expect(html).toMatch(/Mean<\/th><td>23\.20 °C/);
        expect(html).toMatch(/ΔT<\/th><td>\+0\.51 °C/);
        expect(html).toContain("6.4 %");
        expect(html).toContain("<svg");
        expect(measure.resultHtml({result: AREA, approximate: true}, "C")).toContain("Approximate");
        const both = measure.resultHtml({result: Object.assign({}, AREA, {area: 100}),
                                         changed: Object.assign({}, AREA, {area: 100, mean: 23.7})}, "C", {pixels: true});
        expect(both).toContain("100 px²");
        expect(both).toContain("<th>Difference</th>");
        expect(both).toMatch(/Mean<\/th><td>23\.20 °C<\/td><td>23\.70 °C<\/td><td>\+0\.50 °C/);
        expect(measure.resultHtml({result: {valid_pixels: 0, reason: "outside_raster"}}, "C")).toContain("Outside the mosaic");
        // A spot: its value and mean, no min and max
        const spot = measure.resultHtml({result: {kind: "Point", value: 24.7, mean: 24.0, min: 1, max: 2, valid_pixels: 492}}, "C");
        expect(spot).toContain("At the spot");
        expect(spot).not.toContain("<th>Min</th>");
    });

    it("lists the saved measurements", () => {
        const items = [{id: 1, name: "Hot roof", target: "harmonized", values: {result: AREA}},
                       {id: 2, name: "Spot", target: "frame", frame: "thermal/a_T.JPG", values: {result: {kind: "Point", value: 18.7, mean: 18.8}}}];
        const html = measure.measurementsHtml(items, "C", 2);
        expect(html).toContain("Area · Harmonized");
        expect(html).toContain("23.2 °C, ΔT +0.5 °C");
        expect(html).toContain("Spot · Frame a_T.JPG");
        expect(html).toContain("18.7 °C");
        expect(html).toContain('class="active" data-measurement="2"');
        expect(html).toContain('data-delete="1"');
        expect(html).toContain('data-rename="1"');
        expect(measure.measurementsHtml([], "C")).toContain("No measurements saved yet");
    });

    const FIELDS = [["emissivity", "Emissivity", "0.01", false], ["reflected_temp", "Reflected temperature", "0.1", true]];

    it("compares two ticked measurements, a third ticked dropping the first", () => {
        expect(measure.toggleCompared([], 1, true)).toEqual([1]);
        expect(measure.toggleCompared([1, 2], 3, true)).toEqual([2, 3]);
        expect(measure.toggleCompared([1, 2], 1, false)).toEqual([2]);
        const items = [{id: 1, name: "Roof", target: "harmonized", values: {result: AREA}},
                       {id: 2, name: "Wall", target: "harmonized", values: {result: Object.assign({}, AREA, {mean: 25.2})}}];
        expect(measure.measurementsHtml(items, "C")).toContain("Tick two to compare them.");
        const html = measure.measurementsHtml(items, "C", null, {compared: [1, 2]});
        expect(html).toContain('data-compare="1" title="Compare" checked');
        expect(html).toContain("<th>Roof</th><th>Wall</th><th>Difference</th>");
        expect(html).toMatch(/Mean<\/th><td>23\.20 °C<\/td><td>25\.20 °C<\/td><td>\+2\.00 °C/);
        expect(html).not.toContain("Tick two");
    });

    it("names a measurement's own parameters and offers to measure it again with others", () => {
        expect(measure.paramsText({emissivity: 0.95, reflected_temp: 25}, FIELDS, "C")).toBe("emissivity 0.95, reflected temperature 25 °C");
        expect(measure.paramsText({}, FIELDS, "C")).toBe("");
        const m = {id: 3, name: "Roof", target: "harmonized", parameters: {emissivity: 0.95}, values: {result: AREA}};
        const listed = measure.measurementsHtml([m], "C", null, {fields: FIELDS});
        expect(listed).toContain("Measured with emissivity 0.95");
        expect(listed).toContain('data-params="3"');
        expect(listed).not.toContain("data-params-form");
        const form = measure.measurementsHtml([m], "C", null, {fields: FIELDS, editing: 3});
        expect(form).toContain('data-param-field="emissivity" value="0.95"');
        expect(form).toContain('data-param-field="reflected_temp" value=""');
        expect(form).toContain('data-params-act="save" data-id="3"');
    });

    it("lists a frame's measurement measured again by the figure measured with its parameters", () => {
        const m = {id: 4, name: "Wall", target: "frame", frame: "a.JPG", parameters: {emissivity: 0.7},
                   values: {result: AREA, changed: Object.assign({}, AREA, {mean: 18.5, delta_t: -1.5})}};
        const listed = measure.measurementsHtml([m], "C", null, {fields: FIELDS});
        expect(listed).toContain('<div class="ta-measurement-figure">18.5 °C, ΔT -1.5 °C</div>');
    });

    it("names a box or a circle by how it was drawn", () => {
        expect(measure.shapeLabel({kind: "Polygon"}, {kind: "box"})).toBe("Box");
        expect(measure.shapeLabel({kind: "Polygon"}, {kind: "circle", center: [0, 0], radius: 1})).toBe("Circle");
        expect(measure.shapeLabel({kind: "Polygon"})).toBe("Area");
        expect(measure.resultHtml({result: AREA, shape: {kind: "circle"}}, "C")).toContain('<div class="ta-result-kind">Circle</div>');
        expect(measure.boxCoords([0, 0], [2, 1])).toEqual([[0, 0], [2, 0], [2, 1], [0, 1]]);
        const flat = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
        const circle = measure.circleCoords([0, 0], [3, 4], flat);
        expect(circle.radius).toBe(5);
        expect(circle.coords.length).toBe(64);
        expect(circle.coords[0][0]).toBeCloseTo(5);
        expect(circle.coords[16][1]).toBeCloseTo(5);
        expect(measure.circleCoords([1, 1], [1, 1], flat)).toBe(null);
    });

    const PROFILE = {distance: [0, 5, 10], values: [20, null, 30], points: [[0, 0], [1, 0], [2, 0]],
                     frames: ["thermal/a_T.JPG", "thermal/a_T.JPG", null]};

    it("charts the temperature along a line, with its gaps, its hottest and coldest samples and its frames", () => {
        const svg = measure.profileSvg(PROFILE, "C");
        expect(svg).toContain('class="ta-profile-line" d="M0.0 77.0 M260.0 3.0"');
        expect(svg).toContain('class="ta-profile-max" cx="260.0"');
        expect(svg).toContain('class="ta-profile-min" cx="0.0"');
        expect(svg).toContain("<span>30.0 °C</span><span>20.0 °C</span>");
        expect(svg).toContain("<span>10.0 m</span>");
        expect(svg).toContain('class="ta-profile-frame-0" style="width: 66.67%" title="Frame a_T.JPG"');
        expect(svg).toContain('class="ta-profile-frame-none" style="width: 33.33%" title="No frame"');
        expect(measure.profileSvg(PROFILE, "C", {values: [21, 25, 31]}, true)).toContain("ta-profile-changed");
        expect(measure.profileSvg(PROFILE, "C", null, true)).toContain("<span>10 px</span>");
        expect(measure.profileSvg({distance: [0, 1], values: [null, null]}, "C")).toContain("No data along the line.");
        expect(measure.profileSvg({distance: [0], values: [20]}, "C")).toBe("");
        expect(measure.resultHtml({result: {kind: "LineString", valid_pixels: 2, mean: 25, min: 20, max: 30, profile: PROFILE}}, "C"))
            .toContain("ta-profile-line");
    });

    it("moves the profile's cursor with the mouse or to the sample nearest a point on the line", () => {
        expect(measure.nearestIndex(PROFILE.points, [1.8, 0.1], true)).toBe(2);
        // On a mosaic, a degree of longitude is shorter than one of latitude
        expect(measure.nearestIndex([[0, 60], [0.9, 60.6]], [0.9, 60], false)).toBe(0);
        expect(measure.nearestIndex([[0, 60], [0.9, 60.6]], [0.9, 60], true)).toBe(1);
        const res = {result: {kind: "LineString", valid_pixels: 2, mean: 25, profile: PROFILE}, changed: {profile: {values: [21, 25, 31]}}};
        const el = document.createElement("div");
        el.innerHTML = measure.resultHtml(res, "C");
        const onIndex = jest.fn();
        const linked = measure.linkProfile(el, res, "C", false, onIndex);
        const cursor = el.querySelector(".ta-profile-cursor"), readout = el.querySelector(".ta-profile-readout");
        linked.show(2);
        expect(cursor.getAttribute("x1")).toBe("260.0");
        expect(cursor.getAttribute("visibility")).toBe("visible");
        expect(readout.textContent).toBe("10.0 m · 30.00 °C · changed 31.00 °C");
        linked.near([1.1, 0]);
        expect(readout.textContent).toBe("5.0 m · no data · changed 25.00 °C · a_T.JPG");
        // jsdom lays nothing out: the chart is 0 wide, so the mouse is over its first sample
        el.querySelector(".ta-profile svg").dispatchEvent(new MouseEvent("mousemove", {clientX: 10}));
        expect(onIndex).toHaveBeenLastCalledWith(0);
        expect(readout.textContent).toContain("a_T.JPG");
        el.querySelector(".ta-profile svg").dispatchEvent(new MouseEvent("mouseleave"));
        expect(onIndex).toHaveBeenLastCalledWith(null);
        expect(cursor.getAttribute("visibility")).toBe("hidden");
        expect(measure.linkProfile(el, {result: AREA}, "C", false)).toBe(null);
    });
});

describe("measuring on the mosaic viewer", () => {
    const BASE = "/api/conversions/9";
    const TAB = tab => ({tab, kind: tab === "harmonized" ? "harmonized" : "as_converted", bounds: [-88.1, 42.1, -88.0, 42.2],
                         minzoom: 19, maxzoom: 22, stats: {min: 5, max: 33, percentiles: [15.43, 26.08]}});
    const VIEW = Object.assign({}, CONVERSION, {
        unit: "C", stripped: false, frames: ["thermal/a_T.JPG"], tabs: [TAB("as_converted"), TAB("harmonized")],
        kinds: {as_converted: {files: []}, harmonized: {files: []}},
        baselines: {as_converted: {emissivity: 0.91, reflected_temp: 27.1}, harmonized: {emissivity: 0.91, reflected_temp: 27.1}},
        palettes: [{key: "dji_ironred", label: "DJI ironred", color_map: [0x000000ff, 0xffffffff]}], default_palette: "dji_ironred"
    });
    const WHOLE = {unit: "C", approximate: false, result: {kind: "mosaic", valid_pixels: 1000, mean: 20.8, percentiles: [15.5, 25.7],
                   histogram: [[1, 2], [10, 20, 30]], isotherm: {pixels: 50, share: 0.05}}};
    const AREA = {unit: "C", approximate: false, result: {kind: "Polygon", area: 11.45, valid_pixels: 26308, mean: 23.2, min: 10.8,
                  max: 26.9, surroundings: 22.7, delta_t: 0.5, histogram: [[1], [10, 30]], min_location: [-88.07, 42.1], max_location: [-88.06, 42.1]}};
    const bodies = (fetchFn, url) => fetchFn.mock.calls.filter(c => c[0] === url && c[1] && c[1].method === "POST")
        .map(c => JSON.parse(c[1].body));
    const lastTile = L => { const u = L.layers[L.layers.length - 1].urls; return u[u.length - 1]; };

    beforeEach(() => { document.body.innerHTML = page("viewer.html"); });

    it("measures an area drawn on a mosaic and saves it", async () => {
        const L = fakeLeaflet();
        const saved = {id: 4, name: "Hot roof", target: "as_converted", geometry: {}, values: AREA};
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW,
            ["POST " + BASE + "/measure"]: (url, opts) => jsonResponse(JSON.parse(opts.body).geometry ? AREA : WHOLE),
            [BASE + "/measurements"]: [{measurements: []}, {measurements: [saved]}],
            ["POST " + BASE + "/measurements"]: saved
        });
        await viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        expect(document.getElementById("ta-viewer-whole").textContent).toContain("20.80 °C");
        click(document.querySelector('[data-tool="area"]'));
        expect(document.getElementById("ta-viewer-tools").textContent).toContain("Click the area's corners");
        [[42.1, -88.1], [42.1, -88.0], [42.2, -88.0]].forEach(p => L.handlers.click({latlng: {lat: p[0], lng: p[1]}}));
        // A double click's own clicks add the last corner twice: it is kept once
        L.handlers.click({latlng: {lat: 42.2, lng: -88.0}});
        // What is being drawn lets the double click's second click through to the map
        expect(L.shapes.filter(x => x.kind === "polygon" || x.kind === "circle").every(x => x.opts.interactive === false)).toBe(true);
        L.handlers.dblclick();
        await ticks();
        const body = bodies(fetchFn, BASE + "/measure").pop();
        expect(body).toEqual({target: "as_converted", isotherm: "", parameters: {},
                              geometry: {type: "Polygon", coordinates: [[[-88.1, 42.1], [-88.0, 42.1], [-88.0, 42.2], [-88.1, 42.1]]]}});
        expect(document.getElementById("ta-viewer-result").textContent).toContain("23.20 °C");
        // The area, its hottest and coldest pixels on the map
        expect(L.shapes.filter(x => x.kind === "polygon").length).toBeGreaterThan(0);
        expect(L.shapes.filter(x => x.opts && x.opts.fillColor === "#ff1744").length).toBe(1);

        expect(document.getElementById("ta-measure-save").hidden).toBe(false);
        click(document.getElementById("ta-measure-save-btn"));
        expect(document.getElementById("ta-measure-error").textContent).toMatch(/Name the measurement/);
        document.getElementById("ta-measure-name").value = "Hot roof";
        click(document.getElementById("ta-measure-save-btn"));
        await ticks();
        expect(bodies(fetchFn, BASE + "/measurements")[0]).toMatchObject({name: "Hot roof", target: "as_converted"});
        expect(document.getElementById("ta-viewer-measurements").textContent).toContain("Hot roof");
        expect(document.getElementById("ta-viewer-csv").hidden).toBe(false);
        expect(document.getElementById("ta-viewer-geojson").hidden).toBe(false);
        expect(document.getElementById("ta-measure-save").hidden).toBe(true);

        // On the harmonized mosaic, the same area is measured again
        click(document.querySelector('a[data-tab="harmonized"]'));
        await ticks();
        expect(bodies(fetchFn, BASE + "/measure").pop().target).toBe("harmonized");
    });

    it("deletes a saved measurement once asked in the page's dialog, and says when it could not", async () => {
        const saved = {id: 4, name: "Hot roof", target: "as_converted", geometry: {}, values: AREA};
        let deleted = 0;
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW, ["POST " + BASE + "/measure"]: WHOLE,
            [BASE + "/measurements"]: [{measurements: [saved]},
                                       {measurements: [{id: 5, name: "Spot", target: "frame", frame: "thermal/a_T.JPG", values: {}}]}],
            ["DELETE " + BASE + "/measurements/4"]: () => jsonResponse(deleted++ ? {} : {error: "Busy"}, deleted > 1)
        });
        await viewer.init({doc: document, fetchFn, L: fakeLeaflet(), basemaps: []});
        await ticks();
        const del = () => click(document.querySelector('#ta-viewer-measurements [data-delete="4"]'));
        del();
        expect(askDialog().textContent).toContain("Delete the measurement Hot roof?");
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("DELETE " + BASE + "/measurements/4");
        del();
        press("Delete");
        await ticks();
        expect(document.getElementById("ta-measure-error").textContent).toBe("Busy");
        del();
        press("Delete");
        await ticks();
        expect(document.getElementById("ta-viewer-measurements").textContent).not.toContain("Hot roof");
        // Only one on a frame left: nothing for the GeoJSON, still the CSV
        expect(document.getElementById("ta-viewer-geojson").hidden).toBe(true);
        expect(document.getElementById("ta-viewer-csv").hidden).toBe(false);
    });

    it("renames a saved measurement in the page's dialog, and says when it could not", async () => {
        const saved = {id: 4, name: "Hot roof", target: "as_converted", geometry: {}, values: AREA};
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW, ["POST " + BASE + "/measure"]: WHOLE,
            [BASE + "/measurements"]: [{measurements: [saved]}, {measurements: [Object.assign({}, saved, {name: "Roof east"})]}],
            ["PATCH " + BASE + "/measurements/4"]: [() => jsonResponse({error: "Busy"}, false), Object.assign({}, saved, {name: "Roof east"})]
        });
        await viewer.init({doc: document, fetchFn, L: fakeLeaflet(), basemaps: []});
        await ticks();
        const rename = name => {
            click(document.querySelector('#ta-viewer-measurements [data-rename="4"]'));
            expect(askDialog().querySelector("input").value).toBe("Hot roof");
            askDialog().querySelector("input").value = name;
            press("Rename");
        };
        rename("Hot roof");
        await ticks();
        expect(calls(fetchFn)).not.toContain("PATCH " + BASE + "/measurements/4");
        rename("Roof east");
        await ticks();
        expect(document.getElementById("ta-measure-error").textContent).toBe("Busy");
        rename("Roof east");
        await ticks();
        expect(fetchFn.mock.calls.filter(c => c[1] && c[1].method === "PATCH").map(c => JSON.parse(c[1].body))).toEqual([{name: "Roof east"}, {name: "Roof east"}]);
        expect(document.getElementById("ta-measure-error").textContent).toBe("");
        expect(document.getElementById("ta-viewer-measurements").textContent).toContain("Roof east");
    });

    it("draws an isotherm and the approximate correction into the tiles and the figures", async () => {
        const L = fakeLeaflet();
        const fetchFn = server({[BASE + "/mosaics"]: VIEW, ["POST " + BASE + "/measure"]: WHOLE,
                                [BASE + "/measurements"]: {measurements: []}});
        await viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        const mode = document.getElementById("ta-iso-mode");
        mode.value = "above";
        change(mode);
        await ticks();
        // Starts at the top quarter of the range
        expect(document.getElementById("ta-iso-a").value).toBe("23.4");
        expect(lastTile(L)).toContain("&isotherm=above%2C23.4");
        expect(bodies(fetchFn, BASE + "/measure").pop().isotherm).toBe("above,23.4");
        expect(document.getElementById("ta-viewer-whole").textContent).toContain("5.0 %");

        // The fields start at the values measured with, so the arrows step from there, within the limits
        const e = document.getElementById("ta-corr-emissivity");
        expect(e.value).toBe("0.91");
        expect(e.getAttribute("placeholder")).toBe("0.91");
        expect([e.getAttribute("min"), e.getAttribute("max")]).toEqual(["0.1", "1"]);
        expect(document.getElementById("ta-corr-reflected").value).toBe("27.1");
        const asked = bodies(fetchFn, BASE + "/measure").length;
        change(e);
        await ticks();
        expect(bodies(fetchFn, BASE + "/measure").length).toBe(asked);
        e.value = "2";
        change(e);
        expect(document.getElementById("ta-corr-error").textContent).toMatch(/between 0.1 and 1/);
        expect(e.parentNode.classList.contains("has-error")).toBe(true);
        e.value = "0.95";
        change(e);
        await ticks();
        expect(e.parentNode.classList.contains("has-error")).toBe(false);
        expect(lastTile(L)).toContain("&emissivity=0.95");
        expect(bodies(fetchFn, BASE + "/measure").pop().parameters).toEqual({emissivity: "0.95"});

        // Typing redraws once it pauses, without leaving the field
        e.value = "0.8";
        e.dispatchEvent(new window.Event("input", {bubbles: true}));
        expect(lastTile(L)).toContain("&emissivity=0.95");
        await new Promise(done => setTimeout(done, 450));
        await ticks();
        expect(lastTile(L)).toContain("&emissivity=0.8");
    });

    it("reads the correction: a value left where it started is not sent, one out of range is refused", () => {
        const starts = {emissivity: "0.91", reflected_temp: "27.1"};
        expect(viewer.readCorrection({emissivity: "0.91", reflected_temp: "27.1"}, starts)).toEqual({correction: {}});
        expect(viewer.readCorrection({emissivity: "0.92", reflected_temp: ""}, starts)).toEqual({correction: {emissivity: "0.92"}});
        expect(viewer.readCorrection({emissivity: "-0.44", reflected_temp: "27.1"}, starts))
            .toEqual({error: "The emissivity is between 0.1 and 1", field: "emissivity"});
        expect(viewer.readCorrection({emissivity: "0.91", reflected_temp: "2000"}, starts))
            .toEqual({error: "The reflected temperature is between -100 and 1000 °C", field: "reflected_temp"});
        expect(viewer.readCorrection({emissivity: "x"}, starts).error).toMatch(/not a number/);
        window.__temperatureUnit = "F";
        try {
            expect(viewer.readCorrection({reflected_temp: "-200"}, {}).error).toBe("The reflected temperature is between -148 and 1832 °F");
            expect(viewer.correctionHtml({}, {emissivity: 0.91, reflected_temp: 27.1}, "C")).toContain('min="-148" max="1832"');
        } finally {
            delete window.__temperatureUnit;
        }
    });

    it("shows the temperatures in the user's unit, and sends what is typed in the conversion's", async () => {
        window.__temperatureUnit = "F";
        try {
            const L = fakeLeaflet();
            const fetchFn = server({[BASE + "/mosaics"]: VIEW, ["POST " + BASE + "/measure"]: WHOLE,
                                    [BASE + "/measurements"]: {measurements: []}});
            await viewer.init({doc: document, fetchFn, L, basemaps: []});
            await ticks();
            // The percentiles rounded outwards in °F, the tiles still scaled in °C
            expect(document.getElementById("ta-viewer-min").value).toBe("59.7");
            expect(document.getElementById("ta-viewer-max").value).toBe("79");
            expect(document.getElementById("ta-viewer-controls").textContent).toContain("41.0 to 91.4 °F");
            expect(lastTile(L)).toContain("rescale=15.3889,26.1111");
            document.getElementById("ta-viewer-min").value = "50";
            change(document.getElementById("ta-viewer-min"));
            expect(lastTile(L)).toContain("rescale=10,26.1111");
            expect(document.getElementById("ta-viewer-whole").textContent).toContain("69.44 °F");

            const r = document.getElementById("ta-corr-reflected");
            expect(r.getAttribute("placeholder")).toBe("80.8");
            r.value = "80.6";
            change(r);
            await ticks();
            expect(lastTile(L)).toContain("&reflected_temp=27");
            expect(bodies(fetchFn, BASE + "/measure").pop().parameters).toEqual({reflected_temp: 27});
        } finally {
            delete window.__temperatureUnit;
        }
    });

    it("reports a mosaic's differences and normalization in the user's unit", () => {
        window.__temperatureUnit = "K";
        try {
            const kind = {frames: 2, width: 10, height: 10, gsd_m: 0.02, normalization: [27.1, 27.2],
                          report: {radiometric_seams: {pixels: 10, median_abs_c: 0.298, p95_abs_c: 2.748}}};
            const report = viewer.reportHtml(kind);
            expect(report).toContain("median 0.30 K, 95% under 2.75 K");
            expect(report).toContain("ambient 300.3 K");
            expect(viewer.readoutHtml({valid: true, temperature: 70.7}, "F")).toContain("294.65 K");
        } finally {
            delete window.__temperatureUnit;
        }
    });

    it("keeps the values of a click and opens their frame", async () => {
        const L = fakeLeaflet();
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW, ["POST " + BASE + "/measure"]: WHOLE, [BASE + "/measurements"]: {measurements: []},
            [BASE + "/mosaics/as_converted/point?lon=-88.05&lat=42.15"]: {valid: true, temperature: 21.5, frame: "thermal/a b_T.JPG", view_angle: 2},
            [BASE + "/mosaics/footprint?frame=thermal%2Fa%20b_T.JPG"]: {type: "FeatureCollection", features: []}
        });
        await viewer.init({doc: document, fetchFn, L, basemaps: []});
        L.handlers.click({latlng: {lng: -88.05, lat: 42.15}});
        await ticks();
        const link = document.querySelector("#ta-viewer-readout a");
        expect(link.getAttribute("href")).toBe("/conversion/9/frame?frame=thermal%2Fa%20b_T.JPG");
        // The frame's footprint is outlined on the mosaic, without moving the map
        expect(L.geoJSON).toHaveBeenCalledWith({type: "FeatureCollection", features: []}, expect.objectContaining({interactive: false}));
        const footprint = L.geoJSON.mock.results[0].value;
        expect(footprint.addTo).toHaveBeenCalledWith(L.maps[0]);
        expect(L.maps[0].fitBounds).toHaveBeenCalledTimes(1);
        // Kept while the cursor moves on
        L.handlers.mousemove({latlng: {lng: -88.0, lat: 42.1}});
        L.handlers.mouseout();
        expect(document.getElementById("ta-viewer-readout").textContent).toContain("21.50 °C");
        click(document.getElementById("ta-viewer-unpin"));
        expect(document.getElementById("ta-viewer-readout").textContent).toContain("Move the cursor");
        expect(L.maps[0].removeLayer).toHaveBeenCalledWith(footprint);
        expect(document.getElementById("ta-viewer-frames").getAttribute("href")).toBe("/conversion/9/frame");
    });

    it("opens on the view in the URL, outlines the frame it names and keeps the URL up to date", async () => {
        const L = fakeLeaflet();
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW, ["POST " + BASE + "/measure"]: WHOLE, [BASE + "/measurements"]: {measurements: []},
            [BASE + "/mosaics/footprint?frame=thermal%2Fa_T.JPG"]: {type: "FeatureCollection", features: []}
        });
        await viewer.init({doc: document, fetchFn, L, basemaps: [],
                           search: "?tab=harmonized&palette=dji_ironred&min=10&max=30&frame=thermal%2Fa_T.JPG"});
        await ticks();
        expect(lastTile(L)).toContain("/harmonized/");
        expect(lastTile(L)).toContain("rescale=10,30");
        expect(document.getElementById("ta-viewer-readout").textContent).toContain("thermal/a_T.JPG");
        // The footprint is outlined, and the map moved onto it
        const footprint = L.geoJSON.mock.results[0].value;
        expect(footprint.addTo).toHaveBeenCalledWith(L.maps[0]);
        expect(L.maps[0].fitBounds).toHaveBeenLastCalledWith(expect.objectContaining({isValid: expect.any(Function)}));
        expect(window.location.search).toBe("?tab=harmonized&palette=dji_ironred&min=10&max=30&frame=thermal%2Fa_T.JPG");
        click(document.getElementById("ta-viewer-unpin"));
        expect(window.location.search).toBe("?tab=harmonized&palette=dji_ironred&min=10&max=30");
    });

    it("finishes a measurement on Enter and cancels it on Esc, but not while typing in a field", async () => {
        const L = fakeLeaflet();
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW, [BASE + "/measurements"]: {measurements: []},
            ["POST " + BASE + "/measure"]: (url, opts) => jsonResponse(JSON.parse(opts.body).geometry ? AREA : WHOLE)
        });
        await viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        const key = (k, target) => (target || document.body).dispatchEvent(new KeyboardEvent("keydown", {key: k, bubbles: true}));
        const drawing = () => document.querySelector('[data-tool-act="cancel"]') !== null;
        click(document.querySelector('[data-tool="area"]'));
        key("Escape", document.querySelector(".ta-viewer-panel input"));
        expect(drawing()).toBe(true);
        key("Escape");
        expect(drawing()).toBe(false);

        click(document.querySelector('[data-tool="area"]'));
        [[42.1, -88.1], [42.1, -88.0], [42.2, -88.0]].forEach(p => L.handlers.click({latlng: {lat: p[0], lng: p[1]}}));
        key("Enter");
        await ticks();
        expect(bodies(fetchFn, BASE + "/measure").pop().geometry.type).toBe("Polygon");
        expect(document.getElementById("ta-viewer-result").textContent).toContain("23.20 °C");
    });

    it("draws a box or a circle by dragging, the map holding still meanwhile, and saves how it was drawn", async () => {
        const L = fakeLeaflet();
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW,
            ["POST " + BASE + "/measure"]: (url, opts) => jsonResponse(JSON.parse(opts.body).geometry ? AREA : WHOLE),
            [BASE + "/measurements"]: {measurements: []},
            ["POST " + BASE + "/measurements"]: {id: 4, name: "Roof", target: "as_converted", geometry: {}, values: AREA}
        });
        await viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        const map = L.maps[0];
        click(document.querySelector('[data-tool="box"]'));
        expect(map.dragging.disable).toHaveBeenCalled();
        map.dragging.enable.mockClear();
        L.handlers.mousedown({latlng: {lat: 42.1, lng: -88.1}});
        L.handlers.mousemove({latlng: {lat: 42.2, lng: -88.0}});
        const preview = L.shapes[L.shapes.length - 1];
        expect(preview.kind).toBe("polygon");
        expect(preview.bindTooltip).toHaveBeenCalledWith(expect.stringContaining(" × "), {permanent: true, direction: "center"});
        expect(map.dragging.enable).not.toHaveBeenCalled();
        L.handlers.mouseup({latlng: {lat: 42.2, lng: -88.0}});
        await ticks();
        expect(map.dragging.enable).toHaveBeenCalled();
        expect(bodies(fetchFn, BASE + "/measure").pop().geometry).toEqual(
            {type: "Polygon", coordinates: [[[-88.1, 42.1], [-88.0, 42.1], [-88.0, 42.2], [-88.1, 42.2], [-88.1, 42.1]]]});
        expect(document.querySelector("#ta-viewer-result .ta-result-kind").textContent).toBe("Box");
        document.getElementById("ta-measure-name").value = "Roof";
        click(document.getElementById("ta-measure-save-btn"));
        await ticks();
        expect(bodies(fetchFn, BASE + "/measurements")[0].shape).toEqual({kind: "box"});

        click(document.querySelector('[data-tool="circle"]'));
        L.handlers.mousedown({latlng: {lat: 42.1, lng: -88.1}});
        L.handlers.mouseup({latlng: {lat: 42.1, lng: -88.0}});
        await ticks();
        expect(bodies(fetchFn, BASE + "/measure").pop().geometry.coordinates[0].length).toBe(65);
        expect(document.querySelector("#ta-viewer-result .ta-result-kind").textContent).toBe("Circle");
    });

    it("compares two saved measurements ticked in the list, each with its own area", async () => {
        const wall = Object.assign({}, AREA, {result: Object.assign({}, AREA.result, {mean: 25.2, area: 3.5})});
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW, ["POST " + BASE + "/measure"]: WHOLE,
            [BASE + "/measurements"]: {measurements: [{id: 4, name: "Hot roof", target: "as_converted", geometry: {}, values: AREA},
                                                      {id: 5, name: "Wall", target: "as_converted", geometry: {}, values: wall}]}
        });
        await viewer.init({doc: document, fetchFn, L: fakeLeaflet(), basemaps: []});
        await ticks();
        const list = document.getElementById("ta-viewer-measurements");
        const tick = (id, on) => { const box = list.querySelector('[data-compare="' + id + '"]'); box.checked = on; change(box); };
        expect(list.textContent).toContain("Tick two to compare them.");
        tick(4, true);
        expect(list.querySelector(".ta-compare")).toBe(null);
        tick(5, true);
        expect(list.querySelector(".ta-compare").textContent).toContain("Difference");
        expect(list.querySelector(".ta-compare").textContent).toContain("+2.00 °C");
        expect(list.querySelector(".ta-compare tbody tr").textContent).toBe("Area11.45 m²3.50 m²");
        tick(4, false);
        expect(list.querySelector(".ta-compare")).toBe(null);
    });

    it("measures a saved measurement again with other parameters, keeping a frame's others, and says when it could not", async () => {
        const saved = {id: 4, name: "Vent", target: "frame", frame: "thermal/a_T.JPG", geometry: {}, parameters: {distance: 30, emissivity: 0.95},
                       values: AREA};
        const again = Object.assign({}, saved, {parameters: {distance: 30, emissivity: 0.9, reflected_temp: 20}});
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW, ["POST " + BASE + "/measure"]: WHOLE,
            [BASE + "/measurements"]: [{measurements: [saved]}, {measurements: [again]}],
            ["PATCH " + BASE + "/measurements/4"]: [() => jsonResponse({error: "Busy"}, false), again]
        });
        await viewer.init({doc: document, fetchFn, L: fakeLeaflet(), basemaps: []});
        await ticks();
        const list = document.getElementById("ta-viewer-measurements");
        expect(list.textContent).toContain("Measured with emissivity 0.95");
        click(list.querySelector('[data-params="4"]'));
        const field = key => list.querySelector('[data-param-field="' + key + '"]');
        const measureAgain = () => click(list.querySelector('[data-params-act="save"]'));
        field("emissivity").value = "5";
        measureAgain();
        await ticks();
        expect(list.querySelector("[data-params-error]").textContent).toMatch(/The emissivity is between/);
        expect(calls(fetchFn)).not.toContain("PATCH " + BASE + "/measurements/4");
        field("emissivity").value = "0.9";
        field("reflected_temp").value = "20";
        measureAgain();
        await ticks();
        expect(list.querySelector("[data-params-error]").textContent).toBe("Busy");
        measureAgain();
        await ticks();
        const patches = fetchFn.mock.calls.filter(c => c[1] && c[1].method === "PATCH").map(c => JSON.parse(c[1].body));
        expect(patches.pop()).toEqual({parameters: {distance: 30, emissivity: 0.9, reflected_temp: 20}});
        expect(list.querySelector("[data-params-form]")).toBe(null);
        expect(list.textContent).toContain("Measured with emissivity 0.9, reflected temperature 20 °C");
        // Cancel folds the form away
        click(list.querySelector('[data-params="4"]'));
        click(list.querySelector('[data-params-act="cancel"]'));
        expect(list.querySelector("[data-params-form]")).toBe(null);
    });

    it("charts a line's temperatures, its cursor following the mouse on the chart or on the line", async () => {
        const L = fakeLeaflet();
        const LINE = {unit: "C", approximate: false, result: {kind: "LineString", length: 8, valid_pixels: 3, mean: 25, min: 20, max: 30,
                      profile: {distance: [0, 4, 8], values: [20, 25, 30], points: [[-88.1, 42.1], [-88.05, 42.1], [-88.0, 42.1]]}}};
        const fetchFn = server({
            [BASE + "/mosaics"]: VIEW,
            ["POST " + BASE + "/measure"]: (url, opts) => jsonResponse(JSON.parse(opts.body).geometry ? LINE : WHOLE),
            [BASE + "/measurements"]: {measurements: []}
        });
        await viewer.init({doc: document, fetchFn, L, basemaps: []});
        await ticks();
        click(document.querySelector('[data-tool="line"]'));
        [[42.1, -88.1], [42.1, -88.0], [42.1, -88.0]].forEach(p => L.handlers.click({latlng: {lat: p[0], lng: p[1]}}));
        L.handlers.dblclick();
        await ticks();
        const result = document.getElementById("ta-viewer-result"), readout = result.querySelector(".ta-profile-readout");
        expect(result.querySelector(".ta-profile-line")).not.toBe(null);
        const line = L.shapes.filter(s => s.opts && s.opts.weight === 14).pop();
        line.handlers.mousemove({latlng: {lat: 42.1, lng: -88.01}});
        expect(readout.textContent).toBe("8.0 m · 30.00 °C");
        line.handlers.mouseout();
        expect(readout.textContent).toBe("Move the cursor over the chart or the line.");
        result.querySelector(".ta-profile svg").dispatchEvent(new MouseEvent("mousemove", {clientX: 10}));
        const cursor = L.shapes.filter(s => s.opts && s.opts.fillColor === "#ffea00").pop();
        expect(cursor.where).toEqual([42.1, -88.1]);
    });
});

describe("a conversion's frames", () => {
    const BASE = "/api/conversions/9";
    const FRAMES = Object.assign({}, CONVERSION, {
        dataset_name: "Roof", unit: "C", normalized: true, default_palette: "dji_ironred",
        palettes: [{key: "dji_ironred", label: "DJI ironred", color_map: [0x000000ff, 0xffffffff]}],
        frames: [{path: "thermal/a_T.JPG", pitch: -90, time: "18:29:50", converted: true, mosaic: 0,
                  recorded: {emissivity: 0.91, humidity: 50, lrf: 21.4, reflection: 27.6, ambient: 27.6}},
                 {path: "thermal/b_T.JPG", pitch: -45, time: "18:30:10", converted: false, mosaic: null, recorded: {}}]
    });
    const INFO = {frame: "thermal/a_T.JPG", width: 640, height: 512, distance_source: "rangefinder", notes: [], offset: 0.2,
                  offset_known: true, params: {distance: 21.4, humidity: 50, emissivity: 0.91, reflection: 27.1, ambient_temp: 27.1},
                  stats: {min: 15.1, max: 32.2, mean: 21.9, percentiles: [17.04, 27.96], histogram: [[1, 2], [15, 25, 33]]}};
    const lastImage = (L, i) => { const u = L.images[i].urls; return u[u.length - 1]; };

    beforeEach(() => { document.body.innerHTML = page("frame.html"); });

    it("names the frames and checks the parameters changed", () => {
        expect(frame.frameLabel(FRAMES.frames[0])).toBe("thermal/a_T.JPG (in the mosaics)");
        expect(frame.frameLabel(FRAMES.frames[1])).toBe("thermal/b_T.JPG (oblique, -45°, not converted)");
        expect(frame.readChanges({emissivity: "0.98", humidity: ""})).toEqual({changes: {emissivity: 0.98}});
        expect(frame.readChanges({emissivity: "3"}).error).toMatch(/between 0.1 and 1/);
        expect(frame.readChanges({distance: "x"}).error).toMatch(/not a number/);
        expect(frame.readChanges({emissivity: "0.91", humidity: "50.0"}, {emissivity: "0.91", humidity: "50.0"})).toEqual({changes: {}});
        expect(frame.readChanges({humidity: "120"})).toEqual({error: "The humidity is between 0 and 100 %", field: "humidity"});
        expect(frame.readChanges({ambient_temp: "-300"}).error).toBe("A temperature is above absolute zero (-273.15 °C)");
        expect(frame.newConversionUrl("/p/", 5, 9, {emissivity: 0.98})).toBe("/p/dataset/5?from=9&emissivity=0.98#convert");
        expect(frame.imageUrl("/api/", 9, "thermal/a_T.JPG", {palette: "magma", range: [15, 30]}, "above,25", {distance: 30}))
            .toBe("/api/conversions/9/frame/image.png?frame=thermal%2Fa_T.JPG&color_map=magma&rescale=15,30&isotherm=above%2C25&distance=30");
        expect(frame.imageUrl("/api/", 9, "a.JPG", {palette: "magma", range: [15, 30], adjust: {gamma: 0.5, equalize: true, sharpen: 0}}, "", {}))
            .toBe("/api/conversions/9/frame/image.png?frame=a.JPG&color_map=magma&rescale=15,30&gamma=0.5&equalize=1");
        expect(frame.infoHtml(Object.assign({}, INFO, {offset_known: false}), "C", true)).toContain("offset is not known");
        expect(frame.infoHtml(INFO, "C", true)).toContain("offset -0.20 °C applied");
    });

    it("shows a frame, then the same frame measured again with other parameters beside it", async () => {
        const L = fakeLeaflet();
        const fetchFn = server({
            [BASE + "/frames"]: FRAMES,
            [BASE + "/frame?frame=thermal%2Fb_T.JPG"]: Object.assign({}, INFO, {frame: "thermal/b_T.JPG"}),
            [BASE + "/frame?frame=thermal%2Fb_T.JPG&emissivity=0.98"]: Object.assign({}, INFO, {changed: INFO}),
            [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG&emissivity=0.98"]: Object.assign({}, INFO, {changed: INFO}),
            [BASE + "/measurements?frame=thermal%2Fb_T.JPG"]: {measurements: []},
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: {measurements: []},
            [BASE + "/frame/point?frame=thermal%2Fb_T.JPG&x=10&y=20&emissivity=0.98"]: {x: 10, y: 20, inside: true, temperature: 20, changed: 20.4}
        });
        await frame.init({doc: document, fetchFn, L, search: "?frame=thermal%2Fb_T.JPG"});
        await ticks();
        expect(document.getElementById("ta-frame-main").hidden).toBe(false);
        expect(document.getElementById("ta-frame-select").value).toBe("thermal/b_T.JPG");
        expect(lastImage(L, 0)).toBe(BASE + "/frame/image.png?frame=thermal%2Fb_T.JPG&color_map=dji_ironred&rescale=17,28");
        expect(L.images[0].bounds).toEqual([[-512, 0], [0, 640]]);
        // The colour scale on the frame (on the first map only) and in the panel
        expect(L.controls.length).toBe(1);
        expect(L.controls[0].el.textContent).toMatch(/^Temperature, °C/);
        expect(document.getElementById("ta-viewer-scale").textContent).toBe(L.controls[0].el.textContent.replace("Temperature, °C", ""));
        expect(document.getElementById("ta-frame-changed-pane").hidden).toBe(true);
        expect(document.getElementById("ta-frame-params").textContent).toContain("Measured with");

        document.querySelector('[data-change="emissivity"]').value = "0.98";
        click(document.getElementById("ta-change-apply"));
        await ticks();
        expect(document.getElementById("ta-frame-changed-pane").hidden).toBe(false);
        expect(L.maps.length).toBe(2);
        expect(lastImage(L, 1)).toContain("&emissivity=0.98");
        expect(lastImage(L, 0)).not.toContain("emissivity");
        expect(document.querySelector("#ta-frame-params a").getAttribute("href"))
            .toBe("/dataset/5?from=9&emissivity=0.98#convert");

        // The readout shows both, and their difference (y down: the map's latitude is minus the row)
        jest.useFakeTimers();
        L.maps[0].handlers.mousemove({latlng: {lng: 10, lat: -20}});
        jest.runOnlyPendingTimers();
        await ticks();
        expect(document.getElementById("ta-frame-readout").textContent).toMatch(/20\.00 °C.*20\.40 °C.*\+0\.40 °C/);
        jest.useRealTimers();

        // The changes stay on the next frame, until cleared
        click(document.getElementById("ta-frame-prev"));
        await ticks();
        expect(document.getElementById("ta-frame-select").value).toBe("thermal/a_T.JPG");
        expect(lastImage(L, 1)).toBe(BASE + "/frame/image.png?frame=thermal%2Fa_T.JPG&color_map=dji_ironred&rescale=17,28&emissivity=0.98");
        click(document.getElementById("ta-change-clear"));
        await ticks();
        expect(document.getElementById("ta-frame-changed-pane").hidden).toBe(true);
    });

    it("draws the frame with the adjustments a link asks for, equalized from its histogram, and resets them", async () => {
        const L = fakeLeaflet();
        const CURVE = BASE + "/frame/curve?frame=thermal%2Fa_T.JPG&rescale=17,28&gamma=0.5&equalize=1&sharpen=2";
        const fetchFn = server({
            [BASE + "/frames"]: FRAMES,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: {measurements: []},
            [CURVE]: {shares: [0, 0.1, 1]}
        });
        await frame.init({doc: document, fetchFn, L, search: "?frame=thermal%2Fa_T.JPG&gamma=0.5&sharpen=2"});
        await ticks();
        const $ = id => document.getElementById(id);
        expect(lastImage(L, 0)).toBe(BASE + "/frame/image.png?frame=thermal%2Fa_T.JPG&color_map=dji_ironred&rescale=17,28&gamma=0.5&sharpen=2");
        expect($("ta-image-gamma-value").textContent).toBe("0.50");
        expect($("ta-image-sharpen").value).toBe("2");

        $("ta-image-tone").value = "equalized";
        change($("ta-image-tone"));
        await ticks();
        expect(lastImage(L, 0)).toContain("&gamma=0.5&equalize=1&sharpen=2");
        expect(calls(fetchFn)).toContain("GET " + CURVE);
        expect(L.controls[0].el.innerHTML).toContain("linear-gradient(to right, rgb(0,0,0), rgb(26,26,26), rgb(255,255,255))");

        // Contrast narrows the range about its middle
        $("ta-image-contrast").value = "1";
        input($("ta-image-contrast"));
        expect([$("ta-viewer-min").value, $("ta-viewer-max").value]).toEqual(["19.75", "25.25"]);
        change($("ta-image-contrast"));
        expect(lastImage(L, 0)).toContain("rescale=19.75,25.25");

        click($("ta-image-reset"));
        expect(lastImage(L, 0)).toBe(BASE + "/frame/image.png?frame=thermal%2Fa_T.JPG&color_map=dji_ironred&rescale=17,28");
        expect($("ta-image-gamma-value").textContent).toBe("1.00");
    });

    it("starts the changes at the values measured with, refuses one out of range, and measures again on Enter", async () => {
        const L = fakeLeaflet();
        const fetchFn = server({
            [BASE + "/frames"]: FRAMES,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG&emissivity=0.92"]: Object.assign({}, INFO, {changed: INFO}),
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: {measurements: []}
        });
        await frame.init({doc: document, fetchFn, L, search: ""});
        await ticks();
        const e = document.querySelector('[data-change="emissivity"]');
        expect(e.value).toBe("0.91");
        expect([e.getAttribute("min"), e.getAttribute("max")]).toEqual(["0.1", "1"]);
        expect(document.querySelector('[data-change="distance"]').value).toBe("21.4");
        expect(document.querySelector('[data-change="reflected_temp"]').getAttribute("min")).toBe("-273.15");

        // Nothing moved: measured again with no changes, no second pane
        click(document.getElementById("ta-change-apply"));
        await ticks();
        expect(document.getElementById("ta-frame-changed-pane").hidden).toBe(true);

        // The panel was drawn again: find the field again
        let e2 = document.querySelector('[data-change="emissivity"]');
        e2.value = "-0.44";
        click(document.getElementById("ta-change-apply"));
        expect(document.getElementById("ta-change-error").textContent).toBe("The emissivity is between 0.1 and 1");
        expect(e2.parentNode.classList.contains("has-error")).toBe(true);

        e2.value = "0.92";
        e2.dispatchEvent(new window.KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await ticks();
        expect(document.getElementById("ta-frame-changed-pane").hidden).toBe(false);
        expect(lastImage(L, 1)).toContain("&emissivity=0.92");
        // Shown again as typed, the others still at their start
        expect(document.querySelector('[data-change="emissivity"]').value).toBe("0.92");
        expect(document.querySelector('[data-change="humidity"]').value).toBe("50.0");
    });

    it("renames a measurement saved on the frame", async () => {
        const saved = {id: 7, name: "Spot", target: "frame", frame: "thermal/a_T.JPG", geometry: {type: "Point", coordinates: [1, 2]},
                       values: {unit: "C", result: {kind: "Point", value: 18.7, mean: 18.8}}};
        const fetchFn = server({
            [BASE + "/frames"]: FRAMES,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: [{measurements: [saved]},
                                                              {measurements: [Object.assign({}, saved, {name: "Vent"})]}],
            ["PATCH " + BASE + "/measurements/7"]: Object.assign({}, saved, {name: "Vent"})
        });
        await frame.init({doc: document, fetchFn, L: fakeLeaflet(), search: ""});
        await ticks();
        click(document.querySelector('#ta-frame-measurements [data-rename="7"]'));
        askDialog().querySelector("input").value = "Vent";
        press("Rename");
        await ticks();
        expect(calls(fetchFn)).toContain("PATCH " + BASE + "/measurements/7");
        expect(document.getElementById("ta-frame-measurements").textContent).toContain("Vent");
    });

    it("measures a measurement saved on the frame again with other parameters", async () => {
        const saved = {id: 7, name: "Spot", target: "frame", frame: "thermal/a_T.JPG", geometry: {type: "Point", coordinates: [1, 2]},
                       parameters: {emissivity: 0.91}, values: {unit: "C", result: {kind: "Point", value: 18.7, mean: 18.8}}};
        const again = Object.assign({}, saved, {parameters: {distance: 30, emissivity: 0.91, reflected_temp: 20}});
        const fetchFn = server({
            [BASE + "/frames"]: FRAMES,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: [{measurements: [saved]}, {measurements: [again]}],
            ["PATCH " + BASE + "/measurements/7"]: again
        });
        await frame.init({doc: document, fetchFn, L: fakeLeaflet(), search: ""});
        await ticks();
        const list = document.getElementById("ta-frame-measurements");
        click(list.querySelector('[data-params="7"]'));
        const field = key => list.querySelector('[data-param-field="' + key + '"]');
        expect(["distance", "humidity", "emissivity", "reflected_temp", "ambient_temp"].every(field)).toBe(true);
        expect(field("emissivity").value).toBe("0.91");
        field("distance").value = "30";
        field("reflected_temp").value = "20";
        click(list.querySelector('[data-params-act="save"]'));
        await ticks();
        const patch = fetchFn.mock.calls.filter(c => c[1] && c[1].method === "PATCH").pop();
        expect(JSON.parse(patch[1].body)).toEqual({parameters: {distance: 30, emissivity: 0.91, reflected_temp: 20}});
        expect(list.textContent).toContain("Measured with distance (m) 30, emissivity 0.91, reflected temperature 20 °C");
    });

    it("exports the frame as shown as a PNG, both images when the parameters are changed, with its measurements and the colour scale", async () => {
        const L = fakeLeaflet();
        const SAVED = [{id: 4, name: "Vent", frame: "thermal/a_T.JPG", geometry: {type: "Point", coordinates: [120, 80]}, values: {}}];
        const fetchFn = server({
            [BASE + "/frames"]: Object.assign({}, FRAMES, {frames: [Object.assign({}, FRAMES.frames[0], {time: "2026:09:18 18:29:50"}), FRAMES.frames[1]]}),
            [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG&emissivity=0.98"]: Object.assign({}, INFO, {changed: INFO}),
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: {measurements: SAVED}
        });
        await frame.init({doc: document, fetchFn, L, search: "?frame=thermal%2Fa_T.JPG"});
        await ticks();
        const png = document.getElementById("ta-frame-png");
        expect(png.hidden).toBe(false);
        let canvas = recordCanvas();
        try {
            click(png);
            expect(canvas.saved).toEqual(["Roof-Nadir-thermal_a_T.png"]);
            const texts = canvas.texts();
            expect(texts[0]).toBe("Roof · Nadir · thermal/a_T.JPG");
            expect(texts[1]).toMatch(/^Taken 2026-09-18 18:29 · exported /);
            expect(canvas.drawn.filter(d => d[0] === "drawImage").length).toBe(1);
            expect(texts).toContain("Vent");
            expect(texts).not.toContain("As converted");
            expect(texts).toContain("Temperature, °C");
            // Frames are in pixels: no scale bar
            expect(texts.some(t => / k?m$/.test(t))).toBe(false);
        } finally {
            canvas.restore();
        }

        document.querySelector('[data-change="emissivity"]').value = "0.98";
        click(document.getElementById("ta-change-apply"));
        await ticks();
        canvas = recordCanvas();
        try {
            click(png);
            const texts = canvas.texts();
            expect(canvas.drawn.filter(d => d[0] === "drawImage").length).toBe(2);
            expect(texts).toEqual(expect.arrayContaining(["As converted", "Parameters changed"]));
            expect(texts.filter(t => t === "Vent").length).toBe(2);
        } finally {
            canvas.restore();
        }
    });

    it("measures a spot on a frame with the parameters changed", async () => {
        const L = fakeLeaflet();
        const SPOT = {unit: "C", result: {kind: "Point", value: 18.67, mean: 18.85, valid_pixels: 16},
                      changed: {kind: "Point", value: 19.0, mean: 19.2, valid_pixels: 16}};
        const fetchFn = server({
            [BASE + "/frames"]: FRAMES,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG&humidity=80"]: Object.assign({}, INFO, {changed: INFO}),
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: {measurements: []},
            ["POST " + BASE + "/measure"]: SPOT
        });
        await frame.init({doc: document, fetchFn, L, search: ""});
        await ticks();
        document.querySelector('[data-change="humidity"]').value = "80";
        click(document.getElementById("ta-change-apply"));
        await ticks();
        click(document.querySelector('[data-tool="point"]'));
        L.maps[0].handlers.click({latlng: {lng: 320.5, lat: -256.5}});
        await ticks();
        const call = fetchFn.mock.calls.filter(c => c[0] === BASE + "/measure").pop();
        expect(JSON.parse(call[1].body)).toEqual({target: "frame", frame: "thermal/a_T.JPG", isotherm: "",
                                                  geometry: {type: "Point", coordinates: [320.5, 256.5]}, parameters: {humidity: 80}});
        expect(document.getElementById("ta-frame-result").textContent).toMatch(/18\.85 °C.*19\.20 °C.*\+0\.35 °C/);
    });

    it("shows a frame's parameters in the user's unit, and measures it again with what is typed in the conversion's", async () => {
        window.__temperatureUnit = "F";
        try {
            const L = fakeLeaflet();
            const fetchFn = server({
                [BASE + "/frames"]: FRAMES,
                [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
                [BASE + "/frame?frame=thermal%2Fa_T.JPG&reflected_temp=27"]: Object.assign({}, INFO, {changed: INFO}),
                [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: {measurements: []}
            });
            await frame.init({doc: document, fetchFn, L, search: ""});
            await ticks();
            const params = document.getElementById("ta-frame-params").textContent;
            expect(params).toContain("Reflected temperature (°F)");
            expect(params).toMatch(/81\.7\s*80\.8/);
            expect(document.getElementById("ta-viewer-min").value).toBe("62.6");
            expect(lastImage(L, 0)).toBe(BASE + "/frame/image.png?frame=thermal%2Fa_T.JPG&color_map=dji_ironred&rescale=17,28");

            document.querySelector('[data-change="reflected_temp"]').value = "80.6";
            click(document.getElementById("ta-change-apply"));
            await ticks();
            expect(lastImage(L, 1)).toContain("&reflected_temp=27");
            expect(document.querySelector('[data-change="reflected_temp"]').value).toBe("80.6");
            expect(document.querySelector("#ta-frame-params a").getAttribute("href"))
                .toBe("/dataset/5?from=9&reflected_temp=80.6#convert");

            const mode = document.getElementById("ta-iso-mode");
            mode.value = "above";
            mode.dispatchEvent(new Event("change", {bubbles: true}));
            await ticks();
            expect(document.getElementById("ta-iso-a").value).toBe("77.5");
            expect(lastImage(L, 0)).toContain("&isotherm=above%2C25.2778");
        } finally {
            delete window.__temperatureUnit;
        }
    });

    it("steps through the frames with the arrow keys, on a locator map, and keeps the view in the URL", async () => {
        const L = fakeLeaflet();
        const placed = Object.assign({}, FRAMES, {frames: [Object.assign({lat: 42.1, lon: -88.07}, FRAMES.frames[0]),
                                                           Object.assign({lat: 42.1, lon: -88.0699}, FRAMES.frames[1])]});
        const fetchFn = server({
            [BASE + "/frames"]: placed,
            [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/frame?frame=thermal%2Fb_T.JPG"]: Object.assign({}, INFO, {frame: "thermal/b_T.JPG"}),
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: {measurements: []},
            [BASE + "/measurements?frame=thermal%2Fb_T.JPG"]: {measurements: []}
        });
        await frame.init({doc: document, fetchFn, L, search: "?frame=thermal%2Fa_T.JPG&palette=dji_ironred&min=20&max=30"});
        await ticks();
        expect(lastImage(L, 0)).toBe(BASE + "/frame/image.png?frame=thermal%2Fa_T.JPG&color_map=dji_ironred&rescale=20,30");
        expect(window.location.search).toBe("?palette=dji_ironred&min=20&max=30&frame=thermal%2Fa_T.JPG");
        // Back to the mosaics with the frame's footprint, as it is in them
        expect(document.getElementById("ta-frame-mosaics").getAttribute("href"))
            .toBe("/conversion/9?frame=thermal%2Fa_T.JPG");

        // A dot per frame where it was taken, the one shown highlighted
        expect(document.getElementById("ta-frame-locator-section").hidden).toBe(false);
        const dots = L.shapes.filter(x => x.kind === "circle");
        expect(dots.map(d => d.where)).toEqual([[42.1, -88.07], [42.1, -88.0699]]);
        const highlighted = d => d.setStyle.mock.calls[d.setStyle.mock.calls.length - 1][0];
        const current = highlighted(dots[0]);
        expect(highlighted(dots[1])).not.toEqual(current);
        expect(dots[0].bringToFront).toHaveBeenCalled();

        // The arrow keys step, but not while typing in a field
        const key = (k, target) => (target || document.body).dispatchEvent(new KeyboardEvent("keydown", {key: k, bubbles: true}));
        key("ArrowRight", document.querySelector('[data-change="emissivity"]'));
        await ticks();
        expect(document.getElementById("ta-frame-select").value).toBe("thermal/a_T.JPG");
        key("ArrowRight");
        await ticks();
        expect(document.getElementById("ta-frame-select").value).toBe("thermal/b_T.JPG");
        expect(window.location.search).toContain("frame=thermal%2Fb_T.JPG");
        // b is not in the mosaics: the link back has no footprint to outline
        expect(document.getElementById("ta-frame-mosaics").getAttribute("href")).toBe("/conversion/9");
        expect(highlighted(dots[1])).toEqual(current);
        expect(highlighted(dots[0])).not.toEqual(current);
        expect(dots[1].bringToFront).toHaveBeenCalled();
        key("ArrowRight");
        await ticks();
        expect(document.getElementById("ta-frame-select").value).toBe("thermal/b_T.JPG");

        // A click on another frame's dot opens it
        dots[0].handlers.click();
        await ticks();
        expect(document.getElementById("ta-frame-select").value).toBe("thermal/a_T.JPG");
    });

    it("has no locator map when the frames have no position", async () => {
        const L = fakeLeaflet();
        const fetchFn = server({
            [BASE + "/frames"]: FRAMES, [BASE + "/frame?frame=thermal%2Fa_T.JPG"]: INFO,
            [BASE + "/measurements?frame=thermal%2Fa_T.JPG"]: {measurements: []}
        });
        await frame.init({doc: document, fetchFn, L, search: "?frame=thermal%2Fa_T.JPG"});
        await ticks();
        expect(document.getElementById("ta-frame-main").hidden).toBe(false);
        expect(document.getElementById("ta-frame-locator-section").hidden).toBe(true);
        expect(L.shapes.filter(x => x.kind === "circle").length).toBe(0);
    });
});

describe("a new conversion from a frame's changed parameters", () => {
    it("reads what the link asks for", () => {
        expect(conversions.parsePrefill("?from=9&emissivity=0.98&distance=30&humidity=")).toEqual({from: 9, changes: {emissivity: 0.98, distance: 30}});
        expect(conversions.parsePrefill("")).toBe(null);
        expect(conversions.parsePrefill("?emissivity=0.9")).toBe(null);
    });

    it("links each converted image to its frame", () => {
        const html = conversions.resultsHtml({status: "ready", results: {files: [{path: "thermal/a_T.JPG", ok: true, outputs: []}]}},
                                             "/api/conversions/", "/p/conversion/9/frame");
        expect(html).toContain('href="/p/conversion/9/frame?frame=thermal%2Fa_T.JPG"');
    });
});

describe("moving around the viewers", () => {
    afterEach(() => { window.localStorage.clear(); });

    it("reads a view from the URL and writes it back", () => {
        expect(viewer.readView("?tab=harmonized&palette=dji_ironred&min=10.5&max=30&frame=thermal%2Fa%20b_T.JPG"))
            .toEqual({tab: "harmonized", palette: "dji_ironred", range: [10.5, 30], frame: "thermal/a b_T.JPG"});
        // A range upside down or not a number, and a malformed value, are left out
        expect(viewer.readView("?min=30&max=10&palette=%E0%A4%A")).toEqual({});
        expect(viewer.readView("?min=x&max=10")).toEqual({});
        expect(viewer.readView("")).toEqual({});
        expect(viewer.viewQuery({tab: "harmonized", palette: "dji_ironred", range: [10.5, 30], frame: "thermal/a b_T.JPG"}))
            .toBe("?tab=harmonized&palette=dji_ironred&min=10.5&max=30&frame=thermal%2Fa%20b_T.JPG");
        expect(viewer.viewQuery({})).toBe("");
    });

    it("folds the panel's sections away and remembers which", () => {
        document.body.innerHTML = '<div id="p"><details open data-section="a"></details><details open data-section="b"></details></div>';
        const p = document.getElementById("p"), [a, b] = p.querySelectorAll("details");
        viewer.foldSections(document, p, "test.folded");
        a.open = false;
        a.dispatchEvent(new Event("toggle"));
        expect(JSON.parse(window.localStorage.getItem("test.folded"))).toEqual(["a"]);

        document.body.innerHTML = '<div id="p"><details open data-section="a"></details><details open data-section="b"></details></div>';
        const again = document.getElementById("p");
        viewer.foldSections(document, again, "test.folded");
        expect(Array.from(again.querySelectorAll("details")).map(d => d.open)).toEqual([false, true]);
        expect(b.open).toBe(true);
    });

    it("still folds the sections when this browser keeps nothing", () => {
        const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
        const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
        document.body.innerHTML = '<div id="p"><details open data-section="a"></details></div>';
        const p = document.getElementById("p");
        expect(() => viewer.foldSections(document, p, "test.folded")).not.toThrow();
        p.querySelector("details").open = false;
        expect(() => p.querySelector("details").dispatchEvent(new Event("toggle"))).not.toThrow();
        spy.mockRestore();
        set.mockRestore();
    });

    it("uses Enter and Esc only while a shape is being drawn and the focus is not in a field", () => {
        const drawing = {tool: () => "area", finish: jest.fn(), stop: jest.fn()};
        const ev = (key, target, more) => Object.assign({key, target: target || document.body, preventDefault: jest.fn()}, more);
        document.body.innerHTML = "<input>";
        expect(measure.drawingKey(ev("Enter"), drawing)).toBe(true);
        expect(drawing.finish).toHaveBeenCalledTimes(1);
        expect(measure.drawingKey(ev("Escape"), drawing)).toBe(true);
        expect(drawing.stop).toHaveBeenCalledTimes(1);
        expect(measure.drawingKey(ev("Enter", document.querySelector("input")), drawing)).toBe(false);
        expect(measure.drawingKey(ev("Enter", null, {ctrlKey: true}), drawing)).toBe(false);
        expect(measure.drawingKey(ev("a"), drawing)).toBe(false);
        expect(measure.drawingKey(ev("Enter"), {tool: () => null})).toBe(false);
        expect(measure.drawingKey(ev("Enter"), null)).toBe(false);
        expect(drawing.finish).toHaveBeenCalledTimes(1);
    });
});

describe("comparing two mosaics", () => {
    const API = "/api/conversions/";
    const BOUNDS = [-88.1, 42.1, -88.0, 42.2];
    const PALETTES = [{key: "dji_ironred", label: "DJI ironred", color_map: [0x000000ff, 0xffffffff]},
                      {key: "magma", label: "Magma", color_map: [0x000000ff, 0xff0000ff]}];
    const DIVERGING = [{key: "rdbu", label: "Red–blue", color_map: [0x0000ffff, 0xff0000ff]},
                       {key: "coolwarm", label: "Cool–warm", color_map: [0x0000ffff, 0xff0000ff]}];
    const COMPARABLE = [{id: 9, name: "Nadir", dataset: 5, dataset_name: "Roof", unit: "C", tabs: ["as_converted", "harmonized"]},
                        {id: 12, name: "Oblique", dataset: 6, dataset_name: "Shed", unit: "F", tabs: ["as_converted"]}];
    const TAB = (tab, percentiles) => ({tab, bounds: BOUNDS, maxzoom: 22, stats: {min: 0, max: 100, percentiles}});
    const MOSAICS = {
        9: {unit: "C", palettes: PALETTES, default_palette: "dji_ironred",
            tabs: [TAB("as_converted", [15.43, 26.08]), TAB("harmonized", [15.51, 25.65])]},
        // °F: 15.56 to 26.67 °C
        12: {unit: "F", palettes: PALETTES, default_palette: "dji_ironred", tabs: [TAB("as_converted", [60, 80])]}
    };
    const DIFFERENCE = {unit: "C", bounds: BOUNDS, stats: {mean: 0.4}, range: [-2.34, 2.34], palettes: DIVERGING};
    const AT = {lat: 42.15, lng: -88.05};
    const POINT_A = {valid: true, temperature: 21.5, frame: "thermal/a_T.JPG", frame_pixel: [319, 255]};
    const POINT_B = {valid: true, temperature: 70, frame: "thermal/b_T.JPG", frame_pixel: null};
    const ROUTES = (more) => Object.assign({
        // A list is a queue of responses to the server: one response, the list
        [API + "9/comparable"]: [COMPARABLE],
        [API + "9/mosaics"]: MOSAICS[9],
        [API + "12/mosaics"]: MOSAICS[12],
        [API + "9/mosaics/as_converted/difference?b=12&b_tab=as_converted"]: DIFFERENCE,
        [API + "9/mosaics/as_converted/point?lon=-88.05&lat=42.15"]: POINT_A,
        [API + "12/mosaics/as_converted/point?lon=-88.05&lat=42.15"]: POINT_B
    }, more);
    // The last URL of the layer showing a conversion's mosaic (or a difference)
    const layerUrl = (L, part) => {
        const urls = [].concat(...L.layers.filter(l => l.urls.some(u => u.indexOf(part) >= 0)).map(l => l.urls));
        return urls[urls.length - 1];
    };
    const pane = n => document.getElementById("ta-compare-" + n);
    const control = (where, k) => document.querySelector('[data-style="' + where + '"] [data-k="' + k + '"]');
    // The difference is drawn once its range is known
    const changeDiff = async el => { change(el); await ticks(); };
    const open = async (search, routes) => {
        const L = fakeLeaflet(), fetchFn = server(ROUTES(routes));
        const c = compare.init({doc: document, fetchFn, L, basemaps: [], search: search || ""});
        await c.ready;
        await ticks();
        return {L, fetchFn, c};
    };

    beforeEach(() => {
        delete window.__temperatureUnit;
        document.body.innerHTML = page("compare.html");
    });

    it("reads and writes the view kept in the URL", () => {
        expect(compare.readCompare("?b=12&a=7&a_tab=harmonized&b_tab=as_converted&diff=b&split=95"))
            .toEqual({a: 7, b: 12, a_tab: "harmonized", b_tab: "as_converted", diff: "b", split: 80});
        expect(compare.readCompare("?b=x&diff=c&split=")).toEqual({});
        expect(compare.clampSplit(3)).toBe(20);
        expect(compare.clampSplit(42.4)).toBe(42);
        expect(compare.compareQuery({a: 9, b: 12, a_tab: "as_converted", b_tab: "harmonized", diff: "", split: 50}, 9))
            .toBe("?b=12&a_tab=as_converted&b_tab=harmonized");
        expect(compare.compareQuery({a: 7, b: 12, a_tab: "as_converted", b_tab: "harmonized", diff: "a", split: 30}, 9))
            .toBe("?b=12&a=7&a_tab=as_converted&b_tab=harmonized&diff=a&split=30");
    });

    it("lists the mosaics by dataset and works out the ranges and URLs", () => {
        const html = compare.mosaicOptionsHtml(COMPARABLE, "12:as_converted");
        expect(html).toContain('<optgroup label="Roof"><option value="9:as_converted">Nadir · ');
        expect(html).toContain('<optgroup label="Shed"><option value="12:as_converted" selected>Oblique · ');
        // The range that holds both mosaics' Auto ranges, in the user's unit (°C)
        expect(compare.autoRange([{tab: MOSAICS[9].tabs[0], unit: "C"}, {tab: MOSAICS[12].tabs[0], unit: "F"}])).toEqual([15.4, 26.7]);
        expect(compare.autoRange([{tab: null, unit: "C"}])).toEqual([0, 1]);
        expect(compare.autoReach(DIFFERENCE)).toBe(2.4);
        expect(compare.autoReach({range: [-0.01, 0.01], unit: "C"})).toBe(0.1);
        expect(compare.autoReach({range: null})).toBe(1);
        expect(compare.differenceTileUrl("/api/", 9, "as_converted", 12, "as_converted", {palette: "rdbu", reach: 2.4}, "C"))
            .toBe("/api/conversions/9/mosaics/as_converted/difference/tiles/{z}/{x}/{y}?b=12&b_tab=as_converted&color_map=rdbu&rescale=-2.4,2.4");
        // A difference of 1 °C is 1.8 °F for a conversion in °F
        expect(compare.differenceTileUrl("/api/", 12, "as_converted", 9, "as_converted", {palette: "rdbu", reach: 1}, "F"))
            .toContain("&rescale=-1.8,1.8");
        expect(compare.frameImageUrl("/api/", 9, "thermal/a_T.JPG", {palette: "magma", range: [15, 25], adjust: {gamma: 2}}, "C"))
            .toBe("/api/conversions/9/frame/image.png?frame=thermal%2Fa_T.JPG&color_map=magma&rescale=15,25&gamma=2");
        const values = compare.differenceReadoutHtml(POINT_A, {valid: true, temperature: 68}, "C", "F");
        expect(values).toContain("<th>A − B</th><td>+1.50 °C</td>");
        expect(compare.differenceReadoutHtml(POINT_A, {valid: false, reason: "outside_raster"}, "C", "F"))
            .toContain("<th>B</th><td>outside the mosaic</td></tr><tr><th>A − B</th><td>no data</td>");
    });

    it("shows the page's conversion beside the other one, in one palette and range", async () => {
        const {L} = await open();
        expect(document.getElementById("ta-compare-main").hidden).toBe(false);
        expect(pane("a").querySelector('[data-k="mosaic"]').value).toBe("9:as_converted");
        expect(pane("b").querySelector('[data-k="mosaic"]').value).toBe("12:as_converted");
        expect(layerUrl(L, "9/mosaics")).toBe(API + "9/mosaics/as_converted/tiles/{z}/{x}/{y}?color_map=dji_ironred&rescale=15.4,26.7");
        // The same range, in °F for the conversion in °F
        expect(layerUrl(L, "12/mosaics")).toMatch(/12\/mosaics\/as_converted\/tiles\/\{z\}\/\{x\}\/\{y\}\?color_map=dji_ironred&rescale=59.7\d*,80.0\d*$/);
        expect(document.getElementById("ta-compare-shared").hidden).toBe(false);
        expect(control("shared", "min").value).toBe("15.4");
        expect(pane("a").querySelector(".ta-compare-style").hidden).toBe(true);
        expect(L.maps[0].fitBounds).toHaveBeenCalledWith([[42.1, -88.1], [42.2, -88.0]]);
        expect(L.maps[1].setView).toHaveBeenCalled();
    });

    it("compares two mosaics of the same conversion when no other one is given", async () => {
        document.getElementById("ta-compare").setAttribute("data-b", "9");
        await open();
        expect(pane("a").querySelector('[data-k="mosaic"]').value).toBe("9:as_converted");
        expect(pane("b").querySelector('[data-k="mosaic"]').value).toBe("9:harmonized");
    });

    it("says so when the conversion has no mosaics to compare", async () => {
        await open("", {[API + "9/comparable"]: [[COMPARABLE[1]]]});
        expect(document.getElementById("ta-compare-status").textContent).toBe("This conversion has no mosaics to compare.");
        expect(document.getElementById("ta-compare-main").hidden).toBe(true);
    });

    it("moves the split by dragging or with the arrow keys, between 20 and 80 %, and keeps it in the URL", async () => {
        const {L} = await open("?b=12&split=30");
        expect(pane("a").style.flexBasis).toBe("30%");
        const handle = document.getElementById("ta-compare-split");
        handle.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
        expect(pane("a").style.flexBasis).toBe("35%");
        expect(window.location.search).toBe("?b=12&a_tab=as_converted&b_tab=as_converted&split=35");
        expect(L.maps[0].invalidateSize).toHaveBeenCalled();
        document.getElementById("ta-compare-body").getBoundingClientRect = () => ({left: 100, width: 1000});
        handle.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
        expect(document.getElementById("ta-compare").classList.contains("ta-compare-dragging")).toBe(true);
        document.dispatchEvent(new MouseEvent("mousemove", {clientX: 1050, bubbles: true}));
        expect(pane("a").style.flexBasis).toBe("80%");
        document.dispatchEvent(new MouseEvent("mousemove", {clientX: 600, bubbles: true}));
        expect(pane("a").style.flexBasis).toBe("50%");
        expect(window.location.search).toBe("?b=12&a_tab=as_converted&b_tab=as_converted");
        document.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
        expect(document.getElementById("ta-compare").classList.contains("ta-compare-dragging")).toBe(false);
        document.dispatchEvent(new MouseEvent("mousemove", {clientX: 300, bubbles: true}));
        expect(pane("a").style.flexBasis).toBe("50%");
    });

    it("pans and zooms both panes together until they are unlinked", async () => {
        const {L} = await open();
        L.maps[1].setView.mockClear();
        L.maps[0].handlers.moveend();
        expect(L.maps[1].setView).toHaveBeenCalledWith([0, 0], 0, {animate: false});
        L.maps[1].handlers.moveend();
        expect(L.maps[0].setView).toHaveBeenCalledTimes(1);
        click(document.getElementById("ta-compare-link"));
        expect(document.getElementById("ta-compare-link").textContent).toContain("Unlinked");
        L.maps[1].setView.mockClear();
        L.maps[0].handlers.moveend();
        expect(L.maps[1].setView).not.toHaveBeenCalled();
        // Linked again: B goes to where A is
        click(document.getElementById("ta-compare-link"));
        expect(L.maps[1].setView).toHaveBeenCalledTimes(1);
    });

    it("marks the cursor in the other pane and gives each pane its own readout", async () => {
        const {L} = await open();
        L.maps[0].handlers.mousemove({latlng: AT});
        const cursor = L.shapes[0];
        expect(cursor.where).toBe(AT);
        expect(cursor.addTo).toHaveBeenCalledWith(L.maps[1]);
        L.maps[0].handlers.mousemove({latlng: {lat: 42.16, lng: -88.05}});
        expect(L.shapes.length).toBe(1);
        expect(cursor.setLatLng).toHaveBeenCalledWith({lat: 42.16, lng: -88.05});
        // The readouts wait for the cursor to rest
        jest.useFakeTimers();
        L.maps[0].handlers.mousemove({latlng: AT});
        jest.advanceTimersByTime(150);
        await ticks();
        expect(pane("a").querySelector(".ta-compare-readout").textContent).toContain("21.5");
        expect(pane("b").querySelector(".ta-compare-readout").textContent).toContain("21.1");
        L.maps[0].handlers.mouseout();
        expect(L.maps[1].removeLayer).toHaveBeenCalledWith(cursor);
        expect(pane("b").querySelector(".ta-compare-readout").textContent).toBe("Move the cursor over a mosaic.");
    });

    it("gives each pane its own palette and range once unlocked", async () => {
        const {L} = await open();
        change(Object.assign(control("shared", "palette"), {value: "magma"}));
        expect(layerUrl(L, "9/mosaics")).toContain("color_map=magma");
        expect(layerUrl(L, "12/mosaics")).toContain("color_map=magma");
        click(document.getElementById("ta-compare-lock"));
        expect(document.getElementById("ta-compare-shared").hidden).toBe(true);
        expect(pane("a").querySelector(".ta-compare-style").hidden).toBe(false);
        // Each pane starts from the shared style
        expect(control("b", "palette").value).toBe("magma");
        change(Object.assign(control("b", "palette"), {value: "dji_ironred"}));
        control("b", "min").value = "20";
        change(control("b", "min"));
        expect(layerUrl(L, "12/mosaics")).toMatch(/color_map=dji_ironred&rescale=68,80.0\d*$/);
        expect(layerUrl(L, "9/mosaics")).toContain("color_map=magma&rescale=15.4,26.7");
        control("a", "max").value = "10";
        change(control("a", "max"));
        expect(control("a", "error").textContent).toMatch(/above the minimum/);
        click(control("a", "auto"));
        expect(control("a", "max").value).toBe("26.1");
        expect(layerUrl(L, "9/mosaics")).toContain("rescale=15.4,26.1");
        control("a", "gamma").value = "1";
        input(control("a", "gamma"));
        expect(layerUrl(L, "9/mosaics")).toContain("&gamma=2");
        // Locked again: the shared style once more
        click(document.getElementById("ta-compare-lock"));
        expect(layerUrl(L, "12/mosaics")).toContain("color_map=magma");
    });

    it("shows the difference of the two mosaics in its own diverging palette and range", async () => {
        const {L} = await open();
        change(Object.assign(pane("b").querySelector('[data-k="show"]'), {value: "diff"}));
        await ticks();
        expect(layerUrl(L, "difference")).toBe(API + "9/mosaics/as_converted/difference/tiles/{z}/{x}/{y}?b=12&b_tab=as_converted&color_map=rdbu&rescale=-2.4,2.4");
        expect(window.location.search).toContain("&diff=b");
        // A keeps the shared style; the difference its own
        expect(document.getElementById("ta-compare-shared").hidden).toBe(false);
        expect(control("b", "reach").value).toBe("2.4");
        control("b", "reach").value = "1";
        await changeDiff(control("b", "reach"));
        expect(layerUrl(L, "difference")).toContain("&rescale=-1,1");
        control("b", "reach").value = "0";
        await changeDiff(control("b", "reach"));
        expect(control("b", "error").textContent).toMatch(/above 0/);
        await changeDiff(Object.assign(control("b", "palette"), {value: "coolwarm"}));
        expect(layerUrl(L, "difference")).toContain("color_map=coolwarm&rescale=-1,1");
        click(control("b", "auto"));
        await ticks();
        expect(layerUrl(L, "difference")).toContain("&rescale=-2.4,2.4");
        // The difference in A: B shows its mosaic again
        change(Object.assign(pane("a").querySelector('[data-k="show"]'), {value: "diff"}));
        await ticks();
        expect(pane("b").querySelector('[data-k="show"]').value).toBe("mosaic");
        expect(window.location.search).toContain("&diff=a");
    });

    it("says so when the two mosaics do not overlap", async () => {
        await open("?b=12&diff=b", {[API + "9/mosaics/as_converted/difference?b=12&b_tab=as_converted"]:
            {unit: "C", bounds: null, stats: null, range: null, palettes: DIVERGING}});
        const note = pane("b").querySelector(".ta-compare-note");
        expect(note.hidden).toBe(false);
        expect(note.textContent).toBe("These mosaics do not overlap.");
    });

    it("shows the source frame of a point picked in a pane, its pixel marked, below the map", async () => {
        const {L} = await open();
        // Clicks only pick while picking
        L.maps[0].handlers.click({latlng: AT});
        expect(pane("a").querySelector(".ta-compare-pick").hidden).toBe(true);
        click(pane("a").querySelector('[data-k="pick"]'));
        expect(pane("a").classList.contains("ta-compare-picking")).toBe(true);
        L.maps[0].handlers.click({latlng: AT});
        await ticks();
        const sub = pane("a").querySelector(".ta-compare-pick");
        expect(sub.hidden).toBe(false);
        expect(sub.textContent).toContain("21.50 °C");
        expect(sub.textContent).toContain("thermal/a_T.JPG");
        const img = sub.querySelector("img");
        expect(img.getAttribute("src")).toBe(API + "9/frame/image.png?frame=thermal%2Fa_T.JPG&color_map=dji_ironred&rescale=15.4,26.7");
        expect(sub.querySelector("a").getAttribute("href")).toBe("/conversion/9/frame?frame=thermal%2Fa_T.JPG");
        const mark = sub.querySelector(".ta-compare-mark");
        expect(mark.hidden).toBe(true);
        Object.defineProperty(img, "naturalWidth", {value: 640});
        Object.defineProperty(img, "naturalHeight", {value: 512});
        img.dispatchEvent(new Event("load"));
        expect(mark.hidden).toBe(false);
        expect(mark.style.left).toBe("49.92%");
        expect(parseFloat(mark.style.top)).toBe(49.9);     // jsdom writes 49.90% as 49.9%
        const marker = L.shapes[L.shapes.length - 1];
        expect(marker.addTo).toHaveBeenCalledWith(L.maps[0]);
        // Picking again moves the mark; the palette shared is the frame's too
        L.maps[0].handlers.click({latlng: AT});
        await ticks();
        expect(marker.setLatLng).toHaveBeenCalledWith(AT);
        change(Object.assign(control("shared", "palette"), {value: "magma"}));
        expect(pane("a").querySelector(".ta-compare-pick img").getAttribute("src")).toContain("color_map=magma");
        // B's pick is its own, and without the pixel says how to get it
        expect(pane("b").querySelector(".ta-compare-pick").hidden).toBe(true);
        click(pane("b").querySelector('[data-k="pick"]'));
        L.maps[1].handlers.click({latlng: AT});
        await ticks();
        const subB = pane("b").querySelector(".ta-compare-pick");
        expect(subB.querySelector(".ta-compare-mark")).toBe(null);
        expect(subB.textContent).toContain("build this conversion's mosaics again");
        expect(subB.querySelector("img").getAttribute("src")).toContain(API + "12/frame/image.png?frame=thermal%2Fb_T.JPG");
        click(sub.querySelector('[data-k="close"]'));
        expect(sub.hidden).toBe(true);
        expect(L.maps[0].removeLayer).toHaveBeenCalledWith(marker);
        expect(subB.hidden).toBe(false);
    });

    it("shows A's and B's frames for a point picked in the difference", async () => {
        const {L} = await open("?b=12&diff=b");
        click(pane("b").querySelector('[data-k="pick"]'));
        L.maps[1].handlers.click({latlng: AT});
        await ticks();
        const titles = [...pane("b").querySelectorAll(".ta-compare-frame-title")].map(t => t.textContent);
        expect(titles).toEqual(["A · Roof · Nadir", "B · Shed · Oblique"]);
        expect(pane("b").querySelectorAll(".ta-compare-frame img").length).toBe(2);
    });
});
