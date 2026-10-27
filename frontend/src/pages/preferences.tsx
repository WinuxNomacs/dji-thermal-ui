// User Preferences: the unit, the theme, and the locale of dates and times
import {mountPage} from "../core/page";
import {themeOf} from "../core/theme";
import {unitOf} from "../core/units";
import {PreferencesPage} from "../preferences/preferences-page";

mountPage((s) => <PreferencesPage api={s.api} unit={unitOf(s.data.unit)} theme={themeOf(s.data.themeChoice)}
                                  locale={s.data.locale || ""}/>);
