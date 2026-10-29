// A palette's preview on the preferences page: a made-up thermal scene (a roof in the sun on cooler ground, with
// a warm pipe, two hot vents and a cool skylight), always the same, coloured as the map pages colour the values.
import {useEffect, useRef} from "preact/hooks";
import {colourValues} from "../map/colour";
import {formatTemp} from "../core/units";
import {gradientCss} from "../viewer/canvas";

export const SCENE_SIZE: [number, number] = [160, 120];
// The scene's temperatures (°C) at either end of the palette
export const SCENE_RANGE: [number, number] = [10, 60];

const bump = (x: number, y: number, cx: number, cy: number, r: number) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r));

// The scene's temperatures (°C), row by row
export function previewScene(width = SCENE_SIZE[0], height = SCENE_SIZE[1]): Float32Array {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const u = x / width, v = y / height;
            // Ground, a little warmer towards the bottom, with a gentle texture
            let t = 13 + 5 * v + 1.2 * Math.sin(x * 0.45) * Math.sin(y * 0.37);
            if (u > 0.14 && u < 0.86 && v > 0.18 && v < 0.82) {
                t = 27 + 6 * (u - 0.14) + 1.5 * Math.sin(y * 0.9);           // the roof, its seams in rows
                if (u > 0.58 && u < 0.72 && v > 0.3 && v < 0.46) t = 19;      // the skylight
                if (Math.abs(v - 0.68) < 0.025 && u > 0.2 && u < 0.8) t = 41; // the pipe
            }
            t += 30 * bump(u, v, 0.32, 0.36, 0.03) + 24 * bump(u, v, 0.45, 0.55, 0.025);  // the vents
            out[y * width + x] = t;
        }
    }
    return out;
}

interface Props {
    colors?: number[];          // the palette's colour map (0xRRGGBBAA), none when it is not at hand
    label: string;
    caption?: string;
}

export function PalettePreview({colors, label, caption}: Props) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [width, height] = SCENE_SIZE;
    useEffect(() => {
        const ctx = colors && colors.length ? canvas.current?.getContext("2d") : null;
        if (!ctx) return;
        const rgba = colourValues(previewScene(), width, height, {colors: colors!, range: SCENE_RANGE});
        ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    }, [colors]);

    if (!colors || !colors.length) {
        return (<div class="palette-preview" id="palette-preview">
            <p class="help">{label} is read from a flight's images: it is shown here once a flight that has it is
                converted.</p>
        </div>);
    }
    return (<figure class="palette-preview" id="palette-preview">
        <canvas ref={canvas} width={width} height={height} role="img" aria-label={label + " on a made-up roof"}/>
        <div class="palette-scale" style={{backgroundImage: gradientCss(colors)}}/>
        <div class="palette-scale-ends"><span>{formatTemp(SCENE_RANGE[0], "C", 0)}</span>
            <span>{formatTemp(SCENE_RANGE[1], "C", 0)}</span></div>
        <figcaption class="help">{caption || label}, on a made-up roof with two hot vents, a warm pipe and a cool
            skylight.</figcaption>
    </figure>);
}
