import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  initPoliticalMap,
  setPoliticalMapCanEdit,
  setPoliticalMapBoardData,
  setPoliticalMapBoards,
  setPoliticalMapCityOverrides,
  focusPoliticalCity,
  onPoliticalMapShow,
  updatePoliticalMapPopulation,
  MAIN_BOARD_ID,
} from "./political-map.js";
import { applyCityOverrides } from "./cities.js";

/* ================= Firebase ================= */

const firebaseConfig = {
  apiKey: "AIzaSyBPYpY00cjEflk_CLosSRQyFH3P8608KK0",
  authDomain: "reviewconstructor.firebaseapp.com",
  projectId: "reviewconstructor",
  storageBucket: "reviewconstructor.firebasestorage.app",
  messagingSenderId: "496296589511",
  appId: "1:496296589511:web:a28ec66ac6fc8757a766e2",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const EMAIL_DOMAIN = "freakland.local";
/* Зарегистрируй аккаунт с этим ником первым — он автоматически станет
   главным админом (isMain). Потом можешь выдавать права другим через панель. */
const MAIN_ADMIN_NICKNAME = "freakland";

function nicknameToEmail(nickname) {
  return `${nickname.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

/* ================= Local-only storage ================= */
const THEME_KEY = "freakland-create-theme";
const LOG_MAX_ENTRIES = 300;
const DEFAULT_ROLE = "Игрок";

const DEFAULT_TIER_TEMPLATE = () => [
  { id: crypto.randomUUID(), name: "S", color: "#f6d55c", playerIds: [] },
  { id: crypto.randomUUID(), name: "A", color: "#8ce99a", playerIds: [] },
  { id: crypto.randomUUID(), name: "B", color: "#74c0fc", playerIds: [] },
  { id: crypto.randomUUID(), name: "C", color: "#d0bfff", playerIds: [] },
  { id: crypto.randomUUID(), name: "D", color: "#ced4da", playerIds: [] },
];

/* ================= State ================= */
const state = {
  players: [],
  query: "",
  sort: "alpha-asc",
  user: null, // { uid, nickname, isAdmin, isMain }
  tierlists: {},
  activeTierlist: "",
  viewers: new Map(),
  pendingPromptResolve: null,
  highlightPlayerId: null,
  activeView: "catalog",
  polmapMainData: { elements: [], markers: [] },
  polmapBoards: [],
  polmapActiveBoardId: "main",
  polmapCityOverrides: {},
  tierPhotoPreviewEnabled: true,
};

let unsubTierlists = null;
let unsubActiveBoard = null;

/* ================= DOM refs ================= */
const els = {
  root: document.documentElement,
  grid: document.querySelector("#playersGrid"),
  empty: document.querySelector("#emptyState"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyText: document.querySelector("#emptyText"),
  emptyAdd: document.querySelector("#emptyAddButton"),
  count: document.querySelector("#countLabel"),
  search: document.querySelector("#searchInput"),
  searchWrap: document.querySelector("#searchWrap"),
  sortSelect: document.querySelector("#sortSelect"),

  formPanel: document.querySelector("#formPanel"),
  form: document.querySelector("#playerForm"),
  formTitle: document.querySelector("#formTitle"),
  editingId: document.querySelector("#editingId"),
  name: document.querySelector("#nameInput"),
  telegram: document.querySelector("#telegramInput"),
  twitch: document.querySelector("#twitchInput"),
  city: document.querySelector("#cityInput"),
  skinPreview: document.querySelector("#skinPreview"),
  skinPreviewImg: document.querySelector("#skinPreviewImg"),
  skinPreviewLabel: document.querySelector("#skinPreviewLabel"),
  openForm: document.querySelector("#openFormButton"),
  closeForm: document.querySelector("#closeFormButton"),
  resetForm: document.querySelector("#resetFormButton"),

  themeToggle: document.querySelector("#themeToggle"),

  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  openAdmins: document.querySelector("#openAdminsButton"),

  loginModal: document.querySelector("#loginModalBackdrop"),
  loginModalTitle: document.querySelector("#loginModalTitle"),
  closeLoginModal: document.querySelector("#closeLoginModal"),
  loginForm: document.querySelector("#loginForm"),
  loginName: document.querySelector("#loginNameInput"),
  loginPassword: document.querySelector("#loginPasswordInput"),
  loginError: document.querySelector("#loginError"),
  showRegisterButton: document.querySelector("#showRegisterButton"),

  registerForm: document.querySelector("#registerForm"),
  registerName: document.querySelector("#registerNameInput"),
  registerPassword: document.querySelector("#registerPasswordInput"),
  registerPasswordConfirm: document.querySelector("#registerPasswordConfirmInput"),
  registerError: document.querySelector("#registerError"),
  registerMismatchError: document.querySelector("#registerMismatchError"),
  showLoginButton: document.querySelector("#showLoginButton"),

  adminsModal: document.querySelector("#adminsModalBackdrop"),
  closeAdminsModal: document.querySelector("#closeAdminsModal"),
  adminsList: document.querySelector("#adminsList"),
  addAdminForm: document.querySelector("#addAdminForm"),
  newAdminName: document.querySelector("#newAdminName"),
  addAdminError: document.querySelector("#addAdminError"),

  openLogButton: document.querySelector("#openLogButton"),
  logModal: document.querySelector("#logModalBackdrop"),
  closeLogModal: document.querySelector("#closeLogModal"),
  logList: document.querySelector("#logList"),
  clearLogButton: document.querySelector("#clearLogButton"),

  nameModal: document.querySelector("#nameModalBackdrop"),
  closeNameModal: document.querySelector("#closeNameModal"),
  nameForm: document.querySelector("#nameForm"),
  nameModalInput: document.querySelector("#nameModalInput"),
  nameModalTitle: document.querySelector("#nameModalTitle"),

  tabCatalog: document.querySelector("#tabCatalog"),
  tabTierlist: document.querySelector("#tabTierlist"),
  tabPolmap: document.querySelector("#tabPolmap"),
  viewCatalog: document.querySelector("#viewCatalog"),
  viewTierlist: document.querySelector("#viewTierlist"),
  viewPolmap: document.querySelector("#viewPolmap"),

  tierlistLoginRequired: document.querySelector("#tierlistLoginRequired"),
  tierlistLoginButton: document.querySelector("#tierlistLoginButton"),
  tierlistToolbar: document.querySelector("#tierlistToolbar"),
  tierlistSelect: document.querySelector("#tierlistSelect"),
  newTierlistButton: document.querySelector("#newTierlistButton"),
  renameTierlistButton: document.querySelector("#renameTierlistButton"),
  deleteTierlistButton: document.querySelector("#deleteTierlistButton"),
  resetTierlistButton: document.querySelector("#resetTierlistButton"),
  addTierButton: document.querySelector("#addTierButton"),
  saveTierlistButton: document.querySelector("#saveTierlistButton"),
  exportTierlistButton: document.querySelector("#exportTierlistButton"),
  tierExportArea: document.querySelector("#tierExportArea"),
  tierExportTitle: document.querySelector("#tierExportTitle"),
  tierPoolWrap: document.querySelector("#tierPoolWrap"),
  tierRows: document.querySelector("#tierRows"),
  tierPool: document.querySelector("#tierPool"),
  tierPhotoPreview: document.querySelector("#tierPhotoPreview"),
  tierPhotoPreviewImg: document.querySelector("#tierPhotoPreviewImg"),

  polmapToolbar: document.querySelector("#polmapToolbar"),
  polmapDrawModeToggle: document.querySelector("#polmapDrawModeToggle"),
  polmapToolGrid: document.querySelector("#polmapToolGrid"),
  polmapColorInput: document.querySelector("#polmapColorInput"),
  polmapStrokeInput: document.querySelector("#polmapStrokeInput"),
  polmapStrokeValue: document.querySelector("#polmapStrokeValue"),
  polmapUndoButton: document.querySelector("#polmapUndoButton"),
  polmapClearButton: document.querySelector("#polmapClearButton"),
  polmapViewport: document.querySelector("#polmapViewport"),
  polmapStage: document.querySelector("#polmapStage"),
  polmapImage: document.querySelector("#polmapImage"),
  polmapCitiesLayer: document.querySelector("#polmapCitiesLayer"),
  polmapCanvas: document.querySelector("#polmapCanvas"),
  polmapCityPopup: document.querySelector("#polmapCityPopup"),
  polmapCityPopupClose: document.querySelector("#polmapCityPopupClose"),
  polmapBoardSelect: document.querySelector("#polmapBoardSelect"),
  polmapNewBoardButton: document.querySelector("#polmapNewBoardButton"),
  polmapDeleteBoardButton: document.querySelector("#polmapDeleteBoardButton"),
  polmapEditCitiesToggle: document.querySelector("#polmapEditCitiesToggle"),
  polmapCityEditPanel: document.querySelector("#polmapCityEditPanel"),
  polmapMarkersLayer: document.querySelector("#polmapMarkersLayer"),
  polmapMarkerPopup: document.querySelector("#polmapMarkerPopup"),
  polmapMarkerPopupClose: document.querySelector("#polmapMarkerPopupClose"),
};

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.14 },
);

init();

async function init() {
  applyInitialTheme();
  populateCitySelect();
  bindEvents();
  setupTierPhotoPreview();
  initPoliticalMapModule();
  updateAuthUI();
  renderTierlist();
  refreshIcons();

  // Общий каталог игроков — публичное чтение, синхронизируется у всех сразу
  onSnapshot(doc(db, "catalog", "players"), (snap) => {
    state.players = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : [];
    renderCatalog();
    renderTierlist();
    updatePoliticalMapPopulation();
  });

  // Основная карта (elements + markers) — публичное чтение
  onSnapshot(doc(db, "catalog", "politicalMap"), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    state.polmapMainData = {
      elements: Array.isArray(data.elements) ? decodePolmapElements(data.elements) : [],
      markers: Array.isArray(data.markers) ? data.markers : [],
    };
    if (state.polmapActiveBoardId === MAIN_BOARD_ID) {
      setPoliticalMapBoardData(MAIN_BOARD_ID, { ...state.polmapMainData, isMain: true, name: "Политическая карта" });
    }
  });

  // Дополнительные карты-планы, которые создают админы
  onSnapshot(collection(db, "politicalMapBoards"), (snap) => {
    state.polmapBoards = snap.docs.map((d) => ({ id: d.id, name: d.data().name || "Без названия" }));
    setPoliticalMapBoards(state.polmapBoards);
    if (state.polmapActiveBoardId !== MAIN_BOARD_ID && !snap.docs.some((d) => d.id === state.polmapActiveBoardId)) {
      switchPoliticalMapBoard(MAIN_BOARD_ID);
    }
  });

  // Правки городов (имя/цвет/контур), которые вносят админы
  onSnapshot(doc(db, "catalog", "politicalMapCityMeta"), (snap) => {
    state.polmapCityOverrides = snap.exists() && snap.data().overrides ? snap.data().overrides : {};
    setPoliticalMapCityOverrides(state.polmapCityOverrides);
    renderCatalog();
    if (els.formPanel?.classList.contains("is-open")) {
      const currentCity = els.city.value;
      els.city.innerHTML = getEffectiveCityOptionsHtml(currentCity);
    }
  });

  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      state.user = null;
      if (unsubTierlists) {
        unsubTierlists();
        unsubTierlists = null;
      }
      state.tierlists = {};
      state.activeTierlist = "";
      updateAuthUI();
      renderCatalog();
      renderTierlist();
      return;
    }

    const userSnap = await getDoc(doc(db, "users", fbUser.uid));
    if (!userSnap.exists()) {
      // документ ещё не успел создаться (гонка сразу после регистрации) — подождём
      return;
    }
    const data = userSnap.data();
    state.user = { uid: fbUser.uid, nickname: data.nickname, isAdmin: Boolean(data.isAdmin), isMain: Boolean(data.isMain) };
    subscribeTierlists(fbUser.uid);
    updateAuthUI();
    renderCatalog();
    renderTierlist();
  });
}

function populateCitySelect() {
  if (!els.city) return;
  els.city.innerHTML = getEffectiveCityOptionsHtml();
}

// Города с учётом админских правок (имя/цвет/контур), внесённых на полит. карте —
// чтобы карточки игроков и селект города всегда совпадали с тем, что видно на карте.
function effectiveCities() {
  return applyCityOverrides(state.polmapCityOverrides);
}

function getEffectiveCityById(id) {
  if (!id) return null;
  return effectiveCities().find((city) => city.id === id) || null;
}

function getEffectiveCityOptionsHtml(selectedId = "") {
  const options = ['<option value="">— город не указан —</option>'];
  effectiveCities().forEach((city) => {
    const selected = city.id === selectedId ? " selected" : "";
    options.push(`<option value="${city.id}"${selected}>${escapeHtml(city.name)}</option>`);
  });
  return options.join("");
}

function initPoliticalMapModule() {
  initPoliticalMap({
    els: {
      view: els.viewPolmap,
      toolbar: els.polmapToolbar,
      drawModeToggle: els.polmapDrawModeToggle,
      toolButtons: els.polmapToolGrid?.querySelectorAll(".polmap-tool"),
      colorInput: els.polmapColorInput,
      strokeInput: els.polmapStrokeInput,
      strokeValue: els.polmapStrokeValue,
      undoButton: els.polmapUndoButton,
      clearButton: els.polmapClearButton,
      viewport: els.polmapViewport,
      stage: els.polmapStage,
      mapImage: els.polmapImage,
      citiesLayer: els.polmapCitiesLayer,
      markersLayer: els.polmapMarkersLayer,
      canvas: els.polmapCanvas,
      cityPopup: els.polmapCityPopup,
      markerPopup: els.polmapMarkerPopup,
      markerPopupClose: els.polmapMarkerPopupClose,
      boardSelect: els.polmapBoardSelect,
      newBoardButton: els.polmapNewBoardButton,
      deleteBoardButton: els.polmapDeleteBoardButton,
      editCitiesToggle: els.polmapEditCitiesToggle,
      cityEditPanel: els.polmapCityEditPanel,
    },
    getPlayers: () => state.players,
    onPlayerOpen: (playerId) => openPlayerFromMap(playerId),
    saveBoardData: savePoliticalMapBoardData,
    createBoard: createPoliticalMapBoard,
    deleteBoard: deletePoliticalMapBoard,
    saveCityOverride: savePoliticalMapCityOverride,
    onBoardChange: switchPoliticalMapBoard,
    refreshIcons,
    canEdit: isAdmin(),
  });

  els.polmapCityPopupClose?.addEventListener("click", () => {
    els.polmapCityPopup?.classList.remove("is-open");
    if (els.polmapCityPopup) els.polmapCityPopup.hidden = true;
  });
}

function switchPoliticalMapBoard(boardId) {
  if (unsubActiveBoard) {
    unsubActiveBoard();
    unsubActiveBoard = null;
  }
  state.polmapActiveBoardId = boardId;

  if (boardId === MAIN_BOARD_ID) {
    setPoliticalMapBoardData(MAIN_BOARD_ID, { ...state.polmapMainData, isMain: true, name: "Политическая карта" });
    return;
  }

  unsubActiveBoard = onSnapshot(doc(db, "politicalMapBoards", boardId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    setPoliticalMapBoardData(boardId, {
      elements: Array.isArray(data.elements) ? decodePolmapElements(data.elements) : [],
      markers: Array.isArray(data.markers) ? data.markers : [],
      isMain: false,
      name: data.name || "Без названия",
    });
  });
}

// Firestore не поддерживает вложенные массивы (массив внутри массива),
// а el.points — это как раз массив пар [x, y]. Поэтому при сохранении
// переводим точки в {x, y}, а при чтении — обратно в [x, y].
function encodePolmapElements(elements) {
  return (elements || []).map((el) => ({
    ...el,
    points: (el.points || []).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p)),
  }));
}

function decodePolmapElements(elements) {
  return (elements || []).map((el) => ({
    ...el,
    points: (el.points || []).map((p) => (Array.isArray(p) ? p : [p.x, p.y])),
  }));
}

async function savePoliticalMapBoardData(boardId, { elements, markers }) {
  if (!isAdmin()) return;
  try {
    const payload = { elements: encodePolmapElements(elements), markers };
    if (boardId === MAIN_BOARD_ID) {
      await setDoc(doc(db, "catalog", "politicalMap"), payload);
    } else {
      await setDoc(doc(db, "politicalMapBoards", boardId), payload, { merge: true });
    }
  } catch (error) {
    console.error(error);
    alert("Не получилось сохранить изменения на карте.");
  }
}

async function createPoliticalMapBoard(name) {
  if (!isAdmin()) return null;
  try {
    const ref = await addDoc(collection(db, "politicalMapBoards"), {
      name,
      elements: [],
      markers: [],
      createdAt: Date.now(),
    });
    return ref.id;
  } catch (error) {
    console.error(error);
    alert("Не получилось создать новую карту.");
    return null;
  }
}

async function deletePoliticalMapBoard(boardId) {
  if (!isAdmin() || boardId === MAIN_BOARD_ID) return;
  try {
    await deleteDoc(doc(db, "politicalMapBoards", boardId));
  } catch (error) {
    console.error(error);
    alert("Не получилось удалить карту.");
  }
}

async function savePoliticalMapCityOverride(cityId, patch) {
  if (!isAdmin()) return;
  const next = { ...state.polmapCityOverrides };
  if (patch) {
    next[cityId] = patch;
  } else {
    delete next[cityId];
  }
  try {
    await setDoc(doc(db, "catalog", "politicalMapCityMeta"), { overrides: next });
  } catch (error) {
    console.error(error);
    alert("Не получилось сохранить изменения города.");
  }
}

function openPlayerFromMap(playerId) {
  switchView("catalog");
  highlightPlayerCard(playerId);
}

function highlightPlayerCard(playerId) {
  state.highlightPlayerId = playerId;
  renderCatalog();
  requestAnimationFrame(() => {
    const card = document.querySelector(`.player-card[data-id="${playerId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("is-highlighted");
    window.setTimeout(() => {
      card.classList.remove("is-highlighted");
      if (state.highlightPlayerId === playerId) state.highlightPlayerId = null;
    }, 3200);
  });
}

