// What every page starts with: its settings from the template (the data- attributes of #app, see
// templates/page.html), the unit, the theme and the locale applied, the header above, and the navigation pane beside
// its own content (shown or hidden as a whole, kept for the next visit; over the page on a narrow screen, where it
// starts hidden)
import {type ComponentChildren, render} from "preact";
import {useEffect, useState} from "preact/hooks";
import {Header} from "../components/header";
import {NavPane} from "../components/nav-pane";
import "../styles/app.css";
import {setUserLocale} from "./format";
import {type Current} from "./navigation";
import {applyTheme, type Theme, themeOf} from "./theme";
import {setUserUnit, type Unit, unitOf} from "./units";

const NAV_KEY = "thermal-analyzer.nav.shown";
const NARROW = "(max-width: 767px)";

const narrow = () => !!window.matchMedia?.(NARROW).matches;

function storedShown(): boolean {
    try { return localStorage.getItem(NAV_KEY) !== "0"; } catch { return true; }
}

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

interface LayoutProps {settings: PageSettings; unit: Unit; theme: Theme; current: Current; children: ComponentChildren}

function Layout({settings, unit, theme, current, children}: LayoutProps) {
    const [small, setSmall] = useState(narrow);
    const [shown, setShown] = useState(() => !narrow() && storedShown());

    useEffect(() => {
        const q = window.matchMedia?.(NARROW);
        if (!q) return;
        const changed = () => { setSmall(q.matches); setShown(!q.matches && storedShown()); };
        q.addEventListener("change", changed);
        return () => q.removeEventListener("change", changed);
    }, []);

    function show(next: boolean) {
        setShown(next);
        if (!small) {
            try { localStorage.setItem(NAV_KEY, next ? "1" : "0"); } catch { /* not remembered */ }
        }
    }

    return (<>
        <Header api={settings.api} publicUrl={settings.publicUrl} unit={unit} theme={theme}
                version={settings.data.version || ""} nav={{shown, toggle: () => show(!shown)}}/>
        <div class={"app-body" + (shown ? " nav-shown" : "") + (small ? " narrow" : "")}>
            {shown && <NavPane api={settings.api} publicUrl={settings.publicUrl} current={current}
                               onNavigate={small ? () => setShown(false) : undefined}
                               onClose={small ? () => setShown(false) : undefined}/>}
            {shown && small && <div class="nav-backdrop" onClick={() => setShown(false)}/>}
            <main class="app-main">{children}</main>
        </div>
    </>);
}

export function mountPage(content: (settings: PageSettings) => ComponentChildren, root = document.getElementById("app")!) {
    const data = root.dataset;
    const unit = unitOf(data.unit), theme = themeOf(data.themeChoice);
    setUserUnit(unit);
    setUserLocale(data.locale);
    applyTheme(theme);
    const settings: PageSettings = {api: data.api || "/api/", publicUrl: data.public || "/", data};
    const current: Current = {page: data.page || "", id: Number(data.id)};
    render(<Layout settings={settings} unit={unit} theme={theme} current={current}>{content(settings)}</Layout>, root);
}
