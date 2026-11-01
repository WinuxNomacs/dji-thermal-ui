// User Preferences: the unit temperatures are shown in and the theme (as in the header), the palette the map pages
// start with (each flight's images' own, or one chosen, shown on a made-up scene), the basemap they start with, and the
// locale dates and times are shown in (the computer's, or one chosen). Each is saved for the app as it is chosen.
import {useEffect, useState} from "preact/hooks";
import {readJson} from "../core/api";
import {formatCapture, setUserLocale, zoneLabel} from "../core/format";
import {applyTheme, onTheme, type Theme} from "../core/theme";
import {type Unit} from "../core/units";
import {savePreference} from "../components/header";
import {SectionFilter} from "../components/section-filter";
import {PalettePreview} from "./palette-preview";

interface Props {
    api: string;
    publicUrl?: string;
    unit: Unit;
    theme: Theme;
    locale: string;
    reload?: () => void;
}

const UNITS: [Unit, string][] = [["F", "°F (Fahrenheit)"], ["C", "°C (Celsius)"], ["K", "K (kelvin)"]];
const THEMES: [Theme, string][] = [["light", "Light"], ["dark", "Dark"], ["system", "As the computer"]];
interface Palette {key: string; label: string; color_map?: number[]}
interface Choice {key: string; label: string}
interface Choices {locales?: string[]; palette?: string; view_palettes?: Palette[]; images_palette?: string;
                   basemap?: string; basemaps?: Choice[]}

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

export function PreferencesPage({api, publicUrl = "/", unit, theme: initialTheme, locale: initialLocale,
                                 reload = () => window.location.reload()}: Props) {
    const [locales, setLocales] = useState<string[]>([]);
    const [palettes, setPalettes] = useState<Palette[]>([]);
    const [palette, setPalette] = useState("");
    const [imagesPalette, setImagesPalette] = useState("ironbow");
    const [basemaps, setBasemaps] = useState<Choice[]>([]);
    const [basemap, setBasemap] = useState("");
    const [theme, setTheme] = useState(initialTheme);
    const [locale, setLocale] = useState(initialLocale);
    const [status, setStatus] = useState<{text: string; error?: boolean}>({text: ""});
    const [saving, setSaving] = useState(false);

    useEffect(() => onTheme(setTheme), []);
    useEffect(() => {
        (async () => {
            try {
                const {ok, data} = await readJson<Choices>(await fetch(api + "preferences", {credentials: "same-origin"}));
                if (ok && Array.isArray(data.locales)) setLocales(data.locales);
                if (ok && Array.isArray(data.view_palettes)) {
                    setPalettes(data.view_palettes);
                    setPalette(data.palette || "");
                    if (data.images_palette) setImagesPalette(data.images_palette);
                }
                if (ok && Array.isArray(data.basemaps)) {
                    setBasemaps(data.basemaps);
                    setBasemap(data.basemap || "");
                }
            } catch { /* only the computer's locale and the images' palettes are offered */ }
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
            setStatus({text: "Not saved: is DJI Thermal Analyzer still running?", error: true});
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

    async function changePalette(next: string) {
        const before = palette;
        setPalette(next);
        await save({palette: next}, () => setPalette(before));
    }

    async function changeBasemap(next: string) {
        const before = basemap;
        setBasemap(next);
        await save({basemap: next}, () => setBasemap(before));
    }

    // The palette chosen, or the one the newest flight's images give for "As each flight's images"
    const shown = palettes.find((p) => p.key === (palette || imagesPalette));

    async function changeLocale(next: string) {
        const before = locale;
        setLocale(next);
        setUserLocale(next);
        await save({locale: next}, () => { setLocale(before); setUserLocale(before); });
    }

    return (<div class="page preferences">
        <div class="page-header"><h1>User Preferences</h1></div>
        <p class="hint">Saved for DJI Thermal Analyzer on this computer, for every project.</p>
        <SectionFilter label="Filter the preferences">

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

            <fieldset class="preference" id="palette-preference">
                <legend>Palette</legend>
                <div class="field">
                    <label for="pref-palette">The maps start with</label>
                    <select id="pref-palette" value={palette} disabled={saving} onChange={(e) => changePalette(e.currentTarget.value)}>
                        <option value="">As each flight's images</option>
                        {palettes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                    <p class="help">On the viewer, the frame explorer, the compare page and the mosaic report; each can still
                        switch to another. A DJI palette is used where the flight's images carry it.</p>
                </div>
                {shown && <PalettePreview colors={shown.color_map} label={shown.label}
                                          caption={palette ? undefined : shown.label + " (as the newest flight's images)"}/>}
            </fieldset>

            {basemaps.length > 0 && <fieldset class="preference" id="basemap-preference">
                <legend>Map</legend>
                <div class="field">
                    <label for="pref-basemap">The maps start with</label>
                    <select id="pref-basemap" value={basemap} disabled={saving} onChange={(e) => changeBasemap(e.currentTarget.value)}>
                        {/* A preferred Mapbox whose token has gone is still shown as chosen (the maps start on Esri) */}
                        {basemap && !basemaps.some((b) => b.key === basemap) && <option value={basemap}>{basemap === "mapbox"
                            ? "Mapbox Satellite (no token: ESRI Satellite)" : basemap}</option>}
                        {basemaps.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                    </select>
                    <p class="help">Under the mosaics, the frames and the projects' areas; each map can still switch to
                        another.{!basemaps.some((b) => b.key === "mapbox") && <> Mapbox Satellite is offered once its token
                        is saved under <a href={publicUrl + "settings"}>System Settings</a>.</>}</p>
                </div>
            </fieldset>}

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
        </SectionFilter>

        <p id="preferences-status" role="status" class={status.error ? "text-danger" : "text-muted"}>{status.text}</p>
    </div>);
}
