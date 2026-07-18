import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
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
  runTransaction,
  increment,
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

// Создаём новый аккаунт через отдельный (второй) экземпляр Firebase App —
// иначе createUserWithEmailAndPassword переключил бы текущую сессию главного
// админа на новый аккаунт. Через секунду после создания второй инстанс удаляется.
async function createAdminAccount(nickname, password, permissions) {
  const secondaryApp = initializeApp(firebaseConfig, `admin-create-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, nicknameToEmail(nickname), password);
    const nicknameLower = nickname.trim().toLowerCase();
    await setDoc(doc(db, "users", cred.user.uid), {
      nickname: nickname.trim(),
      nicknameLower,
      isAdmin: true,
      isMain: false,
      permissions,
      createdAt: Date.now(),
    });
    await signOut(secondaryAuth);
  } finally {
    await deleteApp(secondaryApp);
  }
}

/* ================= Local-only storage ================= */
const THEME_KEY = "freakland-create-theme";
const LOG_MAX_ENTRIES = 300;
const DEFAULT_ROLE = "Игрок";

/* ================= Voting (кто вызывает больше эмоций) ================= */
const VOTE_PERIOD_MS = 3 * 60 * 60 * 1000; // раунд голосования — каждые 3 часа "мирового времени"
const VOTE_ROUND_SIZE = 10;
const VOTE_PICK_SIZE = 3; // сколько любимых нужно выбрать — строго 3
const VOTE_MIN_UNFAV = 1; // сколько нелюбимых нужно минимум — 1, можно больше
const VOTE_LOCAL_KEY = "freakland-vote-round"; // на каком раунде это устройство уже проголосовало
const ADMIN_ROLE_TEXT = "админ";

function isAdminRoleText(role) {
  return (role || "").trim().toLowerCase() === ADMIN_ROLE_TEXT;
}

function shuffleArray(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
  adminAddMode: "existing",
  polmapMainData: { elements: [], markers: [] },
  polmapBoards: [],
  polmapActiveBoardId: "main",
  polmapCityOverrides: {},
  tierPhotoPreviewEnabled: true,
  voting: { roundStartAt: null, playerIds: [], usedPool: [], favScores: {}, unfavScores: {} },
  votingSelection: { favorites: [], unfavorites: [] },
  votingHistory: [],
};

let unsubVotingHistory = null;

let unsubTierlists = null;
let unsubActiveBoard = null;
let iconsRafId = null;

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
  adminAddTabs: document.querySelector("#adminAddTabs"),
  addAdminForm: document.querySelector("#addAdminForm"),
  newAdminName: document.querySelector("#newAdminName"),
  newAdminNameLabel: document.querySelector("#newAdminNameLabel"),
  newAdminPasswordField: document.querySelector("#newAdminPasswordField"),
  newAdminPassword: document.querySelector("#newAdminPassword"),
  addAdminSubmitLabel: document.querySelector("#addAdminSubmitLabel"),
  addAdminError: document.querySelector("#addAdminError"),
  permPlayers: document.querySelector("#permPlayers"),
  permMap: document.querySelector("#permMap"),
  permVoting: document.querySelector("#permVoting"),

  votingInfoButton: document.querySelector("#votingInfoButton"),
  votingInfoModal: document.querySelector("#votingInfoModalBackdrop"),
  closeVotingInfoModal: document.querySelector("#closeVotingInfoModal"),

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

  votingBar: document.querySelector("#votingBar"),
  votingTitle: document.querySelector("#votingTitle"),
  votingHint: document.querySelector("#votingHint"),
  votingHeads: document.querySelector("#votingHeads"),
  votingSubmitButton: document.querySelector("#votingSubmitButton"),
  votingSkipButton: document.querySelector("#votingSkipButton"),

  tabCatalog: document.querySelector("#tabCatalog"),
  tabTierlist: document.querySelector("#tabTierlist"),
  tabPolmap: document.querySelector("#tabPolmap"),
  tabVoting: document.querySelector("#tabVoting"),
  viewCatalog: document.querySelector("#viewCatalog"),
  viewTierlist: document.querySelector("#viewTierlist"),
  viewPolmap: document.querySelector("#viewPolmap"),
  viewVoting: document.querySelector("#viewVoting"),

  votingCountdown: document.querySelector("#votingCountdown"),
  forceVotingRoundButton: document.querySelector("#forceVotingRoundButton"),
  votingAdminGrid: document.querySelector("#votingAdminGrid"),

  votingStatsModal: document.querySelector("#votingStatsModalBackdrop"),
  closeVotingStatsModal: document.querySelector("#closeVotingStatsModal"),
  votingStatsModalTitle: document.querySelector("#votingStatsModalTitle"),
  votingStatsSummary: document.querySelector("#votingStatsSummary"),
  votingStatsChart: document.querySelector("#votingStatsChart"),

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
  polmapExportButton: document.querySelector("#polmapExportButton"),
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
    ensureVotingRound();
    renderVotingWidget();
  });

  // Голосование "кто вызывает больше эмоций" — публичное чтение, раунд общий для всех
  onSnapshot(doc(db, "catalog", "voting"), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    state.voting = {
      roundStartAt: typeof data?.roundStartAt === "number" ? data.roundStartAt : null,
      playerIds: Array.isArray(data?.playerIds) ? data.playerIds : [],
      usedPool: Array.isArray(data?.usedPool) ? data.usedPool : [],
      favScores: data && typeof data.favScores === "object" && data.favScores ? data.favScores : {},
      unfavScores: data && typeof data.unfavScores === "object" && data.unfavScores ? data.unfavScores : {},
    };
    renderVotingWidget();
    renderCatalog();
    updateVotingCountdown();
    if (state.activeView === "voting") renderVotingAdminGrid();
  });
  updateVotingCountdown();
  setInterval(updateVotingCountdown, 1000);
  setInterval(ensureVotingRound, 60 * 1000);

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
    const rawOverrides = snap.exists() && snap.data().overrides ? snap.data().overrides : {};
    state.polmapCityOverrides = deserializeCityOverrides(rawOverrides);
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
      if (unsubVotingHistory) {
        unsubVotingHistory();
        unsubVotingHistory = null;
      }
      state.tierlists = {};
      state.activeTierlist = "";
      state.votingHistory = [];
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
    state.user = {
      uid: fbUser.uid,
      nickname: data.nickname,
      isAdmin: Boolean(data.isAdmin),
      isMain: Boolean(data.isMain),
      permissions: data.permissions || null,
    };
    subscribeTierlists(fbUser.uid);
    subscribeVotingHistory();
    updateAuthUI();
    renderCatalog();
    renderTierlist();
  });
}

// История баллов голосования (снимки при каждой смене раунда) — только для админов,
// нужна для графиков "как менялась популярность игрока" на вкладке "Голосование".
function subscribeVotingHistory() {
  if (unsubVotingHistory) {
    unsubVotingHistory();
    unsubVotingHistory = null;
  }
  if (!canManageVoting()) return;
  const q = query(collection(db, "votingHistory"), orderBy("timestamp", "asc"), limit(500));
  unsubVotingHistory = onSnapshot(
    q,
    (snap) => {
      state.votingHistory = snap.docs.map((d) => d.data());
      if (state.activeView === "voting") renderVotingAdminGrid();
    },
    (error) => console.error("Не получилось загрузить историю голосования", error),
  );
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
      exportButton: els.polmapExportButton,
    },
    getPlayers: () => state.players,
    onPlayerOpen: (playerId) => openPlayerFromMap(playerId),
    saveBoardData: savePoliticalMapBoardData,
    createBoard: createPoliticalMapBoard,
    deleteBoard: deletePoliticalMapBoard,
    saveCityOverride: savePoliticalMapCityOverride,
    onBoardChange: switchPoliticalMapBoard,
    refreshIcons,
    canEdit: canManageMap(),
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
  if (!canManageMap()) return;
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
  if (!canManageMap()) return null;
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
  if (!canManageMap() || boardId === MAIN_BOARD_ID) return;
  try {
    await deleteDoc(doc(db, "politicalMapBoards", boardId));
  } catch (error) {
    console.error(error);
    alert("Не получилось удалить карту.");
  }
}

async function savePoliticalMapCityOverride(cityId, patch) {
  if (!canManageMap()) return;
  const next = { ...state.polmapCityOverrides };
  if (patch) {
    // Убираем поля со значением undefined — Firestore не принимает undefined в документе.
    const clean = {};
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined) clean[key] = value;
    });
    next[cityId] = clean;
  } else {
    delete next[cityId];
  }
  try {
    await setDoc(doc(db, "catalog", "politicalMapCityMeta"), { overrides: serializeCityOverrides(next) });
  } catch (error) {
    console.error(error);
    alert("Не получилось сохранить изменения города.");
  }
}

// Firestore не поддерживает массивы-в-массивах (nested arrays), а region — это
// список точек контура вида [[x,y],[x,y],...]. Поэтому при сохранении превращаем
// каждую точку в объект {x, y}, а при чтении — обратно в пару [x, y].
function serializeCityOverrides(overrides) {
  const result = {};
  Object.entries(overrides || {}).forEach(([cityId, patch]) => {
    result[cityId] = {
      ...patch,
      region: Array.isArray(patch.region) ? patch.region.map(([x, y]) => ({ x, y })) : patch.region,
    };
  });
  return result;
}

function deserializeCityOverrides(overrides) {
  const result = {};
  Object.entries(overrides || {}).forEach(([cityId, patch]) => {
    const region = Array.isArray(patch.region)
      ? patch.region.map((point) => (Array.isArray(point) ? [point[0], point[1]] : [point.x, point.y]))
      : patch.region;
    result[cityId] = { ...patch, region };
  });
  return result;
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

// Права обычного админа: главный админ (isMain) может всё всегда.
// У остальных — то, что включил главный при выдаче прав (permissions),
// а если поля вообще нет (старые админы, выданные до этой фичи) — считаем, что можно всё,
// чтобы никому ничего не обрезало задним числом.
function hasPermission(key) {
  if (!state.user || !state.user.isAdmin) return false;
  if (state.user.isMain) return true;
  const perms = state.user.permissions;
  if (!perms || typeof perms[key] === "undefined") return true;
  return Boolean(perms[key]);
}

function canManagePlayers() {
  return hasPermission("players");
}

function canManageMap() {
  return hasPermission("map");
}

function canManageVoting() {
  return hasPermission("voting");
}

function updateAuthUI() {
  const loggedIn = isLoggedIn();
  const admin = isAdmin();

  document.querySelectorAll(".admin-only").forEach((node) => {
    node.hidden = !admin;
  });

  // Точечные права поверх общего admin-only — обычный админ может не иметь доступа
  // к какому-то конкретному разделу, если главный админ это отключил.
  if (els.openForm) els.openForm.hidden = !canManagePlayers();
  if (els.tabVoting) els.tabVoting.hidden = !canManageVoting();

  if (!canManageVoting() && state.activeView === "voting") {
    switchView("catalog");
  } else if (canManageVoting() && state.activeView === "voting") {
    renderVotingAdminGrid();
  }

  els.loginButton.hidden = loggedIn;
  els.logoutButton.hidden = !loggedIn;
  els.openAdmins.hidden = !isMainAdmin();
  els.openLogButton.hidden = !isMainAdmin();

  if (els.tierlistLoginRequired) els.tierlistLoginRequired.hidden = loggedIn;
  if (els.tierlistToolbar) els.tierlistToolbar.hidden = !loggedIn;
  if (els.tierExportArea) els.tierExportArea.hidden = !loggedIn;
  if (els.tierPoolWrap) els.tierPoolWrap.hidden = !loggedIn;

  setPoliticalMapCanEdit(canManageMap());

  let ratingOption = els.sortSelect ? els.sortSelect.querySelector('option[value="rating-desc"]') : null;
  if (els.sortSelect) {
    if (admin && !ratingOption) {
      ratingOption = document.createElement("option");
      ratingOption.value = "rating-desc";
      ratingOption.textContent = "По баллам голосования (админ)";
      els.sortSelect.appendChild(ratingOption);
    } else if (!admin && ratingOption) {
      ratingOption.remove();
      if (state.sort === "rating-desc") {
        state.sort = "alpha-asc";
        els.sortSelect.value = "alpha-asc";
      }
    }
  }

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

function skinHeadUrl(name) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(name || "Steve")}/64`;
}

/* ================= Voting (кто вызывает больше эмоций) ================= */

// Раунд считается по "мировому" времени от момента старта раунда (roundStartAt),
// который лежит в общем документе Firestore — поэтому у всех посетителей один и тот
// же раунд, и он не пересоздаётся при перезаходе на сайт.
async function ensureVotingRound(force = false) {
  const now = Date.now();
  if (!force) {
    if (state.voting.roundStartAt && now < state.voting.roundStartAt + VOTE_PERIOD_MS) return;
  } else if (!canManageVoting()) {
    return;
  }
  if (!state.players.length) return;

  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "catalog", "voting");
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const currentStart = typeof data.roundStartAt === "number" ? data.roundStartAt : 0;

      if (!force && currentStart && Date.now() < currentStart + VOTE_PERIOD_MS) return; // кто-то уже обновил раунд

      const eligible = state.players.filter((player) => !isAdminRoleText(player.role));
      let usedPool = Array.isArray(data.usedPool)
        ? data.usedPool.filter((id) => eligible.some((player) => player.id === id))
        : [];

      let candidates = eligible.filter((player) => !usedPool.includes(player.id));
      if (candidates.length === 0) {
        // Пул закончился — начинаем новый круг, но стараемся не повторять
        // прошлый раунд сразу же (только если игроков достаточно для этого).
        usedPool = [];
        const previousRoundIds = Array.isArray(data.playerIds) ? data.playerIds : [];
        const withoutPrevious = eligible.filter((player) => !previousRoundIds.includes(player.id));
        candidates = withoutPrevious.length >= Math.min(VOTE_ROUND_SIZE, eligible.length) ? withoutPrevious : eligible.slice();
      }

      const count = Math.min(VOTE_ROUND_SIZE, candidates.length);
      const selected = shuffleArray(candidates)
        .slice(0, count)
        .map((player) => player.id);
      const newUsedPool = [...usedPool, ...selected];

      const favScores = data.favScores && typeof data.favScores === "object" ? data.favScores : {};
      const unfavScores = data.unfavScores && typeof data.unfavScores === "object" ? data.unfavScores : {};

      // Снимок баллов на момент смены раунда — нужен для графика "как менялась популярность" у админов.
      if (snap.exists() && currentStart) {
        const histRef = doc(collection(db, "votingHistory"));
        tx.set(histRef, {
          timestamp: now,
          favScores,
          unfavScores,
        });
      }

      tx.set(ref, {
        roundStartAt: now,
        playerIds: selected,
        usedPool: newUsedPool,
        favScores,
        unfavScores,
      });
    });
  } catch (error) {
    console.error("Не получилось обновить раунд голосования", error);
  }
}

