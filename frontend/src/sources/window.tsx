// The source frames pop-out: a window on the page, moved by its title and closed, showing the whole frame that saw a
// spot or an area of a mosaic (coloured as the mosaic is, the spot marked or the area outlined), or its visual pair
// (the spot or area marked where the visual camera saw it), and the list of every frame that saw it, the one the
// mosaic used first; ← and → step through them. On the compare page a difference has a list for each of its mosaics.
import {type ComponentChildren} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {ChevronLeft, ChevronRight, Image} from "../components/icons";
import {readJson} from "../core/api";
import {formatCapture, type Maybe} from "../core/format";
import {inField} from "../measure/drawing";
import {temp} from "../measure/measure";
import {type Colouring, colourValues, readValues} from "../map/colour";
import {emptyText, frameName, NO_MODELS, ringToVisual, shareText, type SourceFrame, type Sources, stepped, svgPoints,
        toVisual, type VisualPair} from "./sources";

// One mosaic's frames, and how they are drawn and linked to
export interface SourceGroup {
    title: string;                          // what the mosaic is, where there are several
    res: Sources | null | undefined;        // undefined while it is asked, null when it could not be
    error?: string;
    unit: unknown;
    values: (frame: string) => string;      // a frame's values
    curve: (frame: string) => string;       // its tone curve with equalization, "" without
    colouring: Colouring;
    href: (frame: string) => string;        // its frame page
    visual?: (frame: string) => string;     // a thermal frame's visual pair as an image, where the frames have them
    about?: ComponentChildren;              // above its frame, while it is shown (after the window's own)
}

interface Props {
    groups: SourceGroup[];
    name: string;                           // which window: each keeps where it was moved to
    anchor?: HTMLElement | null;            // where it opens: over its top left corner
    about?: ComponentChildren;              // above the frame: what it is (a finding) or what can be done with it
    visual?: boolean;                       // it opens on the frames' visual pairs
    onClose: () => void;
}

const HEAD = 36;            // the title bar stays this much in sight
const kept: Record<string, {left: number; top: number}> = {};

const get = (url: string) => fetch(url, {credentials: "same-origin"});

function clampAt(left: number, top: number, width: number): {left: number; top: number} {
    return {left: Math.round(Math.max(0, Math.min(innerWidth - Math.min(width, innerWidth), left))),
            top: Math.round(Math.max(0, Math.min(innerHeight - HEAD, top)))};
}

function startAt(anchor: Maybe<HTMLElement>): {left: number; top: number} {
    const r = anchor?.getBoundingClientRect();
    return clampAt(r ? r.left + 12 : 16, r ? r.top + 12 : 80, 0);
}

// A frame's values coloured as the mosaic's are (curve: its tone curve with equalization, else ""), with the spot's
// pixel marked or the area's outline drawn over it
export function FrameImage({values, curve, colouring, alt, pixel, outline}: {
    values: string; curve: string; colouring: Colouring; alt: string; pixel?: Maybe<[number, number]>;
    outline?: [number, number][][];
}) {
    const [drawn, setDrawn] = useState<{values: Float32Array; width: number; height: number} | null>(null);
    const [shares, setShares] = useState<number[] | null>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const size = drawn && drawn.width > 0 && drawn.height > 0 ? [drawn.width, drawn.height] : null;

    useEffect(() => {
        let live = true;
        setDrawn(null);
        get(values).then(readValues).then((d) => { if (live) setDrawn(d); }, () => { /* the frame is not drawn then */ });
        return () => { live = false; };
    }, [values]);
    useEffect(() => {
        let live = true;
        setShares(null);
        if (curve) get(curve).then((res) => readJson<{shares?: number[]}>(res))
            .then((r) => { if (live && r.ok) setShares(r.data.shares || null); }, () => { /* toned by gamma alone then */ });
        return () => { live = false; };
    }, [curve]);
    useEffect(() => {
        const ctx = drawn && canvas.current?.getContext("2d");
        if (!drawn || !ctx) return;
        const rgba = colourValues(drawn.values, drawn.width, drawn.height, {...colouring, shares: shares || colouring.shares});
        ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, drawn.width, drawn.height), 0, 0);
    }, [drawn, shares, JSON.stringify(colouring)]);

    return (<div class="frame-image">
        <canvas ref={canvas} role="img" aria-label={alt} data-values={values} width={size ? size[0] : 0}
                height={size ? size[1] : 0}/>
        {size && <Marks size={size} pixel={pixel} outline={outline}/>}
    </div>);
}

