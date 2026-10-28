// A dataset's report, to print to PDF
import {jsonScript, mountPage} from "../core/page";
import {DatasetReportPage} from "../report/dataset-report-page";

mountPage((s) => <DatasetReportPage api={s.api} publicUrl={s.publicUrl} id={Number(s.data.id)}
                                    projectName={s.data.projectName || ""} location={s.data.location || ""}
                                    author={s.data.author || ""} basemaps={jsonScript("ta-basemaps", [])}/>);
