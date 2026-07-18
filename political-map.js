import { MAP_IMAGE, CITIES as BASE_CITIES, applyCityOverrides } from "./cities.js";

const DEBUG_CITY_OUTLINES = false;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const SAVE_DEBOUNCE_MS = 900;
const MAIN_BOARD_ID = "main";
// Сколько пикселей нужно реально сдвинуть мышь/палец, прежде чем считать это
// перетаскиванием карты, а не кликом. Без этого порога любое мельчайшее
// дрожание руки при клике на город сдвигало карту на пиксель-другой, из-за
// чего к моменту отпускания кнопки курсор оказывался уже не над городом —
// и клик "не срабатывал".
const PAN_DRAG_THRESHOLD = 5;

const TOOLS = [
  { id: "hand", icon: "hand", label: "Рука", hotkey: "H", code: "KeyH" },
  { id: "brush", icon: "pencil", label: "Кисть", hotkey: "B", code: "KeyB" },
  { id: "eraser", icon: "eraser", label: "Ластик", hotkey: "E", code: "KeyE" },
  { id: "rect", icon: "square", label: "Прямоугольник", hotkey: "R", code: "KeyR" },
  { id: "ellipse", icon: "circle", label: "Круг", hotkey: "O", code: "KeyO" },
  { id: "rounded", icon: "squircle", label: "Скруглённый", hotkey: "U", code: "KeyU" },
  { id: "diamond", icon: "diamond", label: "Ромб", hotkey: "D", code: "KeyD" },
  { id: "arrow", icon: "move-right", label: "Стрелка", hotkey: "A", code: "KeyA" },
  { id: "drawArrow", icon: "spline", label: "Стрелка-кисть", hotkey: "Shift+A", code: "KeyA" },
  { id: "pin", icon: "map-pin", label: "Точка", hotkey: "P", code: "KeyP" },
];

// Инструменты, у которых есть настраиваемая толщина — их можно менять зажатием ПКМ.
const STROKE_SIZE_TOOLS = new Set(["brush", "eraser", "rect", "ellipse", "rounded", "diamond", "arrow", "drawArrow"]);

let ctx = null;
let saveTimer = null;
let pendingFocusCityId = null;
let CITIES = BASE_CITIES;

const mapState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  drawMode: false,
  tool: "hand",
  color: "#e8590c",
  strokeWidth: 3,
  elements: [],
  markers: [],
  draft: null,
  eraserTargetId: null,
  imageNatural: { w: 1200, h: 800 },
  imageLoaded: false,
  isPanning: false,
  panPending: false,
  pendingPointerId: null,
  isDrawing: false,
  isResizingStroke: false,
  resizeStartX: 0,
  resizeStartWidth: 3,
  panStart: null,
  pointerDownScreen: null,
  pointerStart: null,
  spaceHeld: false,
  canEdit: false,
  mapInitialized: false,
  boardId: MAIN_BOARD_ID,
  isMainBoard: true,
  boards: [{ id: MAIN_BOARD_ID, name: "Политическая карта" }],
  editCitiesMode: false,
  editingCityId: null,
  editingRegion: null,
  draggingVertexIndex: null,
  cityOverrides: {},
  getPlayers: () => [],
  onPlayerOpen: () => {},
  saveBoardData: async () => {},
  createBoard: async () => null,
  deleteBoard: async () => {},
  saveCityOverride: async () => {},
  onBoardChange: () => {},
  refreshIcons: () => {},
};

let els = {};

export function initPoliticalMap(options) {
  els = options.els;
  mapState.getPlayers = options.getPlayers;
  mapState.onPlayerOpen = options.onPlayerOpen;
  mapState.saveBoardData = options.saveBoardData;
  mapState.createBoard = options.createBoard;
  mapState.deleteBoard = options.deleteBoard;
  mapState.saveCityOverride = options.saveCityOverride;
  mapState.onBoardChange = options.onBoardChange || (() => {});
  mapState.refreshIcons = options.refreshIcons;
  mapState.canEdit = options.canEdit;

  buildCityOverlay();
  renderBoardSelect();
  bindMapEvents();
  resizeCanvas();
  render();
}

function updateEditCitiesToggleVisibility() {
  els.editCitiesToggle?.classList.toggle("is-hidden", !mapState.canEdit || !mapState.isMainBoard);
}

export function setPoliticalMapCanEdit(canEdit) {
  mapState.canEdit = canEdit;
  if (els.drawModeToggle) {
    els.drawModeToggle.disabled = !canEdit;
    if (!canEdit && mapState.drawMode) setDrawMode(false);
  }
  if (!canEdit && mapState.editCitiesMode) setEditCitiesMode(false);
  updateEditCitiesToggleVisibility();
  els.toolbar?.classList.toggle("has-admin-tools", canEdit);
  renderToolbar();
  renderBoardSelect();
}

export function setPoliticalMapElements(elements) {
  mapState.elements = Array.isArray(elements) ? elements.map(cloneElement) : [];
  render();
}

export function setPoliticalMapMarkers(markers) {
  mapState.markers = Array.isArray(markers) ? markers.map((m) => ({ ...m })) : [];
  renderMarkers();
}

export function setPoliticalMapBoardData(boardId, { elements, markers, isMain, name } = {}) {
  mapState.boardId = boardId;
  mapState.isMainBoard = !!isMain;
  setPoliticalMapElements(elements || []);
  setPoliticalMapMarkers(markers || []);
  els.citiesLayer?.classList.toggle("is-hidden", !mapState.isMainBoard);
  updateEditCitiesToggleVisibility();
  els.deleteBoardButton?.classList.toggle("is-hidden", mapState.isMainBoard);
  if (!mapState.isMainBoard && mapState.editCitiesMode) setEditCitiesMode(false);
  closeCityPopup();
  closeMarkerPopup();
  renderBoardSelect();
  renderToolbar();
}

export function setPoliticalMapBoards(list) {
  mapState.boards = [{ id: MAIN_BOARD_ID, name: "Политическая карта" }, ...list];
  renderBoardSelect();
}

