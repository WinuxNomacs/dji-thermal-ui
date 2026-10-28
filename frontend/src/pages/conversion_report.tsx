// A conversion's mosaic report, to print to PDF
import {mountPage} from "../core/page";
import {ConversionReportPage} from "../report/conversion-report-page";

mountPage((s) => <ConversionReportPage api={s.api} publicUrl={s.publicUrl} id={Number(s.data.id)}
                                       datasetId={Number(s.data.dataset)} datasetName={s.data.datasetName || ""}
                                       projectName={s.data.projectName || ""} location={s.data.location || ""}
                                       author={s.data.author || ""}/>);
