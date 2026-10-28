// System Settings › Storage: the data folder and its size on disk, per project
import {mountPage} from "../core/page";
import {StoragePage} from "../storage/storage-page";

mountPage((s) => <StoragePage api={s.api} publicUrl={s.publicUrl}/>);