export function setPoliticalMapCityOverrides(overrides) {
  mapState.cityOverrides = overrides || {};
  CITIES = applyCityOverrides(mapState.cityOverrides);
  buildCityOverlay();
}

export function getCityById(id) {
  return CITIES.find((city) => city.id === id) || null;
}

export function focusPoliticalCity(cityId) {
  pendingFocusCityId = cityId;
  if (els.view && !els.view.hidden) {
    applyCityFocus(cityId);
  }
}

export function onPoliticalMapShow() {
  resizeCanvas();
  const firstShow = !mapState.mapInitialized;
  if (firstShow) {
    centerMapInViewport();
    mapState.mapInitialized = true;
  }
  render();
  updateCityPopulation();
  if (pendingFocusCityId) {
    applyCityFocus(pendingFocusCityId);
    pendingFocusCityId = null;
  }
  if (firstShow && els.stage) {
    els.stage.classList.add("is-entering");
    window.setTimeout(() => els.stage?.classList.remove("is-entering"), 750);
  }
  mapState.refreshIcons();
}

function centerMapInViewport() {
  if (!els.viewport) return;
  const rect = els.viewport.getBoundingClientRect();
  const { w, h } = mapState.imageNatural;
  mapState.zoom = clamp(Math.min(rect.width / w, rect.height / h) * 0.92, MIN_ZOOM, MAX_ZOOM);
  mapState.panX = (rect.width - w * mapState.zoom) / 2;
  mapState.panY = (rect.height - h * mapState.zoom) / 2;
  applyTransform();
}

