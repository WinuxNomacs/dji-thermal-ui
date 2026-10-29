// A settings page's filter: the box at its top, then its sections (each a fieldset.preference), those without every
// word typed in their text (title, labels, help and choices) hidden. A section's text can change once it has loaded
// (the Mapbox token's), so it is matched again then.
import {type ComponentChildren} from "preact";
import {useLayoutEffect, useRef, useState} from "preact/hooks";
import {matchesText} from "../core/search";
import {SearchBox} from "./search-box";

const SECTIONS = "fieldset.preference";

export function SectionFilter({label, children}: {label: string; children: ComponentChildren}) {
    const [query, setQuery] = useState("");
    const [none, setNone] = useState(false);
    const sections = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = sections.current!;
        function filter() {
            let shown = 0;
            el.querySelectorAll<HTMLElement>(SECTIONS).forEach((s) => {
                s.hidden = !matchesText(s.textContent || "", query);
                if (!s.hidden) shown++;
            });
            setNone(shown === 0);
        }
        filter();
        const watch = new MutationObserver(filter);
        watch.observe(el, {childList: true, subtree: true, characterData: true});
        return () => watch.disconnect();
    }, [query]);

    return (<>
        <div class="section-filter"><SearchBox id="section-filter" label={label} query={query} setQuery={setQuery}/></div>
        {none && query.trim() && <p class="message section-none">Nothing here matches the filter.</p>}
        <div ref={sections}>{children}</div>
    </>);
}