function openCityOnMap(cityId) {
  if (!cityId) return;
  switchView("polmap");
  focusPoliticalCity(cityId);
}

/* ================= Auth ================= */

function isLoggedIn() {
  return Boolean(state.user);
}

function isAdmin() {
  return Boolean(state.user && state.user.isAdmin);
}

function isMainAdmin() {
  return Boolean(state.user && state.user.isMain);
}

function updateAuthUI() {
  const loggedIn = isLoggedIn();
  const admin = isAdmin();

  document.querySelectorAll(".admin-only").forEach((node) => {
    node.hidden = !admin;
  });

  els.loginButton.hidden = loggedIn;
  els.logoutButton.hidden = !loggedIn;
  els.openAdmins.hidden = !isMainAdmin();
  els.openLogButton.hidden = !isMainAdmin();

  if (els.tierlistLoginRequired) els.tierlistLoginRequired.hidden = loggedIn;
  if (els.tierlistToolbar) els.tierlistToolbar.hidden = !loggedIn;
  if (els.tierExportArea) els.tierExportArea.hidden = !loggedIn;
  if (els.tierPoolWrap) els.tierPoolWrap.hidden = !loggedIn;

  setPoliticalMapCanEdit(admin);

  refreshIcons();
}

/* ================= Players (общий каталог в Firestore) ================= */