function applyCityFocus(cityId) {
  const city = getCityById(cityId);
  if (!city || !els.viewport || !mapState.isMainBoard) return;

  const cx = cityCenter(city).x / 100;
  const cy = cityCenter(city).y / 100;
  const { w, h } = mapState.imageNatural;
  const worldX = cx * w;
  const worldY = cy * h;

  mapState.zoom = 1.8;
  const rect = els.viewport.getBoundingClientRect();
  mapState.panX = rect.width / 2 - worldX * mapState.zoom;
  mapState.panY = rect.height / 2 - worldY * mapState.zoom;

  els.stage?.classList.add("is-flying");
  applyTransform();
  window.setTimeout(() => {
    els.stage?.classList.remove("is-flying");
  }, 700);
  highlightCityRegion(cityId);

  // Раньше тут карта только приближалась к городу, а список игроков не
  // открывался — приходилось кликать по городу второй раз. Показываем
  // попап сразу после долёта, по центру области просмотра (мы же сами
  // туда её и подвинули выше).
  window.setTimeout(() => {
    if (!els.viewport) return;
    const rect = els.viewport.getBoundingClientRect();
    openCityPopup(cityId, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, 720);
}

function highlightCityRegion(cityId) {
  els.stage?.querySelectorAll(".polmap-city-hit").forEach((node) => {
    node.classList.toggle("is-focused", node.dataset.cityId === cityId);
  });
  window.setTimeout(() => {
    els.stage?.querySelectorAll(".polmap-city-hit.is-focused").forEach((node) => {
      node.classList.remove("is-focused");
    });
  }, 2400);
}

/* ================= City overlay (polygons, population) ================= */

function buildCityOverlay() {
  if (!els.citiesLayer) return;
  els.citiesLayer.innerHTML = CITIES.map((city) => {
    const points = city.region.map(([x, y]) => `${x},${y}`).join(" ");
    const center = cityCenter(city);
    const color = city.color || "var(--accent)";
    return `
      <g class="polmap-city-group" data-city-id="${city.id}" style="--city-color:${color}">
        <polygon class="polmap-city-hit${DEBUG_CITY_OUTLINES ? " is-debug" : ""}" data-city-id="${city.id}" points="${points}" vector-effect="non-scaling-stroke"/>
        <circle class="polmap-city-pulse" cx="${center.x}" cy="${center.y}" r="0.9"></circle>
        <g class="polmap-vertex-handles" data-city-id="${city.id}"></g>
      </g>`;
  }).join("");

  updateCityPopulation();
  if (mapState.editCitiesMode && mapState.editingCityId) renderVertexHandles();
}

export function updatePoliticalMapPopulation() {
  updateCityPopulation();
}

/* ================= PNG export ================= */

function hexToRgba(hex, alpha) {
  const fallback = `rgba(77, 171, 247, ${alpha})`;
  if (typeof hex !== "string" || !hex.startsWith("#")) return fallback;
  const clean = hex.slice(1);
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return fallback;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function slugifyFileName(name) {
  return (name || "karta")
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "karta";
}

export function exportPoliticalMapAsPng() {
  const { w, h } = mapState.imageNatural;
  if (!w || !h) return false;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c2d = canvas.getContext("2d");
  if (!c2d) return false;

  c2d.fillStyle = "#0b0b10";
  c2d.fillRect(0, 0, w, h);

  if (els.mapImage && els.mapImage.complete && els.mapImage.naturalWidth) {
    c2d.drawImage(els.mapImage, 0, 0, w, h);
  }

  // Рисунки (кисть/фигуры/стрелки) — сам канвас уже в натуральном разрешении карты
  if (els.canvas) {
    c2d.drawImage(els.canvas, 0, 0, w, h);
  }

  // Границы городов — только на основной карте (названия не дублируем: они уже есть на самой картинке)
  if (mapState.isMainBoard) {
    CITIES.forEach((city) => {
      const points = city.region.map(([x, y]) => [(x / 100) * w, (y / 100) * h]);
      if (points.length < 3) return;

      c2d.beginPath();
      points.forEach(([px, py], index) => {
        if (index === 0) c2d.moveTo(px, py);
        else c2d.lineTo(px, py);
      });
      c2d.closePath();
      c2d.fillStyle = hexToRgba(city.color, 0.2);
      c2d.fill();
      c2d.strokeStyle = city.color || "#4dabf7";
      c2d.lineWidth = Math.max(2, w * 0.0018);
      c2d.stroke();
    });
  }

  // Метки (пины админов)
  mapState.markers.forEach((marker) => {
    const r = Math.max(7, w * 0.005);
    const color = marker.color || "#e8590c";
    c2d.beginPath();
    c2d.arc(marker.x, marker.y, r, 0, Math.PI * 2);
    c2d.fillStyle = color;
    c2d.fill();
    c2d.lineWidth = Math.max(2, r * 0.4);
    c2d.strokeStyle = "#ffffff";
    c2d.stroke();

    const fontSize = Math.max(13, Math.round(w * 0.011));
    c2d.font = `700 ${fontSize}px "Manrope", "Segoe UI", sans-serif`;
    c2d.textAlign = "center";
    c2d.textBaseline = "alphabetic";
    const label = marker.label || "Точка";
    const ty = marker.y - r - 6;
    c2d.lineWidth = 3;
    c2d.strokeStyle = "rgba(255, 255, 255, 0.85)";
    c2d.strokeText(label, marker.x, ty);
    c2d.fillStyle = "#1a1a1a";
    c2d.fillText(label, marker.x, ty);
  });

  const board = mapState.boards.find((b) => b.id === mapState.boardId);
  const fileName = `${slugifyFileName(board ? board.name : "politicheskaya-karta")}.png`;

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, "image/png");

  return true;
}

function updateCityPopulation() {
  if (!els.citiesLayer) return;
  const players = mapState.getPlayers();
  const counts = new Map();
  players.forEach((player) => {
    if (!player.city) return;
    counts.set(player.city, (counts.get(player.city) || 0) + 1);
  });
  els.citiesLayer.querySelectorAll(".polmap-city-group").forEach((group) => {
    const count = counts.get(group.dataset.cityId) || 0;
    group.classList.toggle("has-players", count > 0);
    group.dataset.count = String(count);
  });
}

/* ================= Markers (admin pins) ================= */

function renderMarkers() {
  if (!els.markersLayer) return;
  const { w, h } = mapState.imageNatural;
  els.markersLayer.setAttribute("viewBox", `0 0 ${w} ${h}`);
  els.markersLayer.innerHTML = mapState.markers
    .map(
      (marker) => `
      <g class="polmap-marker" data-marker-id="${marker.id}" style="--marker-color:${marker.color || "#e8590c"}">
        <circle class="polmap-marker-halo" cx="${marker.x}" cy="${marker.y}" r="${Math.max(16, w * 0.012)}"></circle>
        <circle class="polmap-marker-dot" cx="${marker.x}" cy="${marker.y}" r="${Math.max(7, w * 0.005)}"></circle>
        <text class="polmap-marker-label" x="${marker.x}" y="${marker.y - Math.max(16, w * 0.012)}">${escapeXml(marker.label || "Точка")}</text>
      </g>`,
    )
    .join("");
}

function addMarkerAt(world) {
  const label = window.prompt("Название точки:", "Точка");
  if (label === null) return;
  const marker = {
    id: crypto.randomUUID(),
    x: Math.round(world.x),
    y: Math.round(world.y),
    label: label.trim() || "Точка",
    color: mapState.color,
  };
  mapState.markers.push(marker);
  renderMarkers();
  scheduleSaveBoard();
}

function openMarkerPopup(markerId, clientX, clientY) {
  const marker = mapState.markers.find((m) => m.id === markerId);
  if (!marker || !els.markerPopup) return;

  els.markerPopup.style.setProperty("--marker-color", marker.color || "#e8590c");
  const titleEl = els.markerPopup.querySelector(".polmap-marker-popup-title");
  if (titleEl) titleEl.innerHTML = `<span class="polmap-city-popup-dot"></span>${escapeHtml(marker.label || "Точка")}`;

  const actions = els.markerPopup.querySelector(".polmap-marker-popup-actions");
  if (actions) {
    actions.innerHTML = mapState.canEdit
      ? `<button type="button" class="secondary-button" data-action="rename">Переименовать</button>
         <button type="button" class="secondary-button danger-button" data-action="delete">Удалить</button>`
      : "";
    actions.querySelector('[data-action="rename"]')?.addEventListener("click", () => {
      const next = window.prompt("Новое название:", marker.label || "Точка");
      if (next === null) return;
      marker.label = next.trim() || "Точка";
      renderMarkers();
      scheduleSaveBoard();
      closeMarkerPopup();
    });
    actions.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
      mapState.markers = mapState.markers.filter((m) => m.id !== markerId);
      renderMarkers();
      scheduleSaveBoard();
      closeMarkerPopup();
    });
  }

  els.markerPopup.hidden = false;
  requestAnimationFrame(() => {
    els.markerPopup.classList.add("is-open");
    positionFloatingPanel(els.markerPopup, clientX, clientY);
  });
}

function closeMarkerPopup() {
  if (!els.markerPopup) return;
  els.markerPopup.classList.remove("is-open");
  window.setTimeout(() => {
    if (els.markerPopup) els.markerPopup.hidden = true;
  }, 180);
}

// Клики/наведения внутри плавающих окошек (карточка города, точки, редактор города)
// не должны запускать панорамирование/рисование карты — иначе кнопки внутри них
// (например «Сохранить») не срабатывают, потому что viewport перехватывает указатель.
function isInsideFloatingPanel(target) {
  if (!target || typeof target.closest !== "function") return false;
  return !!(
    target.closest(".polmap-city-popup") ||
    target.closest(".polmap-marker-popup") ||
    target.closest(".polmap-city-edit-panel")
  );
}

