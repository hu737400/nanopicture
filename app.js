const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const workspace = document.getElementById('workspace');
const metaInfo = document.getElementById('metaInfo');
const emptyState = document.getElementById('emptyState');

const uploadInput = document.getElementById('uploadInput');
const importElementBtn = document.getElementById('importElementBtn');
const importElementInput = document.getElementById('importElementInput');
const textInput = document.getElementById('textInput');
const fontFamilyInput = document.getElementById('fontFamilyInput');
const fontSizeInput = document.getElementById('fontSizeInput');
const textColorInput = document.getElementById('textColorInput');
const textRotationInput = document.getElementById('textRotationInput');
const fontBoldInput = document.getElementById('fontBoldInput');
const fontThinInput = document.getElementById('fontThinInput');
const exportBtn = document.getElementById('exportBtn');
const exportTiffBtn = document.getElementById('exportTiffBtn');
const editTextBtn = document.getElementById('editTextBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const undoBtn = document.getElementById('undoBtn');
const saveProjectBtn = document.getElementById('saveProjectBtn');
const loadProjectInput = document.getElementById('loadProjectInput');
const zoomRange = document.getElementById('zoomRange');
const zoomValue = document.getElementById('zoomValue');

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 480;
const TEXT_HANDLE_SIZE = 12;
const MIN_SPRITE_SIZE = 12;
const DELETE_HANDLE_SIZE = 18;
const MAX_HISTORY_STEPS = 80;
const TARGET_DPI = 300;
const JOURNAL_SINGLE_COLUMN_CM = 8.5;
const JOURNAL_DOUBLE_COLUMN_CM = 17.8;
const CANVAS_RESIZE_HANDLE_SIZE = 14;
const CANVAS_RESIZE_MIN_SIZE = 32;

const state = {
  baseImage: null,
  baseImageSrc: '',
  imageName: '',
  width: 0,
  height: 0,
  imageDpiX: null,
  imageDpiY: null,
  imageDpiSource: 'missing',
  tool: 'move',
  objects: [],
  holes: [],
  selectedId: null,
  nextId: 1,
  drag: null,
  resize: null,
  selection: null,
  viewScale: 1,
  userZoom: 1,
  baseScale: 1,
  inlineEditor: null,
  history: [],
  isRestoringHistory: false,
  canvasResize: null,
};

function makeOffscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function cloneCanvas(source) {
  const copy = makeOffscreen(source.width, source.height);
  const copyCtx = copy.getContext('2d');
  copyCtx.drawImage(source, 0, 0);
  return copy;
}

function cloneHole(hole) {
  return {
    x: Number(hole.x) || 0,
    y: Number(hole.y) || 0,
    w: Number(hole.w) || 0,
    h: Number(hole.h) || 0,
    color: hole.color || 'rgba(255,255,255,1)'
  };
}

function cloneObjectForHistory(obj) {
  if (!obj) {
    return null;
  }

  if (obj.type === 'text') {
    return normalizeTextObject({
      id: Number(obj.id) || 0,
      type: 'text',
      x: Number(obj.x) || 0,
      y: Number(obj.y) || 0,
      text: String(obj.text || ''),
      fontSize: Number(obj.fontSize) || 32,
      color: obj.color || '#000000',
      fontFamily: obj.fontFamily || 'Arial',
      rotation: clampRotation(obj.rotation || 0),
      bold: Boolean(obj.bold),
      thin: Boolean(obj.thin)
    });
  }

  if (obj.type === 'sprite' && obj.canvas) {
    return {
      id: Number(obj.id) || 0,
      type: 'sprite',
      x: Number(obj.x) || 0,
      y: Number(obj.y) || 0,
      w: Number(obj.w) || obj.canvas.width,
      h: Number(obj.h) || obj.canvas.height,
      canvas: cloneCanvas(obj.canvas)
    };
  }

  return null;
}

function makeHistorySnapshot() {
  return {
    baseImage: state.baseImage ? cloneCanvas(state.baseImage) : null,
    width: state.width,
    height: state.height,
    objects: state.objects.map(cloneObjectForHistory).filter(Boolean),
    holes: state.holes.map(cloneHole),
    selectedId: state.selectedId,
    nextId: state.nextId
  };
}

function canUndo() {
  return hasImage() && state.history.length > 0;
}

function updateUndoButton() {
  if (!undoBtn) {
    return;
  }
  undoBtn.disabled = !canUndo();
}

function pushHistorySnapshot(snapshot) {
  if (!snapshot || !hasImage() || state.isRestoringHistory) {
    return;
  }
  state.history.push(snapshot);
  if (state.history.length > MAX_HISTORY_STEPS) {
    state.history.shift();
  }
  updateUndoButton();
}

function recordHistory() {
  pushHistorySnapshot(makeHistorySnapshot());
}

function clearHistory() {
  state.history = [];
  updateUndoButton();
}

function restoreHistorySnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  state.baseImage = snapshot.baseImage ? cloneCanvas(snapshot.baseImage) : null;
  state.width = Number(snapshot.width) || 0;
  state.height = Number(snapshot.height) || 0;

  canvas.width = state.width;
  canvas.height = state.height;

  state.objects = (snapshot.objects || []).map(cloneObjectForHistory).filter(Boolean);
  state.holes = (snapshot.holes || []).map(cloneHole);
  state.nextId = Math.max(Number(snapshot.nextId) || 1, 1);

  const nextSelectedId = snapshot.selectedId;
  state.selectedId = state.objects.some((obj) => obj.id === nextSelectedId) ? nextSelectedId : null;

  state.drag = null;
  state.resize = null;
  state.selection = null;
  state.canvasResize = null;
  closeInlineEditor();

  if (state.selectedId !== null) {
    const selected = objectById(state.selectedId);
    if (selected && selected.type === 'text') {
      syncTextControlsFromObject(selected);
    }
  }

  updateCanvasDisplaySize(false);
  updateMeta();
  render();
  updateUndoButton();
}

function undoLastAction() {
  if (!canUndo()) {
    return;
  }

  const snapshot = state.history.pop();
  state.isRestoringHistory = true;
  try {
    restoreHistorySnapshot(snapshot);
  } finally {
    state.isRestoringHistory = false;
  }
}

function hasImage() {
  return Boolean(state.baseImage);
}

function setImageDpiInfo(info = null) {
  const nextX = Number(info?.dpiX);
  const nextY = Number(info?.dpiY);
  const source = typeof info?.source === 'string' ? info.source : 'missing';
  state.imageDpiX = Number.isFinite(nextX) && nextX > 0 ? nextX : null;
  state.imageDpiY = Number.isFinite(nextY) && nextY > 0 ? nextY : null;
  state.imageDpiSource = source;
}

function parsePngDpiFromBuffer(buffer) {
  const fallback = { dpiX: null, dpiY: null, source: 'missing' };
  if (!(buffer instanceof ArrayBuffer)) {
    return fallback;
  }

  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (len < signature.length || signature.some((value, index) => bytes[index] !== value)) {
    return fallback;
  }

  const view = new DataView(buffer);
  let offset = 8;

  while (offset + 8 <= len) {
    const chunkLength = view.getUint32(offset, false);
    offset += 4;
    if (offset + 4 > len) {
      break;
    }

    const chunkType = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    offset += 4;
    if (offset + chunkLength + 4 > len) {
      break;
    }

    if (chunkType === 'pHYs') {
      if (chunkLength < 9) {
        return fallback;
      }
      const xPixelsPerUnit = view.getUint32(offset, false);
      const yPixelsPerUnit = view.getUint32(offset + 4, false);
      const unitSpecifier = bytes[offset + 8];
      if (unitSpecifier === 1 && xPixelsPerUnit > 0 && yPixelsPerUnit > 0) {
        return {
          dpiX: xPixelsPerUnit * 0.0254,
          dpiY: yPixelsPerUnit * 0.0254,
          source: 'metadata'
        };
      }
      if (unitSpecifier === 0) {
        return { dpiX: null, dpiY: null, source: 'unitless' };
      }
      return fallback;
    }

    offset += chunkLength + 4;
    if (chunkType === 'IEND') {
      break;
    }
  }

  return fallback;
}

async function readPngDpiFromFile(file) {
  if (!file) {
    return { dpiX: null, dpiY: null, source: 'missing' };
  }
  try {
    const buffer = await file.arrayBuffer();
    return parsePngDpiFromBuffer(buffer);
  } catch (err) {
    console.error(err);
    return { dpiX: null, dpiY: null, source: 'missing' };
  }
}

