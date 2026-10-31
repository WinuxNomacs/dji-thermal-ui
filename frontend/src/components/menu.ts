// A menu's open state, closed by a click outside it or by Escape
import {useEffect, useRef, useState} from "preact/hooks";

export function useMenu<T extends HTMLElement = HTMLSpanElement>() {
    const [open, setOpen] = useState(false);
    const ref = useRef<T>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("click", outside);
        document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("click", outside); document.removeEventListener("keydown", escape); };
    }, [open]);
    return {open, setOpen, ref};
}
