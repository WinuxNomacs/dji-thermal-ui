# First run

```
dji-thermal-ui
```

This serves the app on http://127.0.0.1:8080 and opens it in the browser, on the projects page. Press Ctrl+C to
stop it. A job still running when the server stops (an analysis, a conversion, a mosaic) is marked as interrupted the
next time it starts. `--port` serves on another port, `--no-browser` leaves the browser closed, and `--data-dir` keeps
the data in another folder: see [The command](../reference/command.md).

The server listens on 127.0.0.1 only, for the one person using the computer: there are no logins or accounts.

## The first time

The data folder is made where your system keeps applications' data (see
[Where the data lives](../reference/data.md)), with the database and a secret key in it, and a project called
**Default Project**, which you can rename. Make a flight there with **New Flight**, or make a project of your own
first: the [Quickstart](../quickstart/index.md) goes through it.

## What needs the internet

Everything works offline except:

- **The maps under the mosaics**, loaded from Esri, OpenStreetMap or Mapbox as you look at them (see
  [The maps under the mosaics](../guide/maps.md)). A map can show no basemap at all.
- **A project's location**, searched for on OpenStreetMap's [Nominatim](https://nominatim.org/): the text searched,
  or the point clicked, is sent to it by the app, at most once a second. The addresses are © OpenStreetMap
  contributors, under the ODbL.
- **WebODM**, when you connect one (see [WebODM](../guide/webodm.md)), which may be on your own computer.

This documentation is served by the app itself, from the header's **Help**, so it works offline and matches the
version installed.
