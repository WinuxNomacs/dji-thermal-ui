// A file's picture at its own size, over the page: fitting the window at first, the wheel zooming about the pointer,
// 1:1 showing it pixel for pixel, and dragging panning it. Escape or × closes it.
import {useLayoutEffect, useRef, useState} from "preact/hooks";

const MAX_SCALE = 16;
const STEP = 1.25;          // a wheel notch's zoom

interface Place {scale: number; x: number; y: number}      // the image's top left on the stage, in px

export function FullSize({src, name, onClose}: {src: string; name: string; onClose: () => void}) {
    const stage = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<[number, number] | null>(null);     // the image's own, once loaded
    const [place, setPlace] = useState<Place | null>(null);
    const drag = useRef<{id: number; x: number; y: number} | null>(null);

    // Before the page's own keys: Escape closes this, not the pane under it
    useLayoutEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onClose();
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    function stageSize(): [number, number] {
        const r = stage.current?.getBoundingClientRect();
        return [r?.width || window.innerWidth, r?.height || window.innerHeight];
    }

    // At the scale given (the window's fit without one), centred
    function centred(scale?: number, own = size) {
        if (!own) return;
        const [w, h] = stageSize();
        const s = scale ?? Math.min(w / own[0], h / own[1]);
        setPlace({scale: s, x: (w - own[0] * s) / 2, y: (h - own[1] * s) / 2});
    }

    function onWheel(e: WheelEvent) {
        if (!place || !stage.current) return;
        e.preventDefault();
        const r = stage.current.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const [w, h] = stageSize();
        const least = size ? Math.min(1, w / size[0], h / size[1]) / 2 : 0.05;
        const scale = Math.min(MAX_SCALE, Math.max(least, place.scale * (e.deltaY < 0 ? STEP : 1 / STEP)));
        const k = scale / place.scale;
        setPlace({scale, x: px - (px - place.x) * k, y: py - (py - place.y) * k});
    }

    function onPointerDown(e: PointerEvent) {
        if (e.button !== 0) return;
        drag.current = {id: e.pointerId, x: e.clientX, y: e.clientY};
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
        const d = drag.current;
        if (!d || d.id !== e.pointerId || !place) return;
        setPlace({...place, x: place.x + e.clientX - d.x, y: place.y + e.clientY - d.y});
        drag.current = {...d, x: e.clientX, y: e.clientY};
    }

    function onPointerUp() { drag.current = null; }

    return (<div class="full-size" role="dialog" aria-modal="true" aria-label={"Full size: " + name}>
        <div class="full-size-bar">
            <strong class="full-size-name" title={name}>{name}</strong>
            {size && <span class="full-size-dims">{size[0]} × {size[1]} px{place ? ", " + Math.round(place.scale * 100) + " %" : ""}</span>}
            <button type="button" class="button default small full-size-fit" disabled={!size} onClick={() => centred()}>Fit</button>
            <button type="button" class="button default small full-size-actual" disabled={!size} onClick={() => centred(1)}>1:1</button>
            <button type="button" class="close" title="Close (Esc)" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div class="full-size-stage" ref={stage} onWheel={onWheel} onPointerDown={onPointerDown}
             onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            {!size && <p class="full-size-loading">Loading…</p>}
            <img src={src} alt={name} draggable={false}
                 class={place && place.scale >= 2 ? "pixelated" : undefined}
                 style={place ? {width: (size![0] * place.scale) + "px", height: (size![1] * place.scale) + "px",
                     transform: `translate(${place.x}px, ${place.y}px)`} : {visibility: "hidden"}}
                 onLoad={(e) => {
                     const im = e.currentTarget;
                     const own: [number, number] = [im.naturalWidth, im.naturalHeight];
                     setSize(own);
                     centred(undefined, own);
                 }}/>
        </div>
    </div>);
}