// Простое перетаскивание плавающих окошек за «шапку», как у настоящего окна.
function makeFloatingPanelDraggable(panel) {
  if (!panel) return;
  const handle = panel.querySelector(".polmap-city-popup-head");
  if (!handle) return;
  handle.classList.add("is-draggable");

  handle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const viewportRect = els.viewport.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = panelRect.left - viewportRect.left;
    const startTop = panelRect.top - viewportRect.top;
    const margin = 8;

    handle.classList.add("is-dragging");
    handle.setPointerCapture(event.pointerId);

    function onMove(moveEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const maxLeft = Math.max(margin, viewportRect.width - panelRect.width - margin);
      const maxTop = Math.max(margin, viewportRect.height - panelRect.height - margin);
      panel.style.left = `${clamp(startLeft + dx, margin, maxLeft)}px`;
      panel.style.top = `${clamp(startTop + dy, margin, maxTop)}px`;
    }

    function onUp(upEvent) {
      handle.classList.remove("is-dragging");
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

/* ================= Boards ================= */

function renderBoardSelect() {
  if (!els.boardSelect) return;
  els.boardSelect.innerHTML = mapState.boards
    .map((board) => `<option value="${board.id}"${board.id === mapState.boardId ? " selected" : ""}>${escapeHtml(board.name)}</option>`)
    .join("");
  els.newBoardButton?.classList.toggle("is-hidden", !mapState.canEdit);
  els.deleteBoardButton?.classList.toggle("is-hidden", !mapState.canEdit || mapState.isMainBoard);
}

async function handleCreateBoard() {
  if (!mapState.canEdit) return;
  const name = window.prompt("Название новой карты:", "Новый план");
  if (!name) return;
  const newId = await mapState.createBoard(name.trim());
  if (newId) mapState.onBoardChange(newId);
}

async function handleDeleteBoard() {
  if (!mapState.canEdit || mapState.isMainBoard) return;
  const board = mapState.boards.find((b) => b.id === mapState.boardId);
  const ok = confirm(`Удалить карту «${board?.name || ""}»? Это действие необратимо.`);
  if (!ok) return;
  await mapState.deleteBoard(mapState.boardId);
  mapState.onBoardChange(MAIN_BOARD_ID);
}

/* ================= Admin: city outline / name / color editor ================= */

function setEditCitiesMode(enabled) {
  mapState.editCitiesMode = enabled;
  els.editCitiesToggle?.classList.toggle("is-active", enabled);
  els.viewport?.classList.toggle("is-edit-cities-mode", enabled);
  if (!enabled) {
    mapState.editingCityId = null;
    mapState.editingRegion = null;
    closeCityEditPanel();
    els.citiesLayer?.querySelectorAll(".polmap-vertex-handles").forEach((g) => (g.innerHTML = ""));
  }
}

function selectCityForEdit(cityId, clientX, clientY) {
  const city = getCityById(cityId);
  if (!city) return;
  mapState.editingCityId = cityId;
  mapState.editingRegion = city.region.map(([x, y]) => [x, y]);
  renderVertexHandles();
  openCityEditPanel(city, clientX, clientY);
}

function openCityEditPanel(city, clientX, clientY) {
  if (!els.cityEditPanel) return;
  els.cityEditPanel.querySelector('[data-field="name"]').value = city.name;
  els.cityEditPanel.querySelector('[data-field="color"]').value = normalizeHexColor(city.color);
  els.cityEditPanel.hidden = false;
  requestAnimationFrame(() => {
    els.cityEditPanel.classList.add("is-open");
    positionFloatingPanel(els.cityEditPanel, clientX, clientY);
  });
}

function closeCityEditPanel() {
  if (!els.cityEditPanel) return;
  els.cityEditPanel.classList.remove("is-open");
  window.setTimeout(() => {
    if (els.cityEditPanel) els.cityEditPanel.hidden = true;
  }, 180);
}

async function saveCityEdit() {
  if (!mapState.editingCityId) return;
  const name = els.cityEditPanel.querySelector('[data-field="name"]').value.trim();
  const color = els.cityEditPanel.querySelector('[data-field="color"]').value;
  await mapState.saveCityOverride(mapState.editingCityId, {
    name: name || undefined,
    color: color || undefined,
    region: mapState.editingRegion,
  });
  closeCityEditPanel();
  mapState.editingCityId = null;
  mapState.editingRegion = null;
  els.citiesLayer?.querySelectorAll(".polmap-vertex-handles").forEach((g) => (g.innerHTML = ""));
}

async function resetCityEdit() {
  if (!mapState.editingCityId) return;
  await mapState.saveCityOverride(mapState.editingCityId, null);
  closeCityEditPanel();
  mapState.editingCityId = null;
  mapState.editingRegion = null;
  els.citiesLayer?.querySelectorAll(".polmap-vertex-handles").forEach((g) => (g.innerHTML = ""));
}

function renderVertexHandles() {
  const group = els.citiesLayer?.querySelector(`.polmap-vertex-handles[data-city-id="${mapState.editingCityId}"]`);
  if (!group || !mapState.editingRegion) return;
  group.innerHTML = mapState.editingRegion
    .map(([x, y], index) => `<circle class="polmap-vertex-handle" data-index="${index}" cx="${x}" cy="${y}" r="1.1" vector-effect="non-scaling-stroke"></circle>`)
    .join("");
  updateEditingPolygon();
}

function updateEditingPolygon() {
  if (!mapState.editingCityId || !mapState.editingRegion) return;
  const polygon = els.citiesLayer?.querySelector(`.polmap-city-hit[data-city-id="${mapState.editingCityId}"]`);
  if (polygon) polygon.setAttribute("points", mapState.editingRegion.map(([x, y]) => `${x},${y}`).join(" "));
}

function citiesLayerPointFromEvent(event) {
  const rect = els.citiesLayer.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}

function insertVertexNear(point) {
  const region = mapState.editingRegion;
  let bestIndex = 1;
  let bestDist = Infinity;
  for (let i = 0; i < region.length; i += 1) {
    const a = region[i];
    const b = region[(i + 1) % region.length];
    const d = distanceToSegmentXY(point, a, b);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i + 1;
    }
  }
  region.splice(bestIndex, 0, [point.x, point.y]);
  renderVertexHandles();
}

function removeVertex(index) {
  if (!mapState.editingRegion || mapState.editingRegion.length <= 3) return;
  mapState.editingRegion.splice(index, 1);
  renderVertexHandles();
}

function normalizeHexColor(color) {
  if (!color) return "#e8590c";
  if (color.startsWith("#")) return color;
  return "#e8590c";
}

/* ================= DOM event wiring ================= */

function bindMapEvents() {
  els.mapImage?.addEventListener("load", () => {
    mapState.imageNatural = {
      w: els.mapImage.naturalWidth || 1200,
      h: els.mapImage.naturalHeight || 800,
    };
    mapState.imageLoaded = true;
    els.citiesLayer?.setAttribute("viewBox", "0 0 100 100");
    resizeCanvas();
    if (!mapState.mapInitialized && els.view && !els.view.hidden) {
      centerMapInViewport();
      mapState.mapInitialized = true;
    }
    render();
  });

  if (els.mapImage?.complete) {
    mapState.imageNatural = {
      w: els.mapImage.naturalWidth || 1200,
      h: els.mapImage.naturalHeight || 800,
    };
    mapState.imageLoaded = true;
    els.citiesLayer?.setAttribute("viewBox", "0 0 100 100");
  }

  makeFloatingPanelDraggable(els.cityPopup);
  makeFloatingPanelDraggable(els.markerPopup);
  makeFloatingPanelDraggable(els.cityEditPanel);

  els.viewport?.addEventListener("wheel", onWheel, { passive: false });
  els.viewport?.addEventListener("pointerdown", onPointerDown);
  els.viewport?.addEventListener("contextmenu", (event) => {
    // ПКМ используется для изменения толщины кисти в режиме рисования — свой menu не нужен.
    if (mapState.drawMode) event.preventDefault();
  });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", resizeCanvas);

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  els.drawModeToggle?.addEventListener("click", () => {
    if (!mapState.canEdit) return;
    setDrawMode(!mapState.drawMode);
  });

  els.editCitiesToggle?.addEventListener("click", () => {
    if (!mapState.canEdit || !mapState.isMainBoard) return;
    setEditCitiesMode(!mapState.editCitiesMode);
  });

  els.toolButtons?.forEach((button) => {
    button.addEventListener("click", () => {
      if (!mapState.drawMode) return;
      selectTool(button.dataset.tool);
    });
  });

  els.colorInput?.addEventListener("input", () => {
    mapState.color = els.colorInput.value;
  });

  els.strokeInput?.addEventListener("input", () => {
    mapState.strokeWidth = Number(els.strokeInput.value) || 3;
    if (els.strokeValue) els.strokeValue.textContent = String(mapState.strokeWidth);
  });

  els.undoButton?.addEventListener("click", () => {
    if (!mapState.canEdit || !mapState.drawMode) return;
    mapState.elements.pop();
    render();
    scheduleSaveBoard();
  });

  els.clearButton?.addEventListener("click", () => {
    if (!mapState.canEdit || !mapState.drawMode) return;
    const ok = confirm("Очистить все рисунки на карте?");
    if (!ok) return;
    mapState.elements = [];
    render();
    scheduleSaveBoard();
  });

  els.boardSelect?.addEventListener("change", () => {
    mapState.onBoardChange(els.boardSelect.value);
  });

  els.newBoardButton?.addEventListener("click", handleCreateBoard);
  els.deleteBoardButton?.addEventListener("click", handleDeleteBoard);

  els.exportButton?.addEventListener("click", () => {
    const ok = exportPoliticalMapAsPng();
    if (!ok) alert("Карта ещё не загрузилась, подожди секунду и попробуй снова.");
  });

  els.cityEditPanel?.querySelector('[data-action="save"]')?.addEventListener("click", saveCityEdit);
  els.cityEditPanel?.querySelector('[data-action="reset"]')?.addEventListener("click", resetCityEdit);
  els.cityEditPanel?.querySelector('[data-action="show-players"]')?.addEventListener("click", (event) => {
    if (!mapState.editingCityId) return;
    openCityPopup(mapState.editingCityId, event.clientX, event.clientY);
  });
  els.cityEditPanel?.querySelector('[data-action="close"]')?.addEventListener("click", () => {
    closeCityEditPanel();
    mapState.editingCityId = null;
    mapState.editingRegion = null;
    els.citiesLayer?.querySelectorAll(".polmap-vertex-handles").forEach((g) => (g.innerHTML = ""));
  });

  els.markerPopupClose?.addEventListener("click", closeMarkerPopup);

  els.citiesLayer?.addEventListener("dblclick", (event) => {
    if (!mapState.editCitiesMode || !mapState.editingCityId) return;
    const hit = event.target.closest(".polmap-city-hit");
    const handle = event.target.closest(".polmap-vertex-handle");
    if (handle && handle.closest(`[data-city-id="${mapState.editingCityId}"]`)) {
      event.stopPropagation();
      removeVertex(Number(handle.dataset.index));
      return;
    }
    if (hit && hit.dataset.cityId === mapState.editingCityId) {
      event.stopPropagation();
      insertVertexNear(citiesLayerPointFromEvent(event));
    }
  });

  els.citiesLayer?.addEventListener("click", (event) => {
    if (mapState.editCitiesMode) {
      const hit = event.target.closest(".polmap-city-hit");
      if (!hit) return;
      event.stopPropagation();
      if (hit.dataset.cityId !== mapState.editingCityId) {
        selectCityForEdit(hit.dataset.cityId, event.clientX, event.clientY);
      }
      return;
    }
    const hit = event.target.closest(".polmap-city-hit");
    if (!hit) return;
    if (mapState.drawMode && mapState.tool !== "hand") return;
    event.stopPropagation();
    openCityPopup(hit.dataset.cityId, event.clientX, event.clientY);
  });

  els.markersLayer?.addEventListener("click", (event) => {
    const marker = event.target.closest(".polmap-marker");
    if (!marker) return;
    if (mapState.drawMode && mapState.tool !== "hand" && mapState.tool !== "pin") return;
    event.stopPropagation();
    openMarkerPopup(marker.dataset.markerId, event.clientX, event.clientY);
  });

  document.addEventListener("click", (event) => {
    if (els.cityPopup && !els.cityPopup.hidden && !event.target.closest(".polmap-city-popup") && !event.target.closest(".polmap-city-hit")) {
      closeCityPopup();
    }
    if (els.markerPopup && !els.markerPopup.hidden && !event.target.closest(".polmap-marker-popup") && !event.target.closest(".polmap-marker")) {
      closeMarkerPopup();
    }
  });
}

function setDrawMode(enabled) {
  mapState.drawMode = enabled;
  els.drawModeToggle?.classList.toggle("is-active", enabled);
  els.toolbar?.classList.toggle("is-draw-active", enabled);
  els.viewport?.classList.toggle("is-draw-mode", enabled);
  if (!enabled) {
    selectTool("hand");
    mapState.draft = null;
    mapState.eraserTargetId = null;
    if (mapState.editCitiesMode) setEditCitiesMode(false);
  } else if (mapState.tool === "hand") {
    selectTool("brush");
  }
  renderToolbar();
}

function selectTool(toolId) {
  if (!mapState.drawMode && toolId !== "hand") return;
  mapState.tool = toolId;
  renderToolbar();
}

function renderToolbar() {
  els.toolButtons?.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === mapState.tool);
    button.disabled = !mapState.drawMode || !mapState.canEdit;
  });
  if (els.undoButton) els.undoButton.disabled = !mapState.drawMode || !mapState.canEdit;
  if (els.clearButton) els.clearButton.disabled = !mapState.drawMode || !mapState.canEdit;
  if (els.editCitiesToggle) els.editCitiesToggle.disabled = !mapState.canEdit || !mapState.isMainBoard;
}

