// Talking to the app's API: the CSRF token, a response's JSON, a DRF error's message
import {answered, noAnswer} from "./answer";
import {navigationChanged} from "./navigation";

// The writes that change what the navigation pane lists: a project, a dataset or a conversion made, changed (renamed,
// moved) or deleted, a conversion canceled, its mosaics built
const LISTED = /\/(projects|datasets|conversions)(\/\d+)?(\/conversions|\/cancel|\/mosaics)?$/;

export function csrfToken(doc: Document = document): string {
    const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc.cookie);
    return m ? decodeURIComponent(m[1]) : "";
}

// A response's JSON; an error that says nothing itself (a page that isn't JSON, or JSON without a message) is given a
// detail saying what its status means: a request the app doesn't know (a server older than the page) or its own failure
export async function readJson<T = Record<string, unknown>>(res: Response): Promise<{ok: boolean; data: T}> {
    let data: T;
    try {
        data = await res.json();
    } catch {
        data = {} as T;
    }
    const why = res.ok || errorText(data, "") ? null : unexplained(res.status);
    if (why) data = {...(data && typeof data === "object" ? data : {}), detail: why} as T;
    return {ok: res.ok, data};
}

// What an error answer without a message of its own means, when its status says (else the page's own words do)
export function unexplained(status: number): string | null {
    if (status === 404 || status === 405) {
        return "The app doesn't know this request (" + status + "): if it was updated since it started, restart it";
    }
    if (status >= 500) return "The app ran into an error (" + status + "): its log says more";
    return null;
}

// The first message of a DRF error ({field: ["message"]} or {detail: "message"})
export function errorText(data: unknown, fallback: string): string {
    if (data && typeof data === "object") {
        for (const v of Object.values(data)) {
            if (Array.isArray(v) && v.length) return String(v[0]);
            if (typeof v === "string" && v) return v;
        }
    }
    return fallback;
}

// Sends JSON with the CSRF token: PUT, POST, PATCH or DELETE; the navigation pane lists again after a write that
// changes what it lists
export async function sendJson(url: string, method: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
        res = await fetch(url, {
            method, credentials: "same-origin",
            headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken()},
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (e) {
        noAnswer();
        throw e;
    }
    answered();
    if (res.ok && LISTED.test(url.split("?")[0])) navigationChanged();
    return res;
}
