// Whether the app is answering: told by what asks it (a write, the polling that follows a job), shown by NoAnswer
const listeners = new Set<(silent: boolean) => void>();
let silent = false;

function set(value: boolean) {
    if (value === silent) return;
    silent = value;
    listeners.forEach((f) => f(value));
}

export function isSilent(): boolean { return silent; }
export function noAnswer(): void { set(true); }
export function answered(): void { set(false); }

export function onAnswerChanged(f: (silent: boolean) => void): () => void {
    listeners.add(f);
    return () => { listeners.delete(f); };
}