function onKeyDown(event) {
  if (!els.view || els.view.hidden) return;

  if (event.key === "Escape") {
    if (els.cityPopup && !els.cityPopup.hidden) closeCityPopup();
    if (els.markerPopup && !els.markerPopup.hidden) closeMarkerPopup();
    if (els.cityEditPanel && !els.cityEditPanel.hidden) {
      closeCityEditPanel();
      mapState.editingCityId = null;
      mapState.editingRegion = null;
      els.citiesLayer?.querySelectorAll(".polmap-vertex-handles").forEach((g) => (g.innerHTML = ""));
    }
  }

  if (event.target.matches("input, textarea, select, [contenteditable='true']")) return;

  if (event.code === "Space") {
    mapState.spaceHeld = true;
    event.preventDefault();
  }

  if (!mapState.canEdit || !mapState.drawMode) return;

  // event.code отражает физическую клавишу независимо от раскладки (RU/EN и т.д.),
  // в отличие от event.key, который на русской раскладке даёт кириллицу.
  if (event.shiftKey && event.code === "KeyA") {
    event.preventDefault();
    selectTool("drawArrow");
    return;
  }

  const tool = TOOLS.find((item) => item.code === event.code && item.id !== "drawArrow");
  if (tool) {
    event.preventDefault();
    selectTool(tool.id);
  }

  if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
    event.preventDefault();
    mapState.elements.pop();
    render();
    scheduleSaveBoard();
  }
}