async function savePlayers() {
  try {
    await setDoc(doc(db, "catalog", "players"), { list: state.players });
  } catch (error) {
    console.error(error);
    alert("Не получилось сохранить изменения. Проверь права админа и подключение.");
  }
}

/* ================= Skin helpers ================= */

function skinBodyUrl(name) {
  return `https://mc-heads.net/body/${encodeURIComponent(name || "Steve")}/180`;
}

function skinTextureUrl(name) {
  return `https://mc-heads.net/skin/${encodeURIComponent(name || "Steve")}`;
}

/* ================= Bind events ================= */

function bindEvents() {
  els.openForm.addEventListener("click", () => {
    resetForm();
    openForm();
  });
  els.emptyAdd.addEventListener("click", () => {
    resetForm();
    openForm();
  });
  els.closeForm.addEventListener("click", closeForm);
  els.resetForm.addEventListener("click", resetForm);

  els.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderCatalog();
  });

  els.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderCatalog();
  });

  els.themeToggle.addEventListener("click", () => {
    const nextTheme = els.root.dataset.theme === "dark" ? "light" : "dark";
    els.root.dataset.theme = nextTheme;
    localStorage.setItem(THEME_KEY, nextTheme);
    updateThemeIcon();
  });

  els.name.addEventListener("input", updateSkinPreview);

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin()) return;

    const name = els.name.value.trim();
    const telegram = els.telegram.value.trim() ? normalizeSocialUrl(els.telegram.value.trim(), "t.me") : "";
    const twitch = els.twitch.value.trim() ? normalizeSocialUrl(els.twitch.value.trim(), "twitch.tv") : "";
    const city = els.city.value || "";

    if (!name) return;

    const existingIndex = state.players.findIndex((item) => item.id === els.editingId.value);
    const wasEditing = existingIndex >= 0;

    const player = {
      id: els.editingId.value || crypto.randomUUID(),
      name,
      telegram,
      twitch,
      city,
      role: wasEditing ? (state.players[existingIndex].role ?? DEFAULT_ROLE) : DEFAULT_ROLE,
    };

    if (wasEditing) {
      state.players[existingIndex] = player;
    } else {
      state.players.unshift(player);
    }

    await savePlayers();
    resetForm();
    closeForm();
    renderCatalog();
    syncTierlistWithPlayers();
    renderTierlist();
    logAction(wasEditing ? `Отредактирован игрок: ${name}` : `Добавлен игрок: ${name}`);
  });

  // Auth
  els.loginButton.addEventListener("click", () => {
    setLoginModalMode("login");
    openModal(els.loginModal, els.loginName);
  });
  if (els.tierlistLoginButton) {
    els.tierlistLoginButton.addEventListener("click", () => {
      setLoginModalMode("login");
      openModal(els.loginModal, els.loginName);
    });
  }
  els.closeLoginModal.addEventListener("click", () => closeModal(els.loginModal));
  els.logoutButton.addEventListener("click", async () => {
    await signOut(auth);
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = els.loginName.value.trim();
    const password = els.loginPassword.value;
    if (!nickname || !password) return;

    els.loginError.hidden = true;
    try {
      await signInWithEmailAndPassword(auth, nicknameToEmail(nickname), password);
      els.loginForm.reset();
      closeModal(els.loginModal);
    } catch (error) {
      console.error(error);
      els.loginError.hidden = false;
    }
  });

  els.showRegisterButton.addEventListener("click", () => setLoginModalMode("register"));
  els.showLoginButton.addEventListener("click", () => setLoginModalMode("login"));

  els.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = els.registerName.value.trim();
    const password = els.registerPassword.value;
    const passwordConfirm = els.registerPasswordConfirm.value;

    els.registerError.hidden = true;
    els.registerMismatchError.hidden = true;

    if (!nickname) return;

    if (password !== passwordConfirm) {
      els.registerMismatchError.hidden = false;
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, nicknameToEmail(nickname), password);
      const nicknameLower = nickname.toLowerCase();
      const isMain = nicknameLower === MAIN_ADMIN_NICKNAME;
      await setDoc(doc(db, "users", cred.user.uid), {
        nickname,
        nicknameLower,
        isAdmin: isMain,
        isMain,
        createdAt: Date.now(),
      });
      els.registerForm.reset();
      closeModal(els.loginModal);
    } catch (error) {
      console.error(error);
      if (error.code === "auth/email-already-in-use") {
        els.registerError.hidden = false;
      } else if (error.code === "auth/weak-password") {
        alert("Пароль слишком короткий — нужно минимум 6 символов.");
      } else {
        alert("Не получилось зарегистрироваться. Попробуй ещё раз.");
      }
    }
  });

  // Admins panel
  els.openAdmins.addEventListener("click", async () => {
    if (!isMainAdmin()) return;
    await renderAdminsList();
    openModal(els.adminsModal, els.newAdminName);
  });
  els.closeAdminsModal.addEventListener("click", () => closeModal(els.adminsModal));

  els.addAdminForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isMainAdmin()) return;
    const nickname = els.newAdminName.value.trim();
    if (!nickname) return;

    els.addAdminError.hidden = true;
    const nicknameLower = nickname.toLowerCase();

    try {
      const q = query(collection(db, "users"), where("nicknameLower", "==", nicknameLower));
      const snap = await getDocs(q);
      if (snap.empty || snap.docs[0].data().isAdmin) {
        els.addAdminError.hidden = false;
        return;
      }
      const userDoc = snap.docs[0];
      await updateDoc(doc(db, "users", userDoc.id), { isAdmin: true });
      els.addAdminForm.reset();
      await renderAdminsList();
      logAction(`Выдан админ: ${userDoc.data().nickname}`);
    } catch (error) {
      console.error(error);
      els.addAdminError.hidden = false;
    }
  });

  // Admin action log
  els.openLogButton.addEventListener("click", async () => {
    if (!isMainAdmin()) return;
    await renderLogList();
    openModal(els.logModal, els.closeLogModal);
  });
  els.closeLogModal.addEventListener("click", () => closeModal(els.logModal));
  els.clearLogButton.addEventListener("click", async () => {
    if (!isMainAdmin()) return;
    const shouldClear = confirm("Очистить весь лог действий админов?");
    if (!shouldClear) return;
    const snap = await getDocs(collection(db, "logs"));
    await Promise.all(snap.docs.map((entry) => deleteDoc(entry.ref)));
    await renderLogList();
  });

  // Tabs
  els.tabCatalog.addEventListener("click", () => switchView("catalog"));
  els.tabTierlist.addEventListener("click", () => switchView("tierlist"));
  els.tabPolmap.addEventListener("click", () => switchView("polmap"));

  // Tierlist controls
  els.tierlistSelect.addEventListener("change", () => {
    state.activeTierlist = els.tierlistSelect.value;
    saveTierlistsToStorage();
    renderTierlist();
  });

  els.newTierlistButton.addEventListener("click", async () => {
    if (!isLoggedIn()) return;
    const name = await promptModal("Название нового тирлиста", "");
    if (!name) return;
    if (state.tierlists[name]) {
      alert("Тирлист с таким названием уже есть");
      return;
    }
    state.tierlists[name] = { tiers: DEFAULT_TIER_TEMPLATE() };
    state.activeTierlist = name;
    await saveTierlistsToStorage();
    renderTierlist();
  });

  els.renameTierlistButton.addEventListener("click", async () => {
    if (!isLoggedIn()) return;
    const oldName = state.activeTierlist;
    if (!oldName) return;
    const name = await promptModal("Новое название тирлиста", oldName);
    if (!name || name === oldName) return;
    if (state.tierlists[name]) {
      alert("Тирлист с таким названием уже есть");
      return;
    }
    state.tierlists[name] = state.tierlists[oldName];
    delete state.tierlists[oldName];
    state.activeTierlist = name;
    await saveTierlistsToStorage();
    renderTierlist();
  });

  els.deleteTierlistButton.addEventListener("click", async () => {
    if (!isLoggedIn()) return;
    const names = Object.keys(state.tierlists);
    if (names.length <= 1) {
      alert("Должен остаться хотя бы один тирлист");
      return;
    }
    const shouldDelete = confirm(`Удалить тирлист "${state.activeTierlist}"?`);
    if (!shouldDelete) return;
    delete state.tierlists[state.activeTierlist];
    state.activeTierlist = Object.keys(state.tierlists)[0];
    await saveTierlistsToStorage();
    renderTierlist();
  });

  els.resetTierlistButton.addEventListener("click", () => {
    if (!isLoggedIn()) return;
    const shouldReset = confirm("Вернуть всех игроков в общий пул?");
    if (!shouldReset) return;
    const list = state.tierlists[state.activeTierlist];
    if (!list) return;
    list.tiers.forEach((tier) => {
      tier.playerIds = [];
    });
    renderTierlist();
  });

  els.addTierButton.addEventListener("click", () => {
    if (!isLoggedIn()) return;
    const list = state.tierlists[state.activeTierlist];
    if (!list) return;
    list.tiers.push({ id: crypto.randomUUID(), name: "Новый", color: "#adb5bd", playerIds: [] });
    renderTierlist();
  });

  els.saveTierlistButton.addEventListener("click", async () => {
    if (!isLoggedIn()) return;
    await saveTierlistsToStorage();
    els.saveTierlistButton.classList.add("is-active");
    setTimeout(() => els.saveTierlistButton.classList.remove("is-active"), 600);
  });

  els.exportTierlistButton.addEventListener("click", exportTierlistAsImage);

  // Generic modal close on backdrop click + escape
  [els.loginModal, els.adminsModal, els.logModal, els.nameModal].forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    [els.loginModal, els.adminsModal, els.logModal, els.nameModal].forEach((modal) => {
      if (!modal.hidden) closeModal(modal);
    });
  });

  els.closeNameModal.addEventListener("click", () => closeModal(els.nameModal, true));
  els.nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = els.nameModalInput.value.trim();
    closeModal(els.nameModal);
    if (state.pendingPromptResolve) {
      state.pendingPromptResolve(value || null);
      state.pendingPromptResolve = null;
    }
  });
}

