// System Settings: the Mapbox token, with how to get one, checked with Mapbox by the server before it is written to
// .env in place of the one there; WebODM's address and login (webodm-settings.tsx); and a way to Storage. A token from
// MAPBOX_API_TOKEN in the environment is shown only: it is changed there.
import {useEffect, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {SectionFilter} from "../components/section-filter";
import {WebODMSettings} from "./webodm-settings";

// The token in use and where it comes from ("environment", or the .env file's path), and the file a new one goes to
export interface MapboxToken {token: string | null; token_source: string | null; file: string | null}

export const SIGN_UP = "https://account.mapbox.com/auth/signup/";
export const TOKENS_PAGE = "https://console.mapbox.com/account/access-tokens/";
const STATISTICS_PAGE = "https://console.mapbox.com/account/statistics/";

const link = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;

// A token as shown: its start and its last characters
export const shortToken = (token: string) => token.slice(0, 3) + "…" + token.slice(-4);

function Steps() {
    return (
        <div class="mapbox-help">
            <p>Mapbox's satellite imagery needs a Mapbox account of your own and its access token.</p>
            <ol>
                <li>Sign up at {link(SIGN_UP, "mapbox.com")}: no card is needed. The free allowance is 200,000 map
                    tiles a month; Mapbox charges past it only when a card is on the account.</li>
                <li>Open the {link(TOKENS_PAGE, "Access tokens")} page and copy the <b>Default public token</b>, which
                    starts with <code>pk.</code> (or create a token with the public scopes only). Never use a secret
                    token (<code>sk.</code>).</li>
                <li>Paste it here and press Check and save: Mapbox is asked for a tile with it first.</li>
            </ol>
            <p class="hint">The token is written to a <code>.env</code> file on this computer as
                {" "}<code>MAPBOX_API_TOKEN</code>, in place of the one there, and your browser sends it to Mapbox with
                each tile. The {link(STATISTICS_PAGE, "Statistics")} page shows how many tiles have been used.</p>
        </div>
    );
}

function MapboxSettings({api}: {api: string}) {
    const [state, setState] = useState<MapboxToken | null>(null);
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetch(api + "settings/mapbox", {credentials: "same-origin"}).then((res) => readJson<MapboxToken>(res))
            .then((r) => r.ok ? setState(r.data) : setError("The token could not be read."))
            .catch(() => setError("The token could not be read."));
    }, [api]);

    async function save(e: Event) {
        e.preventDefault();
        setBusy(true);
        setError("");
        setSaved(false);
        try {
            const r = await readJson<MapboxToken>(await sendJson(api + "settings/mapbox", "PUT", {token: value.trim()}));
            if (r.ok) {
                setState(r.data);
                setValue("");
                setSaved(true);
            } else {
                setError(errorText(r.data, "The token could not be saved"));
            }
        } catch {
            setError("The token could not be saved: is the app still running?");
        } finally {
            setBusy(false);
        }
    }

    const fromEnvironment = state?.token_source === "environment";
    return (<fieldset class="preference" id="mapbox-settings">
        <legend>Mapbox Satellite</legend>
        {state && <p id="mapbox-state">{!state.token
            ? "No token yet: the maps offer Mapbox Satellite once one is saved here."
            : fromEnvironment
                ? <>The token in use is <code>{shortToken(state.token)}</code>, from <code>MAPBOX_API_TOKEN</code> in the
                    environment the app was started from: to change it, change it there.</>
                : <>The token in use is <code>{shortToken(state.token)}</code>, from <code class="path">{state.token_source}</code>.
                    A token saved here replaces it.</>}</p>}
        {state && !fromEnvironment && <>
            <Steps/>
            <form class="token-form" onSubmit={save}>
                <label for="mapbox-token">{state.token ? "New access token" : "Access token"}</label>
                <div class="token-row">
                    <input type="text" id="mapbox-token" value={value} placeholder="pk.…" autocomplete="off"
                           spellcheck={false} disabled={busy}
                           onInput={(e) => { setValue((e.target as HTMLInputElement).value); setSaved(false); }}/>
                    <button type="submit" class="button primary" id="save-token" disabled={busy || !value.trim()}>
                        {busy ? "Asking Mapbox…" : "Check and save"}</button>
                </div>
            </form>
            {saved && <p class="text-success" role="status" id="token-saved">Mapbox accepted the token, and it is saved
                in <code class="path">{state.token_source}</code>. The maps opened from now on offer Mapbox Satellite.</p>}
        </>}
        {error && <div class="notice error" role="alert" id="token-error">{error}</div>}
    </fieldset>);
}

export function SettingsPage({api, publicUrl}: {api: string; publicUrl: string}) {
    return (<div class="page settings">
        <div class="page-header"><h1>System Settings</h1></div>
        <p class="hint">For the Thermal Analyzer on this computer.</p>
        <SectionFilter label="Filter the settings">
            <MapboxSettings api={api}/>
            <WebODMSettings api={api}/>
            <fieldset class="preference" id="storage-settings">
                <legend>Storage</legend>
                <p>Where the data folder is, its size on disk per project, and moving it: <a href={publicUrl + "settings/storage"}>
                    Storage</a>.</p>
            </fieldset>
        </SectionFilter>
    </div>);
}
