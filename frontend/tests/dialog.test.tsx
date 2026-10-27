import {beforeEach, describe, expect, it} from "vitest";
import {ask, askName} from "../src/components/dialog";
import {click, key} from "./helpers";

describe("the pages' dialog", () => {
    beforeEach(() => {
        document.body.innerHTML = '<div class="page"><button id="opener">Open</button></div>';
    });
    const shown = () => document.querySelector(".page .dialog") as HTMLElement;
    const button = (label: string) => [...shown().querySelectorAll("button")].find((b) => b.textContent === label)!;
    const field = () => shown().querySelector("input") as HTMLInputElement;

    it("asks before doing something, with its own wording, the button to do it in focus", async () => {
        const opener = document.getElementById("opener")!;
        opener.focus();
        const answer = ask("Delete <Roof>?", ["Its 2 conversions go with it.", "The images stay."], "Delete", "danger");
        expect(shown().querySelector("[role=dialog] h2")!.textContent).toBe("Delete <Roof>?");
        expect([...shown().querySelectorAll("p")].map((p) => p.textContent))
            .toEqual(["Its 2 conversions go with it.", "The images stay."]);
        expect(button("Delete").classList.contains("danger")).toBe(true);
        expect(document.activeElement).toBe(button("Delete"));
        click(button("Delete"));
        expect(await answer).toBe(true);
        expect(shown()).toBe(null);
        expect(document.activeElement).toBe(opener);

        const canceled = ask("Delete?", "", "Delete", "danger");
        click(button("Cancel"));
        expect(await canceled).toBe(false);
        const dismissed = ask("Delete?", "", "Delete", "danger");
        key(document.activeElement!, "Escape");
        expect(await dismissed).toBe(false);
        const beside = ask("Delete?", "", "Delete", "danger");
        click(shown().firstElementChild!.parentElement!);
        expect(await beside).toBe(false);
    });

    it("asks for a new name, Enter renaming, and gives nothing back for the same name or a blank one", async () => {
        let answer = askName("Rename dataset", "Roof");
        expect(field().value).toBe("Roof");
        expect(document.activeElement).toBe(field());
        field().value = "  Roof east ";
        key(field(), "Enter");
        expect(await answer).toBe("Roof east");

        answer = askName("Rename dataset", "Roof");
        click(button("Rename"));
        expect(await answer).toBe(null);
        answer = askName("Rename dataset", "Roof");
        field().value = " ";
        click(button("Rename"));
        expect(await answer).toBe(null);
        answer = askName("Rename dataset", "Roof");
        field().value = "Other";
        key(field(), "Escape");
        expect(await answer).toBe(null);
    });
});
