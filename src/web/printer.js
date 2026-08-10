/**
 * Printer protocol for Phomemo printers
 * Handles print commands for both USB and BLE transports
 * Supports M-series (M02, M110, M200, M220, M260) and D-series (D30, D110)
 *
 * Printer definitions are data-driven from printers.json + user custom definitions.
 */

import { STORAGE_KEYS } from './constants.js';

// =============================================================================
// PRINTER DEFINITIONS MANAGER
// =============================================================================

let _allDefinitions = [];
let _builtinDefinitions = [];
let _loaded = false;

export async function loadPrinterDefinitions() {
  try {
    const resp = await fetch('./printers.json');
    const json = await resp.json();
    _builtinDefinitions = json.printers || [];
  } catch (e) {
    console.error('Failed to load printers.json:', e);
    _builtinDefinitions = [];
  }
  _loaded = true;
  _rebuildDefinitions();
}

export function getAllPrinterDefinitions() {
  if (!_loaded) {
    console.warn('Printer definitions not loaded yet; returning empty list');
    return [];
  }
  return _allDefinitions;
}

export function getPrinterDefinition(id) {
  return _allDefinitions.find(d => d.id === id) || null;
}

export function getCustomPrinterDefinitions() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_PRINTERS);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load custom printers:', e);
    return [];
  }
}

export function saveCustomPrinterDefinition(def) {
  const customs = getCustomPrinterDefinitions();
  const idx = customs.findIndex(d => d.id === def.id);
  const saved = { ...def, builtin: false };
  if (idx >= 0) {
    customs[idx] = saved;
  } else {
    customs.push(saved);
  }
  localStorage.setItem(STORAGE_KEYS.CUSTOM_PRINTERS, JSON.stringify(customs));
  _rebuildDefinitions();
}

export function deleteCustomPrinterDefinition(id) {
  const customs = getCustomPrinterDefinitions().filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEYS.CUSTOM_PRINTERS, JSON.stringify(customs));
  _rebuildDefinitions();
}

export function isBuiltinPrinter(id) {
  return _builtinDefinitions.some(d => d.id === id);
}

export function resetBuiltinPrinter(id) {
  deleteCustomPrinterDefinition(id);
}

export function getAvailableProtocols() {
  return [
    { value: 'm-series', label: 'M-series (ESC/POS Raster)' },
    { value: 'm02', label: 'M02-series (ESC/POS with Prefix)' },
    { value: 'm04', label: 'M04-series (300 DPI)' },
    { value: 'm110', label: 'M110-series (phomemo-tools)' },
    { value: 'd-series', label: 'D-series (Rotated)' },
    { value: 'p12', label: 'P12/Tape (Rotated, Continuous)' },
    { value: 'tspl', label: 'TSPL (Shipping Label)' },
  ];
}

export function getAvailableLabelPresets() {
  return [
    { value: 'm-series', label: 'M-series (standard labels)' },
    { value: 'd-series', label: 'D-series (small labels)' },
    { value: 'tape', label: 'Tape (continuous tape)' },
    { value: 'pm241', label: 'PM-241 (shipping labels)' },
  ];
}

function _rebuildDefinitions() {
  const customs = getCustomPrinterDefinitions();
  const customIds = new Set(customs.map(d => d.id));

  _allDefinitions = _builtinDefinitions
    .filter(d => !customIds.has(d.id))
    .map(d => ({ ...d }));

  for (const c of customs) {
    _allDefinitions.push({ ...c });
  }
}

// =============================================================================
// DETECTION AND CONFIG (data-driven from definitions)
// =============================================================================

const DEFAULT_CONFIG = { width: 72, protocol: 'm-series', dpi: 203 };

function _buildPatternList() {
  const customs = _allDefinitions.filter(d => !d.builtin);
  const builtins = _allDefinitions.filter(d => d.builtin);

  const list = [];
  for (const def of [...customs, ...builtins]) {
    if (!def.namePatterns) continue;
    for (const pat of def.namePatterns) {
      list.push({ pattern: pat.toUpperCase(), def });
    }
  }
  list.sort((a, b) => b.pattern.length - a.pattern.length);
  return list;
}

