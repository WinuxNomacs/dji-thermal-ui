// System Settings: the Mapbox token, WebODM's address and login, and a way to Storage
import {mountPage} from "../core/page";
import {SettingsPage} from "../settings/settings-page";

mountPage((s) => <SettingsPage api={s.api} publicUrl={s.publicUrl}/>);
