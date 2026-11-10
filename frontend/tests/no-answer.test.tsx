import {render} from "preact";
import {afterEach, describe, expect, it, vi} from "vitest";
import {NoAnswer} from "../src/components/no-answer";
import {answered, noAnswer} from "../src/core/answer";
import {sendJson} from "../src/core/api";

const line = () => document.getElementById("no-answer");

describe("the app not answering", () => {
    afterEach(() => {
        answered();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("says so under the header when a write can't reach it, and the write still fails for its caller", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
        const root = document.body.appendChild(document.createElement("div"));
        render(<NoAnswer/>, root);
        await expect(sendJson("/api/projects/1", "DELETE")).rejects.toThrow("offline");
        await new Promise((r) => setTimeout(r, 150));
        expect(line()!.textContent).toBe("The app did not answer: is it still running?");
        render(null, root);
    });

    it("goes away by itself once the app answers again", async () => {
        vi.useFakeTimers();
        const fetchFn = vi.fn(() => Promise.reject(new TypeError("offline")) as Promise<Response>);
        vi.stubGlobal("fetch", fetchFn);
        const root = document.body.appendChild(document.createElement("div"));
        render(<NoAnswer/>, root);
        noAnswer();
        await vi.advanceTimersByTimeAsync(3200);
        expect(line()).not.toBeNull();
        fetchFn.mockImplementation(() => Promise.resolve(new Response("")));
        await vi.advanceTimersByTimeAsync(3000);
        expect(line()).toBeNull();
        render(null, root);
    });
});