/* ================= Modal helpers ================= */

function openModal(modal, focusEl) {
  modal.hidden = false;
  requestAnimationFrame(() => focusEl && focusEl.focus());
}

function closeModal(modal, cancelPrompt) {
  modal.hidden = true;
  els.loginError.hidden = true;
  els.addAdminError.hidden = true;
  els.registerError.hidden = true;
  els.registerMismatchError.hidden = true;
  if (modal === els.loginModal) {
    setLoginModalMode("login");
    els.loginForm.reset();
    els.registerForm.reset();
  }
  if (modal === els.nameModal && cancelPrompt && state.pendingPromptResolve) {
    state.pendingPromptResolve(null);
    state.pendingPromptResolve = null;
  }
}

function setLoginModalMode(mode) {
  const isRegister = mode === "register";
  els.loginForm.hidden = isRegister;
  els.registerForm.hidden = !isRegister;
  els.loginModalTitle.textContent = isRegister ? "Регистрация" : "Вход в аккаунт";
  els.loginError.hidden = true;
  els.registerError.hidden = true;
  els.registerMismatchError.hidden = true;
  requestAnimationFrame(() => {
    const focusEl = isRegister ? els.registerName : els.loginName;
    focusEl && focusEl.focus();
  });
}

function promptModal(title, defaultValue) {
  els.nameModalTitle.textContent = title;
  els.nameModalInput.value = defaultValue || "";
  openModal(els.nameModal, els.nameModalInput);
  return new Promise((resolve) => {
    state.pendingPromptResolve = resolve;
  });
}