// The spot's pixel marked, or the area's outline drawn, over a frame of this size shown whole
function Marks({size, pixel, outline}: {size: number[]; pixel?: Maybe<[number, number]>; outline?: [number, number][][]}) {
    return (<>
        {pixel && <span class="frame-mark" style={{
            left: ((pixel[0] + 0.5) / size[0] * 100).toFixed(2) + "%", top: ((pixel[1] + 0.5) / size[1] * 100).toFixed(2) + "%"}}/>}
        {outline && outline.length > 0 && <svg class="frame-outline" viewBox={"0 0 " + size[0] + " " + size[1]}
                                               preserveAspectRatio="none" aria-hidden="true">
            {outline.map((ring, i) => <polygon key={i} points={svgPoints(ring)}/>)}
        </svg>}
    </>);
}

// A thermal frame's visual pair (src: its image), with the thermal frame's spot or area where the visual camera saw it
export function VisualImage({src, pair, alt, pixel, outline}: {
    src: string; pair: VisualPair; alt: string; pixel?: Maybe<[number, number]>; outline?: [number, number][][];
}) {
    const at = pixel ? toVisual(pair, pixel) : null;
    const rings = outline ? outline.map((r) => ringToVisual(pair, r)).filter((r) => r.length > 2) : undefined;
    return (<div class="frame-image visual">
        <img src={src} alt={alt} width={pair.width} height={pair.height}/>
        <Marks size={[pair.width, pair.height]} pixel={at} outline={rings}/>
    </div>);
}

function FrameRow({f, current, onPick}: {f: SourceFrame; current: boolean; onPick: () => void}) {
    const details = [formatCapture(f.time, "time"), f.view_angle !== null && f.view_angle !== undefined ?
        f.view_angle + "° off nadir" : "", shareText(f)].filter(Boolean);
    return (<li><button type="button" class={current ? "active" : ""} aria-current={current ? "true" : undefined}
                        data-frame={f.frame} onClick={onPick}>
        <span class="sources-frame-name">{frameName(f.frame)}{f.used && <span class="chip">in the mosaic</span>}</span>
        <span class="sources-frame-details">{details.join(" · ")}</span>
    </button></li>);
}