function onKeyUp(event) {
  if (event.code === "Space") mapState.spaceHeld = false;
}

function onWheel(event) {
  event.preventDefault();
  const rect = els.viewport.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  const worldBefore = screenToWorld(mx, my);
  const factor = event.deltaY < 0 ? 1.12 : 0.89;
  mapState.zoom = clamp(mapState.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  mapState.panX = mx - worldBefore.x * mapState.zoom;
  mapState.panY = my - worldBefore.y * mapState.zoom;
  applyTransform();
}

function onPointerDown(event) {
  if (!els.viewport?.contains(event.target)) return;
  if (isInsideFloatingPanel(event.target)) return;

  if (event.button === 2) {
    // ПКМ + перетаскивание в сторону — меняем толщину кисти/фигуры, как в графических редакторах.
    if (!mapState.canEdit || !mapState.drawMode || !STROKE_SIZE_TOOLS.has(mapState.tool)) return;
    mapState.isResizingStroke = true;
    mapState.resizeStartX = event.clientX;
    mapState.resizeStartWidth = mapState.strokeWidth;
    els.viewport.setPointerCapture(event.pointerId);
    return;
  }

  if (event.button !== 0 && event.button !== 1) return;

  if (mapState.editCitiesMode) {
    const handle = event.target.closest(".polmap-vertex-handle");
    if (handle) {
      mapState.draggingVertexIndex = Number(handle.dataset.index);
      els.viewport.setPointerCapture(event.pointerId);
      return;
    }
    if (event.target.closest(".polmap-city-hit")) return;
  }

  const world = screenToWorldFromEvent(event);
  const useHand = !mapState.drawMode || mapState.tool === "hand" || mapState.spaceHeld || event.button === 1;

  if (useHand) {
    mapState.isPanning = true;
    mapState.panPending = true;
    mapState.panStart = { x: event.clientX - mapState.panX, y: event.clientY - mapState.panY };
    mapState.pointerDownScreen = { x: event.clientX, y: event.clientY };
    mapState.pendingPointerId = event.pointerId;
    // Указатель НЕ захватываем сразу: pointer capture ретаргетит все
    // последующие pointermove/pointerup на viewport, и в паре браузеров это
    // мешает нормальному клику по городу под курсором. Настоящий захват
    // ставим в onPointerMove, только когда сдвиг реально превысит порог
    // и мы окончательно решили, что это перетаскивание, а не клик.
    return;
  }

  if (!mapState.canEdit) return;

  if (mapState.tool === "pin") {
    mapState.pointerDownScreen = { x: event.clientX, y: event.clientY };
    mapState.pointerStart = world;
    mapState.isDrawing = true;
    els.viewport.setPointerCapture(event.pointerId);
    return;
  }

  mapState.isDrawing = true;
  mapState.pointerStart = world;
  els.viewport.setPointerCapture(event.pointerId);

  if (mapState.tool === "eraser") {
    const target = findElementAt(world, 14);
    if (target) {
      mapState.eraserTargetId = target.id;
      target.opacity = 0.5;
      render();
    }
    return;
  }

  if (mapState.tool === "brush" || mapState.tool === "drawArrow") {
    mapState.draft = makeElement(mapState.tool, [[world.x, world.y]]);
    return;
  }

  mapState.draft = makeElement(mapState.tool, [[world.x, world.y], [world.x, world.y]]);
}

function onPointerMove(event) {
  if (mapState.isResizingStroke) {
    const dx = event.clientX - mapState.resizeStartX;
    const next = clamp(Math.round(mapState.resizeStartWidth + dx / 4), 1, 16);
    if (next !== mapState.strokeWidth) {
      mapState.strokeWidth = next;
      if (els.strokeInput) els.strokeInput.value = String(next);
      if (els.strokeValue) els.strokeValue.textContent = String(next);
    }
    return;
  }

  if (mapState.draggingVertexIndex !== null && mapState.editingRegion) {
    const point = citiesLayerPointFromEvent(event);
    mapState.editingRegion[mapState.draggingVertexIndex] = [point.x, point.y];
    updateEditingPolygon();
    const handle = els.citiesLayer?.querySelector(
      `.polmap-vertex-handles[data-city-id="${mapState.editingCityId}"] .polmap-vertex-handle[data-index="${mapState.draggingVertexIndex}"]`,
    );
    if (handle) {
      handle.setAttribute("cx", point.x);
      handle.setAttribute("cy", point.y);
    }
    return;
  }

  if (mapState.isPanning && mapState.panStart) {
    if (mapState.panPending) {
      const moved = mapState.pointerDownScreen
        ? distance([mapState.pointerDownScreen.x, mapState.pointerDownScreen.y], [event.clientX, event.clientY])
        : 0;
      if (moved < PAN_DRAG_THRESHOLD) return; // ещё похоже на клик — карту не двигаем и указатель не захватываем
      mapState.panPending = false;
      if (mapState.pendingPointerId !== null) {
        els.viewport?.setPointerCapture(mapState.pendingPointerId);
        mapState.pendingPointerId = null;
      }
    }
    mapState.panX = event.clientX - mapState.panStart.x;
    mapState.panY = event.clientY - mapState.panStart.y;
    applyTransform();
    return;
  }

  if (!mapState.isDrawing) return;

  if (mapState.tool === "pin") return;

  const world = screenToWorldFromEvent(event);

  if (mapState.tool === "brush" || mapState.tool === "drawArrow") {
    if (!mapState.draft) return;
    const points = mapState.draft.points;
    const last = points[points.length - 1];
    if (distance(last, [world.x, world.y]) > 1.5) {
      points.push([world.x, world.y]);
      render();
    }
    return;
  }

  if (mapState.tool === "eraser") return;

  if (mapState.draft) {
    mapState.draft.points[1] = [world.x, world.y];
    render();
  }
}

function onPointerUp(event) {
  if (mapState.isResizingStroke) {
    mapState.isResizingStroke = false;
    return;
  }

  if (mapState.draggingVertexIndex !== null) {
    mapState.draggingVertexIndex = null;
    return;
  }

  if (mapState.isPanning) {
    mapState.isPanning = false;
    mapState.panStart = null;
    mapState.pointerDownScreen = null;
    mapState.panPending = false;
    mapState.pendingPointerId = null;
    return;
  }

  if (!mapState.isDrawing) return;
  mapState.isDrawing = false;

  if (mapState.tool === "pin") {
    const moved = mapState.pointerDownScreen ? distance([mapState.pointerDownScreen.x, mapState.pointerDownScreen.y], [event.clientX, event.clientY]) : 0;
    if (moved < 6 && mapState.pointerStart) addMarkerAt(mapState.pointerStart);
    mapState.pointerDownScreen = null;
    mapState.pointerStart = null;
    return;
  }

  if (mapState.tool === "eraser") {
    if (mapState.eraserTargetId) {
      mapState.elements = mapState.elements.filter((el) => el.id !== mapState.eraserTargetId);
      mapState.eraserTargetId = null;
      render();
      scheduleSaveBoard();
    }
    return;
  }

  if (!mapState.draft) return;

  const draft = mapState.draft;
  mapState.draft = null;

  if (draft.type === "brush" || draft.type === "drawArrow") {
    if (draft.points.length >= 2) {
      mapState.elements.push(draft);
      scheduleSaveBoard();
    }
  } else {
    const [a, b] = draft.points;
    if (distance(a, b) > 4) {
      mapState.elements.push(draft);
      scheduleSaveBoard();
    }
  }

  render();
}

function makeElement(type, points) {
  return {
    id: crypto.randomUUID(),
    type,
    points: points.map((p) => [...p]),
    color: mapState.color,
    width: mapState.strokeWidth,
    opacity: 1,
  };
}

function findElementAt(point, threshold) {
  for (let i = mapState.elements.length - 1; i >= 0; i -= 1) {
    const el = mapState.elements[i];
    if (isPointNearElement(point, el, threshold)) return el;
  }
  return null;
}

function isPointNearElement(point, el, threshold) {
  if (el.type === "brush" || el.type === "drawArrow") {
    for (let i = 1; i < el.points.length; i += 1) {
      if (distanceToSegment(point, el.points[i - 1], el.points[i]) <= threshold) return true;
    }
    return false;
  }

  const [a, b] = el.points;
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);

  if (el.type === "rect" || el.type === "rounded" || el.type === "ellipse" || el.type === "diamond") {
    return point.x >= minX - threshold && point.x <= maxX + threshold && point.y >= minY - threshold && point.y <= maxY + threshold;
  }

  return distanceToSegment(point, a, b) <= threshold;
}