/* ================= Tabs ================= */

function switchView(view) {
  state.activeView = view;
  const isCatalog = view === "catalog";
  const isTierlist = view === "tierlist";
  const isPolmap = view === "polmap";

  els.viewCatalog.hidden = !isCatalog;
  els.viewTierlist.hidden = !isTierlist;
  els.viewPolmap.hidden = !isPolmap;

  els.tabCatalog.classList.toggle("is-active", isCatalog);
  els.tabTierlist.classList.toggle("is-active", isTierlist);
  els.tabPolmap.classList.toggle("is-active", isPolmap);

  els.searchWrap && els.searchWrap.classList.toggle("is-inactive", !isCatalog);
  document.body.classList.toggle("is-polmap-view", isPolmap);

  if (isPolmap) onPoliticalMapShow();
}

/* ================= Catalog render ================= */

function renderCatalog() {
  let players = state.players.filter((player) => player.name.toLowerCase().includes(state.query));

  players = players.slice().sort((a, b) => {
    if (state.sort === "alpha-desc") return b.name.localeCompare(a.name, "ru");
    return a.name.localeCompare(b.name, "ru");
  });

  disposeAllViewers();
  els.grid.innerHTML = players.map(playerCard).join("");

  const hasAnyPlayers = state.players.length > 0;
  const hasResults = players.length > 0;
  els.empty.hidden = hasResults;

  if (!hasResults) {
    if (hasAnyPlayers) {
      els.emptyTitle.textContent = "Ничего не найдено";
      els.emptyText.textContent = "Попробуй другой ник в поиске.";
      els.emptyAdd.hidden = true;
    } else {
      els.emptyTitle.textContent = "Игроков пока нет";
      els.emptyText.textContent = "Добавь первого участника Freakland Create через форму выше.";
      els.emptyAdd.hidden = !isAdmin();
    }
  }

  els.count.textContent = formatCount(players.length);

  els.grid.querySelectorAll(".player-card").forEach((card) => observer.observe(card));
  if (state.highlightPlayerId) {
    const highlighted = els.grid.querySelector(`.player-card[data-id="${state.highlightPlayerId}"]`);
    highlighted?.classList.add("is-highlighted");
  }
  els.grid.querySelectorAll("[data-action='edit']").forEach((button) => {
    button.addEventListener("click", () => editPlayer(button.dataset.id));
  });
  els.grid.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", () => deletePlayer(button.dataset.id));
  });
  els.grid.querySelectorAll("[data-action='toggle-3d']").forEach((button) => {
    button.addEventListener("click", () => toggle3D(button.dataset.id));
  });
  els.grid.querySelectorAll("[data-action='edit-role']").forEach((badge) => {
    badge.addEventListener("click", () => editPlayerRole(badge.dataset.id));
  });

  els.grid.querySelectorAll("[data-action='clear-role']").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = state.players.find((x) => x.id === b.dataset.id);
      if (p) {
        p.role = "";
        await savePlayers();
        renderCatalog();
      }
    }),
  );
  els.grid.querySelectorAll("[data-action='open-city']").forEach((button) => {
    button.addEventListener("click", () => openCityOnMap(button.dataset.cityId));
  });
  const sc = document.querySelector("#searchClone");
  if (sc && !sc.dataset.b) {
    sc.dataset.b = 1;
    sc.oninput = () => {
      els.search.value = sc.value;
      els.search.dispatchEvent(new Event("input"));
    };
  }
  refreshIcons();
}

