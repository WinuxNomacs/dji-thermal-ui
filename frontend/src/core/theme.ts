// Light or dark: the theme chosen in the header, or the computer's own ("system"). The page's template sets it on
// <html> before the page paints (templates/page.html); this keeps it up to date.

export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];

export function themeOf(t: unknown): Theme { return THEMES.includes(t as Theme) ? t as Theme : "system"; }

const darkQuery = () => window.matchMedia?.("(prefers-color-scheme: dark)");

// The colours a choice comes to: light or dark
export function shown(choice: Theme): "light" | "dark" {
    if (choice !== "system") return choice;
    return darkQuery()?.matches ? "dark" : "light";
}

let chosen: Theme = "system";
let watching = false;

export function applyTheme(choice: unknown, root: HTMLElement = document.documentElement): void {
    chosen = themeOf(choice);
    root.setAttribute("data-theme", shown(chosen));
    // Following the computer's: its change (at dusk, say) is followed while the page is open
    const q = darkQuery();
    if (!watching && q) {
        watching = true;
        q.addEventListener("change", () => { if (chosen === "system") root.setAttribute("data-theme", shown(chosen)); });
    }
}
