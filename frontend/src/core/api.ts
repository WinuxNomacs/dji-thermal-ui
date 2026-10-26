// Talking to the app's API: the CSRF token, a response's JSON, a DRF error's message

export function csrfToken(doc: Document = document): string {
    const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc.cookie);
    return m ? decodeURIComponent(m[1]) : "";
}

export async function readJson<T = Record<string, unknown>>(res: Response): Promise<{ok: boolean; data: T}> {
    try {
        return {ok: res.ok, data: await res.json()};
    } catch {
        return {ok: res.ok, data: {} as T};
    }
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

// Sends JSON with the CSRF token: PUT, POST, PATCH or DELETE
export function sendJson(url: string, method: string, body?: unknown): Promise<Response> {
    return fetch(url, {
        method, credentials: "same-origin",
        headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken()},
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}
