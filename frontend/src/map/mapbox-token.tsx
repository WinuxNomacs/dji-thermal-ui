// The form for the Mapbox token, with how to get one: saved in the app's preferences, changed or removed there. A
// token from MAPBOX_API_TOKEN is used when none is saved.
import {dialog} from "../components/dialog";
import {errorText, readJson, sendJson} from "../core/api";

export interface MapboxToken {token: string | null; token_source: "saved" | "env" | null; env_token: boolean}

export const SIGN_UP = "https://account.mapbox.com/auth/signup/";
export const TOKENS_PAGE = "https://console.mapbox.com/account/access-tokens/";
const STATISTICS_PAGE = "https://console.mapbox.com/account/statistics/";

const link = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;

function Steps({state}: {state: MapboxToken}) {
    return (
        <div class="mapbox-help">
            <p>Mapbox's satellite imagery needs a Mapbox account of your own and its access token.</p>
            <ol>
                <li>Sign up at {link(SIGN_UP, "mapbox.com")}. With a card on the account, Mapbox's free allowance is
                    750,000 satellite tiles a month, and it charges past that; without one, only its trial limits
                    apply.</li>
                <li>Open the {link(TOKENS_PAGE, "Access tokens")} page and copy the <b>Default public token</b>, which
                    starts with <code>pk.</code> (or create a token with the public scopes only). Never use a secret
                    token (<code>sk.</code>).</li>
                <li>Paste it here and press Save.</li>
            </ol>
            <p class="hint">The token is kept in this app's preferences on this computer, and your browser sends it to
                Mapbox with each tile. The {link(STATISTICS_PAGE, "Statistics")} page shows how many tiles have been
                used.</p>
            {state.token_source === "env" &&
                <p class="hint">The token in use now is <code>MAPBOX_API_TOKEN</code>. A token saved here is used
                    instead of it.</p>}
            {state.token_source === "saved" && state.env_token &&
                <p class="hint">Removing the token saved here goes back to <code>MAPBOX_API_TOKEN</code>.</p>}
        </div>
    );
}

// Asks for a token, saves (or removes) it: resolves to the token now in use, or null when nothing was changed
export async function askMapboxToken(state: MapboxToken, preferences: string): Promise<MapboxToken | null> {
    let value = state.token_source === "saved" ? state.token || "" : "", error: string | undefined;
    for (;;) {
        const buttons: {label: string; value: string; style?: "primary" | "danger"}[] = [{label: "Cancel", value: "cancel"}];
        if (state.token_source === "saved") buttons.push({label: "Remove", value: "remove"});
        buttons.push({label: "Save", value: "save", style: "primary"});
        const r = await dialog({title: state.token ? "Mapbox Satellite: the token" : "Mapbox Satellite: add a token",
                                body: <Steps state={state}/>, buttons,
                                field: {label: "Access token", value, placeholder: "pk.…", error}});
        if (r.button !== "save" && r.button !== "remove") return null;
        value = (r.value || "").trim();
        try {
            const res = await sendJson(preferences, "PUT", {mapbox_token: r.button === "save" ? value : null});
            const {ok, data} = await readJson<{mapbox?: MapboxToken}>(res);
            if (ok && data.mapbox) return data.mapbox;
            error = errorText(data, "The token could not be saved");
        } catch {
            error = "The token could not be saved: is the app still running?";
        }
    }
}
