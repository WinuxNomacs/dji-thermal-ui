// Uploading images to a dataset, in batches, a few requests at a time, each sent again when it fails

const BATCH_FILES = 10;                 // images per upload request
const BATCH_BYTES = 40 * 1024 * 1024;   // or fewer, when they are large
const PARALLEL = 3;                     // requests at once
const RETRIES = 2;                      // a failed request is sent again this many times

// The path an image is uploaded under: its name, or its place in the folder chosen (without that folder's own name)
export function uploadName(file: File): string {
    const parts = (file.webkitRelativePath || "").split("/").filter((p) => p);
    return parts.length > 1 ? parts.slice(1).join("/") : file.name;
}

export function isImage(file: File): boolean { return /\.jpe?g$/i.test(file.name || ""); }
export function isVideo(file: File): boolean { return /\.mp4$/i.test(file.name || ""); }
// What a flight takes: its images, and its drone's videos
export function isFlightFile(file: File): boolean { return isImage(file) || isVideo(file); }
export const FLIGHT_FILES_ACCEPT = ".jpg,.jpeg,image/jpeg,.mp4,video/mp4";

// "12 image(s)", or "12 image(s) and 1 video(s)" when there are videos
export function flightFilesText(files: File[]): string {
    const videos = files.filter(isVideo).length;
    return files.filter(isImage).length + " image(s)" + (videos ? " and " + videos + " video(s)" : "");
}

// The upload requests: at most maxFiles images and maxBytes each (a larger image goes alone)
export function batches<F extends {size: number}>(files: F[], maxFiles = BATCH_FILES, maxBytes = BATCH_BYTES): F[][] {
    const out: F[][] = [];
    let cur: F[] = [], bytes = 0;
    for (const f of files) {
        if (cur.length && (cur.length >= maxFiles || bytes + f.size > maxBytes)) {
            out.push(cur);
            cur = [];
            bytes = 0;
        }
        cur.push(f);
        bytes += f.size;
    }
    if (cur.length) out.push(cur);
    return out;
}

// How long one upload request may take before it is given up on (and sent again): a base, plus its size at a slow
// connection's speed. A request dropped on the way would otherwise wait forever.
const TIMEOUT_BASE_MS = 30000;
const TIMEOUT_BYTES_PER_MS = 128;       // 128 KB/s
export function batchTimeout(bytes: number): number {
    return TIMEOUT_BASE_MS + Math.round((bytes || 0) / TIMEOUT_BYTES_PER_MS);
}

export interface Progress {sent: number; total: number; bytesSent: number; bytesTotal: number}
// failed: the images that were not saved, as the Files given, to send them again; when canceled, those not sent too
export interface UploadResult {saved: number; failed: File[]; canceled: boolean}

const sizeOf = (files: File[]) => files.reduce((s, f) => s + f.size, 0);

// Uploads images to a dataset, PARALLEL requests at a time. signal cancels the upload (the requests in flight are
// aborted, no more are sent).
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function uploadFiles(fetchFn: Fetch, url: string, csrf: string, files: File[],
                                  onProgress?: (p: Progress) => void,
                                  options: {signal?: AbortSignal} = {}): Promise<UploadResult> {
    const {signal} = options;
    const images = files.filter(isFlightFile);
    const queue = batches(images);
    const total = images.length;
    const bytesTotal = sizeOf(images);
    const state = {sent: 0, bytesSent: 0, saved: 0, failed: [] as File[]};
    const canceled = () => !!signal?.aborted;

    // One request, given up on after its timeout or when the upload is canceled: resolves to its response
    function request(batch: File[]): Promise<{saved?: number}> {
        const body = new FormData();
        // The server is sent each image's place in the folder chosen apart: a file's own name loses it
        for (const f of batch) {
            body.append("images", f, f.name);
            body.append("paths", uploadName(f));
        }
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stop: (why: string) => void = () => {};
        const onCancel = () => stop("upload canceled");
        // Settles even when fetchFn ignores the abort: a stalled request must never hold the upload up
        const givenUp = new Promise<never>((_resolve, reject) => {
            stop = (why) => {
                controller.abort();
                reject(new Error(why));
            };
            timer = setTimeout(() => stop("upload timed out"), batchTimeout(sizeOf(batch)));
            signal?.addEventListener("abort", onCancel);
        });
        const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onCancel);
        };
        const sent = fetchFn(url, {method: "POST", credentials: "same-origin", headers: {"X-CSRFToken": csrf},
                                   body, signal: controller.signal})
            .then((res) => {
                if (!res.ok) throw new Error("upload failed: " + res.status);
                return res.json();
            });
        return Promise.race([sent, givenUp]).finally(done);
    }

    // One batch, sent again up to RETRIES times: resolves to the number of images saved (null when it failed)
    async function send(batch: File[]): Promise<number | null> {
        for (let attempt = 0; ; attempt++) {
            try {
                return (await request(batch)).saved || 0;
            } catch {
                if (attempt >= RETRIES || canceled()) {
                    state.failed.push(...batch);
                    return null;
                }
            }
        }
    }

    async function worker(): Promise<void> {
        while (queue.length && !canceled()) {
            const next = queue.shift()!;
            const saved = await send(next);
            // A batch that failed is not counted as sent: the progress never reaches 100% with images missing
            if (saved === null) continue;
            state.saved += saved;
            state.sent += next.length;
            state.bytesSent += sizeOf(next);
            if (onProgress && !canceled()) onProgress({sent: state.sent, total, bytesSent: state.bytesSent, bytesTotal});
        }
    }

    await Promise.all(Array.from({length: PARALLEL}, worker));
    // Canceled: the batches never sent are not saved either
    for (const batch of queue) state.failed.push(...batch);
    return {saved: state.saved, failed: state.failed, canceled: canceled()};
}
