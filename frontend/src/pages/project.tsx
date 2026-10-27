// A project: where its datasets were flown, and its datasets
import "ol/ol.css";
import {ProjectPage} from "../projects/project-page";
import {jsonScript, mountPage} from "../core/page";

mountPage((s) => <ProjectPage api={s.api} publicUrl={s.publicUrl} id={Number(s.data.id)}
                              basemaps={jsonScript("ta-basemaps", [])}/>);
