// What every report has: the text typed on it, saved on what it reports on once typing pauses; its fields (inputs on
// screen, their text alone in print); its title block; and the bar above it with the way back and the print button
import {type ComponentChildren} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {errorText, readJson, sendJson} from "../core/api";
import {ArrowLeft, Printer} from "../components/icons";

const SAVE_MS = 600;            // typing pauses this long before the text is saved

export type TextField = "title" | "author" | "date" | "notes";
export type Typed = Record<TextField, string>;

// The text shown and what changes it: each change sent ({report: the fields changed}) to url's PATCH once typing
// pauses (wait: 0 for a switch)
export function useReportText<T extends Typed>(url: string) {
    const [text, setText] = useState<T | null>(null);
    const [saved, setSaved] = useState("");
    const pending = useRef<Partial<T>>({});
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => () => clearTimeout(timer.current), []);

    async function save() {
        const report = pending.current;
        pending.current = {};
        const r = await readJson(await sendJson(url, "PATCH", {report}));
        setSaved(r.ok ? "Saved" : errorText(r.data, "Could not save the report's text."));
    }

    function change<K extends keyof T>(field: K, value: T[K], wait = SAVE_MS) {
        setText((t) => t && {...t, [field]: value});
        pending.current = {...pending.current, [field]: value};
        setSaved("");
        clearTimeout(timer.current);
        timer.current = setTimeout(save, wait);
    }

    return {text, setText, saved, change};
}

interface FieldProps {name: TextField; label: string; text: Typed; change: (field: TextField, value: string) => void}

// A field typed on the report, printed as its text alone (left out of the print when empty)
export function ReportField({name, label, text, change}: FieldProps) {
    const input = {id: "report-" + name, value: text[name],
                   onInput: (e: {currentTarget: {value: string}}) => change(name, e.currentTarget.value)};
    return (<label class={"report-field report-" + name + (text[name] ? "" : " empty")}>
        <span class="report-label">{label}</span>
        {name === "notes" ? <textarea rows={5} placeholder="Notes printed with the report" {...input}/> :
            name === "date" ? <input type="date" {...input}/> : <input type="text" {...input}/>}
        <span class="print-only report-value">{text[name]}</span>
    </label>);
}

// The title, the author and date under it, and what the report is of
export function TitleBlock({text, change, children}: {text: Typed; change: FieldProps["change"]; children: ComponentChildren}) {
    return (<header class="report-head">
        <ReportField name="title" label="Title" text={text} change={change}/>
        <div class="report-byline">
            <ReportField name="author" label="Author" text={text} change={change}/>
            <ReportField name="date" label="Date" text={text} change={change}/>
        </div>
        <p class="report-project">{children}</p>
    </header>);
}

interface BarProps {
    back: string;               // the page it was opened from
    backLabel: string;
    saved: string;              // whether the text was saved
    print: () => void;
    waiting?: string;           // why it cannot be printed yet (its figures are being drawn)
    children?: ComponentChildren;
}

// Above the report, not printed: the way back, whether the text was saved, the report's own switches, and printing
export function ReportBar({back, backLabel, saved, print, waiting, children}: BarProps) {
    return (<div class="report-bar no-print">
        <a href={back}><ArrowLeft/> {backLabel}</a>
        <span class="text-muted report-saved" role="status">{waiting || saved}</span>
        {children}
        <button type="button" class="button primary" id="print" title="Print, or choose Save as PDF as the printer"
                disabled={!!waiting} onClick={print}><Printer/> Print / Save as PDF</button>
    </div>);
}
