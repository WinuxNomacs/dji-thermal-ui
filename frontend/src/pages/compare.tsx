// Two mosaics side by side, or their difference
import "ol/ol.css";
import {ComparePage} from "../compare/compare-page";
import {jsonScript, mountPage} from "../core/page";

mountPage((s) => <ComparePage api={s.api} publicUrl={s.publicUrl} id={Number(s.data.id)} otherId={Number(s.data.b)}
                              name={s.data.name || ""} datasetName={s.data.datasetName || ""}
                              basemaps={jsonScript("ta-basemaps", [])}/>);
