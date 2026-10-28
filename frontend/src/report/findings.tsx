// A report's findings: a table of them, numbered as on its map, then the frames each kept as thumbnails
import {count} from "../core/format";
import {type FileRow} from "../dataset/files";
import {type Finding, statusLabel, temperaturesText} from "../findings/findings";
import {SeverityChip} from "../findings/panel";
import {fileOf} from "./report";

const THUMBS_SHOWN = 6;         // a finding's kept frames shown before "and N more"

interface Props {
    items: (Finding & {number: number})[];
    files: FileRow[] | undefined;       // the dataset's files, which the frames' thumbnails are of
    thumbs: string;                     // the thumbnail URL, the file's path appended
    none: string;                       // said when there are none
}

export function FindingsSection({items, files, thumbs, none}: Props) {
    return (<section class="report-section" id="report-findings">
        <h2>Findings</h2>
        {items.length ? <>
            <table class="table report-findings">
                <thead><tr><th>#</th><th>Finding</th><th>Severity</th><th>Status</th><th>Temperatures</th>
                    <th>Read on</th></tr></thead>
                <tbody>{items.map((f) => (<tr key={f.id} data-finding={f.number}><td>{f.number}</td><td>{f.name}
                    {f.notes && <div class="report-notes-text">{f.notes}</div>}</td>
                    <td><SeverityChip severity={f.severity}/></td><td>{statusLabel(f.status)}</td>
                    <td>{temperaturesText(f.temperatures)}</td>
                    <td>{f.conversion_name}{f.tab ? " · " + f.tab.replace(/_/g, " ") : ""}</td></tr>))}</tbody>
            </table>
            {items.map((f) => {
                const kept = f.frames.filter((x) => x.kept).map((x) => fileOf(x.frame, files)).filter((x): x is string => !!x);
                return kept.length > 0 && (<figure class="report-thumbs report-keep" key={f.id}>
                    <figcaption>{f.number}. {f.name}: {count(kept.length, "frame", "frames")} kept</figcaption>
                    <div>{kept.slice(0, THUMBS_SHOWN).map((p) => (<span class="report-thumb" key={p}>
                        <img alt={p} src={thumbs + encodeURIComponent(p)}/><code>{p.split("/").pop()}</code></span>))}
                        {kept.length > THUMBS_SHOWN && <span class="text-muted">and {kept.length - THUMBS_SHOWN} more</span>}
                    </div>
                </figure>);
            })}
        </> : <p class="text-muted">{none}</p>}
    </section>);
}
