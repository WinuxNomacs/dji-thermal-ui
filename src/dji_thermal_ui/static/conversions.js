// A thermal dataset's Convert tab: dji-thermal-cli's settings (starting from the user's saved preferences, which can be
// saved or reset to the defaults), converting with them, and the dataset's conversions side by side, each with its
// settings, the files written and its downloads.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var esc = function (t) { return core.escapeHtml(t); };

    var STATUS_LABELS = {converting: "Converting", ready: "Converted", failed: "Failed", canceled: "Canceled"};
    var DISTANCE_MODES = [["lrf", "The rangefinder's, where it measured (else embedded)"], ["embedded", "Embedded in each image"],
                          ["fixed", "Fixed"]];
    var UNIT_LABELS = {C: "°C", F: "°F", K: "K"};
    // The measurement parameters with the analysis' column of each image's recorded value (Celsius for temperatures)
    var MEASUREMENTS = [
        {key: "humidity", label: "Relative humidity", unit: "%", hint: "humidity", digits: 0},
        {key: "emissivity", label: "Emissivity", hint: "emissivity", digits: 2, step: "0.01"},
        {key: "reflected_temp", label: "Reflected temperature", hint: "reflection", temperature: true},
        {key: "ambient_temp", label: "Ambient temperature", hint: "ambient", temperature: true}
    ];
    var GIMBAL = [["gimbal_yaw", "Yaw"], ["gimbal_pitch", "Pitch"], ["gimbal_roll", "Roll"]];
    var RESULTS_SHOWN = 500;   // files listed in a conversion's results

    // The settings that are temperatures (in the settings' unit, the files'): the form shows them in the user's
    var TEMPERATURES = ["reflected_temp", "ambient_temp", "range_min", "range_max", "replace_above", "replace_above_value",
                        "replace_below", "replace_below_value"];

    // Settings with their temperatures from one unit to another ("nodata" kept)
    function settingsIn(s, from, to) {
        var out = Object.assign({}, s);
        TEMPERATURES.forEach(function (k) {
            if (typeof out[k] === "number") out[k] = Math.round(core.convertTemp(out[k], from, to) * 10000) / 10000;
        });
        return out;
    }

    // What the flight recorded (medians of its thermal frames), shown beside each measurement parameter
    function recorded(analysis) {
        var thermal = ((analysis || {}).files || []).filter(function (f) { return f.kind === "thermal"; });
        var out = {};
        ["distance", "lrf", "humidity", "emissivity", "reflection", "ambient"].forEach(function (k) {
            out[k] = core.median(thermal.map(function (f) { return f[k]; }));
        });
        // The images' own palettes, the most used first: [[name, frames]]
        var counts = {};
        thermal.forEach(function (f) { if (f.palette) counts[f.palette] = (counts[f.palette] || 0) + 1; });
        out.palettes = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
        return out;
    }

    function blank(v) { return v === null || v === undefined || v === ""; }
    function value(v) { return blank(v) ? "" : String(v); }

    function numberInput(key, v, attrs) {
        return '<input type="number" class="form-control input-sm" name="' + key + '" value="' + esc(value(v)) + '"' + (attrs || "") + ">";
    }

    function field(label, html, help) {
        return '<div class="form-group ta-field"><label>' + esc(label) + "</label>" + html +
            (help ? '<span class="help-block">' + help + "</span>" : "") + "</div>";
    }

    function recordedText(v, digits, unit) {
        return blank(v) ? "not recorded" : "recorded " + core.formatNumber(v, digits === undefined ? 1 : digits, unit || "");
    }

    // The settings form, its temperatures in the user's unit. meta: {products, palettes}; rec: recorded(analysis), in °C
    function formHtml(s, meta, rec) {
        rec = rec || {};
        var unit = core.unitOf(s.unit || core.userUnit()), u = core.unitSymbol(core.userUnit());
        var shown = settingsIn(s, unit, core.userUnit());
        TEMPERATURES.forEach(function (k) { if (typeof shown[k] === "number") shown[k] = Math.round(shown[k] * 100) / 100; });
        s = shown;
        var outputs = s.outputs || [];
        var chosen = {};
        outputs.forEach(function (o) { var p = o.split(":"); chosen[p[0]] = p[1]; });

        var products = (meta.products || []).map(function (p) {
            var on = chosen[p.product] !== undefined;
            return '<div class="ta-output"><label class="checkbox-inline" title="' + esc(p.description) + '"><input type="checkbox" name="output" value="' +
                esc(p.product) + '"' + (on ? " checked" : "") + "> <code>" + esc(p.product) + "</code></label> " +
                '<select class="form-control input-sm" name="format-' + esc(p.product) + '">' + p.formats.map(function (f) {
                    return '<option value="' + esc(f) + '"' + (chosen[p.product] === f ? " selected" : "") + ">" + esc(f.toUpperCase()) + "</option>";
                }).join("") + '</select> <span class="text-muted">' + esc(p.description) + "</span></div>";
        }).join("");

        var fixed = typeof s.distance === "number";
        var distanceHelp = "Embedded " + (blank(rec.distance) ? "not recorded" : core.formatNumber(rec.distance, 1, " m")) +
            ", rangefinder " + (blank(rec.lrf) ? "not recorded" : core.formatNumber(rec.lrf, 1, " m")) + " (medians)";
        var measurement = field("Distance to the target",
            '<div class="ta-inline"><select class="form-control input-sm" name="distance_mode">' + DISTANCE_MODES.map(function (m) {
                var sel = fixed ? m[0] === "fixed" : m[0] === s.distance;
                return '<option value="' + m[0] + '"' + (sel ? " selected" : "") + ">" + esc(m[1]) + "</option>";
            }).join("") + "</select>" + numberInput("distance", fixed ? s.distance : "", ' step="0.1" min="0.1" placeholder="m"' + (fixed ? "" : " hidden")) +
            "</div>", esc(distanceHelp)) +
            MEASUREMENTS.map(function (m) {
                var hint = m.temperature ? core.convertTemp(rec[m.hint], "C") : rec[m.hint];
                var label = m.label + (m.temperature ? " (" + u + ")" : m.unit ? " (" + m.unit + ")" : "");
                return field(label, numberInput(m.key, s[m.key], ' step="' + (m.step || "any") + '" placeholder="each image\'s own"'),
                    esc(recordedText(hint, m.digits, m.temperature ? " " + u : m.unit ? " " + m.unit : "")));
            }).join("") +
            field("Unit of the files", '<select class="form-control input-sm" name="unit">' + ["C", "F", "K"].map(function (k) {
                return '<option value="' + k + '"' + (k === unit ? " selected" : "") + ">" + UNIT_LABELS[k] + "</option>";
            }).join("") + "</select>", "What the temperature TIFFs and mosaics are written in. The temperatures here are in yours (" + esc(u) + ").");

        var own = rec.palettes || [];
        var ownText = own.length === 1 ? " (" + own[0][0] + ")" : own.length ? " (" + own.map(function (p) { return p[0] + " on " + p[1]; }).join(", ") + ")" : "";
        var look = field("Palette", '<select class="form-control input-sm" name="palette"><option value="">Each image\'s own' + esc(ownText) + "</option>" +
                (meta.palettes || []).map(function (p) {
                    return '<option value="' + esc(p) + '"' + (p === s.palette ? " selected" : "") + ">" + esc(p) + "</option>";
                }).join("") + "</select>", "The colours of the pseudo outputs, and those the mosaics open with.") +
            field("Colour range (" + u + ")", '<div class="ta-inline">' + numberInput("range_min", s.range_min, ' step="any" placeholder="from"') +
                numberInput("range_max", s.range_max, ' step="any" placeholder="to"') + "</div>",
                "Both, or neither for each image's own range. Also the range of the gray16 outputs.");

        var frames = '<div class="checkbox"><label><input type="checkbox" name="normalize"' + (s.normalize ? " checked" : "") +
                "> Normalize: make the frames' temperatures consistent with each other</label>" +
                '<span class="help-block">One ambient and reflected temperature for every frame, and each frame\'s drift against its ' +
                "overlapping neighbours removed. Recommended for processing into a map.</span></div>" +
            field("Only frames with a gimbal pitch at or below (°)", numberInput("max_pitch", s.max_pitch, ' step="1" min="-90" max="90" placeholder="all frames"'),
                "-80 keeps the nadir frames only.");

        var adjust = field("Gimbal override (°)", '<div class="ta-inline">' + GIMBAL.map(function (g) {
                return numberInput(g[0], s[g[0]], ' step="any" placeholder="' + g[1] + '" title="' + g[1] + '"');
            }).join("") + "</div>", "Replaces the recorded gimbal angles in every output's metadata.") +
            ["above", "below"].map(function (side) {
                var v = s["replace_" + side + "_value"];
                var nodata = v === "nodata";
                return field("Replace temperatures " + side + " (" + u + ")", '<div class="ta-inline">' +
                    numberInput("replace_" + side, s["replace_" + side], ' step="any" placeholder="threshold"') +
                    numberInput("replace_" + side + "_value", nodata ? "" : v, ' step="any" placeholder="with"' + (nodata ? " disabled" : "")) +
                    '<label class="checkbox-inline"><input type="checkbox" name="replace_' + side + '_nodata"' + (nodata ? " checked" : "") + "> with no data</label></div>");
            }).join("") +
            '<div class="checkbox"><label><input type="checkbox" name="strip_location"' + (s.strip_location ? " checked" : "") +
            "> Strip the location and identifiers from the outputs</label></div>";

        return '<div class="ta-section"><h4>Colours</h4>' + look + "</div>" +
            '<div class="ta-section"><h4>Outputs</h4>' + products +
            field("Compression (TIFF)", '<select class="form-control input-sm" name="compression">' + ["deflate", "none"].map(function (c) {
                return '<option value="' + c + '"' + (c === s.compression ? " selected" : "") + ">" + c + "</option>";
            }).join("") + "</select>") +
            '<div class="checkbox"><label><input type="checkbox" name="mosaics"' + (s.mosaics ? " checked" : "") +
                "> Build the mosaics: as converted and harmonized, to view on a map</label>" +
                '<span class="help-block">From the nadir frames, after the images. About a minute and a half each on a 200-frame flight.</span></div>' +
            "</div>" +
            '<details class="ta-section" open><summary><h4>Measurement</h4></summary><p class="text-muted">Empty keeps each image\'s own value.</p>' + measurement + "</details>" +
            '<details class="ta-section" open><summary><h4>Frames</h4></summary>' + frames + "</details>" +
            '<details class="ta-section"' + (!blank(s.gimbal_yaw) || !blank(s.gimbal_pitch) || !blank(s.gimbal_roll) || !blank(s.replace_above) ||
                !blank(s.replace_below) || s.strip_location ? " open" : "") + '><summary><h4>Adjustments</h4></summary>' + adjust + "</details>";
    }

    // The settings as the form shows them ("" for an empty number: the server keeps the embedded value), the temperatures
    // typed in the user's unit given in the files'
    function readForm(form) {
        var get = function (name) { return form.querySelector('[name="' + name + '"]'); };
        var num = function (name) { var el = get(name); return el && el.value !== "" ? Number(el.value) : null; };
        var s = {};
        var mode = get("distance_mode").value;
        s.distance = mode === "fixed" ? num("distance") : mode;
        if (mode === "fixed" && s.distance === null) s.distance = "";
        MEASUREMENTS.forEach(function (m) { s[m.key] = num(m.key); });
        s.unit = get("unit").value;
        s.palette = get("palette").value || null;
        s.range_min = num("range_min");
        s.range_max = num("range_max");
        GIMBAL.forEach(function (g) { s[g[0]] = num(g[0]); });
        ["above", "below"].forEach(function (side) {
            s["replace_" + side] = num("replace_" + side);
            s["replace_" + side + "_value"] = get("replace_" + side + "_nodata").checked ? "nodata" : num("replace_" + side + "_value");
        });
        s.strip_location = get("strip_location").checked;
        s.normalize = get("normalize").checked;
        s.mosaics = get("mosaics").checked;
        s.max_pitch = num("max_pitch");
        s.compression = get("compression").value;
        s.outputs = [].filter.call(form.querySelectorAll('input[name="output"]'), function (c) { return c.checked; }).map(function (c) {
            return c.value + ":" + get("format-" + c.value).value;
        });
        return settingsIn(s, core.userUnit(), s.unit);
    }

    // The settings of the WebODM plan's process command (its arguments, as dji-thermal-cli's CLI takes them), on the defaults
    var PLAN_NUMBERS = {"--max-pitch": "max_pitch", "--emissivity": "emissivity", "--humidity": "humidity",
                        "--reflected-temp": "reflected_temp", "--ambient-temp": "ambient_temp"};
    function planSettings(args, defaults) {
        var s = JSON.parse(JSON.stringify(defaults || {}));
        var outputs = [], planUnit = "C", given = {};
        for (var i = 0; i < (args || []).length; i++) {
            var a = args[i], next = args[i + 1];
            if (a === "-o" || a === "--outputs") {
                String(next).split(",").forEach(function (o) {
                    if (o) outputs.push(o.indexOf(":") < 0 ? o : o.replace(/:tif$/, ":tiff"));
                });
                i++;
            } else if (a === "--normalize") {
                s.normalize = true;
            } else if (a === "--distance") {
                s.distance = isNaN(Number(next)) ? next : Number(next);
                i++;
            } else if (a === "--unit") {
                planUnit = core.unitOf(String(next).toUpperCase());
                i++;
            } else if (PLAN_NUMBERS[a]) {
                given[PLAN_NUMBERS[a]] = Number(next);
                i++;
            }
        }
        if (outputs.length) s.outputs = outputs;
        return Object.assign(s, settingsIn(given, planUnit, s.unit || "C"));
    }

    // What stops the settings from being sent, or null
    function formProblem(s) {
        if (s.distance === "") return "Enter the distance to the target, or choose another distance.";
        if (!s.outputs.length) return "Choose at least one output.";
        if ((s.range_min === null) !== (s.range_max === null)) return "Give both ends of the colour range, or neither.";
        return null;
    }

    function round2(v) { return typeof v === "number" ? Math.round(v * 100) / 100 : v; }
    function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
    function num(v, digits) { return String(Number(Number(v).toFixed(digits === undefined ? 2 : digits))); }

    // Outputs alike as sets, an output without a format (the plan's "pseudo") alike with any format of its product
    function sameOutputs(a, b) {
        var products = function (list) {
            var out = {};
            (list || []).forEach(function (o) { var p = o.split(":"); out[p[0]] = p[1] || "*"; });
            return out;
        };
        var pa = products(a), pb = products(b);
        var ka = Object.keys(pa).sort(), kb = Object.keys(pb).sort();
        return same(ka, kb) && ka.every(function (k) { return pa[k] === "*" || pb[k] === "*" || pa[k] === pb[k]; });
    }

    // The settings told apart in the summaries: each with its form fields and its text (u: the temperatures' unit symbol)
    var DIFFERENCES = [
        {key: "outputs", fields: ["output"], same: sameOutputs, text: function (s) { return (s.outputs || []).join(", ") || "no outputs"; }},
        {key: "compression", fields: ["compression"], text: function (s) { return s.compression === "none" ? "no compression" : s.compression + " compression"; }},
        {key: "mosaics", fields: ["mosaics"], text: function (s) { return s.mosaics ? "mosaics" : "no mosaics"; }},
        {key: "distance", fields: ["distance_mode", "distance"], text: function (s) {
            return typeof s.distance === "number" ? "distance " + num(s.distance, 1) + " m" :
                s.distance === "embedded" ? "embedded distance" : s.distance === "" ? "distance not given" : "rangefinder distance";
        }}
    ].concat(MEASUREMENTS.map(function (m) {
        var name = m.label.replace(/ temperature$/, "").replace(/^Relative /, "").toLowerCase();
        return {key: m.key, fields: [m.key], text: function (s, u) {
            return blank(s[m.key]) ? "each image's " + m.label.toLowerCase() : name + " " + num(s[m.key]) + (m.temperature ? " " + u : m.unit || "");
        }};
    })).concat([
        {key: "unit", fields: ["unit"], text: function (s) { return "files in " + UNIT_LABELS[core.unitOf(s.unit)]; }},
        {key: "normalize", fields: ["normalize"], text: function (s) { return s.normalize ? "normalized" : "not normalized"; }},
        {key: "max_pitch", fields: ["max_pitch"], text: function (s) { return blank(s.max_pitch) ? "all frames" : "pitch ≤ " + num(s.max_pitch) + "°"; }},
        {key: "palette", fields: ["palette"], text: function (s) { return s.palette ? "palette " + s.palette : "each image's palette"; }},
        {key: "range", fields: ["range_min", "range_max"], text: function (s, u) {
            return blank(s.range_min) && blank(s.range_max) ? "each image's range" : "range " + num(s.range_min) + " to " + num(s.range_max) + " " + u;
        }},
        {key: "gimbal", fields: GIMBAL.map(function (g) { return g[0]; }), text: function (s) {
            var given = GIMBAL.filter(function (g) { return !blank(s[g[0]]); });
            return given.length ? "gimbal " + given.map(function (g) { return g[1].toLowerCase() + " " + num(s[g[0]]) + "°"; }).join(", ") : "recorded gimbal";
        }}
    ]).concat(["above", "below"].map(function (side) {
        var k = "replace_" + side;
        return {key: k, fields: [k, k + "_value", k + "_nodata"], text: function (s, u) {
            if (blank(s[k])) return "nothing replaced " + side;
            var v = s[k + "_value"];
            return side + " " + num(s[k]) + " " + u + " → " + (v === "nodata" ? "no data" : blank(v) ? "?" : num(v) + " " + u);
        }};
    })).concat([
        {key: "strip_location", fields: ["strip_location"], text: function (s) { return s.strip_location ? "location stripped" : "location kept"; }}
    ]);

    // The settings' values compared, of one difference
    function valuesOf(d, s) {
        if (d.key === "outputs") return s.outputs || [];
        var fields = {distance: ["distance"], range: ["range_min", "range_max"], replace_above: ["replace_above", "replace_above_value"],
                      replace_below: ["replace_below", "replace_below_value"], gimbal: GIMBAL.map(function (g) { return g[0]; })}[d.key] || [d.key];
        return fields.map(function (f) {
            var v = s[f];
            if (f === "unit") return core.unitOf(v);
            if (typeof v === "boolean" || f === "mosaics" || f === "normalize" || f === "strip_location") return !!v;
            return blank(v) ? null : round2(v);
        });
    }

    // What the settings change from the defaults, and where they're off the WebODM plan (where the plan differs from
    // the defaults): [{key, text, changed, offPlan, plan (the plan's text)}], the temperatures in the unit shown
    function differences(s, defaults, plan, shown) {
        var at = function (x) { return x ? settingsIn(x, core.unitOf(x.unit), shown) : null; };
        var S = at(s), D = at(defaults || {}), P = at(plan);
        var u = core.unitSymbol(shown);
        var out = [];
        DIFFERENCES.forEach(function (d) {
            var alike = d.same ? function (a, b) { return d.same(a.outputs, b.outputs); } : function (a, b) { return same(valuesOf(d, a), valuesOf(d, b)); };
            var changed = !alike(S, D);
            var offPlan = !!P && !alike(P, D) && !alike(S, P);
            if (changed || offPlan) out.push({key: d.key, text: d.text(S, u), changed: changed, offPlan: offPlan, plan: P ? d.text(P, u) : null});
        });
        return out;
    }

    // The differences as chips (none: what to say when there are none)
    function chipsHtml(diffs, none) {
        if (!diffs.length) return '<span class="text-muted">' + esc(none) + "</span>";
        return '<span class="ta-chips">' + diffs.map(function (d) {
            return '<span class="ta-chip' + (d.changed ? " ta-chip-changed" : "") + (d.offPlan ? " ta-chip-off-plan" : "") + '" data-key="' + d.key + '"' +
                (d.offPlan ? ' title="The WebODM plan: ' + esc(d.plan) + '"' : "") + ">" + esc(d.text) + "</span>";
        }).join("") + "</span>";
    }

    // The form's fields marked where they change the defaults (with a way back to them) or are off the plan
    function markForm(form, diffs) {
        [].forEach.call(form.querySelectorAll(".ta-changed, .ta-off-plan"), function (el) { el.classList.remove("ta-changed", "ta-off-plan"); });
        [].forEach.call(form.querySelectorAll(".ta-mark-note"), function (el) { el.parentNode.removeChild(el); });
        diffs.forEach(function (diff) {
            var d = DIFFERENCES.filter(function (x) { return x.key === diff.key; })[0];
            var input = form.querySelector('[name="' + d.fields[0] + '"]');
            var box = input && (d.key === "outputs" ? input.closest(".ta-section") : input.closest(".ta-field, .checkbox, .ta-output"));
            if (!box) return;
            if (diff.changed) box.classList.add("ta-changed");
            if (diff.offPlan) box.classList.add("ta-off-plan");
            var note = form.ownerDocument.createElement("span");
            note.className = "ta-mark-note";
            note.innerHTML = (diff.offPlan ? '<span title="The WebODM plan: ' + esc(diff.plan) + '"><i class="fa fa-exclamation-triangle"></i> plan: ' + esc(diff.plan) + "</span> " : "") +
                (diff.changed ? '<a href="#" data-reset="' + d.key + '" title="Back to dji-thermal-cli\'s default">default</a>' : "");
            var label = box.querySelector("label, h4");
            if (d.key === "outputs") box.querySelector("h4").appendChild(note);
            else if (label && box.classList.contains("ta-field")) label.appendChild(note);
            else box.appendChild(note);
        });
    }

    // The settings with one difference back at its default (both in their own unit)
    function resetSetting(s, defaults, key) {
        var out = Object.assign({}, s);
        if (key === "unit") return Object.assign(settingsIn(out, core.unitOf(out.unit), core.unitOf(defaults.unit)), {unit: defaults.unit});
        var d = settingsIn(defaults, core.unitOf(defaults.unit), core.unitOf(out.unit));
        var fields = {range: ["range_min", "range_max"], gimbal: GIMBAL.map(function (g) { return g[0]; }),
                      replace_above: ["replace_above", "replace_above_value"], replace_below: ["replace_below", "replace_below_value"]}[key] || [key];
        fields.forEach(function (f) { out[f] = d[f] === undefined ? null : JSON.parse(JSON.stringify(d[f])); });
        return out;
    }

    function statusLabel(c) {
        var label = STATUS_LABELS[c.status] || c.status;
        if (c.status === "converting") label += " " + Math.round((c.progress || 0) * 100) + "%";
        return label;
    }

    // A conversion's mosaics, under its figures: being built, failed or canceled (their actions are the card's)
    function mosaicHtml(c) {
        if (c.mosaic_status === "building") {
            return '<div class="ta-mosaic-status text-muted"><i class="fa fa-th"></i> ' + esc(core.mosaicLabel(c)) + "</div>";
        }
        if (c.mosaic_status === "failed") return '<div class="ta-mosaic-status text-danger">The mosaics failed: ' + esc(c.mosaic_error) + "</div>";
        if (c.mosaic_status === "canceled") return '<div class="ta-mosaic-status text-muted">Building the mosaics was canceled.</div>';
        return c.status === "ready" && c.mosaic_status !== "ready" ? '<div class="ta-mosaic-status text-muted">No mosaics.</div>' : "";
    }

    // A conversion's actions: the one its state calls for, and the others in its menu (menu: open)
    function actionsHtml(c, base, open, viewer, menu) {
        var button = function (act, icon, label, title, cls, aria) {
            return '<button type="button" class="' + (cls || "") + '" data-act="' + act + '"' + (title ? ' title="' + esc(title) + '"' : "") +
                (aria ? ' aria-label="' + esc(aria + " " + c.name) + '"' : "") + '><i class="fa fa-' + icon + '"></i> ' + esc(label) + "</button>";
        };
        var link = function (href, icon, label, cls) {
            return '<a class="' + (cls || "") + '" href="' + esc(href) + '"><i class="fa fa-' + icon + '"></i> ' + esc(label) + "</a>";
        };
        var ready = c.status === "ready", busy = c.status === "converting" || c.mosaic_status === "building";
        var main, items = [];
        var mainCls = "btn btn-default btn-xs";
        if (busy) {
            main = button("cancel", "stop", "Cancel", "Stop converting or building the mosaics", mainCls);
        } else if (ready && c.mosaic_status === "ready") {
            main = link(viewer + c.id, "map", "View mosaics", "btn btn-primary btn-xs");
        } else if (ready) {
            main = link(viewer + c.id + "/frame", "image", "Frames", "btn btn-primary btn-xs");
        } else {
            main = button("use", "sliders-h", "Use settings", "Fill the form with this conversion's settings", mainCls);
        }
        if (ready && c.mosaic_status === "ready") items.push(link(viewer + c.id + "/frame", "image", "Frames"));
        if (ready && c.mosaic_status === "ready") items.push(link(viewer + c.id + "/compare", "columns", "Compare with…"));
        if (c.file_count && c.status !== "converting") items.push(link(base + c.id + "/download", "download", "Download all"));
        items.push(button("files", "list", open === c.id ? "Hide files" : "Files"));
        if (ready || busy) items.push(button("use", "sliders-h", "Use settings", "Fill the form with this conversion's settings"));
        if (ready && c.mosaic_status !== "ready" && c.mosaic_status !== "building") items.push(button("mosaics", "th", "Build mosaics"));
        items.push(button("rename", "pencil-alt", "Rename", null, null, "Rename"));
        items.push("divider");
        items.push(button("delete", "trash", "Delete", null, "text-danger", "Delete"));
        return main + ' <span class="dropdown ta-menu' + (menu === c.id ? " open" : "") + '"><button type="button" class="btn btn-default btn-xs" data-act="menu" ' +
            'aria-haspopup="true" aria-expanded="' + (menu === c.id) + '" aria-label="More for ' + esc(c.name) + '" title="More">⋯</button>' +
            '<ul class="dropdown-menu dropdown-menu-right">' + items.map(function (i) {
                return i === "divider" ? '<li role="separator" class="divider"></li>' : "<li>" + i + "</li>";
            }).join("") + "</ul></span>";
    }

    // The dataset's conversions, newest first (viewer: the mosaic viewer's URL, without the conversion's id; defaults:
    // what their settings are compared against; menu: the conversion whose menu is open)
    function listHtml(conversions, base, open, viewer, fresh, defaults, menu) {
        if (!conversions.length) return '<p class="text-muted ta-none">No conversions yet.</p>';
        return conversions.map(function (c) {
            var cls = {ready: "success", failed: "danger", canceled: "default", converting: "info"}[c.status] || "default";
            var figures = [];
            if (c.status !== "converting") {
                if (c.converted || c.skipped) figures.push(c.converted + " converted" + (c.skipped ? ", " + c.skipped + " skipped" : ""));
                figures.push(c.file_count + " file(s), " + core.formatBytes(c.size));
            }
            figures.push(core.formatDate(c.created_at));
            var progress = c.status === "converting" ? '<div class="progress"><div class="progress-bar progress-bar-striped active" style="width: ' +
                Math.round((c.progress || 0) * 100) + '%;"></div></div>' + (c.progress ? "" : '<div class="text-muted">' +
                ((c.settings || {}).normalize ? "Normalizing: " + (esc(core.stageText(c.stage)) || "comparing the frames' overlaps") + "…" :
                    "Starting…") + "</div>") : "";
            // What the conversion changed from the defaults, in its files' unit
            var settings = defaults && c.settings ? '<div class="ta-conversion-chips" title="' + esc(c.description) + '">' +
                chipsHtml(differences(c.settings, defaults, null, core.unitOf(c.settings.unit)), "dji-thermal-cli's defaults") + "</div>" :
                '<div class="text-muted">' + esc(c.description) + "</div>";
            return '<div class="ta-conversion' + (c.id === fresh ? " ta-conversion-new" : "") + '" data-id="' + c.id + '">' +
                '<div class="ta-conversion-head"><strong>' + esc(c.name) + '</strong> <span class="label label-' + cls + '">' + esc(statusLabel(c)) + "</span>" +
                '<span class="ta-conversion-actions">' + actionsHtml(c, base, open, viewer, menu) + "</span></div>" +
                settings + progress +
                (c.error ? '<div class="text-danger">' + esc(c.error) + "</div>" : "") +
                '<div class="ta-conversion-figures text-muted">' + esc(figures.join(" · ")) + "</div>" + mosaicHtml(c) +
                '<div class="ta-conversion-files" data-files="' + c.id + '"></div></div>';
        }).join("");
    }

    // Why images were skipped, most common first: [[reason, count]] (the reasons without their per-image details)
    function skipReasons(files) {
        var counts = {};
        files.forEach(function (f) {
            if (f.ok) return;
            var r = String(f.reason || "unknown").replace(/\s*\(.*\)\s*$/, "");
            counts[r] = (counts[r] || 0) + 1;
        });
        return Object.keys(counts).map(function (r) { return [r, counts[r]]; }).sort(function (a, b) { return b[1] - a[1]; });
    }

    // What a conversion wrote for each image, with each output's download (frames: the frame page's URL, to open one)
    function resultsHtml(c, base, frames) {
        var r = c.results || {};
        var files = r.files || [];
        if (!files.length) return '<p class="text-muted">' + (c.status === "canceled" ? "Canceled before it finished: no results were kept." : "No results.") + "</p>";
        var html = "";
        var n = r.normalization;
        if (n) {
            html += '<p class="ta-normalization">Normalized: ambient ' + esc(core.formatTemp(n.ambient_c, "C", 1)) +
                ", reflected " + esc(core.formatTemp(n.reflected_c, "C", 1)) + ", " + n.frames + " frame(s) compared" +
                (n.offset_min !== null && n.offset_min !== undefined ? ", offsets " + esc(core.formatNumber(core.convertDelta(n.offset_min, "C"), 2)) + " to " +
                    esc(core.formatDelta(n.offset_max, "C", 2)) : "") + (n.without_offset ? ", " + n.without_offset + " without an offset" : "") + ".</p>";
        }
        if ((c.mosaic_files || []).length) {
            html += '<p class="ta-mosaic-files">Mosaics: ' + c.mosaic_files.map(function (f) {
                return '<a href="' + esc(base + c.id + "/download?file=" + encodeURIComponent(f)) + '">' + esc(f.replace(/^mosaics\//, "")) + "</a>";
            }).join(", ") + "</p>";
        }
        var reasons = skipReasons(files);
        if (reasons.length) html += '<p class="ta-skip-reasons">Skipped: ' + reasons.map(function (r) {
            return esc(r[0]) + " (" + r[1] + ")";
        }).join(", ") + ".</p>";
        html += '<div class="ta-table-scroll"><table class="table table-condensed ta-results"><thead><tr><th>Image</th><th>Result</th><th>Outputs</th><th>Notes</th></tr></thead><tbody>' +
            files.slice(0, RESULTS_SHOWN).map(function (f) {
                var outputs = (f.outputs || []).map(function (o) {
                    return '<a href="' + esc(base + c.id + "/download?file=" + encodeURIComponent(o)) + '">' + esc(o.split("/").pop()) + "</a>";
                }).join("<br>");
                var notes = (f.notes || []).slice();
                if (f.distance_source) notes.unshift("distance " + core.formatNumber(f.distance, 1, " m") + " (" + f.distance_source + ")");
                var name = frames ? '<a href="' + esc(frames + "?frame=" + encodeURIComponent(f.path)) + '" title="Open the frame">' +
                    esc(f.path) + "</a>" : esc(f.path);
                return '<tr class="' + (f.ok ? "" : "ta-skipped") + '"><td>' + name + "</td><td>" +
                    (f.ok ? '<span class="text-success">Converted</span>' : '<span class="text-warning">Skipped</span>: ' + esc(f.reason)) +
                    "</td><td>" + outputs + "</td><td>" + esc(notes.join("; ")) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        if (files.length > RESULTS_SHOWN) html += '<p class="text-muted">And ' + (files.length - RESULTS_SHOWN) + " more: download all to see them.</p>";
        return html;
    }

    // A link's request to start from a conversion's settings with some changed ("?from=<id>&emissivity=0.98", from
    // the frame page's "New conversion with these"): {from, changes}, or null
    function parsePrefill(search) {
        var params = {};
        String(search || "").replace(/^\?/, "").split("&").forEach(function (kv) {
            if (!kv) return;
            var p = kv.split("=");
            params[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " "));
        });
        var from = parseInt(params.from, 10);
        if (isNaN(from)) return null;
        var changes = {};
        MEASUREMENTS.forEach(function (m) {
            if (params[m.key] !== undefined && params[m.key] !== "" && !isNaN(Number(params[m.key]))) changes[m.key] = Number(params[m.key]);
        });
        if (params.distance !== undefined && params.distance !== "" && !isNaN(Number(params.distance))) changes.distance = Number(params.distance);
        return {from: from, changes: changes};
    }

    // ctx: {doc, fetchFn, api, csrf, datasetId, viewer (the mosaic viewer's URL without the conversion's id),
    //      prefill (parsePrefill's), onChange (the dataset's conversions changed: reload it)}
    function init(ctx) {
        var doc = ctx.doc, fetchFn = ctx.fetchFn, root$ = function (i) { return doc.getElementById(i); };
        var base = ctx.api + "conversions/";
        var meta = null, settings = null, saved = false, dataset = null, open = null, built = false, loading = null;
        var fresh = null; // the conversion just started, highlighted for a few seconds
        var editing = null; // the form unfolded: at first only for a dataset without conversions, then once opened
        var menu = null;    // the conversion whose menu is open
        var panel = root$("ta-tab-convert");

        function send(u, method, data) {
            var opts = {method: method, credentials: "same-origin", headers: {"X-CSRFToken": ctx.csrf}};
            if (data !== undefined) {
                opts.headers["Content-Type"] = "application/json";
                opts.body = JSON.stringify(data);
            }
            return fetchFn(u, opts).then(core.readJson);
        }

        function message(text, cls) {
            var el = root$("ta-convert-message");
            el.className = "ta-convert-message" + (cls ? " " + cls : "");
            el.innerHTML = text || "";
        }

        // The form's sections kept open or closed as they were
        function renderForm() {
            var form = root$("ta-convert-form");
            var sections = built ? [].map.call(form.querySelectorAll("details.ta-section"), function (d) { return d.open; }) : null;
            form.innerHTML = formHtml(settings, meta, recorded(dataset && dataset.analysis));
            if (sections) [].forEach.call(form.querySelectorAll("details.ta-section"), function (d, i) { d.open = sections[i]; });
            root$("ta-convert-origin").textContent = saved ? "Starting from your saved defaults." : "Starting from dji-thermal-cli's defaults.";
            built = true;
            if (editing === null) editing = !((dataset && dataset.conversions) || []).length;
            summarize();
        }

        function plan() {
            var args = dataset && ((dataset.analysis || {}).webodm || {}).process_args;
            return args && meta ? planSettings(args, meta.defaults) : null;
        }

        // The form's settings as chips, and its fields marked, against the defaults and the WebODM plan
        function summarize() {
            var form = root$("ta-convert-form");
            var diffs = differences(readForm(form), meta.defaults, plan(), core.userUnit());
            root$("ta-convert-summary").innerHTML = "<strong>Settings:</strong> " + chipsHtml(diffs, "dji-thermal-cli's defaults") +
                (editing ? "" : ' <button type="button" class="btn btn-default btn-xs" data-act="edit"><i class="fa fa-sliders-h"></i> Edit settings</button>');
            form.hidden = !editing;
            markForm(form, diffs);
        }

        function closeMenu() {
            if (menu === null) return;
            menu = null;
            [].forEach.call(root$("ta-conversions").querySelectorAll(".ta-menu.open"), function (el) {
                el.classList.remove("open");
                el.querySelector('[data-act="menu"]').setAttribute("aria-expanded", "false");
            });
        }

        function renderList() {
            var list = (dataset && dataset.conversions) || [];
            root$("ta-convert-count").textContent = list.length || "";
            root$("ta-conversions").innerHTML = listHtml(list, base, open, ctx.viewer, fresh, dataset && dataset.defaults, menu);
            if (open !== null) loadFiles(open);
        }

        function loadFiles(id) {
            return fetchFn(base + id, {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                var el = panel.querySelector('[data-files="' + id + '"]');
                if (el && r.ok) el.innerHTML = resultsHtml(r.data, base, r.data.status === "ready" && ctx.viewer ? ctx.viewer + id + "/frame" : null);
            });
        }

        // The settings and what can be chosen, loaded once
        function loadPreferences() {
            loading = fetchFn(ctx.api + "preferences", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return message("Could not load the conversion settings.", "text-danger");
                meta = r.data;
                settings = r.data.settings;
                saved = r.data.saved;
                renderForm();
            });
            return loading;
        }

        // The form filled with a conversion's settings and the changes a link asks for, once
        function applyPrefill() {
            var p = ctx.prefill;
            ctx.prefill = null;
            var c = p && ((dataset && dataset.conversions) || []).filter(function (x) { return x.id === p.from; })[0];
            if (!c) return;
            // The link's temperatures are the frame page's, typed in the user's unit
            settings = Object.assign({}, c.settings, settingsIn(p.changes, core.userUnit(), c.settings.unit || "C"));
            renderForm();
            var changed = Object.keys(p.changes).map(function (k) { return k.replace(/_/g, " ") + " " + p.changes[k]; });
            message("The form has " + esc(c.name) + "'s settings" + (changed.length ? ", with " + esc(changed.join(", ")) : "") + ".", "text-muted");
        }

        function update(d) {
            dataset = d;
            root$("ta-convert-plan").hidden = !((d.analysis || {}).webodm || {}).process_args;
            renderList();
            if (!loading) loadPreferences().then(applyPrefill);
            else if (meta && !built) renderForm();
            return loading;
        }

        panel.addEventListener("change", function (e) {
            var t = e.target;
            if (t.name === "distance_mode") panel.querySelector('[name="distance"]').hidden = t.value !== "fixed";
            if (/^replace_(above|below)_nodata$/.test(t.name)) panel.querySelector('[name="' + t.name.replace("_nodata", "_value") + '"]').disabled = t.checked;
        });

        ["input", "change"].forEach(function (type) {
            root$("ta-convert-form").addEventListener(type, function () { if (meta) summarize(); });
        });

        root$("ta-convert-form").addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-reset]") : null;
            if (!a || !meta) return;
            e.preventDefault();
            settings = resetSetting(readForm(root$("ta-convert-form")), meta.defaults, a.getAttribute("data-reset"));
            renderForm();
        });

        root$("ta-convert-summary").addEventListener("click", function (e) {
            if (!(e.target.closest && e.target.closest('[data-act="edit"]'))) return;
            editing = true;
            summarize();
        });

        doc.addEventListener("click", function (e) {
            if (menu !== null && !(e.target.closest && e.target.closest(".ta-menu"))) closeMenu();
        });
        doc.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeMenu();
        });

        root$("ta-convert-start").addEventListener("click", function () {
            var s = readForm(root$("ta-convert-form"));
            if (formProblem(s)) return message(esc(formProblem(s)), "text-danger");
            var btn = root$("ta-convert-start");
            btn.disabled = true;
            send(ctx.api + "datasets/" + ctx.datasetId + "/conversions", "POST", {name: root$("ta-convert-name").value.trim(), settings: s})
                .then(function (r) {
                    btn.disabled = false;
                    if (!r.ok) return message(esc(core.errorText(r.data, "Could not start the conversion.")), "text-danger");
                    settings = s;
                    root$("ta-convert-name").value = "";
                    message("");
                    // The new conversion shows at once, before the dataset reloads
                    if (dataset && !dataset.conversions.some(function (c) { return c.id === r.data.id; })) dataset.conversions.unshift(r.data);
                    fresh = r.data.id;
                    renderList();
                    var card = root$("ta-conversions").querySelector('.ta-conversion[data-id="' + fresh + '"]');
                    if (card && card.scrollIntoView) card.scrollIntoView({block: "nearest", behavior: "smooth"});
                    setTimeout(function () {
                        fresh = null;
                        var el = root$("ta-conversions").querySelector(".ta-conversion-new");
                        if (el) el.classList.remove("ta-conversion-new");
                    }, 4000);
                    return ctx.onChange();
                });
        });

        root$("ta-convert-save").addEventListener("click", function () {
            var s = readForm(root$("ta-convert-form"));
            if (formProblem(s)) return message(esc(formProblem(s)), "text-danger");
            send(ctx.api + "preferences", "PUT", {settings: s}).then(function (r) {
                if (!r.ok) return message(esc(core.errorText(r.data, "Could not save your defaults.")), "text-danger");
                settings = r.data.settings;
                saved = true;
                renderForm();
                message('<i class="fa fa-check"></i> Saved: new conversions start from these settings.', "text-success");
            });
        });

        // The WebODM plan's settings in the form (marked as changed), without converting; false before the form is ready
        function usePlan() {
            var plan = (((dataset || {}).analysis || {}).webodm || {}).process_args;
            if (!meta || !plan) return false;
            settings = planSettings(plan, meta.defaults);
            renderForm();
            message("The form has the WebODM plan's settings: <code>" + esc(plan.join(" ")) + "</code>", "text-muted");
            return true;
        }

        root$("ta-convert-plan").addEventListener("click", usePlan);

        root$("ta-convert-reset").addEventListener("click", function () {
            core.ask(doc, "Reset defaults", "Go back to dji-thermal-cli's defaults? Your saved defaults are forgotten.", "Reset").then(function (yes) {
                return yes && send(ctx.api + "preferences", "DELETE");
            }).then(function (r) {
                if (!r) return;
                if (!r.ok) return message("Could not reset your defaults.", "text-danger");
                settings = r.data.settings;
                saved = false;
                renderForm();
                message("Back to dji-thermal-cli's defaults.", "text-muted");
            });
        });

        root$("ta-conversions").addEventListener("click", function (e) {
            var btn = e.target.closest ? e.target.closest("button[data-act]") : null;
            if (!btn) return;
            var id = Number(btn.closest(".ta-conversion").getAttribute("data-id"));
            var c = ((dataset && dataset.conversions) || []).filter(function (x) { return x.id === id; })[0];
            if (!c) return;
            var act = btn.getAttribute("data-act");
            if (act === "menu") {
                var was = menu;
                closeMenu();
                if (was === id) return;
                menu = id;
                btn.parentNode.classList.add("open");
                btn.setAttribute("aria-expanded", "true");
                return;
            }
            closeMenu();
            if (act === "files") {
                open = open === id ? null : id;
                renderList();
            } else if (act === "use") {
                settings = c.settings;
                renderForm();
                message("The form has " + esc(c.name) + "'s settings.", "text-muted");
            } else if (act === "mosaics") {
                send(base + id + "/mosaics", "POST").then(function (r) {
                    if (!r.ok) return message(esc(core.errorText(r.data, "Could not build the mosaics.")), "text-danger");
                    return ctx.onChange();
                });
            } else if (act === "cancel") {
                send(base + id + "/cancel", "POST", {}).then(function (r) {
                    if (!r.ok) message(esc(core.errorText(r.data, "Could not cancel " + c.name + ".")), "text-danger");
                    return ctx.onChange();
                });
            } else if (act === "rename") {
                core.askName(doc, "Rename conversion", c.name).then(function (name) {
                    return name && send(base + id, "PATCH", {name: name});
                }).then(function (r) {
                    if (!r) return;
                    if (!r.ok) return message(esc(core.errorText(r.data, "Could not rename " + c.name + ".")), "text-danger");
                    return ctx.onChange();
                });
            } else if (act === "delete") {
                core.ask(doc, "Delete conversion", "Delete " + c.name + " and its files? This cannot be undone.", "Delete", "danger").then(function (yes) {
                    return yes && send(base + id, "DELETE");
                }).then(function (r) {
                    if (!r) return;
                    if (!r.ok) return message(esc(core.errorText(r.data, "Could not delete the conversion.")), "text-danger");
                    if (open === id) open = null;
                    return ctx.onChange();
                });
            }
        });

        return {update: update, usePlan: usePlan};
    }

    var api = {recorded: recorded, settingsIn: settingsIn, parsePrefill: parsePrefill, formHtml: formHtml, readForm: readForm, formProblem: formProblem, planSettings: planSettings, statusLabel: statusLabel,
               differences: differences, chipsHtml: chipsHtml, markForm: markForm, resetSetting: resetSetting,
               mosaicHtml: mosaicHtml, actionsHtml: actionsHtml, listHtml: listHtml, skipReasons: skipReasons, resultsHtml: resultsHtml, init: init};
    root.ThermalAnalyzerConversions = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
