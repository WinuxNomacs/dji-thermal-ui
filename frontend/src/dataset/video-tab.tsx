// The Videos tab: a flight's videos with their covers, and the one chosen played beside a map of its track, a marker
// following the frame shown and a click on the track seeking to that moment. The frame shown can be recoloured: its
// colours turned back into the camera's levels and drawn in a palette, range and adjustments of the user's. Stepped by
// frames or seconds, played slower, and looped between an in and an out point, from the buttons or the keys.
import Feature from "ol/Feature";
import type OlMap from "ol/Map";
import LineString from "ol/geom/LineString";
import type Point from "ol/geom/Point";
import type VectorSource from "ol/source/Vector";
import {boundingExtent} from "ol/extent";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import {useEffect, useRef, useState} from "preact/hooks";
import {ChevronLeft, ChevronRight, Pause, Play} from "../components/icons";
import {readJson} from "../core/api";
import {type FlightZone, formatBytes, formatNumber} from "../core/format";
import {type Colouring, colourValues} from "../map/colour";
import {type Basemap, fitBounds, lonLatToMap, mosaicMap, pointFeature, vectorLayer} from "../map/map";
import {type IsothermState, Isotherm} from "../measure/result";
import {framePositions} from "../report/report";
import {Controls, ImageControls, type Palette} from "../viewer/panel";
import {type Adjust, defaultAdjust, parseRange, sliderGamma, sliderPositions, slidRange, toneShares} from "../viewer/view";
import type {FileRow} from "./files";
import {DJI_IRONRED} from "./ironbow";
import {levelCube, levelIsotherm, LEVELS, levelRange, toLevels} from "./video-levels";
import {formatDuration, keyAction, type KeyAction, type Loop, loopBack, nearestPoint, nextSpeed, pointAt, pointRows,
        SPEEDS, speedLabel, steppedTime, type Track, type TrackPoint, trackPoints, VIDEO_PALETTE, videoPalettes,
        type VideoRow, videoTime} from "./videos";

const MAX_FIT_ZOOM = 20;
const SEEK_REACH = 12;          // screen pixels: how near the track a click seeks
const TRACK = [new Style({stroke: new Stroke({color: "rgba(255, 255, 255, .85)", width: 5})}),
               new Style({stroke: new Stroke({color: "#e53935", width: 2.5})})];
const FRAME = new Style({image: new CircleStyle({radius: 2.5, fill: new Fill({color: "rgba(29, 107, 198, .55)"})})});
const MARKER = new Style({image: new CircleStyle({radius: 7, fill: new Fill({color: "#ffd600"}),
                                                  stroke: new Stroke({color: "#1d2329", width: 2})})});
// The keys' own work in these is left alone (a range slider's arrows are the tab's)
const TYPING = "input:not([type=range]), select, textarea, [contenteditable]";

function name(path: string): string { return path.split("/").pop() || path; }

// The camera's colours to levels, worked out once
let cube: Uint8Array | null = null;
const levelsCube = () => cube || (cube = levelCube(DJI_IRONRED));

// How a frame is recoloured: the palette, the range and the one the sliders move it from, the adjustments, the isotherm
export interface Look {palette: string; range: [number, number]; ref: [number, number]; adjust: Adjust; isotherm: IsothermState}
export const START_LOOK: Look = {palette: VIDEO_PALETTE, range: LEVELS, ref: LEVELS, adjust: defaultAdjust(), isotherm: {mode: ""}};

interface Props {
    api: string;                // the API's root URL
    url: string;                // the flight's API URL
    files: FileRow[];
    videos: VideoRow[];
    zone?: FlightZone | null;
    basemaps: Basemap[];
}