function readPngDpiFromDataUrl(dataUrl) {
  const fallback = { dpiX: null, dpiY: null, source: 'missing' };
  if (typeof dataUrl !== 'string') {
    return fallback;
  }
  const match = dataUrl.match(/^data:image\/png(?:;[^,]*)?;base64,/i);
  if (!match) {
    return fallback;
  }

  try {
    const base64 = dataUrl.slice(match[0].length);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return parsePngDpiFromBuffer(bytes.buffer);
  } catch (err) {
    console.error(err);
    return fallback;
  }
}

function calcEffectiveDpiForPrintWidth(printWidthCm) {
  if (!Number.isFinite(printWidthCm) || printWidthCm <= 0 || !Number.isFinite(state.width) || state.width <= 0) {
    return 0;
  }
  return state.width / (printWidthCm / 2.54);
}

function buildAutoDpiEvaluation() {
  const singleDpi = calcEffectiveDpiForPrintWidth(JOURNAL_SINGLE_COLUMN_CM);
  const doubleDpi = calcEffectiveDpiForPrintWidth(JOURNAL_DOUBLE_COLUMN_CM);
  const singlePass = singleDpi >= TARGET_DPI;
  const doublePass = doubleDpi >= TARGET_DPI;

  if (doublePass) {
    return {
      singleDpi,
      doubleDpi,
      levelClass: 'dpi-ok',
      summary: '双栏/单栏都达标'
    };
  }
  if (singlePass) {
    return {
      singleDpi,
      doubleDpi,
      levelClass: 'dpi-warn',
      summary: '单栏达标，双栏不足'
    };
  }
  return {
    singleDpi,
    doubleDpi,
    levelClass: 'dpi-bad',
    summary: '单栏/双栏都不足'
  };
}

function formatDpiLabel() {
  const autoEval = buildAutoDpiEvaluation();
  const printWidthIn = (state.width / TARGET_DPI).toFixed(2);
  const printHeightIn = (state.height / TARGET_DPI).toFixed(2);
  const printSizeText = `300DPI尺寸 ${printWidthIn}in x ${printHeightIn}in`;
  const autoText =
    `自动评估 单栏${JOURNAL_SINGLE_COLUMN_CM}cm=${Math.round(autoEval.singleDpi)}DPI，` +
    `双栏${JOURNAL_DOUBLE_COLUMN_CM}cm=${Math.round(autoEval.doubleDpi)}DPI（${autoEval.summary}）`;

  if (Number.isFinite(state.imageDpiX) && Number.isFinite(state.imageDpiY)) {
    const dpiX = state.imageDpiX.toFixed(1);
    const dpiY = state.imageDpiY.toFixed(1);
    const reachedTarget = Math.min(state.imageDpiX, state.imageDpiY) >= TARGET_DPI;
    return {
      text: `元数据DPI ${dpiX} x ${dpiY}（${reachedTarget ? '达标' : '不足'}，目标≥${TARGET_DPI}） | ${autoText} | ${printSizeText}`,
      levelClass: autoEval.levelClass
    };
  }

  if (state.imageDpiSource === 'unitless') {
    return {
      text: `元数据DPI无单位信息（目标≥${TARGET_DPI}） | ${autoText} | ${printSizeText}`,
      levelClass: autoEval.levelClass
    };
  }

  return {
    text: `元数据DPI未检测到（不代表不达标） | ${autoText} | ${printSizeText}`,
    levelClass: autoEval.levelClass
  };
}

function getExportBaseName() {
  const sourceName = state.imageName || 'figure.png';
  const base = sourceName.replace(/\.[a-z0-9]+$/i, '');
  return base || 'figure';
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderOutputCanvas() {
  const output = makeOffscreen(state.width, state.height);
  const outCtx = output.getContext('2d');
  if (!outCtx) {
    throw new Error('无法创建导出画布');
  }
  renderTo(outCtx);
  return output;
}

function encodeCanvasToTiffBlob(sourceCanvas) {
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    throw new Error('无法读取导出画布');
  }

  const { width, height } = sourceCanvas;
  const pixels = sourceCtx.getImageData(0, 0, width, height).data;
  const bitsPerSampleOffset = 8 + (2 + 11 * 12 + 4);
  const pixelOffset = bitsPerSampleOffset + 8;
  const totalSize = pixelOffset + pixels.length;
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);

  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  const entryCount = 11;
  const ifdOffset = 8;
  view.setUint16(ifdOffset, entryCount, true);

  let entryOffset = ifdOffset + 2;
  const writeEntry = (tag, type, count, value) => {
    view.setUint16(entryOffset, tag, true);
    view.setUint16(entryOffset + 2, type, true);
    view.setUint32(entryOffset + 4, count, true);
    view.setUint32(entryOffset + 8, value, true);
    entryOffset += 12;
  };

  writeEntry(256, 4, 1, width);
  writeEntry(257, 4, 1, height);
  writeEntry(258, 3, 4, bitsPerSampleOffset);
  writeEntry(259, 3, 1, 1);
  writeEntry(262, 3, 1, 2);
  writeEntry(273, 4, 1, pixelOffset);
  writeEntry(277, 3, 1, 4);
  writeEntry(278, 4, 1, height);
  writeEntry(279, 4, 1, pixels.length);
  writeEntry(284, 3, 1, 1);
  writeEntry(338, 3, 1, 2);
  view.setUint32(ifdOffset + 2 + entryCount * 12, 0, true);

  view.setUint16(bitsPerSampleOffset, 8, true);
  view.setUint16(bitsPerSampleOffset + 2, 8, true);
  view.setUint16(bitsPerSampleOffset + 4, 8, true);
  view.setUint16(bitsPerSampleOffset + 6, 8, true);

  bytes.set(pixels, pixelOffset);
  return new Blob([bytes], { type: 'image/tiff' });
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function clampRotation(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return clamp(n, -360, 360);
}

function normalizeTextObject(obj) {
  if (!obj || obj.type !== 'text') {
    return obj;
  }
  obj.text = String(obj.text || '');
  obj.fontFamily = obj.fontFamily || 'Arial';
  obj.fontSize = clamp(Number(obj.fontSize) || 32, MIN_FONT_SIZE, MAX_FONT_SIZE);
  obj.color = obj.color || '#000000';
  obj.rotation = clampRotation(obj.rotation || 0);
  obj.bold = Boolean(obj.bold);
  obj.thin = Boolean(obj.thin);
  if (obj.bold && obj.thin) {
    obj.thin = false;
  }
  return obj;
}

function textFontFromObject(obj) {
  normalizeTextObject(obj);
  const weight = obj.bold ? '700 ' : obj.thin ? '300 ' : '';
  return `${weight}${obj.fontSize}px ${obj.fontFamily}`;
}

function weightStyleFromFlags(bold, thin) {
  if (bold) {
    return '700';
  }
  if (thin) {
    return '300';
  }
  return '400';
}

function getWeightStateFromControls() {
  const bold = Boolean(fontBoldInput && fontBoldInput.checked);
  const thin = Boolean(fontThinInput && fontThinInput.checked) && !bold;
  if (fontThinInput) {
    fontThinInput.checked = thin;
  }
  return { bold, thin };
}

function textMetrics(obj, context) {
  normalizeTextObject(obj);
  context.save();
  context.font = textFontFromObject(obj);
  const metrics = context.measureText(obj.text || '');
  context.restore();
  return {
    w: Math.max(metrics.width, 10),
    h: obj.fontSize * 1.25
  };
}

function zoomAtClientPoint(clientX, clientY, nextUserZoom) {
  if (!hasImage()) {
    return;
  }

  const prevUserZoom = Number(state.userZoom) || 1;
  const clampedZoom = clamp(nextUserZoom, 0.1, 10);

  if (Math.abs(clampedZoom - prevUserZoom) < 1e-6) {
    return;
  }

  const workspaceRect = workspace.getBoundingClientRect();
  const canvasRectBefore = canvas.getBoundingClientRect();

  // 鼠标在 canvas 当前显示区域中的相对位置（0~1）
  const relX = (clientX - canvasRectBefore.left) / canvasRectBefore.width;
  const relY = (clientY - canvasRectBefore.top) / canvasRectBefore.height;

  // 防止鼠标在 canvas 外时出现异常
  const clampedRelX = clamp(relX, 0, 1);
  const clampedRelY = clamp(relY, 0, 1);

  // 更新缩放
  state.userZoom = clampedZoom;
  if (zoomRange) {
    zoomRange.value = String(Math.round(clampedZoom * 100));
  }

  updateCanvasDisplaySize(false);
  render();

  const canvasRectAfter = canvas.getBoundingClientRect();

  // canvas 在 workspace 内容坐标系中的左上角位置
  const canvasLeftInWorkspace =
    canvasRectAfter.left - workspaceRect.left + workspace.scrollLeft;
  const canvasTopInWorkspace =
    canvasRectAfter.top - workspaceRect.top + workspace.scrollTop;

  // 鼠标对应点在缩放后 canvas 上的位置
  const targetXInCanvas = clampedRelX * canvasRectAfter.width;
  const targetYInCanvas = clampedRelY * canvasRectAfter.height;

  // 让这个点回到鼠标当前位置
  const pointerXInWorkspace = clientX - workspaceRect.left;
  const pointerYInWorkspace = clientY - workspaceRect.top;

  workspace.scrollLeft =
    canvasLeftInWorkspace + targetXInCanvas - pointerXInWorkspace;
  workspace.scrollTop =
    canvasTopInWorkspace + targetYInCanvas - pointerYInWorkspace;
}

