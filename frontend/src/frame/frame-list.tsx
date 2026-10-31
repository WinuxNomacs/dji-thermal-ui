// The explorer's frames: those of its list (all of them, in the mosaic, oblique: a switch once the mosaics placed
// frames, a list without frames not offered) in the order they were taken, as a list or as thumbnails (a switch,
// remembered per browser), the frame shown marked and kept in sight; choosing one shows it
import {useEffect, useRef, useState} from "preact/hooks";
import {count, formatCapture, type Maybe} from "../core/format";
import {FRAME_LISTS, type FrameEntry, frameTag} from "./frame";

const THUMBS_KEY = "thermal-analyzer.frame.thumbnails";

// A frame's name under its thumbnail: its end, where a flight's names differ ("…_0156_T.JPG")
const TAIL = 11;
export function shortName(path: string): string {
    const name = path.split("/").pop() || "";
    return name.length > TAIL + 1 ? "…" + name.slice(-TAIL) : name;
}

function thumbsStored(): boolean {
    try { return localStorage.getItem(THUMBS_KEY) === "1"; } catch { return false; }
}

interface Props {
    frames: FrameEntry[];
    frame: string | null;           // the frame shown
    choose: (path: string) => void;
    list: Maybe<string>;            // the list (FRAME_LISTS) whose frames these are
    sizes?: number[];               // how many frames each list has, once the mosaics placed frames
    chooseList?: (list: string | null) => void;
    maxPitch: Maybe<number>;
    built: boolean;                 // whether the mosaics are built: what they left out, and why
    thumbs: string;                 // the thumbnail URL, the frame's path appended
}

export function FrameList({frames, frame, choose, list, sizes, chooseList, maxPitch, built, thumbs}: Props) {
    const [asThumbs, setAsThumbs] = useState(thumbsStored);
    const items = useRef<HTMLOListElement>(null);

    function showThumbs(on: boolean) {
        setAsThumbs(on);
        try { localStorage.setItem(THUMBS_KEY, on ? "1" : "0"); } catch { /* not remembered */ }
    }

    // The frame shown stays in sight as ← and → step through the list
    useEffect(() => {
        items.current?.querySelector("[aria-current=true]")?.scrollIntoView?.({block: "nearest"});
    }, [frame, asThumbs]);

    return (<aside class="frame-list" aria-label="Frames">
        {sizes && chooseList && <div class="frame-lists">
            <div class="segmented" role="group" aria-label="Which frames">
                {FRAME_LISTS.map(([key, label], i) => (
                    <button key={label} type="button" name={key || "all"} aria-pressed={(list || null) === key}
                            disabled={!sizes[i]} onClick={() => chooseList(key)}>
                        {label} <span class="count">{sizes[i]}</span></button>))}
            </div>
        </div>}
        <div class="frame-list-head">
            <span class="message" id="frame-count">{count(frames.length, "frame", "frames")}</span>
            <div class="segmented" role="group" aria-label="Show the frames as">
                {([[false, "List"], [true, "Thumbnails"]] as [boolean, string][]).map(([on, label]) => (
                    <button key={label} type="button" name={on ? "thumbnails" : "list"} aria-pressed={asThumbs === on}
                            onClick={() => showThumbs(on)}>{label}</button>))}
            </div>
        </div>
        <ol class={"frame-items" + (asThumbs ? " thumbs" : "")} id="frames" ref={items}>
            {frames.map((f) => {
                const tag = frameTag(f, list, maxPitch, built);
                const about = asThumbs ? tag : [formatCapture(f.time, "time"), tag].filter(Boolean).join(" · ");
                return (<li key={f.path}>
                    <button type="button" data-path={f.path} aria-current={f.path === frame ? "true" : undefined}
                            title={f.path + (tag ? " (" + tag + ")" : "")} onClick={() => choose(f.path)}>
                        {asThumbs && <img loading="lazy" alt="" src={thumbs + encodeURIComponent(f.path)}/>}
                        <span class="frame-item-name">{asThumbs ? shortName(f.path) : f.path.split("/").pop()}</span>
                        {about && <span class="frame-item-about">{about}</span>}
                    </button>
                </li>);
            })}
        </ol>
    </aside>);
}
