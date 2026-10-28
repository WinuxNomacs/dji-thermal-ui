// Colours as the API gives them, as CSS, and the view as an image drawn on a canvas (Export PNG), ported from
// viewer.js
import type {Coordinate} from "ol/coordinate";
import type OlMap from "ol/Map";
import type {Coords, Geometry} from "../measure/measure";
import {scaleTicks} from "./view";

export function colorCss(encoded: number): string {
    const c = encoded >>> 0;
    return "rgb(" + ((c >>> 24) & 255) + "," + ((c >>> 16) & 255) + "," + ((c >>> 8) & 255) + ")";
}

// The palette's colour at a share of it, blended between its two nearest entries
export function paletteCss(encoded: number[], t: number): string {
    const x = Math.max(0, Math.min(1, t)) * (encoded.length - 1), i = Math.min(Math.floor(x), encoded.length - 2), f = x - i;
    if (i < 0) return colorCss(encoded[0]);
    const a = encoded[i] >>> 0, b = encoded[i + 1] >>> 0;
    const mix = (shift: number) => Math.round(((a >>> shift) & 255) * (1 - f) + ((b >>> shift) & 255) * f);
    return "rgb(" + mix(24) + "," + mix(16) + "," + mix(8) + ")";
}

// Colours as the API gives them (0xRRGGBBAA) as CSS colours: sampled at 16 stops, or, with shares (the palette's
// share at values evenly across the range: how the image is drawn), one per share, between the palette's entries
export function gradientStops(encoded: number[] | null | undefined, shares?: number[] | null): string[] {
    if (!encoded || !encoded.length) return [];
    if (shares && shares.length > 1) return shares.map((t) => paletteCss(encoded, t));
    const stops: string[] = [];
    for (let i = 0; i < 16; i++) stops.push(colorCss(encoded[Math.round(i * (encoded.length - 1) / 15)]));
    return stops;
}

// The same as a CSS gradient
export function gradientCss(encoded: number[] | null | undefined, shares?: number[] | null): string {
    const stops = gradientStops(encoded, shares);
    return stops.length ? "linear-gradient(to right, " + stops.join(", ") + ")" : "";
}

export interface CanvasShape {type: string; name: string; points: [number, number][]; color?: string}
// An image drawn where it is on the page (the values as a map drew them)
export interface Placed {image: CanvasImageSource; rect: DOMRect}
export interface Pane {el: HTMLElement; images: Placed[]; caption?: string; shapes?: CanvasShape[]}
export interface Scale {colors: number[]; shown: [number, number]; caption: string; shares?: number[] | null}