function playerCard(player) {
  const roleText = player.role || "";
  const showRoleBadge = isAdmin() || Boolean(roleText);
  const roleBadge = showRoleBadge
    ? `<div class="role-badge-wrap"><span class="role-badge${isAdmin() ? " is-editable" : ""}${roleText ? "" : " is-empty"}" data-action="edit-role" data-id="${player.id}">${escapeHtml(roleText || "+ статус")}</span>${isAdmin() && roleText ? `<i class="role-delete" data-action="clear-role" data-id="${player.id}">✕</i>` : ""}</div>`
    : "";

  const socials = [
    player.telegram
      ? `<a class="social-link" href="${escapeAttr(player.telegram)}" target="_blank" rel="noreferrer" aria-label="Telegram ${escapeAttr(player.name)}"><i data-lucide="send" aria-hidden="true"></i></a>`
      : "",
    player.twitch
      ? `<a class="social-link is-twitch" href="${escapeAttr(player.twitch)}" target="_blank" rel="noreferrer" aria-label="Twitch ${escapeAttr(player.name)}"><i data-lucide="tv" aria-hidden="true"></i></a>`
      : "",
  ].join("");

  const adminButtons = isAdmin()
    ? `
      <div class="card-actions">
        <button class="secondary-button" type="button" data-action="edit" data-id="${player.id}">
          <i data-lucide="pencil" aria-hidden="true"></i>
          <span>Править</span>
        </button>
        <button class="secondary-button danger-button" type="button" data-action="delete" data-id="${player.id}">
          <i data-lucide="trash-2" aria-hidden="true"></i>
          <span>Удалить</span>
        </button>
      </div>`
    : "";

  const city = getEffectiveCityById(player.city);
  const cityBadge = city
    ? `<button class="city-badge" type="button" data-action="open-city" data-city-id="${city.id}" title="Открыть на полит. карте">
        <i data-lucide="map-pin" aria-hidden="true"></i>
        <span>${escapeHtml(city.name)}</span>
      </button>`
    : "";

  return `
    <article class="player-card${state.highlightPlayerId === player.id ? " is-highlighted" : ""}" data-id="${player.id}">
      <div class="skin-wrap" id="skinWrap-${player.id}">
        ${roleBadge}
        <img src="${escapeAttr(skinBodyUrl(player.name))}" alt="Скин игрока ${escapeAttr(player.name)}" loading="lazy" />
        <button class="skin-toggle" type="button" data-action="toggle-3d" data-id="${player.id}" aria-label="Показать в 3D">
          <i data-lucide="rotate-3d" aria-hidden="true"></i>
        </button>
        ${cityBadge}
      </div>
      <div class="card-body">
        <div class="card-main">
          <h3 class="player-name" title="${escapeAttr(player.name)}">${escapeHtml(player.name)}</h3>
          <div class="social-links">${socials}</div>
        </div>
        ${adminButtons}
      </div>
    </article>
  `;
}

function toggle3D(id) {
  const wrap = document.querySelector(`#skinWrap-${id}`);
  if (!wrap) return;
  const player = state.players.find((item) => item.id === id);
  if (!player) return;
  const button = wrap.querySelector(".skin-toggle");

  if (state.viewers.has(id)) {
    disposeViewer(id);
    wrap.querySelector("canvas")?.remove();
    const img = document.createElement("img");
    img.src = skinBodyUrl(player.name);
    img.alt = `Скин игрока ${player.name}`;
    img.loading = "lazy";
    wrap.prepend(img);
    button.classList.remove("is-active");
    return;
  }

  if (typeof skinview3d === "undefined") {
    alert("3D-просмотр ещё загружается, попробуй ещё раз через секунду.");
    return;
  }

  wrap.querySelector("img")?.remove();
  const canvas = document.createElement("canvas");
  wrap.prepend(canvas);

  const viewer = new skinview3d.SkinViewer({
    canvas,
    width: wrap.clientWidth || 230,
    height: wrap.clientHeight || 210,
    skin: skinTextureUrl(player.name),
  });
  viewer.autoRotate = true;
  viewer.autoRotateSpeed = 0.7;
  viewer.zoom = 0.9;
  state.viewers.set(id, viewer);
  button.classList.add("is-active");
}

function disposeViewer(id) {
  const viewer = state.viewers.get(id);
  if (viewer) {
    viewer.dispose();
    state.viewers.delete(id);
  }
}

function disposeAllViewers() {
  state.viewers.forEach((viewer) => viewer.dispose());
  state.viewers.clear();
}

function editPlayer(id) {
  if (!isAdmin()) return;
  const player = state.players.find((item) => item.id === id);
  if (!player) return;

  els.formTitle.textContent = "Редактировать игрока";
  els.editingId.value = player.id;
  els.name.value = player.name;
  els.telegram.value = player.telegram;
  els.twitch.value = player.twitch || "";
  els.city.innerHTML = getEffectiveCityOptionsHtml(player.city || "");
  els.city.value = player.city || "";
  updateSkinPreview();
  openForm();
  els.name.focus();
}

async function editPlayerRole(id) {
  if (!isAdmin()) return;
  const player = state.players.find((item) => item.id === id);
  if (!player) return;

  const value = await promptModal("Статус игрока (оставь поле пустым, чтобы убрать статус совсем)", player.role || "");
  if (value === null) return;

  const nextRole = value.trim();
  if (nextRole === (player.role || "")) return;

  player.role = nextRole;
  await savePlayers();
  renderCatalog();
  logAction(nextRole ? `Изменён статус игрока ${player.name}: ${nextRole}` : `Убран статус игрока ${player.name}`);
}

async function deletePlayer(id) {
  if (!isAdmin()) return;
  const player = state.players.find((item) => item.id === id);
  if (!player) return;

  const shouldDelete = confirm(`Удалить игрока ${player.name}?`);
  if (!shouldDelete) return;

  state.players = state.players.filter((item) => item.id !== id);
  await savePlayers();
  renderCatalog();
  syncTierlistWithPlayers();
  renderTierlist();
  logAction(`Удалён игрок: ${player.name}`);
}

function openForm() {
  if (!isAdmin()) return;
  els.formPanel.classList.add("is-open");
  els.formPanel.setAttribute("aria-hidden", "false");
}

function closeForm() {
  els.formPanel.classList.remove("is-open");
  els.formPanel.setAttribute("aria-hidden", "true");
}

function resetForm() {
  els.formTitle.textContent = "Добавить игрока";
  els.form.reset();
  els.editingId.value = "";
  els.city.innerHTML = getEffectiveCityOptionsHtml();
  els.skinPreview.hidden = true;
}

function updateSkinPreview() {
  const name = els.name.value.trim();
  if (!name) {
    els.skinPreview.hidden = true;
    return;
  }
  els.skinPreview.hidden = false;
  els.skinPreviewImg.src = skinBodyUrl(name);
  els.skinPreviewLabel.textContent = `Скин для ника «${name}»`;
}

function normalizeSocialUrl(value, domain) {
  if (!value) return value;
  if (value.startsWith("@")) return `https://${domain}/${value.slice(1)}`;
  if (!value.includes("://") && value.includes(domain)) return `https://${value}`;
  if (!value.includes("://") && !value.includes(".")) return `https://${domain}/${value}`;
  return value;
}

function formatCount(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} игрок`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} игрока`;
  return `${count} игроков`;
}

/* ================= Admins list render ================= */

