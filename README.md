# Phomymo Photobooth

A Progressive Web App (PWA) DIY photobooth for Android Chrome and Phomemo thermal printers. Captures 3 photos in a 3:4 portrait ratio, adds perfect rounded corners, stitches them into a classic film-strip layout, and prints directly to your Phomemo thermal printer via Web Bluetooth—no drivers, no apps required.

Perfect for parties, events, and gatherings where guests can walk up, tap a button (or a Bluetooth selfie remote), and take home a printed strip of memories.

## 🌟 Features
- **PWA Kiosk Mode:** Install directly to your device home screen for a seamless, full-screen, immersive app experience without browser UI.
- **Hardware Button Support:** Pair any cheap Bluetooth selfie clicker or foot pedal to trigger the photobooth wirelessly.
- **Re-Print & Cancel:** Easily duplicate the last photo strip for group shots, or safely cancel a print mid-way (includes a custom hardware-level buffer flush to save paper).
- **Party-Ready UI:** Energetic animations, warm styling, and bouncing countdowns to keep the energy up.

---

## 🚀 Quick Start (Beginner's Guide)

Because Web Bluetooth requires a secure `https://` connection to work, the easiest way to use this photobooth is to host it for free on your own GitHub account. Here is exactly how to do it:

### 1. Get Your Own Live Link
1. Log into your GitHub account.
2. Go to the top right of this repository and click the **Fork** button. This creates a personal copy of the code on your own account.
3. In your new forked repository, go to **Settings** > **Pages** (on the left sidebar).
4. Under "Build and deployment", set the Source to **Deploy from a branch**.
5. Under "Branch", select **main** (or `master`) and click **Save**.
6. Wait about 1-2 minutes. GitHub is now hosting your site for free! Your photobooth will be live at:  
   `https://<your-username>.github.io/<your-repo-name>/src/web/photobooth.html`

### 2. Install it on your Phone or Tablet
1. Open your new live link on an **Android device running Chrome**.
2. Wait for the camera to initialize (you'll see "Ready! Tap Start to begin.").
3. Tap the three-dot menu in Chrome.
4. Select **"Install app"** or **"Add to Home Screen"**.
5. Go to your phone's home screen and launch the new App icon. It will open as a locked-in, full-screen kiosk application!

### 3. Add a Hardware Remote (Optional)
- Pair a standard Bluetooth selfie remote to your phone.
- Pressing the remote (which simulates a `Volume Up` or `Enter` key) will instantly trigger the photobooth.

---

## 🎨 Customizing for your Party

You don't need to be a pro developer to make this booth match your party's theme. All edits can be made directly in GitHub by clicking on the file and clicking the pencil "Edit" icon.

### Change the App Icon
When you install the app to your phone, it looks for two specific image files to use as the home screen icon.
1. Find or create a square image (e.g., a photo of the birthday host).
2. Resize it into two versions: one `192x192` pixels, and one `512x512` pixels. (You can use Canva, MS Paint, or any free online resizer).
3. Name them exactly **`icon-192.png`** and **`icon-512.png`**.
4. Upload and replace the existing files inside the `src/web/` folder.

### Change the Colors
Open `src/web/photobooth.html` and look for the `<style>` section at the top. 
- **Background Color:** Find `background-color: #1a0b14;` (it appears twice, once under `html, body` and once in the manifest). Change `#1a0b14` to any hex color code you like.
- **Button Color:** Find `#start-button`. Change the `background: linear-gradient(...)` to match your party colors.

### Change the Text & Timing
Open `src/web/photobooth.js` and edit these lines at the top of the file:
```javascript
this.photoCount = 3;              // Number of photos to take
this.countdownDuration = 3;       // Seconds to wait before each snap
this.cornerRadius = 32;           // How round you want the photo edges to be
```

Want to change the "Smile!" text? Search the `photobooth.js` file for `'Smile!'` and change it to `'Strike a Pose!'`, `'Cheers!'`, or anything else!

*(Note: Whenever you make a change, wait 60 seconds, then close the app entirely on your phone and re-open it while connected to Wi-Fi to load your updates).*

---

## ⚙️ Architecture & Technical Details

### The Capture Loop

```text
[ "Smile!" ] → [3-sec countdown] → [Capture 1] → [3-sec countdown] → [Capture 2] ...
                                                                           ↓
                                        [Repeat 3 times total]
                                                ↓
                        [Crop 3:4, Apply Rounded Corners, Stitch Vertically]
                                                ↓
                                        [Dither & Print]
```

**Exact-Drain Cancellation Protocol** (`printer.js::printM02()`)
Standard ESC/POS printers crash if a Bluetooth connection is severed mid-image. If canceled, this app calculates the *exact* number of bytes remaining in the hardware buffer, floods the printer with zero-bytes (white space) to satisfy the chunk requirement, and then issues a clean hardware reset (`ESC @`) followed by a manual paper feed (`ESC J`). This saves paper while maintaining perfect horizontal alignment for the next print.

### Browser Requirements

- **Android Chrome** (Android 6+)  
  Web Bluetooth API, camera access, and PWA installation fully supported.
- **Desktop Chrome/Edge** (Windows, macOS)  
  Works for testing; full-screen kiosk mode recommended on Android.
- **iOS Safari**  
  Not supported (Apple has not enabled the Web Bluetooth API on iPhones/iPads).
- **Firefox**  
  Not supported (Web Bluetooth not implemented).

## Running Locally (Advanced)

To run locally with HTTPS (required for Web Bluetooth) on your PC:

```bash
# Clone and navigate
git clone [https://github.com/](https://github.com/)<yourusername>/phomymophotobooth.git
cd phomymophotobooth/src/web

# Option 1: Python HTTP server (HTTP on localhost)
python3 -m http.server 8080
# Open http://localhost:8080/photobooth.html

# Option 2: Node.js with HTTPS (recommended for full BLE testing)
npx http-server --ssl
# Open https://localhost:8080/photobooth.html
```

## Supported Printers

The photobooth works with all Phomemo thermal printers that support the BLE protocol. The app auto-detects your printer model and configures the correct print width and DPI. 

| Model | Width | Notes |
|-------|-------|-------|
| M02 / M02 Pro / M02S | 48mm / 53mm | Mini continuous printers (Ideal for this app) |
| M110 / M120 | 48mm | Label makers |
| M200 / M250 | 75mm | Mid-size labels |
| M220 / M221 / M260 | 72mm | Wide labels |

## Original Phomymo README

This photobooth is built on top of **Phomymo**, a browser-based label designer for Phomemo printers. The core Bluetooth communication, print protocols, and dithering engine are from the original Phomymo project.

For detailed information on supported printers, label design features, templates, and advanced print settings, see the original project:

**[Phomymo Label Designer](https://phomymo.affordablemagic.net)** — https://github.com/transcriptionstream/phomymo

### Original Acknowledgments

Protocol research and inspiration:
- [vivier/phomemo-tools](https://github.com/vivier/phomemo-tools) - CUPS driver with reverse-engineered protocol
- [yaddran/thermal-print](https://github.com/yaddran/thermal-print) - Printer status query commands
- [ooki1jp](https://github.com/vivier/phomemo-tools/issues/27#issuecomment-3850158579) - M04AS/M04S protocol reverse-engineering

### License

MIT License — see LICENSE file for details.

This project is a derivative of Phomymo (original by transcriptionstream). All original code and protocols remain under the MIT license.

---

**Happy photo-printing! 🎉📸**
