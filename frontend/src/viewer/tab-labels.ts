// The viewer's tabs as they are named, here on their own for the navigation pane (which every page has) to name them
export const TAB_LABELS: Record<string, string> = {as_converted: "Mosaic", harmonized: "Harmonized",
                                                   source_frame: "Source frame", view_angle: "View angle", visual: "Visual",
                                                   webodm: "WebODM", heights: "Heights"};

export function tabLabel(tab: string): string { return TAB_LABELS[tab] || tab; }
