// User Preferences: the unit temperatures are shown in and the theme (as in the header), and the locale dates and
// times are shown in (the computer's, or one chosen). Each is saved for the app as it is chosen.
import {useEffect, useState} from "preact/hooks";
import {readJson} from "../core/api";
import {formatCapture, setUserLocale, zoneLabel} from "../core/format";
import {applyTheme, onTheme, type Theme} from "../core/theme";
import {type Unit} from "../core/units";
import {savePreference} from "../components/header";

interface Props {
    api: string;
    unit: Unit;
    theme: Theme;
    locale: string;
    reload?: () => void;
}

const UNITS: [Unit, string][] = [["F", "°F (Fahrenheit)"], ["C", "°C (Celsius)"], ["K", "K (kelvin)"]];
const THEMES: [Theme, string][] = [["light", "Light"], ["dark", "Dark"], ["system", "As the computer"]];
const EXAMPLE = "2026:10:22 16:34:57";      // a frame's capture time, shown in each locale

// A locale's name in its own language: "English (United Kingdom)", "français (Canada)"; the tag when the browser has none
export function localeName(tag: string): string {
    try {
        return new Intl.DisplayNames([tag], {type: "language", languageDisplay: "standard"}).of(tag) || tag;
    } catch {
        return tag;
    }
}

// How a date and time look in a locale ("" for the computer's)
export function localeExample(tag: string): string { return formatCapture(EXAMPLE, "both", tag || undefined); }

export function PreferencesPage({api, unit, theme: initialTheme, locale: initialLocale,
                                 reload = () => window.location.reload()}: Props) {
    const [locales, setLocales] = useState<string[]>([]);
    const [theme, setTheme] = useState(initialTheme);
    const [locale, setLocale] = useState(initialLocale);
    const [status, setStatus] = useState<{text: string; error?: boolean}>({text: ""});
    const [saving, setSaving] = useState(false);

    useEffect(() => onTheme(setTheme), []);
    useEffect(() => {
        (async () => {
            try {
                const {ok, data} = await readJson<{locales?: string[]}>(await fetch(api + "preferences", {credentials: "same-origin"}));
                if (ok && Array.isArray(data.locales)) setLocales(data.locales);
            } catch { /* only the computer's is offered */ }
        })();
    }, [api]);

    async function save(preference: Record<string, string>, undo: () => void): Promise<boolean> {
        setSaving(true);
        try {
            await savePreference(api, preference);
            setStatus({text: "Saved."});
            return true;
        } catch {
            undo();
            setStatus({text: "Not saved: is the Thermal Analyzer still running?", error: true});
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function changeUnit(e: Event) {
        const select = e.currentTarget as HTMLSelectElement;
        // Every page shows temperatures again in it, this one's header too
        if (await save({unit: select.value}, () => { select.value = unit; })) reload();
    }

    async function changeTheme(next: Theme) {
        const before = theme;
        applyTheme(next);
        await save({theme: next}, () => applyTheme(before));
    }

    async function changeLocale(next: string) {
        const before = locale;
        setLocale(next);
        setUserLocale(next);
        await save({locale: next}, () => { setLocale(before); setUserLocale(before); });
    }

    return (<div class="page preferences">
        <div class="page-header"><h1>User Preferences</h1></div>
        <p class="hint">Saved for the Thermal Analyzer on this computer, for every project.</p>

        <fieldset class="preference" id="unit-preference">
            <legend>Temperatures</legend>
            <div class="field">
                <label for="pref-unit">Shown in</label>
                <select id="pref-unit" value={unit} disabled={saving} onChange={changeUnit}>
                    {UNITS.map(([u, label]) => <option key={u} value={u}>{label}</option>)}
                </select>
                <p class="help">Also in the header. A dataset's files keep the unit they were written in.</p>
            </div>
        </fieldset>

        <fieldset class="preference" id="theme-preference">
            <legend>Theme</legend>
            <div class="radios">
                {THEMES.map(([t, label]) => (
                    <label key={t}><input type="radio" name="theme" value={t} checked={theme === t} disabled={saving}
                                          onChange={() => changeTheme(t)}/> {label}</label>))}
            </div>
            <p class="help">Also in the header.</p>
        </fieldset>

        <fieldset class="preference" id="locale-preference">
            <legend>Dates and times</legend>
            <div class="field">
                <label for="pref-locale">Written as in</label>
                <select id="pref-locale" value={locale} disabled={saving} onChange={(e) => changeLocale(e.currentTarget.value)}>
                    <option value="">As the computer ({localeExample("")})</option>
                    {locales.map((tag) => <option key={tag} value={tag}>{localeName(tag)} ({localeExample(tag)})</option>)}
                </select>
                <p class="help">A flight's capture times are in the time where it was flown, labelled with its time zone
                    (e.g. {zoneLabel(-300)}), found from the frames' two clocks; when the app made or changed something,
                    in this computer's time.</p>
            </div>
        </fieldset>

        <p id="preferences-status" role="status" class={status.error ? "text-danger" : "text-muted"}>{status.text}</p>
    </div>);
}