export function VideosTab({api, url, files, videos, zone, basemaps}: Props) {
    const usable = videos.filter((v) => !v.reason);
    const [chosen, setChosen] = useState<string | null>(usable[0]?.path || null);
    const [palettes, setPalettes] = useState<Palette[]>(() => videoPalettes([]));
    const [look, setLook] = useState<Look>(START_LOOK);
    const [recoloured, setRecoloured] = useState(false);
    const video = usable.find((v) => v.path === chosen) || null;

    useEffect(() => {
        let gone = false;
        (async () => {
            try {
                const r = await readJson<{view_palettes?: Palette[]}>(await fetch(api + "preferences", {credentials: "same-origin"}));
                if (!gone && r.ok) setPalettes(videoPalettes(r.data.view_palettes));
            } catch { /* the palette it was filmed in only */ }
        })();
        return () => { gone = true; };
    }, []);

    return (<div class="videos" id="videos">
        <ul class="video-list">
            {videos.map((v) => (<li key={v.path}>
                <button type="button" class={"video-item" + (v.path === chosen ? " active" : "")} data-path={v.path}
                        aria-pressed={v.path === chosen} disabled={!!v.reason} onClick={() => setChosen(v.path)}>
                    {!v.reason && <img loading="lazy" alt="" src={url + "/thumbnail?file=" + encodeURIComponent(v.path)}/>}
                    <span class="video-text">
                        <span class="video-name" title={v.path}>{name(v.path)}</span>
                        <span class="text-muted">{v.reason ? "Can't be played: " + v.reason :
                            [formatDuration(v.duration), v.width ? v.width + "×" + v.height : "", formatBytes(v.size)]
                                .filter(Boolean).join(" · ")}</span>
                        {!v.reason && <span class="text-muted">{[videoTime(v.utc, zone), v.model].filter(Boolean).join(" · ")}</span>}
                        {!v.reason && !v.track && <span class="text-muted">No track: the video has no DJI metadata</span>}
                    </span>
                </button></li>))}
        </ul>
        {video && <Player key={video.path} url={url} video={video} files={files} basemaps={basemaps} palettes={palettes}
                          look={look} setLook={setLook} recoloured={recoloured} setRecoloured={setRecoloured}/>}
    </div>);
}

interface PlayerProps {
    url: string; video: VideoRow; files: FileRow[]; basemaps: Basemap[]; palettes: Palette[];
    look: Look; setLook: (l: Look) => void; recoloured: boolean; setRecoloured: (on: boolean) => void;
}

interface Shown {width: number; height: number; min: number; max: number}

