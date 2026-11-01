import {render} from "preact";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ACCOUNT_NAME, generatePassword, MODEL_PERMISSIONS, type WebODMState, WebODMSettings} from "../src/settings/webodm-settings";
import {calls, jsonResponse, server, ticks} from "./helpers";

const FILE = "/home/me/.local/share/dji-thermal-ui/.env";
const URL = "http://127.0.0.1:8001";
const UNSET: WebODMState = {url: null, username: null, password: false, unreadable: false, configured: false, source: null, file: FILE};
const SAVED: WebODMState = {url: URL, username: "a…", password: true, unreadable: false, configured: true, source: FILE, file: FILE};
const NODES = [{id: 1, label: "node-odx-1", online: true}, {id: 2, label: "spare:3001", online: false}];

const root = () => document.getElementById("root")!;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim();
const ids = () => [...root().querySelectorAll("#webodm-settings button")].map((b) => b.id);

async function page(fetchFn: ReturnType<typeof server>) {
    vi.stubGlobal("fetch", fetchFn);
    render(<WebODMSettings api="/api/"/>, root());
    await ticks();
    return fetchFn;
}

async function type(sel: string, value: string) {
    const input = $(sel) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await ticks();
}

async function submit() {
    ($("#webodm-save") as HTMLButtonElement).closest("form")!.dispatchEvent(new Event("submit", {cancelable: true}));
    await ticks();
}

const body = (fetchFn: ReturnType<typeof server>, method: string) =>
    JSON.parse(fetchFn.mock.calls.find((c) => c[1]?.method === method)![1]!.body as string);

beforeEach(() => {
    document.cookie = "csrftoken=tok";
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
    render(null, root());
    vi.unstubAllGlobals();
});

