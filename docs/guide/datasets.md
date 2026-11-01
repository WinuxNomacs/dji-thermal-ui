# Datasets

A dataset is a flight's images converted to temperatures with dji-thermal-cli's settings, with its mosaics. They are
on the flight page's **Datasets** tab, where the page opens once there is one.

## Converting

The tab lists the flight's datasets first, then the **New dataset** bar: the settings summed up and the **Convert**
button. **Change settings** shows them all, each output named for what it is for, with dji-thermal-cli's name beside
it. A [problem](flights.md#problems) a setting fixes opens this form with that setting already changed.

A dataset left unnamed is named after the settings that change its temperatures or mosaics ("Emissivity 0.9 ·
normalized", else "Default settings"), as the name field shows before converting.

You can keep several datasets side by side, cancel one while it converts, or download it.

## The outputs

- **Temperatures** as TIFFs, which [WebODM](webodm.md) can process.
- **The mosaics**, opened in the [viewer](mosaics.md).
- **The visual mosaic:** when a flight has visual images, a dataset builds their mosaic with the thermal ones ("And the
  visual mosaic", on by default), at the visual camera's own resolution. dji-thermal-cli places each visual image
  where its thermal frame is in the thermal mosaic, after measuring and correcting the small angle between the two
  cameras, so the two mosaics line up. Zoom camera images are left out. It is in the downloads beside the thermal
  mosaics.
- **R-JPEG** (`rjpeg`) writes each frame again as an R-JPEG with the dataset's measurement parameters in DJI's header,
  so DJI's own tools measure it as this app does. Its picture, what photo viewers show, is coloured with the dataset's
  palette or kept as DJI's.

## A dataset's card

Each dataset on the tab has a card with its settings and progress. Its button is **View mosaics** once the mosaics
are built (else **Frames**, or **Cancel** while it converts), and its menu (**More**) has:

- **Frames**, the [frames explorer](frames.md), and **Compare with…**, the [compare page](compare.md).
- **Download all**, the dataset's files as a zip, made as it downloads.
- **Files**, its files listed on the card, each opening its frame.
- **Use settings**, its settings put back in the New dataset form.
- **Build mosaics**, when they were not built with it.
- **Process in WebODM** (see [WebODM](webodm.md)).
- **Rename** and **Delete**.