async function renderAdminsList() {
  els.adminsList.innerHTML = `<li class="log-empty">Загрузка…</li>`;
  const q = query(collection(db, "users"), where("isAdmin", "==", true));
  const snap = await getDocs(q);
  const admins = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

  els.adminsList.innerHTML = admins
    .map(
      (admin) => `
      <li class="admin-row">
        <span>${escapeHtml(admin.nickname)}${admin.isMain ? '<span class="badge">гл. админ</span>' : ""}</span>
        ${admin.isMain ? "" : `<button type="button" data-uid="${escapeAttr(admin.uid)}" data-nickname="${escapeAttr(admin.nickname)}" aria-label="Удалить админа"><i data-lucide="trash-2" aria-hidden="true"></i></button>`}
      </li>`,
    )
    .join("");

  els.adminsList.querySelectorAll("button[data-uid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const uid = button.dataset.uid;
      const nickname = button.dataset.nickname;
      const shouldRemove = confirm(`Убрать права админа у ${nickname}?`);
      if (!shouldRemove) return;
      await updateDoc(doc(db, "users", uid), { isAdmin: false });
      logAction(`Убраны права админа: ${nickname}`);
      await renderAdminsList();
    });
  });

  refreshIcons();
}

/* ================= Admin action log (Firestore, видно только главному админу) ================= */

async function logAction(message) {
  if (!isAdmin()) return;
  try {
    await addDoc(collection(db, "logs"), {
      ts: Date.now(),
      login: state.user.nickname,
      message,
    });
  } catch (error) {
    console.error(error);
  }
}

function formatLogTime(ts) {
  try {
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

async function renderLogList() {
  els.logList.innerHTML = `<li class="log-empty">Загрузка…</li>`;
  const q = query(collection(db, "logs"), orderBy("ts", "desc"), limit(LOG_MAX_ENTRIES));
  const snap = await getDocs(q);
  const entries = snap.docs.map((d) => d.data());

  if (entries.length === 0) {
    els.logList.innerHTML = `<li class="log-empty">Лог пока пуст</li>`;
    return;
  }
  els.logList.innerHTML = entries
    .map(
      (entry) => `
      <li class="log-row">
        <div class="log-meta">
          <span>${escapeHtml(entry.login)}</span>
          <span>${escapeHtml(formatLogTime(entry.ts))}</span>
        </div>
        <div>${escapeHtml(entry.message)}</div>
      </li>`,
    )
    .join("");
}

/* ================= Tierlist (личное хранилище каждого пользователя) ================= */

function subscribeTierlists(uid) {
  if (unsubTierlists) unsubTierlists();
  unsubTierlists = onSnapshot(doc(db, "tierlists", uid), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    if (data && data.lists && Object.keys(data.lists).length > 0) {
      state.tierlists = data.lists;
      state.activeTierlist = data.active && state.tierlists[data.active] ? data.active : Object.keys(state.tierlists)[0];
    } else {
      state.tierlists = { Основной: { tiers: DEFAULT_TIER_TEMPLATE() } };
      state.activeTierlist = "Основной";
    }
    syncTierlistWithPlayers();
    renderTierlist();
  });
}

async function saveTierlistsToStorage() {
  if (!state.user) return;
  try {
    await setDoc(doc(db, "tierlists", state.user.uid), {
      lists: state.tierlists,
      active: state.activeTierlist,
    });
  } catch (error) {
    console.error(error);
    alert("Не получилось сохранить тирлист. Проверь подключение и попробуй снова.");
  }
}

function syncTierlistWithPlayers() {
  const validIds = new Set(state.players.map((player) => player.id));
  Object.values(state.tierlists).forEach((list) => {
    list.tiers.forEach((tier) => {
      tier.playerIds = tier.playerIds.filter((id) => validIds.has(id));
    });
  });
}

function getUnassignedPlayers(list) {
  const assigned = new Set(list.tiers.flatMap((tier) => tier.playerIds));
  return state.players.filter((player) => !assigned.has(player.id));
}

function renderTierlist() {
  if (!isLoggedIn()) return;
  syncTierlistWithPlayers();

  els.tierlistSelect.innerHTML = Object.keys(state.tierlists)
    .map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`)
    .join("");
  els.tierlistSelect.value = state.activeTierlist;

  const list = state.tierlists[state.activeTierlist];
  if (!list) return;

  els.tierRows.innerHTML = list.tiers
    .map(
      (tier) => `
      <div class="tier-row">
        <div class="tier-label" style="background:${escapeAttr(tier.color)}">
          <button type="button" class="tier-remove" data-tier-id="${tier.id}" data-action="remove-tier" aria-label="Удалить тир">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
          <div class="tier-name" contenteditable="true" spellcheck="false" data-tier-id="${tier.id}" data-field="name">${escapeHtml(tier.name)}</div>
          <input type="color" value="${escapeAttr(tier.color)}" data-tier-id="${tier.id}" data-field="color" />
        </div>
        <div class="tier-drop" data-tier-id="${tier.id}">
          ${tier.playerIds.map((id) => tierChip(id)).join("")}
        </div>
      </div>`,
    )
    .join("");

  els.tierPool.innerHTML = getUnassignedPlayers(list)
    .map((player) => tierChip(player.id))
    .join("");

  bindTierDragEvents();
  bindTierFieldEvents();
  refreshIcons();
}

async function exportTierlistAsImage() {
  if (!isLoggedIn()) return;
  if (typeof html2canvas === "undefined") {
    alert("Экспорт ещё загружается, попробуй ещё раз через секунду.");
    return;
  }

  const area = els.tierExportArea;
  els.tierExportTitle.textContent = state.activeTierlist || "Тирлист";
  area.classList.add("is-exporting");

  try {
    const canvas = await html2canvas(area, {
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff",
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      useCORS: true,
    });

    const link = document.createElement("a");
    const safeName = (state.activeTierlist || "tierlist").replace(/[^a-zA-Zа-яА-Я0-9_-]+/g, "_");
    link.download = `freakland-create-${safeName}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    console.error(error);
    alert("Не получилось экспортировать тирлист. Попробуй ещё раз.");
  } finally {
    area.classList.remove("is-exporting");
  }
}

function tierChip(playerId) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return "";
  return `
    <div class="tier-chip" draggable="true" data-player-id="${player.id}">
      <img src="https://mc-heads.net/avatar/${encodeURIComponent(player.name)}/26" alt="" loading="lazy" crossorigin="anonymous" />
      <span>${escapeHtml(player.name)}</span>
    </div>`;
}

/* ---------- Превью фото игрока при наведении в тирлисте ---------- */

// Фотки кладутся в assets/players/<имя игрока>.<расширение> — расширение и
// регистр имени заранее неизвестны, поэтому перебираем варианты и кэшируем результат.
const PLAYER_PHOTO_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];
const playerPhotoCache = new Map(); // player name -> url string | null (null = фото не найдено)
let tierPhotoHoveredId = null;
let tierPhotoRequestToken = 0;

