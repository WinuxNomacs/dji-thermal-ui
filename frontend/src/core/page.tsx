// What every page starts with: its settings from the template (the data- attributes of #app, see
// templates/page.html), the unit and the theme applied, and the header above its own content
import {type ComponentChildren, render} from "preact";
import {Header} from "../components/header";
import {applyTheme, themeOf} from "./theme";
import {setUserUnit, unitOf} from "./units";

export interface PageSettings {
    api: string;
    publicUrl: string;
    data: DOMStringMap;    // the page's own settings (data-id, data-b...)
}

// A <script type="application/json"> the template wrote (json_script)
export function jsonScript<T>(id: string, fallback: T): T {
    const el = document.getElementById(id);
    try {
        return el ? JSON.parse(el.textContent || "") as T : fallback;
    } catch {
        return fallback;
    }
}

export function mountPage(content: (settings: PageSettings) => ComponentChildren, root = document.getElementById("app")!) {
    const data = root.dataset;
    const unit = unitOf(data.unit), theme = themeOf(data.themeChoice);
    setUserUnit(unit);
    applyTheme(theme);
    const settings: PageSettings = {api: data.api || "/api/", publicUrl: data.public || "/", data};
    render(<>
        <Header api={settings.api} publicUrl={settings.publicUrl} unit={unit} theme={theme}
                version={data.version || ""}/>
        <main class="app-main">{content(settings)}</main>
    </>, root);
}