function detectPrinterConfig(deviceName) {
  if (!deviceName) return { ...DEFAULT_CONFIG, recognized: false, matchedPattern: null, definition: null };

  const name = deviceName.toUpperCase();
  const patterns = _buildPatternList();

  for (const { pattern, def } of patterns) {
    if (name.startsWith(pattern)) {
      return {
        width: def.widthBytes,
        protocol: def.protocol,
        dpi: def.dpi || 203,
        recognized: true,
        matchedPattern: pattern,
        definition: def,
      };
    }
  }
  return { ...DEFAULT_CONFIG, recognized: false, matchedPattern: null, definition: null };
}

function getOverrideConfig(modelOverride) {
  if (!modelOverride || modelOverride === 'auto') return null;

  const def = getPrinterDefinition(modelOverride);
  if (def) {
    return {
      width: def.widthBytes,
      protocol: def.protocol,
      dpi: def.dpi || 203,
      definition: def,
    };
  }
  return null;
}

function densityToHeatTime(density) {
  const heatTimes = [40, 60, 80, 100, 120, 140, 160, 200];
  return heatTimes[Math.max(0, Math.min(7, density - 1))];
}

const CMD = {
  INIT: new Uint8Array([0x1b, 0x40]),
  FEED: (dots) => new Uint8Array([0x1b, 0x4a, dots]),
  DENSITY: (level) => new Uint8Array([0x1d, 0x7c, level]),
  HEAT_SETTINGS: (maxDots, heatTime, heatInterval) =>
    new Uint8Array([0x1b, 0x37, maxDots, heatTime, heatInterval]),
  LINE_SPACING: (dots) => new Uint8Array([0x1b, 0x33, dots]),
  RASTER_HEADER: (widthBytes, heightLines) => new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes, 0x00,
    heightLines & 0xff, (heightLines >> 8) & 0xff,
  ]),
};

const M02_CMD = {
  PREFIX: new Uint8Array([0x10, 0xff, 0xfe, 0x01]),
};

const D_CMD = {
  HEADER: (widthBytes, rows) => new Uint8Array([
    0x1b, 0x40,
    0x1d, 0x76, 0x30, 0x00,
    widthBytes % 256,
    Math.floor(widthBytes / 256),
    rows % 256,
    Math.floor(rows / 256),
  ]),
  END: new Uint8Array([0x1b, 0x64, 0x00]),
  FEED: (dots) => new Uint8Array([0x1b, 0x4a, dots & 0xff]),
};

const M110_CMD = {
  SPEED: (speed) => new Uint8Array([0x1b, 0x4e, 0x0d, speed]),
  DENSITY: (density) => new Uint8Array([0x1b, 0x4e, 0x04, density]),
  MEDIA_TYPE: (type) => new Uint8Array([0x1f, 0x11, type]),
  FOOTER: new Uint8Array([0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]),
};

const M04_CMD = {
  DENSITY: (level) => new Uint8Array([0x1f, 0x11, 0x02, level]),
  HEAT: (param) => new Uint8Array([0x1f, 0x11, 0x37, param]),
  INIT: new Uint8Array([0x1f, 0x11, 0x0b]),
  COMPRESSION: (mode) => new Uint8Array([0x1f, 0x11, 0x35, mode]),
  RASTER_HEADER: (widthBytes, heightLines) => new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes % 256,
    Math.floor(widthBytes / 256),
    heightLines % 256,
    Math.floor(heightLines / 256),
  ]),
  FEED: new Uint8Array([0x1b, 0x64, 0x02]),
};

const P12_CMD = {
  INIT_SEQUENCE: [
    new Uint8Array([0x1f, 0x11, 0x38]),
    new Uint8Array([0x1f, 0x11, 0x11, 0x1f, 0x11, 0x12, 0x1f, 0x11, 0x09, 0x1f, 0x11, 0x13]),
    new Uint8Array([0x1f, 0x11, 0x09]),
    new Uint8Array([0x1f, 0x11, 0x19, 0x1f, 0x11, 0x11]),
    new Uint8Array([0x1f, 0x11, 0x19]),
    new Uint8Array([0x1f, 0x11, 0x07]),
  ],
  HEADER: (widthBytes, rows) => new Uint8Array([
    0x1b, 0x40,
    0x1d, 0x76, 0x30, 0x00,
    widthBytes % 256,
    Math.floor(widthBytes / 256),
    rows % 256,
    Math.floor(rows / 256),
  ]),
  FEED: new Uint8Array([0x1b, 0x64, 0x0d]),
};

