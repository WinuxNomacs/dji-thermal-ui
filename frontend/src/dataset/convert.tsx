// The Convert tab: the settings (folded into chips once the dataset has conversions), saved as the defaults new
// conversions start from, and the conversions, each a card with its actions and, unfolded, what it wrote per image
import {type ComponentChildren} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {fileKind, formatNumber, mosaicLabel, stageText} from "../core/format";
import {convertDelta, formatDelta, formatTemp, unitOf, unitSymbol, userUnit} from "../core/units";
import {ask, askName} from "../components/dialog";
import {Ellipsis, Play, Save, Stop, Undo, Wand, Warning} from "../components/icons";
import {type Analysis} from "./files";
import {badgeClass, type Conversion, conversionLabel, type Detail, figures, isBusy, type Prefill, RESULTS_SHOWN,
        skipReasons} from "./conversions";
import {DISTANCE_MODES, type Diff, differences, formProblem, formValues, type FormValues, GIMBAL, markedField,
        MEASUREMENTS, type Meta, planSettings, readValues, recorded, resetSetting, type Settings, settingsIn, SIDES,
        UNIT_LABELS} from "./settings";

export interface ConvertDataset {id: number; analysis?: Analysis | null; conversions?: Conversion[]}

function Chips({diffs, title}: {diffs: Diff[]; title?: string}) {
    const shown = diffs.filter((d) => d.changed);
    return (<div class="chips" title={title}>
        {shown.length ? shown.map((d) => <span key={d.key} class={"chip changed" + (d.offPlan ? " off-plan" : "")}>{d.text}</span>) :
            <span class="text-muted">dji-thermal-cli's defaults</span>}
    </div>);
}

interface FieldProps {
    ctx: {marks: Record<string, Diff>; reset: (key: string) => void};
    name: string;
    label: string;
    help?: ComponentChildren;
    children: ComponentChildren;
}

// One setting, marked where it differs from the defaults (or the plan)
function Field({ctx, name, label, help, children}: FieldProps) {
    const m = ctx.marks[name];
    return (<div class={"field" + (m?.changed ? " changed" : "") + (m?.offPlan ? " off-plan" : "")} data-field={name}>
        <label>{label} {children}</label>
        {help && <div class="help text-muted">{help}</div>}
        {m && <div class="mark-note">{m.offPlan && m.plan !== null && <>⚠ plan: {m.plan} · </>}
            <a href="#convert" onClick={(e) => { e.preventDefault(); ctx.reset(m.key); }}>default</a></div>}
    </div>);
}

interface FormProps {
    meta: Meta;
    form: FormValues;
    setForm: (f: FormValues) => void;
    diffs: Diff[];
    reset: (key: string) => void;
    analysis?: Analysis | null;
}

// The settings form, its fields marked where they differ from the defaults (or the plan), each with a link back
function SettingsForm({meta, form, setForm, diffs, reset, analysis}: FormProps) {
    const u = unitSymbol(userUnit());
    const rec = recorded(analysis);
    const visual = (analysis?.files || []).filter((f) => fileKind(f) === "visual").length;
    const marks: Record<string, Diff> = {};
    diffs.forEach((d) => { const f = markedField(d.key); if (f && (d.changed || d.offPlan)) marks[f] = d; });
    const value = (name: string) => form.values[name] ?? "";
    const setValue = (name: string, v: string) => setForm({...form, values: {...form.values, [name]: v}});
    const setCheck = (name: string, v: boolean) => setForm({...form, checks: {...form.checks, [name]: v}});

    const ctx = {marks, reset};
    const num = (name: string, step = "any", disabled = false) => (
        <input type="number" name={name} step={step} disabled={disabled} value={value(name)}
               onInput={(e) => setValue(name, e.currentTarget.value)}/>);
    const check = (name: string, label: string) => (
        <label class="check"><input type="checkbox" name={name} checked={!!form.checks[name]}
                                    onChange={(e) => setCheck(name, e.currentTarget.checked)}/> {label}</label>);
    const adjusted = GIMBAL.some((g) => value(g[0]) !== "") || SIDES.some((s) => value("replace_" + s) !== "") ||
        !!form.checks.strip_location;

    return (<form class="settings-form" id="settings-form" onSubmit={(e) => e.preventDefault()}>
        <fieldset><legend>Colours</legend>
            <Field ctx={ctx} name="palette" label="Palette">
                <select name="palette" value={value("palette")} onChange={(e) => setValue("palette", e.currentTarget.value)}>
                    <option value="">Each image's own{rec.palettes.length ? " (" + rec.palettes.map((p) => p[0]).join(", ") + ")" : ""}</option>
                    {meta.palettes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></Field>
            <Field ctx={ctx} name="range_min" label={"Colour range (" + u + ")"}>{num("range_min")} to {num("range_max")}</Field>
        </fieldset>
        <fieldset><legend>Outputs</legend>
            {marks.output && <Field ctx={ctx} name="output" label="">{null}</Field>}
            {meta.products.map((p) => {
                const o = form.outputs[p.product] || {on: false, format: p.formats[0]};
                const set = (next: Partial<typeof o>) => setForm({...form, outputs: {...form.outputs, [p.product]: {...o, ...next}}});
                return (<div class="output" key={p.product}>
                    <label class="check"><input type="checkbox" name={"output-" + p.product} checked={o.on}
                                                onChange={(e) => set({on: e.currentTarget.checked})}/> {p.product}</label>
                    {p.formats.length > 1 && <select aria-label={p.product + " format"} value={o.format}
                                                     onChange={(e) => set({format: e.currentTarget.value})}>
                        {p.formats.map((f) => <option key={f} value={f}>{f}</option>)}</select>}
                    <span class="text-muted"> {p.description}</span>
                    {p.product === "rjpeg" && o.on && <Field ctx={ctx} name="rjpeg_picture" label="Its picture"
                            help="What photo viewers show. DJI's tools colour the temperatures themselves.">
                        <select name="rjpeg_picture" value={value("rjpeg_picture")}
                                onChange={(e) => setValue("rjpeg_picture", e.currentTarget.value)}>
                            <option value="palette">The palette's colours</option>
                            <option value="original">DJI's own</option></select></Field>}
                </div>);
            })}
            <Field ctx={ctx} name="compression" label="Compression">
                <select name="compression" value={value("compression")} onChange={(e) => setValue("compression", e.currentTarget.value)}>
                    <option value="deflate">deflate</option><option value="none">none</option></select></Field>
            <Field ctx={ctx} name="mosaics" label="" help="Stitches the outputs into georeferenced mosaics, to view on a map.">
                {check("mosaics", "Build the mosaics")}</Field>
            {visual > 0 && !!form.checks.mosaics && <Field ctx={ctx} name="visual" label=""
                                  help={"Stitches the " + visual + " visual images too, placed as their thermal frames are."}>
                {check("visual", "And the visual mosaic")}</Field>}
        </fieldset>
        <details open><summary>Measurement</summary>
            <p class="text-muted">Empty keeps each image's own value.</p>
            <Field ctx={ctx} name="distance_mode" label="Object distance" help={"Embedded " + formatNumber(rec.distance, 1, " m") +
                ", rangefinder " + formatNumber(rec.lrf, 1, " m") + " (medians)"}>
                <select name="distance_mode" value={value("distance_mode")}
                        onChange={(e) => setValue("distance_mode", e.currentTarget.value)}>
                    {DISTANCE_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                {value("distance_mode") === "fixed" && <> {num("distance")} m</>}</Field>
            {MEASUREMENTS.map((m) => {
                const r = rec[m.hint as "humidity"];
                const shown = r === null ? "not recorded" : "recorded " +
                    (m.temperature ? formatTemp(r, "C", 1) : formatNumber(r, m.digits ?? 1, m.unit ? " " + m.unit : ""));
                return (<Field ctx={ctx} key={m.key} name={m.key} label={m.label + (m.temperature ? " (" + u + ")" : m.unit ? " (" + m.unit + ")" : "")}
                               help={shown}>{num(m.key, m.step)}</Field>);
            })}
            <Field ctx={ctx} name="unit" label="Unit of the files">
                <select name="unit" value={value("unit")} onChange={(e) => setValue("unit", e.currentTarget.value)}>
                    {Object.entries(UNIT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </details>
        <details open><summary>Frames</summary>
            <Field ctx={ctx} name="normalize" label="">{check("normalize", "Normalize the frames to each other")}</Field>
            <Field ctx={ctx} name="max_pitch" label="Only frames with a gimbal pitch at or below (°)" help="-80 keeps the nadir frames only.">
                {num("max_pitch")}</Field>
        </details>
        <details open={adjusted}><summary>Adjustments</summary>
            <Field ctx={ctx} name="gimbal_yaw" label="Gimbal override (°)">
                {GIMBAL.map(([k, l]) => <span key={k}> {l} {num(k)}</span>)}</Field>
            {SIDES.map((s) => (<Field ctx={ctx} key={s} name={"replace_" + s} label={"Replace " + s + " (" + u + ")"}>
                {num("replace_" + s)} with {num("replace_" + s + "_value", "any", !!form.checks["replace_" + s + "_nodata"])}
                {check("replace_" + s + "_nodata", "with no data")}</Field>))}
            <Field ctx={ctx} name="strip_location" label="">{check("strip_location", "Remove the location from the files")}</Field>
        </details>
    </form>);
}

function Results({d, base, frames}: {d: Detail; base: string; frames: string | null}) {
    const r = d.results || {};
    const files = r.files || [];
    if (!files.length) {
        return <p class="text-muted">{d.status === "canceled" ? "Canceled before it finished: no results were kept." : "No results."}</p>;
    }
    const n = r.normalization;
    const download = (f: string) => base + d.id + "/download?file=" + encodeURIComponent(f);
    const reasons = skipReasons(files);
    return (<div class="results">
        {n && <p class="normalization">Normalized: ambient {formatTemp(n.ambient_c, "C", 1)}, reflected{" "}
            {formatTemp(n.reflected_c, "C", 1)}, {n.frames} frame(s) compared
            {n.offset_min !== null && n.offset_min !== undefined &&
                ", offsets " + formatNumber(convertDelta(n.offset_min, "C"), 2) + " to " + formatDelta(n.offset_max, "C", 2)}
            {n.without_offset ? ", " + n.without_offset + " without an offset" : ""}.</p>}
        {(d.mosaic_files || []).length > 0 && <p class="mosaic-files">Mosaics: {d.mosaic_files!.map((f, i) => (
            <>{i ? ", " : ""}<a href={download(f)}>{f.replace(/^mosaics\//, "")}</a></>))}</p>}
        {reasons.length > 0 && <p class="skip-reasons">Skipped: {reasons.map((x) => x[0] + " (" + x[1] + ")").join(", ")}.</p>}
        <div class="table-scroll"><table class="table results-table">
            <thead><tr><th>Image</th><th>Result</th><th>Outputs</th><th>Notes</th></tr></thead>
            <tbody>{files.slice(0, RESULTS_SHOWN).map((f) => {
                const notes = (f.notes || []).slice();
                if (f.distance_source) notes.unshift("distance " + formatNumber(f.distance, 1, " m") + " (" + f.distance_source + ")");
                return (<tr key={f.path} class={f.ok ? undefined : "skipped"}>
                    <td>{frames ? <a href={frames + "?frame=" + encodeURIComponent(f.path)} title="Open the frame">{f.path}</a> : f.path}</td>
                    <td>{f.ok ? <span class="text-success">Converted</span> : <><span class="text-warning">Skipped</span>: {f.reason}</>}</td>
                    <td>{(f.outputs || []).map((o, i) => <>{i ? <br/> : null}<a href={download(o)}>{o.split("/").pop()}</a></>)}</td>
                    <td>{notes.join("; ")}</td>
                </tr>);
            })}</tbody>
        </table></div>
        {files.length > RESULTS_SHOWN && <p class="text-muted">And {files.length - RESULTS_SHOWN} more: download all to see them.</p>}
    </div>);
}

interface CardProps {
    c: Conversion;
    defaults?: Settings;
    base: string;
    viewer: string;
    fresh: boolean;
    act: (what: string, c: Conversion) => void;
}

function Card({c, defaults, base, viewer, fresh, act}: CardProps) {
    const [menu, setMenu] = useState(false);
    const [detail, setDetail] = useState<Detail | null>(null);
    const [shown, setShown] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const ready = c.status === "ready", busy = isBusy(c), mosaics = ready && c.mosaic_status === "ready";

    useEffect(() => {
        if (!menu) return;
        const outside = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
        const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
        document.addEventListener("click", outside);
        document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("click", outside); document.removeEventListener("keydown", escape); };
    }, [menu]);

    // Unfolded results follow the conversion while it runs
    useEffect(() => { if (shown) loadDetail(); }, [shown, c.status, c.converted, c.skipped, c.mosaic_status]);

    async function loadDetail() {
        const r = await readJson<Detail>(await fetch(base + c.id, {credentials: "same-origin"}));
        if (r.ok) setDetail(r.data);
    }

    const item = (what: string, label: string, cls?: string) => (
        <li><button type="button" class={cls} data-action={what} onClick={() => { setMenu(false); act(what, c); }}>{label}</button></li>);
    // closed when chosen: a download leaves the page where it is
    const link = (href: string, label: string) => <li><a href={href} onClick={() => setMenu(false)}>{label}</a></li>;
    const pct = Math.round(((c.status === "converting" ? c.progress : c.mosaic_progress) || 0) * 100);

    return (<div class={"conversion" + (fresh ? " fresh" : "")} data-id={c.id}>
        <div class="conversion-head">
            <strong class="name">{c.name}</strong> <span class={badgeClass(c)}>{conversionLabel(c)}</span>
            <span class="conversion-actions">
                {busy ? <button type="button" class="button default small" data-action="cancel" onClick={() => act("cancel", c)}>
                    <Stop/> Cancel</button> :
                    mosaics ? <a class="button primary small" href={viewer + c.id}>View mosaics</a> :
                    ready ? <a class="button primary small" href={viewer + c.id + "/frame"}>Frames</a> :
                    <button type="button" class="button default small" data-action="use" onClick={() => act("use", c)}>Use settings</button>}
                <span class={"menu" + (menu ? " open" : "")} ref={ref}>
                    <button type="button" class="icon-button" title="More" aria-label="More" aria-expanded={menu}
                            onClick={() => setMenu(!menu)}><Ellipsis/></button>
                    {menu && <ul class="menu-items">
                        {mosaics && link(viewer + c.id + "/frame", "Frames")}
                        {mosaics && link(viewer + c.id + "/compare", "Compare with…")}
                        {(c.file_count || 0) > 0 && c.status !== "converting" && link(base + c.id + "/download", "Download all")}
                        <li><button type="button" data-action="files" onClick={() => { setMenu(false); setShown(!shown); }}>
                            {shown ? "Hide files" : "Files"}</button></li>
                        {(ready || busy) && item("use", "Use settings")}
                        {ready && c.mosaic_status !== "ready" && c.mosaic_status !== "building" && item("mosaics", "Build mosaics")}
                        {item("rename", "Rename")}
                        <li class="divider" role="separator"></li>
                        {item("delete", "Delete", "text-danger")}
                    </ul>}
                </span>
            </span>
        </div>
        <Chips diffs={differences(c.settings, defaults, null, unitOf(c.settings.unit))} title={c.description}/>
        {busy && <div class="progress row-progress"><div class="progress-bar active" style={{width: pct + "%"}}>{pct}%</div></div>}
        {c.status === "converting" && <div class="text-muted">{c.stage ? "Normalizing: " + stageText(c.stage) : "Starting…"}</div>}
        {c.error && <div class="text-danger"><Warning/> {c.error}</div>}
        <div class="text-muted figures-line">{figures(c).join(" · ")}</div>
        {c.mosaic_status === "building" ? <div class="mosaic-status text-info">{mosaicLabel(c)}</div> :
            c.mosaic_status === "failed" ? <div class="mosaic-status text-danger">The mosaics failed: {c.mosaic_error}</div> :
            c.mosaic_status === "canceled" ? <div class="mosaic-status text-muted">Building the mosaics was canceled.</div> :
            ready && c.mosaic_status !== "ready" ? <div class="mosaic-status text-muted">No mosaics.</div> : null}
        {shown && (detail ? <Results d={detail} base={base} frames={ready ? viewer + c.id + "/frame" : null}/> :
            <p class="text-muted">Loading…</p>)}
    </div>);
}

interface Props {
    api: string;
    publicUrl: string;
    dataset: ConvertDataset;
    onChange: () => void;
    planRequest: number;            // counts the plan's "Convert with these": each fills the form with its settings
    prefill: Prefill | null;
}

export function ConvertTab({api, publicUrl, dataset, onChange, planRequest, prefill}: Props) {
    const base = api + "conversions/", viewer = publicUrl + "conversion/";
    const conversions = dataset.conversions || [];
    const [meta, setMeta] = useState<Meta | null>(null);
    const [form, setForm] = useState<FormValues | null>(null);
    const [plan, setPlan] = useState<Settings | null>(null);
    const [open, setOpen] = useState(!conversions.length);
    const [name, setName] = useState("");
    const [message, setMessage] = useState<{text: ComponentChildren; cls: string} | null>(null);
    const [fresh, setFresh] = useState<number | null>(null);
    const prefilled = useRef(false);
    const say = (text: ComponentChildren, cls = "text-muted") => setMessage({text, cls});

    function fill(s: Settings, m = meta) { if (m) setForm(formValues(s, m.products)); }

    useEffect(() => {
        (async () => {
            const r = await readJson<Meta>(await fetch(api + "preferences", {credentials: "same-origin"}));
            if (!r.ok) return say("Could not load the settings.", "text-danger");
            setMeta(r.data);
            fill(r.data.settings, r.data);
        })();
    }, []);

    // The form filled with a conversion's settings and the changes a link asks for, once (its temperatures are the
    // frame page's, in the user's unit)
    useEffect(() => {
        if (!meta || !prefill || prefilled.current) return;
        const c = conversions.find((x) => x.id === prefill.from);
        if (!c) return;
        prefilled.current = true;
        fill({...c.settings, ...settingsIn(prefill.changes, userUnit(), c.settings.unit || "C")});
        setOpen(true);
        const changed = Object.entries(prefill.changes).map(([k, v]) => k.replace(/_/g, " ") + " " + v);
        say("The form has " + c.name + "'s settings" + (changed.length ? ", with " + changed.join(", ") : "") + ".");
    }, [meta, conversions.length]);

    const args = dataset.analysis?.webodm?.process_args;
    useEffect(() => {
        if (!planRequest || !meta || !args) return;
        const s = planSettings(args, meta.defaults);
        setPlan(s);
        fill(s);
        setOpen(true);
        say(<>The form has the WebODM plan's settings: <code>{args.join(" ")}</code></>);
    }, [planRequest, meta]);

    if (!meta || !form) return (<div class="convert-tab">{message ? <p class={message.cls}>{message.text}</p> : <p class="text-muted">Loading…</p>}
        {conversionsBlock()}</div>);

    const settings = readValues(form);
    const diffs = differences(settings, meta.defaults, plan, userUnit());

    async function start() {
        const problem = formProblem(settings);
        if (problem) return say(problem, "text-danger");
        const r = await readJson<Conversion>(await sendJson(api + "datasets/" + dataset.id + "/conversions", "POST",
                                                             {name: name.trim(), settings}));
        if (!r.ok) return say(errorText(r.data, "Could not start the conversion to a dataset."), "text-danger");
        setName("");
        setMessage(null);
        setFresh(r.data.id);
        setTimeout(() => setFresh(null), 4000);
        onChange();
    }

    async function save() {
        const r = await readJson<Meta>(await sendJson(api + "preferences", "PUT", {settings}));
        if (!r.ok) return say(errorText(r.data, "Could not save your defaults."), "text-danger");
        setMeta({...meta!, ...r.data, saved: true});
        say("Saved: new datasets start from these settings.", "text-success");
    }

    async function resetDefaults() {
        if (!await ask("Reset defaults", "Go back to dji-thermal-cli's defaults? Your saved defaults are forgotten.", "Reset")) return;
        const r = await readJson<Meta>(await sendJson(api + "preferences", "DELETE"));
        if (!r.ok) return say(errorText(r.data, "Could not reset your defaults."), "text-danger");
        setMeta({...meta!, ...r.data});     // the reply is the settings only, as when saving
        setPlan(null);
        fill(r.data.settings);
        say("Back to dji-thermal-cli's defaults.");
    }

    return (<div class="convert-tab">{settingsBlock()}{conversionsBlock()}</div>);

    function settingsBlock() {
        return (<div class="convert-settings">
            <p class="text-muted">Convert the images with dji-thermal-cli into a dataset: each dataset is kept beside the others, to
                compare settings. {meta!.saved ? "Starting from your saved defaults." : "Starting from dji-thermal-cli's defaults."}</p>
            <div class="convert-summary"><span>Settings:</span> <Chips diffs={diffs}/>
                <button type="button" class="button default small" id="edit-settings" aria-expanded={open}
                        aria-controls="settings-form" onClick={() => setOpen(!open)}>
                    {open ? "Hide settings" : "Edit settings"}</button></div>
            {open && <SettingsForm meta={meta!} form={form!} setForm={setForm} diffs={diffs} analysis={dataset.analysis}
                                   reset={(key) => fill(resetSetting(settings, meta!.defaults, key))}/>}
            <div class="convert-actions">
                <input type="text" id="convert-name" maxLength={255} placeholder="Name (optional)" aria-label="Name"
                       value={name} onInput={(e) => setName(e.currentTarget.value)}/>
                <button type="button" class="button primary" id="convert-start" onClick={start}><Play/> Convert</button>
                {args && <button type="button" class="button default" id="convert-plan"
                                 title="The outputs and options the WebODM plan recommends"
                                 onClick={() => { setPlan(planSettings(args, meta!.defaults)); fill(planSettings(args, meta!.defaults));
                                     setOpen(true); say(<>The form has the WebODM plan's settings: <code>{args.join(" ")}</code></>); }}>
                    <Wand/> Use the WebODM plan's settings</button>}
                <button type="button" class="button default" id="convert-save" title="New datasets start from these settings"
                        onClick={save}><Save/> Save as defaults</button>
                <button type="button" class="button default" id="convert-reset" onClick={resetDefaults}><Undo/> Reset to defaults</button>
            </div>
            {message && <div class={"convert-message " + message.cls} role="status">{message.text}</div>}
        </div>);
    }

    function conversionsBlock() {
        return (<>
            <h2>Datasets</h2>
            {!conversions.length && <p class="text-muted">No datasets yet.</p>}
            {conversions.map((c) => <Card key={c.id} c={c} defaults={meta?.defaults} base={base} viewer={viewer}
                                          fresh={c.id === fresh} act={act}/>)}
        </>);
    }

    async function act(what: string, c: Conversion) {
        let r: {ok: boolean; data: unknown} | null = null;
        if (what === "use") {
            fill(c.settings);
            setOpen(true);
            return say("The form has " + c.name + "'s settings.");
        } else if (what === "cancel") {
            r = await readJson(await sendJson(base + c.id + "/cancel", "POST", {}));
        } else if (what === "mosaics") {
            r = await readJson(await sendJson(base + c.id + "/mosaics", "POST", {}));
        } else if (what === "rename") {
            const n = await askName("Rename dataset", c.name);
            if (!n) return;
            r = await readJson(await sendJson(base + c.id, "PATCH", {name: n}));
        } else if (what === "delete") {
            if (!await ask("Delete dataset", "Delete " + c.name + " and its files? This cannot be undone.", "Delete", "danger")) return;
            r = await readJson(await sendJson(base + c.id, "DELETE"));
        }
        if (r && !r.ok) say(errorText(r.data, "Could not " + (what === "mosaics" ? "build the mosaics" : what + " the dataset") + "."),
                            "text-danger");
        onChange();
    }
}
