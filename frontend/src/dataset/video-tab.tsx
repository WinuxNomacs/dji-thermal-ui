// The Videos tab: a flight's videos with their covers, and the one chosen played beside a map of its track, a marker
// following the frame shown and a click on the track seeking to that moment
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
import {readJson} from "../core/api";
import {type FlightZone, formatBytes} from "../core/format";
import {type Basemap, fitBounds, lonLatToMap, mosaicMap, pointFeature, vectorLayer} from "../map/map";
import {framePositions} from "../report/report";
import type {FileRow} from "./files";
import {formatDuration, nearestPoint, pointAt, pointRows, type Track, type TrackPoint, trackPoints, type VideoRow,
        videoTime} from "./videos";

const MAX_FIT_ZOOM = 20;
const SEEK_REACH = 12;          // screen pixels: how near the track a click seeks
const TRACK = [new Style({stroke: new Stroke({color: "rgba(255, 255, 255, .85)", width: 5})}),
               new Style({stroke: new Stroke({color: "#e53935", width: 2.5})})];
const FRAME = new Style({image: new CircleStyle({radius: 2.5, fill: new Fill({color: "rgba(29, 107, 198, .55)"})})});
const MARKER = new Style({image: new CircleStyle({radius: 7, fill: new Fill({color: "#ffd600"}),
                                                  stroke: new Stroke({color: "#1d2329", width: 2})})});

function name(path: string): string { return path.split("/").pop() || path; }

interface Props {
    url: string;                // the flight's API URL
    files: FileRow[];
    videos: VideoRow[];
    zone?: FlightZone | null;
    basemaps: Basemap[];
}

export function VideosTab({url, files, videos, zone, basemaps}: Props) {
    const usable = videos.filter((v) => !v.reason);
    const [chosen, setChosen] = useState<string | null>(usable[0]?.path || null);
    const video = usable.find((v) => v.path === chosen) || null;
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
        {video && <Player key={video.path} url={url} video={video} files={files} basemaps={basemaps}/>}
    </div>);
}

interface PlayerProps {url: string; video: VideoRow; files: FileRow[]; basemaps: Basemap[]}

function Player({url, video, files, basemaps}: PlayerProps) {
    const player = useRef<HTMLVideoElement>(null);
    const el = useRef<HTMLDivElement>(null);
    const map = useRef<OlMap | null>(null);
    const source = useRef<VectorSource | null>(null);
    const marker = useRef<Feature<Point> | null>(null);
    const [points, setPoints] = useState<TrackPoint[]>([]);
    const [time, setTime] = useState(0);
    const [notice, setNotice] = useState("");
    const file = encodeURIComponent(video.path);

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

    // The marker and the readout follow the frame shown: each frame painted where the browser says so, else as the
    // time changes
    useEffect(() => {
        const v = player.current!;
        let handle = 0;
        const shown = (t: number) => setTime(t);
        const onTime = () => shown(v.currentTime);
        type FrameCallback = (cb: (now: number, meta: {mediaTime: number}) => void) => number;
        const each = (v as unknown as {requestVideoFrameCallback?: FrameCallback}).requestVideoFrameCallback;
        if (each) {
            const step = (_now: number, meta: {mediaTime: number}) => {
                shown(meta.mediaTime);
                handle = each.call(v, step);
            };
            handle = each.call(v, step);
        }
        v.addEventListener("timeupdate", onTime);
        v.addEventListener("seeked", onTime);
        return () => {
            v.removeEventListener("timeupdate", onTime);
            v.removeEventListener("seeked", onTime);
            const cancel = (v as unknown as {cancelVideoFrameCallback?: (h: number) => void}).cancelVideoFrameCallback;
            if (handle && cancel) cancel.call(v, handle);
        };
    }, []);

    const point = pointAt(points, time);
    useEffect(() => {
        if (marker.current && point && point.lat !== null && point.lon !== null) {
            marker.current.getGeometry()!.setCoordinates(lonLatToMap([point.lon, point.lat]));
        }
    }, [point]);

    return (<div class="video-player">
        <div class="video-panes">
            <div class="video-pane">
                <video ref={player} id="video" controls preload="metadata" src={url + "/video?file=" + file}
                       poster={url + "/video-cover?file=" + file}/>
                <table class="table readout video-readout" id="video-readout"><tbody>
                    {pointRows(point, time, video.fps).map(([label, value]) => (<tr key={label}><th>{label}</th><td>{value}</td></tr>))}
                </tbody></table>
            </div>
            <div class="map video-map" id="video-map" ref={el}
                 title={points.length ? "Click the track to go to that moment" : undefined}/>
        </div>
        {notice && <div class="notice error" role="alert">{notice}</div>}
    </div>);
}