const TSPL = {
  cmd: (str) => new TextEncoder().encode(str + '\r\n'),
  SIZE: (widthMm, heightMm) => new TextEncoder().encode(`SIZE ${widthMm} mm, ${heightMm} mm\r\n`),
  GAP: (gapMm) => new TextEncoder().encode(`GAP ${gapMm} mm, 0 mm\r\n`),
  DENSITY: (level) => new TextEncoder().encode(`DENSITY ${level}\r\n`),
  SPEED: (speed) => new TextEncoder().encode(`SPEED ${speed}\r\n`),
  DIRECTION: (dir) => new TextEncoder().encode(`DIRECTION ${dir}\r\n`),
  CLS: () => new TextEncoder().encode('CLS\r\n'),
  BITMAP_HEADER: (x, y, widthBytes, heightDots) =>
    new TextEncoder().encode(`BITMAP ${x},${y},${widthBytes},${heightDots},0,`),
  PRINT: (copies = 1) => new TextEncoder().encode(`PRINT ${copies}\r\n`),
  END: () => new TextEncoder().encode('END\r\n'),
};

function _resolveConfig(deviceName, modelOverride = 'auto') {
  const overrideConfig = getOverrideConfig(modelOverride);
  if (overrideConfig) return overrideConfig;
  return detectPrinterConfig(deviceName);
}

export function isDeviceRecognized(deviceName) {
  return detectPrinterConfig(deviceName).recognized;
}

export function getMatchedPattern(deviceName) {
  return detectPrinterConfig(deviceName).matchedPattern;
}

export function getDetectedDefinition(deviceName) {
  return detectPrinterConfig(deviceName).definition;
}

export function isDSeriesPrinter(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'd-series';
}

export function isM02Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'm02';
}

export function isP12Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'p12';
}

export function isA30Printer(deviceName, modelOverride = 'auto') {
  const def = _resolveConfig(deviceName, modelOverride).definition;
  return def?.id === 'a30';
}

export function isTapePrinter(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  const def = config.definition;
  if (def) return !!def.tape;
  return config.protocol === 'p12';
}

export function isPM241Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'tspl';
}

export function isTSPLPrinter(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'tspl';
}

function isM110Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'm110';
}

function isM04Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'm04';
}

export function isRotatedPrinter(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  const def = config.definition;
  if (def) return !!def.rotated;
  return config.protocol === 'd-series' || config.protocol === 'p12';
}

export function isNarrowMSeriesPrinter(deviceName, modelOverride = 'auto') {
  return getPrinterWidthBytes(deviceName, modelOverride) === 48;
}

export function getPrinterAlignment(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  const def = config.definition;
  if (def && def.alignment) return def.alignment;
  return 'center';
}

export function getPrinterWidthBytes(deviceName, modelOverride = 'auto') {
  const overrideConfig = getOverrideConfig(modelOverride);
  if (overrideConfig && overrideConfig.width !== null) return overrideConfig.width;
  const config = detectPrinterConfig(deviceName);
  return config.width ?? DEFAULT_CONFIG.width;
}

export function getPrinterDpi(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  return config.dpi || 203;
}

export function getPrinterDescription(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  const def = config.definition;
  if (def) {
    const widthMm = def.widthBytes ? Math.round(def.widthBytes * 8 / 8) : null;
    return def.name + (widthMm ? ` (${widthMm}mm)` : '');
  }
  const width = getPrinterWidthBytes(deviceName, modelOverride);
  const widthMm = Math.round(width * 8 / 8);
  return `M-series (${widthMm}mm)`;
}