function render() {
  if (!ctx || !els.canvas) return;
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  [...mapState.elements, mapState.draft].filter(Boolean).forEach((el) => drawElement(ctx, el));
  ctx.restore();
}

function drawElement(context, el) {
  context.save();
  context.globalAlpha = el.opacity ?? 1;
  context.strokeStyle = el.color;
  context.fillStyle = el.color;
  context.lineWidth = el.width;

  if (el.type === "brush" || el.type === "drawArrow") {
    context.beginPath();
    el.points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    if (el.type === "drawArrow" && el.points.length >= 2) {
      drawArrowHead(context, el.points[el.points.length - 2], el.points[el.points.length - 1], el.width);
    }
    context.restore();
    return;
  }

  const [a, b] = el.points;
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const width = Math.abs(b[0] - a[0]);
  const height = Math.abs(b[1] - a[1]);

  if (el.type === "rect") {
    context.strokeRect(x, y, width, height);
  } else if (el.type === "rounded") {
    roundRect(context, x, y, width, height, Math.min(width, height) * 0.18);
    context.stroke();
  } else if (el.type === "ellipse") {
    context.beginPath();
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (el.type === "diamond") {
    context.beginPath();
    context.moveTo(x + width / 2, y);
    context.lineTo(x + width, y + height / 2);
    context.lineTo(x + width / 2, y + height);
    context.lineTo(x, y + height / 2);
    context.closePath();
    context.stroke();
  } else if (el.type === "arrow") {
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
    drawArrowHead(context, a, b, el.width);
  }

  context.restore();
}

function drawArrowHead(context, from, to, width) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = Math.max(10, width * 3.2);
  context.beginPath();
  context.moveTo(to[0], to[1]);
  context.lineTo(to[0] - size * Math.cos(angle - 0.42), to[1] - size * Math.sin(angle - 0.42));
  context.moveTo(to[0], to[1]);
  context.lineTo(to[0] - size * Math.cos(angle + 0.42), to[1] - size * Math.sin(angle + 0.42));
  context.stroke();
}