function getMousePointRaw(e) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return { x: 0, y: 0 };
  }
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function getMousePoint(e) {
  const p = getMousePointRaw(e);
  return {
    x: clamp(p.x, 0, canvas.width),
    y: clamp(p.y, 0, canvas.height)
  };
}

function objectById(id) {
  return state.objects.find((item) => item.id === id) || null;
}

function bringToFront(id) {
  const index = state.objects.findIndex((o) => o.id === id);
  if (index < 0) {
    return false;
  }
  if (index === state.objects.length - 1) {
    return false;
  }
  const [obj] = state.objects.splice(index, 1);
  state.objects.push(obj);
  return true;
}

function getTextBounds(obj, context) {
  normalizeTextObject(obj);
  const size = textMetrics(obj, context);
  const width = size.w;
  const height = size.h;
  const rotation = ((obj.rotation || 0) * Math.PI) / 180;
  if (!rotation) {
    return {
      x: obj.x,
      y: obj.y,
      w: width,
      h: height
    };
  }
  const cx = obj.x + width / 2;
  const cy = obj.y + height / 2;
  const corners = [
    { x: obj.x, y: obj.y },
    { x: obj.x + width, y: obj.y },
    { x: obj.x + width, y: obj.y + height },
    { x: obj.x, y: obj.y + height }
  ].map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: cx + dx * Math.cos(rotation) - dy * Math.sin(rotation),
      y: cy + dx * Math.sin(rotation) + dy * Math.cos(rotation)
    };
  });
  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY
  };
}

function getObjectBounds(obj, context) {
  if (obj.type === 'sprite') {
    return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
  }
  return getTextBounds(obj, context);
}

function pointInRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.w &&
    point.y <= rect.y + rect.h
  );
}

function getCanvasResizeHandles() {
  if (!hasImage()) return [];

  const s = CANVAS_RESIZE_HANDLE_SIZE;
  const w = state.width;
  const h = state.height;

  return [
    { dir: 'left', x: -s / 2, y: h / 2 - s / 2, w: s, h: s },
    { dir: 'right', x: w - s / 2, y: h / 2 - s / 2, w: s, h: s },
    { dir: 'top', x: w / 2 - s / 2, y: -s / 2, w: s, h: s },
    { dir: 'bottom', x: w / 2 - s / 2, y: h - s / 2, w: s, h: s },

    { dir: 'top-left', x: -s / 2, y: -s / 2, w: s, h: s },
    { dir: 'top-right', x: w - s / 2, y: -s / 2, w: s, h: s },
    { dir: 'bottom-left', x: -s / 2, y: h - s / 2, w: s, h: s },
    { dir: 'bottom-right', x: w - s / 2, y: h - s / 2, w: s, h: s }
  ];
}

function hitTestCanvasResizeHandle(point) {
  const handles = getCanvasResizeHandles();
  for (let i = handles.length - 1; i >= 0; i -= 1) {
    if (pointInRect(point, handles[i])) {
      return handles[i];
    }
  }
  return null;
}

function pointInTextObject(point, obj, context) {
  normalizeTextObject(obj);
  const size = textMetrics(obj, context);
  const width = size.w;
  const height = size.h;
  const cx = obj.x + width / 2;
  const cy = obj.y + height / 2;
  const rotation = ((obj.rotation || 0) * Math.PI) / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const localX = dx * Math.cos(-rotation) - dy * Math.sin(-rotation) + width / 2;
  const localY = dx * Math.sin(-rotation) + dy * Math.cos(-rotation) + height / 2;
  return localX >= 0 && localY >= 0 && localX <= width && localY <= height;
}

function hitTestObject(point) {
  for (let i = state.objects.length - 1; i >= 0; i -= 1) {
    const obj = state.objects[i];
    if (obj.type === 'text') {
      if (pointInTextObject(point, obj, ctx)) {
        return obj;
      }
      continue;
    }
    const bounds = getObjectBounds(obj, ctx);
    if (pointInRect(point, bounds)) {
      return obj;
    }
  }
  return null;
}

function getTextResizeHandle(obj, context) {
  const b = getTextBounds(obj, context);
  return {
    x: b.x + b.w - TEXT_HANDLE_SIZE * 0.5,
    y: b.y + b.h - TEXT_HANDLE_SIZE * 0.5,
    w: TEXT_HANDLE_SIZE,
    h: TEXT_HANDLE_SIZE
  };
}

function getObjectResizeHandle(obj, context) {
  if (!obj) {
    return null;
  }
  if (obj.type === 'text') {
    return getTextResizeHandle(obj, context);
  }
  const b = getObjectBounds(obj, context);
  return {
    x: b.x + b.w - TEXT_HANDLE_SIZE * 0.5,
    y: b.y + b.h - TEXT_HANDLE_SIZE * 0.5,
    w: TEXT_HANDLE_SIZE,
    h: TEXT_HANDLE_SIZE
  };
}

function getDeleteHandle(bounds) {
  return {
    x: bounds.x + bounds.w - DELETE_HANDLE_SIZE,
    y: bounds.y,
    w: DELETE_HANDLE_SIZE,
    h: DELETE_HANDLE_SIZE
  };
}

function drawObject(context, obj) {
  if (obj.type === 'sprite') {
    context.drawImage(obj.canvas, obj.x, obj.y, obj.w, obj.h);
    return;
  }

  normalizeTextObject(obj);
  const size = textMetrics(obj, context);
  const cx = obj.x + size.w / 2;
  const cy = obj.y + size.h / 2;
  const rotation = ((obj.rotation || 0) * Math.PI) / 180;
  context.save();
  context.translate(cx, cy);
  context.rotate(rotation);
  context.font = textFontFromObject(obj);
  context.fillStyle = obj.color;
  context.textBaseline = 'top';
  context.fillText(obj.text, -size.w / 2, -size.h / 2);
  context.restore();
}

function renderTo(context) {
  context.clearRect(0, 0, state.width, state.height);
  context.drawImage(state.baseImage, 0, 0, state.width, state.height);

  for (const hole of state.holes) {
    context.fillStyle = hole.color;
    context.fillRect(hole.x, hole.y, hole.w, hole.h);
  }

  for (const obj of state.objects) {
    drawObject(context, obj);
  }
}