function rotateRaster90CW(data, widthBytes, heightLines) {
  const srcWidthPx = widthBytes * 8;
  const srcHeightPx = heightLines;
  const dstWidthPx = srcHeightPx;
  const dstHeightPx = srcWidthPx;
  const dstWidthBytes = Math.ceil(dstWidthPx / 8);
  const rotated = new Uint8Array(dstWidthBytes * dstHeightPx);

  for (let srcY = 0; srcY < srcHeightPx; srcY++) {
    for (let srcX = 0; srcX < srcWidthPx; srcX++) {
      const srcByteIdx = srcY * widthBytes + Math.floor(srcX / 8);
      const srcBitIdx = 7 - (srcX % 8);
      const pixel = (data[srcByteIdx] >> srcBitIdx) & 1;
      const dstX = srcHeightPx - 1 - srcY;
      const dstY = srcX;
      const dstByteIdx = dstY * dstWidthBytes + Math.floor(dstX / 8);
      const dstBitIdx = 7 - (dstX % 8);
      if (pixel) {
        rotated[dstByteIdx] |= (1 << dstBitIdx);
      }
    }
  }
  return { data: rotated, widthBytes: dstWidthBytes, heightLines: dstHeightPx };
}

function rotateRaster90CCW(data, widthBytes, heightLines) {
  const srcWidthPx = widthBytes * 8;
  const srcHeightPx = heightLines;
  const dstWidthPx = srcHeightPx;
  const dstHeightPx = srcWidthPx;
  const dstWidthBytes = Math.ceil(dstWidthPx / 8);
  const rotated = new Uint8Array(dstWidthBytes * dstHeightPx);

  for (let srcY = 0; srcY < srcHeightPx; srcY++) {
    for (let srcX = 0; srcX < srcWidthPx; srcX++) {
      const srcByteIdx = srcY * widthBytes + Math.floor(srcX / 8);
      const srcBitIdx = 7 - (srcX % 8);
      const pixel = (data[srcByteIdx] >> srcBitIdx) & 1;
      const dstX = srcY;
      const dstY = srcWidthPx - 1 - srcX;
      const dstByteIdx = dstY * dstWidthBytes + Math.floor(dstX / 8);
      const dstBitIdx = 7 - (dstX % 8);
      if (pixel) {
        rotated[dstByteIdx] |= (1 << dstBitIdx);
      }
    }
  }
  return { data: rotated, widthBytes: dstWidthBytes, heightLines: dstHeightPx };
}

export async function print(transport, rasterData, options = {}) {
  const { 
    isBLE = false, 
    deviceName = '', 
    printerModel = 'auto', 
    density = 6, 
    feed = 32, 
    continuous = false, 
    onProgress = null,
    isCancelled = null 
  } = options;
  
  const { data, widthBytes, heightLines } = rasterData;

  const isDSeries = isDSeriesPrinter(deviceName, printerModel);
  const isP12 = isP12Printer(deviceName, printerModel);
  const isM02 = isM02Printer(deviceName, printerModel);
  const isM04 = isM04Printer(deviceName, printerModel);
  const isM110 = isM110Printer(deviceName, printerModel);
  const isTSPL = isTSPLPrinter(deviceName, printerModel);
  const printerDesc = getPrinterDescription(deviceName, printerModel);
  
  console.log(`Printing: ${widthBytes}x${heightLines} (${data.length} bytes)`);
  console.log(`Device: ${deviceName}, Model: ${printerModel}, Detected: ${printerDesc}`);
  console.log(`Transport: ${isBLE ? 'BLE' : 'USB'}, Density: ${density}, Feed: ${feed}`);

  if (isTSPL) {
    const labelWidthMm = Math.round(widthBytes * 8 / 8);
    const labelHeightMm = Math.round(heightLines / 8);
    await printTSPL(transport, data, widthBytes, heightLines, labelWidthMm, labelHeightMm, density, onProgress);
  } else if (isP12 && isBLE) {
    await printP12(transport, data, widthBytes, heightLines, onProgress);
  } else if (isDSeries && isBLE) {
    await printDSeries(transport, data, widthBytes, heightLines, onProgress, density, continuous, feed);
  } else if (isM02 && isBLE) {
    await printM02(transport, data, widthBytes, heightLines, density, feed, onProgress, isCancelled);
  } else if (isM04 && isBLE) {
    await printM04(transport, data, widthBytes, heightLines, density, feed, onProgress);
  } else if (isM110 && isBLE) {
    await printM110(transport, data, widthBytes, heightLines, density, onProgress);
  } else if (isBLE) {
    // Standard M-series also gets the cancellation handling just in case of detection fallback
    await printBLE(transport, data, widthBytes, heightLines, density, feed, onProgress, isCancelled);
  } else {
    await printUSB(transport, data, widthBytes, heightLines, density, feed, onProgress);
  }
}

