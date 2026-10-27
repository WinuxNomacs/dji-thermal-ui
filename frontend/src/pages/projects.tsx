// The projects, the app's landing page
import {ProjectsPage} from "../projects/projects-page";
import {mountPage} from "../core/page";

mountPage((s) => <ProjectsPage api={s.api} publicUrl={s.publicUrl}/>);
