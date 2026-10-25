// The header every page has: the unit temperatures are shown in, saved for the app, then the page shown again in it
(function (root) {
    function csrfToken(doc) {
        var m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc.cookie || "");
        return m ? decodeURIComponent(m[1]) : "";
    }

    function saveUnit(fetchFn, api, csrf, unit) {
        return fetchFn(api + "preferences", {method: "PUT", credentials: "same-origin",
                                             headers: {"Content-Type": "application/json", "X-CSRFToken": csrf},
                                             body: JSON.stringify({unit: unit})})
            .then(function (res) { if (!res.ok) throw new Error("the unit was not saved: " + res.status); });
    }

    function init(doc) {
        var select = doc.getElementById("ta-app-unit");
        if (!select) return;
        select.addEventListener("change", function () {
            select.disabled = true;
            saveUnit(root.fetch.bind(root), select.getAttribute("data-api"), csrfToken(doc), select.value)
                .then(function () { root.location.reload(); },
                      function () { select.disabled = false; select.value = root.__temperatureUnit; });
        });
    }

    var api = {csrfToken: csrfToken, saveUnit: saveUnit, init: init};
    root.ThermalAnalyzerApp = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else if (root.document) init(root.document);
})(typeof window !== "undefined" ? window : {});
