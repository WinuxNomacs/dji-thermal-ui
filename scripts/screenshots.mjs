// The documentation's screenshots: npm run screenshots -- IMAGES [--port 8081] [--keep DIR] [--headed]
//
// IMAGES is a folder of one flight's R-JPEGs (with its visual images beside them). The script starts the app on its
// own port with a scratch data and config folder (never an instance you run), does the Quickstart's tasks as a
// first-time user (a project, a flight, its images, the analysis, a dataset, its mosaics, a measurement, a finding,
// the reports, an export), and shoots the pages as it goes into docs/assets/screenshots/ (light, 1280 × 800). It
// then stops its server by its PID and deletes the scratch folders.
//
// No place may show: the maps have no basemap, the project no location, and before each shot the page's text is
// searched for the flight's latitude and longitude, failing the run if either is there.
//
// --keep DIR keeps the data folder in DIR; run again with the same DIR, the project, flight and dataset made the
// first time are used as they are, and only the shots after them are made again.
import {spawn} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {chromium} from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "assets", "screenshots");
const PROJECT = "Riverside warehouse", FLIGHT = "Roof, October";
const SIZE = {width: 1280, height: 800};

const {values: opts, positionals} = parseArgs({allowPositionals: true, options: {
    port: {type: "string", default: "8081"}, keep: {type: "string"}, headed: {type: "boolean"}}});
if (positionals.length !== 1 || !existsSync(positionals[0])) {
    console.error("usage: npm run screenshots -- IMAGES [--port 8081] [--keep DIR] [--headed]");
    process.exit(2);
}
const images = resolve(positionals[0]);
const base = `http://127.0.0.1:${opts.port}/`;

// The scratch folders: the config and the folder the server starts in (so that no .env of yours is read) always
// new; the data folder new unless kept
const scratch = mkdtempSync(join(tmpdir(), "dji-thermal-ui-shots-"));
const dataDir = opts.keep ? resolve(opts.keep) : join(scratch, "data");
const configDir = join(scratch, "config");
mkdirSync(dataDir, {recursive: true});
mkdirSync(configDir);
// The data folder as a move from the Storage page leaves it (the page then offers to move it), not by the environment
writeFileSync(join(configDir, "data-dir"), dataDir + "\n");
// What the shots show of it: the folder Linux has by default
const SHOWN_DATA_DIR = "/home/you/.local/share/dji-thermal-ui";
mkdirSync(OUT, {recursive: true});

const log = (...a) => console.log("·", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The server: the environment's own command, so the PID stopped is the server's
function startServer() {
    const exe = process.platform === "win32" ? join(ROOT, ".venv", "Scripts", "dji-thermal-ui.exe") :
        join(ROOT, ".venv", "bin", "dji-thermal-ui");
    if (!existsSync(exe)) throw new Error(`no ${exe}: run uv sync (or ./dji-thermal-ui.sh build) first`);
    const child = spawn(exe, ["--port", opts.port, "--no-browser"], {
        cwd: scratch, stdio: ["ignore", "inherit", "inherit"],
        env: {...process.env, DJI_THERMAL_UI_DATA_DIR: "", DJI_THERMAL_UI_CONFIG_DIR: configDir,
              MAPBOX_API_TOKEN: "", WEBODM_URL: "", WEBODM_USERNAME: "", WEBODM_PASSWORD: ""}});
    return child;
}

async function stopServer(child) {
    if (child.exitCode !== null) return;
    const exited = new Promise((r) => child.once("exit", r));
    process.kill(child.pid, process.platform === "win32" ? undefined : "SIGINT");
    if (await Promise.race([exited.then(() => true), sleep(20000).then(() => false)])) return;
    process.kill(child.pid, "SIGKILL");
    await exited;
}

async function waitUp() {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(base)).ok) return;
        } catch {
            // not listening yet
        }
        await sleep(500);
    }
    throw new Error(`the app did not start on ${base}`);
}