function render() {
  if (!hasImage()) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  renderTo(ctx);

  if (state.selectedId !== null) {
    const selected = objectById(state.selectedId);
    if (selected) {
      const b = getObjectBounds(selected, ctx);
      ctx.save();
      ctx.strokeStyle = '#1d67d3';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const deleteHandle = getDeleteHandle(b);
      ctx.fillStyle = '#c23737';
      ctx.setLineDash([]);
      ctx.fillRect(deleteHandle.x, deleteHandle.y, deleteHandle.w, deleteHandle.h);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(deleteHandle.x, deleteHandle.y, deleteHandle.w, deleteHandle.h);
      ctx.beginPath();
      ctx.moveTo(deleteHandle.x + 5, deleteHandle.y + 5);
      ctx.lineTo(deleteHandle.x + deleteHandle.w - 5, deleteHandle.y + deleteHandle.h - 5);
      ctx.moveTo(deleteHandle.x + deleteHandle.w - 5, deleteHandle.y + 5);
      ctx.lineTo(deleteHandle.x + 5, deleteHandle.y + deleteHandle.h - 5);
      ctx.stroke();
      if (selected.type === 'text' || selected.type === 'sprite') {
        const handle = getObjectResizeHandle(selected, ctx);
        ctx.fillStyle = '#1d67d3';
        ctx.setLineDash([]);
        ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(handle.x, handle.y, handle.w, handle.h);
      }
      ctx.restore();
    }
  }

  if (state.selection) {
    const r = normalizeRect(state.selection.start, state.selection.current);
    ctx.save();
    const selectionMode = state.selection.mode || '';
    const isErase = selectionMode === 'erase' || state.tool === 'erase';
    const isCropSprite = selectionMode === 'cropSprite' || state.tool === 'cropSprite';
    ctx.strokeStyle = isErase ? '#c23737' : isCropSprite ? '#2a8f4f' : '#1d67d3';
    ctx.fillStyle = isErase
      ? 'rgba(194,55,55,0.16)'
      : isCropSprite
        ? 'rgba(42,143,79,0.16)'
        : 'rgba(29,103,211,0.15)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
  drawCanvasResizeFrame(ctx);
  drawCanvasResizePreview();
}

function getCanvasResizePreviewBox() {
  let box = document.getElementById('canvasResizePreviewBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'canvasResizePreviewBox';
    box.style.position = 'absolute';
    box.style.pointerEvents = 'none';
    box.style.border = '2px dashed #ff8c00';
    box.style.boxSizing = 'border-box';
    box.style.zIndex = '999';
    box.style.display = 'none';
    workspace.appendChild(box);
  }
  return box;
}

function hideCanvasResizePreviewBox() {
  const box = document.getElementById('canvasResizePreviewBox');
  if (box) {
    box.style.display = 'none';
  }
}
function drawCanvasResizeFrame(context) {
  if (!hasImage()) return;

  context.save();
  context.strokeStyle = '#00a86b';
  context.lineWidth = 2;
  context.setLineDash([10, 6]);
  context.strokeRect(0, 0, state.width, state.height);

  context.setLineDash([]);
  const handles = getCanvasResizeHandles();
  for (const h of handles) {
    context.fillStyle = '#00a86b';
    context.fillRect(h.x, h.y, h.w, h.h);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 1;
    context.strokeRect(h.x, h.y, h.w, h.h);
  }
  context.restore();
}

function drawCanvasResizePreview() {
  const box = getCanvasResizePreviewBox();
  const drag = state.canvasResize;

  if (!drag || !drag.didChange || !hasImage()) {
    box.style.display = 'none';
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const workspaceRect = workspace.getBoundingClientRect();

  // previewOffsetX / previewOffsetY 是“旧内容在新画布里的偏移”
  // 不是预览框左上角本身的偏移
  // 所以左/上扩展时，预览框应该反方向移动
  const left =
    canvasRect.left - workspaceRect.left - (drag.previewOffsetX || 0) * state.viewScale;
  const top =
    canvasRect.top - workspaceRect.top - (drag.previewOffsetY || 0) * state.viewScale;

  const width = drag.previewWidth * state.viewScale;
  const height = drag.previewHeight * state.viewScale;

  box.style.display = 'block';
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
}

function normalizeRect(start, current) {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  return { x, y, w, h };
}

function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return {
    x,
    y,
    w: Math.max(0, right - x),
    h: Math.max(0, bottom - y)
  };
}

function clampPointToRect(point, rect) {
  return {
    x: clamp(point.x, rect.x, rect.x + rect.w),
    y: clamp(point.y, rect.y, rect.y + rect.h)
  };
}

function makeSnapshotCanvas() {
  const snap = makeOffscreen(state.width, state.height);
  const snapCtx = snap.getContext('2d');
  renderTo(snapCtx);
  return snap;
}

function colorFromEdgeAverage(snapshotCtx, rect) {
  const x0 = Math.floor(rect.x);
  const y0 = Math.floor(rect.y);
  const w = Math.max(1, Math.floor(rect.w));
  const h = Math.max(1, Math.floor(rect.h));

  const left = clamp(x0, 0, state.width - 1);
  const top = clamp(y0, 0, state.height - 1);
  const right = clamp(x0 + w - 1, 0, state.width - 1);
  const bottom = clamp(y0 + h - 1, 0, state.height - 1);

  const sampleW = Math.max(1, right - left + 1);
  const sampleH = Math.max(1, bottom - top + 1);
  const data = snapshotCtx.getImageData(left, top, sampleW, sampleH).data;

  const colorCount = new Map();
  let bestKey = null;
  let bestCount = 0;

  for (let yy = 0; yy < sampleH; yy += 1) {
    for (let xx = 0; xx < sampleW; xx += 1) {
      const i = (yy * sampleW + xx) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      // 如果你不想统计透明像素，可以跳过
      if (a === 0) {
        continue;
      }

      const key = `${r},${g},${b},${a}`;
      const next = (colorCount.get(key) || 0) + 1;
      colorCount.set(key, next);

      if (next > bestCount) {
        bestCount = next;
        bestKey = key;
      }
    }
  }

  if (!bestKey) {
    return 'rgba(255,255,255,1)';
  }

  const [r, g, b, a] = bestKey.split(',').map(Number);
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function applyCutout(rect) {
  if (rect.w < 2 || rect.h < 2) {
    return;
  }

  const snap = makeSnapshotCanvas();
  const snapCtx = snap.getContext('2d');

  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const w = Math.min(state.width - x, Math.floor(rect.w));
  const h = Math.min(state.height - y, Math.floor(rect.h));
  if (w < 1 || h < 1) {
    return;
  }

  recordHistory();

  const spriteCanvas = makeOffscreen(w, h);
  const spriteCtx = spriteCanvas.getContext('2d');
  spriteCtx.drawImage(snap, x, y, w, h, 0, 0, w, h);

  const fillColor = colorFromEdgeAverage(snapCtx, { x, y, w, h });
  state.holes.push({ x, y, w, h, color: fillColor });

  const obj = {
    id: state.nextId++,
    type: 'sprite',
    x,
    y,
    w,
    h,
    canvas: spriteCanvas
  };
  state.objects.push(obj);
  state.selectedId = obj.id;
  setTool('move');
}

function applyErase(rect) {
  if (rect.w < 2 || rect.h < 2) {
    return;
  }

  const snap = makeSnapshotCanvas();
  const snapCtx = snap.getContext('2d');

  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const w = Math.min(state.width - x, Math.floor(rect.w));
  const h = Math.min(state.height - y, Math.floor(rect.h));
  if (w < 1 || h < 1) {
    return;
  }

  recordHistory();

  const fillColor = colorFromEdgeAverage(snapCtx, { x, y, w, h });
  state.holes.push({ x, y, w, h, color: fillColor });
}

function applySpriteCrop(rect, targetId = state.selectedId) {
  if (rect.w < 2 || rect.h < 2) {
    return;
  }

  const target = objectById(targetId);
  if (!target || target.type !== 'sprite') {
    return;
  }

  const bounds = getObjectBounds(target, ctx);
  const crop = intersectRect(rect, bounds);
  if (crop.w < 2 || crop.h < 2) {
    return;
  }

  const scaleX = target.canvas.width / Math.max(target.w, 1);
  const scaleY = target.canvas.height / Math.max(target.h, 1);
  const sx = clamp(Math.round((crop.x - target.x) * scaleX), 0, Math.max(0, target.canvas.width - 1));
  const sy = clamp(Math.round((crop.y - target.y) * scaleY), 0, Math.max(0, target.canvas.height - 1));
  const sw = clamp(Math.round(crop.w * scaleX), 1, target.canvas.width - sx);
  const sh = clamp(Math.round(crop.h * scaleY), 1, target.canvas.height - sy);
  if (sw < 1 || sh < 1) {
    return;
  }

  recordHistory();

  const croppedCanvas = makeOffscreen(sw, sh);
  const croppedCtx = croppedCanvas.getContext('2d');
  croppedCtx.drawImage(target.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  target.canvas = croppedCanvas;
  target.x = crop.x;
  target.y = crop.y;
  target.w = crop.w;
  target.h = crop.h;
  state.selectedId = target.id;
}

function applyTextAtPointWithContent(point, content) {
  recordHistory();

  const weight = getWeightStateFromControls();
  const fontSize = clamp(Number(fontSizeInput.value) || 32, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const obj = {
    id: state.nextId++,
    type: 'text',
    x: point.x,
    y: point.y,
    text: content,
    fontSize,
    color: textColorInput.value,
    fontFamily: fontFamilyInput.value,
    rotation: clampRotation(textRotationInput.value),
    bold: weight.bold,
    thin: weight.thin
  };
  state.objects.push(obj);
  state.selectedId = obj.id;
  syncTextControlsFromObject(obj);
}

function syncTextControlsFromObject(obj) {
  if (!obj || obj.type !== 'text') {
    return;
  }
  textInput.value = obj.text;
  fontFamilyInput.value = obj.fontFamily;
  fontSizeInput.value = String(Math.round(obj.fontSize));
  textColorInput.value = obj.color;
  textRotationInput.value = String(Math.round(obj.rotation || 0));
  fontBoldInput.checked = Boolean(obj.bold);
  if (fontThinInput) {
    fontThinInput.checked = Boolean(obj.thin);
  }
}

function applyStyleControlsToSelectedText(options = {}) {
  const shouldRecordHistory = options.recordHistory !== false;
  const selected = objectById(state.selectedId);
  if (!selected || selected.type !== 'text') {
    return;
  }

  const nextFontFamily = fontFamilyInput.value;
  const nextFontSize = clamp(Number(fontSizeInput.value) || selected.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const nextColor = textColorInput.value;
  const nextRotation = clampRotation(textRotationInput.value);
  const weight = getWeightStateFromControls();
  const nextBold = weight.bold;
  const nextThin = weight.thin;

  const changed =
    selected.fontFamily !== nextFontFamily ||
    selected.fontSize !== nextFontSize ||
    selected.color !== nextColor ||
    (selected.rotation || 0) !== nextRotation ||
    Boolean(selected.bold) !== nextBold ||
    Boolean(selected.thin) !== nextThin;
  if (!changed) {
    return;
  }

  if (shouldRecordHistory) {
    recordHistory();
  }

  selected.fontFamily = nextFontFamily;
  selected.fontSize = nextFontSize;
  selected.color = nextColor;
  selected.rotation = nextRotation;
  selected.bold = nextBold;
  selected.thin = nextThin;
  updateMeta();
  render();
}

function canvasPointToWorkspacePixel(point) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (point.x / canvas.width) * rect.width + rect.left,
    y: (point.y / canvas.height) * rect.height + rect.top
  };
}

function closeInlineEditor() {
  if (!state.inlineEditor) {
    return;
  }
  state.inlineEditor.remove();
  state.inlineEditor = null;
}

function deleteSelectedObject(options = {}) {
  const shouldRecordHistory = options.recordHistory !== false;
  if (state.selectedId === null) {
    return false;
  }
  const selected = objectById(state.selectedId);
  if (!selected) {
    state.selectedId = null;
    return false;
  }

  if (shouldRecordHistory) {
    recordHistory();
  }

  state.objects = state.objects.filter((obj) => obj.id !== state.selectedId);
  state.selectedId = null;
  state.drag = null;
  state.resize = null;
  closeInlineEditor();
  updateMeta();
  render();
  return true;
}

function openInlineTextEditor(point, initialText = '', editObjectId = null) {
  closeInlineEditor();
  const editor = document.createElement('input');
  editor.type = 'text';
  editor.className = 'inline-text-editor';
  editor.maxLength = 120;
  editor.value = initialText || textInput.value || '';
  editor.placeholder = '输入文字后回车';
  editor.style.fontFamily = fontFamilyInput.value;
  editor.style.fontSize = `${clamp(Number(fontSizeInput.value) || 32, MIN_FONT_SIZE, MAX_FONT_SIZE) * state.viewScale}px`;
  const editorWeight = getWeightStateFromControls();
  editor.style.fontWeight = weightStyleFromFlags(editorWeight.bold, editorWeight.thin);
  editor.style.color = textColorInput.value;

  const px = canvasPointToWorkspacePixel(point);
  const wsRect = workspace.getBoundingClientRect();
  editor.style.left = `${px.x - wsRect.left}px`;
  editor.style.top = `${px.y - wsRect.top}px`;
  workspace.appendChild(editor);
  state.inlineEditor = editor;

  const finish = (save) => {
    if (!state.inlineEditor) {
      return;
    }
    const value = state.inlineEditor.value.trim();
    closeInlineEditor();
    if (!save || !value) {
      render();
      return;
    }
    if (editObjectId !== null) {
      const target = objectById(editObjectId);
      if (target && target.type === 'text') {
        const nextFontFamily = fontFamilyInput.value;
        const nextFontSize = clamp(Number(fontSizeInput.value) || target.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
        const nextColor = textColorInput.value;
        const nextRotation = clampRotation(textRotationInput.value);
        const weight = getWeightStateFromControls();
        const nextBold = weight.bold;
        const nextThin = weight.thin;
        const changed =
          target.text !== value ||
          target.fontFamily !== nextFontFamily ||
          target.fontSize !== nextFontSize ||
          target.color !== nextColor ||
          (target.rotation || 0) !== nextRotation ||
          Boolean(target.bold) !== nextBold ||
          Boolean(target.thin) !== nextThin;

        if (changed) {
          recordHistory();
          target.text = value;
          target.fontFamily = nextFontFamily;
          target.fontSize = nextFontSize;
          target.color = nextColor;
          target.rotation = nextRotation;
          target.bold = nextBold;
          target.thin = nextThin;
        }

        state.selectedId = target.id;
        syncTextControlsFromObject(target);
      }
    } else {
      textInput.value = value;
      applyTextAtPointWithContent(point, value);
    }
    updateMeta();
    render();
  };

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  editor.addEventListener('blur', () => finish(true));
  editor.focus();
  editor.select();
}

function updateMeta() {
  if (!hasImage()) {
    metaInfo.classList.remove('dpi-ok', 'dpi-warn', 'dpi-bad');
    metaInfo.textContent = '尚未加载图片';
    canvas.style.display = 'none';
    emptyState.style.display = 'block';
    updateUndoButton();
    return;
  }

  metaInfo.classList.remove('dpi-ok', 'dpi-warn', 'dpi-bad');
  metaInfo.textContent = `${state.imageName || '未命名.png'} | ${state.width} x ${state.height} | 对象 ${state.objects.length} | 擦除层 ${state.holes.length}`;
  canvas.style.display = 'block';
  emptyState.style.display = 'none';
  updateUndoButton();
}

function updateCanvasDisplaySize(useFitBase = false) {
  if (!hasImage()) {
    return;
  }

  if (useFitBase) {
    const maxW = Math.max(workspace.clientWidth - 30, 100);
    const maxH = Math.max(workspace.clientHeight - 30, 100);
    state.baseScale = Math.min(maxW / state.width, maxH / state.height, 1);
  }

  const baseScale = Number(state.baseScale) || 1;
  const userZoom = Number(state.userZoom) || 1;
  const scale = baseScale * userZoom;

  state.viewScale = scale;
  canvas.style.width = `${Math.round(state.width * scale)}px`;
  canvas.style.height = `${Math.round(state.height * scale)}px`;

  if (zoomValue) {
    zoomValue.textContent = `${Math.round(userZoom * 100)}%`;
  }
}

function setTool(tool) {
  state.tool = tool;
  for (const btn of document.querySelectorAll('.tool-btn')) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  }
}

function resetEditor() {
  state.baseImage = null;
  state.baseImageSrc = '';
  state.imageName = '';
  state.width = 0;
  state.height = 0;
  setImageDpiInfo();
  state.objects = [];
  state.holes = [];
  state.selectedId = null;
  state.nextId = 1;
  state.drag = null;
  state.resize = null;
  state.selection = null;
  state.canvasResize = null;
  state.baseScale = 1;
  state.userZoom = 1;
  if (zoomRange) {
    zoomRange.value = '100';
    }
  if (zoomValue) {
    zoomValue.textContent = '100%';
    }
  hideCanvasResizePreviewBox();
  closeInlineEditor();
  clearHistory();
  updateMeta();
  render();
}

function loadImageFromDataUrl(src, name = '') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      state.baseImage = img;
      state.baseImageSrc = src;
      state.imageName = name;
      state.width = img.naturalWidth;
      state.height = img.naturalHeight;
      canvas.width = state.width;
      canvas.height = state.height;
      updateCanvasDisplaySize(true);
      updateMeta();
      render();
      updateUndoButton();
      resolve();
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

async function handleBaseImageUpload(file) {
  if (!file) {
    return;
  }

  if (!file.name.toLowerCase().endsWith('.png')) {
    alert('请上传 PNG 文件');
    return;
  }

  try {
    const [dataUrl, dpiInfo] = await Promise.all([readFileAsDataUrl(file), readPngDpiFromFile(file)]);

    resetEditor();
    setImageDpiInfo(dpiInfo);
    await loadImageFromDataUrl(dataUrl, file.name);
  } catch (err) {
    console.error(err);
    alert('加载失败，请重试');
  } finally {
    uploadInput.value = '';
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImageElementFromSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片元素加载失败'));
    img.src = src;
  });
}

async function importImageElementFromFile(file) {
  if (!file) {
    return;
  }
  if (!hasImage()) {
    alert('请先上传 PNG 底图');
    return;
  }
  const fileName = String(file.name || '').toLowerCase();
  const isImageByType = Boolean(file.type && file.type.startsWith('image/'));
  const isImageByExt = /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(fileName);
  if (!isImageByType && !isImageByExt) {
    alert('请选择图片文件');
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElementFromSrc(dataUrl);
  const sourceW = Math.max(1, img.naturalWidth || img.width || 1);
  const sourceH = Math.max(1, img.naturalHeight || img.height || 1);
  const maxInitialW = Math.max(MIN_SPRITE_SIZE, Math.floor(state.width * 0.45));
  const maxInitialH = Math.max(MIN_SPRITE_SIZE, Math.floor(state.height * 0.45));
  const initialScale = Math.min(maxInitialW / sourceW, maxInitialH / sourceH, 1);
  const targetW = Math.max(MIN_SPRITE_SIZE, Math.round(sourceW * initialScale));
  const targetH = Math.max(MIN_SPRITE_SIZE, Math.round(sourceH * initialScale));

  const spriteCanvas = makeOffscreen(sourceW, sourceH);
  const spriteCtx = spriteCanvas.getContext('2d');
  spriteCtx.drawImage(img, 0, 0, sourceW, sourceH);

  const placedW = Math.min(targetW, state.width);
  const placedH = Math.min(targetH, state.height);
  const obj = {
    id: state.nextId++,
    type: 'sprite',
    x: clamp(Math.round((state.width - placedW) / 2), 0, Math.max(0, state.width - placedW)),
    y: clamp(Math.round((state.height - placedH) / 2), 0, Math.max(0, state.height - placedH)),
    w: placedW,
    h: placedH,
    canvas: spriteCanvas
  };

  recordHistory();
  state.objects.push(obj);
  state.selectedId = obj.id;
  setTool('move');
  updateMeta();
  render();
}

uploadInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) {
    return;
  }
  await handleBaseImageUpload(file);
});