async function printDSeries(transport, data, widthBytes, heightLines, onProgress, density = 6, continuous = false, feed = 0) {
  console.log('Using D-series protocol...');
  const rotated = rotateRaster90CW(data, widthBytes, heightLines);
  
  let printData = rotated.data;
  let printRows = rotated.heightLines;
  if (continuous && feed > 0) {
    const cutterOffset = 56;
    const paddingRows = cutterOffset + feed;
    const paddingBytes = paddingRows * rotated.widthBytes;
    const padded = new Uint8Array(rotated.data.length + paddingBytes);
    padded.set(rotated.data);
    printData = padded;
    printRows = rotated.heightLines + paddingRows;
  }

  const heatTime = densityToHeatTime(density);
  await transport.send(CMD.HEAT_SETTINGS(7, heatTime, 2));
  await transport.delay(30);

  const mediaType = continuous ? 0x0b : 0x0a;
  await transport.send(new Uint8Array([0x1f, 0x11, mediaType]));
  await transport.delay(30);

  await transport.send(D_CMD.HEADER(rotated.widthBytes, printRows));

  const chunkSize = 128;
  for (let i = 0; i < printData.length; i += chunkSize) {
    const chunk = printData.slice(i, Math.min(i + chunkSize, printData.length));
    await transport.send(chunk);
    await transport.delay(20);

    if (onProgress) {
      const progress = Math.round((i + chunk.length) / printData.length * 100);
      onProgress(progress);
    }
  }

  await transport.delay(100);
  await transport.send(D_CMD.END);
}

async function printP12(transport, data, widthBytes, heightLines, onProgress) {
  console.log('Using P12-series protocol...');
  const rotated = rotateRaster90CW(data, widthBytes, heightLines);

  for (let i = 0; i < P12_CMD.INIT_SEQUENCE.length; i++) {
    const cmd = P12_CMD.INIT_SEQUENCE[i];
    await transport.send(cmd);
    if (transport.waitForResponse) {
      await transport.waitForResponse(500);
    } else {
      await transport.delay(100);
    }
  }

  await transport.send(P12_CMD.HEADER(rotated.widthBytes, rotated.heightLines));

  const chunkSize = 128;
  for (let i = 0; i < rotated.data.length; i += chunkSize) {
    const chunk = rotated.data.slice(i, Math.min(i + chunkSize, rotated.data.length));
    await transport.send(chunk);
    await transport.delay(20);

    if (onProgress) {
      const progress = Math.round((i + chunk.length) / rotated.data.length * 100);
      onProgress(progress);
    }
  }

  await transport.delay(100);
  await transport.send(P12_CMD.FEED);
  await transport.delay(50);
  await transport.send(P12_CMD.FEED);
}

async function printM02(transport, data, widthBytes, heightLines, density, feed, onProgress, isCancelled = null) {
  console.log('Using M02-series protocol...');

  await transport.send(M02_CMD.PREFIX);
  await transport.delay(50);

  await transport.send(CMD.INIT);
  await transport.delay(100);

  const heatTime = densityToHeatTime(density);
  await transport.send(CMD.HEAT_SETTINGS(7, heatTime, 2));
  await transport.delay(30);

  await transport.send(CMD.RASTER_HEADER(widthBytes, heightLines));

  const chunkSize = 128;
  let sent = 0;
  let cancelled = false;

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    
    await transport.send(chunk);
    sent += chunk.length;

    if (onProgress) {
      const progress = Math.round((sent / data.length) * 100);
      onProgress(progress);
    }

    // CHECK CANCELLATION AFTER SENDING THE CHUNK
    if (isCancelled && isCancelled()) {
      cancelled = true;
      const remaining = data.length - sent;
      console.log(`Print cancelled at ${sent}/${data.length} bytes. Draining ${remaining} raster bytes...`);

      const blankChunk = new Uint8Array(chunkSize);
      let remainingToSend = remaining;

      // Finish the currently declared GS v 0 payload with zeros
      while (remainingToSend > 0) {
        const count = Math.min(chunkSize, remainingToSend);
        await transport.send(blankChunk.slice(0, count));
        remainingToSend -= count;
        await transport.delay(20);
      }

      console.log('Raster command completely drained.');
      throw new Error('CANCELLED'); 
    }

    await transport.delay(20);
  }

  await transport.delay(300);
  // Use dynamic feed provided by photobooth.js instead of hardcoded 8
  await transport.send(CMD.FEED(feed));
  await transport.delay(500);

  console.log('Print complete!');
}