// The API, from the page (its CSRF cookie)
async function api(page, path, method = "GET", body) {
    return page.evaluate(async ([url, method, body]) => {
        const token = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
        const r = await fetch(url, {method, headers: {"Content-Type": "application/json", "X-CSRFToken": token},
                                    body: body === undefined ? undefined : JSON.stringify(body)});
        const text = await r.text();
        if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${text.slice(0, 300)}`);
        return text ? JSON.parse(text) : null;
    }, [base + "api/" + path, method, body]);
}

async function until(what, test, minutes = 30) {
    const end = Date.now() + minutes * 60000;
    for (;;) {
        const v = await test();
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await sleep(2000);
    }
}

// What may not show: the flight's place, as the pages could write it (each latitude and longitude to two decimals
// followed by a third digit, with either decimal mark), which fails the shot; and the drone's serial numbers, masked
let place = null;
const serials = new Set();
function learnSecrets(flight) {
    const parts = new Set();
    for (const f of flight.analysis?.files || []) {
        for (const v of [f.lat, f.lon]) {
            if (typeof v === "number") parts.add(Math.trunc(Math.abs(v) * 100) / 100);
        }
    }
    (function walk(o, key) {
        if (Array.isArray(o)) o.forEach((v) => walk(v, key));
        else if (o && typeof o === "object") Object.entries(o).forEach(([k, v]) => walk(v, k));
        else if (typeof o === "string" && /serial/i.test(key) && o.length >= 4) serials.add(o);
    })(flight, "");
    if (parts.size) {
        place = new RegExp(`(?<!\\d)(?:${[...parts].map((p) => p.toFixed(2).replace(".", "[.,]")).join("|")})\\d`);
    }
}

async function guard(page, name) {
    const swaps = [...[...serials].map((s) => [s, "••••••••"]), [dataDir, SHOWN_DATA_DIR]];
    await page.evaluate((swaps) => {
        const mask = (t) => swaps.reduce((t, [from, to]) => t.split(from).join(to), t);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (swaps.some(([from]) => n.nodeValue.includes(from))) n.nodeValue = mask(n.nodeValue);
        }
        document.querySelectorAll("input:not([type=file]), textarea").forEach((e) => {
            if (mask(e.value) !== e.value) e.value = mask(e.value);
        });
    }, swaps);
    const text = await page.evaluate(() => document.body.innerText + "\n" +
        [...document.querySelectorAll("input, textarea")].map((e) => e.value).join("\n"));
    const m = place && text.match(place);
    if (m) throw new Error(`${name}: the page shows the flight's place ("${m[0]}"); hide it before shooting`);
    const s = [...serials, dataDir].find((x) => text.includes(x));
    if (s) throw new Error(`${name}: the page still shows a serial number or the scratch folder`);
}

const shots = [];
// A shot of the window, of an element (target: a selector), or of the whole page
async function shot(page, name, {target, fullPage = false} = {}) {
    await page.evaluate(() => document.fonts.ready);
    await guard(page, name);
    const path = join(OUT, name + ".png");
    if (target) await page.locator(target).first().screenshot({path});
    else await page.screenshot({path, fullPage});
    shots.push(name);
    log("shot", name);
}

// A page loaded afresh (a link that only changes the #tab would not reload it)
async function open(page, path) {
    await page.goto("about:blank");
    await page.goto(base + path);
    await page.waitForLoadState("networkidle");
}

// The project, the flight with its images analyzed, and its dataset with its mosaics, made through the pages
async function make(page) {
    await open(page, "");
    await shot(page, "projects-empty");
    await page.click("#new-project-button");
    await page.fill("#project-name", PROJECT);
    await page.fill("#project-description", "The roof of the east building, surveyed after the October storm.");
    await shot(page, "new-project", {target: ".dialog-inner"});
    await page.click("#project-save");
    await page.waitForURL(/project\/\d+$/);
    await page.waitForLoadState("networkidle");
    await shot(page, "project-empty");

    await page.click("#new-dataset-button");
    await page.fill("#new-name", FLIGHT);
    const files = readdirSync(images).filter((f) => /\.(jpe?g|mp4)$/i.test(f)).sort().map((f) => join(images, f));
    log(files.length, "files to upload");
    await page.setInputFiles("#new-files", files);
    await shot(page, "new-flight", {target: ".dialog-inner"});
    await page.click("#new-create");
    await page.waitForSelector("#new-progress");
    await sleep(1500);
    await shot(page, "new-flight-uploading", {target: ".dialog-inner"});
    await page.waitForURL(/dataset\/\d+$/, {timeout: 30 * 60000});
    const flight = Number(page.url().match(/dataset\/(\d+)$/)[1]);
    await sleep(3000);
    await shot(page, "flight-analyzing");
    log("analyzing flight", flight);
    const analyzed = await until("the analysis", async () => {
        const d = await api(page, `datasets/${flight}`);
        if (d.status === "failed") throw new Error("the analysis failed");
        return d.status === "ready" && d;
    });
    learnSecrets(analyzed);
    return flight;
}

async function convert(page, flight) {
    await open(page, `dataset/${flight}`);
    await shot(page, "flight-analyzed");
    await page.click("#next-convert");
    await settled(page, 1000);
    await shot(page, "datasets-new");
    await page.click("#convert-start");
    await sleep(4000);
    await shot(page, "datasets-converting");
    log("converting");
    const conv = await until("the dataset and its mosaics", async () => {
        const list = await api(page, `datasets/${flight}/conversions`);
        const c = (list.conversions || list)[0];
        if (!c) return null;
        if (c.status === "failed" || c.mosaic_status === "failed") throw new Error("the conversion failed");
        return c.status === "ready" && c.mosaic_status === "ready" && c;
    }, 90);
    return conv.id;
}

// A page whose maps and figures are drawn: no request left, then a moment for WebGL
async function settled(page, ms = 2500) {
    await page.waitForLoadState("networkidle");
    await sleep(ms);
}

// The pages once the dataset is there: the flight's tabs, the viewer, a measurement and a finding, the reports, the
// frames explorer, compare, an export and the settings pages
async function explore(page, project, flight, conversion) {
    // A kept data folder's findings from an earlier run, deleted so that the one kept below is alone
    const found = await api(page, `datasets/${flight}/findings`);
    for (const f of found.findings || found) await api(page, `datasets/${flight}/findings/${f.id}`, "DELETE");
    await open(page, "");
    await shot(page, "projects");
    await open(page, `project/${project}`);
    await settled(page);
    await shot(page, "project");

    await open(page, `dataset/${flight}#files`);
    await settled(page);
    await shot(page, "flight-files");
    await page.hover("table.files tbody tr:nth-child(3) td:first-child");
    await settled(page, 1000);
    await shot(page, "flight-file-pane");
    await open(page, `dataset/${flight}#problems`);
    await shot(page, "flight-problems");
    await open(page, `dataset/${flight}#datasets`);
    await shot(page, "datasets");

    await open(page, `conversion/${conversion}`);
    await settled(page, 4000);
    await shot(page, "viewer");
    // A box over the middle of the map, measured
    const box = await page.locator("#map").boundingBox();
    const cx = box.x + box.width * 0.33, cy = box.y + box.height * 0.55;
    await page.click('[data-tool="box"]');
    await page.mouse.move(cx - 40, cy - 30);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, {steps: 10});
    await page.mouse.up();
    await page.waitForSelector("#measure-card .measure-card-actions");
    await settled(page, 1500);
    await shot(page, "viewer-measure");
    await page.click('#measure-card [name="keep-finding"]');
    await page.waitForSelector("#finding-name");
    await page.fill("#finding-name", "Damp patch by the north drain");
    await page.fill("#finding-notes", "Cooler than the roof around it: check the membrane for trapped moisture.");
    await page.selectOption("#finding-severity", {index: 2});
    await settled(page, 1500);
    await shot(page, "finding-form");
    await page.click('.dialog button[type="submit"]');
    await settled(page, 2000);
    await shot(page, "viewer-finding");

    await open(page, `conversion/${conversion}?tab=harmonized`);
    await settled(page, 4000);
    await page.click("#export");
    await page.waitForSelector("#export-dialog");
    await shot(page, "export-mosaic", {target: "#export-dialog .dialog-inner"});
    await page.click("#export-cancel");
    await page.click("#report");
    await page.waitForURL(/report/);
    await page.waitForSelector("#print:not([disabled])", {timeout: 180000});
    await settled(page);
    await shot(page, "mosaic-report");

    await open(page, `dataset/${flight}/report`);
    await page.waitForSelector("#print:not([disabled])", {timeout: 180000});
    await settled(page);
    await shot(page, "flight-report");

    await open(page, `conversion/${conversion}/frame`);
    await settled(page, 4000);
    await shot(page, "frames");

    await open(page, `conversion/${conversion}/compare?b=${conversion}&a_tab=visual&b_tab=harmonized&overlay=a` +
               "&opacity=60&swipe=50");
    await settled(page, 5000);
    await shot(page, "compare-overlay");
    // A line drawn in pane B, measured on both mosaics
    await open(page, `conversion/${conversion}/compare?b=${conversion}&a_tab=as_converted&b_tab=harmonized`);
    await settled(page, 5000);
    const pane = await page.locator("#map-b").boundingBox();
    const px = pane.x + pane.width * 0.3, py = pane.y + pane.height * 0.8;
    await page.click('#pane-b [data-tool="line"]');
    await page.mouse.click(px - 60, py + 20);
    await page.waitForTimeout(600);
    await page.mouse.click(px + 60, py - 20);
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    await page.waitForSelector("#pane-b #measure-card .measure-result");
    await settled(page, 1500);
    await shot(page, "compare-measure");

    await open(page, `dataset/${flight}#files`);
    await page.click("#export-frames");
    await page.waitForSelector("#export-dialog");
    await shot(page, "export-frames", {target: "#export-dialog .dialog-inner"});
    await page.click("#export-cancel");

    for (const [path, name] of [["preferences", "preferences"], ["settings", "settings"],
                                ["settings/storage", "storage"]]) {
        await open(page, path);
        await settled(page, 1000);
        await shot(page, name);
    }
    await open(page, "settings");
    await shot(page, "settings-mapbox", {target: 'fieldset:has(legend:text-is("Mapbox Satellite"))'});
    await shot(page, "settings-webodm", {target: 'fieldset:has(legend:text-is("WebODM"))'});
}

const child = startServer();
let failed = false;
try {
    await waitUp();
    const browser = await chromium.launch({headless: !opts.headed});
    const context = await browser.newContext({viewport: SIZE, colorScheme: "light", deviceScaleFactor: 1});
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, "");
    await api(page, "preferences", "PUT", {theme: "light", basemap: "none", palette: "ironbow"});

    const projects = (await api(page, "projects")).projects;
    let project = projects.find((p) => p.name === PROJECT);
    let flight, conversion;
    if (!project) {
        flight = await make(page);
        conversion = await convert(page, flight);
    } else {
        const flights = (await api(page, "datasets")).datasets;
        flight = flights.find((d) => d.project === project.id && d.name === FLIGHT).id;
        const d = await api(page, `datasets/${flight}`);
        learnSecrets(d);
        const list = await api(page, `datasets/${flight}/conversions`);
        const made = (list.conversions || list)[0];
        conversion = made && made.mosaic_status === "ready" ? made.id : await convert(page, flight);
        log("using flight", flight, "and dataset", conversion);
    }
    if (!place) throw new Error("the flight's frames have no position: nothing to hide, or not analyzed");
    project = (await api(page, "projects")).projects.find((p) => p.name === PROJECT);
    log("project", project.id, "flight", flight, "dataset", conversion);
    await explore(page, project.id, flight, conversion);

    await browser.close();
    if (errors.length) throw new Error("page errors: " + errors.join("; "));
    log(shots.length, "shots in", OUT);
} catch (e) {
    failed = true;
    console.error(e);
} finally {
    await stopServer(child);
    rmSync(scratch, {recursive: true, force: true});
}
process.exit(failed ? 1 : 0);
