// The header every page has: the navigation pane's switch, the app's name, the unit temperatures are shown in and the
// theme, both saved for the app (and on the preferences page too). A new unit shows the page again in it; a new theme
// is applied at once.
import {useEffect, useState} from "preact/hooks";
import {sendJson} from "../core/api";
import {applyTheme, onTheme, type Theme} from "../core/theme";
import {type Unit} from "../core/units";
import {Menu, Monitor, Moon, Sun, Thermometer} from "./icons";

export interface HeaderProps {
    api: string;
    publicUrl: string;
    unit: Unit;
    theme: Theme;
    version: string;
    reload?: () => void;
    nav?: {shown: boolean; toggle: () => void};
}

const THEME_CHOICES: {theme: Theme; label: string; Icon: typeof Sun}[] = [
    {theme: "light", label: "Light", Icon: Sun},
    {theme: "dark", label: "Dark", Icon: Moon},
    {theme: "system", label: "As the computer", Icon: Monitor},
];

export async function savePreference(api: string, preference: Record<string, string>): Promise<void> {
    const res = await sendJson(api + "preferences", "PUT", preference);
    if (!res.ok) throw new Error("not saved: " + res.status);
}

export function Header({api, publicUrl, unit, theme: initialTheme, version, nav,
                        reload = () => window.location.reload()}: HeaderProps) {
    const [saving, setSaving] = useState(false);
    const [theme, setTheme] = useState(initialTheme);
    useEffect(() => onTheme(setTheme), []);

    async function changeUnit(e: Event) {
        const select = e.currentTarget as HTMLSelectElement;
        setSaving(true);
        try {
            await savePreference(api, {unit: select.value});
            reload();
        } catch {
            select.value = unit;
            setSaving(false);
        }
    }

    async function changeTheme(next: Theme) {
        const before = theme;
        setTheme(next);
        applyTheme(next);
        try {
            await savePreference(api, {theme: next});
        } catch {
            setTheme(before);
            applyTheme(before);
        }
    }

    return (
        <header class="app-header">
            <div class="app-start">
                {nav && <button type="button" class="icon-button" id="nav-toggle" aria-controls="app-nav"
                                aria-expanded={nav.shown} title={nav.shown ? "Hide the navigation" : "Show the navigation"}
                                aria-label={nav.shown ? "Hide the navigation" : "Show the navigation"}
                                onClick={nav.toggle}><Menu/></button>}
                <a class="app-name" href={publicUrl}><Thermometer/> Thermal Analyzer</a>
            </div>
            <div class="app-settings">
                <label for="app-unit">Temperatures in</label>
                <select id="app-unit" value={unit} disabled={saving} onChange={changeUnit}>
                    <option value="F">°F</option>
                    <option value="C">°C</option>
                    <option value="K">K</option>
                </select>
                <div class="segmented" role="group" aria-label="Theme">
                    {THEME_CHOICES.map(({theme: t, label, Icon}) => (
                        <button type="button" key={t} title={label} aria-label={label} aria-pressed={theme === t}
                                onClick={() => theme !== t && changeTheme(t)}><Icon/></button>
                    ))}
                </div>
                <span class="app-version" title="dji-thermal-ui's version">{version}</span>
            </div>
        </header>
    );
}
