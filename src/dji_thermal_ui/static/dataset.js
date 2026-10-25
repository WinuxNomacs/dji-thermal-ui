// A thermal dataset's page: what dji-thermal-cli found in it (an overview, then tabs: the files, the problems,
// the WebODM plan and its conversions, see conversions.js), with adding images and analyzing again.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var conversionsModule = root.ThermalAnalyzerConversions || (typeof require !== "undefined" ? require("./conversions") : null);
    var esc = function (t) { return core.escapeHtml(t); };
    var POLL_MS = 2000;
    var FILES_SHOWN = 12;     // files listed under a problem before "and N more"
    var THUMBS_KEY = "thermalAnalyzer.thumbnails";     // the Files tab's Thumbnails box, remembered per browser

    // EXIF's "2026:10:12 18:29:50" as "2026-10-12 18:29:50"
    function captureTime(t) { return t ? String(t).replace(/^(\d{4}):(\d{2}):/, "$1-$2-") : ""; }

    // The figures above the tabs, from the analysis
    function overview(a) {
        var thermal = (a.files || []).filter(function (f) { return f.kind === "thermal"; });
        var out = {frames: thermal.length, other: (a.files || []).length - thermal.length};
        if (!thermal.length) return out;
        var mins = thermal.map(function (f) { return f.tmin; }).filter(function (x) { return x !== null && x !== undefined; });
        var maxs = thermal.map(function (f) { return f.tmax; }).filter(function (x) { return x !== null && x !== undefined; });
        if (mins.length) out.tmin = Math.min.apply(null, mins);
        if (maxs.length) out.tmax = Math.max.apply(null, maxs);
        var times = thermal.map(function (f) { return captureTime(f.time); }).filter(function (t) { return t; }).sort();
        if (times.length) { out.first = times[0]; out.last = times[times.length - 1]; }
        out.altitude = core.median(thermal.map(function (f) { return f.alt; }));
        out.gps = thermal.filter(function (f) { return f.lat !== null && f.lat !== undefined; }).length;
        return out;
    }

    function overviewHtml(d) {
        var a = d.analysis || {};
        if (!a.files) return "";
        var o = overview(a);
        var items = [["Thermal frames", String(o.frames) + (o.other ? " (and " + o.other + " other file(s))" : "")]];
        (a.cameras || []).forEach(function (c) {
            items.push(["Camera", (c.model || "?") + (c.width ? " · " + c.width + "×" + c.height : "") +
                (c.serial ? " · " + c.serial : "") + " · " + c.frames + " frame(s)"]);
        });
        if (o.tmin !== undefined) items.push(["Temperatures", core.formatTemp(o.tmin, "C", 1) + " to " + core.formatTemp(o.tmax, "C", 1)]);
        if (o.first) items.push(["Captured", o.first === o.last ? o.first : o.first + " to " + o.last.split(" ")[1]]);
        if (o.altitude !== null && o.altitude !== undefined) items.push(["Height (median)", core.formatNumber(o.altitude, 1, " m")]);
        if (o.frames) items.push(["With GPS", o.gps + " of " + o.frames]);
        items.push(["Size", core.formatBytes(d.size)]);
        if (d.analyzed_at) items.push(["Analyzed", core.formatDate(d.analyzed_at) + (a.version ? " · dji-thermal-cli " + a.version : "")]);
        return '<dl class="ta-figures">' + items.map(function (i) {
            return "<div><dt>" + esc(i[0]) + "</dt><dd>" + esc(i[1]) + "</dd></div>";
        }).join("") + "</dl>";
    }

    // The problems each file is named in: {path: [finding, ...]}
    function flagsByFile(findings) {
        var out = {};
        (findings || []).forEach(function (f) {
            (f.files || []).forEach(function (p) { (out[p] = out[p] || []).push(f); });
        });
        return out;
    }

    var FILE_COLUMNS = [
        {key: "path", label: "File"},
        {key: "kind", label: "Kind"},
        {key: "time", label: "Captured"},
        {key: "alt", label: "Height", unit: " m", digits: 1, title: "Above the take-off point"},
        {key: "pitch", label: "Pitch", unit: "°", digits: 1, title: "Gimbal pitch (-90° looks straight down)"},
        {key: "tmin", label: "Min", temperature: true, digits: 1},
        {key: "tmax", label: "Max", temperature: true, digits: 1},
        {key: "tmean", label: "Mean", temperature: true, digits: 1},
        {key: "distance", label: "Distance", unit: " m", digits: 1, title: "Object distance embedded in the image / the rangefinder's"},
        {key: "emissivity", label: "Emissivity", digits: 2}
    ];

    function sortRows(rows, key, desc) {
        var copy = rows.slice();
        copy.sort(function (a, b) {
            var x = a[key], y = b[key];
            var xm = x === null || x === undefined || x === "", ym = y === null || y === undefined || y === "";
            if (xm || ym) return xm === ym ? 0 : (xm ? 1 : -1);    // missing values last either way
            var c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
            return desc ? -c : c;
        });
        return copy;
    }

    function cell(row, col) {
        var v = row[col.key];
        if (col.key === "kind") return esc(core.kindLabel(v));
        if (col.key === "time") return esc(captureTime(v));
        if (col.key === "distance") {
            var embedded = core.formatNumber(v, 1, " m");
            return esc(embedded + (row.lrf !== null && row.lrf !== undefined ? " / " + core.formatNumber(row.lrf, 1, " m") : ""));
        }
        if (col.temperature) return esc(core.formatTemp(v, "C", col.digits));
        if (col.digits !== undefined) return esc(core.formatNumber(v, col.digits, col.unit));
        return esc(v);
    }

    // The conversion a file row opens its frame in: the ready one finished last
    function newestReady(conversions) {
        return (conversions || []).filter(function (c) { return c.status === "ready"; }).sort(function (a, b) {
            return String(b.finished_at || "").localeCompare(String(a.finished_at || ""));
        })[0] || null;
    }

    // The Files tab's rows: shown as all / thermal / flagged, filtered by name (every word in the path), sorted
    function fileRows(a, view) {
        var flags = flagsByFile(a.findings);
        var words = String(view.filter || "").toLowerCase().split(/\s+/).filter(function (w) { return w; });
        var rows = (a.files || []).filter(function (f) {
            var path = String(f.path).toLowerCase();
            if (!words.every(function (w) { return path.indexOf(w) >= 0; })) return false;
            if (view.show === "thermal") return f.kind === "thermal";
            if (view.show === "flagged") return !!flags[f.path] || f.kind !== "thermal" && f.kind !== "not_thermal" || (f.warnings || []).length;
            return true;
        });
        return sortRows(rows, view.sort || "path", !!view.desc);
    }

    // The table under the Files tab's bar. view.frames (the newest ready conversion's frame page) makes thermal rows
    // links to their frame; view.thumbs (the thumbnail URL without the file) adds a small picture of each image.
    function filesTableHtml(a, view) {
        var flags = flagsByFile(a.findings);
        var rows = fileRows(a, view);
        var html = '<div class="ta-table-scroll"><table class="table table-condensed ta-files' + (view.frames ? " ta-files-linked" : "") +
            '"><thead><tr>' + (view.thumbs ? "<th></th>" : "") + FILE_COLUMNS.map(function (c) {
            var arrow = (view.sort || "path") === c.key ? ' <i class="fa fa-caret-' + (view.desc ? "down" : "up") + '"></i>' : "";
            return '<th data-sort="' + c.key + '"' + (c.title ? ' title="' + esc(c.title) + '"' : "") + ">" + esc(c.label) + arrow + "</th>";
        }).join("") + "<th>Notes</th></tr></thead><tbody>";
        html += rows.map(function (r) {
            var notes = (flags[r.path] || []).map(function (f) {
                return '<span class="label label-' + ({error: "danger", warning: "warning"}[f.severity] || "default") +
                    '" title="' + esc(f.message) + '">' + esc(f.code) + "</span>";
            });
            if (r.kind !== "thermal" && r.reason) notes.push('<span class="text-muted">' + esc(r.reason) + "</span>");
            (r.warnings || []).forEach(function (w) { notes.push('<span class="text-warning">' + esc(w) + "</span>"); });
            var href = view.frames && r.kind === "thermal" ? view.frames + "?frame=" + encodeURIComponent(r.path) : null;
            var thumb = view.thumbs ? '<td class="ta-thumb">' + (core.isImage({name: r.path}) ?
                '<img loading="lazy" alt="" src="' + esc(view.thumbs + encodeURIComponent(r.path)) + '">' : "") + "</td>" : "";
            return '<tr class="ta-kind-' + esc(r.kind) + '"' + (href ? ' data-href="' + esc(href) + '" title="Open the frame"' : "") + ">" + thumb +
                FILE_COLUMNS.map(function (c) {
                    return "<td>" + (href && c.key === "path" ? '<a href="' + esc(href) + '">' + cell(r, c) + "</a>" : cell(r, c)) + "</td>";
                }).join("") + "<td>" + notes.join(" ") + "</td></tr>";
        }).join("");
        return {html: html + "</tbody></table></div>", count: rows.length};
    }

    // The Files tab: a bar (all / thermal / flagged, a name filter, thumbnails), then the table
    function filesHtml(a, view) {
        view = view || {};
        var table = filesTableHtml(a, view);
        var shows = [["all", "All files"], ["thermal", "Thermal frames"], ["flagged", "With problems"]];
        return '<div class="ta-files-bar">' + shows.map(function (s) {
                return '<label class="radio-inline"><input type="radio" name="ta-files-show" value="' + s[0] + '"' +
                    ((view.show || "all") === s[0] ? " checked" : "") + "> " + s[1] + "</label>";
            }).join("") +
            '<input type="search" class="form-control input-sm ta-files-filter" placeholder="Filter by name" value="' + esc(view.filter || "") + '">' +
            '<label class="checkbox-inline"><input type="checkbox" class="ta-files-thumbs"' + (view.thumbs ? " checked" : "") + "> Thumbnails</label>" +
            '<span class="text-muted ta-files-shown">' + table.count + " shown</span></div>" +
            (view.frames ? "" : '<p class="text-muted ta-files-hint"><i class="fa fa-info-circle"></i> Convert the images (on the Convert tab) to open each frame from here.</p>') +
            '<div class="ta-files-table">' + table.html + "</div>";
    }

    // The Problems tab: the findings, most severe first, each with what addresses it and the files it names (each a
    // link to the Files tab filtered to it)
    function problemsHtml(a) {
        var findings = a.findings || [];
        if (!findings.length) return '<p class="text-success ta-none"><i class="fa fa-check"></i> dji-thermal-cli found no problems in this dataset.</p>';
        return findings.map(function (f) {
            var cls = {error: "danger", warning: "warning", info: "info"}[f.severity] || "default";
            var files = f.files || [];
            var listed = files.slice(0, FILES_SHOWN).map(function (p) {
                return '<a href="#files" data-file="' + esc(p) + '" title="Show it on the Files tab"><code>' + esc(p) + "</code></a>";
            }).join(" ");
            if (files.length > FILES_SHOWN) listed += ' <span class="text-muted">and ' + (files.length - FILES_SHOWN) + " more</span>";
            return '<div class="ta-finding alert alert-' + cls + '">' +
                '<div><span class="label label-' + cls + '">' + esc(core.severityLabel(f.severity)) + "</span> " + esc(f.message) + "</div>" +
                (f.suggestion ? '<div class="ta-suggestion"><i class="fa fa-lightbulb"></i> ' + esc(f.suggestion) + "</div>" : "") +
                (files.length ? '<div class="ta-finding-files">' + listed + "</div>" : "") +
                '<div class="ta-finding-code">' + esc(f.code) + "</div>" +
                "</div>";
        }).join("");
    }

    function optionsTable(options) {
        var keys = Object.keys(options || {});
        if (!keys.length) return '<p class="text-muted">None.</p>';
        return '<table class="table table-condensed ta-options"><thead><tr><th>Option</th><th>Value</th><th>Why</th></tr></thead><tbody>' +
            keys.map(function (k) {
                var o = options[k];
                return "<tr><td><code>" + esc(k) + "</code></td><td>" + esc(o.value) + "</td><td>" + esc(o.reason) + "</td></tr>";
            }).join("") + "</tbody></table>";
    }

    // The WebODM plan tab: how well the frames cover the ground, the task options to use and how to prepare the images
    // (a button opens the Convert tab with the plan's settings)
    function planHtml(a) {
        var p = a.webodm;
        if (!p) return '<p class="text-muted">No plan: the dataset has no thermal frames to plan with.</p>';
        var c = p.coverage || {};
        var figures = [
            ["Frames used", c.frames],
            ["Ground sample distance", c.gsd_m ? core.formatNumber(c.gsd_m * 100, 1, " cm/px") : ""],
            ["Area", c.area_m2 ? core.formatNumber(c.area_m2, 0, " m²") : ""],
            ["Frames per ground point (median)", c.images_per_point_median],
            ["Area seen by 3 or more frames", c.area_seen_by_3_or_more_pct !== undefined ? core.formatNumber(c.area_seen_by_3_or_more_pct, 0, " %") : ""],
            ["Equivalent overlap", c.equivalent_overlap_pct !== undefined ? core.formatNumber(c.equivalent_overlap_pct, 0, " %") : ""]
        ].filter(function (f) { return f[1] !== undefined && f[1] !== null && f[1] !== ""; });
        var copy = function (what, text) {
            return '<button type="button" class="btn btn-default btn-xs ta-copy" data-copy="' + esc(text) + '" title="Copy ' + what + '">' +
                '<i class="fa fa-copy"></i> Copy</button>';
        };
        var args = (p.odm_arguments || []).join(" ");
        return '<h4>Coverage</h4><dl class="ta-figures">' + figures.map(function (f) {
                return "<div><dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>";
            }).join("") + "</dl>" +
            "<h4>Recommended task options</h4>" + optionsTable(p.recommended) +
            (args ? '<p class="ta-odm-args"><code>' + esc(args) + "</code> " + copy("the options", args) + "</p>" : "") +
            "<h4>To consider</h4>" + optionsTable(p.consider) +
            "<h4>Preparing the images</h4>" +
            "<p>Convert the frames with these settings before processing them." +
            (p.process_args ? ' <button type="button" class="btn btn-primary btn-xs" id="ta-plan-convert" title="Open the Convert tab with these settings">' +
                '<i class="fa fa-magic"></i> Convert with these</button>' : "") + "</p>" +
            '<div class="ta-command-row"><pre class="ta-command">' + esc(p.process_command || "") + "</pre>" +
            (p.process_command ? copy("the command", p.process_command) : "") + "</div>" +
            ((p.notes || []).length ? "<h4>Notes</h4><ul>" + p.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : "");
    }

    function init(doc, fetchFn, nav) {
        var page = doc.getElementById("ta-dataset");
        if (!page) return;
        nav = nav || function (url) { root.location.href = url; };

        var API = page.getAttribute("data-api");
        var publicUrl = page.getAttribute("data-public");
        var id = page.getAttribute("data-id");
        var url = API + "datasets/" + id;
        var csrf = (page.querySelector("input[name=csrfmiddlewaretoken]") || {}).value;
        var $ = function (i) { return doc.getElementById(i); };
        var dataset = null, view = {show: "all", sort: "path", desc: false, filter: ""}, tab = "files", tabChosen = false, timer = null, uploading = false;
        var filesKey = null;
        try { view.thumbs = root.localStorage && root.localStorage.getItem(THUMBS_KEY) === "1" ? url + "/thumbnail?file=" : null; } catch (e) { view.thumbs = null; }
        // A link to a tab (#convert, as the mosaic viewer's way back) opens it
        var linked = ((root.location && root.location.hash) || "").replace(/[^a-z]/g, "");
        if (linked && page.querySelector('#ta-tabs a[data-tab="' + linked + '"]')) { tab = linked; tabChosen = true; }
        var conversions = conversionsModule.init({doc: doc, fetchFn: fetchFn, api: API, csrf: csrf, datasetId: id,
                                                  viewer: publicUrl + "conversion/",
                                                  prefill: conversionsModule.parsePrefill(root.location && root.location.search),
                                                  onChange: function () { return load(); }});

        function send(u, method, data) {
            var opts = {method: method, credentials: "same-origin", headers: {"X-CSRFToken": csrf}};
            if (data !== undefined) {
                opts.headers["Content-Type"] = "application/json";
                opts.body = JSON.stringify(data);
            }
            return fetchFn(u, opts).then(core.readJson);
        }

        function status(text, cls) {
            $("ta-status").className = "ta-status" + (cls ? " " + cls : "");
            $("ta-status").innerHTML = text || "";
        }

        function renderStatus(d) {
            if (d.status === "analyzing") {
                var pct = Math.round((d.progress || 0) * 100);
                status('<div class="progress"><div class="progress-bar progress-bar-striped active" style="width: ' + pct + '%;">' +
                    pct + "%</div></div> Analyzing " + d.file_count + " file(s)…");
            } else if (d.status === "failed") {
                status('<i class="fa fa-exclamation-triangle"></i> The analysis failed: ' + esc(d.error), "text-danger");
            } else if (d.status === "canceled") {
                status("The analysis was canceled.", "text-muted");
            } else if (d.status === "new") {
                status(d.file_count ? (d.analyzed ? "Images were added since the last analysis: analyze again to include them." :
                    d.file_count + " file(s), not analyzed yet.") : "No images yet: add the flight's R-JPEGs.", "text-muted");
            } else {
                status("");
            }
        }

        function renderTabs() {
            [].forEach.call(page.querySelectorAll("#ta-tabs li"), function (li) {
                li.classList.toggle("active", li.querySelector("a").getAttribute("data-tab") === tab);
            });
            [].forEach.call(page.querySelectorAll(".ta-tab"), function (el) { el.hidden = el.getAttribute("data-tab") !== tab; });
        }

        function render(d) {
            dataset = d;
            $("ta-name").textContent = d.name;
            doc.title = d.name + " - Thermal Analyzer";
            $("ta-subtitle").innerHTML = esc(core.formatDate(d.created_at)) +
                (d.source === "folder" ? " · read in place" + (d.folder ? " from <code>" + esc(d.folder) + "</code>" : "") : " · uploaded");
            var analyzing = d.status === "analyzing";
            $("ta-add").hidden = d.source !== "upload" || analyzing || uploading;
            $("ta-analyze").hidden = analyzing || uploading;
            $("ta-analyze").innerHTML = d.analyzed ? '<i class="fa fa-sync"></i> Analyze again' : '<i class="fa fa-play"></i> Analyze';
            $("ta-cancel").hidden = !analyzing;
            renderStatus(d);

            var a = d.analysis || {};
            $("ta-overview").innerHTML = overviewHtml(d);
            // Converting needs no analysis: the tabs show as soon as there are images (or conversions)
            $("ta-tabs").hidden = !a.files && !d.file_count && !(d.conversions || []).length;
            // Before the analysis only the Convert tab has something to show; after it, the files unless a tab was chosen
            [].forEach.call(page.querySelectorAll("#ta-tabs a[data-tab]"), function (link) {
                if (link.getAttribute("data-tab") !== "convert") link.parentNode.hidden = !a.files;
            });
            if (!a.files) tab = "convert";
            else if (!tabChosen) tab = "files";
            conversions.update(d);
            if (a.files) {
                $("ta-files-count").textContent = a.files.length;
                var serious = (a.findings || []).filter(function (f) { return f.severity !== "info"; }).length;
                $("ta-problems-count").textContent = serious || "";
                var ready = newestReady(d.conversions);
                view.frames = ready ? publicUrl + "conversion/" + ready.id + "/frame" : null;
                // Polling while converting redraws the rest: the Files tab only when it would change, not to lose the filter's focus
                var key = [d.analyzed_at, a.files.length, view.frames].join("|");
                if (key !== filesKey) renderFiles();
                filesKey = key;
                $("ta-tab-problems").innerHTML = problemsHtml(a);
                $("ta-tab-webodm").innerHTML = planHtml(a);
            } else {
                ["files", "problems", "webodm"].forEach(function (t) { $("ta-tab-" + t).innerHTML = ""; });
                filesKey = null;
            }
            renderTabs();

            if (timer && root.clearTimeout) root.clearTimeout(timer);
            var converting = (d.conversions || []).some(function (c) { return c.status === "converting" || c.mosaic_status === "building"; });
            timer = (analyzing || converting) && root.setTimeout ? root.setTimeout(load, POLL_MS) : null;
        }

        function renderFiles() { $("ta-tab-files").innerHTML = filesHtml(dataset.analysis, view); }

        // Only the table and its count, while typing in the filter
        function renderFilesTable() {
            var table = filesTableHtml(dataset.analysis, view);
            page.querySelector(".ta-files-table").innerHTML = table.html;
            page.querySelector(".ta-files-shown").textContent = table.count + " shown";
        }

        function showTab(t) {
            tab = t;
            tabChosen = true;
            renderTabs();
        }

        function load() {
            return fetchFn(url, {credentials: "same-origin"})
                .then(core.readJson)
                .then(function (r) {
                    if (!r.ok) return status("Could not load the dataset.", "text-danger");
                    render(r.data);
                })
                .catch(function () { status("Could not load the dataset.", "text-danger"); });
        }

        function action(u, failure) {
            return send(u, "POST", {}).then(function (r) {
                if (!r.ok) return status(esc(core.errorText(r.data, failure)), "text-danger");
                render(r.data);
            });
        }

        $("ta-tabs").addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-tab]") : null;
            if (!a) return;
            e.preventDefault();
            showTab(a.getAttribute("data-tab"));
        });

        $("ta-tab-files").addEventListener("click", function (e) {
            if (!dataset || !e.target.closest) return;
            var th = e.target.closest("th[data-sort]");
            if (th) {
                var key = th.getAttribute("data-sort");
                view.desc = view.sort === key ? !view.desc : false;
                view.sort = key;
                return renderFilesTable();
            }
            // A click anywhere on a frame's row opens it, as its name's link does
            var tr = e.target.closest("tr[data-href]");
            if (tr && !e.target.closest("a")) nav(tr.getAttribute("data-href"));
        });

        $("ta-tab-files").addEventListener("change", function (e) {
            if (!dataset) return;
            if (e.target.name === "ta-files-show") {
                view.show = e.target.value;
                renderFilesTable();
            } else if (e.target.classList.contains("ta-files-thumbs")) {
                view.thumbs = e.target.checked ? url + "/thumbnail?file=" : null;
                try { root.localStorage.setItem(THUMBS_KEY, e.target.checked ? "1" : "0"); } catch (err) { /* not remembered */ }
                renderFilesTable();
            }
        });

        $("ta-tab-files").addEventListener("input", function (e) {
            if (!dataset || !e.target.classList.contains("ta-files-filter")) return;
            view.filter = e.target.value;
            renderFilesTable();
        });

        // A file named by a problem: the Files tab, filtered to it
        $("ta-tab-problems").addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-file]") : null;
            if (!a || !dataset) return;
            e.preventDefault();
            view.filter = a.getAttribute("data-file");
            view.show = "all";
            renderFiles();
            showTab("files");
        });

        $("ta-tab-webodm").addEventListener("click", function (e) {
            if (!e.target.closest) return;
            var button = e.target.closest("button[data-copy]");
            if (button) return copyText(button.getAttribute("data-copy"), button, "Copy");
            if (e.target.closest("#ta-plan-convert") && conversions.usePlan()) {
                showTab("convert");
                if ($("ta-convert-settings").scrollIntoView) $("ta-convert-settings").scrollIntoView();
            }
        });

        // To the clipboard, the button saying so; without one (or refused), a dialog to copy it from
        function copyText(text, button, title) {
            var done = function () { button.innerHTML = '<i class="fa fa-check"></i> Copied'; };
            var show = function () {
                core.dialog(doc, {title: title, text: "Copy this:", field: {value: text, readonly: true},
                                  buttons: [{label: "Close", value: true, style: "primary"}]});
                var field = $("ta-ask-field");
                if (field && field.select) field.select();
            };
            if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(text).then(done, show);
            else show();
        }

        $("ta-analyze").addEventListener("click", function () { action(url + "/analyze", "Could not start the analysis."); });
        $("ta-cancel").addEventListener("click", function () { action(url + "/cancel", "Could not cancel the analysis."); });

        $("ta-rename").addEventListener("click", function () {
            core.askName(doc, "Rename dataset", dataset.name).then(function (name) {
                if (!name) return;
                return send(url, "PATCH", {name: name}).then(function (r) {
                    if (!r.ok) return status(esc(core.errorText(r.data, "Could not rename the dataset.")), "text-danger");
                    render(r.data);
                });
            });
        });

        $("ta-delete").addEventListener("click", function () {
            core.ask(doc, "Delete dataset", core.deleteText(dataset), "Delete", "danger").then(function (yes) {
                if (!yes) return;
                return send(url, "DELETE").then(function (r) {
                    if (!r.ok) return status(esc(core.errorText(r.data, "Could not delete the dataset.")), "text-danger");
                    nav(publicUrl);
                });
            });
        });

        $("ta-copy-link").addEventListener("click", function () {
            var link = root.location ? root.location.origin + publicUrl + "dataset/" + id : publicUrl + "dataset/" + id;
            copyText(link, $("ta-copy-link"), "Copy link");
        });

        // Adding images: the images sent are kept when the upload is canceled (the dataset exists already); those that
        // did not arrive (failed, or never sent) can be sent again
        var controller = null, unsent = [];
        function addImages(files) {
            uploading = true;
            unsent = [];
            $("ta-add-failed").hidden = true;
            render(dataset);
            var bar = $("ta-add-progress");
            bar.querySelector(".progress-bar").style.width = "0%";
            $("ta-add-progress-text").textContent = "";
            $("ta-add-cancel").disabled = false;
            bar.hidden = false;
            controller = typeof AbortController !== "undefined" ? new AbortController() : null;
            return core.uploadFiles(fetchFn, url + "/upload", csrf, files, function (p) {
                var pct = p.bytesTotal ? Math.round(p.bytesSent / p.bytesTotal * 100) : 0;
                bar.querySelector(".progress-bar").style.width = pct + "%";
                $("ta-add-progress-text").textContent = "Uploading " + p.sent + " of " + p.total + " images (" + pct + "%)";
            }, null, {signal: controller && controller.signal}).then(function (u) {
                uploading = false;
                controller = null;
                bar.hidden = true;
                unsent = u.failed;
                return (u.saved && !u.canceled ? action(url + "/analyze", "Could not start the analysis.") : load()).then(function () {
                    if (!unsent.length) return;
                    $("ta-add-failed-text").textContent = u.canceled ?
                        "Upload canceled: " + core.count(u.saved, "image was", "images were") + " sent and kept (analyze again to include them), " +
                        core.count(unsent.length, "image was", "images were") + " not sent." :
                        core.failedText(unsent);
                    $("ta-add-failed").hidden = false;
                });
            });
        }

        $("ta-add-files").addEventListener("change", function (e) {
            var files = [].slice.call(e.target.files || []);
            e.target.value = "";
            if (!files.filter(core.isImage).length) return status("Choose JPEG images (the flight's R-JPEGs).", "text-danger");
            addImages(files);
        });

        $("ta-add-cancel").addEventListener("click", function () {
            if (!controller) return;
            $("ta-add-cancel").disabled = true;
            $("ta-add-progress-text").textContent = "Canceling…";
            controller.abort();
        });

        $("ta-add-retry").addEventListener("click", function () {
            if (unsent.length && !uploading) addImages(unsent);
        });

        // Leaving the page would stop the upload half way
        if (root.addEventListener) root.addEventListener("beforeunload", function (e) {
            if (!uploading) return;
            e.preventDefault();
            e.returnValue = "";
        });

        return load();
    }

    var api = {captureTime: captureTime, median: core.median, overview: overview, overviewHtml: overviewHtml, flagsByFile: flagsByFile,
               sortRows: sortRows, newestReady: newestReady, fileRows: fileRows, filesHtml: filesHtml, problemsHtml: problemsHtml, planHtml: planHtml, init: init};
    root.ThermalAnalyzerDataset = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});

if (typeof window !== "undefined" && window.document && window.fetch) {
    window.ThermalAnalyzerDataset.init(document, window.fetch.bind(window));
}