if (importElementBtn && importElementInput) {
  importElementBtn.addEventListener('click', () => {
    if (!hasImage()) {
      alert('请先上传 PNG 底图');
      return;
    }
    importElementInput.click();
  });

  importElementInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      await importImageElementFromFile(file);
    } catch (err) {
      console.error(err);
      alert('导入图片元素失败，请重试');
    } finally {
      importElementInput.value = '';
    }
  });
}

canvas.addEventListener('mousedown', (e) => {
  if (!hasImage()) {
    return;
  }

  const point = getMousePoint(e);
  const canvasHandle = hitTestCanvasResizeHandle(point);

  if (canvasHandle) {
    state.canvasResize = {
      dir: canvasHandle.dir,
      startX: point.x,
      startY: point.y,
      startWidth: state.width,
      startHeight: state.height,
      previewWidth: state.width,
      previewHeight: state.height,
      previewOffsetX: 0,
      previewOffsetY: 0,
      didChange: false
    };
    return;
  }
  if (state.tool === 'text') {
    openInlineTextEditor(point);
    render();
    return;
  }

  if (state.tool === 'move') {
    const selected = objectById(state.selectedId);
    if (selected) {
      const selectedBounds = getObjectBounds(selected, ctx);
      const deleteHandle = getDeleteHandle(selectedBounds);
      if (pointInRect(point, deleteHandle)) {
        deleteSelectedObject();
        return;
      }
      if (selected.type === 'text' || selected.type === 'sprite') {
        const resizeHandle = getObjectResizeHandle(selected, ctx);
        if (pointInRect(point, resizeHandle)) {
          if (selected.type === 'text') {
            const size = textMetrics(selected, ctx);
            state.resize = {
              id: selected.id,
              mode: 'text',
              startX: point.x,
              startY: point.y,
              startWidth: Math.max(size.w, 1),
              startFontSize: selected.fontSize,
              didChange: false,
              snapshot: makeHistorySnapshot()
            };
            render();
            return;
          }

          const startWidth = Math.max(selected.w, 1);
          const startHeight = Math.max(selected.h, 1);
          state.resize = {
            id: selected.id,
            mode: 'sprite',
            startX: point.x,
            startY: point.y,
            startWidth,
            startHeight,
            startXPos: selected.x,
            startYPos: selected.y,
            startDiag: Math.max(Math.hypot(startWidth, startHeight), 1),
            didChange: false,
            snapshot: makeHistorySnapshot()
          };
          render();
          return;
        }
      }
    }

    const target = hitTestObject(point);
    if (!target) {
      state.selectedId = null;
      render();
      return;
    }

    state.selectedId = target.id;
    const dragSnapshot = makeHistorySnapshot();
    const movedToFront = bringToFront(target.id);
    const bounds = getObjectBounds(target, ctx);
    if (target.type === 'text') {
      syncTextControlsFromObject(target);
    }
    state.drag = {
      id: target.id,
      mode: target.type === 'text' ? 'anchor' : 'bounds',
      dx: target.type === 'text' ? point.x - target.x : point.x - bounds.x,
      dy: target.type === 'text' ? point.y - target.y : point.y - bounds.y,
      didChange: movedToFront,
      snapshot: dragSnapshot
    };
    render();
    return;
  }

  if (state.tool === 'cropSprite') {
    let target = objectById(state.selectedId);
    if (!target || target.type !== 'sprite') {
      const hit = hitTestObject(point);
      if (hit && hit.type === 'sprite') {
        state.selectedId = hit.id;
        target = hit;
      }
    }
    if (!target || target.type !== 'sprite') {
      return;
    }

    const bounds = getObjectBounds(target, ctx);
    if (!pointInRect(point, bounds)) {
      return;
    }

    const start = clampPointToRect(point, bounds);
    state.selection = {
      mode: 'cropSprite',
      targetId: target.id,
      start,
      current: start
    };
    render();
    return;
  }

  if (state.tool === 'cutout' || state.tool === 'erase') {
    state.selection = {
      mode: state.tool === 'erase' ? 'erase' : 'cutout',
      start: point,
      current: point
    };
    render();
  }
});