function Player({url, video, files, basemaps, palettes, look, setLook, recoloured, setRecoloured}: PlayerProps) {
    const player = useRef<HTMLVideoElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const grab = useRef<CanvasRenderingContext2D | null>(null);
    const levels = useRef<Float32Array<ArrayBuffer> | null>(null);
    const el = useRef<HTMLDivElement>(null);
    const map = useRef<OlMap | null>(null);
    const source = useRef<VectorSource | null>(null);
    const marker = useRef<Feature<Point> | null>(null);
    const [points, setPoints] = useState<TrackPoint[]>([]);
    const [time, setTime] = useState(0);
    const [paused, setPaused] = useState(true);
    const [speed, setSpeed] = useState(1);
    const [loop, setLoop] = useState<Loop>({start: null, end: null, on: false});
    const [shown, setShown] = useState<Shown | null>(null);
    const [pixel, setPixel] = useState<{x: number; y: number} | null>(null);
    const [rangeText, setRangeText] = useState<[string, string] | null>(null);
    const [notice, setNotice] = useState("");
    const file = encodeURIComponent(video.path), fps = video.fps || 30, duration = video.duration || 0;

    useEffect(() => {
        if (!video.track) return;
        let gone = false;
        (async () => {
            try {
                const r = await readJson<Track>(await fetch(url + "/video-track?file=" + file, {credentials: "same-origin"}));
                if (gone) return;
                if (!r.ok) return setNotice("Could not load the video's track.");
                setPoints(trackPoints(r.data));
            } catch {
                if (!gone) setNotice("Could not load the video's track.");
            }
        })();
        return () => { gone = true; };
    }, []);

    useEffect(() => {
        const m = mosaicMap(el.current!, basemaps).map;
        map.current = m;
        source.current = vectorLayer(m);
        return () => m.setTarget(undefined);
    }, []);

    // The track and the flight's frames, the marker on the frame shown; a click near the track seeks to it
    useEffect(() => {
        const m = map.current!, drawn = source.current!;
        drawn.clear();
        const placed = points.map((p) => p.lat !== null && p.lon !== null ? lonLatToMap([p.lon, p.lat]) : null);
        const line = placed.filter((p): p is number[] => !!p);
        const frames = framePositions(files).map((c) => lonLatToMap(c));
        frames.forEach((at) => {
            const f = pointFeature(at);
            f.setStyle(FRAME);
            drawn.addFeature(f);
        });
        if (line.length > 1) {
            const track = new Feature({geometry: new LineString(line)});
            track.setStyle(TRACK);
            drawn.addFeature(track);
        }
        marker.current = null;
        if (line.length) {
            marker.current = pointFeature(line[0]);
            marker.current.setStyle(MARKER);
            drawn.addFeature(marker.current);
        }
        const all = line.length ? line : frames;
        if (all.length) {
            const fit = () => {
                if (!fitBounds(m, boundingExtent(all), true, 30)) return false;
                if (m.getView().getZoom()! > MAX_FIT_ZOOM) m.getView().setZoom(MAX_FIT_ZOOM);
                return true;
            };
            if (!fit()) m.once("change:size", fit);
        }
        const seek = (e: {coordinate: number[]}) => {
            const i = nearestPoint(placed, e.coordinate, SEEK_REACH * (m.getView().getResolution() || 1));
            if (i >= 0 && player.current) player.current.currentTime = points[i].t;
        };
        m.on("click", seek);
        return () => m.un("click", seek);
    }, [points]);

    // The levels drawn as the look has them
    const colouring: Colouring = {colors: palettes.find((p) => p.key === look.palette)?.color_map || DJI_IRONRED,
        range: look.range, shares: look.adjust.gamma !== 1 ? toneShares(look.adjust.gamma) : null,
        sharpen: look.adjust.sharpen, isotherm: levelIsotherm(look.isotherm.mode, look.isotherm.a || "", look.isotherm.b || "").range};
    const paint = () => {
        const c = canvas.current, values = levels.current;
        const g = recoloured && c && values ? c.getContext("2d") : null;
        if (!g || !values || c!.width * c!.height !== values.length) return;
        const rgba = colourValues(values, c!.width, c!.height, colouring) as Uint8ClampedArray<ArrayBuffer>;
        g.putImageData(new ImageData(rgba, c!.width, c!.height), 0, 0);
    };
    // The frame on screen as levels (then drawn, when recoloured)
    const capture = () => {
        const v = player.current!, width = v.videoWidth, height = v.videoHeight;
        if (!width || !height || v.readyState < 2) return;
        if (!grab.current || grab.current.canvas.width !== width || grab.current.canvas.height !== height) {
            const off = document.createElement("canvas");
            off.width = width;
            off.height = height;
            grab.current = off.getContext("2d", {willReadFrequently: true});
            if (!grab.current) return;
        }
        grab.current.drawImage(v, 0, 0, width, height);
        const values = toLevels(grab.current.getImageData(0, 0, width, height).data, levelsCube(),
                                levels.current?.length === width * height ? levels.current : undefined);
        levels.current = values;
        let min = 255, max = 0;
        for (let i = 0; i < values.length; i++) {
            if (values[i] < min) min = values[i];
            if (values[i] > max) max = values[i];
        }
        if (canvas.current && (canvas.current.width !== width || canvas.current.height !== height)) {
            canvas.current.width = width;
            canvas.current.height = height;
        }
        setShown({width, height, min, max});
        paint();
    };
    // What the frame callback and the keys need as they are now, not as they were when they were set up
    const now = useRef({capture, loop, duration});
    now.current = {capture, loop, duration};

    useEffect(paint, [recoloured, palettes, look]);

    // The marker, the readout and the levels follow the frame shown: each frame painted where the browser says so,
    // else as the time changes; playing past the loop's ends goes back to its in point
    useEffect(() => {
        const v = player.current!;
        let handle = 0;
        const shownAt = (t: number) => {
            setTime(t);
            now.current.capture();
            const {loop: l, duration: end} = now.current;
            const back = v.paused ? null : loopBack(t, {...l, start: l.start ?? 0, end: l.end ?? end});
            if (back !== null) v.currentTime = back;
        };
        const onTime = () => shownAt(v.currentTime);
        const onPlay = () => setPaused(v.paused);
        type FrameCallback = (cb: (now: number, meta: {mediaTime: number}) => void) => number;
        const each = (v as unknown as {requestVideoFrameCallback?: FrameCallback}).requestVideoFrameCallback;
        if (each) {
            const step = (_now: number, meta: {mediaTime: number}) => {
                shownAt(meta.mediaTime);
                handle = each.call(v, step);
            };
            handle = each.call(v, step);
        }
        const events: [string, () => void][] = [["timeupdate", onTime], ["seeked", onTime], ["loadeddata", onTime],
                                                ["play", onPlay], ["pause", onPlay]];
        events.forEach(([e, f]) => v.addEventListener(e, f));
        return () => {
            events.forEach(([e, f]) => v.removeEventListener(e, f));
            const cancel = (v as unknown as {cancelVideoFrameCallback?: (h: number) => void}).cancelVideoFrameCallback;
            if (handle && cancel) cancel.call(v, handle);
        };
    }, []);

    function act(action: KeyAction) {
        const v = player.current!;
        const step = (frames: number) => {
            v.pause();
            v.currentTime = steppedTime(v.currentTime, frames, fps, duration);
        };
        const t = v.currentTime;
        if (action === "play") {
            if (v.paused) v.play().catch(() => setNotice("The video could not be played."));
            else v.pause();
        }
        else if (action === "back" || action === "forward") step(action === "back" ? -1 : 1);
        else if (action === "back-second" || action === "forward-second") step((action === "back-second" ? -1 : 1) * Math.round(fps));
        else if (action === "in") setLoop((l) => ({...l, start: t, end: l.end !== null && l.end > t ? l.end : null}));
        else if (action === "out") setLoop((l) => ({...l, end: t, start: l.start !== null && l.start < t ? l.start : null}));
        else if (action === "loop") setLoop((l) => ({...l, on: !l.on}));
        else {
            v.playbackRate = nextSpeed(v.playbackRate, action === "slower" ? -1 : 1);
            setSpeed(v.playbackRate);
        }
    }
    const actNow = useRef(act);
    actNow.current = act;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof Element && e.target.closest(TYPING)) return;
            const action = keyAction(e);
            if (!action) return;
            e.preventDefault();
            e.stopPropagation();
            actNow.current(action);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);

    const point = pointAt(points, time);
    useEffect(() => {
        if (marker.current && point && point.lat !== null && point.lon !== null) {
            marker.current.getGeometry()!.setCoordinates(lonLatToMap([point.lon, point.lat]));
        }
    }, [point]);

    // The pixel under the pointer, where the picture sits in its box (letterboxed as the video is)
    const pointAtPixel = (e: PointerEvent) => {
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (!shown || !box.width) return setPixel(null);
        const scale = Math.min(box.width / shown.width, box.height / shown.height);
        const x = Math.floor((e.clientX - box.left - (box.width - shown.width * scale) / 2) / scale);
        const y = Math.floor((e.clientY - box.top - (box.height - shown.height * scale) / 2) / scale);
        setPixel(x >= 0 && y >= 0 && x < shown.width && y < shown.height ? {x, y} : null);
    };
    const rows = pointRows(point, time, video.fps);
    const level = pixel && levels.current && shown ? levels.current[pixel.y * shown.width + pixel.x] : undefined;
    if (pixel && level !== undefined) rows.unshift(["Level", formatNumber(level, 0) + " (relative)"], ["Pixel", pixel.x + ", " + pixel.y]);

    const range = rangeText || [String(look.range[0]), String(look.range[1])];
    const typed = parseRange(range[0], range[1]);
    const sliders = sliderPositions(look.ref, look.range);
    const auto = () => {
        const r = levels.current ? levelRange(levels.current) : LEVELS;
        setRangeText(null);
        return r;
    };
    const isoError = levelIsotherm(look.isotherm.mode, look.isotherm.a || "", look.isotherm.b || "").error;
    const loopText = (t: number | null) => t === null ? "" : " " + formatDuration(t, 2);

    return (<div class="video-player">
        <div class="video-panes">
            <div class="video-pane">
                <div class="video-stage" onPointerMove={pointAtPixel} onPointerLeave={() => setPixel(null)}>
                    <video ref={player} id="video" controls={!recoloured} preload="auto" src={url + "/video?file=" + file}
                           poster={url + "/video-cover?file=" + file}/>
                    <canvas ref={canvas} id="video-recoloured" hidden={!recoloured}/>
                </div>
                <div class="video-transport toolbar" role="group" aria-label="Playback">
                    <button type="button" class="button default small" id="play" title={paused ? "Play (Space)" : "Pause (Space)"}
                            onClick={() => act("play")}>{paused ? <Play/> : <Pause/>}</button>
                    <button type="button" class="button default small" id="back-second" title="A second back (Shift+←)"
                            onClick={() => act("back-second")}>−1 s</button>
                    <button type="button" class="button default small" id="back" title="A frame back (←)"
                            onClick={() => act("back")}><ChevronLeft/></button>
                    <button type="button" class="button default small" id="forward" title="A frame on (→)"
                            onClick={() => act("forward")}><ChevronRight/></button>
                    <button type="button" class="button default small" id="forward-second" title="A second on (Shift+→)"
                            onClick={() => act("forward-second")}>+1 s</button>
                    <select id="speed" aria-label="Speed" title="Speed (− and +)" value={speed}
                            onChange={(e) => {
                                const v = player.current!;
                                v.playbackRate = parseFloat(e.currentTarget.value);
                                setSpeed(v.playbackRate);
                            }}>
                        {SPEEDS.map((s) => <option key={s} value={s}>{speedLabel(s)}</option>)}
                    </select>
                    <input type="range" id="seek" aria-label="Time" min={0} max={duration} step={1 / fps} value={time}
                           onInput={(e) => { player.current!.currentTime = parseFloat(e.currentTarget.value); }}/>
                    <span class="video-clock" id="clock">{formatDuration(time, 2)} / {formatDuration(duration, 2)}</span>
                </div>
                <div class="video-transport toolbar" role="group" aria-label="Loop">
                    <button type="button" class="button default small" id="in" title="The loop starts here (I)"
                            onClick={() => act("in")}>In{loopText(loop.start)}</button>
                    <button type="button" class="button default small" id="out" title="The loop ends here (O)"
                            onClick={() => act("out")}>Out{loopText(loop.end)}</button>
                    <button type="button" class={"button small " + (loop.on ? "primary" : "default")} id="loop"
                            aria-pressed={loop.on} title="Play between the in and out points again and again (L)"
                            onClick={() => act("loop")}>Loop</button>
                    <div class="segmented" role="group" aria-label="Picture">
                        {([[false, "Original"], [true, "Recoloured"]] as [boolean, string][]).map(([on, label]) => (
                            <button key={label} type="button" name={on ? "recoloured" : "original"} aria-pressed={recoloured === on}
                                    class={recoloured === on ? "active" : ""} onClick={() => setRecoloured(on)}
                                    title={on ? "The camera's levels in a palette, range and adjustments of yours" : "As filmed"}>
                                {label}</button>))}
                    </div>
                </div>
                <table class="table readout video-readout" id="video-readout"><tbody>
                    {rows.map(([label, value]) => (<tr key={label}><th>{label}</th><td>{value}</td></tr>))}
                </tbody></table>
            </div>
            <div class="video-side">
                <div class="map video-map" id="video-map" ref={el}
                     title={points.length ? "Click the track to go to that moment" : undefined}/>
                {recoloured && <div class="video-look" id="video-look">
                    <Controls tab={{tab: "video", stats: shown ? {min: shown.min, max: shown.max} : null}} palette={look.palette}
                              palettes={palettes} scale={{colors: colouring.colors, shown: look.range, caption: "Level (relative)",
                                                          shares: colouring.shares}}
                              unit="C" range={range} rangeError={typed.error}
                              onPalette={(palette) => setLook({...look, palette})}
                              onRange={(min, max) => {
                                  const r = parseRange(min, max);
                                  setRangeText(r.range ? null : [min, max]);
                                  if (r.range) setLook({...look, range: r.range, ref: r.range});
                              }}
                              onAuto={() => { const r = auto(); setLook({...look, range: r, ref: r}); }}/>
                    <ImageControls adjust={look.adjust} brightness={sliders.brightness} contrast={sliders.contrast} temperature={false}
                                   onSlide={(b, c) => setLook({...look, range: slidRange(look.ref, b, c)})}
                                   onGamma={(slider) => setLook({...look, adjust: {...look.adjust, gamma: sliderGamma(slider)}})}
                                   onSharpen={(sharpen) => setLook({...look, adjust: {...look.adjust, sharpen}})}
                                   onTone={() => undefined}
                                   onReset={() => { const r = auto(); setLook({...look, range: r, ref: r, adjust: defaultAdjust()}); }}/>
                    <h5>Isotherm</h5>
                    <Isotherm state={look.isotherm} error={isoError} what="Level" unit=""
                              onChange={(isotherm) => setLook({...look, isotherm})}/>
                </div>}
            </div>
        </div>
        {notice && <div class="notice error" role="alert">{notice}</div>}
    </div>);
}
