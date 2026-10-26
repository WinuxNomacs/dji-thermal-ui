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