async function forceNewVotingRound() {
  if (!canManageVoting() || !els.forceVotingRoundButton) return;
  const ok = confirm("Начать новое голосование прямо сейчас? Текущая десятка сменится немедленно.");
  if (!ok) return;

  els.forceVotingRoundButton.disabled = true;
  try {
    await ensureVotingRound(true);
    logAction("Запущено внеочередное голосование (без таймера)");
  } finally {
    els.forceVotingRoundButton.disabled = false;
  }
}

function updateVotingCountdown() {
  if (!els.votingCountdown) return;
  const start = state.voting.roundStartAt;
  if (!start) {
    els.votingCountdown.textContent = "—";
    return;
  }
  const remaining = Math.max(0, start + VOTE_PERIOD_MS - Date.now());
  const totalSec = Math.floor(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  els.votingCountdown.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function hasVotedThisRound() {
  const votedRound = Number(localStorage.getItem(VOTE_LOCAL_KEY));
  return Number.isFinite(votedRound) && state.voting.roundStartAt !== null && votedRound === state.voting.roundStartAt;
}

function renderVotingWidget() {
  if (!els.votingBar) return;

  const playerIds = state.voting.playerIds || [];
  const players = playerIds.map((id) => state.players.find((player) => player.id === id)).filter(Boolean);

  if (!players.length || state.voting.roundStartAt === null || hasVotedThisRound()) {
    els.votingBar.hidden = true;
    return;
  }

  els.votingBar.hidden = false;

  const sel = state.votingSelection;
  if (sel.favorites.length < VOTE_PICK_SIZE) {
    els.votingTitle.textContent = "Выбери 3 самых любимых";
  } else if (sel.unfavorites.length < VOTE_MIN_UNFAV) {
    els.votingTitle.textContent = "Теперь выбери хотя бы 1 самого нелюбимого";
  } else {
    els.votingTitle.textContent = "Готово — жми «Отправить»";
  }
  els.votingHint.textContent = `Любимые: ${sel.favorites.length}/${VOTE_PICK_SIZE} · Нелюбимые: ${sel.unfavorites.length} (мин. ${VOTE_MIN_UNFAV})`;

  els.votingHeads.innerHTML = players.map(votingHeadHtml).join("");
  els.votingHeads.querySelectorAll("[data-action='voting-head']").forEach((el) => {
    el.addEventListener("click", () => handleVotingHeadClick(el.dataset.id));
  });

  els.votingSubmitButton.disabled = !(sel.favorites.length === VOTE_PICK_SIZE && sel.unfavorites.length >= VOTE_MIN_UNFAV);

  refreshIcons();
}

function votingHeadHtml(player) {
  const sel = state.votingSelection;
  let stateClass = "";
  if (sel.favorites.includes(player.id)) stateClass = " is-fav";
  else if (sel.unfavorites.includes(player.id)) stateClass = " is-unfav";

  return `
    <button class="voting-head${stateClass}" type="button" data-action="voting-head" data-id="${player.id}">
      <span class="voting-head-avatar"><img src="${escapeAttr(skinHeadUrl(player.name))}" alt="" loading="lazy" /></span>
      <span class="voting-head-name">${escapeHtml(player.name)}</span>
    </button>`;
}

function handleVotingHeadClick(id) {
  const sel = state.votingSelection;
  if (sel.favorites.includes(id)) {
    sel.favorites = sel.favorites.filter((x) => x !== id);
  } else if (sel.unfavorites.includes(id)) {
    sel.unfavorites = sel.unfavorites.filter((x) => x !== id);
  } else if (sel.favorites.length < VOTE_PICK_SIZE) {
    sel.favorites.push(id);
  } else {
    sel.unfavorites.push(id);
  }
  renderVotingWidget();
}

async function submitVote() {
  const sel = state.votingSelection;
  if (sel.favorites.length !== VOTE_PICK_SIZE || sel.unfavorites.length < VOTE_MIN_UNFAV) return;
  const roundStartAt = state.voting.roundStartAt;
  if (roundStartAt === null) return;

  els.votingSubmitButton.disabled = true;
  const patch = {};
  sel.favorites.forEach((id) => {
    patch[`favScores.${id}`] = increment(1);
  });
  sel.unfavorites.forEach((id) => {
    patch[`unfavScores.${id}`] = increment(1);
  });

  try {
    await updateDoc(doc(db, "catalog", "voting"), patch);
    localStorage.setItem(VOTE_LOCAL_KEY, String(roundStartAt));
    state.votingSelection = { favorites: [], unfavorites: [] };
    renderVotingWidget();
  } catch (error) {
    console.error(error);
    alert("Не получилось отправить голос. Попробуй ещё раз.");
    els.votingSubmitButton.disabled = false;
  }
}

// Для тех, кто не хочет оценивать в этом раунде — просто прячем виджет
// до следующей смены раунда, без отправки голосов.
function skipVote() {
  const roundStartAt = state.voting.roundStartAt;
  if (roundStartAt === null) return;
  localStorage.setItem(VOTE_LOCAL_KEY, String(roundStartAt));
  state.votingSelection = { favorites: [], unfavorites: [] };
  renderVotingWidget();
}

/* ================= Voting admin tab ================= */

function renderVotingAdminGrid() {
  if (!els.votingAdminGrid || !canManageVoting()) return;

  const players = state.players.slice().sort((a, b) => {
    const totalA = ((state.voting.favScores || {})[a.id] || 0) + ((state.voting.unfavScores || {})[a.id] || 0);
    const totalB = ((state.voting.favScores || {})[b.id] || 0) + ((state.voting.unfavScores || {})[b.id] || 0);
    if (totalB !== totalA) return totalB - totalA;
    return a.name.localeCompare(b.name, "ru");
  });

  els.votingAdminGrid.innerHTML = players.length
    ? players.map(votingAdminCardHtml).join("")
    : `<p class="voting-admin-empty">В каталоге пока нет игроков.</p>`;

  els.votingAdminGrid.querySelectorAll("[data-action='voting-open-stats']").forEach((el) => {
    el.addEventListener("click", () => openVotingStatsModal(el.dataset.id));
  });

  refreshIcons();
}

function votingAdminCardHtml(player) {
  const fav = (state.voting.favScores || {})[player.id] || 0;
  const unfav = (state.voting.unfavScores || {})[player.id] || 0;
  return `
    <button class="voting-admin-card" type="button" data-action="voting-open-stats" data-id="${player.id}">
      <span class="voting-admin-avatar"><img src="${escapeAttr(skinHeadUrl(player.name))}" alt="" loading="lazy" /></span>
      <span class="voting-admin-name" title="${escapeAttr(player.name)}">${escapeHtml(player.name)}</span>
      <span class="voting-admin-counts">
        <span class="count-fav"><i data-lucide="heart" aria-hidden="true"></i>${fav}</span>
        <span class="count-unfav"><i data-lucide="heart-crack" aria-hidden="true"></i>${unfav}</span>
      </span>
    </button>`;
}

function openVotingStatsModal(playerId) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player || !els.votingStatsModal) return;

  const fav = (state.voting.favScores || {})[playerId] || 0;
  const unfav = (state.voting.unfavScores || {})[playerId] || 0;

  els.votingStatsModalTitle.textContent = player.name;
  els.votingStatsSummary.innerHTML = `
    <div class="voting-stats-stat"><span class="count-fav"><i data-lucide="heart" aria-hidden="true"></i> ${fav}</span><small>любимый</small></div>
    <div class="voting-stats-stat"><span class="count-unfav"><i data-lucide="heart-crack" aria-hidden="true"></i> ${unfav}</span><small>нелюбимый</small></div>
  `;
  els.votingStatsChart.innerHTML = buildVotingChartSvg(playerId);

  openModal(els.votingStatsModal);
  refreshIcons();
}

