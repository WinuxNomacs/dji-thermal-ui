const app = require('../app');

const header = unit => {
    document.body.innerHTML = '<select id="ta-app-unit" data-api="/api/">' +
        ['F', 'C', 'K'].map(u => '<option value="' + u + '"' + (u === unit ? ' selected' : '') + '>' + u + '</option>').join('') +
        '</select>';
    window.__temperatureUnit = unit;
    return document.getElementById("ta-app-unit");
};
const ticks = async (n = 10) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

describe("the header", () => {
    it("reads the CSRF token from the cookie", () => {
        expect(app.csrfToken({cookie: "a=1; csrftoken=abc%3D; b=2"})).toBe("abc=");
        expect(app.csrfToken({cookie: "csrftoken=xyz"})).toBe("xyz");
        expect(app.csrfToken({cookie: ""})).toBe("");
    });

    it("saves the unit as a preference, with the CSRF token", async () => {
        const fetchFn = jest.fn(() => Promise.resolve({ok: true}));
        await app.saveUnit(fetchFn, "/api/", "tok", "K");
        expect(fetchFn).toHaveBeenCalledWith("/api/preferences", expect.objectContaining({method: "PUT"}));
        const options = fetchFn.mock.calls[0][1];
        expect(options.headers["X-CSRFToken"]).toBe("tok");
        expect(JSON.parse(options.body)).toEqual({unit: "K"});
        await expect(app.saveUnit(jest.fn(() => Promise.resolve({ok: false, status: 400})), "/api/", "tok", "K"))
            .rejects.toThrow(/400/);
    });

    it("saves the unit chosen and shows the page again in it", async () => {
        const select = header("F");
        const fetchFn = jest.fn(() => Promise.resolve({ok: true}));
        const reload = jest.fn();
        app.init(document, fetchFn, reload);
        select.value = "C";
        select.dispatchEvent(new Event("change"));
        expect(select.disabled).toBe(true);
        await ticks();
        expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({unit: "C"});
        expect(reload).toHaveBeenCalled();
    });

    it("puts the unit back when it could not be saved", async () => {
        const select = header("F");
        const reload = jest.fn();
        app.init(document, jest.fn(() => Promise.resolve({ok: false, status: 500})), reload);
        select.value = "K";
        select.dispatchEvent(new Event("change"));
        await ticks();
        expect(select.disabled).toBe(false);
        expect(select.value).toBe("F");
        expect(reload).not.toHaveBeenCalled();
    });

    it("does nothing on a page without the header", () => {
        document.body.innerHTML = "";
        expect(() => app.init(document)).not.toThrow();
    });
});