async function findPlayerPhotoUrl(name) {
  if (playerPhotoCache.has(name)) return playerPhotoCache.get(name);
  for (const ext of PLAYER_PHOTO_EXTENSIONS) {
    const url = `assets/players/${encodeURIComponent(name)}.${ext}`;
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (ok) {
      playerPhotoCache.set(name, url);
      return url;
    }
  }
  playerPhotoCache.set(name, null);
  return null;
}

function setupTierPhotoPreview() {
  const container = els.viewTierlist;
  if (!container || !els.tierPhotoPreview || !els.tierPhotoPreviewImg) return;

  container.addEventListener("mouseover", (event) => {
    const chip = event.target.closest(".tier-chip");
    if (!chip || !container.contains(chip)) return;
    if (chip.dataset.playerId === tierPhotoHoveredId) return;
    tierPhotoHoveredId = chip.dataset.playerId;
    showTierPhotoPreview(chip);
  });

  container.addEventListener("mouseout", (event) => {
    const chip = event.target.closest(".tier-chip");
    if (!chip) return;
    const related = event.relatedTarget;
    if (related && chip.contains(related)) return;
    tierPhotoHoveredId = null;
    hideTierPhotoPreview();
  });

  window.addEventListener("scroll", hideTierPhotoPreview, true);
  window.addEventListener("resize", hideTierPhotoPreview);

  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "f" || event.ctrlKey || event.metaKey || event.altKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
    if (state.activeView !== "tierlist") return;

    state.tierPhotoPreviewEnabled = !state.tierPhotoPreviewEnabled;
    if (!state.tierPhotoPreviewEnabled) {
      hideTierPhotoPreview();
    } else if (tierPhotoHoveredId) {
      const chip = container.querySelector(`.tier-chip[data-player-id="${CSS.escape(tierPhotoHoveredId)}"]`);
      if (chip) showTierPhotoPreview(chip);
    }
  });
}

async function showTierPhotoPreview(chip) {
  if (!state.tierPhotoPreviewEnabled) return;
  const playerId = chip.dataset.playerId;
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;

  const token = ++tierPhotoRequestToken;
  const url = await findPlayerPhotoUrl(player.name);
  if (token !== tierPhotoRequestToken) return; // навели на другого игрока, пока грузилось
  if (tierPhotoHoveredId !== playerId) return;
  if (!url) {
    hideTierPhotoPreview();
    return;
  }

  els.tierPhotoPreviewImg.src = url;
  els.tierPhotoPreviewImg.alt = player.name;
  els.tierPhotoPreview.hidden = false;
  positionTierPhotoPreview(chip);
}

function hideTierPhotoPreview() {
  if (els.tierPhotoPreview) els.tierPhotoPreview.hidden = true;
}

function positionTierPhotoPreview(chip) {
  const preview = els.tierPhotoPreview;
  if (!preview) return;
  const margin = 10;
  const chipRect = chip.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();

  let top = chipRect.top - previewRect.height - margin;
  if (top < margin) {
    top = chipRect.bottom + margin;
  }
  let left = chipRect.left + chipRect.width / 2 - previewRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - previewRect.width - margin));

  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
}

function bindTierFieldEvents() {
  els.tierRows.querySelectorAll("[data-field='name']").forEach((nameEl) => {
    nameEl.addEventListener("blur", () => {
      const list = state.tierlists[state.activeTierlist];
      const tier = list.tiers.find((item) => item.id === nameEl.dataset.tierId);
      const value = nameEl.textContent.trim();
      if (tier) tier.name = value || tier.name;
      nameEl.textContent = tier ? tier.name : value;
    });
    nameEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        nameEl.blur();
      }
    });
  });

  els.tierRows.querySelectorAll("[data-field='color']").forEach((input) => {
    input.addEventListener("input", () => {
      const list = state.tierlists[state.activeTierlist];
      const tier = list.tiers.find((item) => item.id === input.dataset.tierId);
      if (tier) {
        tier.color = input.value;
        input.closest(".tier-label").style.background = input.value;
      }
    });
  });

  els.tierRows.querySelectorAll("[data-action='remove-tier']").forEach((button) => {
    button.addEventListener("click", () => {
      const list = state.tierlists[state.activeTierlist];
      if (list.tiers.length <= 1) {
        alert("Должен остаться хотя бы один тир");
        return;
      }
      const shouldRemove = confirm("Удалить этот тир? Игроки из него вернутся в общий пул.");
      if (!shouldRemove) return;
      list.tiers = list.tiers.filter((item) => item.id !== button.dataset.tierId);
      renderTierlist();
    });
  });
}

function bindTierDragEvents() {
  const chips = document.querySelectorAll(".tier-chip");
  chips.forEach((chip) => {
    chip.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", chip.dataset.playerId);
      chip.classList.add("is-dragging");
      startAutoScroll();
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("is-dragging");
      stopAutoScroll();
    });
  });

  const dropzones = [...document.querySelectorAll(".tier-drop"), els.tierPool];
  dropzones.forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragover");
      const playerId = event.dataTransfer.getData("text/plain");
      if (!playerId) return;

      const list = state.tierlists[state.activeTierlist];
      list.tiers.forEach((tier) => {
        tier.playerIds = tier.playerIds.filter((id) => id !== playerId);
      });

      const targetTierId = zone.dataset.tierId;
      if (targetTierId) {
        const tier = list.tiers.find((item) => item.id === targetTierId);
        if (tier && !tier.playerIds.includes(playerId)) tier.playerIds.push(playerId);
      }
      // if dropped on pool, it simply stays unassigned since we removed it above

      renderTierlist();
    });
  });
}

/* ================= Auto-scroll while dragging ================= */

let autoScrollFrame = null;
let lastDragClientY = null;
const AUTOSCROLL_EDGE = 110;
const AUTOSCROLL_MAX_SPEED = 22;

document.addEventListener("dragover", (event) => {
  lastDragClientY = event.clientY;
});

function startAutoScroll() {
  if (autoScrollFrame) return;
  const step = () => {
    if (lastDragClientY !== null) {
      const viewportHeight = window.innerHeight;
      let speed = 0;

      if (lastDragClientY < AUTOSCROLL_EDGE) {
        const strength = (AUTOSCROLL_EDGE - lastDragClientY) / AUTOSCROLL_EDGE;
        speed = -strength * AUTOSCROLL_MAX_SPEED;
      } else if (lastDragClientY > viewportHeight - AUTOSCROLL_EDGE) {
        const strength = (lastDragClientY - (viewportHeight - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE;
        speed = strength * AUTOSCROLL_MAX_SPEED;
      }

      if (speed !== 0) window.scrollBy(0, speed);
    }
    autoScrollFrame = requestAnimationFrame(step);
  };
  autoScrollFrame = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollFrame) {
    cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
  }
  lastDragClientY = null;
}

/* ================= Theme ================= */

function applyInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  els.root.dataset.theme = saved || (prefersDark ? "dark" : "light");
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = els.root.dataset.theme === "dark" ? "sun" : "moon";
  els.themeToggle.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
  refreshIcons();
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/* ================= Escaping ================= */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

function escapeAttr(value) {
  return escapeHtml(String(value));
}