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
