// The mosaic viewer: a conversion's mosaics on a map, measured
import "leaflet/dist/leaflet.css";
import {ViewerPage} from "../viewer/viewer-page";
import {jsonScript, mountPage} from "../core/page";

mountPage((s) => <ViewerPage api={s.api} publicUrl={s.publicUrl} id={Number(s.data.id)} datasetId={Number(s.data.dataset)}
                             datasetName={s.data.datasetName || ""} basemaps={jsonScript("ta-basemaps", [])}/>);
