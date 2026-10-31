// A dataset's page: its analysis, files, problems, WebODM plan and conversions
import "ol/ol.css";
import {DatasetPage} from "../dataset/dataset-page";
import {jsonScript, mountPage} from "../core/page";

mountPage((s) => <DatasetPage api={s.api} publicUrl={s.publicUrl} id={Number(s.data.id)}
                              projectId={Number(s.data.project)} projectName={s.data.projectName || ""}
                              palette={s.data.palette || ""}
                              basemaps={jsonScript("ta-basemaps", [])}/>);
