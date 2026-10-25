// A conversion's mosaics on a map (viewer.html): a tab per mosaic (as converted, harmonized, and the as-converted
// mosaic's source frames and view angles), its palette and range changed live through the tile URL, the values under
// the cursor, and what dji-thermal-cli reports about the mosaic. On the temperature mosaics: spots, lines and areas
// measured (and saved), an isotherm, and an approximate correction for another emissivity or reflected temperature.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var measure = root.ThermalAnalyzerMeasure || (typeof require !== "undefined" ? require("./measure") : null);
    var esc = function (t) { return core.escapeHtml(t); };
    var POLL_MS = 2000;
    var HOVER_MS = 120;         // the readout asks for the point the cursor rests on, not every point it crosses
    var TYPING_MS = 400;        // the correction redraws once typing pauses
    var TAB_LABELS = {as_converted: "As converted", harmonized: "Harmonized", source_frame: "Source frame",
                      view_angle: "View angle"};
    var TAB_HINTS = {
        as_converted: "Each pixel is one frame's own temperature, as the frames were converted.",
        harmonized: "Normalized: one ambient and reflected temperature for every frame, and each frame's offset against " +
            "its neighbours removed (camera drift between recalibrations).",
        source_frame: "Which frame each pixel comes from (the one that saw it closest to straight down), each frame in " +
            "its own colour: the seams are where the colours change.",
        view_angle: "How far from straight down each pixel was seen, in degrees."
    };
    var TEMPERATURE_TABS = ["as_converted", "harmonized"];
    // The adjustments' limits and the legend's samples, as the server has them (thermal_measure)
    var GAMMA_LIMITS = [0.2, 5], SHARPEN_MAX = 5, CURVE_SAMPLES = 65;

    function tabLabel(tab) { return TAB_LABELS[tab] || tab; }

    // The unit temperatures are shown in: the user's (the conversion's own unit is converted from)
    function unitSymbol() { return core.unitSymbol(core.userUnit()); }

    // The tabs that share a palette and range: both temperature mosaics show the same scale, to compare them
    function styleGroup(tab) {
        return tab === "as_converted" || tab === "harmonized" ? "temperature" : tab;
    }

    // A tab's starting range: its 2nd to 98th percentile, rounded outwards to a tenth; unit: a temperature's, rounded
    // in the user's unit and kept in the conversion's
    function defaultRange(tab, unit) {
        var p = tab && tab.stats && tab.stats.percentiles;
        if (!p || p.length < 2) return [0, 1];
        var shown = unit ? function (x) { return core.convertTemp(x, unit); } : Number;
        var kept = unit ? function (x) { return measure.typedTemp(x, unit); } : Number;
        var lo = Math.floor(shown(p[0]) * 10) / 10, hi = Math.ceil(shown(p[1]) * 10) / 10;
        return hi > lo ? [kept(lo), kept(hi)] : [kept(lo), kept(lo + 1)];
    }

    // The range typed; unit: a temperature's, typed in the user's unit and kept in the conversion's
    function parseRange(minText, maxText, unit) {
        var lo = parseFloat(minText), hi = parseFloat(maxText);
        if (isNaN(lo) || isNaN(hi)) return {error: "The range needs a minimum and a maximum"};
        if (!(hi > lo)) return {error: "The maximum must be above the minimum"};
        return {range: unit ? [measure.typedTemp(lo, unit), measure.typedTemp(hi, unit)] : [lo, hi]};
    }

    // The view kept in the URL (?tab=&palette=&min=&max=&gamma=&equalize=&sharpen=&frame=): those given, the range only
    // when it is one (the conversion's unit), the image's adjustments when any is (the others as by default)
    function readView(search) {
        var out = {}, params = {};
        String(search || "").replace(/^\?/, "").split("&").forEach(function (pair) {
            var i = pair.indexOf("="), key = i < 0 ? pair : pair.slice(0, i);
            if (!key) return;
            try {
                params[key] = decodeURIComponent((i < 0 ? "" : pair.slice(i + 1)).replace(/\+/g, " "));
            } catch (e) { /* a malformed value is left out */ }
        });
        ["tab", "palette", "frame"].forEach(function (k) { if (params[k]) out[k] = params[k]; });
        var lo = parseFloat(params.min), hi = parseFloat(params.max);
        if (isFinite(lo) && isFinite(hi) && hi > lo) out.range = [lo, hi];
        var adjust = defaultAdjust(), gamma = parseFloat(params.gamma), sharpen = parseFloat(params.sharpen);
        if (gamma >= GAMMA_LIMITS[0] && gamma <= GAMMA_LIMITS[1]) adjust.gamma = gamma;
        if (sharpen >= 0 && sharpen <= SHARPEN_MAX) adjust.sharpen = sharpen;
        adjust.equalize = params.equalize === "1";
        if (adjustQuery(adjust)) out.adjust = adjust;
        return out;
    }

    // The same view as a URL query, those given
    function viewQuery(view) {
        var parts = [];
        ["tab", "palette"].forEach(function (k) { if (view[k]) parts.push(k + "=" + encodeURIComponent(view[k])); });
        if (view.range) parts.push("min=" + encodeURIComponent(view.range[0]), "max=" + encodeURIComponent(view.range[1]));
        var adjust = adjustQuery(view.adjust);
        if (adjust) parts.push(adjust.slice(1));
        if (view.frame) parts.push("frame=" + encodeURIComponent(view.frame));
        return parts.length ? "?" + parts.join("&") : "";
    }

    // The side panel's sections (details[data-section]) fold away, the folded ones remembered in this browser under key
    function foldSections(doc, page, key) {
        var folded = [];
        try {
            folded = JSON.parse(root.localStorage.getItem(key) || "[]") || [];
        } catch (e) { folded = []; }
        Array.prototype.forEach.call(page.querySelectorAll("details[data-section]"), function (d) {
            if (folded.indexOf(d.getAttribute("data-section")) >= 0) d.open = false;
            d.addEventListener("toggle", function () {
                var name = d.getAttribute("data-section");
                folded = folded.filter(function (n) { return n !== name; });
                if (!d.open) folded.push(name);
                try {
                    root.localStorage.setItem(key, JSON.stringify(folded));
                } catch (e) { /* not remembered */ }
            });
        });
    }

    // The query of what a temperature is asked with: the isotherm and the correction's parameters, those given
    function extraQuery(extra) {
        return Object.keys(extra || {}).filter(function (k) {
            return extra[k] !== "" && extra[k] !== null && extra[k] !== undefined;
        }).map(function (k) { return "&" + k + "=" + encodeURIComponent(extra[k]); }).join("");
    }

    function tileUrl(api, id, tab, style, extra) {
        var url = api + "conversions/" + id + "/mosaics/" + tab + "/tiles/{z}/{x}/{y}";
        if (tab === "source_frame") return url;
        return url + "?color_map=" + encodeURIComponent(style.palette) + "&rescale=" + style.range[0] + "," + style.range[1] +
            adjustQuery(style.adjust) + (TEMPERATURE_TABS.indexOf(tab) >= 0 ? extraQuery(extra) : "");
    }

    // How an image is drawn (display only: the temperatures stay as they are): gamma (above 1 brightens), equalized
    // from the histogram of the whole mosaic or frame, sharpened (an unsharp mask, on the server)
    function defaultAdjust() {
        return {gamma: 1, equalize: false, sharpen: 0};
    }

    // The adjustments as a query (&gamma=&equalize=1&sharpen=), those not as by default
    function adjustQuery(adjust) {
        if (!adjust) return "";
        return (adjust.gamma && adjust.gamma !== 1 ? "&gamma=" + adjust.gamma : "") + (adjust.equalize ? "&equalize=1" : "") +
            (adjust.sharpen ? "&sharpen=" + adjust.sharpen : "");
    }

    // The palette's share at CURVE_SAMPLES values evenly across the range, with gamma alone (what the server's curve
    // gives with equalization)
    function toneShares(gamma) {
        var out = [];
        for (var i = 0; i < CURVE_SAMPLES; i++) out.push(Math.pow(i / (CURVE_SAMPLES - 1), 1 / (gamma || 1)));
        return out;
    }

    // The brightness (-1 to 1) and contrast (-2 to 2) sliders move the range from ref (the Auto one): brightness
    // lowers its centre by up to its width, each step of contrast halves its width
    function slidRange(ref, brightness, contrast) {
        var centre = (ref[0] + ref[1]) / 2 - brightness * (ref[1] - ref[0]), half = (ref[1] - ref[0]) / Math.pow(2, contrast) / 2;
        var round = function (x) { return Math.round(x * 100) / 100; };
        return [round(centre - half), round(centre + half)];
    }

    // Where the sliders sit for a range (within their ends)
    function sliderPositions(ref, range) {
        var clamp = function (x, limit) { return Math.max(-limit, Math.min(limit, Math.round(x * 100) / 100)); };
        var refWidth = ref[1] - ref[0], width = range[1] - range[0];
        if (!(refWidth > 0) || !(width > 0)) return {brightness: 0, contrast: 0};
        return {brightness: clamp(((ref[0] + ref[1]) - (range[0] + range[1])) / 2 / refWidth, 1),
                contrast: clamp(Math.log(refWidth / width) / Math.LN2, 2)};
    }

    // The Image section: brightness and contrast (which move the range), gamma, linear or equalized, sharpening and a
    // reset; equalized only where there are temperatures. Gamma's slider is its log2.
    function imageHtml(adjust, sliders, temperature) {
        var slider = function (key, label, min, max, step, value, shown, title) {
            return '<div class="ta-image-slider" title="' + esc(title) + '"><label for="ta-image-' + key + '">' + esc(label) +
                ' <span id="ta-image-' + key + '-value">' + esc(shown) + "</span></label>" +
                '<input type="range" id="ta-image-' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></div>';
        };
        var log2 = Math.round(Math.log(adjust.gamma) / Math.LN2 * 100) / 100;
        return slider("brightness", "Brightness", -1, 1, 0.05, sliders.brightness, "", "Moves the range down (brighter) or up") +
            slider("contrast", "Contrast", -2, 2, 0.1, sliders.contrast, "", "Narrows the range (more contrast) or widens it") +
            slider("gamma", "Gamma", -2.3, 2.3, 0.1, log2, adjust.gamma.toFixed(2), "Above 1 brightens the cooler part of the range") +
            slider("sharpen", "Sharpening", 0, SHARPEN_MAX, 0.5, adjust.sharpen, String(adjust.sharpen), "Brings out edges (an unsharp mask)") +
            '<div class="ta-inline"><select class="form-control input-sm" id="ta-image-tone" title="Equalized spreads the colours over the temperatures the ' +
            'whole image has most of">' + '<option value="linear"' + (adjust.equalize ? "" : " selected") + ">Linear</option>" +
            (temperature ? '<option value="equalized"' + (adjust.equalize ? " selected" : "") + ">Equalized</option>" : "") + "</select>" +
            '<button type="button" class="btn btn-default btn-sm" id="ta-image-reset" title="The Auto range, no adjustments">Reset</button></div>' +
            '<div class="ta-message">How the image is drawn: the temperatures stay as they are.</div>';
    }

    // Gamma from its slider (its log2)
    function sliderGamma(value) {
        var g = Math.round(Math.pow(2, parseFloat(value) || 0) * 100) / 100;
        return Math.max(GAMMA_LIMITS[0], Math.min(GAMMA_LIMITS[1], g));
    }

    // Colours as the API gives them (0xRRGGBBAA) as CSS colours: sampled at 16 stops, or, with shares (the palette's
    // share at values evenly across the range: how the image is drawn), one per share, between the palette's entries
    function gradientStops(encoded, shares) {
        if (!encoded || !encoded.length) return [];
        var at = shares && shares.length > 1 ? shares : null, stops = [];
        if (at) return at.map(function (t) { return paletteCss(encoded, t); });
        for (var i = 0; i < 16; i++) stops.push(colorCss(encoded[Math.round(i * (encoded.length - 1) / 15)]));
        return stops;
    }

    // The same as a CSS gradient
    function gradientCss(encoded, shares) {
        var stops = gradientStops(encoded, shares);
        return stops.length ? "linear-gradient(to right, " + stops.join(", ") + ")" : "";
    }

    // Round values to mark on a colour scale from lo to hi (as shown), about count of them: each with its label and
    // where it sits on the scale (0 to 1)
    function scaleTicks(lo, hi, count) {
        if (!(hi > lo)) return [];
        var rough = (hi - lo) / (count || 5), mag = Math.pow(10, Math.floor(Math.log10(rough)));
        var m = [1, 2, 2.5, 5, 10].filter(function (x) { return x * mag >= rough * (1 - 1e-9); })[0], step = m * mag;
        var digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (m === 2.5 ? 1 : 0));
        var out = [];
        for (var i = Math.ceil(lo / step - 1e-9); i <= Math.floor(hi / step + 1e-9); i++) {
            var value = i * step;
            out.push({value: value, label: value.toFixed(digits).replace(/^-(0\.?0*)$/, "$1"), at: (value - lo) / (hi - lo)});
        }
        return out;
    }

    // A tab's range as shown: a temperature's in the user's unit
    function shownRange(tab, range, unit) {
        return tab === "view_angle" ? range.slice() : range.map(function (x) { return core.convertTemp(x, unit); });
    }

    // A colour scale: the palette's gradient over the range shown ([lo, hi]) (bent by shares: see gradientStops),
    // marked with round values; caption: its name and unit, above it
    function legendHtml(encoded, shown, caption, shares) {
        if (!encoded) return "";
        var ticks = scaleTicks(shown[0], shown[1], 5).map(function (t) {
            var end = t.at < 0.1 ? " ta-tick-start" : t.at > 0.9 ? " ta-tick-end" : "";
            return '<span class="ta-tick' + end + '" style="left: ' + (t.at * 100).toFixed(1) + '%;">' + esc(t.label) + "</span>";
        }).join("");
        return (caption ? '<div class="ta-legend-caption">' + esc(caption) + "</div>" : "") +
            '<div class="ta-viewer-legend" style="background: ' + gradientCss(encoded, shares) + ';"></div>' +
            '<div class="ta-legend-ticks">' + ticks + "</div>";
    }

    // A colour scale in a corner of a Leaflet map: set(html) shows it, set("") hides it. Clicks on it stay off the map
    // (they would measure there)
    function mapLegend(L, map, doc) {
        var el = doc.createElement("div");
        el.className = "ta-map-legend leaflet-control";
        if (L.DomEvent) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); }
        var control = L.control({position: "bottomright"});
        control.onAdd = function () { return el; };
        control.addTo(map);
        return {el: el, set: function (html) { el.innerHTML = html; el.hidden = !html; }};
    }

    // When frames were taken, from their recorded times ("YYYY:MM:DD HH:MM:SS"): "2026-09-18 08:44–09:02", or the
    // first and last in full when they are on different days; "" when none is known
    function takenText(times) {
        var t = (times || []).map(function (s) {
            var m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d)/.exec(s || "");
            return m ? m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] : null;
        }).filter(Boolean).sort();
        if (!t.length) return "";
        var first = t[0], last = t[t.length - 1];
        if (first === last) return first;
        return first.slice(0, 10) === last.slice(0, 10) ? first + "–" + last.slice(11) : first + " – " + last;
    }

    // A scale bar no longer than maxPx at metresPerPx: a round length (1, 2 or 5 times a power of ten) and its width
    function scaleBar(metresPerPx, maxPx) {
        if (!(metresPerPx > 0) || !(maxPx > 0)) return null;
        var most = metresPerPx * maxPx, mag = Math.pow(10, Math.floor(Math.log10(most)));
        var metres = [5, 2, 1].map(function (m) { return m * mag; }).filter(function (d) { return d <= most * (1 + 1e-9); })[0];
        var label = metres >= 1000 ? +(metres / 1000).toPrecision(6) + " km" : +metres.toPrecision(6) + " m";
        return {px: metres / metresPerPx, label: label};
    }

    // A file name from the names given: letters, digits, dots, dashes and underscores, as the server names its downloads
    function fileName(parts, ext) {
        var name = parts.filter(Boolean).join("-").replace(/[^\w.-]+/g, "_").replace(/^[._]+|[._]+$/g, "");
        return (name || "view") + ext;
    }

    // The view as an image, drawn in the browser on a canvas: a title and the date above; each pane's own images
    // (the mosaic's tiles, the frame) where they are on the page, its measurements drawn over them, named; below,
    // the scale bar and the colour scale. The basemap is left out: its tiles come from elsewhere and can't be
    // copied into an image.
    // o: {doc, title, date, panes: [{el (the map's element), images ([img]), caption, shapes: [{type: "Point",
    //     "LineString" or "Polygon", points: [[x, y] in the pane], name}]}], legend: {colors, shown, caption} or null,
    //     scale: {px, label} or null, ratio (pixels per CSS pixel)}
    function viewCanvas(o) {
        var HEAD = 46, FOOT = 58, GAP = 8, PAD = 12, CAPTION = o.panes.some(function (p) { return p.caption; }) ? 18 : 0;
        var boxes = [], x = 0, height = 0;
        o.panes.forEach(function (p) {
            var r = p.el.getBoundingClientRect();
            boxes.push({pane: p, rect: r, x: x});
            x += r.width + GAP;
            height = Math.max(height, r.height);
        });
        var width = Math.max(x - GAP, 360), ratio = o.ratio || 1;
        var canvas = o.doc.createElement("canvas");
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round((HEAD + CAPTION + height + FOOT) * ratio);
        var g = canvas.getContext("2d");
        g.scale(ratio, ratio);
        g.fillStyle = "#fff";
        g.fillRect(0, 0, width, HEAD + CAPTION + height + FOOT);
        g.fillStyle = "#222";
        g.textBaseline = "alphabetic";
        g.font = "bold 16px sans-serif";
        g.fillText(o.title || "", PAD, 22);
        g.font = "12px sans-serif";
        g.fillStyle = "#666";
        g.fillText(o.date || "", PAD, 39);

        boxes.forEach(function (b) {
            var top = HEAD + CAPTION, p = b.pane;
            if (p.caption) {
                g.fillStyle = "#222";
                g.font = "bold 12px sans-serif";
                g.fillText(p.caption, b.x + 2, HEAD + 12);
            }
            g.save();
            g.beginPath();
            g.rect(b.x, top, b.rect.width, b.rect.height);
            g.clip();
            g.fillStyle = "#f2f2f2";
            g.fillRect(b.x, top, b.rect.width, b.rect.height);
            (p.images || []).forEach(function (img) {
                if (!img.complete || !img.naturalWidth) return;
                var r = img.getBoundingClientRect();
                g.drawImage(img, b.x + r.left - b.rect.left, top + r.top - b.rect.top, r.width, r.height);
            });
            g.translate(b.x, top);
            (p.shapes || []).forEach(function (s) { drawShape(g, s); });
            g.restore();
        });

        var bottom = HEAD + CAPTION + height;
        if (o.scale) {
            g.strokeStyle = "#222";
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(PAD, bottom + 24);
            g.lineTo(PAD, bottom + 30);
            g.lineTo(PAD + o.scale.px, bottom + 30);
            g.lineTo(PAD + o.scale.px, bottom + 24);
            g.stroke();
            g.fillStyle = "#222";
            g.font = "12px sans-serif";
            g.fillText(o.scale.label, PAD, bottom + 19);
        }
        var stops = gradientStops(o.legend && o.legend.colors, o.legend && o.legend.shares);
        if (stops.length) {
            var w = Math.min(240, width / 2 - PAD), left = width - PAD - w;
            var grad = g.createLinearGradient(left, 0, left + w, 0);
            stops.forEach(function (c, i) { grad.addColorStop(i / (stops.length - 1), c); });
            g.fillStyle = "#222";
            g.font = "12px sans-serif";
            g.fillText(o.legend.caption || "", left, bottom + 17);
            g.fillStyle = grad;
            g.fillRect(left, bottom + 22, w, 12);
            g.strokeStyle = "#999";
            g.lineWidth = 1;
            g.strokeRect(left, bottom + 22, w, 12);
            g.fillStyle = "#222";
            g.font = "11px sans-serif";
            scaleTicks(o.legend.shown[0], o.legend.shown[1], 5).forEach(function (t) {
                g.textAlign = t.at < 0.1 ? "left" : t.at > 0.9 ? "right" : "center";
                g.fillText(t.label, left + t.at * w, bottom + 48);
            });
            g.textAlign = "left";
        }
        return canvas;
    }

    // A measurement on the image as it is on the map (measure.js's colours), its name beside it
    function drawShape(g, s) {
        var pts = s.points;
        if (!pts || !pts.length) return;
        g.strokeStyle = "#00e5ff";
        g.lineWidth = 2;
        g.beginPath();
        if (s.type === "Point") {
            g.arc(pts[0][0], pts[0][1], 6, 0, 2 * Math.PI);
        } else {
            pts.forEach(function (p, i) { g[i ? "lineTo" : "moveTo"](p[0], p[1]); });
            if (s.type === "Polygon") {
                g.closePath();
                g.fillStyle = "rgba(0, 229, 255, 0.1)";
                g.fill();
            }
        }
        g.stroke();
        if (!s.name) return;
        g.font = "bold 12px sans-serif";
        g.lineWidth = 3;
        g.strokeStyle = "rgba(0, 0, 0, 0.8)";
        g.strokeText(s.name, pts[0][0] + 9, pts[0][1] - 9);
        g.fillStyle = "#fff";
        g.fillText(s.name, pts[0][0] + 9, pts[0][1] - 9);
    }

    // A canvas saved as a PNG file named name; done(error) once it has been handed to the browser, or could not be
    function saveCanvas(doc, canvas, name, done) {
        try {
            canvas.toBlob(function (blob) {
                if (!blob) return done("Could not make the image.");
                var a = doc.createElement("a");
                a.href = root.URL.createObjectURL(blob);
                a.download = name;
                doc.body.appendChild(a);
                a.click();
                doc.body.removeChild(a);
                root.setTimeout(function () { root.URL.revokeObjectURL(a.href); }, 1000);
                done(null);
            }, "image/png");
        } catch (e) {
            done("Could not make the image (" + e.message + ").");
        }
    }

    // A measurement's geometry as points on a map's pane (fromCoords: its coordinates to a latlng)
    function shapeOnMap(map, geometry, fromCoords, name) {
        var coords = geometry.type === "Point" ? [geometry.coordinates] :
            geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates[0].slice(0, -1);
        return {type: geometry.type, name: name || "", points: coords.map(function (c) {
            var p = map.latLngToContainerPoint(fromCoords(c));
            return [p.x, p.y];
        })};
    }

    // The palette's colour at a share of it, blended between its two nearest entries
    function paletteCss(encoded, t) {
        var x = Math.max(0, Math.min(1, t)) * (encoded.length - 1), i = Math.min(Math.floor(x), encoded.length - 2), f = x - i;
        if (i < 0) return colorCss(encoded[0]);
        var a = encoded[i] >>> 0, b = encoded[i + 1] >>> 0;
        var mix = function (shift) { return Math.round(((a >>> shift) & 255) * (1 - f) + ((b >>> shift) & 255) * f); };
        return "rgb(" + mix(24) + "," + mix(16) + "," + mix(8) + ")";
    }

    function colorCss(encoded) {
        var c = encoded >>> 0;
        return "rgb(" + ((c >>> 24) & 255) + "," + ((c >>> 16) & 255) + "," + ((c >>> 8) & 255) + ")";
    }

    function tabsHtml(tabs, current) {
        return tabs.map(function (t) {
            return '<li class="' + (t.tab === current ? "active" : "") + '"><a href="#' + esc(t.tab) + '" data-tab="' +
                esc(t.tab) + '">' + esc(tabLabel(t.tab)) + "</a></li>";
        }).join("");
    }

    function controlsHtml(tab, style, palettes, unit) {
        var out = '<p class="ta-viewer-hint">' + esc(TAB_HINTS[tab.tab] || "") + "</p>";
        if (tab.tab === "source_frame") return out;
        var temperature = tab.tab !== "view_angle";
        var symbol = temperature ? unitSymbol() : "°";
        var shown = function (x) { return temperature ? measure.shownTemp(x, unit) : x; };
        var current = palettes.filter(function (p) { return p.key === style.palette; })[0];
        out += '<div class="form-group"><label>Palette</label><select class="form-control input-sm" id="ta-viewer-palette">' +
            palettes.map(function (p) {
                return '<option value="' + esc(p.key) + '"' + (p.key === style.palette ? " selected" : "") + ">" + esc(p.label) + "</option>";
            }).join("") + "</select></div>";
        out += '<div class="ta-scale" id="ta-viewer-scale">' + legendHtml(current && current.color_map, shownRange(tab.tab, style.range, unit)) + "</div>";
        out += '<div class="ta-viewer-range">' +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-viewer-min" value="' + shown(style.range[0]) + '" title="Minimum">' +
            '<span>to</span>' +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-viewer-max" value="' + shown(style.range[1]) + '" title="Maximum">' +
            "<span>" + esc(symbol) + "</span>" +
            '<button type="button" class="btn btn-default btn-sm" id="ta-viewer-auto" title="The 2nd to 98th percentile of this mosaic">Auto</button></div>';
        out += '<div class="ta-viewer-range-error text-danger" id="ta-viewer-range-error"></div>';
        var s = tab.stats;
        if (s) out += '<div class="ta-message">This mosaic: ' +
            core.formatNumber(temperature ? core.convertTemp(s.min, unit) : s.min, 1) + " to " +
            core.formatNumber(temperature ? core.convertTemp(s.max, unit) : s.max, 1, " " + symbol) + "</div>";
        return out;
    }

    // The values under the cursor; frameUrl: the frame page's URL (without the frame), to open the frame of a click
    function readoutHtml(res, unit, frameUrl) {
        if (!res || !res.valid) return '<span class="ta-message">' + (res && res.reason === "outside_raster" ?
            "Outside the mosaic." : "No data here.") + "</span>";
        var rows = [];
        rows.push(["Temperature", res.temperature === null || res.temperature === undefined ? "no data" :
            measure.temp(res.temperature, unit)]);
        if (res.frame !== null && res.frame !== undefined) rows.push(["Frame", res.frame]);
        if (res.frame_pixel) rows.push(["Frame pixel", "x " + res.frame_pixel[0] + ", y " + res.frame_pixel[1]]);
        if (res.view_angle !== null && res.view_angle !== undefined) rows.push(["View angle", core.formatNumber(res.view_angle, 1, "°")]);
        var out = '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (r) {
            return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
        }).join("") + "</tbody></table>";
        if (frameUrl && res.frame) out += '<a class="btn btn-default btn-xs" href="' + esc(frameUrl + encodeURIComponent(res.frame)) +
            '"><i class="fa fa-image"></i> Open this frame</a>';
        return out;
    }

    // The correction's limits, those the server checks: the reflected temperature's in the user's unit
    var EMISSIVITY_RANGE = [0.1, 1];
    function reflectedRange() {
        return [-100, 1000].map(function (c) { return Math.round(core.convertTemp(c, "C") * 100) / 100; });
    }

    // The approximate correction: the emissivity and reflected temperature the mosaics were measured with, changeable;
    // params as typed (in the user's unit), baseline in the conversion's. Each field starts at the value measured
    // with (data-start), so its arrows step from there; one left at its start is not a change.
    function correctionHtml(params, baseline, unit) {
        baseline = Object.assign({}, baseline || {});
        baseline.reflected_temp = core.convertTemp(baseline.reflected_temp, unit);
        var input = function (id, key, step, range, label, suffix) {
            var start = core.formatNumber(baseline[key], key === "emissivity" ? 2 : 1);
            return '<div class="ta-correction-field"><label for="' + id + '">' + esc(label) + "</label>" +
                '<input type="number" step="' + step + '" min="' + range[0] + '" max="' + range[1] + '" class="form-control input-sm" id="' + id +
                '" value="' + esc(params[key] === undefined ? start : params[key]) + '" placeholder="' + esc(start) +
                '" data-start="' + esc(start) + '">' + (suffix ? "<span>" + esc(suffix) + "</span>" : "") + "</div>";
        };
        return input("ta-corr-emissivity", "emissivity", "0.01", EMISSIVITY_RANGE, "Emissivity", "") +
            input("ta-corr-reflected", "reflected_temp", "0.1", reflectedRange(), "Reflected temperature", unitSymbol()) +
            '<div class="text-danger" id="ta-corr-error"></div>' +
            '<p class="ta-message">Approximate: the mosaics are corrected with the thermal correction model, not measured again. ' +
            "The frames measure exactly (open one from the readout).</p>";
    }

    // The parameters a saved measurement can be measured again with: [key, label, step, isTemp]
    var PARAM_FIELDS = [["emissivity", "Emissivity", "0.01", false], ["reflected_temp", "Reflected temperature", "0.1", true]];

    // The correction from the fields: values as typed (the user's unit) and where each started; a value left at its
    // start, or emptied, is not sent. An out-of-range value gives the error and the field it is in.
    function readCorrection(values, starts) {
        var out = {}, limits = {emissivity: EMISSIVITY_RANGE, reflected_temp: reflectedRange()};
        var names = {emissivity: "The emissivity", reflected_temp: "The reflected temperature"};
        for (var key in limits) {
            var x = String(values[key] === undefined ? "" : values[key]).trim(), range = limits[key];
            if (x === "" || x === String((starts || {})[key])) continue;
            var n = Number(x);
            if (isNaN(n)) return {error: names[key] + " is not a number", field: key};
            if (n < range[0] || n > range[1]) {
                return {error: names[key] + " is between " + range[0] + " and " + range[1] + (key === "emissivity" ? "" : " " + unitSymbol()), field: key};
            }
            out[key] = x;
        }
        return {correction: out};
    }

    // What dji-thermal-cli reports about a mosaic: how many frames, how well they agree and line up
    function reportHtml(kind) {
        if (!kind) return "";
        var r = kind.report || {}, rows = [];
        rows.push(["Frames", kind.frames + " placed" + (kind.oblique ? ", " + kind.oblique + " oblique left out" : "") +
            (kind.unusable ? ", " + kind.unusable + " unusable" : "")]);
        rows.push(["Size", kind.width + " × " + kind.height + " px at " + core.formatNumber(kind.gsd_m * 100, 1, " cm")]);
        var seams = r.radiometric_seams;
        if (seams && seams.pixels) rows.push(["Seams", "median " + core.formatDelta(seams.median_abs_c, "C") + ", 95% under " +
            core.formatDelta(seams.p95_abs_c, "C")]);
        var mis = r.misalignment;
        if (mis && mis.pairs) rows.push(["Misalignment", "median " + core.formatNumber(mis.median_m * 100, 1, " cm") + ", 90% under " +
            core.formatNumber(mis.p90_m * 100, 1, " cm") + " (" + mis.pairs + " overlapping pairs)"]);
        var off = r.frame_offsets;
        if (off && off.offset_c && off.offset_c.min !== undefined) {
            rows.push(["Frame offsets", core.formatNumber(core.convertDelta(off.offset_c.min, "C"), 2) + " to " + core.formatDelta(off.offset_c.max, "C") +
                (off.normalized ? ", removed" : "")]);
        }
        var diff = off && off.overlap_difference_c;
        if (diff && diff.median_abs !== undefined) {
            rows.push(["Overlaps differ by", "median " + core.formatDelta(diff.median_abs, "C") +
                (diff.median_abs_after_offsets !== undefined ? ", " + core.formatDelta(diff.median_abs_after_offsets, "C") +
                 " without the offsets" : "")]);
        }
        var h = r.heights;
        if (h && h.range_m) {
            rows.push(["Heights", core.formatNumber(h.range_m[0], 1) + " to " + core.formatNumber(h.range_m[1], 1, " m") +
                " above the ground plane, " + (h.method === "DSM" ? "from the DSM " + (h.file || "") : "measured in " +
                h.observed_cells + " of " + h.cells + " cells of " + core.formatNumber(h.cell_m, 1, " m"))]);
        } else if (h && h.method === "plane") {
            rows.push(["Heights", "a ground plane" + (h.reason ? " (" + h.reason + ")" : "")]);
        }
        if (kind.normalization) rows.push(["Normalized to", "ambient " + core.formatTemp(kind.normalization[0], "C", 1) +
            ", reflected " + core.formatTemp(kind.normalization[1], "C", 1)]);
        var out = '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (row) {
            return "<tr><th>" + esc(row[0]) + "</th><td>" + esc(row[1]) + "</td></tr>";
        }).join("") + "</tbody></table>";
        return out;
    }

    function filesHtml(files, base) {
        if (!files || !files.length) return "";
        return '<ul class="ta-viewer-files">' + files.map(function (f) {
            return '<li><a href="' + esc(base + "/download?file=" + encodeURIComponent(f)) + '">' +
                '<i class="fa fa-download"></i> ' + esc(f) + "</a></li>";
        }).join("") + "</ul>";
    }

    // The status line above the map: the mosaics being built, failed, canceled or not built
    function statusHtml(v) {
        if (v.status === "converting") {
            return {text: "The images are being converted: the mosaics are built next.", cls: "text-muted"};
        }
        if (v.mosaic_status === "building") {
            var pct = Math.round((v.mosaic_progress || 0) * 100);
            return {text: '<div class="progress"><div class="progress-bar progress-bar-striped active" style="width: ' + Math.max(pct, 3) +
                '%;"></div></div> ' + esc(core.mosaicLabel(v)), cls: ""};
        }
        if (v.mosaic_status === "failed") return {text: '<i class="fa fa-exclamation-triangle"></i> The mosaics failed: ' + esc(v.mosaic_error), cls: "text-danger"};
        if (v.mosaic_status === "canceled") return {text: "Building the mosaics was canceled.", cls: "text-muted"};
        if (v.status !== "ready") return {text: "The images were not converted: there is nothing to make mosaics of.", cls: "text-muted"};
        if (v.mosaic_status !== "ready") return {text: "This conversion has no mosaics.", cls: "text-muted"};
        return {text: "", cls: ""};
    }

    function init(ctx) {
        var doc = ctx.doc, fetchFn = ctx.fetchFn, L = ctx.L;
        var page = doc.getElementById("ta-viewer");
        if (!page) return null;
        var $ = function (i) { return doc.getElementById(i); };
        var API = page.getAttribute("data-api"), id = page.getAttribute("data-id");
        var base = API + "conversions/" + id;
        var frameUrl = page.getAttribute("data-public") + "conversion/" + id + "/frame?frame=";
        var csrf = (page.querySelector("input[name=csrfmiddlewaretoken]") || {}).value;
        var v = null, tab = null, styles = {}, map = null, layer = null, legend = null, timer = null, hover = null, asked = 0;
        var drawing = null, pinned = false, isotherm = {mode: ""}, correction = {}, current = null, saved = [], typing = null;
        // The saved measurements ticked to compare, the one whose parameters are being changed, the current line's profile
        var compared = [], editing = null, profile = null;
        var measured = 0, wholeAsked = 0;
        // The legend's curve with equalization (the server's: see showCurve), and the last one asked for
        var curve = null, curveAsked = 0;
        var wanted = readView(ctx.search), outlined = null, footprint = null, outlining = 0;
        var win = doc.defaultView || root;
        var UNPIN = ' <button type="button" class="btn btn-link btn-xs" id="ta-viewer-unpin">Follow the cursor</button>';

        function send(u, method, data) {
            var opts = {method: method, credentials: "same-origin", headers: {"X-CSRFToken": csrf}};
            if (data !== undefined) {
                opts.headers["Content-Type"] = "application/json";
                opts.body = JSON.stringify(data);
            }
            return fetchFn(u, opts).then(core.readJson);
        }

        function status(s) {
            $("ta-viewer-status").className = "ta-status" + (s.cls ? " " + s.cls : "");
            $("ta-viewer-status").innerHTML = s.text || "";
        }

        function currentTab() {
            return (v.tabs || []).filter(function (t) { return t.tab === tab; })[0];
        }

        function isTemperature() { return TEMPERATURE_TABS.indexOf(tab) >= 0; }

        function style() {
            var t = currentTab(), group = styleGroup(tab);
            if (!styles[group]) {
                styles[group] = {palette: group === "view_angle" ? "viridis" : v.default_palette,
                                 range: defaultRange(t, group === "temperature" ? v.unit : null), adjust: defaultAdjust()};
            }
            return styles[group];
        }

        // The isotherm and correction the temperatures are asked with
        function isothermValue() {
            var r = measure.isothermParam(isotherm.mode, isotherm.a, isotherm.b, v.unit);
            return r.error ? "" : r.value;
        }

        function parameters() {
            var out = {};
            if (correction.emissivity !== undefined && correction.emissivity !== "") out.emissivity = correction.emissivity;
            if (correction.reflected_temp !== undefined && correction.reflected_temp !== "") out.reflected_temp = measure.typedTemp(parseFloat(correction.reflected_temp), v.unit);
            return out;
        }

        function extra() {
            return Object.assign({isotherm: isothermValue()}, parameters());
        }

        function setupMap() {
            if (map) return;
            map = L.map($("ta-viewer-map"), {maxZoom: 26});
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
            legend = mapLegend(L, map, doc);
            map.on("mousemove", function (e) {
                if (pinned) return;
                if (hover && root.clearTimeout) root.clearTimeout(hover);
                hover = root.setTimeout ? root.setTimeout(function () { readout(e.latlng); }, HOVER_MS) : readout(e.latlng);
            });
            map.on("mouseout", function () {
                if (pinned) return;
                if (hover && root.clearTimeout) root.clearTimeout(hover);
                asked++;
                $("ta-viewer-readout").innerHTML = '<span class="ta-message">Move the cursor over the mosaic.</span>';
            });
            drawing = measure.Drawing({
                L: L, map: map,
                toCoords: function (ll) { return [ll.lng, ll.lat]; },
                fromCoords: function (c) { return [c[1], c[0]]; },
                onDone: function (g, shape) { current = {geometry: g, target: tab, shape: shape}; renderTools(); measureCurrent(); },
                onChange: renderTools,
                onLineHover: function (coords) { if (profile) profile.near(coords); },
                // A click with no tool on keeps the values there (and its frame's link) until the next click
                onClick: function (e) {
                    pinned = true;
                    if (hover && root.clearTimeout) root.clearTimeout(hover);
                    readout(e.latlng, true);
                }
            });
        }

        function readout(latlng, pin) {
            var n = ++asked;
            fetchFn(base + "/mosaics/" + tab + "/point?lon=" + latlng.lng + "&lat=" + latlng.lat + extraQuery(parameters()),
                    {credentials: "same-origin"})
                .then(core.readJson).then(function (r) {
                    if (n !== asked) return;    // the cursor moved on
                    $("ta-viewer-readout").innerHTML = r.ok ? readoutHtml(r.data, v.unit, frameUrl) + (pin ? UNPIN : "") : "";
                    if (pin) outline(r.ok && r.data.valid && r.data.frame || null);
                });
        }

        // The view in the URL, so that a reload or a copied link keeps it: the tab, its palette and range, and the
        // frame outlined
        function writeView() {
            if (!win.history || !win.history.replaceState || !win.location) return;
            var view = {tab: tab, frame: outlined};
            if (tab !== "source_frame") {
                view.palette = style().palette;
                view.range = style().range;
                view.adjust = style().adjust;
            }
            win.history.replaceState(null, "", win.location.pathname + viewQuery(view));
        }

        // The frame's footprint outlined on the mosaic, what it contributes (null: none); fit: the map moves to it
        function outline(path, fit) {
            var n = ++outlining;
            if (footprint) map.removeLayer(footprint);
            footprint = null;
            outlined = path || null;
            writeView();
            if (!path) return Promise.resolve();
            return fetchFn(base + "/mosaics/footprint?frame=" + encodeURIComponent(path), {credentials: "same-origin"})
                .then(core.readJson).then(function (r) {
                    if (n !== outlining || !r.ok) return;
                    footprint = L.geoJSON(r.data, {style: {color: "#fff", weight: 2, opacity: 0.9, fill: false}, interactive: false});
                    footprint.addTo(map);
                    var b = footprint.getBounds();
                    if (fit && b.isValid()) map.fitBounds(b);
                }).catch(function () {
                    // the outline is simply not drawn then
                });
        }

        // The frame a link asked for: kept in the readout and outlined
        function showFrame(path) {
            pinned = true;
            $("ta-viewer-readout").innerHTML = '<table class="table table-condensed ta-viewer-values"><tbody><tr><th>Frame</th><td>' +
                esc(path) + "</td></tr></tbody></table>" + '<a class="btn btn-default btn-xs" href="' +
                esc(frameUrl + encodeURIComponent(path)) + '"><i class="fa fa-image"></i> Open this frame</a>' + UNPIN;
            return outline(path, true);
        }

        // The palette and range a link asked for, on the tab it opened
        function applyWanted() {
            if (tab === "source_frame") return;
            var s = style();
            if (wanted.palette && (v.palettes || []).some(function (p) { return p.key === wanted.palette; })) s.palette = wanted.palette;
            if (wanted.range) s.range = wanted.range;
            if (wanted.adjust) s.adjust = Object.assign({}, wanted.adjust, {equalize: wanted.adjust.equalize && isTemperature()});
        }

        function showLayer(fit) {
            var t = currentTab();
            var url = tileUrl(API, id, tab, style(), extra());
            if (!layer) {
                layer = L.tileLayer(url, {maxZoom: 26, maxNativeZoom: (t.maxzoom || 20) + 1, minZoom: 0,
                                          bounds: L.latLngBounds([t.bounds[1], t.bounds[0]], [t.bounds[3], t.bounds[2]])});
                layer.addTo(map);
            } else {
                layer.setUrl(url);
            }
            if (fit) map.fitBounds([[t.bounds[1], t.bounds[0]], [t.bounds[3], t.bounds[2]]]);
            showCurve();
        }

        // The legend's curve: with equalization, the server's (from the whole mosaic's histogram), else gamma's
        function showCurve() {
            var n = ++curveAsked, s = tab !== "source_frame" && style();
            curve = null;
            showScale();
            if (!s || !s.adjust.equalize || !isTemperature()) return;
            fetchFn(base + "/mosaics/" + tab + "/curve?rescale=" + s.range[0] + "," + s.range[1] + adjustQuery(s.adjust) +
                    extraQuery(parameters()), {credentials: "same-origin"})
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
            var a = style().adjust;
            if (a.equalize && curve) return curve;
            return a.gamma !== 1 || a.equalize ? toneShares(a.gamma) : null;
        }

        // The colour scale, on the map and in the panel, as the tab's palette and range now are
        function showScale() {
            var s = scaleShown();
            if (!s) return legend.set("");
            legend.set(legendHtml(s.colors, s.shown, s.caption, s.shares));
            if ($("ta-viewer-scale")) $("ta-viewer-scale").innerHTML = legendHtml(s.colors, s.shown, "", s.shares);
        }

        // The colour scale's colours and caption as they now are, or null on a tab without one
        function scaleShown() {
            if (tab === "source_frame") return null;
            var colors = ((v.palettes || []).filter(function (p) { return p.key === style().palette; })[0] || {}).color_map;
            return {colors: colors, shown: shownRange(tab, style().range, v.unit), shares: shares(),
                    caption: tab === "view_angle" ? "View angle, °" : "Temperature, " + unitSymbol()};
        }

        // The mosaic as shown, its saved measurements (and the one drawn, not saved yet) and colour scale, as a PNG
        function exportPng() {
            var el = $("ta-viewer-map"), size = map.getSize();
            var shapes = saved.filter(function (m) { return m.target === tab; }).map(function (m) {
                return shapeOnMap(map, m.geometry, function (c) { return [c[1], c[0]]; }, m.name);
            });
            if (current && !current.saved && current.target === tab && isTemperature()) {
                shapes.push(shapeOnMap(map, current.geometry, function (c) { return [c[1], c[0]]; }, ""));
            }
            var y = size.y / 2, metresPerPx = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([size.x, y])) / size.x;
            var taken = takenText(v.flown), today = new Date().toISOString().slice(0, 10);
            var canvas = viewCanvas({
                doc: doc, ratio: Math.max(1, root.devicePixelRatio || 1),
                title: [v.dataset_name, v.name, tabLabel(tab)].filter(Boolean).join(" · "),
                date: (taken ? "Flown " + taken + " · exported " : "Exported ") + today,
                panes: [{el: el, images: Array.prototype.slice.call(layer.getContainer().querySelectorAll("img")), shapes: shapes}],
                legend: scaleShown(), scale: scaleBar(metresPerPx, 120)
            });
            saveCanvas(doc, canvas, fileName([v.dataset_name, v.name, tabLabel(tab)], ".png"), function (error) {
                if (error) status({text: esc(error), cls: "text-danger"});
            });
        }

        function renderTools() {
            var on = isTemperature();
            $("ta-viewer-analysis").hidden = !on;
            if (!on) return;
            $("ta-viewer-tools").innerHTML = measure.toolbarHtml(drawing && drawing.tool(), drawing ? drawing.count() : 0);
        }

        function renderResult(res) {
            var el = $("ta-viewer-result");
            if (!current) {
                el.innerHTML = '<p class="ta-message">Choose a tool and draw on the mosaic.</p>';
                $("ta-measure-save").hidden = true;
                return;
            }
            el.innerHTML = res ? (current.saved ? '<div class="ta-message">Saved as <strong>' + esc(current.saved.name) + "</strong>" +
                (current.saved.values && current.saved.values.isotherm ? ", isotherm " + esc(measure.isothermText(current.saved.values.isotherm, v.unit)) : "") +
                "</div>" : "") + measure.resultHtml(res, v.unit, {shape: current.shape}) : '<p class="ta-message">Measuring…</p>';
            linkProfile(el, res);
            $("ta-measure-save").hidden = !(res && !current.saved && res.result && res.result.valid_pixels);
        }

        // A line's profile chart and the line on the map, their cursors moving together
        function linkProfile(el, res) {
            if (drawing) drawing.showCursor(null);
            profile = res ? measure.linkProfile(el, res, v.unit, false, function (i) {
                drawing.showCursor(i === null ? null : res.result.profile.points[i]);
            }) : null;
        }

        // The current drawing measured on the current mosaic, with the isotherm and correction
        function measureCurrent() {
            if (!current || !isTemperature()) return Promise.resolve();
            var n = ++measured;
            current.target = tab;
            current.saved = null;
            renderResult(null);
            return send(base + "/measure", "POST", {target: tab, geometry: current.geometry, isotherm: isothermValue(),
                                                    parameters: parameters()}).then(function (r) {
                if (n !== measured) return;
                if (!r.ok) {
                    $("ta-viewer-result").innerHTML = '<p class="text-danger">' + esc(core.errorText(r.data, "Could not measure.")) + "</p>";
                    return;
                }
                current.res = r.data;
                renderResult(r.data);
                drawing.show(current.geometry, r.data.result, v.unit);
            });
        }

        // The whole mosaic: its histogram and the isotherm's share, with the correction
        function measureWhole() {
            if (!isTemperature()) return Promise.resolve();
            var n = ++wholeAsked;
            return send(base + "/measure", "POST", {target: tab, geometry: null, isotherm: isothermValue(), parameters: parameters()})
                .then(function (r) {
                    if (n !== wholeAsked || !r.ok) return;
                    var a = r.data.result;
                    style().whole = a;
                    $("ta-viewer-whole").innerHTML = '<table class="table table-condensed ta-viewer-values"><tbody>' +
                        "<tr><th>Mean</th><td>" + esc(measure.temp(a.mean, v.unit)) + "</td></tr>" +
                        "<tr><th>2nd to 98th percentile</th><td>" + esc(measure.temp(a.percentiles && a.percentiles[0], v.unit, 1)) + " to " +
                        esc(measure.temp(a.percentiles && a.percentiles[1], v.unit, 1)) + "</td></tr>" +
                        (a.isotherm ? "<tr><th>In the isotherm</th><td>" + esc(core.formatNumber(a.isotherm.share * 100, 1, " %")) + "</td></tr>" : "") +
                        "</tbody></table>" + measure.histogramSvg(a.histogram, v.unit) +
                        (r.data.approximate ? '<p class="ta-message">Corrected (approximate).</p>' : "");
                });
        }

        function renderSaved() {
            compared = compared.filter(function (id) { return saved.some(function (m) { return m.id === id; }); });
            $("ta-viewer-measurements").innerHTML = measure.measurementsHtml(saved, v.unit, current && current.saved && current.saved.id,
                                                                             {compared: compared, editing: editing, fields: PARAM_FIELDS});
            $("ta-viewer-csv").hidden = !saved.length;
            $("ta-viewer-geojson").hidden = !saved.some(function (m) { return m.target !== "frame"; });
        }

        function loadSaved() {
            return fetchFn(base + "/measurements", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return;
                saved = r.data.measurements || [];
                renderSaved();
            });
        }

        function renderPanel() {
            var t = currentTab();
            $("ta-viewer-tabs").innerHTML = tabsHtml(v.tabs, tab);
            $("ta-viewer-controls").innerHTML = controlsHtml(t, style(), v.palettes || [], v.unit);
            var kind = (v.kinds || {})[t.kind];
            $("ta-viewer-report").innerHTML = reportHtml(kind) + filesHtml(kind && kind.files, base);
            if (tab === "source_frame") {
                $("ta-viewer-controls").innerHTML += '<div class="ta-message">' + (v.frames || []).length + " frames, " +
                    'coloured <span class="ta-viewer-swatch" style="background: ' + colorCss((v.frame_colors || [0])[0]) + ';"></span>' +
                    '<span class="ta-viewer-swatch" style="background: ' + colorCss((v.frame_colors || [0, 0])[1]) + ';"></span>' +
                    '<span class="ta-viewer-swatch" style="background: ' + colorCss((v.frame_colors || [0, 0, 0])[2]) + ';"></span>… in order: ' +
                    "the cursor names the frame (click to keep it and open the frame).</div>";
            }
            renderTools();
            renderImage();
            if (isTemperature()) {
                $("ta-viewer-isotherm").innerHTML = measure.isothermHtml(isotherm);
                $("ta-viewer-correction").innerHTML = correctionHtml(correction, (v.baselines || {})[t.kind], v.unit);
            }
        }

        // The Image section, as the tab's adjustments and range now are (none on the frames' tab)
        function renderImage() {
            if (!$("ta-viewer-image")) return;
            $("ta-viewer-image-section").hidden = tab === "source_frame";
            $("ta-viewer-image").innerHTML = tab === "source_frame" ? "" :
                imageHtml(style().adjust, sliderPositions(autoRange(), style().range), isTemperature());
        }

        // The range Auto gives: the whole mosaic's 2nd to 98th percentile (as corrected), else the tab's
        function autoRange() {
            var whole = style().whole;
            return whole && whole.percentiles && isTemperature() ?
                defaultRange({stats: {percentiles: whole.percentiles}}, v.unit) :
                defaultRange(currentTab(), isTemperature() ? v.unit : null);
        }

        // The brightness or contrast slider moved: the range follows (its fields and the legend at once)
        function slideRange() {
            var r = slidRange(autoRange(), parseFloat($("ta-image-brightness").value), parseFloat($("ta-image-contrast").value));
            var shown = function (x) { return isTemperature() ? measure.shownTemp(x, v.unit) : x; };
            style().range = isTemperature() ? r.map(function (x) { return measure.typedTemp(shown(x), v.unit); }) : r;
            $("ta-viewer-min").value = shown(style().range[0]);
            $("ta-viewer-max").value = shown(style().range[1]);
            $("ta-viewer-range-error").textContent = "";
            showScale();
        }

        // The image drawn again as the adjustments and range now are, and kept in the URL
        function redraw() {
            showLayer(false);
            writeView();
        }

        function render() {
            var s = statusHtml(v);
            status(s);
            $("ta-viewer-subtitle").textContent = (v.description || "") + (v.stripped ? " · location stripped from the downloads" : "");
            $("ta-viewer-build").hidden = !(v.status === "ready" && v.mosaic_status !== "building");
            $("ta-viewer-build").innerHTML = '<i class="fa fa-th"></i> ' + (v.mosaic_status === "ready" ? "Build the mosaics again" : "Build mosaics");
            $("ta-viewer-cancel").hidden = !(v.status === "converting" || v.mosaic_status === "building");
            $("ta-viewer-frames").hidden = v.status !== "ready";
            $("ta-viewer-frames").setAttribute("href", frameUrl.replace(/\?frame=$/, ""));
            var ready = v.mosaic_status === "ready" && (v.tabs || []).length > 0;
            $("ta-viewer-main").hidden = !ready;
            $("ta-viewer-png").hidden = !ready;
            if ($("ta-viewer-compare")) $("ta-viewer-compare").hidden = !ready;
            if (!ready) return;
            var fit = !map;
            if (fit && wanted.tab) tab = wanted.tab;
            if (!tab || !currentTab()) tab = v.tabs[0].tab;
            if (fit) applyWanted();
            setupMap();
            renderPanel();
            showLayer(fit);
            writeView();
            if (fit) {
                renderResult(null);
                measureWhole();
                loadSaved();
                if (wanted.frame) showFrame(wanted.frame);
            }
        }

        function load() {
            if (timer && root.clearTimeout) root.clearTimeout(timer);
            return fetchFn(base + "/mosaics", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return status({text: "Could not load the mosaics.", cls: "text-danger"});
                var wasReady = v && v.mosaic_status === "ready";
                v = r.data;
                if (!wasReady && v.mosaic_status === "ready" && layer) {
                    styles = {};    // rebuilt: start again from the new mosaics' ranges
                }
                render();
                var busy = v.status === "converting" || v.mosaic_status === "building";
                timer = busy && root.setTimeout ? root.setTimeout(load, POLL_MS) : null;
            });
        }

        function applyRange() {
            var r = parseRange($("ta-viewer-min").value, $("ta-viewer-max").value, isTemperature() ? v.unit : null);
            $("ta-viewer-range-error").textContent = r.error || "";
            if (r.error) return;
            style().range = r.range;
            renderImage();
            redraw();
        }

        // The correction's fields read: an error marks its field and keeps the mosaic as it is
        function applyCorrection() {
            if (typing) root.clearTimeout(typing);
            typing = null;
            var fields = {emissivity: $("ta-corr-emissivity"), reflected_temp: $("ta-corr-reflected")};
            if (!fields.emissivity || !fields.reflected_temp) return;
            var values = {}, starts = {};
            for (var key in fields) {
                values[key] = fields[key].value;
                starts[key] = fields[key].getAttribute("data-start");
            }
            var r = readCorrection(values, starts);
            for (var k in fields) fields[k].parentNode.classList.toggle("has-error", r.field === k);
            $("ta-corr-error").textContent = r.error || "";
            if (r.error) return;
            if (JSON.stringify(r.correction) === JSON.stringify(correction)) return;
            correction = r.correction;
            temperaturesChanged();
        }

        // The isotherm or correction changed: the tiles, the whole mosaic and the current measure follow
        function temperaturesChanged() {
            showLayer(false);
            measureWhole();
            measureCurrent();
        }

        // A saved measurement measured again with the parameters in its form (empty: the conversion's own)
        function remeasure(id, form) {
            var values = {};
            form.querySelectorAll("[data-param-field]").forEach(function (f) { values[f.getAttribute("data-param-field")] = f.value; });
            var r = readCorrection(values, {}), error = form.querySelector("[data-params-error]");
            if (r.error) { error.textContent = r.error; return Promise.resolve(); }
            // A frame's other parameters (distance, humidity, …) are kept
            var m = saved.filter(function (x) { return x.id === id; })[0], p = Object.assign({}, (m && m.parameters) || {});
            PARAM_FIELDS.forEach(function (f) { delete p[f[0]]; });
            if (r.correction.emissivity !== undefined) p.emissivity = Number(r.correction.emissivity);
            if (r.correction.reflected_temp !== undefined) p.reflected_temp = measure.typedTemp(parseFloat(r.correction.reflected_temp), v.unit);
            error.textContent = "Measuring…";
            return send(base + "/measurements/" + id, "PATCH", {parameters: p}).then(function (res) {
                if (!res.ok) { error.textContent = core.errorText(res.data, "Could not measure again."); return; }
                editing = null;
                if (current && current.saved && current.saved.id === id) {
                    current.saved = res.data;
                    current.res = res.data.values;
                    renderResult(res.data.values);
                    drawing.show(current.geometry, (res.data.values || {}).result, v.unit);
                }
                return loadSaved();
            });
        }

        function showSaved(m) {
            if (TEMPERATURE_TABS.indexOf(m.target) >= 0 && m.target !== tab) {
                tab = m.target;
                renderPanel();
                showLayer(false);
                measureWhole();
                writeView();
            }
            current = {geometry: m.geometry, target: m.target, saved: m, res: m.values, shape: (m.values || {}).shape};
            renderResult(m.values);
            drawing.show(m.geometry, (m.values || {}).result, v.unit);
            renderSaved();
        }

        page.addEventListener("click", function (e) {
            var closest = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
            var a = closest("[data-tab]");
            if (a) {
                e.preventDefault();
                tab = a.getAttribute("data-tab");
                if (drawing) drawing.stop();
                renderPanel();
                showLayer(false);
                measureWhole();
                if (current && isTemperature()) measureCurrent();
                writeView();
                return;
            }
            if (closest("#ta-viewer-auto") || closest("#ta-image-reset")) {
                style().range = autoRange();
                if (closest("#ta-image-reset")) style().adjust = defaultAdjust();
                renderPanel();
                redraw();
                return;
            }
            var t = closest("[data-tool]");
            if (t) {
                var name = t.getAttribute("data-tool");
                if (drawing.tool() === name) drawing.stop();
                else drawing.start(name);
                renderTools();
                return;
            }
            var act = closest("[data-tool-act]");
            if (act) {
                if (act.getAttribute("data-tool-act") === "finish") drawing.finish();
                else drawing.stop();
                renderTools();
                return;
            }
            if (closest("#ta-viewer-unpin")) {
                pinned = false;
                outline(null);
                $("ta-viewer-readout").innerHTML = '<span class="ta-message">Move the cursor over the mosaic.</span>';
                return;
            }
            var show = closest("[data-show]");
            if (show) {
                e.preventDefault();
                var m = saved.filter(function (x) { return String(x.id) === show.getAttribute("data-show"); })[0];
                if (m) showSaved(m);
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
                var id = Number(par.getAttribute("data-params"));
                editing = editing === id ? null : id;
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
                        if (current && current.saved && current.saved.id === item.id) current.saved = null;
                    return loadSaved();
                });
                return;
            }
            if (closest("#ta-measure-save-btn")) {
                var nameEl = $("ta-measure-name"), label = nameEl.value.trim();
                if (!label) { $("ta-measure-error").textContent = "Name the measurement to save it"; return; }
                send(base + "/measurements", "POST", {name: label, target: current.target, geometry: current.geometry, shape: current.shape,
                                                       isotherm: isothermValue(), parameters: parameters()}).then(function (r) {
                    if (!r.ok) { $("ta-measure-error").textContent = core.errorText(r.data, "Could not save the measurement."); return; }
                    $("ta-measure-error").textContent = "";
                    nameEl.value = "";
                    current.saved = r.data;
                    renderResult(r.data.values);
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
            var id = e.target.id;
            if (id === "ta-viewer-palette") {
                style().palette = e.target.value;
                renderPanel();
                showLayer(false);
                writeView();
            } else if (id === "ta-viewer-min" || id === "ta-viewer-max") {
                applyRange();
            } else if (id === "ta-image-brightness" || id === "ta-image-contrast") {
                slideRange();
                redraw();
            } else if (id === "ta-image-gamma" || id === "ta-image-sharpen") {
                style().adjust[id === "ta-image-gamma" ? "gamma" : "sharpen"] = id === "ta-image-gamma" ?
                    sliderGamma(e.target.value) : parseFloat(e.target.value) || 0;
                redraw();
            } else if (id === "ta-image-tone") {
                style().adjust.equalize = e.target.value === "equalized";
                redraw();
            } else if (id === "ta-iso-mode" || id === "ta-iso-a" || id === "ta-iso-b") {
                isotherm = {mode: $("ta-iso-mode").value, a: $("ta-iso-a").value, b: $("ta-iso-b").value};
                if (id === "ta-iso-mode" && isotherm.mode && isotherm.a === "") {
                    // Starts from the top of the range: the hottest part shows (typed in the user's unit)
                    var lo = core.convertTemp(style().range[0], v.unit), hi = core.convertTemp(style().range[1], v.unit);
                    isotherm.a = Math.round((hi - (hi - lo) / 4) * 10) / 10;
                    isotherm.b = Math.round(hi * 100) / 100;
                }
                var r = measure.isothermParam(isotherm.mode, isotherm.a, isotherm.b, v.unit);
                if (id === "ta-iso-mode") $("ta-viewer-isotherm").innerHTML = measure.isothermHtml(isotherm);
                $("ta-iso-error").textContent = r.error || "";
                if (!r.error) temperaturesChanged();
            } else if (id === "ta-corr-emissivity" || id === "ta-corr-reflected") {
                applyCorrection();
            }
        });
        // Typing in the correction redraws once it pauses; the arrows and Enter (change) at once. A slider dragged shows
        // its value (and the range and legend) as it goes, and redraws when let go (change).
        page.addEventListener("input", function (e) {
            var id = e.target.id;
            if (id === "ta-image-brightness" || id === "ta-image-contrast") return slideRange();
            if (id === "ta-image-gamma") {
                $("ta-image-gamma-value").textContent = sliderGamma(e.target.value).toFixed(2);
                style().adjust.gamma = sliderGamma(e.target.value);
                if (!style().adjust.equalize) showScale();
                return;
            }
            if (id === "ta-image-sharpen") return ($("ta-image-sharpen-value").textContent = e.target.value);
            if (id !== "ta-corr-emissivity" && id !== "ta-corr-reflected") return;
            if (typing) root.clearTimeout(typing);
            typing = root.setTimeout ? root.setTimeout(applyCorrection, TYPING_MS) : null;
        });
        $("ta-viewer-build").addEventListener("click", function () {
            send(base + "/mosaics", "POST").then(function (r) {
                if (!r.ok) return status({text: esc(core.errorText(r.data, "Could not build the mosaics.")), cls: "text-danger"});
                return load();
            });
        });
        // Enter finishes the shape being drawn and Esc cancels it
        doc.addEventListener("keydown", function (e) {
            if (doc.documentElement.contains(page) && measure.drawingKey(e, drawing)) renderTools();
        });
        foldSections(doc, page, "thermal-analyzer.viewer.folded");
        $("ta-viewer-png").addEventListener("click", function () { if (map && layer) exportPng(); });
        $("ta-viewer-cancel").addEventListener("click", function () {
            send(base + "/cancel", "POST").then(load);
        });

        return load().then(function () { return {reload: load}; });
    }

    var api = {tabLabel: tabLabel, unitSymbol: unitSymbol, styleGroup: styleGroup, defaultRange: defaultRange,
               parseRange: parseRange, readView: readView, viewQuery: viewQuery, foldSections: foldSections, extraQuery: extraQuery, tileUrl: tileUrl, gradientCss: gradientCss,
               defaultAdjust: defaultAdjust, adjustQuery: adjustQuery, toneShares: toneShares, slidRange: slidRange,
               sliderPositions: sliderPositions, imageHtml: imageHtml, sliderGamma: sliderGamma, gradientStops: gradientStops,
               scaleTicks: scaleTicks, takenText: takenText, scaleBar: scaleBar, fileName: fileName, viewCanvas: viewCanvas,
               saveCanvas: saveCanvas, shapeOnMap: shapeOnMap, shownRange: shownRange, legendHtml: legendHtml, mapLegend: mapLegend,
               tabsHtml: tabsHtml, controlsHtml: controlsHtml, readoutHtml: readoutHtml, correctionHtml: correctionHtml,
               readCorrection: readCorrection,
               reportHtml: reportHtml, statusHtml: statusHtml, filesHtml: filesHtml, init: init};
    root.ThermalAnalyzerViewer = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});

if (typeof window !== "undefined" && window.document && window.fetch && window.L) {
    window.ThermalAnalyzerViewer.init({doc: document, fetchFn: window.fetch.bind(window), L: window.L,
                                       basemaps: JSON.parse((document.getElementById("ta-basemaps") || {}).textContent || "[]"),
                                       search: window.location.search});
}