function roundRect(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.quadraticCurveTo(x + w, y, x + w, y + r);
  context.lineTo(x + w, y + h - r);
  context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  context.lineTo(x + r, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function applyTransform() {
  if (!els.stage) return;
  els.stage.style.transform = `translate(${mapState.panX}px, ${mapState.panY}px) scale(${mapState.zoom})`;
}

function resizeCanvas() {
  if (!els.canvas || !els.stage) return;
  const { w, h } = mapState.imageNatural;
  els.canvas.width = w;
  els.canvas.height = h;
  els.stage.style.width = `${w}px`;
  els.stage.style.height = `${h}px`;
  if (els.markersLayer) els.markersLayer.setAttribute("viewBox", `0 0 ${w} ${h}`);
  ctx = els.canvas.getContext("2d");
  render();
  renderMarkers();
}

function screenToWorldFromEvent(event) {
  const rect = els.viewport.getBoundingClientRect();
  return screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - mapState.panX) / mapState.zoom,
    y: (sy - mapState.panY) / mapState.zoom,
  };
}

function openCityPopup(cityId, clientX, clientY) {
  const city = getCityById(cityId);
  if (!city || !els.cityPopup) return;

  const players = mapState.getPlayers().filter((player) => player.city === cityId);
  els.cityPopup.style.setProperty("--city-color", city.color || "var(--accent)");
  const titleEl = els.cityPopup.querySelector(".polmap-city-popup-title");
  titleEl.innerHTML = `<span class="polmap-city-popup-dot"></span>${escapeHtml(city.name)}`;

  const list = els.cityPopup.querySelector(".polmap-city-popup-list");
  if (players.length === 0) {
    list.innerHTML = `<li class="polmap-city-popup-empty">В этом городе пока никого нет</li>`;
  } else {
    list.innerHTML = players
      .map(
        (player) => `
        <li>
          <button type="button" class="polmap-city-player" data-player-id="${player.id}">
            <img src="https://mc-heads.net/avatar/${encodeURIComponent(player.name)}/28" alt="" loading="lazy"/>
            <span>${escapeHtml(player.name)}</span>
          </button>
        </li>`,
      )
      .join("");
  }

  els.cityPopup.hidden = false;
  requestAnimationFrame(() => {
    els.cityPopup.classList.add("is-open");
    positionFloatingPanel(els.cityPopup, clientX, clientY);
  });

  list.querySelectorAll(".polmap-city-player").forEach((button) => {
    button.addEventListener("click", () => {
      closeCityPopup();
      mapState.onPlayerOpen(button.dataset.playerId);
    });
  });
}

function positionFloatingPanel(panel, clientX, clientY) {
  const margin = 12;
  const rect = els.viewport.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  let left = clientX - rect.left + margin;
  let top = clientY - rect.top + margin;

  if (left + panelRect.width > rect.width - margin) {
    left = clientX - rect.left - panelRect.width - margin;
  }
  if (top + panelRect.height > rect.height - margin) {
    top = clientY - rect.top - panelRect.height - margin;
  }

  panel.style.left = `${Math.max(margin, left)}px`;
  panel.style.top = `${Math.max(margin, top)}px`;
}

function closeCityPopup() {
  if (!els.cityPopup) return;
  els.cityPopup.classList.remove("is-open");
  window.setTimeout(() => {
    if (els.cityPopup) els.cityPopup.hidden = true;
  }, 180);
}

function scheduleSaveBoard() {
  if (!mapState.canEdit) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    await mapState.saveBoardData(mapState.boardId, {
      elements: mapState.elements.map(cloneElement),
      markers: mapState.markers.map((m) => ({ ...m })),
    });
  }, SAVE_DEBOUNCE_MS);
}

function cityCenter(city) {
  const xs = city.region.map(([x]) => x);
  const ys = city.region.map(([, y]) => y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function cloneElement(el) {
  return {
    ...el,
    points: el.points.map((p) => [...p]),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function distanceToSegment(point, a, b) {
  return distanceToSegmentXY({ x: point.x, y: point.y }, a, b);
}

function distanceToSegmentXY(point, a, b) {
  const px = point.x;
  const py = point.y;
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function escapeXml(value) {
  return escapeHtml(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

export { TOOLS, MAP_IMAGE, MAIN_BOARD_ID };