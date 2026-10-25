// Two mosaics side by side (compare.html): each pane shows a conversion's temperature mosaic, or the
// difference of pane A's and pane B's (A − B), with pan and zoom linked, the cursor marked in the other pane, one
// palette and range shared (or each pane's own), and the source frame of a point picked in a pane, below its map.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var measure = root.ThermalAnalyzerMeasure || (typeof require !== "undefined" ? require("./measure") : null);
    var viewer = root.ThermalAnalyzerViewer || (typeof require !== "undefined" ? require("./viewer") : null);
    var esc = function (t) { return core.escapeHtml(t); };
    var HOVER_MS = 120;
    var SPLIT_LIMITS = [20, 80], SPLIT_STEP = 5;
    var CURSOR = {radius: 6, weight: 2, color: "#fff", fill: false, interactive: false};
    var PICKED = {radius: 6, weight: 2, color: "#fff", fillColor: "#e8562a", fillOpacity: 1, interactive: false};
    var NO_OVERLAP = "These mosaics do not overlap.";

    // The view kept in the URL (?b=&a=&a_tab=&b_tab=&diff=a|b&split=): what was given, the split between the limits
    function readCompare(search) {
        var params = {};
        String(search || "").replace(/^\?/, "").split("&").forEach(function (pair) {
            var i = pair.indexOf("=");
            if (!pair) return;
            params[decodeURIComponent(i < 0 ? pair : pair.slice(0, i))] = i < 0 ? "" : decodeURIComponent(pair.slice(i + 1));
        });
        var out = {};
        ["a", "b"].forEach(function (k) {
            if (/^[0-9]+$/.test(params[k] || "")) out[k] = parseInt(params[k], 10);
            if (params[k + "_tab"]) out[k + "_tab"] = params[k + "_tab"];
        });
        if (params.diff === "a" || params.diff === "b") out.diff = params.diff;
        var split = parseFloat(params.split);
        if (!isNaN(split)) out.split = clampSplit(split);
        return out;
    }

    // The same as a query; pageId: the page's conversion, pane A's when a is left out
    function compareQuery(view, pageId) {
        var parts = ["b=" + view.b];
        if (String(view.a) !== String(pageId)) parts.push("a=" + view.a);
        parts.push("a_tab=" + encodeURIComponent(view.a_tab), "b_tab=" + encodeURIComponent(view.b_tab));
        if (view.diff) parts.push("diff=" + view.diff);
        if (view.split !== undefined && view.split !== 50) parts.push("split=" + view.split);
        return "?" + parts.join("&");
    }

    function clampSplit(share) {
        return Math.round(Math.max(SPLIT_LIMITS[0], Math.min(SPLIT_LIMITS[1], share)));
    }

    // The mosaics to choose from, by dataset: options "id:tab"
    function mosaicOptionsHtml(list, current) {
        var groups = [], byDataset = {};
        list.forEach(function (c) {
            if (!byDataset[c.dataset]) groups.push(byDataset[c.dataset] = {name: c.dataset_name, items: []});
            byDataset[c.dataset].items.push(c);
        });
        return groups.map(function (g) {
            return '<optgroup label="' + esc(g.name) + '">' + g.items.map(function (c) {
                return c.tabs.map(function (tab) {
                    var value = c.id + ":" + tab;
                    return '<option value="' + esc(value) + '"' + (value === current ? " selected" : "") + ">" +
                        esc(c.name + " · " + viewer.tabLabel(tab)) + "</option>";
                }).join("");
            }).join("") + "</optgroup>";
        }).join("");
    }

    // The range (in the user's unit) as the API takes it for a conversion in unit
    function rangeIn(range, unit) {
        return range.map(function (x) { return measure.typedTemp(x, unit); });
    }

    // A tab's Auto range in the user's unit; several: the range that holds them all
    function autoRange(entries) {
        var lo = null, hi = null;
        entries.forEach(function (e) {
            if (!e.tab) return;
            var r = viewer.defaultRange(e.tab, e.unit).map(function (x) { return core.convertTemp(x, e.unit); });
            lo = lo === null ? r[0] : Math.min(lo, r[0]);
            hi = hi === null ? r[1] : Math.max(hi, r[1]);
        });
        if (lo === null) return [0, 1];
        return [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
    }

    // The difference's Auto reach in the user's unit (the server's symmetric range, in A's unit), rounded up to a tenth
    function autoReach(info) {
        if (!info || !info.range) return 1;
        return Math.max(0.1, Math.ceil(core.convertDelta(info.range[1], info.unit) * 10 - 1e-9) / 10);
    }

    function differenceTileUrl(api, a, aTab, b, bTab, style, aUnit) {
        var r = Math.round(core.convertDelta(style.reach, core.userUnit(), aUnit) * 10000) / 10000;
        return api + "conversions/" + a + "/mosaics/" + aTab + "/difference/tiles/{z}/{x}/{y}?b=" + b + "&b_tab=" +
            encodeURIComponent(bTab) + "&color_map=" + encodeURIComponent(style.palette) + "&rescale=" + (-r) + "," + r;
    }

    // A frame drawn in a style (the range in the user's unit), for a conversion in unit
    function frameImageUrl(api, id, frame, style, unit) {
        var range = rangeIn(style.range, unit);
        return api + "conversions/" + id + "/frame/image.png?frame=" + encodeURIComponent(frame) + "&color_map=" +
            encodeURIComponent(style.palette) + "&rescale=" + range[0] + "," + range[1] + viewer.adjustQuery(style.adjust);
    }

    // The values of both mosaics at a point, and A − B (each in its own unit; the difference in the user's)
    function differenceReadoutHtml(ra, rb, aUnit, bUnit) {
        var value = function (r, unit) {
            if (!r || !r.valid) return r && r.reason === "outside_raster" ? "outside the mosaic" : "no data";
            return r.temperature === null || r.temperature === undefined ? "no data" : measure.temp(r.temperature, unit);
        };
        var both = ra && rb && ra.valid && rb.valid && ra.temperature !== null && ra.temperature !== undefined &&
            rb.temperature !== null && rb.temperature !== undefined;
        var rows = [["A", value(ra, aUnit)], ["B", value(rb, bUnit)],
                    ["A − B", both ? measure.signed(core.convertTemp(ra.temperature, aUnit) - core.convertTemp(rb.temperature, bUnit),
                                                    core.userUnit()) : "no data"]];
        return '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (r) {
            return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
        }).join("") + "</tbody></table>";
    }

    // A palette and range (with the image's adjustments), or the difference's palette and reach; where: the
    // container's data-style ("shared", "a" or "b")
    function styleHtml(style, palettes, where) {
        var symbol = viewer.unitSymbol();
        var options = palettes.map(function (p) {
            return '<option value="' + esc(p.key) + '"' + (p.key === style.palette ? " selected" : "") + ">" + esc(p.label) + "</option>";
        }).join("");
        var out = '<label>Palette <select class="form-control input-sm" data-k="palette">' + options + "</select></label>";
        if (style.reach !== undefined) {
            out += '<span class="ta-compare-range">± <input type="number" step="0.1" min="0.1" class="form-control input-sm" data-k="reach" value="' +
                style.reach + '" title="The difference at either end of the palette"> ' + esc(symbol) +
                ' <button type="button" class="btn btn-default btn-sm" data-k="auto" title="The 2nd to 98th percentile of the difference">Auto</button></span>';
        } else {
            var a = style.adjust || viewer.defaultAdjust();
            out += '<span class="ta-compare-range"><input type="number" step="0.1" class="form-control input-sm" data-k="min" value="' +
                style.range[0] + '" title="Minimum"> to <input type="number" step="0.1" class="form-control input-sm" data-k="max" value="' +
                style.range[1] + '" title="Maximum"> ' + esc(symbol) +
                ' <button type="button" class="btn btn-default btn-sm" data-k="auto" title="The 2nd to 98th percentile of ' +
                (where === "shared" ? "both mosaics" : "this mosaic") + '">Auto</button></span>' +
                '<label>Gamma <input type="range" min="-2.3" max="2.3" step="0.1" data-k="gamma" value="' +
                (Math.round(Math.log(a.gamma || 1) / Math.LN2 * 10) / 10) + '"></label>' +
                '<label><input type="checkbox" data-k="equalize"' + (a.equalize ? " checked" : "") + "> Equalize</label>" +
                '<label>Sharpen <input type="range" min="0" max="5" step="0.5" data-k="sharpen" value="' + (a.sharpen || 0) + '"></label>';
        }
        return out + ' <span class="text-danger" data-k="error"></span>';
    }

    function paneHtml(name) {
        return '<div class="ta-compare-head">' +
            '<span class="ta-compare-name">' + name.toUpperCase() + "</span>" +
            '<select class="form-control input-sm" data-k="mosaic" title="The mosaic of pane ' + name.toUpperCase() + '"></select>' +
            '<select class="form-control input-sm" data-k="show"><option value="mosaic">Mosaic</option>' +
            '<option value="diff">Difference (A − B)</option></select>' +
            '<button type="button" class="btn btn-default btn-sm" data-k="pick" aria-pressed="false" title="Click the map to see the source frame of a point">' +
            '<i class="fa fa-crosshairs"></i> Pick a point</button></div>' +
            '<div class="ta-compare-style" data-style="' + name + '" hidden></div>' +
            '<div class="ta-compare-note ta-message" hidden></div>' +
            '<div class="ta-compare-map"></div>' +
            '<div class="ta-compare-readout"><span class="ta-message">Move the cursor over a mosaic.</span></div>' +
            '<div class="ta-compare-pick" hidden></div>';
    }

    function init(ctx) {
        var doc = ctx.doc, fetchFn = ctx.fetchFn, L = ctx.L;
        var page = doc.getElementById("ta-compare");
        if (!page) return null;
        var $ = function (i) { return doc.getElementById(i); };
        var API = page.getAttribute("data-api"), PUBLIC = page.getAttribute("data-public");
        var pageId = parseInt(page.getAttribute("data-id"), 10), otherId = parseInt(page.getAttribute("data-b"), 10);
        var win = doc.defaultView || root;
        var wanted = readCompare(ctx.search);
        var list = [], infos = {}, diffs = {}, palettes = [];
        var linked = true, locked = true, syncing = false, split = wanted.split || 50, dragging = false;
        var shared = null, hover = null, asked = 0;
        var panes = {a: {name: "a"}, b: {name: "b"}};

        function status(text, cls) {
            $("ta-compare-status").className = "ta-status" + (cls ? " " + cls : "");
            $("ta-compare-status").textContent = text || "";
        }

        function get(u) {
            return fetchFn(u, {credentials: "same-origin"}).then(core.readJson);
        }

        function conversion(id) {
            return list.filter(function (c) { return c.id === id; })[0];
        }

        // A conversion's mosaics (/mosaics), asked once
        function info(id) {
            if (!infos[id]) infos[id] = get(API + "conversions/" + id + "/mosaics").then(function (r) {
                if (!r.ok) throw new Error("mosaics");
                return r.data;
            });
            return infos[id];
        }

        // The difference of A's and B's mosaics (/difference), asked once for each pair
        function diffKey() {
            return [panes.a.conv, panes.a.tab, panes.b.conv, panes.b.tab].join(":");
        }

        function diffInfo() {
            var key = diffKey();
            if (!diffs[key]) diffs[key] = get(API + "conversions/" + panes.a.conv + "/mosaics/" + panes.a.tab + "/difference?b=" +
                panes.b.conv + "&b_tab=" + encodeURIComponent(panes.b.tab)).then(function (r) {
                if (!r.ok) throw new Error("difference");
                return r.data;
            });
            return diffs[key];
        }

        // The tab entry of a pane's mosaic (bounds, zooms, statistics), once its conversion's mosaics are in
        function tabEntry(pane) {
            return pane.info && (pane.info.tabs || []).filter(function (t) { return t.tab === pane.tab; })[0];
        }

        function temperatureStyle(pane) {
            return locked ? shared : pane.style;
        }

        function frameUrl(id) {
            return PUBLIC + "conversion/" + id + "/frame?frame=";
        }

        // ----- the URL

        function writeView() {
            if (!win.history || !win.history.replaceState || !win.location) return;
            var view = {a: panes.a.conv, b: panes.b.conv, a_tab: panes.a.tab, b_tab: panes.b.tab, split: split,
                        diff: panes.a.diff ? "a" : panes.b.diff ? "b" : ""};
            win.history.replaceState(null, "", win.location.pathname + compareQuery(view, pageId));
        }

        // ----- the split

        function applySplit() {
            panes.a.el.style.flexBasis = split + "%";
            $("ta-compare-split").setAttribute("aria-valuenow", String(split));
            ["a", "b"].forEach(function (n) { if (panes[n].map) panes[n].map.invalidateSize(); });
        }

        function setSplit(share) {
            split = clampSplit(share);
            applySplit();
            writeView();
        }

        function setupSplit() {
            var handle = $("ta-compare-split");
            handle.setAttribute("aria-valuemin", String(SPLIT_LIMITS[0]));
            handle.setAttribute("aria-valuemax", String(SPLIT_LIMITS[1]));
            handle.addEventListener("mousedown", function (e) {
                dragging = true;
                page.classList.add("ta-compare-dragging");
                e.preventDefault();
            });
            doc.addEventListener("mousemove", function (e) {
                if (!dragging) return;
                var rect = $("ta-compare-body").getBoundingClientRect();
                if (rect.width > 0) setSplit((e.clientX - rect.left) / rect.width * 100);
            });
            doc.addEventListener("mouseup", function () {
                if (!dragging) return;
                dragging = false;
                page.classList.remove("ta-compare-dragging");
            });
            handle.addEventListener("keydown", function (e) {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                setSplit(split + (e.key === "ArrowLeft" ? -SPLIT_STEP : SPLIT_STEP));
            });
        }

        // ----- the maps

        function other(pane) { return pane === panes.a ? panes.b : panes.a; }

        function setupMap(pane) {
            var map = L.map(pane.el.querySelector(".ta-compare-map"), {maxZoom: 26});
            var layers = {}, chosen = null;
            (ctx.basemaps || []).forEach(function (bm) {
                var opts = {attribution: bm.attribution || bm.label, maxZoom: 26, maxNativeZoom: bm.maxzoom || 21,
                            minZoom: bm.minzoom || 0, subdomains: bm.subdomains || []};
                var l = bm.type === "wms" ? L.tileLayer.wms(bm.url, Object.assign(opts, {layers: bm.layers || "0",
                    styles: bm.styles || "default", format: bm.format || "image/png"})) : L.tileLayer(bm.url, opts);
                layers[bm.label] = l;
                if (bm["default"] && !chosen) chosen = l;
            });
            layers.None = L.layerGroup();
            (chosen || layers.None).addTo(map);
            L.control.layers(layers, {}, {position: "topright"}).addTo(map);
            L.control.scale({imperial: false}).addTo(map);
            pane.legend = viewer.mapLegend(L, map, doc);
            pane.map = map;
            map.on("moveend", function () {
                var o = other(pane);
                if (!linked || syncing || !o.map) return;
                syncing = true;
                try { o.map.setView(map.getCenter(), map.getZoom(), {animate: false}); } finally { syncing = false; }
            });
            map.on("mousemove", function (e) {
                var o = other(pane);
                if (o.map) {
                    if (!o.cursor) o.cursor = L.circleMarker(e.latlng, CURSOR);
                    else o.cursor.setLatLng(e.latlng);
                    if (!o.cursorShown) { o.cursor.addTo(o.map); o.cursorShown = true; }
                }
                if (pane.cursorShown) { pane.map.removeLayer(pane.cursor); pane.cursorShown = false; }
                if (hover && root.clearTimeout) root.clearTimeout(hover);
                hover = root.setTimeout ? root.setTimeout(function () { readout(e.latlng); }, HOVER_MS) : readout(e.latlng);
            });
            map.on("mouseout", function () {
                if (hover && root.clearTimeout) root.clearTimeout(hover);
                asked++;
                ["a", "b"].forEach(function (n) {
                    var p = panes[n];
                    if (p.cursorShown) { p.map.removeLayer(p.cursor); p.cursorShown = false; }
                    p.el.querySelector(".ta-compare-readout").innerHTML = '<span class="ta-message">Move the cursor over a mosaic.</span>';
                });
            });
            map.on("click", function (e) {
                if (pane.picking) pick(pane, e.latlng);
            });
        }

        function pointOf(pane, latlng) {
            return get(API + "conversions/" + pane.conv + "/mosaics/" + pane.tab + "/point?lon=" + latlng.lng + "&lat=" + latlng.lat)
                .then(function (r) { return r.ok ? r.data : null; });
        }

        // Both mosaics' values at the cursor, each pane's readout from them
        function readout(latlng) {
            var n = ++asked;
            Promise.all([pointOf(panes.a, latlng), pointOf(panes.b, latlng)]).then(function (r) {
                if (n !== asked) return;    // the cursor moved on
                ["a", "b"].forEach(function (name) {
                    var p = panes[name];
                    p.el.querySelector(".ta-compare-readout").innerHTML = p.diff ?
                        differenceReadoutHtml(r[0], r[1], panes.a.info.unit, panes.b.info.unit) :
                        viewer.readoutHtml(name === "a" ? r[0] : r[1], p.info.unit, frameUrl(p.conv));
                });
            });
        }

        function note(pane, text) {
            var el = pane.el.querySelector(".ta-compare-note");
            el.textContent = text || "";
            el.hidden = !text;
        }

        // The pane's layer: drawn again in its style, made again when what it shows changes
        function setLayer(pane, key, url, bounds, maxzoom) {
            if (pane.layer && pane.layerKey === key) {
                pane.layer.setUrl(url);
                return;
            }
            if (pane.layer) pane.map.removeLayer(pane.layer);
            pane.layer = L.tileLayer(url, {maxZoom: 26, maxNativeZoom: (maxzoom || 20) + 1, minZoom: 0,
                                           bounds: L.latLngBounds([bounds[1], bounds[0]], [bounds[3], bounds[2]])});
            pane.layer.addTo(pane.map);
            pane.layerKey = key;
        }

        function dropLayer(pane) {
            if (pane.layer) pane.map.removeLayer(pane.layer);
            pane.layer = null;
            pane.layerKey = null;
        }

        function draw(pane) {
            if (!pane.diff) {
                var t = tabEntry(pane), s = temperatureStyle(pane);
                note(pane, "");
                if (!t || !t.bounds) { dropLayer(pane); pane.legend.set(""); return Promise.resolve(); }
                setLayer(pane, pane.conv + ":" + pane.tab, viewer.tileUrl(API, pane.conv, pane.tab,
                    {palette: s.palette, range: rangeIn(s.range, pane.info.unit), adjust: s.adjust}), t.bounds, t.maxzoom);
                var shares = s.adjust && (s.adjust.gamma !== 1 || s.adjust.equalize) ? viewer.toneShares(s.adjust.gamma) : null;
                pane.legend.set(viewer.legendHtml(colorMap(palettes, s.palette), s.range,
                    viewer.tabLabel(pane.tab) + " (" + viewer.unitSymbol() + ")", shares));
                return Promise.resolve();
            }
            var key = diffKey();
            return diffInfo().then(function (d) {
                if (!pane.diff || key !== diffKey()) return;
                pane.diffInfo = d;
                if (!pane.diffStyle || pane.diffStyle.key !== key) {
                    var kept = pane.diffStyle && pane.diffStyle.palette;
                    var keys = (d.palettes || []).map(function (p) { return p.key; });
                    pane.diffStyle = {key: key, palette: keys.indexOf(kept) >= 0 ? kept : keys[0], reach: autoReach(d)};
                    renderStyles();
                }
                if (!d.range || !d.bounds) {
                    dropLayer(pane);
                    pane.legend.set("");
                    note(pane, NO_OVERLAP);
                    return;
                }
                note(pane, "");
                setLayer(pane, "diff:" + key, differenceTileUrl(API, panes.a.conv, panes.a.tab, panes.b.conv, panes.b.tab,
                    pane.diffStyle, d.unit), d.bounds, Math.max(tabMaxzoom(panes.a), tabMaxzoom(panes.b)));
                pane.legend.set(viewer.legendHtml(colorMap(d.palettes, pane.diffStyle.palette), [-pane.diffStyle.reach, pane.diffStyle.reach],
                    "A − B (" + viewer.unitSymbol() + ")"));
            }).catch(function () {
                dropLayer(pane);
                note(pane, "Could not load the difference.");
            });
        }

        function tabMaxzoom(pane) {
            var t = tabEntry(pane);
            return t && t.maxzoom || 20;
        }

        function colorMap(list, key) {
            var p = (list || []).filter(function (x) { return x.key === key; })[0];
            return p && p.color_map;
        }

        function drawAll() {
            return Promise.all([draw(panes.a), draw(panes.b)]);
        }

        // ----- the styles

        function renderStyles() {
            var anyMosaic = !panes.a.diff || !panes.b.diff;
            $("ta-compare-shared").hidden = !(locked && anyMosaic);
            if (locked && anyMosaic) $("ta-compare-shared").innerHTML = styleHtml(shared, palettes, "shared");
            ["a", "b"].forEach(function (n) {
                var p = panes[n], el = p.el.querySelector(".ta-compare-style");
                var shown = p.diff ? !!p.diffStyle : !locked;
                el.hidden = !shown;
                el.innerHTML = !shown ? "" : p.diff ? styleHtml(p.diffStyle, p.diffInfo && p.diffInfo.palettes || [], n) :
                    styleHtml(p.style, palettes, n);
            });
        }

        // The style a container's controls change: the shared one, a pane's own, or a pane's difference's
        function styleOf(where) {
            if (where === "shared") return {style: shared};
            var p = panes[where];
            return {pane: p, style: p.diff ? p.diffStyle : p.style};
        }

        function autoFor(where) {
            if (where === "shared") return autoRange([panes.a, panes.b].map(function (p) { return {tab: tabEntry(p), unit: p.info.unit}; }));
            return autoRange([{tab: tabEntry(panes[where]), unit: panes[where].info.unit}]);
        }

        function styleChanged(where) {
            if (where === "shared" || !panes[where].diff) {
                drawAll();
                ["a", "b"].forEach(function (n) { if (panes[n].pick) renderPick(panes[n]); });
            } else {
                draw(panes[where]);
            }
        }

        function onStyle(el, kind) {
            var box = el.closest("[data-style]");
            if (!box) return;
            var where = box.getAttribute("data-style"), k = el.getAttribute("data-k"), s = styleOf(where).style;
            var error = box.querySelector('[data-k="error"]');
            if (!s || !k) return;
            if (error) error.textContent = "";
            if (k === "palette") s.palette = el.value;
            else if (k === "min" || k === "max") {
                var r = viewer.parseRange(box.querySelector('[data-k="min"]').value, box.querySelector('[data-k="max"]').value);
                if (r.error) { if (error) error.textContent = r.error; return; }
                s.range = r.range;
            } else if (k === "reach") {
                var reach = parseFloat(el.value);
                if (!(reach > 0)) { if (error) error.textContent = "The difference shown must be above 0"; return; }
                s.reach = reach;
            } else if (k === "auto" && kind === "click") {
                if (s.reach !== undefined) s.reach = autoReach(styleOf(where).pane.diffInfo);
                else s.range = autoFor(where);
                renderStyles();
            } else if (k === "gamma") s.adjust.gamma = viewer.sliderGamma(el.value);
            else if (k === "equalize") s.adjust.equalize = el.checked;
            else if (k === "sharpen") s.adjust.sharpen = parseFloat(el.value) || 0;
            else return;
            styleChanged(where);
        }

        function copyStyle(s) {
            return {palette: s.palette, range: s.range.slice(), adjust: Object.assign({}, s.adjust)};
        }

        function setLocked(on) {
            locked = on;
            if (!locked) ["a", "b"].forEach(function (n) { panes[n].style = copyStyle(shared); });
            var b = $("ta-compare-lock");
            b.classList.toggle("active", locked);
            b.setAttribute("aria-pressed", String(locked));
            b.innerHTML = locked ? '<i class="fa fa-lock"></i> Shared palette' : '<i class="fa fa-unlock"></i> Each pane its own';
            renderStyles();
            styleChanged("shared");
        }

        function setLinked(on) {
            linked = on;
            var b = $("ta-compare-link");
            b.classList.toggle("active", linked);
            b.setAttribute("aria-pressed", String(linked));
            b.innerHTML = linked ? '<i class="fa fa-link"></i> Linked' : '<i class="fa fa-unlink"></i> Unlinked';
            if (linked && panes.a.map && panes.b.map) panes.b.map.setView(panes.a.map.getCenter(), panes.a.map.getZoom(), {animate: false});
        }

        // ----- picking a point

        function setPicking(pane, on) {
            pane.picking = on;
            var b = pane.el.querySelector('[data-k="pick"]');
            b.classList.toggle("active", on);
            b.setAttribute("aria-pressed", String(on));
            pane.el.classList.toggle("ta-compare-picking", on);
        }

        // The source frames at a point of the pane: its mosaic's, or A's and B's for the difference
        function pick(pane, latlng) {
            var which = pane.diff ? [panes.a, panes.b] : [pane];
            var n = pane.picked = (pane.picked || 0) + 1;
            if (!pane.pickMarker) pane.pickMarker = L.circleMarker(latlng, PICKED).addTo(pane.map);
            else pane.pickMarker.setLatLng(latlng);
            return Promise.all(which.map(function (p) { return pointOf(p, latlng); })).then(function (results) {
                if (n !== pane.picked) return;
                pane.pick = {latlng: latlng, frames: results.map(function (res, i) {
                    return {pane: which[i], conv: which[i].conv, unit: which[i].info.unit, res: res};
                })};
                renderPick(pane);
            });
        }

        function closePick(pane) {
            pane.pick = null;
            pane.picked = (pane.picked || 0) + 1;
            if (pane.pickMarker) { pane.map.removeLayer(pane.pickMarker); pane.pickMarker = null; }
            var el = pane.el.querySelector(".ta-compare-pick");
            el.hidden = true;
            el.innerHTML = "";
            pane.map.invalidateSize();
        }

        function frameHtml(f, label) {
            var res = f.res, c = conversion(f.conv);
            var title = (label ? label + " · " : "") + (c ? c.dataset_name + " · " + c.name : "");
            var out = '<div class="ta-compare-frame"><div class="ta-compare-frame-title">' + esc(title) + "</div>";
            if (!res || !res.valid) return out + '<p class="ta-message">' + (res && res.reason === "outside_raster" ?
                "Outside the mosaic." : "No data here.") + "</p></div>";
            if (!res.frame) return out + '<p class="ta-message">No frame is known for this point.</p></div>';
            out += '<div class="ta-compare-frame-image"><img alt="' + esc(res.frame) + '" src="' +
                esc(frameImageUrl(API, f.conv, res.frame, temperatureStyle(f.pane), f.unit)) + '">' +
                (res.frame_pixel ? '<span class="ta-compare-mark" hidden></span>' : "") + "</div>";
            out += '<table class="table table-condensed ta-viewer-values"><tbody><tr><th>Temperature</th><td>' +
                esc(res.temperature === null || res.temperature === undefined ? "no data" : measure.temp(res.temperature, f.unit)) +
                "</td></tr><tr><th>Frame</th><td>" + esc(res.frame) + "</td></tr></tbody></table>";
            if (!res.frame_pixel) out += '<p class="ta-message">The pixel is not marked: build this conversion\'s mosaics again to know it.</p>';
            return out + '<a class="btn btn-default btn-xs" href="' + esc(frameUrl(f.conv) + encodeURIComponent(res.frame)) +
                '"><i class="fa fa-image"></i> Open this frame</a></div>';
        }

        // The mark on the frame's pixel, once the image's size is known
        function placeMark(img, pixel) {
            var mark = img.parentNode.querySelector(".ta-compare-mark");
            if (!mark || !pixel) return;
            var place = function () {
                if (!img.naturalWidth || !img.naturalHeight) return;
                mark.style.left = ((pixel[0] + 0.5) / img.naturalWidth * 100).toFixed(2) + "%";
                mark.style.top = ((pixel[1] + 0.5) / img.naturalHeight * 100).toFixed(2) + "%";
                mark.hidden = false;
            };
            if (img.complete && img.naturalWidth) place();
            else img.addEventListener("load", place);
        }

        function renderPick(pane) {
            var el = pane.el.querySelector(".ta-compare-pick"), p = pane.pick;
            if (!p) return;
            var wasHidden = el.hidden;
            el.innerHTML = '<div class="ta-compare-pick-head"><strong>Picked point</strong>' +
                '<button type="button" class="close" data-k="close" title="Close" aria-label="Close">&times;</button></div>' +
                '<div class="ta-compare-frames">' + p.frames.map(function (f, i) {
                    return frameHtml(f, pane.diff ? (i ? "B" : "A") : "");
                }).join("") + "</div>";
            el.hidden = false;
            var imgs = el.querySelectorAll(".ta-compare-frame-image img"), i = 0;
            p.frames.forEach(function (f) {
                if (f.res && f.res.valid && f.res.frame) placeMark(imgs[i++], f.res.frame_pixel);
            });
            if (wasHidden) pane.map.invalidateSize();
        }

        // ----- choosing what a pane shows

        function choose(pane, conv, tab) {
            pane.conv = conv;
            pane.tab = tab;
            return info(conv).then(function (d) {
                pane.info = d;
                if (!palettes.length) palettes = d.palettes || [];
            });
        }

        function renderHeads() {
            ["a", "b"].forEach(function (n) {
                var p = panes[n];
                p.el.querySelector('[data-k="mosaic"]').innerHTML = mosaicOptionsHtml(list, p.conv + ":" + p.tab);
                p.el.querySelector('[data-k="show"]').value = p.diff ? "diff" : "mosaic";
            });
        }

        function changed() {
            renderHeads();
            renderStyles();
            writeView();
            return drawAll().then(function () {
                ["a", "b"].forEach(function (n) {
                    var p = panes[n];
                    if (p.pick) pick(p, p.pick.latlng);
                });
            });
        }

        function onPaneControl(el, kind) {
            var box = el.closest("[data-pane]");
            if (!box || el.closest("[data-style]")) return false;
            var pane = panes[box.getAttribute("data-pane")], k = el.getAttribute("data-k");
            if (k === "mosaic" && kind === "change") {
                var parts = el.value.split(":");
                choose(pane, parseInt(parts[0], 10), parts[1]).then(changed, function () {
                    status("Could not load the mosaics.", "text-danger");
                });
            } else if (k === "show" && kind === "change") {
                pane.diff = el.value === "diff";
                if (pane.diff) other(pane).diff = false;
                changed();
            } else if (k === "pick" && kind === "click") {
                setPicking(pane, !pane.picking);
            } else if (k === "close" && kind === "click") {
                closePick(pane);
            } else return false;
            return true;
        }

        function bind() {
            page.addEventListener("change", function (e) {
                var el = e.target;
                if (!el.getAttribute || !el.getAttribute("data-k")) return;
                if (!onPaneControl(el, "change")) onStyle(el, "change");
            });
            page.addEventListener("input", function (e) {
                var el = e.target;
                if (el.type === "range") onStyle(el, "input");
            });
            page.addEventListener("click", function (e) {
                var el = e.target.closest ? e.target.closest("button[data-k]") : null;
                if (!el) return;
                if (!onPaneControl(el, "click")) onStyle(el, "click");
            });
            $("ta-compare-link").addEventListener("click", function () { setLinked(!linked); });
            $("ta-compare-lock").addEventListener("click", function () { setLocked(!locked); });
        }

        function firstTab(c, wantedTab, avoid) {
            if (wantedTab && c.tabs.indexOf(wantedTab) >= 0) return wantedTab;
            var others = c.tabs.filter(function (t) { return t !== avoid; });
            return (others.length ? others : c.tabs)[0];
        }

        function start() {
            status("Loading the mosaics…", "text-muted");
            return get(API + "conversions/" + pageId + "/comparable").then(function (r) {
                if (!r.ok) return status("Could not load the mosaics to compare.", "text-danger");
                list = r.data || [];
                var a = wanted.a !== undefined && conversion(wanted.a) || conversion(pageId);
                if (!a) return status("This conversion has no mosaics to compare.", "text-muted");
                var b = conversion(otherId) || a;
                var aTab = firstTab(a, wanted.a_tab);
                var bTab = b.id === a.id ? firstTab(b, wanted.b_tab, aTab) : firstTab(b, wanted.b_tab);
                return Promise.all([choose(panes.a, a.id, aTab), choose(panes.b, b.id, bTab)]).then(function () {
                    status("");
                    $("ta-compare-main").hidden = false;
                    panes.a.diff = wanted.diff === "a";
                    panes.b.diff = wanted.diff === "b";
                    shared = {palette: panes.a.info.default_palette, adjust: viewer.defaultAdjust(), range: null};
                    shared.range = autoFor("shared");
                    ["a", "b"].forEach(function (n) {
                        var p = panes[n];
                        p.el = $("ta-compare-" + n);
                        p.el.innerHTML = paneHtml(n);
                        setupMap(p);
                    });
                    applySplit();
                    renderHeads();
                    renderStyles();
                    var ta = tabEntry(panes.a), tb = tabEntry(panes.b);
                    if (ta && ta.bounds) panes.a.map.fitBounds([[ta.bounds[1], ta.bounds[0]], [ta.bounds[3], ta.bounds[2]]]);
                    if (tb && tb.bounds && !linked) panes.b.map.fitBounds([[tb.bounds[1], tb.bounds[0]], [tb.bounds[3], tb.bounds[2]]]);
                    else panes.b.map.setView(panes.a.map.getCenter(), panes.a.map.getZoom(), {animate: false});
                    writeView();
                    return drawAll();
                }, function () {
                    status("Could not load the mosaics.", "text-danger");
                });
            });
        }

        setupSplit();
        bind();
        return {ready: start(), panes: panes};
    }

    var api = {readCompare: readCompare, compareQuery: compareQuery, clampSplit: clampSplit, mosaicOptionsHtml: mosaicOptionsHtml,
               autoRange: autoRange, autoReach: autoReach, differenceTileUrl: differenceTileUrl, frameImageUrl: frameImageUrl,
               differenceReadoutHtml: differenceReadoutHtml, init: init};
    root.ThermalAnalyzerCompare = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});

if (typeof window !== "undefined" && window.document && window.fetch && window.L) {
    window.ThermalAnalyzerCompare.init({doc: document, fetchFn: window.fetch.bind(window), L: window.L,
                                        basemaps: JSON.parse((document.getElementById("ta-basemaps") || {}).textContent || "[]"),
                                        search: window.location.search});
}
