/**
 * Photobooth application for capturing and printing photo strips
 * Captures 5 photos with countdown, stitches them vertically with white borders
 */

import { BLETransport } from './ble.js';
import { CanvasRenderer, PX_PER_MM } from './canvas.js';
import { Printer } from './printer.js';

export class PhotoboothApp {
  constructor(options = {}) {
    // Resolve element IDs to actual DOM elements
    this.videoElement = this.resolveElement(options.videoElementId);
    this.startButton = this.resolveElement(options.startButtonId);
    this.statusElement = this.resolveElement(options.statusDisplayId);
    this.countdownElement = this.resolveElement(options.countdownElementId);
    this.compositeCanvasElement = this.resolveElement(options.compositeCanvasId);
    
    // Photo capture settings
    this.photoCount = 5;
    this.borderSize = 20; // pixels (white border around and between photos)
    this.countdownDuration = 3; // seconds
    this.capturedPhotos = [];
    
    // Camera stream
    this.stream = null;
    this.isCapturing = false;
    
    // Bluetooth and printer
    this.ble = BLETransport.getShared();
    this.printer = null;
    
    this.init();
  }
  
  resolveElement(idOrElement) {
    if (!idOrElement) return null;
    if (typeof idOrElement === 'string') {
      return document.getElementById(idOrElement);
    }
    return idOrElement;
  }
  
  async init() {
    try {
      // Request camera access (front-facing for selfies)
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      // Pipe stream to video element
      if (this.videoElement) {
        this.videoElement.srcObject = this.stream;
        this.videoElement.play();
      }
      
      // Set up button handler
      if (this.startButton) {
        this.startButton.addEventListener('click', () => this.startPhotoSession());
      }
      
      this.updateStatus('Ready! Tap Start to begin.');
    } catch (error) {
      console.error('Camera access denied or unavailable:', error);
      this.updateStatus('Camera not available. Please enable camera access.');
    }
  }
  
