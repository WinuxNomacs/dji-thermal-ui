// The box every search is typed in: it filters as you type, and Escape empties it

interface Props {
    id: string;
    label: string;                      // its placeholder and accessible name: "Search projects"
    query: string;
    setQuery: (q: string) => void;
}

export function SearchBox({id, label, query, setQuery}: Props) {
    return (<input type="search" id={id} placeholder={label} aria-label={label} value={query}
                   onInput={(e) => setQuery(e.currentTarget.value)}
                   onKeyDown={(e) => {
                       if (e.key === "Escape" && query) {
                           e.preventDefault();
                           e.stopPropagation();
                           setQuery("");
                       }
                   }}/>);
}
