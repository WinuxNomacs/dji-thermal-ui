# Make a project and a flight

A project holds a site's flights; a flight holds the images of one flight of the drone. This tutorial makes both and
uploads the images, which dji-thermal-cli then analyzes.

## 1. Make a project

On the projects page (the app opens on it), press **New Project** at its top right.

![The projects page](../assets/screenshots/projects-empty.png)

Then give it a name and, if you like, a description.
Its location is optional: search an address or click the site on the map, or leave it for later.

![The New project dialog, with a name and a description](../assets/screenshots/new-project.png)

Press **Create**. The project's page opens, with no flights yet.

![A new project's page, with no flights](../assets/screenshots/project-empty.png)

## 2. Make a flight

Press **New Flight**, name the flight, then choose its images: **Choose images** for files picked one by one, or
**Choose a folder** for a whole folder. Choose the thermal R-JPEGs, and the visual images (`_V` or `_W`) and videos
the drone took with them if you have them: other files are left out. The dialog counts the images chosen.

![The New thermal flight dialog, with 654 images chosen](../assets/screenshots/new-flight.png)

Press **Create**. The images are uploaded, with their progress.

![The upload's progress](../assets/screenshots/new-flight-uploading.png)

## 3. Wait for the analysis

When the images are in, the flight's page opens and dji-thermal-cli reads them.

![The flight's page while the images are read](../assets/screenshots/flight-analyzing.png)

Next: [read the analysis](analysis.md).
