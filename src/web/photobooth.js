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
    
    // UI Elements for the Vault
    this.galleryOverlay = document.getElementById('gallery-overlay');
    this.galleryGrid = document.getElementById('gallery-grid');
    
    this.photoCount = 3;           
    this.printerWidthPx = 576;     
    this.photoHeightPx = 768;      
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
    this.db = null; // IndexedDB instance
    
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
      // 1. Initialize the hidden database
      await this.initDB();

      // 2. Start Camera
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
      
      // 3. Setup core buttons
      if (this.startButton) {
        this.startButton.addEventListener('click', () => this.startPhotoSession());
      }
      if (this.cancelButton) {
        this.cancelButton.addEventListener('click', () => { 
          this.printCancelled = true; 
        });
      }
      if (this.reprintButton) {
        this.reprintButton.addEventListener('click', () => this.handleReprint());
      }

      // 4. Bluetooth Selfie Clicker Listener
      window.addEventListener('keydown', (event) => {
        const triggerKeys = ['Enter', ' ', 'VolumeUp', 'AudioVolumeUp', 'VolumeDown', 'AudioVolumeDown'];
        // Don't trigger if gallery is open
        if (!this.galleryOverlay.classList.contains('hidden')) return;

        if (triggerKeys.includes(event.key) || triggerKeys.includes(event.code)) {
          event.preventDefault(); 
          if (!this.isCapturing && !this.startButton.disabled) {
            this.startButton.style.transform = 'scale(0.94)';
            setTimeout(() => this.startButton.style.transform = '', 150);
            this.startPhotoSession();
          }
        }
      });

      // 5. Secret Tap Zone Logic (5 taps in 2 seconds)
      const tapZone = document.getElementById('secret-tap-zone');
      let tapCount = 0;
      let lastTap = 0;
      
      const handleSecretTap = (e) => {
        e.preventDefault();
        const now = Date.now();
        if (now - lastTap > 2000) tapCount = 0; // Reset if too slow
        tapCount++;
        lastTap = now;
        
        if (tapCount >= 5) {
          tapCount = 0;
          this.openGallery();
        }
      };
      
      if (tapZone) {
        tapZone.addEventListener('touchstart', handleSecretTap);
        tapZone.addEventListener('click', handleSecretTap); // Mouse support
      }

      // 6. Gallery Buttons
      document.getElementById('gallery-close-btn')?.addEventListener('click', () => {
        this.galleryOverlay.classList.add('hidden');
      });
      document.getElementById('gallery-clear-btn')?.addEventListener('click', () => {
        if(confirm('Are you sure? This will delete all saved photos forever.')) {
          this.clearSessions();
        }
      });
      document.getElementById('gallery-download-btn')?.addEventListener('click', () => {
        this.downloadAllPhotos();
      });
      
      this.updateStatus('Ready! Tap Start to begin.', true);
      this.hideStatusAfter(5000);
    } catch (error) {
      console.error('Initialization error:', error);
      this.updateStatus('Camera not available. Please check permissions.', true);
    }
  }

  // ==========================================
  // INDEXED-DB VAULT LOGIC
  // ==========================================
  
  initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PhotoboothVault', 1);
      
      request.onerror = (e) => {
        console.error('IndexedDB Error:', e);
        reject(e);
      };
      
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sessions')) {
          // Auto-incrementing ID for each photo session
          db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  saveSessionToVault(photosArray, thumbnailDataUrl) {
    if (!this.db) return;
    const transaction = this.db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    
    const session = {
      timestamp: Date.now(),
      photos: [...photosArray], 
      thumbnail: thumbnailDataUrl
    };
    
    store.add(session);
  }

  getAllSessions() {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      const transaction = this.db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  clearSessions() {
    if (!this.db) return;
    const transaction = this.db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    store.clear();
    transaction.oncomplete = () => {
      this.galleryGrid.innerHTML = '';
      alert('Vault cleared!');
    };
  }

  async openGallery() {
    if (!this.galleryOverlay) return;
    this.galleryGrid.innerHTML = '<p style="text-align:center; width:100%;">Loading Vault...</p>';
    this.galleryOverlay.classList.remove('hidden');

    const sessions = await this.getAllSessions();
    this.galleryGrid.innerHTML = '';

    if (sessions.length === 0) {
      this.galleryGrid.innerHTML = '<p style="text-align:center; width:100%;">The vault is empty.</p>';
      return;
    }

    // Render newest sessions first
    sessions.reverse().forEach(session => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      
      const img = document.createElement('img');
      img.src = session.thumbnail;
      
      const btn = document.createElement('button');
      btn.className = 'reprint-item-btn';
      btn.textContent = 'Reprint';
      
      // Hook up the live reprint logic
      btn.addEventListener('click', () => {
        this.galleryOverlay.classList.add('hidden'); // Close vault to see status
        this.handleGalleryReprint(session.photos);
      });
      
      item.appendChild(img);
      item.appendChild(btn);
      this.galleryGrid.appendChild(item);
    });
  }

  async downloadAllPhotos() {
    if (!window.JSZip) {
      alert("JSZip library didn't load properly!");
      return;
    }

    const sessions = await this.getAllSessions();
    if (sessions.length === 0) {
      alert('Vault is empty!');
      return;
    }

    // Change button text while processing
    const dlBtn = document.getElementById('gallery-download-btn');
    const originalText = dlBtn.textContent;
    dlBtn.textContent = 'Zipping...';
    dlBtn.disabled = true;

    try {
      const zip = new window.JSZip();

      // Bundle individual photos into categorized folders
      sessions.forEach((session, sIdx) => {
        const dateStr = new Date(session.timestamp).toISOString().replace(/[:.]/g, '-');
        const folderName = `Session_${sIdx + 1}_${dateStr}`;
        const folder = zip.folder(folderName);

        session.photos.forEach((photoData, pIdx) => {
          // Strip the "data:image/jpeg;base64," prefix for JSZip
          const base64Data = photoData.split(',')[1];
          folder.file(`Photo_${pIdx + 1}.jpg`, base64Data, {base64: true});
        });
      });

      const content = await zip.generateAsync({type: 'blob'});
      
      // Trigger local download
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Photobooth_Backup_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (e) {
      console.error("Zip failed:", e);
      alert("Failed to create ZIP file.");
    } finally {
      dlBtn.textContent = originalText;
      dlBtn.disabled = false;
    }
  }

  // ==========================================
  // CORE PHOTO LOGIC
  // ==========================================

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
      // We explicitly pass this.capturedPhotos
      const compositeCanvas = await this.stitchPhotos(this.capturedPhotos);
      
      if (this.compositeCanvasElement) {
        const ctx = this.compositeCanvasElement.getContext('2d');
        this.compositeCanvasElement.width = compositeCanvas.width;
        this.compositeCanvasElement.height = compositeCanvas.height;
        ctx.drawImage(compositeCanvas, 0, 0);
      }
      
      // Save to Vault: Generate a low-res thumbnail of the stitched strip for the UI
      const thumbnailData = compositeCanvas.toDataURL('image/jpeg', 0.4);
      this.saveSessionToVault(this.capturedPhotos, thumbnailData);

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

  // New method specifically for printing from the Gallery Vault
  async handleGalleryReprint(photosArray) {
    if (this.isCapturing) return;
    this.isCapturing = true;
    
    try {
      if (!this.ble.isConnected()) {
        this.updateStatus('Please select your Phomemo printer...', true);
        await this.ble.connect();
      }
      
      this.updateStatus('Re-stitching saved photos...', true);
      const compositeCanvas = await this.stitchPhotos(photosArray);
      
      this.updateStatus('Processing for printer...', true);
      const rasterData = this.getRasterDataFromCanvas(compositeCanvas);
      
      // Update global last print so standard reprint button on main screen grabs this one
      this.lastRasterData = rasterData;
      
      await this.executePrint(rasterData);

    } catch (error) {
      console.error('Gallery reprint error:', error);
      this.updateStatus(`Error: ${error.message}`, true);
      this.hideStatusAfter(5000);
    } finally {
      this.isCapturing = false;
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
      
      this.updateStatus('Complete! Please tear off your strip', true);
      this.hideStatusAfter(6000);
      if (this.reprintButton) this.reprintButton.classList.remove('hidden');

    } catch (error) {
      if (error.message === 'CANCELLED') {
        this.updateStatus('Print cancelled. Ejecting paper...', true);
        try {
          await new Promise(r => setTimeout(r, 100));
          await this.ble.send(new Uint8Array([0x1b, 0x40])); 
          await new Promise(r => setTimeout(r, 100));
          await this.ble.send(new Uint8Array([0x1b, 0x4a, 160])); 
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
  
  // Now accepts an array so we can stitch live sessions OR saved gallery sessions
  stitchPhotos(photosArray) {
    return new Promise((resolve, reject) => {
      const photoImages = [];
      let loadedCount = 0;
      
      photosArray.forEach((photoData, index) => {
        const img = new Image();
        img.onload = () => {
          photoImages[index] = img;
          loadedCount++;
          
          if (loadedCount === photosArray.length) {
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