  updateStatus(message) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
    }
    console.log('[Photobooth]', message);
  }
  
  async startPhotoSession() {
    if (this.isCapturing) return;
    
    this.isCapturing = true;
    this.capturedPhotos = [];
    this.startButton.disabled = true;
    
    this.updateStatus('Starting photo session...');
    
    try {
      // Capture 5 photos
      for (let i = 0; i < this.photoCount; i++) {
        this.updateStatus(`Photo ${i + 1} of ${this.photoCount}`);
        
        // Show countdown
        await this.showCountdown();
        
        // Capture frame
        await this.capturePhoto();
      }
      
      // All photos captured - stitch them
      this.updateStatus('Stitching photos...');
      const compositeCanvas = await this.stitchPhotos();
      
      // Display composite on screen if element provided
      if (this.compositeCanvasElement) {
        const ctx = this.compositeCanvasElement.getContext('2d');
        this.compositeCanvasElement.width = compositeCanvas.width;
        this.compositeCanvasElement.height = compositeCanvas.height;
        ctx.drawImage(compositeCanvas, 0, 0);
      }
      
      this.updateStatus('Preparing to print...');
      
      // Connect to printer if not already connected
      if (!this.ble.isConnected()) {
        this.updateStatus('Connecting to printer...');
        await this.ble.connect();
      }
      
      // Dither and prepare raster data
      this.updateStatus('Processing image for printer...');
      const rasterData = this.getRasterDataFromCanvas(compositeCanvas);
      
      // Initialize printer if needed
      if (!this.printer) {
        this.printer = new Printer(this.ble);
      }
      
      // Send to printer
      this.updateStatus('Sending to printer...');
      await this.printer.printRaster(rasterData.data, rasterData.widthBytes, rasterData.heightLines);
      
      this.updateStatus('Complete! Strip printed successfully.');
    } catch (error) {
      console.error('Photo session error:', error);
      this.updateStatus(`Error: ${error.message}. Please try again.`);
    } finally {
      this.isCapturing = false;
      this.startButton.disabled = false;
    }
  }
  
  showCountdown() {
    return new Promise((resolve) => {
      if (!this.countdownElement) {
        // No countdown element, just use a delay
        setTimeout(resolve, this.countdownDuration * 1000);
        return;
      }
      
      let remaining = this.countdownDuration;
      
      // Make countdown visible
      this.countdownElement.classList.add('visible');
      
      const tick = () => {
        if (remaining > 0) {
          this.countdownElement.textContent = remaining;
          this.updateStatus(`Capturing in ${remaining}...`);
          remaining--;
          setTimeout(tick, 1000);
        } else {
          // Hide countdown and resolve
          this.countdownElement.classList.remove('visible');
          this.countdownElement.textContent = '';
          resolve();
        }
      };
      
      tick();
    });
  }
  
  capturePhoto() {
    return new Promise((resolve) => {
      // Create temporary canvas to capture current frame
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.videoElement.videoWidth;
      tempCanvas.height = this.videoElement.videoHeight;
      
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(this.videoElement, 0, 0);
      
      // Store as data URL (JPEG for smaller file size)
      const photoData = tempCanvas.toDataURL('image/jpeg', 0.9);
      this.capturedPhotos.push(photoData);
      
      console.log(`Captured photo ${this.capturedPhotos.length}/${this.photoCount}`);
      
      // Small delay before next photo
      setTimeout(resolve, 500);
    });
  }
  
  stitchPhotos() {
    return new Promise((resolve, reject) => {
      // Load all photos as images
      const photoImages = [];
      let loadedCount = 0;
      
      this.capturedPhotos.forEach((photoData, index) => {
        const img = new Image();
        img.onload = () => {
          photoImages[index] = img;
          loadedCount++;
          
          if (loadedCount === this.capturedPhotos.length) {
            // All photos loaded - now stitch them
            const composite = this.createComposite(photoImages);
            resolve(composite);
          }
        };
        img.onerror = () => reject(new Error(`Failed to load photo ${index}`));
        img.src = photoData;
      });
    });
  }
  
  createComposite(photoImages) {
    if (!photoImages || photoImages.length === 0) {
      throw new Error('No photos to stitch');
    }
    
    // Use first image dimensions as reference
    const photoWidth = photoImages[0].width;
    const photoHeight = photoImages[0].height;
    const border = this.borderSize;
    
    // Calculate composite canvas size
    // Layout: [border][photo][border]
    //         [border][photo][border]
    //         ... (5 times)
    // Total: width = photo_width + 2*border
    //        height = (5 * photo_height) + (6 * border) [top, bottom, and between each]
    const compositeWidth = photoWidth + (border * 2);
    const compositeHeight = (photoHeight * this.photoCount) + (border * (this.photoCount + 1));
    
    // Create off-screen canvas
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = compositeWidth;
    compositeCanvas.height = compositeHeight;
    
    const ctx = compositeCanvas.getContext('2d');
    
    // Fill background with white (this becomes the border)
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, compositeWidth, compositeHeight);
    
    // Draw each photo positioned with white borders/spacing
    photoImages.forEach((img, index) => {
      const x = border; // left border
      const y = border + (index * (photoHeight + border)); // top border + spacing
      
      ctx.drawImage(img, x, y, photoWidth, photoHeight);
    });
    
    console.log(`Created composite canvas: ${compositeWidth}x${compositeHeight}px`);
    
    return compositeCanvas;
  }
  
  getRasterDataFromCanvas(canvas) {
    // Create a temporary CanvasRenderer to use its dithering and raster conversion
    const tempCanvas = document.createElement('canvas');
    const renderer = new CanvasRenderer(tempCanvas);
    
    // Set dimensions to match our composite
    // The composite is already at print resolution, so we need to account for that
    // Assuming PX_PER_MM = 8 (203 DPI), our canvas size is in pixels
    const widthMm = canvas.width / PX_PER_MM;
    const heightMm = canvas.height / PX_PER_MM;
    
    renderer.setDimensions(widthMm, heightMm, 1, false);
    
    // Get pixel data from composite
    const tempCtx = document.createElement('canvas').getContext('2d');
    tempCtx.canvas.width = canvas.width;
    tempCtx.canvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);
    
    const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    
    // Convert to raster using dithering (Floyd-Steinberg for best quality)
    // Use printer width of 72 bytes (576 pixels, typical for thermal printers)
    const printerWidthBytes = 72;
    const rasterData = renderer._pixelsToRaster(
      pixels,
      canvas.width,
      canvas.height,
      printerWidthBytes,
      'center',
      'floyd-steinberg'
    );
    
    return {
      data: rasterData,
      widthBytes: printerWidthBytes,
      heightLines: canvas.height
    };
  }
  
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
  }
}