function applyCanvasResizeDrag(point) {
  const drag = state.canvasResize;
  if (!drag) return;

  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;

  let leftDelta = 0;
  let rightDelta = 0;
  let topDelta = 0;
  let bottomDelta = 0;

  switch (drag.dir) {
    case 'left':
      leftDelta = -dx;
      break;
    case 'right':
      rightDelta = dx;
      break;
    case 'top':
      topDelta = -dy;
      break;
    case 'bottom':
      bottomDelta = dy;
      break;
    case 'top-left':
      leftDelta = -dx;
      topDelta = -dy;
      break;
    case 'top-right':
      rightDelta = dx;
      topDelta = -dy;
      break;
    case 'bottom-left':
      leftDelta = -dx;
      bottomDelta = dy;
      break;
    case 'bottom-right':
      rightDelta = dx;
      bottomDelta = dy;
      break;
  }

  let newW = Math.round(drag.startWidth + leftDelta + rightDelta);
  let newH = Math.round(drag.startHeight + topDelta + bottomDelta);

  if (newW < CANVAS_RESIZE_MIN_SIZE) {
    if (drag.dir.includes('left')) {
      leftDelta += CANVAS_RESIZE_MIN_SIZE - newW;
    } else {
      rightDelta += CANVAS_RESIZE_MIN_SIZE - newW;
    }
    newW = CANVAS_RESIZE_MIN_SIZE;
  }

  if (newH < CANVAS_RESIZE_MIN_SIZE) {
    if (drag.dir.includes('top')) {
      topDelta += CANVAS_RESIZE_MIN_SIZE - newH;
    } else {
      bottomDelta += CANVAS_RESIZE_MIN_SIZE - newH;
    }
    newH = CANVAS_RESIZE_MIN_SIZE;
  }

  drag.previewWidth = newW;
  drag.previewHeight = newH;
  drag.previewOffsetX = drag.dir.includes('left') ? leftDelta : 0;
  drag.previewOffsetY = drag.dir.includes('top') ? topDelta : 0;
  drag.didChange =
    newW !== drag.startWidth ||
    newH !== drag.startHeight ||
    drag.previewOffsetX !== 0 ||
    drag.previewOffsetY !== 0;
}