export function SourcesWindow({groups, name, anchor, about, visual: startVisual = false, onClose}: Props) {
    const [g, setG] = useState(0);
    const [visual, setVisual] = useState(startVisual);
    const [index, setIndex] = useState(0);
    const [at, setAt] = useState(() => kept[name] || startAt(anchor));
    const el = useRef<HTMLDivElement>(null);
    const group = groups[Math.min(g, groups.length - 1)];
    const res = group?.res;
    const frames = res?.frames || [];
    const i = Math.min(index, Math.max(0, frames.length - 1)), f = frames[i];

    // A new answer starts from its first frame (the mosaic's)
    const answered = groups.map((x) => x.res ? JSON.stringify(x.res.geometry) : String(x.res)).join("|");
    useEffect(() => setIndex(0), [answered, g]);
    useEffect(() => { el.current?.focus({preventScroll: true}); }, []);

    function drag(e: PointerEvent) {
        if ((e.target as HTMLElement).closest("button") || !el.current) return;
        const box = el.current.getBoundingClientRect(), dx = e.clientX - box.left, dy = e.clientY - box.top;
        const move = (m: PointerEvent) => setAt(kept[name] = clampAt(m.clientX - dx, m.clientY - dy, box.width));
        const up = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
        e.preventDefault();
    }

    function key(e: KeyboardEvent) {
        if (inField(e.target)) return;
        if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
        } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && frames.length) {
            e.preventDefault();
            setIndex(stepped(i, e.key === "ArrowLeft" ? -1 : 1, frames.length));
        }
    }

    const what = res ? (res.kind === "Point" ? "Spot" : "Area") + (frames.length ? " · " + frames.length +
        (frames.length === 1 ? " frame" : " frames") : "") : "";
    const here = res?.point?.temperature;
    let body;
    if (!group || res === undefined) body = <p class="message">Finding the frames…</p>;
    else if (res === null) body = <p class="text-danger">{group.error || "Could not find the frames."}</p>;
    else if (!f) body = <p class="message">{emptyText(res)}</p>;
    else {
        const pixel = res.kind === "Point" ? f.pixel : null, outline = res.kind === "Polygon" ? f.outline : undefined;
        const pair = group.visual && f.visual ? f.visual : null;
        body = (<>
            {group.visual && <div class="segmented sources-camera" role="group" aria-label="Camera">
                <button type="button" name="thermal" class={!visual || !pair ? "active" : ""} aria-pressed={!visual || !pair}
                        onClick={() => setVisual(false)}>Thermal</button>
                <button type="button" name="visual" class={visual && pair ? "active" : ""} aria-pressed={!!(visual && pair)}
                        disabled={!pair} title={pair ? "Its visual image, " + frameName(pair.frame) : "No visual image paired with this frame"}
                        onClick={() => setVisual(true)}>Visual</button>
            </div>}
            {visual && pair ? <VisualImage src={group.visual!(f.frame)} pair={pair} alt={pair.frame} pixel={pixel} outline={outline}/> :
                <FrameImage values={group.values(f.frame)} curve={group.curve(f.frame)} colouring={group.colouring} alt={f.frame}
                            pixel={pixel} outline={outline}/>}
            <div class="sources-nav">
                <button type="button" class="button default small" name="previous" title="The previous frame (←)"
                        aria-label="Previous frame" disabled={i === 0} onClick={() => setIndex(i - 1)}><ChevronLeft/></button>
                <span class="sources-count">{i + 1} of {frames.length}</span>
                <button type="button" class="button default small" name="next" title="The next frame (→)"
                        aria-label="Next frame" disabled={i === frames.length - 1} onClick={() => setIndex(i + 1)}><ChevronRight/></button>
                <a class="button default small" href={group.href(f.frame)}><Image/> Open frame</a>
            </div>
            {res.kind === "Point" && !f.pixel && <p class="message">The spot is not marked: build the mosaics again to know where it is.</p>}
            {res.kind === "Polygon" && !res.models && <p class="message">The area is not outlined without the frames' models.</p>}
            {here !== null && here !== undefined && <p class="sources-here">The mosaic here: <strong>{temp(here, group.unit)}</strong></p>}
            <ol class="sources-list">
                {frames.map((x, k) => <FrameRow key={x.frame} f={x} current={k === i} onPick={() => setIndex(k)}/>)}
            </ol>
            {!res.models && <p class="message">{NO_MODELS}</p>}
        </>);
    }

    return (<div class="sources-window" ref={el} role="dialog" aria-label="Source frames" tabIndex={-1} data-window={name}
                 style={{left: at.left + "px", top: at.top + "px"}} onKeyDown={key}>
        <div class="sources-head" onPointerDown={drag}>
            <strong>Source frames</strong><span class="sources-what">{what}</span>
            <button type="button" class="close" name="close" title="Close (Esc)" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {groups.length > 1 && <div class="segmented sources-groups" role="group" aria-label="Mosaic">
            {groups.map((x, k) => <button key={k} type="button" class={k === g ? "active" : ""} aria-pressed={k === g}
                                          title={x.title} onClick={() => setG(k)}>{x.title}</button>)}
        </div>}
        <div class="sources-body">{about}{group?.about}{body}</div>
    </div>);
}