async function printM04(transport, data, widthBytes, heightLines, density, feed, onProgress) {
  console.log('Using M04-series protocol (300 DPI)...');

  const m04Density = Math.round((density / 8) * 15);
  const m04Heat = Math.round(100 + (density - 1) * 50 / 3);

  await transport.send(M04_CMD.DENSITY(m04Density));
  await transport.delay(30);

  await transport.send(M04_CMD.HEAT(m04Heat));
  await transport.delay(30);

  await transport.send(M04_CMD.INIT);
  await transport.delay(30);

  await transport.send(M04_CMD.COMPRESSION(0x00));
  await transport.delay(30);

  await transport.send(M04_CMD.RASTER_HEADER(widthBytes, heightLines));

  const chunkSize = 256;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    await transport.send(chunk);
    await transport.delay(20);

    if (onProgress) {
      const progress = Math.round((i + chunk.length) / data.length * 100);
      onProgress(progress);
    }
  }

  await transport.delay(300);
  const feedCount = Math.max(1, Math.round(feed / 16));
  for (let i = 0; i < feedCount; i++) {
    await transport.send(M04_CMD.FEED);
    await transport.delay(30);
  }
  await transport.delay(500);
}

async function printM110(transport, data, widthBytes, heightLines, density, onProgress) {
  console.log('Using M110 protocol (phomemo-tools)...');
  const m110Density = Math.round(5 + density * 1.25); 

  await transport.send(M110_CMD.SPEED(5));
  await transport.delay(30);

  await transport.send(M110_CMD.DENSITY(m110Density));
  await transport.delay(30);

  await transport.send(M110_CMD.MEDIA_TYPE(10));
  await transport.delay(30);

  await transport.send(CMD.RASTER_HEADER(widthBytes, heightLines));

  const chunkSize = 128;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    await transport.send(chunk);
    await transport.delay(20);

    if (onProgress) {
      const progress = Math.round((i + chunk.length) / data.length * 100);
      onProgress(progress);
    }
  }

  await transport.delay(300);
  await transport.send(M110_CMD.FOOTER);
  await transport.delay(500);
}

async function printBLE(transport, data, widthBytes, heightLines, density, feed, onProgress, isCancelled = null) {
  console.log('Sending init...');
  await transport.send(CMD.INIT);
  await transport.delay(100);

  const heatTime = densityToHeatTime(density);
  await transport.send(CMD.HEAT_SETTINGS(7, heatTime, 2));
  await transport.delay(30);
  
  await transport.send(CMD.DENSITY(density));
  await transport.delay(50);

  await transport.send(CMD.RASTER_HEADER(widthBytes, heightLines));

  const chunkSize = 128;
  let sent = 0;
  let cancelled = false;

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    await transport.send(chunk);
    sent += chunk.length;

    if (onProgress) {
      const progress = Math.round((sent / data.length) * 100);
      onProgress(progress);
    }

    if (isCancelled && isCancelled()) {
      cancelled = true;
      const remaining = data.length - sent;
      console.log(`Print cancelled at ${sent}/${data.length} bytes. Draining ${remaining} raster bytes...`);

      const blankChunk = new Uint8Array(chunkSize);
      let remainingToSend = remaining;

      while (remainingToSend > 0) {
        const count = Math.min(chunkSize, remainingToSend);
        await transport.send(blankChunk.slice(0, count));
        remainingToSend -= count;
        await transport.delay(20);
      }

      console.log('Raster command completely drained.');
      throw new Error('CANCELLED'); 
    }

    await transport.delay(20);
  }

  await transport.delay(300);
  await transport.send(CMD.FEED(feed));
  await transport.delay(800);
}

