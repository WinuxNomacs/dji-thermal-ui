// The projects, the app's landing page
import "ol/ol.css";
import {ProjectsPage} from "../projects/projects-page";
import {jsonScript, mountPage} from "../core/page";

mountPage((s) => <ProjectsPage api={s.api} publicUrl={s.publicUrl} basemaps={jsonScript("ta-basemaps", [])}/>);
