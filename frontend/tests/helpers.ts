// What the tests share: a fake server, responses, and events
import {options} from "preact";
import {vi} from "vitest";

// Effects run with the promises settled by ticks(), not after the next paint (which jsdom never makes)
options.requestAnimationFrame = (f) => { queueMicrotask(f); };

export const jsonResponse = (data: unknown, ok = true) =>
    Promise.resolve({ok, status: ok ? 200 : 400, json: () => Promise.resolve(data)} as Response);

// Lets the promises of a fetch and its JSON settle, with fake timers too
export const ticks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

export const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", {bubbles: true}));
export const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", {key: k, bubbles: true}));

// An image picked in the browser: its size, and its place in the folder chosen
export function file(name: string, size = 1, relativePath = ""): File {
    const f = new File([new Uint8Array(size)], name);
    Object.defineProperty(f, "webkitRelativePath", {value: relativePath});
    return f;
}

type Route = unknown | ((url: string, opts?: RequestInit) => Promise<Response>);

// A fake server: "METHOD url" (or just the url, for GET) to a list of responses, each answered once in turn and the
// last one again after that. Its calls are fetchFn.mock.calls.
export function server(routes: Record<string, Route | Route[]>) {
    const left: Record<string, Route[]> = {};
    for (const [k, v] of Object.entries(routes)) left[k.indexOf(" ") > 0 ? k : "GET " + k] = ([] as Route[]).concat(v);
    return vi.fn((url: string, opts?: RequestInit) => {
        const k = (opts?.method || "GET") + " " + url;
        const queue = left[k];
        if (!queue) return Promise.reject(new Error("unexpected " + k));
        const r = queue.length > 1 ? queue.shift() : queue[0];
        return typeof r === "function" ? r(url, opts) : jsonResponse(r);
    });
}

export const calls = (fetchFn: ReturnType<typeof server>) =>
    fetchFn.mock.calls.map((c) => (c[1]?.method || "GET") + " " + c[0]);
