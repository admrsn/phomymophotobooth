/**
 * Photobooth application for capturing and printing photo strips
 * Features 3 photos, 2:3 ratio mapping, flash effect, clean control deck, and auto-hiding connection button
 */

import { BLETransport } from './ble.js';
import { CanvasRenderer } from './canvas.js';
import { print } from './printer.js';

export class PhotoboothApp {
  constructor(options = {}) {
    this.videoElement = this.resolveElement(options.videoElementId);
    this.startButton = this.resolveElement(options.startButtonId);
    this.connectButton = this.resolveElement(options.connectButtonId);
    this.statusButtonText = this.resolveElement(options.statusButtonTextId);
    this.statusDot = this.resolveElement(options.statusDotId);
    this.statusElement = this.resolveElement(options.statusDisplayId);
    this.countdownElement = this.resolveElement(options.countdownElementId);
    this.flashElement = this.resolveElement(options.flashElementId);
    this.compositeCanvasElement = this.resolveElement(options.compositeCanvasId);
    
    this.photoCount = 3;           // Set to 3 photos per strip
    this.printerWidthPx = 576;     // Matches 72 printer bytes (no side borders / wrap fix)
    this.photoHeightPx = 864;      // 2:3 Aspect ratio height (576 * 1.5)
    this.borderSize = 16;          // Vertical spacing between strips
    this.countdownDuration = 3;    // Seconds
    this.capturedPhotos = [];
    
    this.stream = null;
    this.isCapturing = false;
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
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      if (this.videoElement) {
        this.videoElement.srcObject = this.stream;
        this.videoElement.play();
      }
      
      if (this.startButton) {
        this.startButton.addEventListener('click', () => this.startPhotoSession());
      }

      if (this.connectButton) {
        this.connectButton.addEventListener('click', () => this.togglePrinterConnection());
      }
      
      this.updateConnectionUI(false);
      this.updateStatus('Ready! Connect printer to begin.');
    } catch (error) {
      console.error('Camera access error:', error);
      this.updateStatus('Camera not available. Please check permissions.');
    }
  }

  updateConnectionUI(connected, deviceName = '') {
    if (this.statusDot) {
      this.statusDot.classList.toggle('connected', connected);
    }
    
    if (this.connectButton) {
      // Automatically hide the connect button once connected so guests can't click it
      if (connected) {
        this.connectButton.classList.add('hidden');
      } else {
        this.connectButton.classList.remove('hidden');
      }
    }

    if (this.statusButtonText) {
      if (connected) {
        const shortName = deviceName ? deviceName.substring(0, 10) : 'Printer';
        this.statusButtonText.textContent = `Connected (${shortName})`;
      } else {
        this.statusButtonText.textContent = 'Connect Printer';
      }
    }
  }

  async togglePrinterConnection() {
    try {
      if (this.ble.isConnected()) {
        await this.ble.disconnect();
        this.updateConnectionUI(false);
        this.updateStatus('Printer disconnected.');
      } else {
        this.updateStatus('Scanning for printer...');
        await this.ble.connect();
        if (this.ble.isConnected()) {
          const name = this.ble.getDeviceName ? this.ble.getDeviceName() : 'Phomemo';
          this.updateConnectionUI(true, name);
          this.updateStatus('Printer connected successfully!');
          setTimeout(() => this.hideStatus(), 3000);
        }
      }
    } catch (error) {
      console.error('Bluetooth connection error:', error);
      this.updateStatus(`Connection failed: ${error.message}`);
      this.updateConnectionUI(false);
    }
  }
  
  updateStatus(message) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
      this.statusElement.classList.add('visible');
    }
    console.log('[Photobooth]', message);
  }

  hideStatus() {
    if (this.statusElement) {
      this.statusElement.classList.remove('visible');
    }
  }
  
  async startPhotoSession() {
    if (this.isCapturing) return;
    
    this.isCapturing = true;
    this.capturedPhotos = [];
    this.startButton.disabled = true;
    
    try {
      if (!this.ble.isConnected()) {
        this.updateStatus('Please select your Phomemo printer...');
        await this.ble.connect();
        const name = this.ble.getDeviceName ? this.ble.getDeviceName() : 'Phomemo';
        this.updateConnectionUI(true, name);
      }
        
      this.updateStatus('Get ready!');
      
      for (let i = 0; i < this.photoCount; i++) {
        this.updateStatus(`Photo ${i + 1} of ${this.photoCount}`);
        await this.showCountdown();
        await this.capturePhoto();
      }
      
      this.updateStatus('Stitching photos...');
      const compositeCanvas = await this.stitchPhotos();
      
      if (this.compositeCanvasElement) {
        const ctx = this.compositeCanvasElement.getContext('2d');
        this.compositeCanvasElement.width = compositeCanvas.width;
        this.compositeCanvasElement.height = compositeCanvas.height;
        ctx.drawImage(compositeCanvas, 0, 0);
      }
      
      this.updateStatus('Processing image for printer...');
      const rasterData = this.getRasterDataFromCanvas(compositeCanvas);
      
      this.updateStatus('Sending to printer...');
      await print(this.ble, rasterData, { isBLE: true, continuous: true });
      
      this.updateStatus('Complete! Strip printed successfully.');
      setTimeout(() => this.hideStatus(), 4000);
      
    } catch (error) {
      console.error('Photo session error:', error);
      this.updateStatus(`Error: ${error.message}. Please try again.`);
      setTimeout(() => this.hideStatus(), 5000);
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
      // Trigger camera flash screen effect reliably via CSS animation class
      if (this.flashElement) {
        this.flashElement.classList.remove('flash');
        void this.flashElement.offsetWidth; // Force DOM reflow to re-trigger animation
        this.flashElement.classList.add('flash');
      }

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.printerWidthPx;
      tempCanvas.height = this.photoHeightPx;
      
      const ctx = tempCanvas.getContext('2d');

      // Center-crop preview mapping precisely to the viewfinder box ratio
      const videoWidth = this.videoElement.videoWidth;
      const videoHeight = this.videoElement.videoHeight;
      const targetAspect = this.printerWidthPx / this.photoHeightPx; // 2:3
      const videoAspect = videoWidth / videoHeight;

      let srcW = videoWidth;
      let srcH = videoHeight;
      let srcX = 0;
      let srcY = 0;

      if (videoAspect > targetAspect) {
        srcW = videoHeight * targetAspect;
        srcX = (videoWidth - srcW) / 2;
      } else {
        srcH = videoWidth / targetAspect;
        srcY = (videoHeight - srcH) / 2;
      }

      ctx.drawImage(this.videoElement, srcX, srcY, srcW, srcH, 0, 0, this.printerWidthPx, this.photoHeightPx);
      
      const photoData = tempCanvas.toDataURL('image/jpeg', 0.9);
      this.capturedPhotos.push(photoData);
      
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
    const photoWidth = this.printerWidthPx; 
    const photoHeight = this.photoHeightPx; 
    const border = this.borderSize;
    
    const compositeWidth = photoWidth; 
    const compositeHeight = (photoHeight * this.photoCount) + (border * (this.photoCount + 1));
    
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = compositeWidth;
    compositeCanvas.height = compositeHeight;
    
    const ctx = compositeCanvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, compositeWidth, compositeHeight);
    
    photoImages.forEach((img, index) => {
      const x = 0; 
      const y = border + (index * (photoHeight + border));
      ctx.drawImage(img, x, y, photoWidth, photoHeight);
    });
    
    return compositeCanvas;
  }
  
  getRasterDataFromCanvas(canvas) {
    const tempCanvas = document.createElement('canvas');
    const renderer = new CanvasRenderer(tempCanvas);
    
    const widthMm = Math.round(canvas.width / 8);
    const heightMm = Math.round(canvas.height / 8);
    renderer.setDimensions(widthMm, heightMm, 1, false);
    
    const tempCtx = document.createElement('canvas').getContext('2d');
    tempCtx.canvas.width = canvas.width;
    tempCtx.canvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);
    
    const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    
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
