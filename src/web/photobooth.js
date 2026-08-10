/**
 * Photobooth application for capturing and printing photo strips
 */

import { BLETransport } from './ble.js';
import { CanvasRenderer } from './canvas.js';
import { print } from './printer.js';

export class PhotoboothApp {
  constructor(options = {}) {
    this.videoElement = this.resolveElement(options.videoElementId);
    this.startButton = this.resolveElement(options.startButtonId);
    this.cancelButton = this.resolveElement(options.cancelButtonId);
    this.reprintButton = this.resolveElement(options.reprintButtonId);
    this.statusElement = this.resolveElement(options.statusDisplayId);
    this.countdownElement = this.resolveElement(options.countdownElementId);
    this.flashElement = this.resolveElement(options.flashElementId);
    this.compositeCanvasElement = this.resolveElement(options.compositeCanvasId);
    
    this.photoCount = 3;           
    this.printerWidthPx = 576;     
    this.photoHeightPx = 768;      // 3:4 Aspect ratio height
    this.borderSize = 16;          
    this.bottomMargin = 160;       
    this.cornerRadius = 32;        
    this.countdownDuration = 3;    
    
    this.capturedPhotos = [];
    this.lastRasterData = null;
    this.stream = null;
    this.isCapturing = false;
    this.printCancelled = false;
    this.statusTimeout = null;
    
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
      if (this.cancelButton) {
        this.cancelButton.addEventListener('click', () => { 
          // Set the flag; printer.js will now natively drain the remaining bytes
          this.printCancelled = true; 
        });
      }
      if (this.reprintButton) {
        this.reprintButton.addEventListener('click', () => this.handleReprint());
      }
      
      this.updateStatus('Ready! Tap Start to begin.', true);
      this.hideStatusAfter(5000);
    } catch (error) {
      console.error('Camera access error:', error);
      this.updateStatus('Camera not available. Please check permissions.', true);
    }
  }

  updateStatus(message, animate = true) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
      if (animate) {
        this.statusElement.classList.remove('visible');
        void this.statusElement.offsetWidth; 
        this.statusElement.classList.add('visible');
      } else if (!this.statusElement.classList.contains('visible')) {
        this.statusElement.classList.add('visible');
      }
    }
    console.log('[Photobooth]', message);
  }

  hideStatus() {
    if (this.statusElement) {
      this.statusElement.classList.remove('visible');
    }
  }

  hideStatusAfter(ms) {
    if (this.statusTimeout) clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => this.hideStatus(), ms);
  }
  
  async startPhotoSession() {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.capturedPhotos = [];
    
    this.startButton.disabled = true;
    if (this.reprintButton) this.reprintButton.classList.add('hidden');
    
    try {
      if (!this.ble.isConnected()) {
        this.updateStatus('Please select your Phomemo printer...', true);
        await this.ble.connect();
      }
        
      this.updateStatus('Get ready!', true);
      
      await this.showScreenMessage('Smile!', 1500);
      
      for (let i = 0; i < this.photoCount; i++) {
        await this.showCountdown();
        await this.capturePhoto();
      }
      
      this.updateStatus('Stitching photos...', true);
      const compositeCanvas = await this.stitchPhotos();
      
      if (this.compositeCanvasElement) {
        const ctx = this.compositeCanvasElement.getContext('2d');
        this.compositeCanvasElement.width = compositeCanvas.width;
        this.compositeCanvasElement.height = compositeCanvas.height;
        ctx.drawImage(compositeCanvas, 0, 0);
      }
      
      this.updateStatus('Processing image for printer...', true);
      this.lastRasterData = this.getRasterDataFromCanvas(compositeCanvas);
      
      await this.executePrint(this.lastRasterData);
      
    } catch (error) {
      console.error('Photo session error:', error);
      this.updateStatus(`Error: ${error.message}. Please try again.`, true);
      this.hideStatusAfter(5000);
    } finally {
      this.isCapturing = false;
      this.startButton.disabled = false;
    }
  }

  async handleReprint() {
    if (!this.lastRasterData || this.isCapturing) return;
    this.isCapturing = true;
    this.startButton.disabled = true;
    if (this.reprintButton) this.reprintButton.classList.add('hidden');

    try {
      if (!this.ble.isConnected()) {
        this.updateStatus('Please select your Phomemo printer...', true);
        await this.ble.connect();
      }
      await this.executePrint(this.lastRasterData);
    } catch (error) {
      console.error('Reprint error:', error);
      this.updateStatus(`Error: ${error.message}. Please try again.`, true);
      this.hideStatusAfter(5000);
    } finally {
      this.isCapturing = false;
      this.startButton.disabled = false;
    }
  }

  async executePrint(rasterData) {
    this.printCancelled = false;

    if (this.cancelButton) this.cancelButton.classList.remove('hidden');
    if (this.startButton) this.startButton.classList.add('hidden');
    
    try {
      this.updateStatus('Sending to printer...', true);
      
      await print(this.ble, rasterData, { 
        isBLE: true, 
        continuous: true, 
        feed: 160, 
        isCancelled: () => this.printCancelled,
        onProgress: (progress) => {
          if (this.printCancelled) {
            this.updateStatus(`Cancelling & Ejecting... ${progress}%`, false);
          } else {
            this.updateStatus(`Printing... ${progress}%`, false);
          }
        }
      });
      
      this.updateStatus('Complete! Please tear off your strip using the serrated teeth.', true);
      this.hideStatusAfter(6000);
      if (this.reprintButton) this.reprintButton.classList.remove('hidden');

    } catch (error) {
      if (error.message === 'CANCELLED') {
        this.updateStatus('Print cancelled. Ejecting paper...', true);
        try {
          // The printer has safely drained the zeroes and completed the raster command.
          // We can now safely send normal ESC/POS recovery commands.
          await new Promise(r => setTimeout(r, 100));
          await this.ble.send(new Uint8Array([0x1b, 0x40])); // ESC @ Hardware Reset
          
          await new Promise(r => setTimeout(r, 100));
          await this.ble.send(new Uint8Array([0x1b, 0x4a, 160])); // ESC J 160
          
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.error('Failed to recover printer after cancellation:', e);
        }
        
        this.updateStatus('Cancelled. Please tear off the strip.', true);
        this.hideStatusAfter(6000);
        
        if (this.reprintButton && this.lastRasterData) {
          this.reprintButton.classList.remove('hidden');
        }
      } else {
        console.error('Print error:', error);
        this.updateStatus(`Error: ${error.message}. Please try again.`, true);
        this.hideStatusAfter(5000);
      }
    } finally {
      if (this.cancelButton) this.cancelButton.classList.add('hidden');
      if (this.startButton) this.startButton.classList.remove('hidden');
    }
  }

  showScreenMessage(text, durationMs) {
    return new Promise((resolve) => {
      if (!this.countdownElement) {
        setTimeout(resolve, durationMs);
        return;
      }

      this.countdownElement.style.fontSize = '80px'; 
      this.countdownElement.classList.remove('visible');
      void this.countdownElement.offsetWidth;
      this.countdownElement.classList.add('visible');
      
      this.countdownElement.textContent = text;
      
      setTimeout(() => {
        this.countdownElement.classList.remove('visible');
        this.countdownElement.textContent = '';
        this.countdownElement.style.fontSize = ''; 
        resolve();
      }, durationMs);
    });
  }
  
  showCountdown() {
    return new Promise((resolve) => {
      if (!this.countdownElement) {
        setTimeout(resolve, this.countdownDuration * 1000);
        return;
      }
      
      let remaining = this.countdownDuration;
      
      const tick = () => {
        if (remaining > 0) {
          this.countdownElement.classList.remove('visible');
          void this.countdownElement.offsetWidth;
          this.countdownElement.classList.add('visible');
          
          this.countdownElement.textContent = remaining;
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
      if (this.flashElement) {
        this.flashElement.classList.remove('flash');
        void this.flashElement.offsetWidth; 
        this.flashElement.classList.add('flash');
      }

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.printerWidthPx;
      tempCanvas.height = this.photoHeightPx;
      
      const ctx = tempCanvas.getContext('2d');

      const videoWidth = this.videoElement.videoWidth;
      const videoHeight = this.videoElement.videoHeight;
      const targetAspect = this.printerWidthPx / this.photoHeightPx; 
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
    const r = this.cornerRadius;
    
    const compositeWidth = photoWidth; 
    const compositeHeight = (photoHeight * this.photoCount) + (border * (this.photoCount + 1)) + this.bottomMargin;
    
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = compositeWidth;
    compositeCanvas.height = compositeHeight;
    
    const ctx = compositeCanvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, compositeWidth, compositeHeight);
    
    photoImages.forEach((img, index) => {
      const reverseIndex = (this.photoCount - 1) - index;
      const x = 0; 
      const y = border + (reverseIndex * (photoHeight + border));
      
      ctx.save();
      
      ctx.translate(x + photoWidth / 2, y + photoHeight / 2);
      ctx.rotate(Math.PI);
      
      const hw = photoWidth / 2;
      const hh = photoHeight / 2;
      
      ctx.beginPath();
      ctx.moveTo(-hw + r, -hh);
      ctx.lineTo(hw - r, -hh);
      ctx.quadraticCurveTo(hw, -hh, hw, -hh + r);
      ctx.lineTo(hw, hh - r);
      ctx.quadraticCurveTo(hw, hh, hw - r, hh);
      ctx.lineTo(-hw + r, hh);
      ctx.quadraticCurveTo(-hw, hh, -hw, hh - r);
      ctx.lineTo(-hw, -hh + r);
      ctx.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
      ctx.closePath();
      
      ctx.clip();
      
      ctx.drawImage(img, -hw, -hh, photoWidth, photoHeight);
      
      ctx.restore();
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
