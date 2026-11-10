// The line under the header while the app isn't answering, gone as soon as it answers again
import {useEffect, useState} from "preact/hooks";
import {answered, isSilent, onAnswerChanged} from "../core/answer";

const ASK_MS = 3000;

export function NoAnswer() {
    const [silent, setSilent] = useState(isSilent);
    useEffect(() => {
        setSilent(isSilent());      // it may have stopped answering before this was listening
        return onAnswerChanged(setSilent);
    }, []);
    useEffect(() => {
        if (!silent) return;
        // Any answer will do: a page that follows nothing has no other request to find out with
        const timer = setInterval(() => {
            fetch(location.href, {method: "HEAD", cache: "no-store", credentials: "same-origin"})
                .then(answered, () => { /* still not answering */ });
        }, ASK_MS);
        return () => clearInterval(timer);
    }, [silent]);
    return silent ? <div class="notice error no-answer" role="alert" id="no-answer">The app did not answer: is it still running?</div> : null;
}
