// The few icons the pages use, inline: drawn in the text's colour, at its size
import type {JSX, SVGAttributes} from "preact";

type Props = {title?: string} & SVGAttributes<SVGSVGElement>;

function Icon({title, children, ...rest}: Props & {children: JSX.Element | JSX.Element[]}) {
    return (
        <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor"
             stroke-width={2} stroke-linecap="round" stroke-linejoin="round"
             aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...rest}>
            {title ? <title>{title}</title> : null}
            {children}
        </svg>
    );
}

export const Thermometer = (p: Props) => (
    <Icon {...p}><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/><path d="M12 9v8"/></Icon>);
export const Sun = (p: Props) => (
    <Icon {...p}><circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
    </Icon>);
export const Moon = (p: Props) => (<Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></Icon>);
export const Monitor = (p: Props) => (
    <Icon {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></Icon>);
export const Plus = (p: Props) => (<Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>);
export const Pencil = (p: Props) => (
    <Icon {...p}><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M15 5l4 4"/></Icon>);
export const Refresh = (p: Props) => (
    <Icon {...p}><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>
    </Icon>);
export const Trash = (p: Props) => (
    <Icon {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></Icon>);
export const Folder = (p: Props) => (
    <Icon {...p}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></Icon>);
export const Images = (p: Props) => (
    <Icon {...p}><rect x="7" y="3" width="14" height="14" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/>
        <path d="M21 13l-4-4-8 8"/></Icon>);
export const Check = (p: Props) => (<Icon {...p}><path d="M20 6L9 17l-5-5"/></Icon>);
export const Cog = (p: Props) => (
    <Icon {...p}><circle cx="12" cy="12" r="3"/>
        <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></Icon>);
export const CaretUp = (p: Props) => (<Icon {...p}><path d="M6 15l6-6 6 6"/></Icon>);
export const CaretDown = (p: Props) => (<Icon {...p}><path d="M6 9l6 6 6-6"/></Icon>);
export const Play = (p: Props) => (<Icon {...p}><path d="M7 4l13 8-13 8z"/></Icon>);
export const Stop = (p: Props) => (<Icon {...p}><rect x="5" y="5" width="14" height="14" rx="1"/></Icon>);
export const Copy = (p: Props) => (
    <Icon {...p}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </Icon>);
export const Link = (p: Props) => (
    <Icon {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></Icon>);
export const Unlink = (p: Props) => (
    <Icon {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/><path d="M3 3l18 18"/></Icon>);
export const Lock = (p: Props) => (
    <Icon {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></Icon>);
export const Unlock = (p: Props) => (
    <Icon {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/></Icon>);
export const Download = (p: Props) => (
    <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></Icon>);
export const Wand = (p: Props) => (
    <Icon {...p}><path d="M15 4V2M15 10V8M11 6h2M17 6h2M3 21l12-12"/></Icon>);
export const Lightbulb = (p: Props) => (
    <Icon {...p}><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z"/></Icon>);
export const Warning = (p: Props) => (
    <Icon {...p}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>
        <path d="M12 9v4M12 17h.01"/></Icon>);
export const ArrowLeft = (p: Props) => (<Icon {...p}><path d="M19 12H5M12 19l-7-7 7-7"/></Icon>);
export const ChevronLeft = (p: Props) => (<Icon {...p}><path d="M15 18l-6-6 6-6"/></Icon>);
export const ChevronRight = (p: Props) => (<Icon {...p}><path d="M9 18l6-6-6-6"/></Icon>);
export const Info = (p: Props) => (<Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></Icon>);
export const Save = (p: Props) => (
    <Icon {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>
    </Icon>);
export const Undo = (p: Props) => (<Icon {...p}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></Icon>);
export const Ellipsis = (p: Props) => (
    <Icon {...p}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Icon>);
export const List = (p: Props) => (<Icon {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></Icon>);
export const Map = (p: Props) => (
    <Icon {...p}><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z"/><path d="M8 2v16M16 6v16"/></Icon>);
export const Image = (p: Props) => (
    <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
    </Icon>);
export const Columns = (p: Props) => (<Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/></Icon>);
export const Sliders = (p: Props) => (
    <Icon {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></Icon>);
export const Grid = (p: Props) => (
    <Icon {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Icon>);
export const Crosshairs = (p: Props) => (
    <Icon {...p}><circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></Icon>);
export const Minus = (p: Props) => (<Icon {...p}><path d="M5 12h14"/></Icon>);
export const Polygon = (p: Props) => (<Icon {...p}><path d="M12 3l9 7-4 10H7L3 10z"/></Icon>);
export const Square = (p: Props) => (<Icon {...p}><rect x="4" y="4" width="16" height="16"/></Icon>);
export const Circle = (p: Props) => (<Icon {...p}><circle cx="12" cy="12" r="9"/></Icon>);
export const MapPin = (p: Props) => (
    <Icon {...p}><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></Icon>);
export const MoveTo = (p: Props) => (
    <Icon {...p}><path d="M3 7h6l2 2h10v10H3z"/><path d="M10 14h6M13 11l3 3-3 3"/></Icon>);
export const Search = (p: Props) => (
    <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></Icon>);
