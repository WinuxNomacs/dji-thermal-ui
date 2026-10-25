// Measuring a conversion's mosaics and frames (viewer.js, frame.js): the spot, line, area, box and circle tools drawn
// on a Leaflet map, what the API measures of them (statistics, histogram, a line's profile, surroundings and ΔT, an
// isotherm's share), the isotherm, and the measurements saved on the conversion (compared, measured again with other
// parameters). Plain functions, and the drawing tool on its own.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var esc = function (t) { return core.escapeHtml(t); };
    var TOOLS = [["point", "Spot", "fa-crosshairs"], ["line", "Line", "fa-minus"], ["area", "Area", "fa-draw-polygon"],
                 ["box", "Box", "fa-vector-square"], ["circle", "Circle", "fa-circle"]];
    var ISOTHERM_MODES = [["", "None"], ["above", "Above"], ["below", "Below"], ["between", "Between"]];
    var SHAPE_LABELS = {Point: "Spot", LineString: "Line", Polygon: "Area"};
    // An area drawn by dragging (values.shape.kind)
    var DRAWN_LABELS = {box: "Box", circle: "Circle"};
    var TARGET_LABELS = {as_converted: "As converted", harmonized: "Harmonized", frame: "Frame"};
    var HINTS = {
        point: "Click a spot: its temperature is the mean of a small disc around it.",
        line: "Click the line's points; double-click the last one (or Finish) to end.",
        area: "Click the area's corners; double-click the last one (or Finish) to end.",
        box: "Drag from one corner to the opposite one.",
        circle: "Drag from the centre outwards."
    };
    var CIRCLE_VERTICES = 64;
    // A click this soon after a drag ended is the drag's own
    var DRAG_CLICK_MS = 400;

    // Values come in the conversion's unit (unit) and are shown in the user's: its symbol is the user's
    function symbol() { return core.unitSymbol(core.userUnit()); }

    function temp(v, unit, digits) { return core.formatTemp(v, unit, digits); }

    // A difference (a standard deviation): scaled to the user's unit, not shifted
    function delta(v, unit, digits) { return core.formatDelta(v, unit, digits); }

    // A difference, signed (ΔT, or the effect of the parameters changed)
    function signed(v, unit, digits) { return core.formatDelta(v, unit, digits, true); }

    // A temperature typed in the user's unit, in the conversion's, as the API takes it
    function typedTemp(x, unit) { return Math.round(core.convertTemp(x, core.userUnit(), unit) * 10000) / 10000; }

    // A stored temperature as the user would type it
    function shownTemp(x, unit) { return String(Math.round(core.convertTemp(x, unit) * 100) / 100); }

    function percent(share) {
        return share === null || share === undefined ? "" : core.formatNumber(share * 100, 1, " %");
    }

    // A drawing's vertices ([[x, y]], lon/lat or a frame's pixels) as the geometry the API takes, or null if too few
    function geometryOf(tool, coords) {
        if (!coords.length) return null;
        if (tool === "point") return {type: "Point", coordinates: coords[0]};
        if (tool === "line") return coords.length >= 2 ? {type: "LineString", coordinates: coords} : null;
        if (coords.length < 3) return null;
        return {type: "Polygon", coordinates: [coords.concat([coords[0]])]};
    }

    // The isotherm as the API takes it ("above,T", "below,T", "between,A,B"; "" for none), or {error}: a and b are
    // typed in the user's unit, the value is in the conversion's (unit)
    function isothermParam(mode, a, b, unit) {
        if (!mode) return {value: ""};
        var x = parseFloat(a), y = parseFloat(b);
        if (isNaN(x)) return {error: "The isotherm needs a temperature"};
        if (mode !== "between") return {value: mode + "," + typedTemp(x, unit)};
        if (isNaN(y)) return {error: "The isotherm needs two temperatures"};
        if (!(y > x)) return {error: "The second temperature must be above the first"};
        return {value: "between," + typedTemp(x, unit) + "," + typedTemp(y, unit)};
    }

    // A stored isotherm (in the conversion's unit) in the user's
    function isothermText(value, unit) {
        if (!value) return "";
        var p = String(value).split(",");
        if (p[0] === "between") return "between " + shownTemp(p[1], unit) + " and " + shownTemp(p[2], unit) + " " + symbol();
        return p[0] + " " + shownTemp(p[1], unit) + " " + symbol();
    }

    function toolbarHtml(tool, count) {
        var out = '<div class="btn-group ta-tools">' + TOOLS.map(function (t) {
            return '<button type="button" class="btn btn-default btn-sm' + (tool === t[0] ? " active" : "") + '" data-tool="' + t[0] +
                '"><i class="fa ' + t[2] + '"></i> ' + t[1] + "</button>";
        }).join("") + "</div>";
        if (tool) {
            out += '<div class="ta-tool-hint">' + esc(HINTS[tool]) + " " +
                (tool === "line" || tool === "area" ? '<button type="button" class="btn btn-primary btn-xs" data-tool-act="finish"' +
                    (count < (tool === "line" ? 2 : 3) ? " disabled" : "") + ">Finish</button> " : "") +
                '<button type="button" class="btn btn-default btn-xs" data-tool-act="cancel">Cancel</button></div>';
        }
        return out;
    }

    function isothermHtml(state) {
        var mode = state.mode || "";
        return '<div class="ta-isotherm">' +
            '<select class="form-control input-sm" id="ta-iso-mode">' + ISOTHERM_MODES.map(function (m) {
                return '<option value="' + m[0] + '"' + (m[0] === mode ? " selected" : "") + ">" + m[1] + "</option>";
            }).join("") + "</select>" +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-iso-a" value="' + esc(state.a === undefined ? "" : state.a) + '"' +
            (mode ? "" : " hidden") + ' title="Temperature">' +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-iso-b" value="' + esc(state.b === undefined ? "" : state.b) + '"' +
            (mode === "between" ? "" : " hidden") + ' title="Up to">' +
            (mode ? "<span>" + esc(symbol()) + "</span>" : "") + "</div>" +
            '<div class="text-danger" id="ta-iso-error"></div>' +
            (mode ? '<div class="ta-message">Its pixels keep the palette, the rest is grey.</div>' : "");
    }

    // A measure's figures, as rows of [label, value(s)]: a column per result (as converted, then changed) and their
    // difference when there are two
    function resultRows(results, unit, pixels) {
        var a = results[0];
        var rows = [];
        var units = pixels ? {length: " px", area: " px²"} : {length: " m", area: " m²"};
        // A size once when the results share it (the same shape), else each result's own (two compared)
        function size(label, key) {
            var vs = results.map(function (r) { return r[key] === undefined ? null : r[key]; });
            if (vs.every(function (v) { return v === null; })) return;
            if (vs.every(function (v) { return v === vs[0]; })) vs = [vs[0]];
            rows.push({label: label, values: vs.map(function (v) { return v === null ? "" : core.formatNumber(v, pixels ? 0 : 2, units[key]); })});
        }
        size("Length", "length");
        size("Area", "area");
        function figure(label, key, fmt, diffFmt) {
            var vs = results.map(function (r) { return r[key]; });
            if (vs.every(function (v) { return v === null || v === undefined; })) return;
            var row = {label: label, values: vs.map(fmt)};
            if (results.length === 2 && vs[0] !== null && vs[1] !== null && vs[0] !== undefined && vs[1] !== undefined) {
                row.difference = diffFmt(vs[1] - vs[0]);
            }
            rows.push(row);
        }
        var t = function (v) { return temp(v, unit); };
        var d = function (v) { return signed(v, unit); };
        figure("At the spot", "value", t, d);
        figure("Mean", "mean", t, d);
        if (a.kind !== "Point") {
            figure("Min", "min", t, d);
            figure("Max", "max", t, d);
        }
        figure("Std dev", "std", function (v) { return delta(v, unit); }, d);
        figure("Surroundings", "surroundings", t, d);
        figure("ΔT", "delta_t", d, d);
        var share = results.map(function (r) { return r.isotherm ? r.isotherm.share : null; });
        if (share.some(function (s) { return s !== null && s !== undefined; })) {
            rows.push({label: "In the isotherm", values: share.map(percent),
                       difference: results.length === 2 && share[0] !== null && share[1] !== null ?
                           (share[1] - share[0] > 0 ? "+" : "") + core.formatNumber((share[1] - share[0]) * 100, 1, " %") : undefined});
        }
        rows.push({label: "Pixels", values: results.map(function (r) { return String(r.valid_pixels || 0); })});
        return rows;
    }

    // What a measure's shape is called: a box or a circle (shape: how it was drawn), else its geometry's kind
    function shapeLabel(result, shape) {
        return (shape && DRAWN_LABELS[shape.kind]) || SHAPE_LABELS[(result || {}).kind] || "";
    }

    // What the API measured ({result, changed, approximate}) as a table; labels: the columns' names when changed;
    // shape: how an area was drawn (else the saved values'); pixels: lengths in pixels (a frame)
    function resultHtml(res, unit, opts) {
        opts = opts || {};
        var a = res && res.result;
        if (!a) return "";
        if (!a.valid_pixels) {
            return '<p class="ta-message">' + (a.reason === "outside_raster" ? "Outside the mosaic." : "No data there.") + "</p>";
        }
        var results = res.changed ? [a, res.changed] : [a];
        var labels = opts.labels || ["As converted", "Changed"];
        var head = results.length === 2 ? "<thead><tr><th></th><th>" + esc(labels[0]) + "</th><th>" + esc(labels[1]) +
            "</th><th>Difference</th></tr></thead>" : "";
        var body = resultRows(results, unit, opts.pixels).map(function (r) {
            return "<tr><th>" + esc(r.label) + "</th>" + r.values.map(function (v) { return "<td>" + esc(v) + "</td>"; }).join("") +
                (results.length === 2 ? "<td>" + esc(r.difference || "") + "</td>" : "") + "</tr>";
        }).join("");
        var kind = shapeLabel(a, opts.shape || res.shape);
        var out = (kind ? '<div class="ta-result-kind">' + esc(kind) + "</div>" : "") +
            '<table class="table table-condensed ta-viewer-values ta-result">' + head + "<tbody>" + body + "</tbody></table>";
        if (res.approximate) out += '<p class="ta-message"><i class="fa fa-info-circle"></i> Approximate: corrected for the parameters ' +
            "changed with the thermal correction model, not measured again by dji-thermal-cli.</p>";
        if (a.profile) out += profileSvg(a.profile, unit, res.changed && res.changed.profile, opts.pixels);
        return out + histogramSvg(a.histogram, unit, res.changed && res.changed.histogram);
    }

    function isValue(v) { return v !== null && v !== undefined && !isNaN(v); }

    function lengthText(v, pixels) { return core.formatNumber(v, pixels ? 0 : 1, pixels ? " px" : " m"); }

    // A line's profile ({distance, values, points, frames}: evenly spaced samples, null where there is no data) as an
    // SVG line chart, with its hottest and coldest samples, a cursor (moved by linkProfile) and, on a mosaic, the
    // frames each stretch was read from; other: a second profile (parameters changed) drawn over it
    function profileSvg(profile, unit, other, pixels) {
        if (!profile || !profile.values || profile.values.length < 2) return "";
        var W = 260, H = 80, PAD = 3, n = profile.values.length;
        var others = other && other.values && other.values.length === n ? other.values : null;
        var all = profile.values.concat(others || []).filter(isValue);
        if (!all.length) return '<p class="ta-message">No data along the line.</p>';
        var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
        if (hi === lo) { lo -= 0.5; hi += 0.5; }
        var x = function (i) { return i / (n - 1) * W; };
        var y = function (v) { return PAD + (hi - v) / (hi - lo) * (H - 2 * PAD); };
        // A line per stretch with data
        function path(values) {
            var d = "", on = false;
            values.forEach(function (v, i) {
                if (!isValue(v)) { on = false; return; }
                d += (on ? " L" : " M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
                on = true;
            });
            return d.trim();
        }
        var marks = "";
        [["ta-profile-max", Math.max], ["ta-profile-min", Math.min]].forEach(function (e) {
            var values = profile.values.filter(isValue);
            if (!values.length) return;
            var i = profile.values.indexOf(e[1].apply(null, values));
            marks += '<circle class="' + e[0] + '" cx="' + x(i).toFixed(1) + '" cy="' + y(profile.values[i]).toFixed(1) + '" r="2.5"></circle>';
        });
        var out = '<div class="ta-profile"><div class="ta-profile-chart"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" ' +
            'aria-label="Temperature along the line">' + '<path class="ta-profile-line" d="' + path(profile.values) + '"></path>' +
            (others ? '<path class="ta-profile-changed" d="' + path(others) + '"></path>' : "") + marks +
            '<line class="ta-profile-cursor" x1="0" x2="0" y1="0" y2="' + H + '" visibility="hidden"></line></svg>' +
            '<div class="ta-profile-temps"><span>' + esc(temp(hi, unit, 1)) + "</span><span>" + esc(temp(lo, unit, 1)) + "</span></div></div>" +
            '<div class="ta-histogram-axis"><span>0</span><span>' + esc(lengthText(profile.distance[n - 1], pixels)) + "</span></div>";
        if (profile.frames) out += framesStrip(profile.frames);
        return out + '<div class="ta-profile-readout ta-message">Move the cursor over the chart or the line.</div></div>';
    }

    // The frames a mosaic's profile was read from, as a strip of their stretches
    function framesStrip(frames) {
        var runs = [];
        frames.forEach(function (f) {
            var last = runs[runs.length - 1];
            if (last && last.frame === f) last.count++;
            else runs.push({frame: f, count: 1});
        });
        return '<div class="ta-profile-frames">' + runs.map(function (r, i) {
            var name = r.frame === null || r.frame === undefined ? "" : String(r.frame);
            return '<span class="' + (name ? "ta-profile-frame-" + (i % 2) : "ta-profile-frame-none") + '" style="width: ' +
                (r.count / frames.length * 100).toFixed(2) + '%" title="' + esc(name ? "Frame " + name.split("/").pop() : "No frame") + '"></span>';
        }).join("") + "</div>";
    }

    // The sample of a profile nearest a point ([x, y]: lon/lat, or a frame's pixels)
    function nearestIndex(points, coords, pixels) {
        var k = pixels ? 1 : Math.cos(coords[1] * Math.PI / 180), best = -1, bestD = Infinity;
        (points || []).forEach(function (p, i) {
            var dx = (p[0] - coords[0]) * k, dy = p[1] - coords[1], d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
        });
        return best;
    }

    // The profile chart in el (as resultHtml drew it from res) followed by the cursor: its sample's distance,
    // temperature (and changed one) and frame shown, onIndex(i) told (null when the cursor leaves). Returns
    // {show(i), near(coords)} for the map's side (null hides the cursor).
    function linkProfile(el, res, unit, pixels, onIndex) {
        var a = res && res.result, profile = a && a.profile;
        var svg = el && el.querySelector(".ta-profile svg");
        if (!profile || !svg) return null;
        var n = profile.values.length, cursor = svg.querySelector(".ta-profile-cursor");
        var readout = el.querySelector(".ta-profile-readout"), other = res.changed && res.changed.profile;
        function show(i) {
            if (i === null || i < 0) {
                cursor.setAttribute("visibility", "hidden");
                readout.textContent = "Move the cursor over the chart or the line.";
                return;
            }
            var px = (i / (n - 1) * 260).toFixed(1);
            cursor.setAttribute("x1", px);
            cursor.setAttribute("x2", px);
            cursor.setAttribute("visibility", "visible");
            var v = profile.values[i], parts = [lengthText(profile.distance[i], pixels), isValue(v) ? temp(v, unit) : "no data"];
            if (other && other.values && isValue(other.values[i])) parts.push("changed " + temp(other.values[i], unit));
            if (profile.frames && profile.frames[i]) parts.push(String(profile.frames[i]).split("/").pop());
            readout.textContent = parts.join(" · ");
        }
        svg.addEventListener("mousemove", function (e) {
            var box = svg.getBoundingClientRect(), f = box.width ? (e.clientX - box.left) / box.width : 0;
            var i = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
            show(i);
            if (onIndex) onIndex(i);
        });
        svg.addEventListener("mouseleave", function () {
            show(null);
            if (onIndex) onIndex(null);
        });
        return {show: show, near: function (coords) { show(coords ? nearestIndex(profile.points, coords, pixels) : null); }};
    }

    // A histogram ([counts, edges]) as an SVG bar chart; other: a second one drawn over it as a line, on the same scale
    function histogramSvg(hist, unit, other) {
        if (!hist || !hist[0] || !hist[0].length) return "";
        var W = 260, H = 64;
        var all = [hist].concat(other && other[0] ? [other] : []);
        var lo = Math.min.apply(null, all.map(function (h) { return h[1][0]; }));
        var hi = Math.max.apply(null, all.map(function (h) { return h[1][h[1].length - 1]; }));
        var top = Math.max.apply(null, all.map(function (h) { return Math.max.apply(null, h[0]); })) || 1;
        var x = function (v) { return hi > lo ? (v - lo) / (hi - lo) * W : 0; };
        var y = function (n) { return H - n / top * H; };
        var bars = hist[0].map(function (n, i) {
            var x0 = x(hist[1][i]), x1 = x(hist[1][i + 1]);
            return '<rect x="' + x0.toFixed(1) + '" y="' + y(n).toFixed(1) + '" width="' + Math.max(0.5, x1 - x0).toFixed(1) +
                '" height="' + (H - y(n)).toFixed(1) + '"></rect>';
        }).join("");
        var line = "";
        if (other && other[0]) {
            var pts = [];
            other[0].forEach(function (n, i) {
                pts.push(x(other[1][i]).toFixed(1) + "," + y(n).toFixed(1));
                pts.push(x(other[1][i + 1]).toFixed(1) + "," + y(n).toFixed(1));
            });
            line = '<polyline class="ta-histogram-changed" points="' + pts.join(" ") + '"></polyline>';
        }
        return '<div class="ta-histogram"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Histogram">' +
            '<g class="ta-histogram-bars">' + bars + "</g>" + line + "</svg>" +
            '<div class="ta-histogram-axis"><span>' + esc(temp(lo, unit, 1)) + "</span><span>" + esc(temp(hi, unit, 1)) + "</span></div></div>";
    }

    function targetLabel(m) {
        if (m.target === "frame") return "Frame " + String(m.frame || "").split("/").pop();
        return TARGET_LABELS[m.target] || m.target;
    }

    // A measurement's own parameters (in the conversion's unit) as text; fields: [[key, label, step, isTemp]]
    function paramsText(parameters, fields, unit) {
        var p = parameters || {};
        return fields.filter(function (f) { return p[f[0]] !== null && p[f[0]] !== undefined; }).map(function (f) {
            return f[1].toLowerCase() + " " + (f[3] ? shownTemp(p[f[0]], unit) + " " + symbol() : String(p[f[0]]));
        }).join(", ");
    }

    // The form measuring a saved measurement again with other parameters: a field each, empty for the conversion's own
    function paramsFormHtml(m, fields, unit) {
        var p = m.parameters || {};
        return '<div class="ta-params-form" data-params-form="' + m.id + '">' + fields.map(function (f) {
            var v = p[f[0]] === null || p[f[0]] === undefined ? "" : (f[3] ? shownTemp(p[f[0]], unit) : String(p[f[0]]));
            return '<label>' + esc(f[1]) + (f[3] ? " (" + esc(symbol()) + ")" : "") +
                ' <input type="number" class="form-control input-sm" step="' + f[2] + '" data-param-field="' + f[0] +
                '" value="' + esc(v) + '" placeholder="As converted"></label>';
        }).join("") + '<div class="text-danger" data-params-error></div>' +
            '<button type="button" class="btn btn-primary btn-xs" data-params-act="save" data-id="' + m.id + '">Measure again</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-params-act="cancel" data-id="' + m.id + '">Cancel</button></div>';
    }

    // Two saved measurements side by side, with their difference (b - a)
    function comparisonHtml(a, b, unit) {
        var ra = (a.values || {}).result, rb = (b.values || {}).result;
        if (!ra || !rb) return "";
        var rows = resultRows([ra, rb], unit, a.target === "frame");
        return '<div class="ta-compare"><table class="table table-condensed ta-viewer-values ta-result"><thead><tr><th></th><th>' +
            esc(a.name) + "</th><th>" + esc(b.name) + "</th><th>Difference</th></tr></thead><tbody>" + rows.map(function (r) {
                return "<tr><th>" + esc(r.label) + "</th>" + [0, 1].map(function (i) {
                    return "<td>" + esc(r.values[i] === undefined ? "" : r.values[i]) + "</td>";
                }).join("") + "<td>" + esc(r.difference || "") + "</td></tr>";
            }).join("") + "</tbody></table></div>";
    }

    // The saved measurements' list: a line each with its name, where it was measured and its main figure.
    // opts: {compared: [ids] (ticked to compare, two at most), editing: the id whose parameters are being changed,
    // fields: the parameters one can change ([[key, label, step, isTemp]])}
    function measurementsHtml(items, unit, current, opts) {
        opts = opts || {};
        if (!items || !items.length) return '<p class="ta-message">No measurements saved yet.</p>';
        var compared = opts.compared || [], fields = opts.fields || [];
        var out = '<ul class="ta-measurements">' + items.map(function (m) {
            // A frame's measurement measured again keeps the frame as converted in result, its own in changed
            var r = (m.values || {}).changed || (m.values || {}).result || {};
            var figure = r.kind === "Point" ? temp(r.value !== null && r.value !== undefined ? r.value : r.mean, unit, 1) :
                temp(r.mean, unit, 1) + (r.delta_t !== null && r.delta_t !== undefined ? ", ΔT " + signed(r.delta_t, unit, 1) : "");
            var params = paramsText(m.parameters, fields, unit);
            return '<li class="' + (m.id === current ? "active" : "") + '" data-measurement="' + m.id + '">' +
                '<input type="checkbox" data-compare="' + m.id + '" title="Compare"' + (compared.indexOf(m.id) >= 0 ? " checked" : "") + "> " +
                '<a href="#" data-show="' + m.id + '"><strong>' + esc(m.name) + "</strong></a> " +
                '<span class="text-muted">' + esc(shapeLabel(r, (m.values || {}).shape)) + " · " + esc(targetLabel(m)) + "</span>" +
                '<div class="ta-measurement-figure">' + esc(figure) + "</div>" +
                (params ? '<div class="ta-measurement-params text-muted">Measured with ' + esc(params) + "</div>" : "") +
                ((fields.length ? '<button type="button" class="btn btn-link btn-xs" data-params="' + m.id + '" title="Measure again with other parameters"><i class="fa fa-sliders-h"></i></button>' : "") +
                 '<button type="button" class="btn btn-link btn-xs" data-rename="' + m.id + '" title="Rename"><i class="fa fa-pencil-alt"></i></button>' +
                 '<button type="button" class="btn btn-link btn-xs" data-delete="' + m.id + '" title="Delete"><i class="fa fa-trash"></i></button>') +
                (opts.editing === m.id ? paramsFormHtml(m, fields, unit) : "") +
                "</li>";
        }).join("") + "</ul>";
        var picked = compared.map(function (id) {
            return items.filter(function (m) { return m.id === id; })[0];
        }).filter(Boolean);
        if (picked.length === 2) out += comparisonHtml(picked[0], picked[1], unit);
        else if (items.length >= 2) out += '<p class="ta-message">Tick two to compare them.</p>';
        return out;
    }

    // The ids compared once id is ticked (on) or unticked: two at most, a third dropping the first ticked
    function toggleCompared(compared, id, on) {
        var out = (compared || []).filter(function (x) { return x !== id; });
        if (on) out.push(id);
        return out.slice(-2);
    }

    // A box's corners from two opposite ones
    function boxCoords(a, b) { return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; }

    // A circle's vertices around c ([x, y]) through e, as a polygon's, and its radius in the map's distance (metres
    // on a mosaic, pixels on a frame): distance(c, d) -> how far apart two points are
    function circleCoords(c, e, distance) {
        var dx = Math.abs(e[0] - c[0]), dy = Math.abs(e[1] - c[1]), d = Math.max(dx, dy);
        var r = distance(c, e);
        if (!d || !r) return null;
        // How far a unit along each axis goes, to draw the circle round where the axes' scales differ (lon/lat)
        var sx = distance(c, [c[0] + d, c[1]]) / d, sy = distance(c, [c[0], c[1] + d]) / d;
        if (!sx) sx = sy;
        if (!sy) sy = sx;
        var coords = [];
        for (var i = 0; i < CIRCLE_VERTICES; i++) {
            var a = i / CIRCLE_VERTICES * 2 * Math.PI;
            coords.push([c[0] + r * Math.cos(a) / sx, c[1] + r * Math.sin(a) / sy]);
        }
        return {coords: coords, radius: r};
    }

    // The spot, line, area, box and circle tools on a Leaflet map. opts: {L, map, toCoords(latlng) -> [x, y],
    // fromCoords([x, y]) -> latlng, onDone(geometry, shape) (shape: how a box or circle was drawn), onChange() (a
    // vertex added: redraw the toolbar), onClick(e) (a click while no tool is on), onLineHover(coords) (the cursor
    // over a shown line, null when it leaves), pixels (a frame: lengths in pixels)}
    function Drawing(opts) {
        var L = opts.L, map = opts.map, tool = null, points = [], drag = null, dragEnded = 0;
        var preview = L.layerGroup().addTo(map), shown = L.layerGroup().addTo(map), cursor = L.layerGroup().addTo(map);
        var STYLE = {color: "#00e5ff", weight: 2, fillOpacity: 0.1};
        // What is being drawn lets clicks through to the map: the browser fires a double click only when both of its
        // clicks reach the same element, and the first one draws a vertex under the cursor
        var PREVIEW = {color: STYLE.color, weight: STYLE.weight, fillOpacity: STYLE.fillOpacity, interactive: false};

        function dragged(t) { return t === "box" || t === "circle"; }

        function distance(a, b) { return map.distance(opts.fromCoords(a), opts.fromCoords(b)); }

        function setDragging(on) {
            if (map.dragging) map.dragging[on ? "enable" : "disable"]();
        }

        // What a drag from a to b draws: {geometry, shape, size} (size: its width and height, or its radius), or null
        function dragShape(a, b) {
            if (tool === "box") {
                if (a[0] === b[0] || a[1] === b[1]) return null;
                var corners = boxCoords(a, b);
                return {geometry: geometryOf("area", corners), shape: {kind: "box"},
                        size: lengthText(distance(corners[0], corners[1]), opts.pixels) + " × " + lengthText(distance(corners[1], corners[2]), opts.pixels)};
            }
            var circle = circleCoords(a, b, distance);
            if (!circle) return null;
            return {geometry: geometryOf("area", circle.coords), shape: {kind: "circle", center: a, radius: circle.radius},
                    size: "radius " + lengthText(circle.radius, opts.pixels)};
        }

        function latlngs(coords) { return coords.map(opts.fromCoords); }

        function redraw() {
            preview.clearLayers();
            if (!tool) return;
            if (points.length > 1) (tool === "area" ? L.polygon : L.polyline)(latlngs(points), PREVIEW).addTo(preview);
            points.forEach(function (p) { L.circleMarker(opts.fromCoords(p), {radius: 3, color: STYLE.color, interactive: false}).addTo(preview); });
        }

        function setDoubleClickZoom(on) {
            if (map.doubleClickZoom) map.doubleClickZoom[on ? "enable" : "disable"]();
        }

        function start(t) {
            tool = t;
            points = [];
            drag = null;
            setDoubleClickZoom(false);
            setDragging(!dragged(t));
            redraw();
        }

        function stop() {
            tool = null;
            points = [];
            drag = null;
            setDoubleClickZoom(true);
            setDragging(true);
            redraw();
        }

        function finish() {
            var g = geometryOf(tool, points);
            if (!g) return false;
            stop();
            opts.onDone(g);
            return true;
        }

        map.on("mousedown", function (e) {
            if (!dragged(tool)) return;
            drag = {from: opts.toCoords(e.latlng), shape: null};
        });
        map.on("mousemove", function (e) {
            if (!drag) return;
            drag.shape = dragShape(drag.from, opts.toCoords(e.latlng));
            preview.clearLayers();
            if (!drag.shape) return;
            var p = L.polygon(latlngs(drag.shape.geometry.coordinates[0].slice(0, -1)), STYLE).addTo(preview);
            if (p.bindTooltip) p.bindTooltip(drag.shape.size, {permanent: true, direction: "center"});
        });
        map.on("mouseup", function (e) {
            if (!drag) return;
            var d = dragShape(drag.from, opts.toCoords(e.latlng)) || drag.shape;
            drag = null;
            dragEnded = Date.now();
            preview.clearLayers();
            // A click, or a drag too small to make a shape, keeps the tool on
            if (!d) return;
            stop();
            opts.onDone(d.geometry, d.shape);
        });

        map.on("click", function (e) {
            if (Date.now() - dragEnded < DRAG_CLICK_MS) return;
            if (!tool) return opts.onClick && opts.onClick(e);
            if (dragged(tool)) return;
            points.push(opts.toCoords(e.latlng));
            if (tool === "point") return finish();
            redraw();
            if (opts.onChange) opts.onChange();
        });
        map.on("dblclick", function () {
            if (!tool || tool === "point") return;
            // The double click's own two clicks each added the same last point
            if (points.length > 1) points.pop();
            if (!finish()) redraw();
        });

        // A measured geometry on the map, with its hottest and coldest pixels
        function show(geometry, result, unit) {
            shown.clearLayers();
            if (!geometry) return;
            if (geometry.type === "Point") {
                L.circleMarker(opts.fromCoords(geometry.coordinates), {radius: 6, color: STYLE.color, weight: 2}).addTo(shown);
            } else if (geometry.type === "LineString") {
                L.polyline(latlngs(geometry.coordinates), STYLE).addTo(shown);
                if (opts.onLineHover) {
                    // A wider, invisible line, easier to point at
                    var hover = L.polyline(latlngs(geometry.coordinates), {weight: 14, opacity: 0}).addTo(shown);
                    hover.on("mousemove", function (e) { opts.onLineHover(opts.toCoords(e.latlng)); });
                    hover.on("mouseout", function () { opts.onLineHover(null); });
                }
            } else {
                L.polygon(latlngs(geometry.coordinates[0].slice(0, -1)), STYLE).addTo(shown);
            }
            if (!result || geometry.type === "Point") return;
            [["max_location", "max", "#ff1744", "Hottest"], ["min_location", "min", "#2979ff", "Coldest"]].forEach(function (e) {
                if (!result[e[0]]) return;
                var m = L.circleMarker(opts.fromCoords(result[e[0]]), {radius: 5, color: "#fff", weight: 1, fillColor: e[2], fillOpacity: 1});
                if (m.bindTooltip) m.bindTooltip(e[3] + ": " + temp(result[e[1]], unit));
                m.addTo(shown);
            });
        }

        // A marker on the shown line where the profile's cursor is (coords: [x, y]; null hides it)
        function showCursor(coords) {
            cursor.clearLayers();
            if (coords) L.circleMarker(opts.fromCoords(coords), {radius: 5, color: "#fff", weight: 2, fillColor: "#ffea00", fillOpacity: 1}).addTo(cursor);
        }

        return {start: start, stop: stop, finish: finish, show: show, showCursor: showCursor,
                clear: function () { shown.clearLayers(); cursor.clearLayers(); },
                tool: function () { return tool; }, count: function () { return points.length; }};
    }

    // Whether a key went to a field being typed in (where it is the field's own)
    function inField(el) {
        return !!(el && el.closest && el.closest("input, select, textarea"));
    }

    // Enter finishes the shape being drawn and Esc cancels it (not while typing in a field): true when the key was used
    function drawingKey(e, drawing) {
        if (!drawing || !drawing.tool() || inField(e.target) || e.altKey || e.ctrlKey || e.metaKey) return false;
        if (e.key === "Enter") drawing.finish();
        else if (e.key === "Escape") drawing.stop();
        else return false;
        if (e.preventDefault) e.preventDefault();
        return true;
    }

    var api = {symbol: symbol, temp: temp, delta: delta, signed: signed, typedTemp: typedTemp, shownTemp: shownTemp, geometryOf: geometryOf, isothermParam: isothermParam,
               isothermText: isothermText, toolbarHtml: toolbarHtml, isothermHtml: isothermHtml, resultRows: resultRows,
               resultHtml: resultHtml, histogramSvg: histogramSvg, targetLabel: targetLabel, shapeLabel: shapeLabel,
               profileSvg: profileSvg, linkProfile: linkProfile, nearestIndex: nearestIndex, boxCoords: boxCoords, circleCoords: circleCoords,
               paramsText: paramsText, paramsFormHtml: paramsFormHtml, comparisonHtml: comparisonHtml, toggleCompared: toggleCompared,
               measurementsHtml: measurementsHtml, Drawing: Drawing, inField: inField, drawingKey: drawingKey};
    root.ThermalAnalyzerMeasure = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
