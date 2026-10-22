# Icon Composer layers (macOS 26 / iOS 26 "Liquid Glass" icon)

Apple's Icon Composer (bundled with Xcode 26: Xcode > Open Developer Tool > Icon Composer) builds a layered
`.icon` file. macOS then adds the glass shine, depth, blur and shadow itself, and derives the Dark, Clear and
Tinted looks. This folder holds the separate layers so the icon can be assembled there.

Every file is a 1024 x 1024 canvas where the whole canvas is the icon shape (Icon Composer applies the rounded
mask). SVG and PNG versions are identical; prefer the SVG (stays sharp at every size).

| Appearance (macOS / iOS) | SKYCOT variant | Layers to show                                                      |
| ------------------------ | -------------- | ------------------------------------------------------------------- |
| Default (light)          | day            | day-1-background, day-2-ground-shadow, day-3-mascot                 |
| Dark                     | dusk           | dusk-1-background, dusk-2-ground-shadow, dusk-3-mascot, dusk-4-star |
| Clear (light and dark)   | minimal        | minimal-1-mascot-white only                                         |
| Tinted (light and dark)  | minimal        | minimal-1-mascot-white only                                         |

`minimal-0-background-blue.png` is an optional flat SKYCOT-blue background if you ever want a minimal-only icon.

## Assembling `SKYCOT.icon`

1. Open Icon Composer and create a new document. Tick macOS (and iOS if wanted).
2. Drag the layers in from bottom to top. Keep each in its own group so the glass treats the star and the
   mascot as separate pieces of glass:
   - Group "Sky": `day-1-background.svg` and `dusk-1-background.svg` (or set the background as the document Fill).
   - Group "Shadow": `day-2-ground-shadow.svg`, `dusk-2-ground-shadow.svg`.
   - Group "Mascot": `day-3-mascot.svg`, `dusk-3-mascot.svg`, `minimal-1-mascot-white.svg`.
   - Group "Star": `dusk-4-star.svg`.
3. Use the appearance switcher at the bottom of the canvas (Default / Dark / Mono). For each appearance, select a
   layer and set its Opacity to 0% (or untick it) so only the layers in the table above remain visible:
   - Default: only the day layers.
   - Dark: only the dusk layers (this is how "dusk" becomes the system dark icon).
   - Mono (drives Clear and Tinted): only `minimal-1-mascot-white`. Its eye holes let the glass show through.
4. Check the preview at small sizes. The mascot must stay centred and the same size in every appearance
   (the minimal layer was scaled to the day mascot's footprint on purpose).
5. Save as `SKYCOT.icon` and add it to the Xcode project / app bundle as the app icon.

## If the build tool cannot use `.icon` yet

Ship `../AppIcon-day.icns` as the bundle icon (Electron: `mac.icon` in the electron-builder config).
macOS 26 shows it in its legacy treatment. The dusk swap can then be done at runtime by setting the Dock
icon (Electron `app.dock.setIcon()` with a PNG from `../AppIcon-dusk.iconset/icon_512x512@2x.png`) at local
civil dusk, and back at dawn. Finder, Launchpad and the App Store always show the bundle icon (day).
