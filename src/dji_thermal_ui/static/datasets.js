// The Thermal Analyzer's landing page: the datasets, and New Dataset (upload images, or a folder on this computer).
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var POLL_MS = 3000;

    function problemsCell(d) {
        if (!d.analyzed) return "";
        var out = [];
        if (d.errors) out.push('<span class="label label-danger" title="Errors">' + d.errors + "</span>");
        if (d.warnings) out.push('<span class="label label-warning" title="Warnings">' + d.warnings + "</span>");
        if (!d.errors && !d.warnings) out.push('<span class="text-success"><i class="fa fa-check"></i> None</span>');
        return out.join(" ");
    }

    function filesCell(d) {
        if (!d.analyzed || d.status === "new") return String(d.file_count);
        var text = d.thermal + " thermal";
        if (d.not_thermal) text += " · " + d.not_thermal + " other";
        return text;
    }

    function statusCell(d) {
        var label = core.escapeHtml(core.statusLabel(d));
        if (d.status === "analyzing") {
            var pct = Math.round((d.progress || 0) * 100);
            return '<div class="progress ta-row-progress" title="' + label + '"><div class="progress-bar progress-bar-striped active" style="width: ' +
                pct + '%;">' + pct + "%</div></div>";
        }
        // A conversion or a mosaic of the dataset being made
        if (d.busy) return '<span class="text-info" title="' + label + '"><i class="fa fa-cog fa-spin"></i> Converting</span>';
        var cls = {ready: "text-success", failed: "text-danger", canceled: "text-muted"}[d.status] || "";
        return '<span class="' + cls + '"' + (d.error ? ' title="' + core.escapeHtml(d.error) + '"' : "") + ">" + label + "</span>";
    }

    // Ready of all its conversions, as 2/3
    function conversionsCell(d) {
        if (!d.conversion_count) return "";
        var ready = d.conversions_ready || 0;
        return '<span class="' + (ready === d.conversion_count ? "text-success" : "") + '" title="' + core.count(ready, "conversion", "conversions") +
            " ready of " + d.conversion_count + '">' + ready + "/" + d.conversion_count + "</span>";
    }

    // What each column sorts by; null (nothing to sort by, as before an analysis) goes last either way
    var SORT_KEYS = {
        name: function (d) { return (d.name || "").toLowerCase(); },
        status: function (d) { return core.statusLabel(d); },
        files: function (d) { return d.file_count; },
        problems: function (d) { return d.analyzed ? d.errors * 1e6 + d.warnings : null; },
        conversions: function (d) { return d.conversion_count ? (d.conversions_ready || 0) * 1e6 + d.conversion_count : null; },
        size: function (d) { return d.size; },
        activity: function (d) { return d.last_activity || null; },
        created: function (d) { return d.created_at || null; }
    };

    function sortDatasets(list, key, desc) {
        var get = SORT_KEYS[key] || SORT_KEYS.created;
        return list.map(function (d, i) { return {d: d, v: get(d), i: i}; }).sort(function (a, b) {
            var an = a.v === null || a.v === undefined, bn = b.v === null || b.v === undefined;
            if (an || bn) return an === bn ? a.i - b.i : (an ? 1 : -1);
            var c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
            return (desc ? -c : c) || a.i - b.i;
        }).map(function (x) { return x.d; });
    }

    // Whether the search (words, any order) is in a dataset's name
    function matchesSearch(d, query) {
        var text = (d.name || "").toLowerCase();
        return String(query || "").toLowerCase().split(/\s+/).every(function (w) { return text.indexOf(w) >= 0; });
    }

    // The files dropped, with those of the folders dropped read through (their place in it kept as a chosen folder's)
    function droppedFiles(dataTransfer) {
        var items = [].slice.call(dataTransfer.items || []);
        var entries = items.map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; });
        if (!entries.length || entries.some(function (en) { return !en; })) return Promise.resolve([].slice.call(dataTransfer.files || []));
        function read(entry) {
            if (entry.isFile) {
                return new Promise(function (resolve) {
                    entry.file(function (f) {
                        var rel = entry.fullPath.replace(/^\//, "");
                        if (rel.indexOf("/") > 0) Object.defineProperty(f, "webkitRelativePath", {value: rel});
                        resolve([f]);
                    }, function () { resolve([]); });
                });
            }
            var reader = entry.createReader(), all = [];
            // readEntries gives a folder's entries a part at a time, and nothing once all are given
            function next() {
                return new Promise(function (resolve) { reader.readEntries(resolve, function () { resolve([]); }); }).then(function (part) {
                    if (!part.length) return Promise.all(all.map(read)).then(function (lists) { return [].concat.apply([], lists); });
                    all = all.concat(part);
                    return next();
                });
            }
            return next();
        }
        return Promise.all(entries.map(read)).then(function (lists) { return [].concat.apply([], lists); });
    }

    function action(cls, id, label, icon) {
        return '<a href="javascript:void(0);" class="' + cls + '" data-id="' + id + '" title="' + label + '" aria-label="' + label +
            '"><i class="fa ' + icon + '"></i></a>';
    }

    // One <tr>'s markup for a dataset from the API, and the app's URL prefix (to link to its page)
    function datasetRow(d, publicUrl) {
        var actions = action("ta-rename", d.id, "Rename", "fa-pencil-alt");
        if (d.status !== "analyzing") actions += action("ta-analyze", d.id, "Analyze again", "fa-sync");
        actions += action("ta-delete", d.id, "Delete", "fa-trash");
        var source = d.source === "folder" ? ' <i class="fa fa-folder-open text-muted" title="' +
            core.escapeHtml(d.folder ? "Read in place from " + d.folder : "Read in place from a folder") + '"></i>' : "";
        return '<tr data-id="' + d.id + '">' +
            '<td><a href="' + publicUrl + "dataset/" + d.id + '">' + core.escapeHtml(d.name || "(untitled)") + "</a>" + source + "</td>" +
            "<td>" + statusCell(d) + "</td>" +
            "<td>" + core.escapeHtml(filesCell(d)) + "</td>" +
            "<td>" + problemsCell(d) + "</td>" +
            "<td>" + conversionsCell(d) + "</td>" +
            "<td>" + core.escapeHtml(core.formatBytes(d.size)) + "</td>" +
            "<td>" + core.escapeHtml(core.formatDate(d.last_activity)) + "</td>" +
            "<td>" + core.escapeHtml(core.formatDate(d.created_at)) + "</td>" +
            '<td class="ta-actions">' + actions + "</td>" +
            "</tr>";
    }

    function init(doc, fetchFn, nav) {
        var page = doc.getElementById("ta-datasets");
        if (!page) return;
        nav = nav || function (url) { root.location.href = url; };

        var API = page.getAttribute("data-api");
        var publicUrl = page.getAttribute("data-public");
        var csrf = (page.querySelector("input[name=csrfmiddlewaretoken]") || {}).value;
        var $ = function (id) { return doc.getElementById(id); };
        var table = $("ta-table"), body = $("ta-body"), message = $("ta-message"), search = $("ta-search");
        var dialog = $("ta-new-dialog");

        // stage: the New Dataset dialog's, "idle", "working" (creating, or starting the analysis: nothing to press),
        // "uploading" or "failed" (some images could not be sent). upload: the dataset being made, while it is.
        var datasets = [], chosen = [], stage = "idle", upload = null, timer = null;
        var sort = {key: "created", desc: true};

        function render() {
            var shown = datasets.filter(function (d) { return matchesSearch(d, search.value.trim()); });
            [].forEach.call(table.querySelectorAll("th[data-sort]"), function (th) {
                var on = th.getAttribute("data-sort") === sort.key;
                th.setAttribute("aria-sort", on ? (sort.desc ? "descending" : "ascending") : "none");
                var icon = th.querySelector(".ta-sort-icon");
                if (!icon) {
                    icon = doc.createElement("i");
                    th.appendChild(doc.createTextNode(" "));
                    th.appendChild(icon);
                }
                icon.className = on ? "fa ta-sort-icon fa-caret-" + (sort.desc ? "down" : "up") : "ta-sort-icon";
            });
            if (!shown.length) {
                table.hidden = true;
                message.textContent = !datasets.length ? "No datasets yet. Use New Dataset to analyze a flight's thermal images." :
                    "No datasets match the search.";
            } else {
                message.textContent = "";
                table.hidden = false;
                body.innerHTML = sortDatasets(shown, sort.key, sort.desc).map(function (d) { return datasetRow(d, publicUrl); }).join("");
            }
        }

        function schedule() {
            if (timer) root.clearTimeout && root.clearTimeout(timer);
            timer = null;
            if (datasets.some(function (d) { return d.status === "analyzing" || d.busy; }) && root.setTimeout) {
                timer = root.setTimeout(load, POLL_MS);
            }
        }

        function load() {
            if (!datasets.length) message.textContent = "Loading…";
            return fetchFn(API + "datasets", {credentials: "same-origin"})
                .then(function (res) { return res.json(); })
                .then(function (r) {
                    datasets = r.datasets;
                    render();
                    schedule();
                })
                .catch(function () { message.textContent = "Could not load the datasets."; });
        }

        function find(id) { return datasets.filter(function (d) { return String(d.id) === String(id); })[0]; }

        function send(url, method, data) {
            var opts = {method: method, credentials: "same-origin", headers: {"X-CSRFToken": csrf}};
            if (data !== undefined) {
                opts.headers["Content-Type"] = "application/json";
                opts.body = JSON.stringify(data);
            }
            return fetchFn(url, opts).then(core.readJson);
        }

        body.addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-id]") : null;
            if (!a) return;
            var d = find(a.getAttribute("data-id"));
            if (!d) return;
            if (a.classList.contains("ta-rename")) {
                core.askName(doc, "Rename dataset", d.name).then(function (name) {
                    if (!name) return;
                    return send(API + "datasets/" + d.id, "PATCH", {name: name}).then(function (r) {
                        if (!r.ok) message.textContent = core.errorText(r.data, "Could not rename the dataset.");
                        return load();
                    });
                });
            } else if (a.classList.contains("ta-analyze")) {
                send(API + "datasets/" + d.id + "/analyze", "POST", {}).then(function (r) {
                    if (!r.ok) message.textContent = core.errorText(r.data, "Could not start the analysis.");
                    return load();
                });
            } else if (a.classList.contains("ta-delete")) {
                core.ask(doc, "Delete dataset", core.deleteText(d), "Delete", "danger").then(function (yes) {
                    if (!yes) return;
                    return send(API + "datasets/" + d.id, "DELETE").then(function (r) {
                        if (!r.ok) message.textContent = core.errorText(r.data, "Could not delete the dataset.");
                        return load();
                    });
                });
            }
        });

        search.addEventListener("input", render);
        table.querySelector("thead").addEventListener("click", function (e) {
            var th = e.target.closest ? e.target.closest("th[data-sort]") : null;
            if (!th) return;
            var key = th.getAttribute("data-sort");
            // Names start A to Z; numbers and dates largest or newest first
            sort = key === sort.key ? {key: key, desc: !sort.desc} : {key: key, desc: key !== "name" && key !== "status"};
            render();
        });

        // New Dataset
        function source() {
            var checked = dialog.querySelector("input[name=ta-new-source]:checked");
            return checked ? checked.value : "upload";
        }

        function showSource() {
            $("ta-new-upload").hidden = source() !== "upload";
            $("ta-new-folder").hidden = source() !== "folder";
        }

        function choose(files) {
            chosen = [].slice.call(files || []);
            var images = chosen.filter(core.isImage);
            $("ta-new-chosen").textContent = images.length + " image(s), " + core.formatBytes(images.reduce(function (s, f) { return s + f.size; }, 0)) +
                (chosen.length > images.length ? " (" + (chosen.length - images.length) + " other file(s) left out)" : "");
            if (!$("ta-new-name").value && images.length) {
                var first = images[0].webkitRelativePath ? images[0].webkitRelativePath.split("/")[0] : "";
                $("ta-new-name").value = first || "Thermal dataset";
            }
        }

        function setError(text) { $("ta-new-error").textContent = text || ""; }

        function setStage(st) {
            stage = st;
            $("ta-new-create").hidden = st === "failed";
            $("ta-new-create").disabled = st !== "idle";
            $("ta-new-cancel").disabled = st === "working";
            $("ta-new-retry").hidden = st !== "failed";
            $("ta-new-without").hidden = st !== "failed" || !(upload && upload.saved);
            [].forEach.call(dialog.querySelectorAll("input, select"), function (el) { el.disabled = st !== "idle"; });
        }

        function openDialog() {
            chosen = [];
            upload = null;
            $("ta-new-name").value = "";
            $("ta-new-files").value = "";
            $("ta-new-dir").value = "";
            $("ta-new-folder-path").value = "";
            $("ta-new-chosen").textContent = "The R-JPEGs of a flight (the _T.JPG files). Visible images can be included: they are listed, not analyzed.";
            $("ta-new-progress").hidden = true;
            dialog.querySelector("input[name=ta-new-source][value=upload]").checked = true;
            showSource();
            setError("");
            setStage("idle");
            dialog.hidden = false;
        }

        function closeDialog() {
            dialog.hidden = true;
            upload = null;
            setStage("idle");
        }

        // Cancel: before the dataset exists, closes the dialog; once it does, deletes it with the images sent so far
        function cancel() {
            if (stage === "idle") return closeDialog();
            if (stage !== "uploading" && stage !== "failed") return;
            var made = upload;
            core.ask(doc, "Cancel the new dataset?", ["The images sent so far are deleted with the dataset."],
                     "Delete it", "danger").then(function (yes) {
                // The upload may have ended while the question was asked
                if (!yes || upload !== made || (stage !== "uploading" && stage !== "failed")) return;
                setStage("working");
                if (made.controller) made.controller.abort();
                // Deleted once its requests have settled, so that none saves an image after it
                return Promise.resolve(made.sending).then(function () {
                    return send(API + "datasets/" + made.dataset.id, "DELETE");
                }).then(function (r) {
                    if (!r.ok) message.textContent = core.errorText(r.data, "Could not delete the canceled dataset.");
                }, function () {
                    message.textContent = "Could not delete the canceled dataset.";
                }).then(function () {
                    closeDialog();
                    return load();
                });
            });
        }

        function progress(p) {
            $("ta-new-progress").hidden = false;
            var pct = p.bytesTotal ? Math.round(p.bytesSent / p.bytesTotal * 100) : 0;
            $("ta-new-progress").querySelector(".progress-bar").style.width = pct + "%";
            $("ta-new-progress-text").textContent = "Uploading " + p.sent + " of " + p.total + " images (" + pct + "%)";
        }

        function analyze() {
            setStage("working");
            var d = upload.dataset;
            // Opened even when the analysis could not start: its page says so and can start it again
            var open = function () { stage = "idle"; nav(publicUrl + "dataset/" + d.id); };
            return send(API + "datasets/" + d.id + "/analyze", "POST", {}).then(open, open);
        }

        // Sends the images to the dataset made: analyzes it when all arrived, or stops and says which did not
        function sendImages(files) {
            setError("");
            setStage("uploading");
            upload.controller = root.AbortController ? new root.AbortController() : null;
            progress({sent: 0, total: files.filter(core.isImage).length, bytesSent: 0, bytesTotal: 1});
            var made = upload;
            made.sending = core.uploadFiles(fetchFn, API + "datasets/" + made.dataset.id + "/upload", csrf, files, progress, null,
                                            {signal: made.controller && made.controller.signal});
            return made.sending.then(function (u) {
                if (u.canceled || upload !== made) return;
                made.saved += u.saved;
                if (!u.failed.length) return analyze();
                made.failed = u.failed;
                setStage("failed");
                setError(core.failedText(u.failed) + " " + (made.saved ? core.count(made.saved, "image", "images") + " arrived: send the others again, or analyze without them." :
                    "None arrived: send them again, or cancel."));
            });
        }

        function create() {
            var name = $("ta-new-name").value.trim();
            var src = source();
            if (!name) return setError("Give the dataset a name.");
            if (src === "upload" && !chosen.filter(core.isImage).length) return setError("Choose the images to upload.");
            if (src === "folder" && !$("ta-new-folder-path").value.trim()) return setError("Enter the folder's path.");
            setError("");
            setStage("working");
            send(API + "datasets", "POST", {name: name, source: src,
                                            folder: $("ta-new-folder-path").value.trim()})
                .then(function (r) {
                    if (!r.ok) throw new Error(core.errorText(r.data, "Could not create the dataset."));
                    upload = {dataset: r.data, saved: 0, failed: []};
                    if (src === "folder") {
                        stage = "idle";
                        return nav(publicUrl + "dataset/" + r.data.id);
                    }
                    return sendImages(chosen);
                })
                .catch(function (e) {
                    setStage("idle");
                    setError(e.message);
                    load();
                });
        }

        $("ta-new").addEventListener("click", openDialog);
        $("ta-new-cancel").addEventListener("click", cancel);
        $("ta-new-create").addEventListener("click", create);
        $("ta-new-retry").addEventListener("click", function () { if (stage === "failed") sendImages(upload.failed); });
        $("ta-new-without").addEventListener("click", function () { if (stage === "failed") analyze(); });
        // Leaving the page would stop the upload half way
        if (root.addEventListener) root.addEventListener("beforeunload", function (e) {
            if (stage !== "uploading") return;
            e.preventDefault();
            e.returnValue = "";
        });
        // Images (or their folder) dropped anywhere on the page open New Dataset with them chosen
        var dragDepth = 0;
        function dragging(e) {
            var types = e.dataTransfer ? [].slice.call(e.dataTransfer.types || []) : [];
            return types.indexOf("Files") >= 0 && !$("ta-new").disabled && (dialog.hidden || stage === "idle");
        }
        page.addEventListener("dragenter", function (e) {
            if (!dragging(e)) return;
            e.preventDefault();
            dragDepth++;
            $("ta-drop-hint").hidden = false;
        });
        page.addEventListener("dragover", function (e) {
            if (!dragging(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });
        page.addEventListener("dragleave", function () {
            dragDepth = Math.max(0, dragDepth - 1);
            if (!dragDepth) $("ta-drop-hint").hidden = true;
        });
        page.addEventListener("drop", function (e) {
            dragDepth = 0;
            $("ta-drop-hint").hidden = true;
            if (!dragging(e)) return;
            e.preventDefault();
            return droppedFiles(e.dataTransfer).then(function (files) {
                if (!dialog.hidden && stage !== "idle") return;
                if (dialog.hidden) openDialog();
                if (source() !== "upload") {
                    dialog.querySelector("input[name=ta-new-source][value=upload]").checked = true;
                    showSource();
                }
                choose(files);
            });
        });

        $("ta-new-files").addEventListener("change", function (e) { choose(e.target.files); });
        $("ta-new-dir").addEventListener("change", function (e) { choose(e.target.files); });
        [].forEach.call(dialog.querySelectorAll("input[name=ta-new-source]"), function (el) { el.addEventListener("change", showSource); });

        return load();
    }

    var api = {datasetRow: datasetRow, filesCell: filesCell, problemsCell: problemsCell, sortDatasets: sortDatasets,
               matchesSearch: matchesSearch, droppedFiles: droppedFiles, init: init};
    root.ThermalAnalyzerDatasets = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});

if (typeof window !== "undefined" && window.document && window.fetch) {
    window.ThermalAnalyzerDatasets.init(document, window.fetch.bind(window));
}
