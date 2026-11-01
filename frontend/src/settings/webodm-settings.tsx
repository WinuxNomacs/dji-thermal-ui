// System Settings › WebODM: its address and login, checked with a login by the server before they are written to .env
// in place of those there, the password encrypted. The password never comes back: the page says only that one is set
// (or that it can't be read, its key gone with the database), and the user name is shown masked. Those set in the environment (WEBODM_URL, WEBODM_USERNAME, WEBODM_PASSWORD) are shown only: they are
// changed there. The WebODM permissions the account needs are listed below the fields. Create the account makes it in
// WebODM with an admin's login, used for that one request only, and saves it as Check and save does.
import {type ComponentChildren} from "preact";
import {useEffect, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {ask} from "../components/dialog";

export interface WebODMState {
    url: string | null; username: string | null; password: boolean; unreadable: boolean; configured: boolean;
    source: string | null; file: string | null;
}
export interface WebODMNode {id: number; label: string; online: boolean}

// The name the account created here is given unless it is changed (webodm.ACCOUNT_NAME)
export const ACCOUNT_NAME = "dji-thermal-ui-api-user";
const PASSWORD_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// A long random password, from the browser's cryptographic randomness (values past the last whole run of the 62
// characters are drawn again, so each character is as likely)
export function generatePassword(length = 32): string {
    const limit = 256 - 256 % PASSWORD_CHARACTERS.length;
    let out = "";
    while (out.length < length) {
        for (const v of crypto.getRandomValues(new Uint8Array(length))) {
            if (v < limit && out.length < length) out += PASSWORD_CHARACTERS[v % PASSWORD_CHARACTERS.length];
        }
    }
    return out;
}

// The model permissions the account needs, as WebODM's admin lists them under User permissions (and the API names them)
export const MODEL_PERMISSIONS: [string, string][] = [
    ["app | Project | Can add Project", "app.add_project"],
    ["app | Task | Can add Task", "app.add_task"],
    ["app | Task | Can change Task", "app.change_task"],
    ["app | Task | Can delete Task", "app.delete_task"],
    ["app | Preset | Can add Preset", "app.add_preset"],
    ["app | Preset | Can change Preset", "app.change_preset"],
    ["app | Preset | Can delete Preset", "app.delete_preset"],
    ["nodeodm | Processing Node | Can view Processing Node", "nodeodm.view_processingnode"],
];

// A page of WebODM's admin: a link when its address is known, else its path
function AdminPage({url, path, children}: {url: string | null; path: string; children: string}) {
    return url ? <a href={url + path} target="_blank" rel="noopener noreferrer">{children}</a> : <b>{children}</b>;
}

// How an admin sets the account up by hand in WebODM's admin (Administration in its menu), with the names it shows;
// see "ODM" in upcoming-changes.md for where the permissions come from
export function Permissions({url = null}: {url?: string | null}) {
    return (<details class="webodm-permissions" id="webodm-permissions">
        <summary>Setting up the WebODM account, and the permissions it needs</summary>
        <p class="hint">Done by a WebODM admin, in WebODM's Administration{url ? "" : " (its /admin/ pages)"}. The
            names are those its pages show.</p>
        <ol>
            <li><AdminPage url={url} path="/admin/auth/user/add/">Users › Add user</AdminPage> (or <b>Create the
                account</b> above, which does this step and the next with an admin's login): a user name and a
                password, then Save. On the page that follows, leave <b>Active</b> ticked and <b>Staff status</b> and
                {" "}<b>Superuser status</b> unticked: the app needs no more than an ordinary account.</li>
            <li>Its permissions. WebODM puts a new account in its <b>Default</b> group, which holds these unless they
                were taken away from it (<AdminPage url={url} path="/admin/auth/group/">Groups</AdminPage> › Default ›
                Permissions). Else add them to the account, under <b>User permissions</b>, then Save:
                <ul id="webodm-model-permissions">
                    {MODEL_PERMISSIONS.map(([label, name]) => <li key={name}><code>{label}</code>
                        {" "}<span class="hint">({name})</span></li>)}
                </ul>
                Projects to create them in, tasks to upload, follow, cancel and remove, presets to keep task
                options, and the processing nodes to choose one.</li>
            <li><b>Each processing node</b> the account may use: <AdminPage url={url}
                path="/admin/nodeodm/processingnode/">Processing nodes</AdminPage> › the node › <b>Object
                permissions</b> (top right). Under Users, type the user name in <b>User identification</b>, press
                {" "}<b>Manage user</b>, choose <b>Can view Processing Node</b> and Save (or under Groups, for the
                Default group). WebODM gives this to the Default group only for the node there when it first
                started: a node added later is not offered until it is given.</li>
            <li>Only for a project the account didn't create (it owns those it creates, with every permission on them):
                {" "}<AdminPage url={url} path="/admin/app/project/">Projects</AdminPage> › the project › <b>Object
                permissions</b>, then <b>Can view Project</b> to see it, <b>Can change Project</b> to add tasks to it
                and <b>Can delete Project</b> to remove its tasks.</li>
            <li>Here: type the address, the user name and the password, then <b>Check and save</b>. The app logs in
                and lists the processing nodes the account sees: none means step 3 is missing.</li>
        </ol>
    </details>);
}

function Nodes({nodes}: {nodes: WebODMNode[]}) {
    if (!nodes.length) {
        return <div class="notice warning" role="status" id="webodm-nodes">WebODM took the login, but the account sees
            no processing node: give it <b>Can view Processing Node</b> on a node (step 3 of setting up the account,
            below).</div>;
    }
    return <p class="text-success" role="status" id="webodm-nodes">WebODM took the login. The account sees
        {" "}{nodes.length === 1 ? "one processing node" : nodes.length + " processing nodes"}:
        {" "}{nodes.map((n, i) => <>{i ? ", " : ""}<b>{n.label}</b>{n.online ? "" : " (offline)"}</>)}.</p>;
}

function Field({id, label, children}: {id: string; label: string; children: ComponentChildren}) {
    return <div class="field"><label for={id}>{label}</label>{children}</div>;
}

// Create the account: an admin's login, used once, and the new account's name and password
function AccountForm({state, url, busy, onCreate, onCancel}: {
    state: WebODMState; url: string; busy: boolean;
    onCreate: (body: Record<string, string>) => void; onCancel: () => void;
}) {
    const [address, setAddress] = useState(url);
    const [adminUsername, setAdminUsername] = useState("");
    const [adminPassword, setAdminPassword] = useState("");
    const [username, setUsername] = useState(ACCOUNT_NAME);
    const [password, setPassword] = useState("");
    const [shown, setShown] = useState(false);
    const value = (set: (v: string) => void) => (e: Event) => set((e.target as HTMLInputElement).value);

    function submit(e: Event) {
        e.preventDefault();
        onCreate({url: address.trim(), admin_username: adminUsername.trim(), admin_password: adminPassword,
                  username: username.trim(), password});
    }

    return (<form class="webodm-form" id="webodm-account-form" onSubmit={submit}>
        <p class="hint">WebODM creates the account the app logs in as, with the permissions it needs, when one of its
            admins asks: type an admin's login, used for this once and never saved.</p>
        <Field id="webodm-account-url" label="Address">
            <input type="url" id="webodm-account-url" value={address} placeholder="http://localhost:8000"
                   autocomplete="off" spellcheck={false} disabled={busy} maxLength={2048} onInput={value(setAddress)}/>
        </Field>
        <Field id="webodm-admin-username" label="Admin's user name">
            <input type="text" id="webodm-admin-username" value={adminUsername} autocomplete="off" spellcheck={false}
                   disabled={busy} maxLength={150} onInput={value(setAdminUsername)}/>
        </Field>
        <Field id="webodm-admin-password" label="Admin's password">
            <input type="password" id="webodm-admin-password" value={adminPassword} autocomplete="off"
                   disabled={busy} onInput={value(setAdminPassword)}/>
        </Field>
        <Field id="webodm-account-username" label="The new account's user name">
            <input type="text" id="webodm-account-username" value={username} autocomplete="off" spellcheck={false}
                   disabled={busy} maxLength={150} onInput={value(setUsername)}/>
        </Field>
        <Field id="webodm-account-password" label="Its password">
            <div class="webodm-password-row">
                {shown
                    ? <input type="text" id="webodm-account-password" value={password} autocomplete="off"
                             spellcheck={false} disabled={busy} onInput={value(setPassword)}/>
                    : <input type="password" id="webodm-account-password" value={password}
                             autocomplete="new-password" disabled={busy} onInput={value(setPassword)}/>}
                <button type="button" class="button default" id="webodm-generate" disabled={busy}
                        onClick={() => { setPassword(generatePassword()); setShown(true); }}>Generate</button>
            </div>
        </Field>
        <p class="hint">WebODM puts the new account in its <b>Default</b> group, which gives it the permissions the app
            needs. The app then logs in as it and writes its user name and password to
            {" "}<code class="path">{state.file}</code>, the password encrypted, as Check and save does: it need not be
            typed again. A user name WebODM already has is refused: the app never changes an existing account.</p>
        <div class="webodm-actions">
            <button type="submit" class="button primary" id="webodm-account-save"
                    disabled={busy || !address.trim() || !adminUsername.trim() || !adminPassword || !username.trim()
                              || !password}>
                {busy ? "Creating…" : "Create and save"}</button>
            <button type="button" class="button default" id="webodm-account-cancel" disabled={busy} onClick={onCancel}>
                Cancel</button>
        </div>
    </form>);
}

export function WebODMSettings({api}: {api: string}) {
    const [state, setState] = useState<WebODMState | null>(null);
    const [url, setUrl] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [nodes, setNodes] = useState<WebODMNode[] | null>(null);
    const [creating, setCreating] = useState(false);
    const endpoint = api + "settings/webodm";

    function loaded(s: WebODMState) {
        setState(s);
        setUrl(s.url || "");
        setUsername("");
        setPassword("");
    }

    useEffect(() => {
        fetch(endpoint, {credentials: "same-origin"}).then((res) => readJson<WebODMState>(res))
            .then((r) => r.ok ? loaded(r.data) : setError("WebODM's settings could not be read."))
            .catch(() => setError("WebODM's settings could not be read."));
    }, [endpoint]);

    // A call to the server: true once it is done; a state it answers is shown
    async function run(what: string, method: string, url: string, body: unknown, fallback: string) {
        setBusy(what);
        setError("");
        setNodes(null);
        try {
            const r = await readJson<WebODMState & {nodes?: WebODMNode[]}>(await sendJson(url, method, body));
            if (!r.ok) {
                setError(errorText(r.data, fallback));
                return false;
            }
            if ("configured" in r.data) loaded(r.data);
            if (r.data.nodes) setNodes(r.data.nodes);
            return true;
        } catch {
            setError(fallback + ": is the app still running?");
            return false;
        } finally {
            setBusy("");
        }
    }

    async function create(body: Record<string, string>) {
        if (state?.configured && !await ask("Replace the saved login?", "The account created in WebODM is saved in " +
                                            "place of the login saved now. That account is not changed in WebODM.",
                                            "Create and replace")) return;
        if (await run("create", "POST", endpoint + "/account", body, "The account could not be created")) setCreating(false);
    }

    function openForm() {
        setError("");
        setNodes(null);
        setCreating(true);
    }

    function save(e: Event) {
        e.preventDefault();
        return run("save", "PUT", endpoint, {url: url.trim(), username: username.trim(), password},
                   "The login could not be saved");
    }

    async function remove() {
        if (!await ask("Remove WebODM's login?", "Its address, user name and password are taken out of " +
                       (state?.source || "the .env file") + ". WebODM itself is not changed.", "Remove", "danger")) return;
        return run("remove", "DELETE", endpoint, undefined, "The login could not be removed");
    }

    const fromEnvironment = state?.source === "environment";
    return (<fieldset class="preference" id="webodm-settings">
        <legend>WebODM</legend>
        <p class="hint">Conversions are processed with ODM in a WebODM of your own, through its API: here are its
            address and the account the app logs in as.</p>
        <p class="hint">Once it is set up:</p>
        <ul class="hint webodm-benefits">
            <li><strong>Process in WebODM</strong> on a converted dataset's card makes a WebODM task straight from its
                temperature TIFFs: no export, no upload by hand.</li>
            <li>The project, the processing node and the options are chosen there, from the WebODM plan's recommended
                options or a WebODM preset.</li>
            <li>The upload runs in the background, and the card follows each task's progress in WebODM.</li>
            <li>A completed task's orthophoto comes back as temperatures: a WebODM tab in the viewer, to read, measure
                and compare with the app's own mosaics.</li>
        </ul>
        {state && <p id="webodm-state">{state.unreadable
            ? "The saved password can't be read: type it again."
            : !state.configured
            ? "Not set up yet."
            : <>The app logs in to <code class="path">{state.url}</code> as <code>{state.username}</code>, from
                {" "}{fromEnvironment
                    ? <>the environment it was started from (<code>WEBODM_URL</code>, <code>WEBODM_USERNAME</code>,
                        {" "}<code>WEBODM_PASSWORD</code>): to change them, change them there.</>
                    : <><code class="path">{state.source}</code>.</>}</>}</p>}
        {state && !fromEnvironment && creating && <AccountForm state={state} url={url} busy={!!busy} onCreate={create}
                                                               onCancel={() => { setError(""); setCreating(false); }}/>}
        {state && !fromEnvironment && !creating && <form class="webodm-form" onSubmit={save}>
            <div class="field">
                <label for="webodm-url">Address</label>
                <input type="url" id="webodm-url" value={url} placeholder="http://localhost:8000" autocomplete="off"
                       spellcheck={false} disabled={!!busy} maxLength={2048}
                       onInput={(e) => setUrl((e.target as HTMLInputElement).value)}/>
            </div>
            <div class="field">
                <label for="webodm-username">User name</label>
                <input type="text" id="webodm-username" value={username} autocomplete="off" spellcheck={false}
                       disabled={!!busy} maxLength={150}
                       placeholder={state.username ? "Unchanged (" + state.username + ")" : ""}
                       onInput={(e) => setUsername((e.target as HTMLInputElement).value)}/>
            </div>
            <div class="field">
                <label for="webodm-password">Password</label>
                <input type="password" id="webodm-password" value={password} autocomplete="new-password"
                       disabled={!!busy} placeholder={state.password ? "Unchanged" : ""}
                       onInput={(e) => setPassword((e.target as HTMLInputElement).value)}/>
            </div>
            <p class="hint">The address may be <code>http://</code>, for a WebODM on this computer or your network.
                Check and save logs in to WebODM first, then writes them to
                {" "}<code class="path">{state.file}</code> as <code>WEBODM_URL</code>, <code>WEBODM_USERNAME</code>
                {" "}and <code>WEBODM_PASSWORD</code>. The password is written encrypted, its key kept in the app's
                database, and is never shown again.</p>
            <div class="webodm-actions">
                <button type="submit" class="button primary" id="webodm-save"
                        disabled={!!busy || !url.trim() || (!state.username && !username.trim()) || (!state.password && !password)}>
                    {busy === "save" ? "Logging in…" : "Check and save"}</button>
                {state.configured && <button type="button" class="button default" id="webodm-check" disabled={!!busy}
                        onClick={() => run("check", "POST", endpoint + "/check", undefined, "WebODM could not be checked")}>
                    {busy === "check" ? "Logging in…" : "Check the saved login"}</button>}
                <button type="button" class="button default" id="webodm-create" disabled={!!busy} onClick={openForm}>
                    Create the account…</button>
                {(state.url || state.username || state.password) &&
                    <button type="button" class="button danger" id="webodm-remove" disabled={!!busy} onClick={remove}>
                        Remove</button>}
            </div>
        </form>}
        {state && fromEnvironment && state.configured && <div class="webodm-actions">
            <button type="button" class="button default" id="webodm-check" disabled={!!busy}
                    onClick={() => run("check", "POST", endpoint + "/check", undefined, "WebODM could not be checked")}>
                {busy === "check" ? "Logging in…" : "Check the login"}</button>
        </div>}
        {nodes && <Nodes nodes={nodes}/>}
        {error && <div class="notice error" role="alert" id="webodm-error">{error}</div>}
        <Permissions url={state?.url || null}/>
    </fieldset>);
}
