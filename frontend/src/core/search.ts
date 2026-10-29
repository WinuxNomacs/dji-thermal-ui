// Every search in the app matches the same way, as you type: each word of the query, in any order and any case,
// somewhere in the text searched ("roof north" finds "North roof")

// A query's words, lower case
export function searchWords(query: unknown): string[] {
    return String(query || "").toLowerCase().split(/\s+/).filter((w) => w);
}

// Whether every word of the query is in one of the texts (an empty query matches all)
export function matchesText(texts: string | (string | null | undefined)[], query: unknown): boolean {
    const text = (Array.isArray(texts) ? texts : [texts]).filter((t) => t).join("\n").toLowerCase();
    return searchWords(query).every((w) => text.includes(w));
}

// Whether the query is in a project's, a flight's or a dataset's name
export function matchesSearch(d: {name?: string}, query: string): boolean {
    return matchesText(d.name || "", query);
}