// A measurement on the image as it is on the map (the drawing's colours, or its own), its name beside it
export function drawShape(g: CanvasRenderingContext2D, s: CanvasShape): void {
    const pts = s.points;
    if (!pts || !pts.length) return;
    g.strokeStyle = s.color || "#00e5ff";
    g.lineWidth = 2;
    g.beginPath();
    if (s.type === "Point") {
        g.arc(pts[0][0], pts[0][1], 6, 0, 2 * Math.PI);
    } else {
        pts.forEach((p, i) => { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
        if (s.type === "Polygon") {
            g.closePath();
            if (!s.color) {
                g.fillStyle = "rgba(0, 229, 255, 0.1)";
                g.fill();
            }
        }
    }
    g.stroke();
    if (!s.name) return;
    g.font = "bold 12px sans-serif";
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0, 0, 0, 0.8)";
    g.strokeText(s.name, pts[0][0] + 9, pts[0][1] - 9);
    g.fillStyle = "#fff";
    g.fillText(s.name, pts[0][0] + 9, pts[0][1] - 9);
}

// The view as an image, drawn in the browser on a canvas: a title and the date above; each pane's own images
// (the mosaic's values, the frame's, as drawn) where they are on the page, its measurements drawn over them, named; below,
// the scale bar and the colour scale, and north (a map's, always up) when asked. The basemap is left out: its tiles
// come from elsewhere and can't be copied into an image.
export function viewCanvas(o: {title: string; date: string; panes: Pane[]; legend: Scale | null;
                                scale: {px: number; label: string} | null; ratio?: number; north?: boolean}): HTMLCanvasElement {
    const HEAD = 46, FOOT = 58, GAP = 8, PAD = 12, CAPTION = o.panes.some((p) => p.caption) ? 18 : 0;
    const boxes: {pane: Pane; rect: DOMRect; x: number}[] = [];
    let x = 0, height = 0;
    o.panes.forEach((p) => {
        const r = p.el.getBoundingClientRect();
        boxes.push({pane: p, rect: r, x});
        x += r.width + GAP;
        height = Math.max(height, r.height);
    });
    const width = Math.max(x - GAP, 360), ratio = o.ratio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round((HEAD + CAPTION + height + FOOT) * ratio);
    const g = canvas.getContext("2d")!;
    g.scale(ratio, ratio);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, width, HEAD + CAPTION + height + FOOT);
    g.fillStyle = "#222";
    g.textBaseline = "alphabetic";
    g.font = "bold 16px sans-serif";
    g.fillText(o.title || "", PAD, 22);
    g.font = "12px sans-serif";
    g.fillStyle = "#666";
    g.fillText(o.date || "", PAD, 39);
    boxes.forEach((b) => {
        const top = HEAD + CAPTION, p = b.pane;
        if (p.caption) {
            g.fillStyle = "#222";
            g.font = "bold 12px sans-serif";
            g.fillText(p.caption, b.x + 2, HEAD + 12);
        }
        g.save();
        g.beginPath();
        g.rect(b.x, top, b.rect.width, b.rect.height);
        g.clip();
        g.fillStyle = "#f2f2f2";
        g.fillRect(b.x, top, b.rect.width, b.rect.height);
        p.images.forEach(({image, rect: r}) => {
            g.drawImage(image, b.x + r.left - b.rect.left, top + r.top - b.rect.top, r.width, r.height);
        });
        g.translate(b.x, top);
        (p.shapes || []).forEach((s) => drawShape(g, s));
        g.restore();
    });
    const bottom = HEAD + CAPTION + height;
    if (o.scale) {
        g.strokeStyle = "#222";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(PAD, bottom + 24);
        g.lineTo(PAD, bottom + 30);
        g.lineTo(PAD + o.scale.px, bottom + 30);
        g.lineTo(PAD + o.scale.px, bottom + 24);
        g.stroke();
        g.fillStyle = "#222";
        g.font = "12px sans-serif";
        g.fillText(o.scale.label, PAD, bottom + 19);
    }
    const stops = gradientStops(o.legend?.colors, o.legend?.shares);
    if (o.legend && stops.length) {
        const w = Math.min(240, width / 2 - PAD), left = width - PAD - w;
        const grad = g.createLinearGradient(left, 0, left + w, 0);
        stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
        g.fillStyle = "#222";
        g.font = "12px sans-serif";
        g.fillText(o.legend.caption || "", left, bottom + 17);
        g.fillStyle = grad;
        g.fillRect(left, bottom + 22, w, 12);
        g.strokeStyle = "#999";
        g.lineWidth = 1;
        g.strokeRect(left, bottom + 22, w, 12);
        g.fillStyle = "#222";
        g.font = "11px sans-serif";
        scaleTicks(o.legend.shown[0], o.legend.shown[1], 5).forEach((t) => {
            g.textAlign = t.at < 0.1 ? "left" : t.at > 0.9 ? "right" : "center";
            g.fillText(t.label, left + t.at * w, bottom + 48);
        });
        g.textAlign = "left";
    }
    if (o.north) {
        const x = width - PAD - 8;
        g.fillStyle = "#222";
        g.beginPath();
        g.moveTo(x, 6);
        g.lineTo(x + 7, 26);
        g.lineTo(x, 21);
        g.lineTo(x - 7, 26);
        g.closePath();
        g.fill();
        g.font = "bold 11px sans-serif";
        g.textAlign = "center";
        g.fillText("N", x, 39);
        g.textAlign = "left";
    }
    return canvas;
}

// A canvas saved as a PNG file named name; resolves to an error, or null once it has been handed to the browser
export function saveCanvas(canvas: HTMLCanvasElement, name: string): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            canvas.toBlob((blob) => {
                if (!blob) return resolve("Could not make the image.");
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                resolve(null);
            }, "image/png");
        } catch (e) {
            resolve("Could not make the image (" + (e as Error).message + ").");
        }
    });
}

// A measurement's geometry as points on a map's pane (fromCoords: its coordinates to the map's)
export function shapeOnMap(map: OlMap, geometry: Geometry, fromCoords: (c: Coords) => Coordinate, name?: string): CanvasShape {
    const coords: Coords[] = geometry.type === "Point" ? [geometry.coordinates] :
        geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates[0].slice(0, -1);
    return {type: geometry.type, name: name || "", points: coords.map((c) => {
        const p = map.getPixelFromCoordinate(fromCoords(c));
        return [p[0], p[1]] as [number, number];
    })};
}
