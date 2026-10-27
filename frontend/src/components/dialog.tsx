// The pages' dialog, in place of the browser's prompt and confirm: themed as the page is. dialog() shows it and
// resolves to {button, value}: the value of the button pressed (null when dismissed: Escape, or a click beside it)
// and the field's text. ask() and askName() are its two common uses.
import {type ComponentChildren, render} from "preact";
import {useLayoutEffect, useRef} from "preact/hooks";

export type ButtonStyle = "primary" | "danger" | "default";
export interface DialogButton<V> {label: string; value: V; style?: ButtonStyle}
export interface DialogOptions<V> {
    title: string;
    text?: string | string[];                               // a paragraph, or a list of them
    body?: ComponentChildren;                               // more after them (links, a list of steps)
    field?: {label?: string; value?: string; readonly?: boolean; placeholder?: string; error?: string};
    buttons?: DialogButton<V>[];                            // left to right
}
export interface DialogResult<V> {button: V | null; value: string | undefined}

interface Props<V> extends DialogOptions<V> {close: (button: V | null, value: string | undefined) => void}

function Dialog<V>({title, text, body, field, buttons, close}: Props<V>) {
    const all = buttons || [{label: "OK", value: true as V, style: "primary" as const}];
    const main = all.find((b) => b.style === "primary" || b.style === "danger");
    const fieldRef = useRef<HTMLInputElement>(null);
    const mainRef = useRef<HTMLButtonElement>(null);
    const value = () => fieldRef.current ? fieldRef.current.value : undefined;

    // At once, not after the next paint: the field or the button is in focus as soon as the dialog shows
    useLayoutEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                close(null, value());
            } else if (e.key === "Enter" && e.target === fieldRef.current && main) {
                e.preventDefault();
                close(main.value, value());
            }
        };
        document.addEventListener("keydown", onKey, true);
        if (fieldRef.current) {
            fieldRef.current.focus();
            fieldRef.current.select();
        } else {
            mainRef.current?.focus();
        }
        return () => document.removeEventListener("keydown", onKey, true);
    }, []);

    return (
        <div class="dialog" onClick={(e) => { if (e.target === e.currentTarget) close(null, value()); }}>
            <div class="dialog-inner" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
                <h2 id="dialog-title">{title}</h2>
                {([] as string[]).concat(text || []).map((t) => <p>{t}</p>)}
                {body}
                {field && (
                    <div class={"field" + (field.error ? " has-error" : "")}>
                        {field.label && <label for="dialog-field">{field.label}</label>}
                        <input type="text" id="dialog-field" maxLength={255} ref={fieldRef}
                               value={field.value || ""} readOnly={field.readonly} placeholder={field.placeholder}
                               aria-label={field.label ? undefined : title} />
                        {field.error && <div class="field-error">{field.error}</div>}
                    </div>
                )}
                <div class="dialog-actions">
                    {all.map((b, i) => (
                        <button type="button" class={"button " + (b.style || "default")}
                                ref={b === main || (!main && i === 0) ? mainRef : undefined}
                                onClick={() => close(b.value, value())}>
                            {b.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function dialog<V = boolean>(opts: DialogOptions<V>, doc: Document = document): Promise<DialogResult<V>> {
    const host = doc.createElement("div");
    (doc.querySelector(".page") || doc.body).appendChild(host);
    const before = doc.activeElement as HTMLElement | null;
    return new Promise((resolve) => {
        const close = (button: V | null, value: string | undefined) => {
            render(null, host);
            host.remove();
            before?.focus?.();
            resolve({button, value});
        };
        render(<Dialog {...opts} close={close} />, host);
    });
}

// Asks before doing something: resolves to true when it is to be done
export async function ask(title: string, text: string | string[], label = "OK",
                          style: ButtonStyle = "primary"): Promise<boolean> {
    const r = await dialog({title, text, buttons: [{label: "Cancel", value: false}, {label, value: true, style}]});
    return r.button === true;
}

// Asks for a new name: resolves to it, trimmed, or null when the dialog is dismissed or the name is blank or unchanged
export async function askName(title: string, name: string): Promise<string | null> {
    const r = await dialog({title, field: {label: "Name", value: name},
                            buttons: [{label: "Cancel", value: false}, {label: "Rename", value: true, style: "primary"}]});
    const v = (r.value || "").trim();
    return r.button === true && v && v !== name ? v : null;
}
