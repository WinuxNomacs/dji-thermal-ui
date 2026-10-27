// A dataset's page: its analysis, files, problems, WebODM plan and conversions
import {DatasetPage} from "../dataset/dataset-page";
import {mountPage} from "../core/page";

mountPage((s) => <DatasetPage api={s.api} publicUrl={s.publicUrl} id={Number(s.data.id)}
                              projectId={Number(s.data.project)} projectName={s.data.projectName || ""}/>);
