// A conversion's frames one at a time (frame.html): each frame measured by dji-thermal-cli as the conversion converted
// it, drawn with the viewer's palettes and range, with its values under the cursor, spots, lines and areas measured (and
// saved) and an isotherm; and the same frame measured again with some measurement parameters changed, side by side, to
// see their effect before converting again.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var measure = root.ThermalAnalyzerMeasure || (typeof require !== "undefined" ? require("./measure") : null);
    var viewer = root.ThermalAnalyzerViewer || (typeof require !== "undefined" ? require("./viewer") : null);
    var esc = function (t) { return core.escapeHtml(t); };
    var HOVER_MS = 120;
    // The parameters a frame can be measured again with: [field, label, step, in the temperature unit, what the SDK
    // reports it as (params), the analysis' recorded value]
    var CHANGES = [
        ["distance", "Distance (m)", "0.1", false, "distance", "lrf"],
        ["humidity", "Humidity (%)", "1", false, "humidity", "humidity"],
        ["emissivity", "Emissivity", "0.01", false, "emissivity", "emissivity"],
        ["reflected_temp", "Reflected temperature", "0.1", true, "reflection", "reflection"],
        ["ambient_temp", "Ambient temperature", "0.1", true, "ambient_temp", "ambient"]
    ];
    // The parameters a saved measurement can be measured again with: [key, label, step, isTemp]
    var PARAM_FIELDS = CHANGES.map(function (c) { return c.slice(0, 4); });
    // The locator's frames, and the one shown
    var LOCATOR_SPOT = {radius: 4, weight: 1, color: "#333", fillColor: "#9ab", fillOpacity: 0.9};
    var LOCATOR_CURRENT = {radius: 6, weight: 2, color: "#fff", fillColor: "#e8562a", fillOpacity: 1};
    var DISTANCE_SOURCES = {rangefinder: "the rangefinder", embedded: "the embedded value", option: "the conversion's"};

    // The changes as the API takes them: the temperatures, typed in the user's unit, in the conversion's (unit)
    function changesIn(changes, unit) {
        var out = {};
        Object.keys(changes || {}).forEach(function (k) {
            var temperature = CHANGES.some(function (c) { return c[0] === k && c[3]; });
            out[k] = temperature ? measure.typedTemp(changes[k], unit) : changes[k];
        });
        return out;
    }

    function frameLabel(f) {
        var tags = [];
        if (f.mosaic !== null && f.mosaic !== undefined) tags.push("in the mosaics");
        else if (f.pitch !== null && f.pitch !== undefined && f.pitch > -80) tags.push("oblique, " + core.formatNumber(f.pitch, 0, "°"));
        if (!f.converted) tags.push("not converted");
        return f.path + (tags.length ? " (" + tags.join(", ") + ")" : "");
    }

    function framesHtml(frames, current) {
        return frames.map(function (f) {
            return '<option value="' + esc(f.path) + '"' + (f.path === current ? " selected" : "") + ">" + esc(frameLabel(f)) + "</option>";
        }).join("");
    }

    // The changes as a query ("&emissivity=0.98...")
    function changesQuery(changes) {
        return Object.keys(changes || {}).filter(function (k) { return changes[k] !== "" && changes[k] !== null && changes[k] !== undefined; })
            .map(function (k) { return "&" + k + "=" + encodeURIComponent(changes[k]); }).join("");
    }

    function imageUrl(api, id, frame, style, isotherm, changes) {
        return api + "conversions/" + id + "/frame/image.png?frame=" + encodeURIComponent(frame) + "&color_map=" +
            encodeURIComponent(style.palette) + "&rescale=" + style.range[0] + "," + style.range[1] +
            viewer.adjustQuery(style.adjust || {}) + (isotherm ? "&isotherm=" + encodeURIComponent(isotherm) : "") + changesQuery(changes);
    }

    // Convert with the conversion's settings and these changes: the dataset's Convert tab, filled in
    function newConversionUrl(publicUrl, datasetId, conversionId, changes) {
        return publicUrl + "dataset/" + datasetId + "?from=" + conversionId + changesQuery(changes) + "#convert";
    }

    // Each change's limits, those the server checks (the temperatures: above absolute zero, in the user's unit)
    var LIMITS = {distance: [0.1, 1000, "The distance is between 0.1 and 1000 m"], humidity: [0, 100, "The humidity is between 0 and 100 %"],
                  emissivity: [0.1, 1, "The emissivity is between 0.1 and 1"]};
    function limits(f) {
        var temperature = CHANGES.some(function (c) { return c[0] === f && c[3]; });
        if (!temperature) return LIMITS[f];
        var zero = Math.round(core.convertTemp(-273.15, "C") * 100) / 100;
        return [zero, null, "A temperature is above absolute zero (" + zero + " " + measure.symbol() + ")"];
    }

    // The changes typed ({field: text}) and where each field started ({field: text}), checked: {changes} (only those
    // given and moved from their start) or {error, field}
    function readChanges(values, starts) {
        var out = {};
        for (var i = 0; i < CHANGES.length; i++) {
            var f = CHANGES[i][0], t = String(values[f] === undefined || values[f] === null ? "" : values[f]).trim();
            if (t === "" || t === String((starts || {})[f])) continue;
            var n = Number(t), range = limits(f);
            if (isNaN(n)) return {error: CHANGES[i][1] + ": not a number", field: f};
            if (n < range[0] || (range[1] !== null && n > range[1])) return {error: range[2], field: f};
            out[f] = n;
        }
        return {changes: out};
    }

    // The measurement parameters: what the flight recorded, what the frame was measured with (both in °C), and the
    // changes (typed in the user's unit), the temperatures shown in the user's unit. Each change starts at the value
    // measured with (data-start), so its arrows step from there.
    function paramsHtml(info, recorded, changes, newUrl) {
        var symbol = measure.symbol();
        var p = (info && info.params) || {};
        var rows = CHANGES.map(function (c) {
            var withValue = c[3] ? core.convertTemp(p[c[4]], "C") : p[c[4]];
            var rec = (recorded || {})[c[5]];
            if (c[3]) rec = core.convertTemp(rec, "C");
            var digits = c[0] === "emissivity" ? 2 : 1, start = core.formatNumber(withValue, digits), range = limits(c[0]);
            return "<tr><th>" + esc(c[1]) + (c[3] ? " (" + esc(symbol) + ")" : "") + "</th>" +
                "<td>" + esc(core.formatNumber(rec, digits)) + "</td>" +
                "<td>" + esc(start) + "</td>" +
                '<td><input type="number" step="' + c[2] + '" min="' + range[0] + '"' + (range[1] !== null ? ' max="' + range[1] + '"' : "") +
                ' class="form-control input-sm" data-change="' + c[0] + '" data-start="' + esc(start) + '" value="' +
                esc(changes[c[0]] === undefined ? start : changes[c[0]]) + '"></td></tr>';
        }).join("");
        var any = Object.keys(changes).length > 0;
        return '<table class="table table-condensed ta-viewer-values ta-params"><thead><tr><th></th><th title="As the camera recorded it ' +
            '(the distance: the rangefinder\'s)">Recorded</th><th>Measured with</th><th>Change to</th></tr></thead><tbody>' + rows + "</tbody></table>" +
            (info && info.distance_source ? '<p class="ta-message">The distance is ' + esc(DISTANCE_SOURCES[info.distance_source] || info.distance_source) + ".</p>" : "") +
            '<div class="text-danger" id="ta-change-error"></div>' +
            '<div class="ta-inline"><button type="button" class="btn btn-primary btn-sm" id="ta-change-apply"><i class="fa fa-sync"></i> Measure again</button>' +
            (any ? '<button type="button" class="btn btn-default btn-sm" id="ta-change-clear">Clear</button>' +
                '<a class="btn btn-default btn-sm" href="' + esc(newUrl) + '"><i class="fa fa-play"></i> New conversion with these</a>' : "") + "</div>" +
            '<p class="ta-message">dji-thermal-cli measures the frame again with the parameters changed: exact, as converting with them would.</p>';
    }

    function infoHtml(info, unit, normalized) {
        if (!info) return "";
        var s = info.stats || {}, rows = [];
        rows.push(["Size", info.width + " × " + info.height + " px"]);
        rows.push(["Range", measure.temp(s.min, unit, 1) + " to " + measure.temp(s.max, unit, 1)]);
        rows.push(["Mean", measure.temp(s.mean, unit)]);
        if (normalized) {
            rows.push(["Normalization", info.offset_known ? "offset " + measure.signed(-info.offset, unit) + " applied" :
                "its offset is not known (converted before the app kept them): shown without it"]);
        }
        var out = '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (r) {
            return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
        }).join("") + "</tbody></table>" + measure.histogramSvg(s.histogram, unit, info.changed && info.changed.stats && info.changed.stats.histogram);
        if ((info.notes || []).length) out += '<p class="ta-message">' + esc(info.notes.join("; ")) + "</p>";
        return out;
    }

    function readoutHtml(res, unit) {
        if (!res || !res.inside) return '<span class="ta-message">Outside the frame.</span>';
        var rows = [["x, y", Math.floor(res.x) + ", " + Math.floor(res.y)],
                    ["As converted", res.temperature === null ? "no data" : measure.temp(res.temperature, unit)]];
        if (res.changed !== undefined) {
            rows.push(["Parameters changed", res.changed === null ? "no data" : measure.temp(res.changed, unit)]);
            if (res.changed !== null && res.temperature !== null) rows.push(["Difference", measure.signed(res.changed - res.temperature, unit)]);
        }
        return '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (r) {
            return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
        }).join("") + "</tbody></table>";
    }

    function init(ctx) {
        var doc = ctx.doc, fetchFn = ctx.fetchFn, L = ctx.L;
        var page = doc.getElementById("ta-frame");
        if (!page) return null;
        var $ = function (i) { return doc.getElementById(i); };
        var API = page.getAttribute("data-api"), publicUrl = page.getAttribute("data-public");
        var id = page.getAttribute("data-id"), datasetId = page.getAttribute("data-dataset");
        var base = API + "conversions/" + id;
        var csrf = (page.querySelector("input[name=csrfmiddlewaretoken]") || {}).value;
        var meta = null, frame = null, info = null, style = null, changes = {}, isotherm = {mode: ""};
        var maps = [], images = [], drawings = [], legend = null, hover = null, asked = 0, loading = 0, measured = 0;
        var current = null, saved = [], syncing = false;
        // The legend's curve with equalization (the server's: see showCurve), and the last one asked for
        var curve = null, curveAsked = 0;
        // The saved measurements ticked to compare, the one whose parameters are being changed, the current line's profile
        var compared = [], editing = null, profile = null;
        var view = viewer.readView(ctx.search), win = doc.defaultView || root, locator = null, spots = {};
        var mosaicsHref = $("ta-frame-mosaics") ? $("ta-frame-mosaics").getAttribute("href") : null;

        function send(u, method, data) {
            var opts = {method: method, credentials: "same-origin", headers: {"X-CSRFToken": csrf}};
            if (data !== undefined) {
                opts.headers["Content-Type"] = "application/json";
                opts.body = JSON.stringify(data);
            }
            return fetchFn(u, opts).then(core.readJson);
        }

        function status(text, cls) {
            $("ta-frame-status").className = "ta-status" + (cls ? " " + cls : "");
            $("ta-frame-status").innerHTML = text || "";
        }

        function changed() { return Object.keys(changes).length > 0; }

        function isothermValue() {
            var r = measure.isothermParam(isotherm.mode, isotherm.a, isotherm.b, meta.unit);
            return r.error ? "" : r.value;
        }

        function bounds() { return [[-info.height, 0], [0, info.width]]; }

        // The two panes' maps (the second shown only with parameters changed), moving together
        function setupMap(i, el) {
            var map = L.map(el, {crs: L.CRS.Simple, minZoom: -3, maxZoom: 6, zoomSnap: 0.25, attributionControl: false,
                                keyboard: false});    // the arrows step through the frames
            map.on("move", function () {
                if (syncing) return;
                syncing = true;
                maps.forEach(function (other) { if (other !== map) other.setView(map.getCenter(), map.getZoom(), {animate: false}); });
                syncing = false;
            });
            map.on("mousemove", function (e) {
                if (hover && root.clearTimeout) root.clearTimeout(hover);
                hover = root.setTimeout ? root.setTimeout(function () { readout(e.latlng); }, HOVER_MS) : readout(e.latlng);
            });
            map.on("mouseout", function () {
                if (hover && root.clearTimeout) root.clearTimeout(hover);
                asked++;
                $("ta-frame-readout").innerHTML = '<span class="ta-message">Move the cursor over the frame.</span>';
            });
            drawings[i] = measure.Drawing({
                L: L, map: map,
                toCoords: function (ll) { return [ll.lng, -ll.lat]; },
                fromCoords: function (c) { return [-c[1], c[0]]; },
                pixels: true,
                onDone: function (g, shape) {
                    drawings.forEach(function (d) { if (d.tool()) d.stop(); });
                    current = {geometry: g, shape: shape};
                    renderTools();
                    measureCurrent();
                },
                onChange: renderTools,
                onLineHover: function (coords) { if (profile) profile.near(coords); }
            });
            maps[i] = map;
            if (i === 0) legend = viewer.mapLegend(L, map, doc);
        }

        function activeDrawing() {
            return drawings.filter(function (d) { return d.tool(); })[0] || null;
        }

        function readout(latlng) {
            var n = ++asked;
            fetchFn(base + "/frame/point?frame=" + encodeURIComponent(frame) + "&x=" + latlng.lng + "&y=" + (-latlng.lat) +
                    changesQuery(changesIn(changes, meta.unit)), {credentials: "same-origin"})
                .then(core.readJson).then(function (r) {
                    if (n !== asked) return;
                    $("ta-frame-readout").innerHTML = r.ok ? readoutHtml(r.data, meta.unit) : "";
                });
        }

        function showImages(fit) {
            var b = bounds();
            var urls = [imageUrl(API, id, frame, style, isothermValue(), {})];
            if (changed()) urls.push(imageUrl(API, id, frame, style, isothermValue(), changesIn(changes, meta.unit)));
            $("ta-frame-changed-pane").hidden = !changed();
            if (changed() && !maps[1]) setupMap(1, $("ta-frame-map-changed"));
            urls.forEach(function (u, i) {
                if (!images[i]) {
                    images[i] = L.imageOverlay(u, b);
                    images[i].addTo(maps[i]);
                } else {
                    images[i].setUrl(u);
                    if (images[i].setBounds) images[i].setBounds(b);
                }
            });
            maps.forEach(function (m) { if (m.invalidateSize) m.invalidateSize(); });
            if (fit) maps[0].fitBounds(b);
            else if (maps[1] && maps[0].getCenter) maps[1].setView(maps[0].getCenter(), maps[0].getZoom(), {animate: false});
            showCurve();
        }

        // The legend's curve: with equalization, the server's (from the whole frame's histogram, as converted), else
        // gamma's
        function showCurve() {
            var n = ++curveAsked;
            curve = null;
            showScale();
            if (!style.adjust.equalize) return;
            fetchFn(base + "/frame/curve?frame=" + encodeURIComponent(frame) + "&rescale=" + style.range[0] + "," + style.range[1] +
                    viewer.adjustQuery(style.adjust), {credentials: "same-origin"})
                .then(core.readJson).then(function (r) {
                    if (n !== curveAsked || !r.ok) return;
                    curve = r.data.shares;
                    showScale();
                }).catch(function () {
                    // the legend stays as gamma alone draws it
                });
        }

        // The palette's share at values evenly across the range, as the image is drawn; null: evenly
        function shares() {
            var a = style.adjust;
            if (a.equalize && curve) return curve;
            return a.gamma !== 1 || a.equalize ? viewer.toneShares(a.gamma) : null;
        }

        // The colour scale, on the first pane (both share it) and in the panel, as the palette, range and adjustments
        // now are
        function showScale() {
            var colors = ((meta.palettes || []).filter(function (p) { return p.key === style.palette; })[0] || {}).color_map;
            var shown = viewer.shownRange("frame", style.range, meta.unit);
            if (legend) legend.set(viewer.legendHtml(colors, shown, "Temperature, " + viewer.unitSymbol(), shares()));
            if ($("ta-viewer-scale")) $("ta-viewer-scale").innerHTML = viewer.legendHtml(colors, shown, "", shares());
        }

        // The frame as shown (both panes, with parameters changed), its saved measurements (and the one drawn, not
        // saved yet) and colour scale, as a PNG. The frame is in pixels: there is no scale bar.
        function exportPng() {
            var f = meta.frames.filter(function (x) { return x.path === frame; })[0] || {};
            var shapes = function (map) {
                var fromCoords = function (c) { return [-c[1], c[0]]; };
                var out = saved.map(function (m) { return viewer.shapeOnMap(map, m.geometry, fromCoords, m.name); });
                if (current && !current.saved) out.push(viewer.shapeOnMap(map, current.geometry, fromCoords, ""));
                return out;
            };
            var both = changed() && maps[1];
            var panes = (both ? [0, 1] : [0]).map(function (i) {
                return {el: maps[i].getContainer(), images: [images[i].getElement()], shapes: shapes(maps[i]),
                        caption: both ? (i ? "Parameters changed" : "As converted") : ""};
            });
            var colors = ((meta.palettes || []).filter(function (p) { return p.key === style.palette; })[0] || {}).color_map;
            var taken = viewer.takenText([f.time]), today = new Date().toISOString().slice(0, 10);
            var canvas = viewer.viewCanvas({
                doc: doc, ratio: Math.max(1, root.devicePixelRatio || 1),
                title: [meta.dataset_name, meta.name, frame].filter(Boolean).join(" · "),
                date: (taken ? "Taken " + taken + " · exported " : "Exported ") + today,
                panes: panes, scale: null,
                legend: {colors: colors, shown: viewer.shownRange("frame", style.range, meta.unit), caption: "Temperature, " + viewer.unitSymbol(),
                         shares: shares()}
            });
            viewer.saveCanvas(doc, canvas, viewer.fileName([meta.dataset_name, meta.name, frame.replace(/\.[^./]*$/, "")], ".png"), function (error) {
                if (error) status(esc(error), "text-danger");
            });
        }

        function renderControls() {
            var pseudoTab = {tab: "frame", stats: info && info.stats};
            $("ta-viewer-controls").innerHTML = viewer.controlsHtml(pseudoTab, style, meta.palettes || [], meta.unit);
            renderImage();
        }

        function renderImage() {
            if ($("ta-frame-image")) $("ta-frame-image").innerHTML = viewer.imageHtml(style.adjust, viewer.sliderPositions(autoRange(), style.range), true);
        }

        // The range Auto gives: the frame's 2nd to 98th percentile
        function autoRange() {
            return viewer.defaultRange({stats: info.stats}, meta.unit);
        }

        // The brightness or contrast slider moved: the range follows (its fields and the legend at once)
        function slideRange() {
            var r = viewer.slidRange(autoRange(), parseFloat($("ta-image-brightness").value), parseFloat($("ta-image-contrast").value));
            var shown = function (x) { return measure.shownTemp(x, meta.unit); };
            style.range = r.map(function (x) { return measure.typedTemp(shown(x), meta.unit); });
            $("ta-viewer-min").value = shown(style.range[0]);
            $("ta-viewer-max").value = shown(style.range[1]);
            $("ta-viewer-range-error").textContent = "";
            showScale();
        }

        function renderTools() {
            var d = activeDrawing();
            $("ta-frame-tools").innerHTML = measure.toolbarHtml(d && d.tool(), d ? d.count() : 0);
        }

        function renderResult(res) {
            var el = $("ta-frame-result");
            if (!current) {
                el.innerHTML = '<p class="ta-message">Choose a tool and draw on the frame.</p>';
                $("ta-measure-save").hidden = true;
                return;
            }
            el.innerHTML = res ? (current.saved ? '<div class="ta-message">Saved as <strong>' + esc(current.saved.name) + "</strong></div>" : "") +
                measure.resultHtml(res, meta.unit, {pixels: true, labels: ["As converted", "Changed"], shape: current.shape}) : '<p class="ta-message">Measuring…</p>';
            linkProfile(el, res);
            $("ta-measure-save").hidden = !(res && !current.saved && res.result && res.result.valid_pixels);
        }

        // A line's profile chart and the line on both panes, their cursors moving together
        function linkProfile(el, res) {
            var cursor = function (coords) { drawings.forEach(function (d) { d.showCursor(coords); }); };
            cursor(null);
            profile = res ? measure.linkProfile(el, res, meta.unit, true, function (i) {
                cursor(i === null ? null : res.result.profile.points[i]);
            }) : null;
        }

        function showOnMaps(geometry, result) {
            drawings.forEach(function (d) { d.show(geometry, result, meta.unit); });
        }

        function measureCurrent() {
            if (!current) return Promise.resolve();
            var n = ++measured;
            current.saved = null;
            renderResult(null);
            return send(base + "/measure", "POST", {target: "frame", frame: frame, geometry: current.geometry,
                                                    isotherm: isothermValue(), parameters: changesIn(changes, meta.unit)}).then(function (r) {
                if (n !== measured) return;
                if (!r.ok) {
                    $("ta-frame-result").innerHTML = '<p class="text-danger">' + esc(core.errorText(r.data, "Could not measure.")) + "</p>";
                    return;
                }
                current.res = r.data;
                renderResult(r.data);
                showOnMaps(current.geometry, r.data.result);
            });
        }

        function recorded() {
            return ((meta.frames || []).filter(function (f) { return f.path === frame; })[0] || {}).recorded;
        }

        function renderParams() {
            $("ta-frame-params").innerHTML = paramsHtml(info, recorded(), changes,
                                                       newConversionUrl(publicUrl, datasetId, id, changes));
            $("ta-frame-info").innerHTML = infoHtml(info, meta.unit, meta.normalized);
        }

        function renderSaved() {
            compared = compared.filter(function (id) { return saved.some(function (m) { return m.id === id; }); });
            $("ta-frame-measurements").innerHTML = measure.measurementsHtml(saved, meta.unit, current && current.saved && current.saved.id,
                                                                            {compared: compared, editing: editing, fields: PARAM_FIELDS});
            $("ta-frame-csv").hidden = !saved.length;
        }

        // A saved measurement measured again with the parameters in its form (empty: the conversion's own)
        function remeasure(id, form) {
            var values = {};
            form.querySelectorAll("[data-param-field]").forEach(function (f) { values[f.getAttribute("data-param-field")] = f.value; });
            var r = readChanges(values, {}), error = form.querySelector("[data-params-error]");
            if (r.error) { error.textContent = r.error; return Promise.resolve(); }
            error.textContent = "Measuring…";
            return send(base + "/measurements/" + id, "PATCH", {parameters: changesIn(r.changes, meta.unit)}).then(function (res) {
                if (!res.ok) { error.textContent = core.errorText(res.data, "Could not measure again."); return; }
                editing = null;
                if (current && current.saved && current.saved.id === id) {
                    current.saved = res.data;
                    current.res = res.data.values;
                    renderResult(res.data.values);
                    showOnMaps(current.geometry, (res.data.values || {}).result);
                }
                return loadSaved();
            });
        }

        function loadSaved() {
            return fetchFn(base + "/measurements?frame=" + encodeURIComponent(frame), {credentials: "same-origin"})
                .then(core.readJson).then(function (r) {
                    if (!r.ok) return;
                    saved = r.data.measurements || [];
                    renderSaved();
                });
        }

        // A frame (or the same one with other parameters): measured, then drawn
        function loadFrame(fit) {
            var n = ++loading;
            status("Measuring the frame…", "text-muted");
            return fetchFn(base + "/frame?frame=" + encodeURIComponent(frame) + changesQuery(changesIn(changes, meta.unit)), {credentials: "same-origin"})
                .then(core.readJson).then(function (r) {
                    if (n !== loading) return;
                    if (!r.ok) return status(esc(core.errorText(r.data, "Could not measure the frame.")), "text-danger");
                    status("");
                    var sizeChanged = !info || info.width !== r.data.width || info.height !== r.data.height;
                    info = r.data;
                    if (!style) style = wantedStyle();
                    writeView();
                    $("ta-frame-main").hidden = false;
                    if (!locator) showLocator();
                    $("ta-frame-png").hidden = false;
                    if (!maps[0]) setupMap(0, $("ta-frame-map"));
                    renderControls();
                    renderTools();
                    renderParams();
                    $("ta-frame-isotherm").innerHTML = measure.isothermHtml(isotherm);
                    showImages(fit || sizeChanged);
                    if (current) measureCurrent();
                    else renderResult(null);
                });
        }

        // The palette and range a link asked for, else the frame's own
        function wantedStyle() {
            var known = (meta.palettes || []).some(function (p) { return p.key === view.palette; });
            return {palette: known ? view.palette : meta.default_palette,
                    range: view.range || viewer.defaultRange({stats: info.stats}, meta.unit), adjust: view.adjust || viewer.defaultAdjust()};
        }

        // The view in the URL, so that a reload or a copied link keeps it: the frame, its palette, range and adjustments
        function writeView() {
            if (!win.history || !win.history.replaceState || !win.location) return;
            win.history.replaceState(null, "", win.location.pathname + viewer.viewQuery({frame: frame, palette: style && style.palette,
                                                                                          range: style && style.range, adjust: style && style.adjust}));
        }

        // Where the frames were taken, on a small map: the frame shown highlighted, a click on another opens it
        function showLocator() {
            var placed = meta.frames.filter(function (f) { return typeof f.lat === "number" && typeof f.lon === "number"; });
            $("ta-frame-locator-section").hidden = !placed.length;
            if (!placed.length) return;
            locator = L.map($("ta-frame-locator"), {attributionControl: false, zoomControl: false, keyboard: false, maxZoom: 19});
            placed.forEach(function (f) {
                var spot = L.circleMarker([f.lat, f.lon], LOCATOR_SPOT);
                spot.bindTooltip(f.path);
                spot.on("click", function () { if (f.path !== frame) chooseFrame(f.path); });
                spot.addTo(locator);
                spots[f.path] = spot;
            });
            locator.fitBounds(L.latLngBounds(placed.map(function (f) { return [f.lat, f.lon]; })), {padding: [12, 12]});
            markLocator();
        }

        function markLocator() {
            Object.keys(spots).forEach(function (path) {
                spots[path].setStyle(path === frame ? LOCATOR_CURRENT : LOCATOR_SPOT);
                if (path === frame) spots[path].bringToFront();
            });
        }

        function chooseFrame(path) {
            frame = path;
            current = null;
            drawings.forEach(function (d) { d.stop(); d.clear(); });
            $("ta-frame-select").innerHTML = framesHtml(meta.frames, frame);
            var f = meta.frames.filter(function (x) { return x.path === frame; })[0] || {};
            $("ta-frame-about").textContent = (f.time || "") + (f.mosaic !== null && f.mosaic !== undefined ? " · frame " + (f.mosaic + 1) + " of the mosaics" : "");
            // Back to the mosaics with this frame's footprint outlined, when it is in them
            if (mosaicsHref) {
                $("ta-frame-mosaics").setAttribute("href", mosaicsHref + (f.mosaic !== null && f.mosaic !== undefined ? viewer.viewQuery({frame: frame}) : ""));
            }
            writeView();
            markLocator();
            loadSaved();
            return loadFrame(false);
        }

        function step(by) {
            var paths = meta.frames.map(function (f) { return f.path; });
            var i = paths.indexOf(frame) + by;
            if (i >= 0 && i < paths.length) chooseFrame(paths[i]);
        }

        function load(wanted) {
            return fetchFn(base + "/frames", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return status("Could not load the frames.", "text-danger");
                meta = r.data;
                $("ta-frame-subtitle").textContent = meta.description || "";
                if (!(meta.frames || []).length) return status("The dataset has no thermal frames to show.", "text-muted");
                var paths = meta.frames.map(function (f) { return f.path; });
                frame = paths.indexOf(wanted) >= 0 ? wanted : paths[0];
                return chooseFrame(frame).then(function () { if (maps[0]) maps[0].fitBounds(bounds()); });
            });
        }

        // The changed parameters read: an error marks its field; the frame is measured again with the rest
        function applyChanges() {
            var values = {}, starts = {}, fields = page.querySelectorAll("[data-change]");
            [].forEach.call(fields, function (el) {
                values[el.getAttribute("data-change")] = el.value;
                starts[el.getAttribute("data-change")] = el.getAttribute("data-start");
            });
            var r = readChanges(values, starts);
            [].forEach.call(fields, function (el) { el.parentNode.classList.toggle("has-error", r.field === el.getAttribute("data-change")); });
            $("ta-change-error").textContent = r.error || "";
            if (r.error) return;
            changes = r.changes;
            return loadFrame(false);
        }

        // Enter in a changed parameter measures again
        page.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && e.target.getAttribute && e.target.getAttribute("data-change")) {
                e.preventDefault();
                applyChanges();
            }
        });
        page.addEventListener("click", function (e) {
            var closest = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
            if (closest("#ta-frame-prev")) return step(-1);
            if (closest("#ta-frame-next")) return step(1);
            if (closest("#ta-viewer-auto") || closest("#ta-image-reset")) {
                style.range = autoRange();
                if (closest("#ta-image-reset")) style.adjust = viewer.defaultAdjust();
                renderControls();
                writeView();
                return showImages(false);
            }
            var t = closest("[data-tool]");
            if (t) {
                var name = t.getAttribute("data-tool"), d = activeDrawing();
                drawings.forEach(function (x) { x.stop(); });
                if (!d || d.tool() !== name) drawings[0].start(name);
                renderTools();
                return;
            }
            var act = closest("[data-tool-act]");
            if (act) {
                var active = activeDrawing();
                if (active) {
                    if (act.getAttribute("data-tool-act") === "finish") active.finish();
                    else active.stop();
                }
                renderTools();
                return;
            }
            if (closest("#ta-change-apply")) return applyChanges();
            if (closest("#ta-change-clear")) {
                changes = {};
                return loadFrame(false);
            }
            var show = closest("[data-show]");
            if (show) {
                e.preventDefault();
                var m = saved.filter(function (x) { return String(x.id) === show.getAttribute("data-show"); })[0];
                if (!m) return;
                current = {geometry: m.geometry, saved: m, res: m.values, shape: (m.values || {}).shape};
                renderResult(m.values);
                showOnMaps(m.geometry, (m.values || {}).result);
                renderSaved();
                return;
            }
            var ren = closest("[data-rename]");
            if (ren) {
                var named = saved.filter(function (x) { return String(x.id) === ren.getAttribute("data-rename"); })[0];
                if (!named) return;
                core.askName(doc, "Rename measurement", named.name).then(function (name) {
                    return name && send(base + "/measurements/" + named.id, "PATCH", {name: name});
                }).then(function (res) {
                    if (!res) return;
                    if (!res.ok) { $("ta-measure-error").textContent = core.errorText(res.data, "Could not rename the measurement."); return; }
                    $("ta-measure-error").textContent = "";
                    if (current && current.saved && current.saved.id === named.id) current.saved = res.data;
                    return loadSaved();
                });
                return;
            }
            var par = closest("[data-params]");
            if (par) {
                var pid = Number(par.getAttribute("data-params"));
                editing = editing === pid ? null : pid;
                renderSaved();
                return;
            }
            var pact = closest("[data-params-act]");
            if (pact) {
                if (pact.getAttribute("data-params-act") === "cancel") {
                    editing = null;
                    renderSaved();
                    return;
                }
                remeasure(Number(pact.getAttribute("data-id")), pact.closest("[data-params-form]"));
                return;
            }
            var del = closest("[data-delete]");
            if (del) {
                var item = saved.filter(function (x) { return String(x.id) === del.getAttribute("data-delete"); })[0];
                if (!item) return;
                core.ask(doc, "Delete measurement", "Delete the measurement " + item.name + "?", "Delete", "danger").then(function (yes) {
                    return yes && send(base + "/measurements/" + item.id, "DELETE");
                }).then(function (res) {
                    if (!res) return;
                    if (!res.ok) { $("ta-measure-error").textContent = core.errorText(res.data, "Could not delete the measurement."); return; }
                    return loadSaved();
                });
                return;
            }
            if (closest("#ta-measure-save-btn")) {
                var nameEl = $("ta-measure-name"), label = nameEl.value.trim();
                if (!label) { $("ta-measure-error").textContent = "Name the measurement to save it"; return; }
                send(base + "/measurements", "POST", {name: label, target: "frame", frame: frame, geometry: current.geometry, shape: current.shape,
                                                       isotherm: isothermValue(), parameters: changesIn(changes, meta.unit)}).then(function (res) {
                    if (!res.ok) { $("ta-measure-error").textContent = core.errorText(res.data, "Could not save the measurement."); return; }
                    $("ta-measure-error").textContent = "";
                    nameEl.value = "";
                    current.saved = res.data;
                    renderResult(res.data.values);
                    return loadSaved();
                });
            }
        });
        page.addEventListener("change", function (e) {
            if (e.target.hasAttribute && e.target.hasAttribute("data-compare")) {
                compared = measure.toggleCompared(compared, Number(e.target.getAttribute("data-compare")), e.target.checked);
                renderSaved();
                return;
            }
            var tid = e.target.id;
            if (tid === "ta-frame-select") {
                chooseFrame(e.target.value);
            } else if (tid === "ta-viewer-palette") {
                style.palette = e.target.value;
                renderControls();
                showImages(false);
                writeView();
            } else if (tid === "ta-viewer-min" || tid === "ta-viewer-max") {
                var r = viewer.parseRange($("ta-viewer-min").value, $("ta-viewer-max").value, meta.unit);
                $("ta-viewer-range-error").textContent = r.error || "";
                if (r.error) return;
                style.range = r.range;
                renderImage();
                showImages(false);
                writeView();
            } else if (tid === "ta-image-brightness" || tid === "ta-image-contrast" || tid === "ta-image-gamma" ||
                       tid === "ta-image-sharpen" || tid === "ta-image-tone") {
                if (tid === "ta-image-brightness" || tid === "ta-image-contrast") slideRange();
                else if (tid === "ta-image-gamma") style.adjust.gamma = viewer.sliderGamma(e.target.value);
                else if (tid === "ta-image-sharpen") style.adjust.sharpen = parseFloat(e.target.value) || 0;
                else style.adjust.equalize = e.target.value === "equalized";
                showImages(false);
                writeView();
            } else if (tid === "ta-iso-mode" || tid === "ta-iso-a" || tid === "ta-iso-b") {
                isotherm = {mode: $("ta-iso-mode").value, a: $("ta-iso-a").value, b: $("ta-iso-b").value};
                if (tid === "ta-iso-mode" && isotherm.mode && isotherm.a === "") {
                    var lo = core.convertTemp(style.range[0], meta.unit), hi = core.convertTemp(style.range[1], meta.unit);
                    isotherm.a = Math.round((hi - (hi - lo) / 4) * 10) / 10;
                    isotherm.b = Math.round(hi * 100) / 100;
                }
                var iso = measure.isothermParam(isotherm.mode, isotherm.a, isotherm.b, meta.unit);
                if (tid === "ta-iso-mode") $("ta-frame-isotherm").innerHTML = measure.isothermHtml(isotherm);
                $("ta-iso-error").textContent = iso.error || "";
                if (iso.error) return;
                showImages(false);
                measureCurrent();
            }
        });

        // A slider dragged shows its value (and the range and legend) as it goes, and redraws when let go (change)
        page.addEventListener("input", function (e) {
            var tid = e.target.id;
            if (tid === "ta-image-brightness" || tid === "ta-image-contrast") return slideRange();
            if (tid === "ta-image-gamma") {
                style.adjust.gamma = viewer.sliderGamma(e.target.value);
                $("ta-image-gamma-value").textContent = style.adjust.gamma.toFixed(2);
                if (!style.adjust.equalize) showScale();
            } else if (tid === "ta-image-sharpen") {
                $("ta-image-sharpen-value").textContent = e.target.value;
            }
        });

        // Enter finishes the shape being drawn and Esc cancels it; otherwise ← and → step through the frames (not
        // while typing)
        doc.addEventListener("keydown", function (e) {
            // Only while this page is shown
            if (!doc.documentElement.contains(page)) return;
            var d = activeDrawing();
            if (measure.drawingKey(e, d)) return renderTools();
            if (d || measure.inField(e.target) || e.altKey || e.ctrlKey || e.metaKey || !meta || !frame) return;
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            if (e.preventDefault) e.preventDefault();
            step(e.key === "ArrowLeft" ? -1 : 1);
        });
        viewer.foldSections(doc, page, "thermal-analyzer.frame.folded");
        // A map laid out while folded away is sized again when it is shown
        if ($("ta-frame-locator-section")) {
            $("ta-frame-locator-section").addEventListener("toggle", function () { if (locator && this.open) locator.invalidateSize(); });
        }
        $("ta-frame-png").addEventListener("click", function () { if (info && images[0]) exportPng(); });

        return load(view.frame || null).then(function () {
            return {frame: function () { return frame; }};
        });
    }

    var api = {frameLabel: frameLabel, framesHtml: framesHtml, changesQuery: changesQuery, imageUrl: imageUrl,
               newConversionUrl: newConversionUrl, readChanges: readChanges, changesIn: changesIn, paramsHtml: paramsHtml, infoHtml: infoHtml,
               readoutHtml: readoutHtml, init: init};
    root.ThermalAnalyzerFrame = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});

if (typeof window !== "undefined" && window.document && window.fetch && window.L) {
    window.ThermalAnalyzerFrame.init({doc: document, fetchFn: window.fetch.bind(window), L: window.L,
                                      search: window.location.search});
}
