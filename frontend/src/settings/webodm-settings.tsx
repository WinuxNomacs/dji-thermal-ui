// System Settings › WebODM: its address and login, checked with a login by the server before they are written to .env
// in place of those there. The password never comes back: the page says only that one is set, and the user name is
// shown masked. Those set in the environment (WEBODM_URL, WEBODM_USERNAME, WEBODM_PASSWORD) are shown only: they are
// changed there. The WebODM permissions the account needs are listed below the fields.
import {useEffect, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {ask} from "../components/dialog";

export interface WebODMState {
    url: string | null; username: string | null; password: boolean; configured: boolean;
    source: string | null; file: string | null;
}
export interface WebODMNode {id: number; label: string; online: boolean}

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
            <li><AdminPage url={url} path="/admin/auth/user/add/">Users › Add user</AdminPage>: a user name and a
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

export function WebODMSettings({api}: {api: string}) {
    const [state, setState] = useState<WebODMState | null>(null);
    const [url, setUrl] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [nodes, setNodes] = useState<WebODMNode[] | null>(null);
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

    async function run(what: string, method: string, url: string, body: unknown, fallback: string) {
        setBusy(what);
        setError("");
        setNodes(null);
        try {
            const r = await readJson<WebODMState & {nodes?: WebODMNode[]}>(await sendJson(url, method, body));
            if (!r.ok) return setError(errorText(r.data, fallback));
            if (method !== "POST") loaded(r.data);
            if (r.data.nodes) setNodes(r.data.nodes);
        } catch {
            setError(fallback + ": is the app still running?");
        } finally {
            setBusy("");
        }
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
    const needsLogin = !state?.username || !state?.password;
    return (<fieldset class="preference" id="webodm-settings">
        <legend>WebODM</legend>
        <p class="hint">Conversions are processed with ODM in a WebODM of your own, through its API: here are its
            address and the account the app logs in as.</p>
        {state && <p id="webodm-state">{!state.configured
            ? "Not set up yet."
            : <>The app logs in to <code class="path">{state.url}</code> as <code>{state.username}</code>, from
                {" "}{fromEnvironment
                    ? <>the environment it was started from (<code>WEBODM_URL</code>, <code>WEBODM_USERNAME</code>,
                        {" "}<code>WEBODM_PASSWORD</code>): to change them, change them there.</>
                    : <><code class="path">{state.source}</code>.</>}</>}</p>}
        {state && !fromEnvironment && <form class="webodm-form" onSubmit={save}>
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
                {" "}and <code>WEBODM_PASSWORD</code>. The password is never shown again.</p>
            <div class="webodm-actions">
                <button type="submit" class="button primary" id="webodm-save"
                        disabled={!!busy || !url.trim() || (needsLogin && (!username.trim() || !password))}>
                    {busy === "save" ? "Logging in…" : "Check and save"}</button>
                {state.configured && <button type="button" class="button default" id="webodm-check" disabled={!!busy}
                        onClick={() => run("check", "POST", endpoint + "/check", undefined, "WebODM could not be checked")}>
                    {busy === "check" ? "Logging in…" : "Check the saved login"}</button>}
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