async function printUSB(transport, data, widthBytes, heightLines, density, feed, onProgress) {
  await transport.send(CMD.INIT);
  await transport.delay(100);

  await transport.send(CMD.DENSITY(density));
  await transport.send(CMD.LINE_SPACING(0)); 
  await transport.send(CMD.FEED(0x0c)); 
  await transport.delay(50);

  await transport.send(CMD.RASTER_HEADER(widthBytes, heightLines));

  const chunkSize = 512;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    await transport.send(chunk);
    await transport.delay(20);

    if (onProgress) {
      const progress = Math.round((i + chunk.length) / data.length * 100);
      onProgress(progress);
    }
  }

  await transport.delay(100);
  await transport.send(CMD.FEED(feed));
}

async function printTSPL(transport, data, widthBytes, heightLines, labelWidthMm, labelHeightMm, density, onProgress) {
  const tsplDensity = Math.round((density / 8) * 15);

  await transport.send(TSPL.SIZE(labelWidthMm, labelHeightMm));
  await transport.delay(50);
  await transport.send(TSPL.GAP(3));
  await transport.delay(50);
  await transport.send(new TextEncoder().encode('OFFSET -3 mm\r\n'));
  await transport.delay(50);
  await transport.send(TSPL.DENSITY(tsplDensity));
  await transport.delay(50);
  await transport.send(TSPL.SPEED(4));
  await transport.delay(50);
  await transport.send(TSPL.DIRECTION(0));
  await transport.delay(50);
  await transport.send(TSPL.CLS());
  await transport.delay(50);
  await transport.send(TSPL.BITMAP_HEADER(0, 0, widthBytes, heightLines));

  const invertedData = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    invertedData[i] = data[i] ^ 0xFF;
  }

  const chunkSize = 512;
  for (let i = 0; i < invertedData.length; i += chunkSize) {
    const chunk = invertedData.slice(i, Math.min(i + chunkSize, invertedData.length));
    await transport.send(chunk);
    await transport.delay(10);

    if (onProgress) {
      const progress = Math.round((i + chunk.length) / invertedData.length * 100);
      onProgress(progress);
    }
  }

  await transport.send(new TextEncoder().encode('\r\n'));
  await transport.delay(50);
  await transport.send(TSPL.PRINT(1));
  await transport.delay(50);
  await transport.send(TSPL.END());
}

export async function printDensityTest(transport, isBLE = true, onProgress = null) {
  const stripHeight = 30;
  const stripWidth = 320; 
  const widthBytes = stripWidth / 8; 
  const gap = 8; 

  for (let density = 1; density <= 8; density++) {
    if (onProgress) onProgress(Math.round((density - 1) / 8 * 100));

    const heatTime = densityToHeatTime(density);
    const stripData = new Uint8Array(widthBytes * stripHeight);
    stripData.fill(0xFF); 

    await transport.send(CMD.INIT);
    await transport.delay(50);

    await transport.send(CMD.HEAT_SETTINGS(7, heatTime, 2));
    await transport.delay(30);

    await transport.send(CMD.DENSITY(density));
    await transport.delay(30);

    await transport.send(CMD.RASTER_HEADER(widthBytes, stripHeight));

    const chunkSize = isBLE ? 128 : 512;
    for (let i = 0; i < stripData.length; i += chunkSize) {
      const chunk = stripData.slice(i, Math.min(i + chunkSize, stripData.length));
      await transport.send(chunk);
      await transport.delay(isBLE ? 20 : 10);
    }

    if (density < 8) {
      await transport.delay(200);
      await transport.send(CMD.FEED(gap));
      await transport.delay(300);
    }
  }

  await transport.delay(300);
  await transport.send(CMD.FEED(48));
  await transport.delay(500);

  if (onProgress) onProgress(100);
}
