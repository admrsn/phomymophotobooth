# Phomymo Photobooth

A browser-based DIY photobooth for Android Chrome and Phomemo thermal printers. Captures 5 photos in rapid succession with a visual countdown, stitches them into a classic film-strip layout with white borders, and prints directly to your Phomemo thermal printer via Web Bluetooth—no drivers, no apps required.

Perfect for parties, events, and gatherings where guests can walk up, tap a button, and take home a printed strip of memories.

## Quick Start

### Access the Photobooth

1. **Host via GitHub Pages**  
   The photobooth is deployed at: `https://<yourusername>.github.io/phomymophotobooth/src/web/photobooth.html`

2. **Open in Android Chrome**  
   - Open the URL on an Android device running Chrome
   - Wait for the camera to initialize (you'll see "Ready! Tap Start to begin.")

3. **Install as a Standalone App (Recommended)**  
   - Tap the three-dot menu in Chrome
   - Select **"Install app"** or **"Add to Home Screen"**
   - The photobooth will appear as a full-screen kiosk app
   - Subsequent launches skip the browser chrome for a cleaner UX

### How to Use

1. **Tap START** — The countdown begins
2. **Smile!** — A giant 3-2-1 countdown appears on screen
3. **Photo captured** — Automatically repeats 5 times
4. **Wait for stitching** — The app combines all 5 photos into a vertical film strip
5. **Printer connection** — If your printer isn't paired yet, the Web Bluetooth device picker appears (select your Phomemo printer by name)
6. **Print!** — The strip prints automatically

The entire process takes about 10–15 seconds from start to printed output.

## Architecture & Technical Details

### The Capture Loop

```
[3-second countdown] → [Capture frame 1] → [3-second countdown] → [Capture frame 2] ...
                                                                         ↓
                                        [Repeat 5 times total]
                                                ↓
                                    [Stitch 5 photos vertically]
                                                ↓
                                        [Dither & print]
```

**Key technical steps:**

1. **Camera Feed** (`photobooth.js::init()`)
   - Requests front-facing camera via `navigator.mediaDevices.getUserMedia()`
   - Streams to a `<video>` element that fills the screen
   - Front-facing camera is automatically mirrored for selfie-style operation

2. **Countdown & Capture** (`photobooth.js::showCountdown()`, `capturePhoto()`)
   - Displays a large, pulsing countdown (3, 2, 1) with a CSS animation
   - After countdown, captures the current video frame onto a temporary canvas
   - Photo stored as JPEG data URL for memory efficiency
   - 500ms delay between captures to give the printer time to advance

3. **Photo Stitching** (`photobooth.js::stitchPhotos()`, `createComposite()`)
   - Loads all 5 JPEG data URLs as `Image` objects
   - Combines them onto a single off-screen canvas
   - Layout: **5 photos stacked vertically with 20px solid white borders**
     - 20px margin above first photo
     - 20px spacing between each photo
     - 20px margin below last photo
   - Resulting canvas: typically 480–600px wide × 2000–2400px tall (depends on video resolution)

4. **Dithering & Print** (`photobooth.js::getRasterDataFromCanvas()`)
   - Passes the composite canvas to the existing Phomymo printing engine
   - `CanvasRenderer` applies **Floyd-Steinberg dithering** to convert full-color photos to 1-bit monochrome
   - Dithering preserves detail and contrast in the grayscale thermal print
   - Converts to raster byte array (72 bytes per line = 576 pixels, standard Phomemo width)
   - Sends via Web Bluetooth (`PrinterProtocol.printRaster()`)

### DOM & Component Structure

```
photobooth.html
├── <video id="camera-feed">          — Live camera stream (mirrored)
├── .ui-layer                          — Overlay for UI elements
│   ├── #status-display                — Status/progress text
│   ├── #countdown                     — Large countdown numbers (3, 2, 1)
│   └── .button-area → #start-button   — Main START button
├── #composite-canvas (hidden)         — Off-screen stitched photo strip
└── <script type="module">
    └── import PhotoboothApp from './photobooth.js'
        ├── BLETransport (./ble.js)    — Web Bluetooth connection
        ├── CanvasRenderer (./canvas.js) — Dithering engine
        └── PrinterProtocol (./printer.js) — Print commands
```

### State Management

The `PhotoboothApp` class maintains:
- `isCapturing` — Prevents multiple concurrent sessions
- `capturedPhotos[]` — Array of JPEG data URLs
- `ble` — Singleton `BLETransport` for Bluetooth
- `printerProtocol` — Lazy-initialized `PrinterProtocol` instance

### Browser Requirements

- **Android Chrome** (Android 6+)  
  Web Bluetooth API and camera access fully supported
- **Desktop Chrome/Edge** (Windows, macOS)  
  Works for testing; full-screen kiosk mode recommended on Android
- **iOS Safari**  
  Not supported (Web Bluetooth unavailable; camera permissions model different)
- **Firefox**  
  Not supported (Web Bluetooth not implemented)

## Running Locally (for Development)

To run locally with HTTPS (required for Web Bluetooth):

```bash
# Clone and navigate
git clone https://github.com/admrsn/phomymophotobooth.git
cd phomymophotobooth/src/web

# Option 1: Python HTTP server (HTTP on localhost)
python3 -m http.server 8080
# Open http://localhost:8080/photobooth.html

# Option 2: Node.js with HTTPS (recommended for full BLE testing)
# Install a local HTTPS server, e.g., https://www.npmjs.com/package/http-server
npx http-server --ssl
# Open https://localhost:8080/photobooth.html
```

**Note:** Web Bluetooth API requires either:
- `localhost` (any port)
- HTTPS domain with valid certificate
- Android Chrome on an HTTPS GitHub Pages URL

## Supported Printers

The photobooth works with all Phomemo thermal printers that support the BLE protocol:

| Model | Width | Notes |
|-------|-------|-------|
| P12 / P12 Pro | 12mm | Continuous tape |
| M02 / M02S / M02X | 48mm | Mini printers |
| M110 / M120 | 48mm | Label makers |
| M200 / M250 | 75mm | Mid-size labels |
| M220 / M221 / M260 | 72mm | Wide labels |
| D30 / D35 / D50 / D110 | 12–15mm | Rotated protocol (auto-handled) |

The app auto-detects your printer model and configures the correct print width and DPI. See the original [Phomymo README](#original-phomymo-readme) for a complete printer list and manual setup instructions.

## Customization

### Adjust Photo Timing

Edit `photobooth.js`:
```javascript
this.photoCount = 5;              // Number of photos
this.countdownDuration = 3;       // Seconds before each capture
this.borderSize = 20;             // Pixels of white border
```

### Change Button Text & Colors

Edit `photobooth.html`:
```html
#start-button {
    background-color: #2563eb;    /* Blue */
    /* Change to your brand color */
}
```

### Adjust Print Width

Edit `photobooth.js::getRasterDataFromCanvas()`:
```javascript
const printerWidthBytes = 72;     // 576 pixels (72 × 8-bit bytes)
// Standard printers: 72 bytes
// Wide printers (M260, M221): 72 bytes
// Narrow printers (M110): 48 bytes
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Camera won't load | Grant camera permissions; check browser console for errors |
| Photos not capturing | Ensure video stream has loaded; check `photoCount` |
| Bluetooth connection fails | Restart phone & printer; ensure printer is in pairing mode |
| Print quality issues | Verify dithering settings; test with sample image first |
| App crashes on large photos | Reduce camera resolution or compress JPEG quality |

## Known Limitations

- **iOS**: Not supported due to lack of Web Bluetooth API
- **Firefox**: Not supported due to lack of Web Bluetooth API
- **Large video resolutions**: May cause memory/performance issues on older Android devices; the app defaults to 1280×720
- **Print width**: Automatically set per printer; manual width changes require code edits
- **Offline printing**: Requires Bluetooth pairing beforehand; unpaired printers will trigger the device picker on first use

## Project Structure

```
phomymophotobooth/
├── src/
│   └── web/
│       ├── photobooth.html        ← Main kiosk UI
│       ├── photobooth.js          ← Photobooth app logic
│       ├── index.html             ← Original Phomymo label designer
│       ├── app.js                 ← Label designer app logic
│       ├── canvas.js              ← Dithering & rendering engine
│       ├── ble.js                 ← Web Bluetooth transport
│       ├── printer.js             ← Print protocols
│       ├── constants.js           ← Shared constants
│       ├── printers.json          ← Printer definitions
│       └── [other files]          ← Label designer support files
├── README.md                      ← This file
└── LICENSE
```

## Original Phomymo README

This photobooth is built on top of **Phomymo**, a browser-based label designer for Phomemo printers. The core Bluetooth communication, print protocols, and dithering engine are from the original Phomymo project.

For detailed information on supported printers, label design features, templates, and advanced print settings, see the original project:

**[Phomymo Label Designer](https://phomymo.affordablemagic.net)** — https://github.com/transcriptionstream/phomymo

### Original Acknowledgments

Protocol research and inspiration:

- [vivier/phomemo-tools](https://github.com/vivier/phomemo-tools) - CUPS driver with reverse-engineered protocol
- [yaddran/thermal-print](https://github.com/yaddran/thermal-print) - Printer status query commands
- [ooki1jp](https://github.com/vivier/phomemo-tools/issues/27#issuecomment-3850158579) - M04AS/M04S protocol reverse-engineering

Libraries: [JsBarcode](https://github.com/lindell/JsBarcode), [QRCode.js](https://github.com/davidshimjs/qrcodejs), [jsPDF](https://github.com/parallax/jsPDF)

### License

MIT License — see LICENSE file for details.

This project is a derivative of Phomymo (original by transcriptionstream). All original code and protocols remain under the MIT license.

---

## Contributing

Found a bug? Have a feature request? Issues and pull requests are welcome!

For questions about the original Phomymo label designer, see the [original repository](https://github.com/transcriptionstream/phomymo).

---

**Happy photo-printing! 🎉📸**
