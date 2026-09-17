import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setLogLevel,
  setDoc,
} from 'firebase/firestore';

const CURRENT_PROJECT_ID_KEY = 'neo-node-current-project-id';

const envString = value => String(value || '').trim().replace(/^['"]|['"]$/g, '');
const envFlag = (value, fallback = false) => {
  const normalized = envString(value).toLowerCase();
  if (!normalized) return fallback;
  return !['0', 'false', 'no', 'off'].includes(normalized);
};

const firebaseConfig = {
  apiKey: envString(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: envString(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: envString(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: envString(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: envString(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: envString(import.meta.env.VITE_FIREBASE_APP_ID),
  measurementId: envString(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
};
const FIRESTORE_DATABASE_ID = envString(import.meta.env.VITE_FIREBASE_DATABASE_ID) || '(default)';
const FIREBASE_VERIFY_DATABASE = envFlag(import.meta.env.VITE_FIREBASE_VERIFY_DATABASE, false);
const FIREBASE_OPERATION_TIMEOUT_MS = Number(import.meta.env.VITE_FIREBASE_OPERATION_TIMEOUT_MS) || 30000;
const FIREBASE_UNAVAILABLE_COOLDOWN_MS = 30000;
const FIREBASE_UNAVAILABLE_UNTIL_KEY = 'neo-node-firebase-unavailable-until';
const FIREBASE_RETRY_GRACE_MS = 750;
const FIREBASE_MAX_WRITE_RETRIES = 3;
const PROJECTS_COLLECTION = 'projects';
const EXHIBITION_COLLECTION = 'Exihibition';
const UI_PROJECTS_COLLECTION = EXHIBITION_COLLECTION;
const EXHIBITION_START_DATE_KST = '2026-09-18';
const EXHIBITION_END_DATE_KST = '2026-09-20';
const MAX_INLINE_IMAGE_LENGTH = 240000;

setLogLevel('error');

let app = null;
let auth = null;
let db = null;
let authPromise = null;
let firestoreDatabaseReadyPromise = null;

let cachedProjectContext = {};
let cachedGeneratedIdeas = [];
let cachedCanvasWorkspace = null;
let cachedFinalPlan = null;
let firebaseUnavailableWarningShown = false;
let firebasePermanentError = null;
const pendingFirebaseRetryTimers = new Map();

function readStoredNumber(key) {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeStoredNumber(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

function removeStoredValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function firebaseUnavailableUntil() {
  return readStoredNumber(FIREBASE_UNAVAILABLE_UNTIL_KEY);
}

function firebaseUnavailable() {
  return Date.now() < firebaseUnavailableUntil();
}

function clearFirebaseUnavailable() {
  removeStoredValue(FIREBASE_UNAVAILABLE_UNTIL_KEY);
  firebasePermanentError = null;
}

function configured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

function cleanForFirestore(value) {
  if (typeof value === 'string' && value.startsWith('data:image/') && value.length > MAX_INLINE_IMAGE_LENGTH) {
    return undefined;
  }
  if (Array.isArray(value)) return value.map(cleanForFirestore).filter(entry => entry !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entryValue]) => [key, cleanForFirestore(entryValue)])
        .filter(([, entryValue]) => entryValue !== undefined),
    );
  }
  return value;
}

function cleanIdeaForDatabase(idea = {}, index = 0) {
  const detailPanel = idea.detailPanel || {};
  const cleanList = value => (Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []);
  const pros = cleanList(idea.pros || detailPanel.pros);
  const cons = cleanList(idea.cons || detailPanel.cons);
  const features = cleanList(idea.features || detailPanel.features);
  const goals = cleanList(idea.goals || detailPanel.goals);
  const description = String(idea.description || detailPanel.description || idea.desc || idea.summary || '').trim();
  return cleanForFirestore({
    id: idea.id ?? index + 1,
    title: String(idea.title || '').trim(),
    desc: String(idea.desc || description).trim(),
    description,
    tag: String(idea.tag || '').trim(),
    stars: Number(idea.stars) === 1 ? 1 : 0,
    keywords: Array.isArray(idea.keywords) ? idea.keywords : [],
    pros,
    cons,
    features,
    goals,
    detailPanel: {
      description,
      pros,
      cons,
      features,
      goals,
    },
  });
}

function cleanIdeasForDatabase(ideas = []) {
  return Array.isArray(ideas) ? ideas.map(cleanIdeaForDatabase) : [];
}

function cleanCanvasWorkspaceForDatabase(workspace = {}, projectId) {
  const ideas = cleanIdeasForDatabase(workspace?.ideas);
  return cleanForFirestore({
    projectId,
    savedAt: new Date().toISOString(),
    layoutVersion: workspace?.layoutVersion,
    positionMode: workspace?.positionMode,
    projectTitle: workspace?.projectTitle,
    projectInput: workspace?.projectInput,
    axes: workspace?.axes,
    spaces: workspace?.spaces,
    activeSpaceId: workspace?.activeSpaceId,
    ideas,
    selectedIdeaId: workspace?.selectedIdeaId ?? null,
  });
}

function getKstDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return getKstDateKey(new Date());
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function shouldWriteExhibition(value = new Date()) {
  const dateKey = getKstDateKey(value);
  return dateKey >= EXHIBITION_START_DATE_KST && dateKey <= EXHIBITION_END_DATE_KST;
}

function getProjectWriteCollections(value = new Date()) {
  return shouldWriteExhibition(value)
    ? [PROJECTS_COLLECTION, EXHIBITION_COLLECTION]
    : [PROJECTS_COLLECTION];
}

function decorateCollectionData(collectionName, data, savedAt = new Date().toISOString()) {
  if (collectionName !== EXHIBITION_COLLECTION) return data;
  return cleanForFirestore({
    ...data,
    exhibitionSavedAt: savedAt,
    exhibitionDateKst: getKstDateKey(savedAt),
  });
}

async function setProjectDocAcrossCollections(firestore, collectionNames, projectId, data, options = { merge: true }, savedAt) {
  await Promise.all(collectionNames.map(collectionName => (
    setDoc(
      doc(firestore, collectionName, projectId),
      decorateCollectionData(collectionName, data, savedAt),
      options,
    )
  )));
}

async function setProjectSubDocAcrossCollections(firestore, collectionNames, projectId, pathSegments, data, options = { merge: true }, savedAt) {
  await Promise.all(collectionNames.map(collectionName => (
    setDoc(
      doc(firestore, collectionName, projectId, ...pathSegments),
      decorateCollectionData(collectionName, data, savedAt),
      options,
    )
  )));
}

function markFirebaseUnavailable(error) {
  if (isPermanentFirebaseError(error)) firebasePermanentError = error;
  writeStoredNumber(FIREBASE_UNAVAILABLE_UNTIL_KEY, Date.now() + FIREBASE_UNAVAILABLE_COOLDOWN_MS);
  if (!firebaseUnavailableWarningShown) {
    const message = error?.code === 'firestore/database-not-found'
      ? error.message
      : 'Firebase is temporarily unavailable. The app will use local data and retry Firebase shortly.';
    const log = error?.code === 'firestore/database-not-found' ? console.error : console.info;
    log(message, error?.code || error?.message || error);
    firebaseUnavailableWarningShown = true;
  }
}

function makeFirebaseError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function isPermanentFirebaseError(error) {
  return ['firebase/not-configured', 'firestore/database-not-found', 'firestore/permission-denied'].includes(error?.code);
}

function withTimeout(promise, timeoutMs = FIREBASE_OPERATION_TIMEOUT_MS) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Firebase operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function scheduleFirebaseRetry(retryKey, operation, attempt = 1) {
  if (!retryKey || attempt > FIREBASE_MAX_WRITE_RETRIES) return;

  const existingTimer = pendingFirebaseRetryTimers.get(retryKey);
  if (existingTimer) clearTimeout(existingTimer);

  const retryDelay = Math.max(0, firebaseUnavailableUntil() - Date.now()) + FIREBASE_RETRY_GRACE_MS;
  const timer = setTimeout(async () => {
    pendingFirebaseRetryTimers.delete(retryKey);
    try {
      await withTimeout(operation(), FIREBASE_OPERATION_TIMEOUT_MS * 2);
      clearFirebaseUnavailable();
    } catch (error) {
      markFirebaseUnavailable(error);
      if (!isPermanentFirebaseError(error)) scheduleFirebaseRetry(retryKey, operation, attempt + 1);
    }
  }, retryDelay);

  pendingFirebaseRetryTimers.set(retryKey, timer);
}

async function withFirebase(fallback, operation, { retryKey = null } = {}) {
  if (firebasePermanentError) return fallback;
  if (firebaseUnavailable()) {
    scheduleFirebaseRetry(retryKey, operation);
    return fallback;
  }
  try {
    const result = await withTimeout(operation());
    clearFirebaseUnavailable();
    return result;
  } catch (error) {
    markFirebaseUnavailable(error);
    if (!isPermanentFirebaseError(error)) scheduleFirebaseRetry(retryKey, operation);
    return fallback;
  }
}

async function ensureFirestoreDatabaseReady() {
  if (firestoreDatabaseReadyPromise) return firestoreDatabaseReadyPromise;

  firestoreDatabaseReadyPromise = (async () => {
    if (typeof fetch === 'undefined' || !auth?.currentUser) return true;
    const token = await auth.currentUser.getIdToken();
    const databaseId = encodeURIComponent(FIRESTORE_DATABASE_ID || '(default)');
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${databaseId}/documents/projects?pageSize=1`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) return true;

    const errorText = await response.text().catch(() => '');
    if (response.status === 404 && /database.*does not exist|NOT_FOUND/i.test(errorText)) {
      throw makeFirebaseError(
        'firestore/database-not-found',
        `Firestore database "${FIRESTORE_DATABASE_ID}" does not exist for Firebase project "${firebaseConfig.projectId}". Create a Cloud Firestore database in Firebase Console, or set VITE_FIREBASE_DATABASE_ID to an existing database ID.`,
        errorText,
      );
    }
    if (response.status === 403) {
      throw makeFirebaseError(
        'firestore/permission-denied',
        'Firestore rejected the authenticated request. Check Firestore rules and make sure Anonymous Auth is allowed.',
        errorText,
      );
    }
    throw makeFirebaseError(
      'firestore/check-failed',
      `Firestore database check failed with HTTP ${response.status}.`,
      errorText,
    );
  })().catch((error) => {
    if (!isPermanentFirebaseError(error)) firestoreDatabaseReadyPromise = null;
    throw error;
  });

  return firestoreDatabaseReadyPromise;
}

async function ensureFirebase() {
  if (firebaseUnavailable()) {
    throw new Error('Firebase is currently unavailable.');
  }
  if (!configured()) {
    throw makeFirebaseError('firebase/not-configured', 'Firebase 환경변수가 설정되지 않았습니다.');
  }
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = FIRESTORE_DATABASE_ID && FIRESTORE_DATABASE_ID !== '(default)'
      ? getFirestore(app, FIRESTORE_DATABASE_ID)
      : getFirestore(app);
  }
  if (!auth.currentUser) {
    authPromise ||= signInAnonymously(auth).finally(() => {
      authPromise = null;
    });
    await authPromise;
  }
  if (FIREBASE_VERIFY_DATABASE) await ensureFirestoreDatabaseReady();
  return { app, auth, db, user: auth.currentUser };
}

function readCurrentProjectId() {
  try {
    return sessionStorage.getItem(CURRENT_PROJECT_ID_KEY) || null;
  } catch {
    return null;
  }
}

export function setCurrentProjectId(projectId) {
  if (!projectId) return;
  try {
    sessionStorage.setItem(CURRENT_PROJECT_ID_KEY, String(projectId));
  } catch {
    // Session persistence is best effort.
  }
}

export function getCurrentProjectId() {
  return cachedProjectContext.projectId || readCurrentProjectId();
}

export function getCachedProjectContext() {
  return cachedProjectContext || {};
}

export function setCachedProjectContext(context = {}) {
  cachedProjectContext = cleanForFirestore(context);
  if (cachedProjectContext.projectId) setCurrentProjectId(cachedProjectContext.projectId);
  return cachedProjectContext;
}

export function getCachedGeneratedIdeas() {
  return Array.isArray(cachedGeneratedIdeas) ? cachedGeneratedIdeas : [];
}

export function setCachedGeneratedIdeas(ideas = []) {
  cachedGeneratedIdeas = Array.isArray(ideas) ? cleanForFirestore(ideas) : [];
  return cachedGeneratedIdeas;
}

export function getCachedCanvasWorkspace() {
  return cachedCanvasWorkspace;
}

export function setCachedCanvasWorkspace(workspace = null) {
  cachedCanvasWorkspace = workspace && typeof workspace === 'object' ? cleanForFirestore(workspace) : null;
  return cachedCanvasWorkspace;
}

export function clearCachedProjectData() {
  cachedProjectContext = {};
  cachedGeneratedIdeas = [];
  cachedCanvasWorkspace = null;
  cachedFinalPlan = null;
  try {
    sessionStorage.removeItem(CURRENT_PROJECT_ID_KEY);
  } catch {
    // ignore
  }
}

export async function saveProjectDocument(projectId, payload) {
  if (!projectId) return null;
  const now = new Date().toISOString();
  const targetCollections = getProjectWriteCollections(now);
  const data = cleanForFirestore({
    ...payload,
    id: projectId,
    projectId,
    updatedAt: now,
    createdAt: payload?.createdAt || now,
  });
  setCachedProjectContext(data);
  return withFirebase(projectId, async () => {
    const { db: firestore } = await ensureFirebase();
    await setProjectDocAcrossCollections(firestore, targetCollections, projectId, data, { merge: true }, now);
    return projectId;
  }, {
    retryKey: `project:${projectId}`,
  });
}

export async function updateProjectDocument(projectId, payload) {
  if (!projectId) return null;
  const now = new Date().toISOString();
  const targetCollections = getProjectWriteCollections(now);
  const data = cleanForFirestore({
    ...payload,
    id: projectId,
    projectId,
    updatedAt: now,
  });
  if (getCurrentProjectId() === projectId) {
    setCachedProjectContext({ ...getCachedProjectContext(), ...data });
  }
  return withFirebase(projectId, async () => {
    const { db: firestore } = await ensureFirebase();
    await setProjectDocAcrossCollections(firestore, targetCollections, projectId, data, { merge: true }, now);
    return projectId;
  }, {
    retryKey: `project:${projectId}`,
  });
}

export async function loadProjectDocument(projectId = getCurrentProjectId()) {
  if (!projectId) return null;
  return withFirebase(getCachedProjectContext(), async () => {
    const { db: firestore } = await ensureFirebase();
    const snapshot = await getDoc(doc(firestore, UI_PROJECTS_COLLECTION, projectId));
    if (!snapshot.exists()) return null;
    const data = { id: snapshot.id, ...snapshot.data() };
    setCachedProjectContext(data);
    if (Array.isArray(data.ideas)) setCachedGeneratedIdeas(data.ideas);
    return data;
  });
}

export async function listProjects(teamId) {
  return withFirebase([], async () => {
    const { db: firestore } = await ensureFirebase();
    const snapshot = await getDocs(collection(firestore, UI_PROJECTS_COLLECTION));
    return snapshot.docs
      .map(projectDoc => ({ id: projectDoc.id, ...projectDoc.data() }))
      .filter(project => !teamId || project.teamId === teamId)
      .filter(project => project.deleted !== true)
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  });
}

export async function saveProjectWorkspace(projectId, workspace) {
  if (!projectId) return null;
  const data = cleanCanvasWorkspaceForDatabase(workspace, projectId);
  const savedAt = data.savedAt || new Date().toISOString();
  const targetCollections = getProjectWriteCollections(savedAt);
  const projectUpdate = cleanForFirestore({
    input: data.projectInput,
    axes: data.axes,
    canvasWorkspace: data,
    canvasWorkspaceUpdatedAt: data.savedAt,
    updatedAt: new Date().toISOString(),
  });
  return withFirebase(projectId, async () => {
    const { db: firestore } = await ensureFirebase();
    await setProjectSubDocAcrossCollections(firestore, targetCollections, projectId, ['canvasWorkspace', 'current'], data, { merge: true }, savedAt);
    await setProjectDocAcrossCollections(firestore, targetCollections, projectId, projectUpdate, { merge: true }, savedAt);
    return projectId;
  }, {
    retryKey: `workspace:${projectId}`,
  });
}

export async function loadProjectWorkspace(projectId = getCurrentProjectId()) {
  if (!projectId) return null;
  return withFirebase(getCachedCanvasWorkspace(), async () => {
    const { db: firestore } = await ensureFirebase();
    const snapshot = await getDoc(doc(firestore, UI_PROJECTS_COLLECTION, projectId, 'canvasWorkspace', 'current'));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (projectId === getCurrentProjectId()) setCachedCanvasWorkspace(data);
    return data;
  });
}

export async function saveGeneratedIdeasDocument(projectId, ideas) {
  if (!projectId) return null;
  const cleanedIdeas = cleanIdeasForDatabase(ideas);
  const now = new Date().toISOString();
  const targetCollections = getProjectWriteCollections(now);
  const data = {
    ideas: cleanedIdeas,
    ideasUpdatedAt: now,
    updatedAt: now,
  };
  return withFirebase(projectId, async () => {
    const { db: firestore } = await ensureFirebase();
    await setProjectDocAcrossCollections(firestore, targetCollections, projectId, data, { merge: true }, now);
    return projectId;
  }, {
    retryKey: `ideas:${projectId}`,
  });
}

export async function loadGeneratedIdeasDocument(projectId = getCurrentProjectId()) {
  if (!projectId) return [];
  const project = await loadProjectDocument(projectId);
  const ideas = Array.isArray(project?.ideas) ? project.ideas : [];
  if (projectId === getCurrentProjectId()) setCachedGeneratedIdeas(ideas);
  return ideas;
}

export async function saveFinalPlanDocument(projectId, finalPlan) {
  if (!projectId) return null;
  const now = new Date().toISOString();
  const targetCollections = getProjectWriteCollections(now);
  const data = cleanForFirestore({
    ...finalPlan,
    projectId,
    savedAt: now,
  });
  const projectUpdate = {
    finalPlanUpdatedAt: now,
    updatedAt: now,
  };
  cachedFinalPlan = data;
  return withFirebase(projectId, async () => {
    const { db: firestore } = await ensureFirebase();
    await setProjectSubDocAcrossCollections(firestore, targetCollections, projectId, ['finalPlan', 'current'], data, { merge: true }, now);
    await setProjectDocAcrossCollections(firestore, targetCollections, projectId, projectUpdate, { merge: true }, now);
    return projectId;
  }, {
    retryKey: `final-plan:${projectId}`,
  });
}

export async function loadFinalPlanDocument(projectId = getCurrentProjectId()) {
  if (!projectId) return null;
  return withFirebase(cachedFinalPlan, async () => {
    const { db: firestore } = await ensureFirebase();
    const snapshot = await getDoc(doc(firestore, UI_PROJECTS_COLLECTION, projectId, 'finalPlan', 'current'));
    if (!snapshot.exists()) return null;
    cachedFinalPlan = snapshot.data();
    return cachedFinalPlan;
  });
}

export async function deleteProjectDocument(projectId) {
  if (!projectId) return null;
  const now = new Date().toISOString();
  const targetCollections = getProjectWriteCollections(now);
  if (getCurrentProjectId() === projectId) clearCachedProjectData();
  return withFirebase(projectId, async () => {
    const { db: firestore } = await ensureFirebase();
    await setProjectDocAcrossCollections(firestore, targetCollections, projectId, {
      deleted: true,
      deletedAt: now,
      updatedAt: now,
    }, { merge: true });
    return projectId;
  }, {
    retryKey: `project-delete:${projectId}`,
  });
}

export async function hydrateCurrentProjectData(projectId = getCurrentProjectId()) {
  if (!projectId) return { project: null, ideas: [], workspace: null };
  const project = await loadProjectDocument(projectId);
  const [ideas, workspace] = await Promise.all([
    loadGeneratedIdeasDocument(projectId),
    loadProjectWorkspace(projectId),
  ]);
  return { project, ideas, workspace };
}

export function isFirebaseAvailable() {
  return configured();
}
