// The datasets list, the app's landing page
import {DatasetsPage} from "../datasets/datasets-page";
import {mountPage} from "../core/page";

mountPage((s) => <DatasetsPage api={s.api} publicUrl={s.publicUrl}/>);
