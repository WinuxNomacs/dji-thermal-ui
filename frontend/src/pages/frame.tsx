// A conversion's frames, one at a time, measured
import "ol/ol.css";
import {FramePage} from "../frame/frame-page";
import {mountPage} from "../core/page";

mountPage((s) => <FramePage api={s.api} publicUrl={s.publicUrl} id={Number(s.data.id)} datasetId={Number(s.data.dataset)}
                            datasetName={s.data.datasetName || ""}/>);