function buildVotingChartSvg(playerId) {
  const points = [
    ...state.votingHistory,
    { timestamp: Date.now(), favScores: state.voting.favScores || {}, unfavScores: state.voting.unfavScores || {} },
  ];

  const series = points.map((entry) => ({
    t: entry.timestamp,
    fav: (entry.favScores || {})[playerId] || 0,
    unfav: (entry.unfavScores || {})[playerId] || 0,
  }));

  if (series.length < 2) {
    return `<p class="voting-chart-empty">Пока недостаточно данных для графика — точка появится после первой смены раунда.</p>`;
  }

  const width = 640;
  const height = 220;
  const padL = 30;
  const padR = 12;
  const padT = 16;
  const padB = 26;
  const minT = series[0].t;
  const maxT = series[series.length - 1].t;
  const maxVal = Math.max(1, ...series.map((p) => Math.max(p.fav, p.unfav)));

  const x = (t) => padL + ((t - minT) / Math.max(1, maxT - minT)) * (width - padL - padR);
  const y = (v) => height - padB - (v / maxVal) * (height - padT - padB);

  const favPath = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.fav).toFixed(1)}`).join(" ");
  const unfavPath = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.unfav).toFixed(1)}`).join(" ");

  const fmt = (t) => new Date(t).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const gridLines = [0, 0.5, 1]
    .map((f) => {
      const val = Math.round(maxVal * f);
      const yy = y(val);
      return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${width - padR}" y2="${yy.toFixed(1)}" class="voting-chart-grid" /><text x="${padL - 6}" y="${(yy + 3).toFixed(1)}" class="voting-chart-axis-label" text-anchor="end">${val}</text>`;
    })
    .join("");

  return `
    <svg class="voting-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="График голосов">
      ${gridLines}
      <text x="${padL}" y="${height - 6}" class="voting-chart-axis-label">${fmt(minT)}</text>
      <text x="${width - padR}" y="${height - 6}" class="voting-chart-axis-label" text-anchor="end">${fmt(maxT)}</text>
      <path d="${favPath}" class="voting-chart-line voting-chart-line-fav" fill="none" />
      <path d="${unfavPath}" class="voting-chart-line voting-chart-line-unfav" fill="none" />
    </svg>`;
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

  if (els.votingSubmitButton) {
    els.votingSubmitButton.addEventListener("click", submitVote);
  }
  if (els.votingSkipButton) {
    els.votingSkipButton.addEventListener("click", skipVote);
  }
  els.votingInfoButton?.addEventListener("click", () => openModal(els.votingInfoModal));
  els.closeVotingInfoModal?.addEventListener("click", () => closeModal(els.votingInfoModal));

  els.themeToggle.addEventListener("click", () => {
    const nextTheme = els.root.dataset.theme === "dark" ? "light" : "dark";
    els.root.dataset.theme = nextTheme;
    localStorage.setItem(THEME_KEY, nextTheme);
    updateThemeIcon();
  });

  els.name.addEventListener("input", updateSkinPreview);

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canManagePlayers()) return;

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
    setAdminAddMode("existing");
    openModal(els.adminsModal, els.newAdminName);
  });
  els.closeAdminsModal.addEventListener("click", () => closeModal(els.adminsModal));

  els.adminAddTabs?.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setAdminAddMode(button.dataset.mode));
  });

  els.addAdminForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isMainAdmin()) return;
    const nickname = els.newAdminName.value.trim();
    if (!nickname) return;

    els.addAdminError.hidden = true;
    const nicknameLower = nickname.toLowerCase();
    const permissions = {
      players: Boolean(els.permPlayers?.checked),
      map: Boolean(els.permMap?.checked),
      voting: Boolean(els.permVoting?.checked),
    };

    if (state.adminAddMode === "new") {
      const password = els.newAdminPassword.value;
      if (!password || password.length < 6) {
        els.addAdminError.textContent = "Пароль должен быть от 6 символов";
        els.addAdminError.hidden = false;
        return;
      }
      try {
        const q = query(collection(db, "users"), where("nicknameLower", "==", nicknameLower));
        const snap = await getDocs(q);
        if (!snap.empty) {
          els.addAdminError.textContent = "Такой ник уже занят";
          els.addAdminError.hidden = false;
          return;
        }
        await createAdminAccount(nickname, password, permissions);
        els.addAdminForm.reset();
        await renderAdminsList();
        logAction(`Создан новый админ: ${nickname}`);
      } catch (error) {
        console.error(error);
        els.addAdminError.textContent =
          error.code === "auth/weak-password" ? "Пароль слишком простой" : "Не получилось создать аккаунт";
        els.addAdminError.hidden = false;
      }
      return;
    }

    try {
      const q = query(collection(db, "users"), where("nicknameLower", "==", nicknameLower));
      const snap = await getDocs(q);
      if (snap.empty || snap.docs[0].data().isAdmin) {
        els.addAdminError.textContent = snap.empty ? "Такого игрока нет — он ещё не регистрировался" : "Этот игрок уже админ";
        els.addAdminError.hidden = false;
        return;
      }
      const userDoc = snap.docs[0];
      await updateDoc(doc(db, "users", userDoc.id), { isAdmin: true, permissions });
      els.addAdminForm.reset();
      await renderAdminsList();
      logAction(`Выдан админ: ${userDoc.data().nickname}`);
    } catch (error) {
      console.error(error);
      els.addAdminError.textContent = "Что-то пошло не так, попробуй ещё раз";
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
  els.tabVoting?.addEventListener("click", () => switchView("voting"));

  els.forceVotingRoundButton?.addEventListener("click", forceNewVotingRound);
  els.closeVotingStatsModal?.addEventListener("click", () => closeModal(els.votingStatsModal));

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
  [els.loginModal, els.adminsModal, els.logModal, els.nameModal, els.votingStatsModal, els.votingInfoModal].forEach((modal) => {
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    [els.loginModal, els.adminsModal, els.logModal, els.nameModal, els.votingStatsModal, els.votingInfoModal].forEach((modal) => {
      if (modal && !modal.hidden) closeModal(modal);
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
  if (view === "voting" && !canManageVoting()) view = "catalog";
  state.activeView = view;
  const isCatalog = view === "catalog";
  const isTierlist = view === "tierlist";
  const isPolmap = view === "polmap";
  const isVoting = view === "voting";

  els.viewCatalog.hidden = !isCatalog;
  els.viewTierlist.hidden = !isTierlist;
  els.viewPolmap.hidden = !isPolmap;
  if (els.viewVoting) els.viewVoting.hidden = !isVoting;

  els.tabCatalog.classList.toggle("is-active", isCatalog);
  els.tabTierlist.classList.toggle("is-active", isTierlist);
  els.tabPolmap.classList.toggle("is-active", isPolmap);
  els.tabVoting?.classList.toggle("is-active", isVoting);

  els.searchWrap && els.searchWrap.classList.toggle("is-inactive", !isCatalog);
  document.body.classList.toggle("is-polmap-view", isPolmap);

  if (isPolmap) onPoliticalMapShow();
  if (isVoting) renderVotingAdminGrid();
}

/* ================= Catalog render ================= */

function renderCatalog() {
  let players = state.players.filter((player) => player.name.toLowerCase().includes(state.query));

  players = players.slice().sort((a, b) => {
    if (state.sort === "rating-desc") {
      const scoreA = ((state.voting.favScores || {})[a.id] || 0) + ((state.voting.unfavScores || {})[a.id] || 0);
      const scoreB = ((state.voting.favScores || {})[b.id] || 0) + ((state.voting.unfavScores || {})[b.id] || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.name.localeCompare(b.name, "ru");
    }
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
      els.emptyAdd.hidden = !canManagePlayers();
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
  const canEditPlayers = canManagePlayers();
  const showRoleBadge = canEditPlayers || Boolean(roleText);
  const roleBadge = showRoleBadge
    ? `<div class="role-badge-wrap"><span class="role-badge${canEditPlayers ? " is-editable" : ""}${roleText ? "" : " is-empty"}" data-action="edit-role" data-id="${player.id}">${escapeHtml(roleText || "+ статус")}</span>${canEditPlayers && roleText ? `<i class="role-delete" data-action="clear-role" data-id="${player.id}">✕</i>` : ""}</div>`
    : "";

  const voteScore = ((state.voting.favScores || {})[player.id] || 0) + ((state.voting.unfavScores || {})[player.id] || 0);
  const scoreBadge = isAdmin()
    ? `<span class="vote-score-badge" title="Баллы голосования (видно только админам)"><i data-lucide="flame" aria-hidden="true"></i>${voteScore}</span>`
    : "";

  const socials = [
    player.telegram
      ? `<a class="social-link" href="${escapeAttr(player.telegram)}" target="_blank" rel="noreferrer" aria-label="Telegram ${escapeAttr(player.name)}"><i data-lucide="send" aria-hidden="true"></i></a>`
      : "",
    player.twitch
      ? `<a class="social-link is-twitch" href="${escapeAttr(player.twitch)}" target="_blank" rel="noreferrer" aria-label="Twitch ${escapeAttr(player.name)}"><i data-lucide="tv" aria-hidden="true"></i></a>`
      : "",
  ].join("");

  const adminButtons = canEditPlayers
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
        ${scoreBadge}
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
  if (!canManagePlayers()) return;
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
  if (!canManagePlayers()) return;
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
  if (!canManagePlayers()) return;
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
  if (!canManagePlayers()) return;
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

function setAdminAddMode(mode) {
  state.adminAddMode = mode;
  els.adminAddTabs?.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  els.addAdminError.hidden = true;
  if (mode === "new") {
    if (els.newAdminNameLabel) els.newAdminNameLabel.textContent = "Ник нового админа";
    if (els.newAdminPasswordField) els.newAdminPasswordField.hidden = false;
    if (els.newAdminPassword) els.newAdminPassword.required = true;
    if (els.addAdminSubmitLabel) els.addAdminSubmitLabel.textContent = "Создать аккаунт";
  } else {
    if (els.newAdminNameLabel) els.newAdminNameLabel.textContent = "Ник игрока";
    if (els.newAdminPasswordField) els.newAdminPasswordField.hidden = true;
    if (els.newAdminPassword) els.newAdminPassword.required = false;
    if (els.addAdminSubmitLabel) els.addAdminSubmitLabel.textContent = "Выдать права";
  }
}

async function renderAdminsList() {
  els.adminsList.innerHTML = `<li class="log-empty">Загрузка…</li>`;
  const q = query(collection(db, "users"), where("isAdmin", "==", true));
  const snap = await getDocs(q);
  const admins = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

  els.adminsList.innerHTML = admins
    .map((admin) => {
      if (admin.isMain) {
        return `
          <li class="admin-row">
            <div class="admin-row-head">
              <span>${escapeHtml(admin.nickname)}<span class="badge">гл. админ</span></span>
            </div>
          </li>`;
      }
      const perms = admin.permissions || { players: true, map: true, voting: true };
      return `
        <li class="admin-row">
          <div class="admin-row-head">
            <span>${escapeHtml(admin.nickname)}</span>
            <button type="button" data-uid="${escapeAttr(admin.uid)}" data-nickname="${escapeAttr(admin.nickname)}" aria-label="Удалить админа">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          </div>
          <div class="admin-row-perms" data-uid="${escapeAttr(admin.uid)}">
            <label><input type="checkbox" data-perm="players" ${perms.players !== false ? "checked" : ""} /> Каталог</label>
            <label><input type="checkbox" data-perm="map" ${perms.map !== false ? "checked" : ""} /> Карта</label>
            <label><input type="checkbox" data-perm="voting" ${perms.voting !== false ? "checked" : ""} /> Голосование</label>
          </div>
        </li>`;
    })
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

  els.adminsList.querySelectorAll(".admin-row-perms").forEach((row) => {
    row.querySelectorAll("input[data-perm]").forEach((input) => {
      input.addEventListener("change", async () => {
        const uid = row.dataset.uid;
        try {
          await updateDoc(doc(db, "users", uid), { [`permissions.${input.dataset.perm}`]: input.checked });
        } catch (error) {
          console.error(error);
          input.checked = !input.checked;
          alert("Не получилось сохранить права.");
        }
      });
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
  attachTierChipPhotos(els.tierRows);
  attachTierChipPhotos(els.tierPool);
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
      <div class="tier-chip-photo"><img alt="" /></div>
    </div>`;
}

/* ---------- Превью фото игрока при наведении в тирлисте ---------- */

// Фотки кладутся в assets/players/<имя игрока>.<расширение> — расширение и
// регистр имени заранее неизвестны, поэтому перебираем варианты и кэшируем результат.
// Показ/скрытие самого превью целиком на CSS (:hover) — JS только один раз
// подставляет src и добавляет класс has-photo, если файл нашёлся, поэтому
// оно физически не может остаться висеть после того, как убрали курсор.
const PLAYER_PHOTO_EXTENSIONS = ["webp", "png", "jpg", "jpeg", "gif"];
const playerPhotoLookups = new Map(); // player name -> Promise<string|null>

function probePlayerPhoto(name) {
  const tryExt = async (i) => {
    if (i >= PLAYER_PHOTO_EXTENSIONS.length) return null;
    const url = `assets/players/${encodeURIComponent(name)}.${PLAYER_PHOTO_EXTENSIONS[i]}`;
    const ok = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    return ok ? url : tryExt(i + 1);
  };
  return tryExt(0);
}

function getPlayerPhotoUrl(name) {
  if (!playerPhotoLookups.has(name)) {
    playerPhotoLookups.set(name, probePlayerPhoto(name));
  }
  return playerPhotoLookups.get(name);
}

function attachTierChipPhotos(root) {
  if (!root) return;
  root.querySelectorAll(".tier-chip").forEach((chip) => {
    const player = state.players.find((item) => item.id === chip.dataset.playerId);
    const box = chip.querySelector(".tier-chip-photo");
    const img = box ? box.querySelector("img") : null;
    if (!player || !box || !img) return;

    getPlayerPhotoUrl(player.name).then((url) => {
      if (!chip.isConnected) return; // карточку уже перерисовали
      if (url) {
        img.src = url;
        img.alt = player.name;
        box.classList.add("has-photo");
      } else {
        box.classList.remove("has-photo");
      }
    });
  });
}

function setupTierPhotoPreview() {
  window.addEventListener("keydown", (event) => {
    // event.code — это физическая клавиша на клавиатуре, не зависит от раскладки
    // (работает и на RU, и на UA, и на любой другой раскладке).
    if (event.code !== "KeyF" || event.ctrlKey || event.metaKey || event.altKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
    if (state.activeView !== "tierlist") return;

    state.tierPhotoPreviewEnabled = !state.tierPhotoPreviewEnabled;
    document.body.classList.toggle("tier-photos-off", !state.tierPhotoPreviewEnabled);
  });
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
  if (!window.lucide) return;
  // lucide.createIcons() пересканирует весь документ — если за один тик кода
  // его дёргают несколько раз (рендер каталога, карточек, виджета голосования и т.д.),
  // схлопываем всё в один проход перед отрисовкой кадра.
  if (iconsRafId) return;
  iconsRafId = requestAnimationFrame(() => {
    iconsRafId = null;
    window.lucide.createIcons();
  });
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