/**
 * Photobooth application for capturing and printing photo strips
 * Captures 5 photos with countdown, stitches them vertically with white borders
 */

import { BLETransport } from './ble.js';
import { CanvasRenderer } from './canvas.js';
import { print } from './printer.js';

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
      this.statusElement.classList.add('visible'); // Added missing CSS class!
    }
    console.log('[Photobooth]', message);
  }
  
  async startPhotoSession() {
    if (this.isCapturing) return;
    
    this.isCapturing = true;
    this.capturedPhotos = [];
    this.startButton.disabled = true;
    
    try {
      // 1. Connect to printer FIRST to satisfy Web Bluetooth user-gesture requirements
      if (!this.ble.isConnected()) {
        this.updateStatus('Connecting to printer...');
        await this.ble.connect();
      }
        
      this.updateStatus('Starting photo session...');
      
      // 2. Capture 5 photos
      for (let i = 0; i < this.photoCount; i++) {
        this.updateStatus(`Photo ${i + 1} of ${this.photoCount}`);
        await this.showCountdown();
        await this.capturePhoto();
      }
      
      // 3. All photos captured - stitch them
      this.updateStatus('Stitching photos...');
      const compositeCanvas = await this.stitchPhotos();
      
      // Display composite on screen if element provided
      if (this.compositeCanvasElement) {
        const ctx = this.compositeCanvasElement.getContext('2d');
        this.compositeCanvasElement.width = compositeCanvas.width;
        this.compositeCanvasElement.height = compositeCanvas.height;
        ctx.drawImage(compositeCanvas, 0, 0);
      }
      
      this.updateStatus('Processing image for printer...');
      const rasterData = this.getRasterDataFromCanvas(compositeCanvas);
      
      // 4. Send to printer using the correct function signature from printer.js
      this.updateStatus('Sending to printer...');
      await print(this.ble, rasterData, { isBLE: true, continuous: true });
      
      this.updateStatus('Complete! Strip printed successfully.');
      
      // Hide status after success
      setTimeout(() => {
          if (this.statusElement) this.statusElement.classList.remove('visible');
      }, 4000);
      
    } catch (error) {
      console.error('Photo session error:', error);
      this.updateStatus(`Error: ${error.message}. Please try again.`);
      
      // Hide error after 5 seconds so user can try again
      setTimeout(() => {
          if (this.statusElement) this.statusElement.classList.remove('visible');
      }, 5000);
    } finally {
      this.isCapturing = false;
      this.startButton.disabled = false;
    }
  }
  
  showCountdown() {
    return new Promise((resolve) => {
      if (!this.countdownElement) {
        setTimeout(resolve, this.countdownDuration * 1000);
        return;
      }
      
      let remaining = this.countdownDuration;
      this.countdownElement.classList.add('visible');
      
      const tick = () => {
        if (remaining > 0) {
          this.countdownElement.textContent = remaining;
          this.updateStatus(`Capturing in ${remaining}...`);
          remaining--;
          setTimeout(tick, 1000);
        } else {
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
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.videoElement.videoWidth;
      tempCanvas.height = this.videoElement.videoHeight;
      
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(this.videoElement, 0, 0);
      
      const photoData = tempCanvas.toDataURL('image/jpeg', 0.9);
      this.capturedPhotos.push(photoData);
      
      console.log(`Captured photo ${this.capturedPhotos.length}/${this.photoCount}`);
      setTimeout(resolve, 500);
    });
  }
  
  stitchPhotos() {
    return new Promise((resolve, reject) => {
      const photoImages = [];
      let loadedCount = 0;
      
      this.capturedPhotos.forEach((photoData, index) => {
        const img = new Image();
        img.onload = () => {
          photoImages[index] = img;
          loadedCount++;
          
          if (loadedCount === this.capturedPhotos.length) {
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
    
    const photoWidth = photoImages[0].width;
    const photoHeight = photoImages[0].height;
    const border = this.borderSize;
    
    const compositeWidth = photoWidth + (border * 2);
    const compositeHeight = (photoHeight * this.photoCount) + (border * (this.photoCount + 1));
    
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = compositeWidth;
    compositeCanvas.height = compositeHeight;
    
    const ctx = compositeCanvas.getContext('2d');
    
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, compositeWidth, compositeHeight);
    
    photoImages.forEach((img, index) => {
      const x = border;
      const y = border + (index * (photoHeight + border));
      
      ctx.drawImage(img, x, y, photoWidth, photoHeight);
    });
    
    return compositeCanvas;
  }
  
  getRasterDataFromCanvas(canvas) {
    const tempCanvas = document.createElement('canvas');
    const renderer = new CanvasRenderer(tempCanvas);
    
    // 203 DPI thermal printers are exactly 8 dots per mm
    const widthMm = Math.round(canvas.width / 8);
    const heightMm = Math.round(canvas.height / 8);
    
    renderer.setDimensions(widthMm, heightMm, 1, false);
    
    const tempCtx = document.createElement('canvas').getContext('2d');
    tempCtx.canvas.width = canvas.width;
    tempCtx.canvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);
    
    const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    
    const printerWidthBytes = 72; // 576 pixels wide
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