window.addEventListener('mousemove', (e) => {
  if (!hasImage()) {
    return;
  }

  const point = state.canvasResize ? getMousePointRaw(e) : getMousePoint(e);

  if (state.canvasResize) {
    applyCanvasResizeDrag(point);
    render();
    return;
  }

  if (state.drag) {
    const obj = objectById(state.drag.id);
    if (!obj) {
      state.drag = null;
      return;
    }
    const prevX = obj.x;
    const prevY = obj.y;
    if (obj.type === 'text' && state.drag.mode === 'anchor') {
      const size = textMetrics(obj, ctx);
      const maxX = state.width - size.w;
      const maxY = state.height - size.h;
      obj.x = clamp(point.x - state.drag.dx, 0, Math.max(0, maxX));
      obj.y = clamp(point.y - state.drag.dy, 0, Math.max(0, maxY));
    } else {
      const bounds = getObjectBounds(obj, ctx);
      const maxX = state.width - bounds.w;
      const maxY = state.height - bounds.h;
      obj.x = clamp(point.x - state.drag.dx, 0, Math.max(0, maxX));
      obj.y = clamp(point.y - state.drag.dy, 0, Math.max(0, maxY));
    }
    if (obj.x !== prevX || obj.y !== prevY) {
      state.drag.didChange = true;
    }
    render();
    return;
  }

  if (state.resize) {
    const obj = objectById(state.resize.id);
    if (!obj) {
      state.resize = null;
      return;
    }

    if ((state.resize.mode || obj.type) === 'text') {
      if (obj.type !== 'text') {
        state.resize = null;
        return;
      }
      const prevFontSize = obj.fontSize;
      const deltaX = point.x - state.resize.startX;
      const nextRatio = (state.resize.startWidth + deltaX) / state.resize.startWidth;
      obj.fontSize = clamp(state.resize.startFontSize * nextRatio, MIN_FONT_SIZE, MAX_FONT_SIZE);
      if (obj.fontSize !== prevFontSize) {
        state.resize.didChange = true;
      }
      fontSizeInput.value = String(Math.round(obj.fontSize));
      render();
      return;
    }

    if (obj.type !== 'sprite') {
      state.resize = null;
      return;
    }

    const prevW = obj.w;
    const prevH = obj.h;
    const deltaX = point.x - state.resize.startX;
    const deltaY = point.y - state.resize.startY;
    const nextDiag = Math.hypot(state.resize.startWidth + deltaX, state.resize.startHeight + deltaY);
    const rawScale = nextDiag / state.resize.startDiag;
    if (!Number.isFinite(rawScale)) {
      return;
    }
    const maxScale = Math.min(
      (state.width - state.resize.startXPos) / state.resize.startWidth,
      (state.height - state.resize.startYPos) / state.resize.startHeight
    );
    const minScale = Math.max(
      MIN_SPRITE_SIZE / state.resize.startWidth,
      MIN_SPRITE_SIZE / state.resize.startHeight
    );
    const nextScale = clamp(rawScale, minScale, Math.max(minScale, maxScale));
    obj.w = state.resize.startWidth * nextScale;
    obj.h = state.resize.startHeight * nextScale;
    if (obj.w !== prevW || obj.h !== prevH) {
      state.resize.didChange = true;
    }
    render();
    return;
  }

  if (state.selection) {
    if (state.selection.mode === 'cropSprite') {
      const target = objectById(state.selection.targetId);
      if (!target || target.type !== 'sprite') {
        state.selection = null;
        render();
        return;
      }
      const bounds = getObjectBounds(target, ctx);
      state.selection.current = clampPointToRect(point, bounds);
    } else {
      state.selection.current = point;
    }
    render();
  }
});

function commitCanvasResize(newW, newH, offsetX, offsetY, fillColor = '#ffffff') {
  if (!hasImage()) return;

  recordHistory();

  const oldBase = state.baseImage;
  const oldWidth = state.width;
  const oldHeight = state.height;

  const newBase = makeOffscreen(newW, newH);
  const newCtx = newBase.getContext('2d');

  newCtx.fillStyle = fillColor;
  newCtx.fillRect(0, 0, newW, newH);
  newCtx.drawImage(oldBase, offsetX, offsetY, oldWidth, oldHeight);

  state.baseImage = newBase;

  for (const obj of state.objects) {
    obj.x += offsetX;
    obj.y += offsetY;
  }

  for (const hole of state.holes) {
    hole.x += offsetX;
    hole.y += offsetY;
  }

  state.width = newW;
  state.height = newH;
  canvas.width = newW;
  canvas.height = newH;

  updateCanvasDisplaySize();
  updateMeta();
  render();
}

window.addEventListener('mouseup', () => {
  if (!hasImage()) {
    return;
  }
  if (state.canvasResize) {
  const drag = state.canvasResize;
  if (drag.didChange) {
    commitCanvasResize(
      drag.previewWidth,
      drag.previewHeight,
      drag.previewOffsetX || 0,
      drag.previewOffsetY || 0
    );
  }
  state.canvasResize = null;
  hideCanvasResizePreviewBox();
  render();
  return;
}
  if (state.drag) {
    if (state.drag.didChange) {
      pushHistorySnapshot(state.drag.snapshot);
    }
    state.drag = null;
    updateMeta();
    render();
    return;
  }

  if (state.resize) {
    if (state.resize.didChange) {
      pushHistorySnapshot(state.resize.snapshot);
    }
    state.resize = null;
    updateMeta();
    render();
    return;
  }

  if (state.selection) {
    const rect = normalizeRect(state.selection.start, state.selection.current);
    const selectionMode = state.selection.mode || '';
    if (selectionMode === 'cutout') {
      applyCutout(rect);
    }
    if (selectionMode === 'erase') {
      applyErase(rect);
    }
    if (selectionMode === 'cropSprite') {
      applySpriteCrop(rect, state.selection.targetId);
    }
    state.selection = null;
    updateMeta();
    render();
  }
});

canvas.addEventListener('dblclick', (e) => {
  if (!hasImage()) {
    return;
  }
  const point = getMousePoint(e);
  const target = hitTestObject(point);
  if (!target || target.type !== 'text') {
    return;
  }
  state.selectedId = target.id;
  syncTextControlsFromObject(target);
  openInlineTextEditor({ x: target.x, y: target.y }, target.text, target.id);
  render();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!hasImage() || state.tool !== 'move') {
      return;
    }
    const selected = objectById(state.selectedId);
    if (!selected) {
      return;
    }
    const point = getMousePoint(e);
    if (selected.type === 'text') {
      if (!pointInTextObject(point, selected, ctx)) {
        return;
      }
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      const step = e.shiftKey ? 6 : 2;
      const nextFontSize = clamp(selected.fontSize + delta * step, MIN_FONT_SIZE, MAX_FONT_SIZE);
      if (nextFontSize === selected.fontSize) {
        return;
      }
      recordHistory();
      selected.fontSize = nextFontSize;
      fontSizeInput.value = String(Math.round(selected.fontSize));
      updateMeta();
      render();
      return;
    }

    if (selected.type !== 'sprite') {
      return;
    }
    const bounds = getObjectBounds(selected, ctx);
    if (!pointInRect(point, bounds)) {
      return;
    }
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? (e.shiftKey ? 1.14 : 1.08) : e.shiftKey ? 0.86 : 0.92;
    const prevW = selected.w;
    const prevH = selected.h;
    const nextW = clamp(selected.w * zoomFactor, MIN_SPRITE_SIZE, state.width - selected.x);
    const nextH = clamp(selected.h * zoomFactor, MIN_SPRITE_SIZE, state.height - selected.y);
    if (nextW === prevW && nextH === prevH) {
      return;
    }
    recordHistory();
    selected.w = nextW;
    selected.h = nextH;
    updateMeta();
    render();
  },
  { passive: false }
);

document.querySelectorAll('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tool === 'cropSprite') {
      const selected = objectById(state.selectedId);
      if (!selected || selected.type !== 'sprite') {
        alert('请先在“移动对象”工具中选中要裁剪的图片元素');
        return;
      }
    }
    setTool(btn.dataset.tool);
  });
});

function onBoldWeightToggle() {
  if (fontBoldInput.checked && fontThinInput && fontThinInput.checked) {
    fontThinInput.checked = false;
  }
  applyStyleControlsToSelectedText();
}

function onThinWeightToggle() {
  if (fontThinInput.checked && fontBoldInput && fontBoldInput.checked) {
    fontBoldInput.checked = false;
  }
  applyStyleControlsToSelectedText();
}