describe("System Settings › WebODM", () => {
    it("says what connecting WebODM brings, before its login is asked for", async () => {
        await page(server({"/api/settings/webodm": UNSET}));
        const items = [...root().querySelectorAll(".webodm-benefits li")].map((li) => li.textContent);
        expect(items).toHaveLength(4);
        expect(items[0]).toContain("Process in WebODM");
        expect(items[3]).toContain("orthophoto comes back as temperatures");
    });

    it("saves an address and login WebODM took, lists the nodes the account sees, and never shows the password", async () => {
        const fetchFn = await page(server({"/api/settings/webodm": UNSET,
                                           "PUT /api/settings/webodm": {...SAVED, nodes: NODES}}));
        expect(text("#webodm-state")).toBe("Not set up yet.");
        expect(ids()).toEqual(["webodm-save", "webodm-create"]);
        expect(($("#webodm-save") as HTMLButtonElement).disabled).toBe(true);
        await type("#webodm-url", URL + "/");
        await type("#webodm-username", " admin ");
        expect(($("#webodm-save") as HTMLButtonElement).disabled).toBe(true);
        await type("#webodm-password", "s3cret");
        expect(($("#webodm-password") as HTMLInputElement).type).toBe("password");
        await submit();

        expect(calls(fetchFn)).toEqual(["GET /api/settings/webodm", "PUT /api/settings/webodm"]);
        expect(body(fetchFn, "PUT")).toEqual({url: URL + "/", username: "admin", password: "s3cret"});
        expect(text("#webodm-state")).toBe("The app logs in to " + URL + " as a…, from " + FILE + ".");
        expect(text("#webodm-nodes")).toBe("WebODM took the login. The account sees 2 processing nodes: node-odx-1, "
                                           + "spare:3001 (offline).");
        // The fields are emptied: the saved ones are kept unless typed again
        expect(($("#webodm-password") as HTMLInputElement).value).toBe("");
        expect(($("#webodm-password") as HTMLInputElement).placeholder).toBe("Unchanged");
        expect(($("#webodm-username") as HTMLInputElement).placeholder).toBe("Unchanged (a…)");
        expect(($("#webodm-url") as HTMLInputElement).value).toBe(URL);
        expect(root().innerHTML).not.toContain("s3cret");
        expect(ids()).toEqual(["webodm-save", "webodm-check", "webodm-create", "webodm-remove"]);
    });

    it("asks for a saved password its key can't open to be typed again before saving", async () => {
        await page(server({"/api/settings/webodm": {...SAVED, password: false, unreadable: true, configured: false}}));
        expect(text("#webodm-state")).toBe("The saved password can't be read: type it again.");
        expect(($("#webodm-password") as HTMLInputElement).placeholder).toBe("");
        expect(ids()).toEqual(["webodm-save", "webodm-create", "webodm-remove"]);
        await type("#webodm-url", URL);
        expect(($("#webodm-save") as HTMLButtonElement).disabled).toBe(true);
        await type("#webodm-password", "s3cret");
        expect(($("#webodm-save") as HTMLButtonElement).disabled).toBe(false);
    });

    it("changes the address alone, keeping the saved login", async () => {
        const fetchFn = await page(server({"/api/settings/webodm": SAVED, "PUT /api/settings/webodm": {...SAVED, nodes: []}}));
        await type("#webodm-url", "http://webodm.lan:8000");
        expect(($("#webodm-save") as HTMLButtonElement).disabled).toBe(false);
        await submit();
        expect(body(fetchFn, "PUT")).toEqual({url: "http://webodm.lan:8000", username: "", password: ""});
        expect(text("#webodm-nodes")).toContain("the account sees no processing node: give it Can view Processing Node on a node");
    });

    it("says why WebODM refused the login, keeping what was typed", async () => {
        await page(server({"/api/settings/webodm": UNSET, "PUT /api/settings/webodm":
            () => jsonResponse({error: "WebODM refused the user name and password"}, false)}));
        await type("#webodm-url", URL);
        await type("#webodm-username", "admin");
        await type("#webodm-password", "wrong");
        await submit();
        expect(text("#webodm-error")).toBe("WebODM refused the user name and password");
        expect(($("#webodm-password") as HTMLInputElement).value).toBe("wrong");
        expect(text("#webodm-state")).toBe("Not set up yet.");
    });

    it("checks the saved login", async () => {
        const fetchFn = await page(server({"/api/settings/webodm": SAVED,
                                           "POST /api/settings/webodm/check": {nodes: NODES.slice(0, 1)}}));
        ($("#webodm-check") as HTMLButtonElement).click();
        await ticks();
        expect(calls(fetchFn)).toContain("POST /api/settings/webodm/check");
        expect(text("#webodm-nodes")).toBe("WebODM took the login. The account sees one processing node: node-odx-1.");
    });

    it("removes the login once asked", async () => {
        const fetchFn = await page(server({"/api/settings/webodm": SAVED, "DELETE /api/settings/webodm": UNSET}));
        ($("#webodm-remove") as HTMLButtonElement).click();
        await ticks();
        expect(text("#dialog-title")).toBe("Remove WebODM's login?");
        const cancel = [...document.querySelectorAll<HTMLButtonElement>(".dialog button")].find((b) => b.textContent === "Cancel")!;
        cancel.click();
        await ticks();
        expect(calls(fetchFn)).toEqual(["GET /api/settings/webodm"]);

        ($("#webodm-remove") as HTMLButtonElement).click();
        await ticks();
        [...document.querySelectorAll<HTMLButtonElement>(".dialog button")].find((b) => b.textContent === "Remove")!.click();
        await ticks();
        expect(calls(fetchFn)).toEqual(["GET /api/settings/webodm", "DELETE /api/settings/webodm"]);
        expect(text("#webodm-state")).toBe("Not set up yet.");
        expect(ids()).toEqual(["webodm-save", "webodm-create"]);
    });

    it("shows a login from the environment, which is changed there; it can still be checked", async () => {
        await page(server({"/api/settings/webodm": {...SAVED, source: "environment", file: null}}));
        expect(text("#webodm-state")).toBe("The app logs in to " + URL + " as a…, from the environment it was started "
            + "from (WEBODM_URL, WEBODM_USERNAME, WEBODM_PASSWORD): to change them, change them there.");
        expect($("#webodm-url")).toBeNull();
        expect(ids()).toEqual(["webodm-check"]);
    });

    it("creates the account with an admin's login, used once, then saves it and lists the nodes it sees", async () => {
        const created = {...SAVED, username: "d…", nodes: NODES};
        const fetchFn = await page(server({"/api/settings/webodm": UNSET, "POST /api/settings/webodm/account": created}));
        ($("#webodm-create") as HTMLButtonElement).click();
        await ticks();
        expect($("#webodm-url")).toBeNull();
        expect(($("#webodm-account-username") as HTMLInputElement).value).toBe(ACCOUNT_NAME);
        expect(($("#webodm-account-password") as HTMLInputElement).type).toBe("password");
        const create = () => $("#webodm-account-save") as HTMLButtonElement;
        expect(create().disabled).toBe(true);
        await type("#webodm-account-url", URL);
        await type("#webodm-admin-username", " admin ");
        await type("#webodm-admin-password", "admin pass");
        expect(create().disabled).toBe(true);
        ($("#webodm-generate") as HTMLButtonElement).click();
        await ticks();
        const generated = ($("#webodm-account-password") as HTMLInputElement);
        expect(generated.type).toBe("text");
        expect(generated.value).toMatch(/^[A-Za-z0-9]{32}$/);
        expect(create().disabled).toBe(false);
        create().closest("form")!.dispatchEvent(new Event("submit", {cancelable: true}));
        await ticks();

        expect(calls(fetchFn)).toEqual(["GET /api/settings/webodm", "POST /api/settings/webodm/account"]);
        expect(body(fetchFn, "POST")).toEqual({url: URL, admin_username: "admin", admin_password: "admin pass",
                                               username: ACCOUNT_NAME, password: generated.value});
        // Back to the login form, which shows the account saved
        expect($("#webodm-account-form")).toBeNull();
        expect(text("#webodm-state")).toBe("The app logs in to " + URL + " as d…, from " + FILE + ".");
        expect(text("#webodm-nodes")).toContain("The account sees 2 processing nodes");
        expect(root().innerHTML).not.toContain("admin pass");
    });

    it("says why WebODM did not create the account, keeping what was typed", async () => {
        const refusal = "WebODM already has a user named dji-thermal-ui-api-user. Choose another name, or, to use that "
            + "account, type its password in the login form: the app never changes an existing WebODM account";
        await page(server({"/api/settings/webodm": UNSET,
                           "POST /api/settings/webodm/account": () => jsonResponse({error: refusal}, false)}));
        ($("#webodm-create") as HTMLButtonElement).click();
        await ticks();
        await type("#webodm-account-url", URL);
        await type("#webodm-admin-username", "admin");
        await type("#webodm-admin-password", "admin pass");
        await type("#webodm-account-password", "typed");
        ($("#webodm-account-form") as HTMLFormElement).dispatchEvent(new Event("submit", {cancelable: true}));
        await ticks();
        expect(text("#webodm-error")).toBe(refusal);
        expect(($("#webodm-account-password") as HTMLInputElement).value).toBe("typed");
        expect(text("#webodm-state")).toBe("Not set up yet.");
        ($("#webodm-account-cancel") as HTMLButtonElement).click();
        await ticks();
        expect($("#webodm-error")).toBeNull();
        expect($("#webodm-url")).not.toBeNull();
    });

    it("asks before the created account replaces a saved login", async () => {
        const fetchFn = await page(server({"/api/settings/webodm": SAVED}));
        ($("#webodm-create") as HTMLButtonElement).click();
        await ticks();
        expect(($("#webodm-account-url") as HTMLInputElement).value).toBe(URL);
        await type("#webodm-admin-username", "admin");
        await type("#webodm-admin-password", "admin pass");
        await type("#webodm-account-password", "typed");
        ($("#webodm-account-form") as HTMLFormElement).dispatchEvent(new Event("submit", {cancelable: true}));
        await ticks();
        expect(text("#dialog-title")).toBe("Replace the saved login?");
        [...document.querySelectorAll<HTMLButtonElement>(".dialog button")].find((b) => b.textContent === "Cancel")!.click();
        await ticks();
        expect(calls(fetchFn)).toEqual(["GET /api/settings/webodm"]);
        expect($("#webodm-account-form")).not.toBeNull();
    });

    it("generates long random passwords of letters and digits, a different one each time", () => {
        const made = new Set(Array.from({length: 50}, () => generatePassword()));
        expect(made.size).toBe(50);
        for (const p of made) expect(p).toMatch(/^[A-Za-z0-9]{32}$/);
        expect(generatePassword(8)).toHaveLength(8);
    });

    it("guides an admin through setting up the account in WebODM, with the permissions as its admin names them", async () => {
        await page(server({"/api/settings/webodm": UNSET}));
        const guide = text("#webodm-permissions")!;
        const perms = [...document.querySelectorAll("#webodm-model-permissions li")].map((li) => li.textContent);
        expect(perms).toEqual(MODEL_PERMISSIONS.map(([label, name]) => label + " (" + name + ")"));
        expect(perms).toContain("nodeodm | Processing Node | Can view Processing Node (nodeodm.view_processingnode)");
        for (const step of ["Users › Add user", "Staff status", "Superuser status", "Default group",
                            "Processing nodes › the node › Object permissions", "User identification", "Manage user",
                            "Can view Project", "Can change Project", "Can delete Project", "Check and save"]) {
            expect(guide).toContain(step);
        }
        // No address yet: the admin's pages are named, not linked
        expect($("#webodm-permissions a")).toBeNull();
    });

    it("links the guide to the WebODM admin's pages once the address is known", async () => {
        await page(server({"/api/settings/webodm": SAVED}));
        expect([...document.querySelectorAll<HTMLAnchorElement>("#webodm-permissions a")].map((a) => a.href)).toEqual([
            URL + "/admin/auth/user/add/", URL + "/admin/auth/group/", URL + "/admin/nodeodm/processingnode/",
            URL + "/admin/app/project/"]);
        expect($("#webodm-permissions a")!.getAttribute("rel")).toBe("noopener noreferrer");
    });
});