fontFamilyInput.addEventListener('change', applyStyleControlsToSelectedText);
fontSizeInput.addEventListener('input', applyStyleControlsToSelectedText);
fontSizeInput.addEventListener('change', applyStyleControlsToSelectedText);
textColorInput.addEventListener('input', applyStyleControlsToSelectedText);
textColorInput.addEventListener('change', applyStyleControlsToSelectedText);
textRotationInput.addEventListener('input', applyStyleControlsToSelectedText);
textRotationInput.addEventListener('change', applyStyleControlsToSelectedText);
fontBoldInput.addEventListener('change', onBoldWeightToggle);
fontBoldInput.addEventListener('input', onBoldWeightToggle);
if (fontThinInput) {
  fontThinInput.addEventListener('change', onThinWeightToggle);
  fontThinInput.addEventListener('input', onThinWeightToggle);
}

editTextBtn.addEventListener('click', () => {
  const selected = objectById(state.selectedId);
  if (!selected || selected.type !== 'text') {
    alert('请先选中文字对象');
    return;
  }

  const content = (textInput.value || '').trim();
  if (!content) {
    alert('文字内容不能为空');
    return;
  }

  const nextFontFamily = fontFamilyInput.value;
  const nextFontSize = clamp(Number(fontSizeInput.value) || selected.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const nextColor = textColorInput.value;
  const nextRotation = clampRotation(textRotationInput.value);
  const weight = getWeightStateFromControls();
  const nextBold = weight.bold;
  const nextThin = weight.thin;
  const changed =
    selected.text !== content ||
    selected.fontFamily !== nextFontFamily ||
    selected.fontSize !== nextFontSize ||
    selected.color !== nextColor ||
    (selected.rotation || 0) !== nextRotation ||
    Boolean(selected.bold) !== nextBold ||
    Boolean(selected.thin) !== nextThin;

  if (!changed) {
    return;
  }

  recordHistory();
  selected.text = content;
  applyStyleControlsToSelectedText({ recordHistory: false });
});

deleteSelectedBtn.addEventListener('click', () => {
  deleteSelectedObject();
});

if (undoBtn) {
  undoBtn.addEventListener('click', () => {
    undoLastAction();
  });
}

window.addEventListener('keydown', (e) => {
  // 如果正在输入文字，不触发快捷键
  if (state.inlineEditor) {
    return;
  }

  // 防止按住 Ctrl / Alt / Meta 时误触
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  }

  const key = e.key.toLowerCase();

  switch (key) {
    case 'v':
      setTool('move');
      break;

    case 'c':
      setTool('cutout');
      break;

    case 'e':
      setTool('erase');
      break;
  }
});

window.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const inTextInput =
    active &&
    (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
  const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
  if (isUndo) {
    if (state.inlineEditor || inTextInput) {
      return;
    }
    if (canUndo()) {
      e.preventDefault();
      undoLastAction();
    }
    return;
  }

  const isDelete = e.key === 'Delete' || e.key === 'Backspace';
  if (!isDelete) {
    return;
  }

  if (state.inlineEditor) {
    return;
  }
  if (inTextInput) {
    return;
  }

  if (deleteSelectedObject()) {
    e.preventDefault();
  }
});

exportBtn.addEventListener('click', async () => {
  if (!hasImage()) {
    alert('请先上传图片');
    return;
  }

  const output = renderOutputCanvas();
  output.toBlob((blob) => {
    if (!blob) {
      alert('导出 PNG 失败');
      return;
    }
    triggerBlobDownload(blob, `${getExportBaseName()}_edited.png`);
  }, 'image/png');
});

if (zoomRange) {
  zoomRange.addEventListener('input', () => {
    if (!hasImage()) {
      return;
    }

    const workspaceRect = workspace.getBoundingClientRect();
    const centerX = workspaceRect.left + workspaceRect.width / 2;
    const centerY = workspaceRect.top + workspaceRect.height / 2;
    const nextZoom = Number(zoomRange.value) / 100;

    zoomAtClientPoint(centerX, centerY, nextZoom);
  });
}

if (exportTiffBtn) {
  exportTiffBtn.addEventListener('click', async () => {
    if (!hasImage()) {
      alert('请先上传图片');
      return;
    }

    try {
      const output = renderOutputCanvas();
      const blob = encodeCanvasToTiffBlob(output);
      triggerBlobDownload(blob, `${getExportBaseName()}_edited.tiff`);
    } catch (err) {
      console.error(err);
      alert('导出 TIFF 失败');
    }
  });
}

saveProjectBtn.addEventListener('click', () => {
  if (!hasImage()) {
    alert('请先上传图片');
    return;
  }

  const serializableObjects = state.objects.map((obj) => {
    if (obj.type === 'text') {
      return { ...obj };
    }
    return {
      id: obj.id,
      type: obj.type,
      x: obj.x,
      y: obj.y,
      w: obj.w,
      h: obj.h,
      src: obj.canvas.toDataURL('image/png')
    };
  });

  const project = {
    version: 1,
    imageName: state.imageName,
    baseImageSrc: state.baseImageSrc,
    width: state.width,
    height: state.height,
    holes: state.holes,
    objects: serializableObjects,
    nextId: state.nextId
  };

  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (state.imageName ? state.imageName.replace(/\.png$/i, '') : 'figure') + '.nanopro.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

loadProjectInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const project = JSON.parse(text);

    if (!project.baseImageSrc || !Array.isArray(project.objects) || !Array.isArray(project.holes)) {
      throw new Error('工程文件结构无效');
    }

    resetEditor();
    setImageDpiInfo(readPngDpiFromDataUrl(project.baseImageSrc));
    await loadImageFromDataUrl(project.baseImageSrc, project.imageName || 'loaded.png');

    state.holes = project.holes.map((h) => ({
      x: Number(h.x) || 0,
      y: Number(h.y) || 0,
      w: Number(h.w) || 0,
      h: Number(h.h) || 0,
      color: h.color || 'rgba(255,255,255,1)'
    }));

    const rebuilt = [];
    for (const obj of project.objects) {
      if (obj.type === 'text') {
        rebuilt.push({
          id: Number(obj.id) || state.nextId++,
          type: 'text',
          x: Number(obj.x) || 0,
          y: Number(obj.y) || 0,
          text: String(obj.text || ''),
          fontSize: clamp(Number(obj.fontSize) || 32, MIN_FONT_SIZE, MAX_FONT_SIZE),
          color: obj.color || '#000000',
          fontFamily: obj.fontFamily || 'Arial',
          rotation: clampRotation(obj.rotation || 0),
          bold: Boolean(obj.bold),
          thin: Boolean(obj.thin)
        });
      } else if (obj.type === 'sprite' && obj.src) {
        const spriteImg = new Image();
        await new Promise((resolve, reject) => {
          spriteImg.onload = resolve;
          spriteImg.onerror = reject;
          spriteImg.src = obj.src;
        });

        const sw = Number(obj.w) || spriteImg.naturalWidth;
        const sh = Number(obj.h) || spriteImg.naturalHeight;
        const spriteCanvas = makeOffscreen(sw, sh);
        const sctx = spriteCanvas.getContext('2d');
        sctx.drawImage(spriteImg, 0, 0, sw, sh);

        rebuilt.push({
          id: Number(obj.id) || state.nextId++,
          type: 'sprite',
          x: Number(obj.x) || 0,
          y: Number(obj.y) || 0,
          w: sw,
          h: sh,
          canvas: spriteCanvas
        });
      }
    }

    state.objects = rebuilt;
    state.nextId = Math.max(project.nextId || 1, ...rebuilt.map((o) => o.id + 1), 1);
    state.selectedId = null;
    updateMeta();
    render();
  } catch (err) {
    console.error(err);
    alert('加载工程失败，请确认文件格式');
  } finally {
    loadProjectInput.value = '';
  }
});

window.addEventListener(
  'wheel',
  (e) => {
    if (!e.altKey) {
      return;
    }

    if (!hasImage()) {
      return;
    }

    e.preventDefault();

    const zoomStep = e.shiftKey ? 0.2 : 0.1;
    const currentZoom = Number(state.userZoom) || 1;
    const nextZoom = e.deltaY < 0
      ? currentZoom * (1 + zoomStep)
      : currentZoom / (1 + zoomStep);

    zoomAtClientPoint(e.clientX, e.clientY, nextZoom);
  },
  { passive: false }
);

window.addEventListener('resize', () => {
  updateCanvasDisplaySize(true);
  render();
});

setTool('move');
updateMeta();
window.__nanoproHandleBaseImageUpload = handleBaseImageUpload;
window.__nanoproEditorLoaded = true;
