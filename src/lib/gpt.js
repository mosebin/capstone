import axisFramework from './axis.json';
import {
  clearCachedProjectData,
  getCachedCanvasWorkspace,
  getCachedGeneratedIdeas,
  getCachedProjectContext,
  getCurrentProjectId,
  hydrateCurrentProjectData,
  loadGeneratedIdeasDocument,
  loadProjectDocument,
  loadProjectWorkspace,
  saveGeneratedIdeasDocument,
  saveProjectDocument,
  saveProjectWorkspace,
  setCachedCanvasWorkspace,
  setCachedGeneratedIdeas,
  setCachedProjectContext,
} from './firebase';

const envString = value => String(value || '').trim().replace(/^['"]|['"]$/g, '');
const envFlag = (value, fallback = true) => {
  const normalized = envString(value).toLowerCase();
  if (!normalized) return fallback;
  return !['0', 'false', 'no', 'off'].includes(normalized);
};

const OPENAI_ENABLED = envFlag(import.meta.env.VITE_OPENAI_ENABLED, true);
const OPENAI_CIRCUIT_OPEN_UNTIL_KEY = 'neo-node-openai-circuit-open-until-v2';
const OPENAI_CIRCUIT_TTL_MS = 30 * 60 * 1000;
const OPENAI_QUOTA_CIRCUIT_TTL_MS = 24 * 60 * 60 * 1000;
const pendingGptRequests = new Map();
const activeGptControllers = new Set();
let gptCircuitOpen = false;
let gptQuotaWarningShown = false;

const DEFAULT_OPENAI_SYSTEM_PROMPT = 'You are a helpful assistant that responds only with valid JSON. Always ensure your response is valid, parseable JSON.';
export const AXIS_DEFINITIONS = axisFramework.axes || [];
export const EVALUATION_AXIS_IDS = AXIS_DEFINITIONS.map(axis => axis.id);
export const CANVAS_AXIS_IDS = AXIS_DEFINITIONS
  .filter(axis => axis.axis_type === 'spatial' || axis.axis_type === 'auxiliary')
  .map(axis => axis.id);
const DEFAULT_X_AXIS_ID = 'feasibility';
const DEFAULT_Y_AXIS_ID = 'usefulness';
const LEGACY_AXIS_ALIASES = {
  userValue: 'usefulness',
  USER_VALUE: 'usefulness',
  'USER VALUE': 'usefulness',
  value: 'usefulness',
  originality: 'novelty',
  ORIGINALITY: 'novelty',
  innovation: 'novelty',
  costEfficiency: 'profitability',
  COST_EFFICIENCY: 'profitability',
  sustainability: 'scalability',
  SUSTAINABILITY: 'scalability',
  privacy: 'risk',
  PRIVACY: 'risk',
  community: 'stickiness',
  COMMUNITY: 'stickiness',
  FEASIBILITY: 'feasibility',
  USEFULNESS: 'usefulness',
  NOVELTY: 'novelty',
  SCALABILITY: 'scalability',
  STICKINESS: 'stickiness',
  STABILITY: 'stability',
  PROFITABILITY: 'profitability',
  STRATEGIC_FIT: 'strategic_fit',
  RISK: 'risk',
};
const LEGACY_METRIC_KEYS_BY_AXIS = {
  usefulness: ['userValue', 'USER_VALUE', 'value'],
  novelty: ['originality', 'ORIGINALITY', 'innovation'],
  scalability: ['sustainability', 'SUSTAINABILITY'],
  profitability: ['costEfficiency', 'COST_EFFICIENCY'],
  risk: ['privacy', 'PRIVACY'],
  stickiness: ['community', 'COMMUNITY'],
};
const hashScore = (text) => [...String(text || '')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

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

function clearStoredValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isGptCircuitOpen() {
  if (gptCircuitOpen) return true;
  const openUntil = readStoredNumber(OPENAI_CIRCUIT_OPEN_UNTIL_KEY);
  if (Date.now() < openUntil) {
    gptCircuitOpen = true;
    return true;
  }
  return false;
}

function openGptCircuit(ttlMs = OPENAI_CIRCUIT_TTL_MS) {
  gptCircuitOpen = true;
  writeStoredNumber(OPENAI_CIRCUIT_OPEN_UNTIL_KEY, Date.now() + ttlMs);
}

function closeGptCircuit() {
  gptCircuitOpen = false;
  clearStoredValue(OPENAI_CIRCUIT_OPEN_UNTIL_KEY);
}

export const normalizeAxisId = (value, fallback = DEFAULT_X_AXIS_ID) => {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '_').replace(/^_|_$/g, '');
  const upper = raw.toUpperCase().replace(/[-\s]+/g, '_');
  const resolved = LEGACY_AXIS_ALIASES[raw] || LEGACY_AXIS_ALIASES[normalized] || LEGACY_AXIS_ALIASES[upper] || normalized;
  return EVALUATION_AXIS_IDS.includes(resolved) ? resolved : fallback;
};

const getAxisDefinition = axisId => AXIS_DEFINITIONS.find(axis => axis.id === axisId);
export const getEvaluationScore = (idea, axisId, fallback = 50) => {
  const normalizedAxisId = normalizeAxisId(axisId, axisId);
  const score = Number(idea?.evaluations?.[normalizedAxisId]?.score);
  if (Number.isFinite(score)) return Math.max(0, Math.min(100, score));
  const legacyScore = Number(idea?.metrics?.[normalizedAxisId]);
  if (Number.isFinite(legacyScore)) return Math.max(0, Math.min(100, legacyScore));
  const legacyKey = (LEGACY_METRIC_KEYS_BY_AXIS[normalizedAxisId] || [])
    .find(key => Number.isFinite(Number(idea?.metrics?.[key])));
  const aliasScore = Number(idea?.metrics?.[legacyKey]);
  return Number.isFinite(aliasScore) ? Math.max(0, Math.min(100, aliasScore)) : fallback;
};

const PROJECT_CONTEXT_STORAGE_KEY = 'neo-node-project-context';
const GENERATED_IDEAS_STORAGE_KEY = 'neo-node-generated-ideas';
const CANVAS_WORKSPACE_STORAGE_KEY = 'neo-node-canvas-workspace';
const LEGACY_GENERATED_IDEAS_STORAGE_PREFIX = 'neo-node-project-ideas';
const LEGACY_CANVAS_WORKSPACE_STORAGE_PREFIX = 'neo-node-project-workspace';
const LOCAL_FALLBACK_DESC_PATTERN = /빠르게 검증하는 서비스 아이디어입니다|사용자 맥락에 맞춰 빠르게 검증/;
const NUMERIC_FALLBACK_TITLE_PATTERN = /(확장안|아이디어|대안)\s*\d+$/;
const MAX_LOCAL_INLINE_IMAGE_LENGTH = 240000;

const canUseLocalStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

function stripLargeInlineImages(value) {
  if (typeof value === 'string' && value.startsWith('data:image/') && value.length > MAX_LOCAL_INLINE_IMAGE_LENGTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(stripLargeInlineImages).filter(entry => entry !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entryValue]) => [key, stripLargeInlineImages(entryValue)])
        .filter(([, entryValue]) => entryValue !== undefined),
    );
  }
  return value;
}

function readLocalJson(key, fallback = null) {
  if (!canUseLocalStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Failed to read ${key} from localStorage`, error);
    return fallback;
  }
}

function writeLocalJson(key, value) {
  if (!canUseLocalStorage()) return;
  const json = JSON.stringify(stripLargeInlineImages(value));
  try {
    window.localStorage.setItem(key, json);
  } catch (error) {
    try {
      window.localStorage.removeItem(key);
      window.localStorage.setItem(key, json);
    } catch (retryError) {
      console.warn(`Failed to write ${key} to localStorage`, retryError);
    }
  }
}

function removeLocalJson(key) {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function scopedLocalKeys(baseKey, projectId = getCurrentProjectId(), legacyPrefix = null) {
  const keys = [];
  if (projectId) {
    keys.push(`${baseKey}-${projectId}`);
    if (legacyPrefix) keys.push(`${legacyPrefix}-${projectId}`);
  } else {
    keys.push(baseKey);
  }
  return [...new Set(keys)];
}

function readScopedLocalJson(baseKey, projectId = getCurrentProjectId(), fallback = null, legacyPrefix = null) {
  for (const key of scopedLocalKeys(baseKey, projectId, legacyPrefix)) {
    const value = readLocalJson(key, null);
    if (value !== null && value !== undefined) return value;
  }
  if (projectId) return fallback;
  return readLocalJson(baseKey, fallback);
}

function writeScopedLocalJson(baseKey, value, projectId = getCurrentProjectId()) {
  if (projectId) writeLocalJson(`${baseKey}-${projectId}`, value);
  writeLocalJson(baseKey, value);
}

function removeScopedLocalJson(baseKey, projectId = getCurrentProjectId(), legacyPrefix = null) {
  scopedLocalKeys(baseKey, projectId, legacyPrefix).forEach(removeLocalJson);
}

function getActivityResetTime(projectId = getCurrentProjectId()) {
  const context = getCachedProjectContext();
  if (projectId && context?.projectId && String(context.projectId) !== String(projectId)) return 0;
  const resetTime = Date.parse(context?.activityResetAt || '');
  return Number.isFinite(resetTime) ? resetTime : 0;
}

function isWorkspaceStaleAfterReset(workspace, projectId = getCurrentProjectId()) {
  const resetTime = getActivityResetTime(projectId);
  if (!resetTime || !workspace) return false;
  const savedTime = Date.parse(workspace.savedAt || workspace.canvasWorkspaceUpdatedAt || '');
  return !Number.isFinite(savedTime) || savedTime < resetTime;
}

export function getProjectContext() {
  const cached = getCachedProjectContext();
  if (cached && Object.keys(cached).length) return cached;
  const localContext = readScopedLocalJson(PROJECT_CONTEXT_STORAGE_KEY, getCurrentProjectId(), {});
  if (localContext && Object.keys(localContext).length) return setCachedProjectContext(localContext);
  return cached;
}

export function saveProjectContext(context) {
  const title = String(context?.title || context?.idea || '진행 중인 프로젝트').trim() || '진행 중인 프로젝트';
  const now = new Date().toISOString();
  const nextContext = setCachedProjectContext({
    ...context,
    title,
    input: context?.input ?? context?.idea ?? '',
    updatedAt: now,
    createdAt: context?.createdAt || now,
  });
  writeScopedLocalJson(PROJECT_CONTEXT_STORAGE_KEY, nextContext, nextContext.projectId);
  if (!nextContext.projectId) return Promise.resolve(null);
  return saveProjectDocument(nextContext.projectId, nextContext)
    .catch(error => {
      console.warn('Failed to save project context to Firebase', error);
      return null;
    });
}

export function saveGeneratedIdeas(ideas) {
  const nextIdeas = setCachedGeneratedIdeas(ideas);
  const projectId = getCurrentProjectId();
  writeScopedLocalJson(GENERATED_IDEAS_STORAGE_KEY, nextIdeas, projectId);
  if (!projectId) return Promise.resolve(null);
  return saveGeneratedIdeasDocument(projectId, nextIdeas)
    .catch(error => {
      console.warn('Failed to save generated ideas to Firebase', error);
      return null;
    });
}

export function saveGeneratedIdeasLocally(ideas) {
  const nextIdeas = setCachedGeneratedIdeas(ideas);
  writeScopedLocalJson(GENERATED_IDEAS_STORAGE_KEY, nextIdeas, getCurrentProjectId());
  return nextIdeas;
}

export function seedProjectDataForRoute(context = {}, ideas = []) {
  const nextContext = setCachedProjectContext(context);
  writeScopedLocalJson(PROJECT_CONTEXT_STORAGE_KEY, nextContext, nextContext.projectId);
  if (Array.isArray(ideas) && ideas.length) {
    const nextIdeas = setCachedGeneratedIdeas(ideas);
    writeScopedLocalJson(GENERATED_IDEAS_STORAGE_KEY, nextIdeas, nextContext.projectId);
    return { context: nextContext, ideas: nextIdeas };
  }
  return { context: nextContext, ideas: getCachedGeneratedIdeas() };
}

export async function loadGeneratedIdeas(projectId = getCurrentProjectId(), { remote = true, preferRemote = false } = {}) {
  const localIdeas = readScopedLocalJson(
    GENERATED_IDEAS_STORAGE_KEY,
    projectId,
    null,
    LEGACY_GENERATED_IDEAS_STORAGE_PREFIX,
  );
  if (projectId && remote && preferRemote) {
    try {
      const ideas = await loadGeneratedIdeasDocument(projectId);
      const nextIdeas = Array.isArray(ideas) ? ideas : [];
      if (nextIdeas.length) {
        writeScopedLocalJson(GENERATED_IDEAS_STORAGE_KEY, nextIdeas, projectId);
        return nextIdeas;
      }
    } catch (error) {
      console.warn('Failed to load generated ideas from Firebase', error);
    }
  }
  if (Array.isArray(localIdeas) && localIdeas.length) {
    if (!projectId || projectId === getCurrentProjectId()) setCachedGeneratedIdeas(localIdeas);
    return localIdeas;
  }
  if (!projectId) return getCachedGeneratedIdeas();
  if (projectId === getCurrentProjectId()) {
    const cachedIdeas = getCachedGeneratedIdeas();
    if (cachedIdeas.length || !remote) return cachedIdeas;
  }
  if (!remote) return [];
  try {
    const ideas = await loadGeneratedIdeasDocument(projectId);
    const nextIdeas = Array.isArray(ideas) ? ideas : [];
    if (nextIdeas.length) writeScopedLocalJson(GENERATED_IDEAS_STORAGE_KEY, nextIdeas, projectId);
    return nextIdeas;
  } catch (error) {
    console.warn('Failed to load generated ideas from Firebase', error);
    return getCachedProjectContext()?.projectId === projectId ? getCachedGeneratedIdeas() : [];
  }
}

export function saveCanvasWorkspace(workspace) {
  const nextWorkspace = setCachedCanvasWorkspace({
    ...workspace,
    savedAt: new Date().toISOString(),
  });
  const projectId = getCurrentProjectId();
  writeScopedLocalJson(CANVAS_WORKSPACE_STORAGE_KEY, nextWorkspace, projectId);
  if (!projectId) return Promise.resolve(null);
  return saveProjectWorkspace(projectId, nextWorkspace)
    .catch(error => {
      console.warn('Failed to save canvas workspace to Firebase', error);
      return null;
    });
}

export async function loadCanvasWorkspace(projectId = getCurrentProjectId()) {
  const localWorkspace = readScopedLocalJson(
    CANVAS_WORKSPACE_STORAGE_KEY,
    projectId,
    null,
    LEGACY_CANVAS_WORKSPACE_STORAGE_PREFIX,
  );
  if (localWorkspace && typeof localWorkspace === 'object') {
    if (isWorkspaceStaleAfterReset(localWorkspace, projectId)) {
      removeScopedLocalJson(CANVAS_WORKSPACE_STORAGE_KEY, projectId, LEGACY_CANVAS_WORKSPACE_STORAGE_PREFIX);
    } else {
      if (!projectId || projectId === getCurrentProjectId()) setCachedCanvasWorkspace(localWorkspace);
      return localWorkspace;
    }
  }
  if (!projectId) return getCachedCanvasWorkspace();
  try {
    const workspace = await loadProjectWorkspace(projectId);
    if (workspace) writeScopedLocalJson(CANVAS_WORKSPACE_STORAGE_KEY, workspace, projectId);
    return workspace;
  } catch (error) {
    console.warn('Failed to load canvas workspace from Firebase', error);
    return getCachedCanvasWorkspace();
  }
}

export function clearCurrentProjectData() {
  const projectId = getCurrentProjectId();
  clearCachedProjectData();
  removeLocalJson(PROJECT_CONTEXT_STORAGE_KEY);
  removeLocalJson(GENERATED_IDEAS_STORAGE_KEY);
  removeLocalJson(CANVAS_WORKSPACE_STORAGE_KEY);
  if (projectId) {
    removeLocalJson(`${PROJECT_CONTEXT_STORAGE_KEY}-${projectId}`);
    removeLocalJson(`${GENERATED_IDEAS_STORAGE_KEY}-${projectId}`);
    removeLocalJson(`${CANVAS_WORKSPACE_STORAGE_KEY}-${projectId}`);
    removeLocalJson(`${LEGACY_GENERATED_IDEAS_STORAGE_PREFIX}-${projectId}`);
    removeLocalJson(`${LEGACY_CANVAS_WORKSPACE_STORAGE_PREFIX}-${projectId}`);
  }
}

export function clearActiveProjectSession() {
  clearCachedProjectData();
  removeLocalJson(PROJECT_CONTEXT_STORAGE_KEY);
  removeLocalJson(GENERATED_IDEAS_STORAGE_KEY);
  removeLocalJson(CANVAS_WORKSPACE_STORAGE_KEY);
}

export function resetNewProjectDraft() {
  clearCachedProjectData();
  removeLocalJson(PROJECT_CONTEXT_STORAGE_KEY);
  removeLocalJson(GENERATED_IDEAS_STORAGE_KEY);
  removeLocalJson(CANVAS_WORKSPACE_STORAGE_KEY);
}

export async function loadProjectContext(projectId = getCurrentProjectId()) {
  const localContext = readScopedLocalJson(PROJECT_CONTEXT_STORAGE_KEY, projectId, null);
  if (localContext && typeof localContext === 'object') {
    setCachedProjectContext(localContext);
  }
  if (!projectId) return localContext || getCachedProjectContext();
  try {
    const project = await loadProjectDocument(projectId);
    if (project) {
      setCachedProjectContext(project);
      writeScopedLocalJson(PROJECT_CONTEXT_STORAGE_KEY, project, projectId);
      return project;
    }
    return localContext || getCachedProjectContext();
  } catch (error) {
    console.warn('Failed to load project context from Firebase', error);
    return localContext || getCachedProjectContext();
  }
}

export async function hydrateProject(projectId = getCurrentProjectId()) {
  try {
    return await hydrateCurrentProjectData(projectId);
  } catch (error) {
    console.warn('Failed to hydrate project data from Firebase', error);
    return {
      project: getCachedProjectContext(),
      ideas: getCachedGeneratedIdeas(),
      workspace: getCachedCanvasWorkspace(),
    };
  }
}

function normalizeKeywords(keywords, fallback) {
  if (!Array.isArray(keywords) || !keywords.length) return fallback;
  return keywords.slice(0, 3).map(keyword => keyword.startsWith('#') ? keyword : `#${keyword}`);
}

export function isOpenAiAvailable() {
  return OPENAI_ENABLED && !isGptCircuitOpen();
}

export function isLocalFallbackIdea(idea = {}) {
  const keywords = Array.isArray(idea.keywords) ? idea.keywords : [];
  const title = String(idea.title || '');
  const desc = String(idea.desc || idea.summary || '');
  const hasFallbackText = LOCAL_FALLBACK_DESC_PATTERN.test(desc);
  const hasFallbackKeyword = keywords.includes('#Service') || keywords.includes('#Generated') || keywords.some(keyword => /^#Idea\d+$/i.test(keyword));
  const hasNumericFallbackTitle = NUMERIC_FALLBACK_TITLE_PATTERN.test(title);
  const hasLocalSignals = Object.values(idea.evaluations || {}).some(entry => (
    entry?.signals?.source === 'local_fallback'
  ));
  return idea.generationSource === 'local_fallback'
    || idea.source === 'local_fallback'
    || hasNumericFallbackTitle
    || (hasFallbackText && (hasFallbackKeyword || hasLocalSignals));
}

export function shouldRefreshLocalFallbackIdeas(ideas = []) {
  if (!isOpenAiAvailable() || !Array.isArray(ideas) || !ideas.length) return false;
  return ideas.some(isLocalFallbackIdea);
}

function normalizeTag(value, fallback = 'IDEA') {
  return String(value || fallback)
    .replace(/^#+/, '')
    .replace(/[^A-Za-z0-9가-힣]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
    .slice(0, 18) || fallback;
}

function makeTagFromText(text, seed = 0) {
  const tokens = String(text || '')
    .replace(/#[^\s]+/g, ' ')
    .split(/[^A-Za-z가-힣0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !['AI', 'IDEA', '서비스', '아이디어', '생성'].includes(token.toUpperCase()));
  const picked = tokens.slice(0, 2).join('_') || `IDEA_${(seed % 97) + 1}`;
  return normalizeTag(picked, `IDEA_${(seed % 97) + 1}`);
}

function shortenText(text = '', maxLength = 70) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).replace(/[,.!?;:\s]+$/, '')}...`;
}

function escapeSvgText(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeHexColor(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function buildProjectThumbnailDataUrl(spec = {}) {
  const palette = Array.isArray(spec.palette) ? spec.palette : [];
  const accent = normalizeHexColor(palette[0], '#CBFF00');
  const accent2 = normalizeHexColor(palette[1], '#77E8FF');
  const accent3 = normalizeHexColor(palette[2], '#FF6B8A');
  const sourceText = `${spec.searchText || ''} ${spec.title || ''} ${spec.subtitle || ''}`.toLowerCase();
  const scene = /노인|고령|시니어|치매|회고|기억|실버/.test(sourceText)
    ? 'elder'
    : /vr|가상현실|메타버스|몰입|헤드셋/.test(sourceText)
      ? 'vr'
      : /건강|헬스|수면|의료|증상|멘탈|감정/.test(sourceText)
        ? 'health'
        : /환경|친환경|제로|탄소|재활용|식물|농업/.test(sourceText)
          ? 'eco'
          : 'service';
  const sceneMarkup = {
    elder: `
      <circle cx="300" cy="132" r="42" fill="#f3d2bd"/>
      <path d="M238 284c15-66 38-98 62-98s47 32 62 98" fill="${accent}" opacity=".92"/>
      <path d="M268 126c14-38 61-44 86-12-8 4-22 5-40 2-20-4-36 0-46 10z" fill="#f7f7f7" opacity=".92"/>
      <path d="M374 206c36 28 54 64 54 108" stroke="${accent2}" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M430 314v38" stroke="#f7f7f7" stroke-width="9" stroke-linecap="round"/>
      <circle cx="285" cy="132" r="4" fill="#171717"/><circle cx="317" cy="132" r="4" fill="#171717"/>
    `,
    vr: `
      <rect x="176" y="122" width="248" height="120" rx="42" fill="#f7f7f7"/>
      <rect x="202" y="148" width="196" height="68" rx="24" fill="#151515"/>
      <circle cx="252" cy="182" r="22" fill="${accent}"/>
      <circle cx="348" cy="182" r="22" fill="${accent2}"/>
      <path d="M176 178c-58 10-86 42-84 96M424 178c58 10 86 42 84 96" stroke="${accent3}" stroke-width="13" stroke-linecap="round" fill="none"/>
      <circle cx="108" cy="292" r="16" fill="${accent3}"/><circle cx="492" cy="292" r="16" fill="${accent3}"/>
    `,
    health: `
      <path d="M300 288C212 220 172 180 172 132c0-38 29-66 66-66 28 0 48 15 62 36 14-21 34-36 62-36 37 0 66 28 66 66 0 48-40 88-128 156z" fill="${accent3}"/>
      <path d="M144 216h74l24-46 48 94 36-70 22 22h108" stroke="#f7f7f7" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="300" cy="196" r="126" fill="none" stroke="${accent2}" stroke-width="2" opacity=".32"/>
    `,
    eco: `
      <path d="M298 308c-10-78 12-146 70-204" stroke="${accent}" stroke-width="15" stroke-linecap="round" fill="none"/>
      <path d="M304 204c-88-8-138-52-150-132 90 4 146 42 170 114z" fill="${accent}"/>
      <path d="M330 178c52-62 112-78 180-48-36 68-90 100-162 92z" fill="${accent2}"/>
      <path d="M242 294c-52 0-94-24-126-72 70-24 128-10 174 40z" fill="${accent3}" opacity=".9"/>
    `,
    service: `
      <circle cx="300" cy="190" r="48" fill="${accent}"/>
      <circle cx="156" cy="132" r="30" fill="${accent2}"/>
      <circle cx="444" cy="132" r="30" fill="${accent3}"/>
      <circle cx="176" cy="292" r="34" fill="#f7f7f7"/>
      <circle cx="424" cy="292" r="34" fill="${accent2}"/>
      <path d="M184 142l74 34M416 142l-74 34M208 280l54-58M392 280l-54-58" stroke="rgba(255,255,255,.62)" stroke-width="10" stroke-linecap="round"/>
    `,
  }[scene];
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <defs>
    <radialGradient id="glow" cx="38%" cy="26%" r="72%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.28"/>
      <stop offset="46%" stop-color="${accent2}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#090909" stop-opacity="1"/>
    </radialGradient>
    <filter id="soft">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>
  <rect width="600" height="400" fill="#0b0b0b"/>
  <rect width="600" height="400" fill="url(#glow)"/>
  <g opacity="0.32">
    <circle cx="104" cy="92" r="54" fill="${accent}" filter="url(#soft)"/>
    <circle cx="492" cy="270" r="74" fill="${accent2}" filter="url(#soft)"/>
    <circle cx="380" cy="90" r="42" fill="${accent3}" filter="url(#soft)"/>
  </g>
  <g stroke="rgba(255,255,255,0.12)" stroke-width="1">
    <path d="M92 234 C176 150, 248 270, 334 166 S476 122, 524 216" fill="none"/>
    <path d="M130 310 C208 230, 306 326, 430 232" fill="none"/>
  </g>
  <g>
    <circle cx="116" cy="228" r="10" fill="${accent}"/>
    <circle cx="246" cy="214" r="8" fill="${accent2}"/>
    <circle cx="362" cy="166" r="11" fill="${accent}"/>
    <circle cx="494" cy="214" r="9" fill="${accent3}"/>
  </g>
  <rect x="34" y="34" width="532" height="332" rx="22" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.14)"/>
  <g transform="translate(0 0)">
    ${sceneMarkup}
  </g>
</svg>`.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function normalizeEvaluationEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const score = Number(entry.score);
  if (!Number.isFinite(score)) return null;
  return {
    band: typeof entry.band === 'string' ? entry.band : '',
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals: entry.signals && typeof entry.signals === 'object' ? entry.signals : {},
    reasoning: typeof entry.reasoning === 'string' ? entry.reasoning : '',
  };
}

function hasCompleteAxisEvaluation(idea) {
  return Boolean(
    idea?.risk
      && idea?.evaluations
      && EVALUATION_AXIS_IDS.every(axisId => Number.isFinite(Number(idea.evaluations?.[axisId]?.score))),
  );
}

function getTextSignalScore(text, patterns, delta) {
  const matched = patterns.some(pattern => pattern.test(text));
  return matched ? delta : 0;
}

function makeLocalAxisEvaluation(idea = {}, projectContext = {}, xAxisId = DEFAULT_X_AXIS_ID, yAxisId = DEFAULT_Y_AXIS_ID) {
  const text = [
    idea.title,
    idea.summary,
    idea.desc,
    ...(Array.isArray(idea.keywords) ? idea.keywords : []),
    ...(Array.isArray(idea.features) ? idea.features : []),
    ...(Array.isArray(idea.goals) ? idea.goals : []),
    ...(Array.isArray(idea.pros) ? idea.pros : []),
    ...(Array.isArray(idea.cons) ? idea.cons : []),
  ].filter(Boolean).join(' ').toLowerCase();
  const contextText = [
    projectContext.idea,
    projectContext.domain,
    ...(Array.isArray(projectContext.selectedIdeas) ? projectContext.selectedIdeas : []),
  ].filter(Boolean).join(' ').toLowerCase();

  const evaluations = {};
  AXIS_DEFINITIONS.forEach((axis, index) => {
    let score = 42 + (hashScore(`${axis.id}-${text}-${contextText}-${index}`) % 28);
    if (axis.id === 'usefulness') {
      score += getTextSignalScore(text, [/문제|불편|해결|필요|도움|맞춤|사용자|타겟|개선/], 16);
    }
    if (axis.id === 'novelty') {
      score += getTextSignalScore(text, [/새로운|차별|ai|개인화|매칭|게임|데이터|실시간|공유/], 13);
      score -= getTextSignalScore(text, [/관리|가이드|추천 앱|플랫폼/], 5);
    }
    if (axis.id === 'feasibility') {
      score += getTextSignalScore(text, [/기록|알림|추천|체크|템플릿|수동|간단|mvp/], 12);
      score -= getTextSignalScore(text, [/하드웨어|iot|실시간|3d|블록체인|의료|외부 연동/], 12);
    }
    if (axis.id === 'scalability') {
      score += getTextSignalScore(text, [/플랫폼|자동화|네트워크|공유|마켓|커뮤니티|구독|ai/], 12);
    }
    if (axis.id === 'stickiness') {
      score += getTextSignalScore(text, [/매일|주간|루틴|기록|알림|챌린지|구독|커뮤니티|리워드/], 14);
    }
    if (axis.id === 'stability') {
      score += getTextSignalScore(text, [/단순|수동|템플릿|체크|가이드|오프라인/], 9);
      score -= getTextSignalScore(text, [/실시간|외부 연동|하드웨어|센서|의료|복잡|대규모/], 13);
    }
    if (axis.id === 'profitability') {
      score += getTextSignalScore(text, [/구독|프리미엄|마켓|b2b|수익|광고|결제|거래/], 14);
    }
    if (axis.id === 'strategic_fit') {
      const ideaTokens = new Set(text.split(/[^a-z0-9가-힣]+/).filter(token => token.length >= 2));
      const overlap = contextText.split(/[^a-z0-9가-힣]+/).filter(token => ideaTokens.has(token)).length;
      score += Math.min(16, overlap * 4);
    }
    if (axis.id === 'risk') {
      score = 25 + (hashScore(`risk-${text}`) % 22);
      score += getTextSignalScore(text, [/개인정보|의료|금융|아동|위치|민감|실시간|외부 연동|하드웨어/], 24);
      score += getTextSignalScore(text, [/데이터|ai|자동|추천|분석/], 8);
    }

    const bounded = Math.max(10, Math.min(90, Math.round(score)));
    evaluations[axis.id] = {
      band: getScoreBand(bounded),
      score: bounded,
      signals: { source: 'local_fallback' },
      reasoning: 'GPT 축 평가를 사용할 수 없어 아이디어 텍스트 기반 로컬 점수로 임시 산출했습니다.',
    };
  });

  const riskScore = evaluations.risk?.score || 35;
  const risk = {
    level: riskScore >= 72 ? 'high' : riskScore >= 56 ? 'medium' : riskScore >= 40 ? 'low' : 'none',
    reasons: riskScore >= 56 ? ['데이터/운영 리스크 신호가 있어 검토가 필요합니다.'] : [],
  };

  return {
    node_id: String(idea.id || idea.title || ''),
    evaluations,
    risk,
    position: {
      x_axis: xAxisId,
      y_axis: yAxisId,
      x: getEvaluationScore({ evaluations }, xAxisId),
      y: getEvaluationScore({ evaluations }, yAxisId),
    },
  };
}

function normalizeAxisEvaluationPayload(payload, idea, xAxisId, yAxisId) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return null;
  const evaluations = {};
  EVALUATION_AXIS_IDS.forEach((axisId) => {
    const normalized = normalizeEvaluationEntry(payload.evaluations?.[axisId]);
    if (normalized) evaluations[axisId] = normalized;
  });
  const riskLevel = ['none', 'low', 'medium', 'high'].includes(payload.risk?.level) ? payload.risk.level : 'none';
  return {
    node_id: payload.node_id || String(idea?.id || idea?.title || ''),
    evaluations,
    risk: {
      level: riskLevel,
      reasons: Array.isArray(payload.risk?.reasons) ? payload.risk.reasons.filter(Boolean).map(String) : [],
    },
    position: {
      x_axis: normalizeAxisId(payload.position?.x_axis || xAxisId, xAxisId),
      y_axis: normalizeAxisId(payload.position?.y_axis || yAxisId, yAxisId),
      x: Math.max(0, Math.min(100, Number(payload.position?.x) || getEvaluationScore({ evaluations }, xAxisId))),
      y: Math.max(0, Math.min(100, Number(payload.position?.y) || getEvaluationScore({ evaluations }, yAxisId))),
    },
  };
}

function averageEvaluations(ideas) {
  const evaluations = {};
  EVALUATION_AXIS_IDS.forEach((axisId) => {
    const entries = ideas
      .map(idea => normalizeEvaluationEntry(idea.evaluations?.[axisId]))
      .filter(Boolean);
    if (!entries.length) return;
    const score = entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length;
    evaluations[axisId] = {
      band: getScoreBand(score),
      score: Math.round(score),
      signals: {},
      reasoning: `${ideas.length}개 원천 아이디어의 ${axisId} 평가 평균입니다.`,
    };
  });
  return Object.keys(evaluations).length ? evaluations : null;
}

function getScoreBand(score) {
  if (score <= 20) return '0-20';
  if (score <= 40) return '21-40';
  if (score <= 60) return '41-60';
  if (score <= 80) return '61-80';
  return '81-100';
}

function mergeRiskLevels(ideas) {
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  const selected = ideas.reduce((highest, idea) => (
    (rank[idea.risk?.level] || 0) > (rank[highest.level] || 0) ? { level: idea.risk.level, reasons: idea.risk.reasons || [] } : highest
  ), { level: 'none', reasons: [] });
  return {
    level: selected.level,
    reasons: [...new Set(ideas.flatMap(idea => idea.risk?.reasons || selected.reasons || []))].slice(0, 4),
  };
}

export function makeFallbackIdea({ text, sourceIdeas = [], mode = 'generate', wx = 1800, wy = 900, projectContext = {} }) {
  const seed = hashScore(`${mode}-${text}-${projectContext.idea || ''}-${sourceIdeas.map(i => i.title).join('-')}`);
  const titles = sourceIdeas.map(i => i.title);
  const title = mode === 'combine' && sourceIdeas.length >= 2
    ? `${titles[0].slice(0, 7)} X ${titles[1].slice(0, 7)}`
    : mode === 'whitespace'
      ? ['빈 시간 연결 서비스', '숨은 수요 발견 도구', '틈새 행동 제안봇', '미충족 니즈 매칭'][seed % 4]
    : mode === 'regenerate' && sourceIdeas.length
      ? ['상황 맞춤 실행 도우미', '맥락 기반 연결 서비스', '작은 습관 실험실', '참여형 기록 코치'][seed % 4]
      : String(text || projectContext.idea || '새로운 아이디어').trim().slice(0, 22);
  const summary = mode === 'combine'
    ? `${titles.join('와 ')}의 강점을 결합한 하위 아이디어`
    : mode === 'whitespace'
      ? '비어 있는 축 영역을 보완하는 기회 아이디어'
    : mode === 'regenerate'
      ? `${sourceIdeas[0]?.title || '기존 아이디어'}와 다른 접근의 대안`
      : `${title}을 프로젝트 주제에 맞게 확장한 서비스 아이디어`;

  return {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2)}-${seed}`,
    tag: mode === 'combine' ? 'AI_BONDING' : makeTagFromText(`${title} ${projectContext.selectedIdeas?.[seed % Math.max(projectContext.selectedIdeas?.length || 1, 1)] || ''}`, seed),
    stars: 0,
    title,
    summary,
    desc: mode === 'combine'
      ? shortenText(`${titles.join('와 ')}의 사용자 가치와 구현 방식을 연결해 새 경험 흐름을 만듭니다.`)
      : mode === 'whitespace'
        ? shortenText(`현재 축에서 비어 있는 점수대의 사용자 문제를 보완하는 틈새 서비스입니다.`)
      : mode === 'regenerate'
        ? shortenText(`사용자가 놓치기 쉬운 순간을 포착해 바로 실행할 수 있는 작은 행동으로 연결하는 서비스입니다.`)
      : shortenText(`${title}을 사용자 맥락에 맞춰 빠르게 검증하는 서비스 아이디어입니다.`),
    keywords: mode === 'combine'
      ? ['#AI', '#Bonding', '#SubIdea']
      : mode === 'whitespace'
        ? ['#Whitespace', '#Opportunity', '#Canvas']
      : mode === 'regenerate'
        ? ['#Alternative', '#Service', '#Experiment']
      : ['#AI', '#Generated', `#Idea${(seed % 9) + 1}`],
    wx,
    wy,
    aiGenerated: true,
    showAiBadge: false,
    evaluations: sourceIdeas.length ? averageEvaluations(sourceIdeas) : null,
    risk: sourceIdeas.length ? mergeRiskLevels(sourceIdeas) : { level: 'none', reasons: [] },
    pros: ['빠른 프로토타입 검증 가능', '프로젝트 주제와 연결성 높음', 'AI 기반 확장성이 있음'],
    cons: ['사용자 리서치로 세부 니즈 검증 필요', '초기 범위 조절 필요'],
    features: sourceIdeas.length
      ? ['두 아이디어의 핵심 기능 연결', 'AI 기반 하위 시나리오 생성']
      : ['입력 기반 아이디어 구체화', '핵심 기능 자동 제안'],
    goals: sourceIdeas.length
      ? ['서로 다른 아이디어의 장점을 한 실험안에서 검증', '새로운 하위 아이디어를 통해 기획 선택지를 확장']
      : ['초기 문장을 실행 가능한 서비스 개념으로 전환', '캔버스에서 바로 비교 가능한 형태로 아이디어 추가'],
    generationSource: 'local_fallback',
  };
}

function buildPrompt({ text, sourceIdeas = [], mode, projectContext, count }) {
  const sourceText = sourceIdeas.map((idea, index) => (
    `${index + 1}. ${idea.title}: ${idea.summary || idea.desc} / ${idea.desc || ''}`
  )).join('\n');
  const contextText = [
    `프로젝트 주제: ${projectContext.idea || text || '미정'}`,
    `디자인 도메인: ${projectContext.domain || 'Service Design'}`,
    `추천/관심 키워드: ${(projectContext.selectedIdeas || []).join(', ') || '없음'}`,
  ].join('\n');

if (mode === 'list') {
  const excludedTitles = sourceIdeas.map(idea => idea.title).filter(Boolean);
  return [
    '당신은 디자인 고착(fixation)을 깨기 위해 훈련된 발산적 사고 퍼실리테이터입니다.',
    `ideas 배열에 정확히 ${count}개의 항목을 JSON 객체로만 반환하세요.`,
    '',
    '사고 순서 (내부적으로 따르되 결과에는 아이디어만 출력):',
    `1. 주제와 관련된 서로 다른 이해관계자/문제 상황을 ${count}개보다 훨씬 많이 폭넓게 떠올린다.`,   // ← 수정: 여유있게 브레인스토밍 먼저 하도록 명시
    '2. 각 아이디어는 서로 다른 문제 상황에서 출발해야 하며, 같은 문제를 두 번 다루지 않는다.',
    '3. 각 아이디어는 다음 메커니즘 중 서로 다른 것을 최소 1개 사용한다: 소셜/커뮤니티, AI 개인화, 마켓플레이스/매칭, 게이미피케이션, 데이터 시각화, 하드웨어·IoT 연동, 구독형 코칭.',
    `4. ${count}개 중 최소 7개 이상의 서로 다른 영역(이동/편의, 건강/웰빙, 커뮤니티/공유, 학업/시설, 문화/여가, 콘텐츠/AI, 환경/지속가능성 등)에 걸쳐 분포시킨다.`,  // ← 신규: 카테고리 다양성 강제
    `5. 최종 출력 전, ${count}개를 서로 비교해 제목이나 핵심 메커니즘이 겹치는 쌍이 있는지 반드시 재검토한다. 겹치는 게 있으면 그중 하나를 1번 단계에서 떠올린 다른 후보로 완전히 교체한다.`,  // ← 신규: 자체 검수 단계
    '',
    '금지 사항:',
    `- title에 "플랫폼", "관리 앱", "커뮤니티", "가이드" 같은 상투적 명사를 ${count}개 중 3회 이상 반복 사용 금지`,  // ← 수정: 하드코딩된 15를 count로 교체
    '- title 끝에 번호를 붙이지 마세요. "확장안 13", "아이디어 4", "대안 2" 같은 제목은 금지입니다.',
    '- desc는 "~할 수 있는 앱/플랫폼입니다" 같은 추상적 문장 금지. 반드시 "누가(타겟) / 어떤 구체적 상황(문제)에서 / 무엇을 한다(행동)"가 드러나야 함',
    '- 같은 아이디어를 표현만 바꿔서 두 번 제시하는 것 금지 (예: "재활용 패션 플랫폼"과 "친환경 패션 플랫폼"은 같은 아이디어로 간주)',  // ← 신규: 실제로 발생했던 사례를 직접 예시로 명시
    '',
    '각 항목은 title, mechanism, desc, keywords 필드를 포함하세요.',
    'mechanism: 이 아이디어의 핵심 차별화 지점을 12자 이내 한 구절로.',
    'keywords는 #으로 시작하는 2-3개 문자열입니다.',
    '',
    '나쁜 예: {"title":"지속가능한 소비 플랫폼","desc":"환경을 생각하는 소비자를 위한 앱"}',
    '좋은 예: {"title":"냉장고 파먹기 챌린지","mechanism":"소셜 인증","desc":"자취생이 유통기한 임박 재료로 만든 요리를 인증하면 친구가 레시피로 답례하는 서비스"}',
    excludedTitles.length ? `이미 생성된 제목(중복 금지): ${excludedTitles.join(', ')}` : '',
    '',
    'Output Format: {"ideas":[{"title":"...", "mechanism":"...", "desc":"...", "keywords":["#..."]}]}',
    contextText,
  ].join('\n');
}

  if (mode === 'keywords') {
    return [
      '사용자의 새 프로젝트 입력을 바탕으로 추천 아이디어 키워드 10개를 JSON 객체만으로 생성하세요.',
      'keywords 배열에 10개의 문자열을 담아 반환하세요.',
      '각 항목은 6~14자 정도의 한국어 짧은 명사구로 작성하고, #은 붙이지 마세요.',
      '너무 일반적인 단어보다 서비스 기획에 바로 쓸 수 있는 구체적인 방향을 제안하세요.',
      'Output Format: {"keywords":["키워드1","키워드2"]}',
      contextText,
      `사용자 입력: ${text || projectContext.idea || ''}`,
    ].join('\n');
  }

  if (mode === 'keyword') {
    return [
      '사용자의 새 프로젝트 입력을 바탕으로 추천 아이디어 키워드 1개를 JSON 객체만으로 생성하세요.',
      '키워드는 6~14자 정도의 한국어 짧은 명사구로 작성하고, #은 붙이지 마세요.',
      '너무 일반적인 단어보다 서비스 기획에 바로 쓸 수 있는 구체적인 방향을 제안하세요.',
      `이번 키워드는 전체 추천 목록 중 ${count || 1}번째 항목입니다. 앞뒤 항목과 겹치지 않는 다른 관점으로 만드세요.`,
      'Output Format: {"keyword":"키워드"}',
      contextText,
      `사용자 입력: ${text || projectContext.idea || ''}`,
    ].join('\n');
  }

  if (mode === 'regenerate') {
    return [
      '당신은 서비스 기획 워크숍에서 기존 아이디어를 더 나은 새 아이디어로 대체하는 발산 퍼실리테이터입니다.',
      '반드시 JSON 객체 하나만 반환하세요.',
      '',
      '목표:',
      '- 기존 아이디어와 제목, 문장, 핵심 기능이 겹치지 않는 완전히 새로운 서비스 아이디어를 만드세요.',
      '- 단순히 기존 제목 뒤에 "아이디어"를 붙이거나, "~방향을 빠르게 검증하는 서비스 아이디어입니다" 같은 형식적 문장을 쓰지 마세요.',
      '- 프로젝트 주제와 사용자의 실제 상황을 반영한 구체적인 새 기획이어야 합니다.',
      '',
      '출력 필드:',
      'title: 12~24자 한국어 서비스명. 따옴표 사용 금지.',
      'tag: 아이디어 핵심을 나타내는 영문 또는 한글 대문자 스네이크 케이스 1개.',
      'summary: 35자 이내 한 줄 요약.',
      'desc: 누가/어떤 상황에서/무엇을 하는지 드러나는 45~75자 한국어 한 문장.',
      'keywords: #으로 시작하는 2~3개 문자열.',
      'features: 핵심 기능 2개 배열.',
      'goals: 서비스 목표 2개 배열.',
      'pros: 장점 2~3개 배열.',
      'cons: 단점 2개 배열.',
      '',
      '기존 아이디어:',
      sourceText || '없음',
      '',
      '새 아이디어를 만들 때 참고할 사용자 요청:',
      text || '기존 아이디어를 더 구체적이고 차별적인 서비스 기획으로 재생성',
      '',
      contextText,
      '',
      'Output Format: {"title":"...", "tag":"...", "summary":"...", "desc":"...", "keywords":["#..."], "features":["..."], "goals":["..."], "pros":["..."], "cons":["..."]}',
    ].join('\n');
  }

  if (mode === 'whitespace') {
    const target = projectContext.whitespaceTarget || {};
    return [
      '당신은 아이디어 캔버스에서 비어 있는 축 영역을 발견해 그 위치에 맞는 새 기회 아이디어를 만드는 서비스 디자이너입니다.',
      '반드시 JSON 객체 하나만 반환하세요.',
      '',
      '화이트 스페이스 위치:',
      `- X축: ${target.xLabel || target.xAxis || 'X축'} / 목표 점수: ${target.xScore ?? '미정'} / 수준: ${target.xBand || '미정'}`,
      `- Y축: ${target.yLabel || target.yAxis || 'Y축'} / 목표 점수: ${target.yScore ?? '미정'} / 수준: ${target.yBand || '미정'}`,
      '',
      '생성 규칙:',
      '- 이 아이디어는 위 X/Y축 점수대에 자연스럽게 놓일 수 있어야 합니다.',
      '- 높은 축은 아이디어의 강점으로 드러내고, 낮은 축은 의도적으로 가볍거나 실험적인 제약으로 반영하세요.',
      '- 주변 아이디어를 단순 변형하지 말고, 캔버스에서 비어 있던 관점을 채우는 새 서비스 기획이어야 합니다.',
      '- desc에는 누가/어떤 상황에서/무엇을 하는지가 구체적으로 드러나야 합니다.',
      '',
      '주변 아이디어:',
      sourceText || '없음',
      '',
      '사용자 요청:',
      text,
      '',
      contextText,
      '',
      'Output Format: {"title":"...", "tag":"...", "summary":"...", "desc":"...", "keywords":["#..."], "features":["..."], "goals":["..."], "pros":["..."], "cons":["..."]}',
    ].join('\n');
  }

  return [
    mode === 'combine'
      ? '당신은 서로 다른 영역의 개념을 창의적으로 충돌시켜 새로운 시너지를 만드는 Cross-Pollination 전문 디자이너입니다.'
      : '한국어 아이디어 캔버스 앱에서 사용할 새 아이디어를 JSON만으로 생성하세요.',
    '필드는 title, tag, summary, desc, keywords, features, goals, pros, cons를 포함하세요.',
    'tag는 AI_IDEA처럼 공통값을 쓰지 말고 아이디어 핵심을 나타내는 영문 또는 한글 대문자 스네이크 케이스 1개로 작성하세요.',
    'summary는 35자 이내, desc는 한국어 45~70자 한 문장으로 짧게 작성하세요.',
    'keywords는 #으로 시작하는 2-3개 문자열입니다.',
    contextText,
    mode === 'combine'
      ? [
        '다음 두 아이디어의 장점과 메커니즘이 시너지를 내는 제3의 통합 아이디어를 만드세요.',
        '단순히 A도 있고 B도 있는 앱은 피하고, 한 아이디어의 특성이 다른 아이디어의 문제를 해결하는 지렛대가 되는 과정을 설명하세요.',
        '결과는 기존 두 아이디어의 하위 메모가 아니라 독립적인 새 서비스 기획이어야 합니다.',
        'title, desc, keywords는 반드시 두 원천 아이디어의 결합에서 나온 새 가치 제안을 드러내야 합니다.',
        `결합 대상:\n${sourceText}`,
      ].join('\n')
      : `사용자 입력을 바탕으로 새 아이디어를 만드세요: ${text}`,
  ].join('\n');
}

export function buildCritiqueTopics() {
  return [
    { key: 'assumption', label: '핵심 가정', status: 'pending' },
    { key: 'userRisk', label: '사용자 UX 리스크', status: 'pending' },
    { key: 'buildRisk', label: '구현 리스크', status: 'pending' },
    { key: 'fit', label: '도메인 적합성', status: 'pending' },
  ];
}

function compressCritiqueConversation(conversation = []) {
  if (conversation.length <= 10) {
    return conversation.map(message => `${message.role === 'user' ? '사용자' : 'AI'}: ${message.text}`).join('\n');
  }
  const older = conversation.slice(0, -8);
  const recent = conversation.slice(-8);
  const summaryByTopic = older.reduce((acc, message) => {
    const topic = message.topicLabel || '이전 논점';
    if (!acc[topic]) acc[topic] = [];
    acc[topic].push(message.text);
    return acc;
  }, {});
  const summaries = Object.entries(summaryByTopic).map(([topic, texts]) => (
    `${topic}: ${texts.slice(-2).join(' / ').replace(/\s+/g, ' ').slice(0, 120)}`
  ));
  const recentText = recent.map(message => `${message.role === 'user' ? '사용자' : 'AI'}: ${message.text}`).join('\n');
  return [`이전 대화 요약:\n${summaries.join('\n')}`, `최근 대화:\n${recentText}`].join('\n\n');
}

function buildCritiquePrompt({ idea, projectContext, userNote = '', conversation = [], currentTopic }) {
  const safeTopic = currentTopic || buildCritiqueTopics()[0];
  const conversationText = conversation.length
    ? compressCritiqueConversation(conversation)
    : '이전 대화 없음 — 지금이 세션의 첫 턴이다.';
  const detailPanel = idea.detailPanel || {};
  const detailPanelText = [
    detailPanel.description ? `설명: ${detailPanel.description}` : null,
    Array.isArray(detailPanel.pros) && detailPanel.pros.length ? `장점: ${detailPanel.pros.join(' / ')}` : null,
    Array.isArray(detailPanel.cons) && detailPanel.cons.length ? `단점: ${detailPanel.cons.join(' / ')}` : null,
    Array.isArray(detailPanel.features) && detailPanel.features.length ? `서비스 상세 기능: ${detailPanel.features.join(' / ')}` : null,
    Array.isArray(detailPanel.goals) && detailPanel.goals.length ? `서비스 목표: ${detailPanel.goals.join(' / ')}` : null,
  ].filter(Boolean).join('\n') || '상세 패널에 작성된 추가 내용 없음';
  return [
    '당신은 서비스 기획 세션을 이끄는 친절한 크리틱 진행자입니다.',
    '주니어 디자이너나 학생도 편하게 이해할 수 있도록 일상적인 한국어로 말하세요.',
    '단순히 문제점을 나열하는 평가자가 아니라, 한 번에 하나만 짚고 사용자가 다음 생각을 하기 쉽게 도와주는 역할입니다.',
    '',
    'Context:',
    `- Idea: ${JSON.stringify(idea)}`,
    `- Detail Panel:\n${detailPanelText}`,
    `- Domain: ${projectContext.domain || 'Service Design'}`,
    `- 현재 다루는 주제: ${safeTopic.label} (${safeTopic.key})`,
    `- User Note: ${userNote || '없음'}`,
    `- Conversation:\n${conversationText}`,
    '',
    'Rule:',
    '1. 이번 턴에서는 "현재 다루는 주제" 범위 안에서 딱 하나의 비판만 제시하세요. 다른 주제로 넘어가지 마세요.',
    '2. 비판은 상세 패널의 설명/장점/단점/서비스 상세 기능/서비스 목표 또는 idea의 desc/features/cons 중 하나를 짧게 짚어서 근거로 삼으세요. "UX 설계가 필요합니다" 같은 일반론 금지.',
    '3. 이전 대화가 있다면 반드시 사용자의 마지막 답변을 reflection에서 한 문장으로 짚고 넘어가세요. 그 답변을 무시하고 새 얘기를 시작하지 마세요.',
    '4. question은 반드시 사용자가 구체적으로 답할 수 있는 단일 질문이어야 하고, 물음표로 끝나야 합니다. "어떻게 생각하세요?" 같은 열린 질문 금지.',
    '5. 사용자가 이번 주제에 대해 충분히 답했다고 판단되면(보통 2턴 이상 오간 뒤) topicStatus를 resolved로, 아니면 continue로 설정하세요.',
    '6. 지나치게 전문적이거나 학술적인 말투를 쓰지 마세요. 다음 단어는 되도록 피하세요: 패러다임, 담론, 정합성, 인지부하, 휴리스틱, 아키텍처, 거버넌스.',
    '7. critique와 question은 각각 1-2문장으로 짧게 쓰세요.',
    '',
    '나쁜 예: "인지부하를 줄이기 위한 UX 아키텍처 개선이 필요합니다."',
    '좋은 예: "이 기능은 처음 보는 사람에게 조금 복잡해 보일 수 있어요. 첫 버전에서는 버튼 하나로 바로 해볼 수 있게 줄인다면 어떤 행동을 남기면 좋을까요?"',
    '',
    'Output Format (JSON만):',
    '{"reflection":"...", "critique":"...", "question":"...", "topicStatus":"continue|resolved"}',
  ].join('\n');
}

function buildDetailPrompt({ idea, projectContext, currentAxis = {} }) {
  return [
    '당신은 서비스 디자인 캔버스에서 선택된 아이디어를 분석하는 수석 기획자입니다.',
    '다음 아이디어 상세 패널에 넣을 JSON만 반환하세요.',
    '',
    `프로젝트: ${projectContext.idea || '미정'}`,
    `도메인: ${projectContext.domain || 'Service Design'}`,
    `현재 X축: ${currentAxis.xAxis || projectContext.axes?.xAxis || 'FEASIBILITY'}`,
    `현재 Y축: ${currentAxis.yAxis || projectContext.axes?.yAxis || 'USER VALUE'}`,
    `아이디어: ${JSON.stringify(idea)}`,
    '',
    '형식:',
    '{',
    '  "description": "프로젝트 맥락에 맞춘 설명 2문장",',
    '  "pros": ["장점 1", "장점 2", "장점 3"],',
    '  "cons": ["단점 1", "단점 2", "단점 3"],',
    '  "features": ["대표 서비스 기능 1개"],',
    '  "goals": ["대표 서비스 목표 1개"]',
    '}',
    '',
    'pros와 cons는 각각 3개, features와 goals는 각각 1개만 작성하세요.',
    '각 항목은 36자 이내의 간결한 한 줄 문장으로 작성하세요.',
    '중복 수식어와 배경 설명은 빼고 핵심 행동, 가치, 위험만 남기세요.',
  ].join('\n');
}

function makeFallbackKeywords(text = '', domain = 'Service Design') {
  const normalized = text.trim();
  if (!normalized) {
    return [
      '지속가능한 라이프스타일', 'AI 기반 개인화', '로컬 커뮤니티 연결',
      '디지털 헬스케어', '감성 기록 서비스', '도시 재생 플랫폼',
      '비대면 학습 경험', '크리에이터 경제', '노인 복지 기술', '제로웨이스트 소비',
    ];
  }

  const dictionary = [
    { test: /노인|고령|시니어|치매|회고|기억/, values: ['노인 회고 기록', '인지 건강 케어', '가족 연결 서비스', '추억 아카이브', '음성 기반 기록'] },
    { test: /환경|친환경|제로|지속|재활용|탄소/, values: ['탄소 절감 행동', '제로웨이스트 소비', '순환 자원 플랫폼', '친환경 인증', '리필 스테이션'] },
    { test: /교육|학습|수업|학생|튜터/, values: ['맞춤 학습 코칭', '실습형 교육 경험', 'AI 튜터링', '학습 동기 설계', '진도 추적 대시보드'] },
    { test: /건강|수면|운동|병원|멘탈|감정/, values: ['건강 루틴 코칭', '감정 패턴 분석', '수면 환경 개선', '예방 케어 서비스', '웨어러블 연동'] },
    { test: /공간|도시|지역|동네|커뮤니티/, values: ['지역 커뮤니티 연결', '공간 기반 큐레이션', '동네 자원 공유', '하이퍼로컬 매칭', '도시 문제 해결'] },
    { test: /창작|스토리|콘텐츠|글|영상|디자인/, values: ['AI 창작 보조', '스토리텔링 자동화', '콘텐츠 큐레이션', '크리에이터 워크플로', '브랜드 서사 생성'] },
  ];
  const matched = dictionary.flatMap(item => item.test.test(normalized) ? item.values : []);
  const domainHints = {
    'UX/UI & Product': ['사용자 여정 개선', '인터랙션 프로토타입'],
    'Brand & Identity': ['브랜드 경험 설계', '정체성 시각화'],
    'Game Design': ['몰입형 플레이', '보상 루프 설계'],
    'Space Design': ['공간 경험 동선', '체험형 전시'],
    'Service Design': ['서비스 여정 설계', '접점 경험 개선'],
  };
  return [...new Set([
    ...matched,
    ...(domainHints[domain] || domainHints['Service Design']),
    'AI 기반 개인화',
    '사용자 데이터 활용',
    '프로토타입 검증',
    '커뮤니티 참여',
  ])].slice(0, 10);
}

export async function requestGptKeywords({ text, domain = 'Service Design', projectContext = {} }) {
  const parsed = await requestGptJson(buildPrompt({
    text,
    mode: 'keywords',
    projectContext: { ...projectContext, idea: text, domain },
  }), { bypassCircuit: true, throwOnError: true });
  const rawKeywords = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.keywords) ? parsed.keywords : [];
  if (!rawKeywords.length) throw new Error('GPT가 추천 아이디어를 반환하지 않았습니다.');
  const keywords = rawKeywords
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.replace(/^#+/, '').trim())
    .slice(0, 10);
  if (!keywords.length) throw new Error('GPT 추천 아이디어 형식이 올바르지 않습니다.');
  return keywords;
}

export async function requestGptKeyword({ text, domain = 'Service Design', index = 0, projectContext = {} }) {
  const fallback = makeFallbackKeywords(text, domain);
  const parsed = await requestGptJson(buildPrompt({
    text,
    mode: 'keyword',
    count: index + 1,
    projectContext: { ...projectContext, idea: text, domain },
  }));
  const keyword = Array.isArray(parsed) ? parsed[0] : parsed?.keyword || parsed;
  if (typeof keyword !== 'string' || !keyword.trim()) return fallback[index % fallback.length];
  return keyword.replace(/^#+/, '').trim();
}

function getNextCritiqueTopicKey(currentTopicKey) {
  const topics = buildCritiqueTopics();
  const currentIndex = topics.findIndex(topic => topic.key === currentTopicKey);
  return topics[currentIndex + 1]?.key || null;
}

function getIdeaEvidence(idea = {}) {
  const detailPanel = idea.detailPanel || {};
  const detailFeature = Array.isArray(detailPanel.features) ? detailPanel.features.find(Boolean) : null;
  const detailCon = Array.isArray(detailPanel.cons) ? detailPanel.cons.find(Boolean) : null;
  const detailGoal = Array.isArray(detailPanel.goals) ? detailPanel.goals.find(Boolean) : null;
  const feature = Array.isArray(idea.features) ? idea.features.find(Boolean) : null;
  const con = Array.isArray(idea.cons) ? idea.cons.find(Boolean) : null;
  return detailFeature || detailCon || detailPanel.description || detailGoal || feature || con || idea.desc || idea.summary || idea.title || '선택 아이디어';
}

function ensureCritiqueHasEvidence(critique, idea = {}) {
  const text = String(critique || '').trim();
  if (!text) return text;
  const candidates = [
    idea.detailPanel?.description,
    idea.desc,
    ...(Array.isArray(idea.detailPanel?.features) ? idea.detailPanel.features : []),
    ...(Array.isArray(idea.detailPanel?.goals) ? idea.detailPanel.goals : []),
    ...(Array.isArray(idea.detailPanel?.pros) ? idea.detailPanel.pros : []),
    ...(Array.isArray(idea.detailPanel?.cons) ? idea.detailPanel.cons : []),
    ...(Array.isArray(idea.features) ? idea.features : []),
    ...(Array.isArray(idea.cons) ? idea.cons : []),
  ]
    .filter(Boolean)
    .map(item => String(item).replace(/\s+/g, ' ').trim())
    .filter(item => item.length >= 6);
  const normalizedCritique = text.replace(/\s+/g, ' ');
  const citesEvidence = candidates.some(candidate => (
    normalizedCritique.includes(candidate.slice(0, Math.min(18, candidate.length)))
  ));
  if (citesEvidence || /[“"'][^”"']{6,}[”"']/.test(text)) return text;
  return `“${shortenText(getIdeaEvidence(idea), 54)}”를 근거로 보면, ${text}`;
}

function buildCritiqueFallback({ idea, userNote, currentTopic }) {
  const topic = currentTopic || buildCritiqueTopics()[0];
  const evidence = shortenText(getIdeaEvidence(idea), 54);
  const reflection = userNote.trim()
    ? `방금 말씀하신 “${shortenText(userNote.trim(), 46)}” 관점은 ${topic.label}을 좁혀보는 데 도움이 됩니다.`
    : null;
  const critiqueByTopic = {
    assumption: `“${evidence}”를 보면, 사용자가 이걸 자주 필요로 할지 아직 조금 더 확인해보면 좋겠어요.`,
    userRisk: `“${evidence}”는 처음 쓰는 사람이 바로 이해하기엔 살짝 낯설 수 있어요. 첫 화면에서 뭘 해야 하는지 더 단순해야 할 것 같아요.`,
    buildRisk: `“${evidence}”를 처음부터 다 만들려고 하면 일이 커질 수 있어요. 먼저 손으로 운영해도 되는 부분을 나눠보면 좋겠습니다.`,
    fit: `“${evidence}”는 방향은 좋아요. 다만 이 주제에서 왜 꼭 필요한지 한 문장으로 더 선명하게 말할 수 있으면 강해질 것 같아요.`,
  };
  const questionByTopic = {
    assumption: '먼저 누구에게 물어보면 이 아이디어가 진짜 필요한지 가장 빨리 알 수 있을까요?',
    userRisk: '처음 쓰는 사람이 딱 하나만 해보게 만든다면, 어떤 행동부터 보여주는 게 좋을까요?',
    buildRisk: '처음 버전에서 꼭 자동화해야 하는 부분과 사람이 대신해도 되는 부분을 나누면 어떻게 될까요?',
    fit: '이 아이디어가 이번 프로젝트 주제와 잘 맞는 이유를 한 문장으로 말하면 뭐가 될까요?',
  };
  return {
    reflection,
    critique: critiqueByTopic[topic.key] || critiqueByTopic.assumption,
    question: questionByTopic[topic.key] || questionByTopic.assumption,
    topicStatus: 'continue',
    nextTopicKey: null,
  };
}

export async function requestGptCritique({
  idea,
  userNote = '',
  conversation = [],
  currentTopic,
  projectContext = getProjectContext(),
}) {
  const fallback = buildCritiqueFallback({ idea, userNote, currentTopic });
  const parsed = await requestGptJson(buildCritiquePrompt({
    idea,
    userNote,
    conversation,
    currentTopic,
    projectContext,
  }));
  if (!parsed || Array.isArray(parsed)) return fallback;

  const reflection = typeof parsed.reflection === 'string' && parsed.reflection.trim()
    ? parsed.reflection.trim()
    : (userNote.trim() ? fallback.reflection : null);
  const rawCritique = typeof parsed.critique === 'string' && parsed.critique.trim()
    ? parsed.critique.trim()
    : fallback.critique;
  const critique = ensureCritiqueHasEvidence(rawCritique, idea);
  const question = typeof parsed.question === 'string' && parsed.question.trim().endsWith('?')
    ? parsed.question.trim()
    : fallback.question;
  const topicStatus = parsed.topicStatus === 'resolved' ? 'resolved' : 'continue';

  return {
    reflection,
    critique,
    question,
    topicStatus,
    nextTopicKey: topicStatus === 'resolved'
      ? (parsed.nextTopicKey || getNextCritiqueTopicKey(currentTopic?.key))
      : null,
  };
}

export async function requestGptIdeaDetail({ idea, projectContext = getProjectContext(), currentAxis = {} }) {
  const normalizeDetailList = (items, fallback, limit = 3) => {
    const source = Array.isArray(items) && items.length ? items : fallback;
    return (source || []).slice(0, limit).map((item) => {
      const text = typeof item === 'string' ? item : `${item.name || ''} ${item.desc || ''}`;
      return shortenText(text, 42);
    });
  };
  const parsed = await requestGptJson(buildDetailPrompt({ idea, projectContext, currentAxis }), { throwOnError: true });
  if (!parsed || Array.isArray(parsed)) {
    return {
      description: idea.desc,
      pros: normalizeDetailList(null, idea.pros),
      cons: normalizeDetailList(null, idea.cons),
      features: normalizeDetailList(null, idea.features, 1),
      goals: normalizeDetailList(null, idea.goals, 1),
    };
  }
  return {
    description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description : idea.desc,
    pros: normalizeDetailList(parsed.pros, idea.pros),
    cons: normalizeDetailList(parsed.cons, idea.cons),
    features: normalizeDetailList(parsed.features, idea.features, 1),
    goals: normalizeDetailList(parsed.goals, idea.goals, 1),
  };
}

const DETAIL_ITEM_LABELS = {
  pro: '장점',
  con: '단점',
  feature: '서비스 기능',
  goal: '서비스 목표',
};

export async function requestGptDetailItem({
  type,
  idea,
  existingItems = [],
  projectContext = getProjectContext(),
}) {
  const label = DETAIL_ITEM_LABELS[type];
  if (!label) throw new Error('지원하지 않는 AI 생성 항목입니다.');
  const prompt = [
    '당신은 서비스 기획 전문가입니다.',
    `선택된 아이디어에 추가할 새로운 ${label} 1개를 생성하세요.`,
    '',
    `프로젝트: ${projectContext.idea || '미정'}`,
    `도메인: ${projectContext.domain || 'Service Design'}`,
    `아이디어: ${JSON.stringify(idea)}`,
    `기존 ${label}: ${JSON.stringify(existingItems)}`,
    '',
    '규칙:',
    '- 기존 항목과 의미가 겹치지 않아야 합니다.',
    '- 현재 아이디어와 프로젝트 맥락에 구체적으로 맞아야 합니다.',
    '- 한국어 36자 이내의 간결한 한 문장으로 작성하세요.',
    '- JSON 객체만 반환하세요.',
    '',
    '{"item":"새로운 항목"}',
  ].join('\n');
  const parsed = await requestGptJson(prompt, { temperature: 0.8, bypassCircuit: true, throwOnError: true });
  const item = typeof parsed?.item === 'string' ? shortenText(parsed.item.trim(), 42) : '';
  if (!item) throw new Error(`GPT가 새 ${label}을 반환하지 않았습니다. 다시 시도해 주세요.`);
  if (existingItems.some(existing => String(existing).trim() === item)) {
    throw new Error(`GPT가 기존 ${label}과 같은 내용을 반환했습니다. 다시 시도해 주세요.`);
  }
  return item;
}

export async function requestGptProjectThumbnail({
  projectContext = getProjectContext(),
  ideas = [],
} = {}) {
  const title = projectContext.title || projectContext.idea || '완료된 프로젝트';
  const ideaDigest = (Array.isArray(ideas) ? ideas : [])
    .slice(0, 6)
    .map((idea, index) => `${index + 1}. ${idea.title || '아이디어'} - ${idea.desc || idea.summary || ''}`)
    .join('\n');
  const imagePrompt = [
    'Create a polished square archive thumbnail image for a service design project.',
    'No text, no letters, no numbers, no logos, no UI labels, no signage, no watermark.',
    'The image must clearly show the project subject as recognizable visual objects or people.',
    'If the project is about elderly or senior services, show a warm, respectful older adult as the main subject.',
    'If the project is about VR or immersive service, show a visible VR headset or immersive device.',
    'If the project is about health, show a human-centered health or care scene.',
    'If the project is about environment or plants, show living greenery or sustainable objects.',
    'Style: premium editorial product thumbnail, cinematic lighting, dark background with neon lime accents, realistic but slightly stylized, clean composition, no typography.',
    '',
    `Project title: ${title}`,
    `Project topic: ${projectContext.idea || projectContext.input || title}`,
    `Domain: ${projectContext.domain || 'Service Design'}`,
    ideaDigest ? `Representative ideas:\n${ideaDigest}` : 'Representative ideas: none',
  ].join('\n');
  const fallbackSpec = {
    title,
    subtitle: projectContext.domain || 'Service Design',
    motif: 'idea map',
    searchText: `${title} ${projectContext.idea || ''} ${projectContext.input || ''} ${ideaDigest}`,
    palette: ['#CBFF00', '#77E8FF', '#FF6B8A'],
  };

  let timeoutId = null;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    timeoutId = controller ? setTimeout(() => controller.abort(), 90000) : null;
    const response = await fetch('/api/openai/image', {
      method: 'POST',
      signal: controller?.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: imagePrompt,
        size: '1024x1024',
        quality: 'low',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.image) {
      throw new Error(data.error || `OpenAI image request failed (${response.status})`);
    }
    return data.image;
  } catch (error) {
    console.warn('Failed to generate project thumbnail with GPT', error);
    return buildProjectThumbnailDataUrl(fallbackSpec);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function requestGptJson(prompt, { systemPrompt, temperature = 0.7, bypassCircuit = false, throwOnError = false } = {}) {
  if (!OPENAI_ENABLED) {
    if (throwOnError) throw new Error('OpenAI API 기능이 비활성화되어 있습니다.');
    return null;
  }
  if (!bypassCircuit && isGptCircuitOpen()) {
    if (throwOnError) throw new Error('잠시 후 다시 시도해 주세요.');
    return null;
  }
  const system = systemPrompt || DEFAULT_OPENAI_SYSTEM_PROMPT;
  const cacheKey = JSON.stringify({ prompt, system, temperature });
  if (pendingGptRequests.has(cacheKey)) return pendingGptRequests.get(cacheKey);

  const request = (async () => {
    let timeoutId = null;
    let controller = null;
    try {
      controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller) timeoutId = setTimeout(() => controller.abort(), 45000);
      if (controller) activeGptControllers.add(controller);
      const response = await fetch('/api/openai/generate', {
        method: 'POST',
        signal: controller?.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          system,
          temperature,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorText = data.error || `OpenAI request failed (${response.status})`;
        if (response.status === 429) {
          const quotaExhausted = /insufficient_quota|quota/i.test(errorText);
          openGptCircuit(quotaExhausted ? OPENAI_QUOTA_CIRCUIT_TTL_MS : OPENAI_CIRCUIT_TTL_MS);
          activeGptControllers.forEach(activeController => {
            if (activeController !== controller) activeController.abort();
          });
          if (!gptQuotaWarningShown) {
            console.info('OpenAI API quota is exhausted. AI requests are paused temporarily and local fallback data will be used.');
            gptQuotaWarningShown = true;
          }
        } else {
          console.warn(`OpenAI request failed (${response.status})`, errorText);
        }
        if (throwOnError) throw new Error(errorText);
        return null;
      }
      const raw = data.content || '';
      closeGptCircuit();
      return JSON.parse(raw);
    } catch (error) {
      if (error?.name === 'AbortError' && isGptCircuitOpen()) return null;
      console.warn('OpenAI request failed', error);
      if (throwOnError) throw error;
      return null;
    } finally {
      if (controller) activeGptControllers.delete(controller);
      if (timeoutId) clearTimeout(timeoutId);
    }
  })().finally(() => pendingGptRequests.delete(cacheKey));

  pendingGptRequests.set(cacheKey, request);
  return request;
}



function buildFinalPlanPrompt({ idea, projectContext, referenceIdeas = [] }) {
  const referenceText = referenceIdeas.length
    ? `\n참고 아이디어:\n${referenceIdeas.map((i, idx) => `${idx + 1}. ${i.title}: ${i.desc}`).join('\n')}`
    : '';
  return [
    '당신은 비즈니스 기획안 작성 전문가입니다. 선택된 아이디어를 7개 항목의 상세한 기획안으로 전개하세요.',
    '',
    'Input Idea:',
    JSON.stringify(idea),
    '',
    'Project Context:',
    `프로젝트 주제: ${projectContext.idea || '미정'}`,
    `디자인 도메인: ${projectContext.domain || 'Service Design'}`,
    referenceText,
    '',
    'Output: JSON으로만 다음 형식으로 반환하세요.',
    '{',
    '  "ideaName": "아이디어의 공식 이름 (25자 이내)",',
    '  "oneSentenceSummary": "한 줄 요약 (35자 이내)",',
    '  "problemDefinition": "타겟 사용자가 겪는 구체적인 문제 정의 (70~100자)",',
    '  "targetUser": "타겟 사용자의 상세 정의 (65~90자)",',
    '  "coreFeatures": "이 아이디어의 핵심 기능 3가지를 bullet 형태로 (총 80~120자)",',
    '  "differentiation": "기존 유사 서비스와의 차별화 포인트 (75~110자)",',
    '  "expectedEffect": "기대되는 사용자 효과 및 비즈니스 임팩트 (75~110자)"',
    '}',
    '',
    'Constraint:',
    '- 모든 필드는 한국어로만 작성',
    '- 각 항목의 글자 수 제한을 지켜서 작성',
    '- coreFeatures는 "• 기능1\\n• 기능2\\n• 기능3" 형식',
    '- 너무 추상적이지 말고 구체적이고 실행 가능한 내용으로 작성',
  ].join('\n');
}

export async function requestGptQuadrants({ xAxis, yAxis, projectContext = getProjectContext(), fallback }) {
  const prompt = [
    '당신은 아이디어 평가 매트릭스를 설계하는 서비스 디자인 전문가입니다.',
    'X축과 Y축의 조작적 정의를 바탕으로 네 사분면의 의미를 짧고 분명한 한국어 이름으로 정의하세요.',
    '각 이름은 4~12자의 쉬운 한국어이며 서로 겹치지 않아야 합니다. 영어, 전문 용어, 괄호 표현은 피하세요.',
    '단순히 "둘 다 높음"처럼 축 값을 반복하지 말고, 처음 보는 사람도 해당 영역의 아이디어를 어떻게 다뤄야 하는지 즉시 이해할 수 있는 전략적 의미를 표현하세요.',
    '',
    `프로젝트 주제: ${projectContext.idea || '일반 아이디어 평가'}`,
    `디자인 도메인: ${projectContext.domain || 'Service Design'}`,
    `X축: ${xAxis.name_ko} (${xAxis.name_en})`,
    `X축 정의: ${xAxis.operational_definition.summary}`,
    `X축 LOW: ${xAxis.anchors.low || xAxis.anchors.low_risk || ''}`,
    `X축 HIGH: ${xAxis.anchors.high || xAxis.anchors.high_risk || ''}`,
    `Y축: ${yAxis.name_ko} (${yAxis.name_en})`,
    `Y축 정의: ${yAxis.operational_definition.summary}`,
    `Y축 LOW: ${yAxis.anchors.low || yAxis.anchors.low_risk || ''}`,
    `Y축 HIGH: ${yAxis.anchors.high || yAxis.anchors.high_risk || ''}`,
    '',
    'JSON 객체만 반환하세요:',
    '{"high_high":"X높음·Y높음 영역명","high_low":"X높음·Y낮음 영역명","low_high":"X낮음·Y높음 영역명","low_low":"X낮음·Y낮음 영역명","rationale":"이 조합이 아이디어 평가에 주는 의미를 설명하는 한 문장"}',
  ].join('\n');
  const parsed = await requestGptJson(prompt);
  if (!parsed || Array.isArray(parsed)) return fallback;

  const keys = ['high_high', 'high_low', 'low_high', 'low_low'];
  if (!keys.every(key => typeof parsed[key] === 'string' && parsed[key].trim())) return fallback;
  return {
    high_high: parsed.high_high.trim().slice(0, 18),
    high_low: parsed.high_low.trim().slice(0, 18),
    low_high: parsed.low_high.trim().slice(0, 18),
    low_low: parsed.low_low.trim().slice(0, 18),
    rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : fallback.rationale,
  };
}

function formatAxisForPrompt(axis) {
  return [
    `- id: ${axis.id}`,
    `  name: ${axis.name_ko} (${axis.name_en})`,
    `  type: ${axis.axis_type}`,
    `  polarity: ${axis.polarity}`,
    `  definition: ${axis.operational_definition?.summary || ''}`,
    `  question: ${axis.evaluation_question || ''}`,
    `  anchors: ${JSON.stringify(axis.anchors || {})}`,
    `  rubric: ${JSON.stringify(axis.scoring_rubric || [])}`,
  ].join('\n');
}

function buildAxisEvaluationPrompt({ idea, activeAxes, xAxisId, yAxisId }) {
  const axesDefinitions = activeAxes.map(formatAxisForPrompt).join('\n\n');
  const ideaText = JSON.stringify({
    node_id: String(idea.id || idea.title || ''),
    title: idea.title,
    summary: idea.summary,
    desc: idea.desc,
    features: idea.features,
    goals: idea.goals,
    pros: idea.pros,
    cons: idea.cons,
  });
  return axisFramework.prompt_template.user
    .replace('{axes_definitions}', axesDefinitions)
    .replace('{idea}', ideaText)
    .replace('{x_axis}', xAxisId)
    .replace('{y_axis}', yAxisId);
}

export async function requestAxisEvaluation({
  idea,
  activeAxisIds = EVALUATION_AXIS_IDS,
  xAxisId = getProjectContext().axes?.xAxis || DEFAULT_X_AXIS_ID,
  yAxisId = getProjectContext().axes?.yAxis || DEFAULT_Y_AXIS_ID,
} = {}) {
  const normalizedX = normalizeAxisId(xAxisId, DEFAULT_X_AXIS_ID);
  const normalizedY = normalizeAxisId(yAxisId, DEFAULT_Y_AXIS_ID);
  const activeAxes = activeAxisIds
    .map(axisId => getAxisDefinition(normalizeAxisId(axisId, axisId)))
    .filter(Boolean);
  if (!idea || !activeAxes.length) return null;
  const parsed = await requestGptJson(
    buildAxisEvaluationPrompt({ idea, activeAxes, xAxisId: normalizedX, yAxisId: normalizedY }),
    {
      systemPrompt: axisFramework.prompt_template.system,
      temperature: 0.1,
    },
  );
  return normalizeAxisEvaluationPayload(parsed, idea, normalizedX, normalizedY);
}

export async function ensureIdeaAxisEvaluation(idea, projectContext = getProjectContext(), { allowAi = true } = {}) {
  if (hasCompleteAxisEvaluation(idea)) return idea;
  const xAxisId = normalizeAxisId(projectContext.axes?.xAxis, DEFAULT_X_AXIS_ID);
  const yAxisId = normalizeAxisId(projectContext.axes?.yAxis, DEFAULT_Y_AXIS_ID);
  const fallbackEvaluation = makeLocalAxisEvaluation(idea, projectContext, xAxisId, yAxisId);
  if (!allowAi || !OPENAI_ENABLED || isGptCircuitOpen()) {
    return {
      ...idea,
      evaluations: { ...fallbackEvaluation.evaluations, ...(idea?.evaluations || {}) },
      risk: idea?.risk || fallbackEvaluation.risk,
      position: idea?.position || fallbackEvaluation.position,
    };
  }
  const evaluation = await requestAxisEvaluation({
    idea,
    activeAxisIds: EVALUATION_AXIS_IDS,
    xAxisId,
    yAxisId,
  });
  if (!evaluation) {
    return {
      ...idea,
      evaluations: { ...fallbackEvaluation.evaluations, ...(idea?.evaluations || {}) },
      risk: idea?.risk || fallbackEvaluation.risk,
      position: idea?.position || fallbackEvaluation.position,
    };
  }
  const evaluations = { ...fallbackEvaluation.evaluations, ...evaluation.evaluations };
  return {
    ...idea,
    evaluations,
    risk: evaluation.risk || fallbackEvaluation.risk,
    position: {
      ...fallbackEvaluation.position,
      ...evaluation.position,
      x: getEvaluationScore({ evaluations }, xAxisId),
      y: getEvaluationScore({ evaluations }, yAxisId),
    },
  };
}

export async function ensureIdeasAxisEvaluation(ideas = [], projectContext = getProjectContext(), concurrency = 4, options = {}) {
  const sourceIdeas = Array.isArray(ideas) ? ideas : [];
  if (!sourceIdeas.length) return [];
  if (sourceIdeas.every(hasCompleteAxisEvaluation)) return sourceIdeas;
  return mapWithConcurrency(sourceIdeas, concurrency, idea => ensureIdeaAxisEvaluation(idea, projectContext, options));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function requestGptIdea({
  text,
  sourceIdeas = [],
  mode = 'generate',
  wx,
  wy,
  projectContext = getProjectContext(),
  temperature = 0.7,
  bypassCircuit = false,
}) {
  const fallback = makeFallbackIdea({ text, sourceIdeas, mode, wx, wy, projectContext });
  const parsed = await requestGptJson(buildPrompt({ text, sourceIdeas, mode, projectContext }), {
    temperature,
    bypassCircuit,
  });
  if (!parsed || Array.isArray(parsed)) return fallback;
  const idea = {
    ...fallback,
    ...parsed,
    id: fallback.id,
    wx,
    wy,
    aiGenerated: false,
    generationSource: 'openai',
    showAiBadge: false,
    tag: mode === 'combine' ? 'AI_BONDING' : normalizeTag(parsed.tag || makeTagFromText(`${parsed.title || fallback.title} ${(parsed.keywords || []).join(' ')}`, hashScore(parsed.title))),
    summary: shortenText(parsed.summary || fallback.summary, 35),
    desc: shortenText(parsed.desc || parsed.summary || fallback.desc, 70),
    stars: 0,
    keywords: normalizeKeywords(parsed.keywords, fallback.keywords),
    features: Array.isArray(parsed.features) && parsed.features.length ? parsed.features : fallback.features,
    goals: Array.isArray(parsed.goals) && parsed.goals.length ? parsed.goals : fallback.goals,
    pros: Array.isArray(parsed.pros) && parsed.pros.length ? parsed.pros : fallback.pros,
    cons: Array.isArray(parsed.cons) && parsed.cons.length ? parsed.cons : fallback.cons,
  };
  return ensureIdeaAxisEvaluation(idea, projectContext);
}

export async function requestGptIdeaList({ count = 9, projectContext = getProjectContext(), evaluateWithAi = true, onProgress } = {}) {
  const targetCount = Math.max(1, Math.min(40, Number(count) || 9));
  const items = [];
  let batchSize = Math.min(5, targetCount);
  let attempts = 0;
  let consecutiveFailures = 0;
  const maxAttempts = Math.max(targetCount * 4, 24);

  const toIdeaArray = parsed => (Array.isArray(parsed) ? parsed : Array.isArray(parsed?.ideas) ? parsed.ideas : []);
  const isUsableIdea = idea => {
    const title = String(idea?.title || '').trim();
    const desc = String(idea?.desc || idea?.summary || '').trim();
    return title
      && desc
      && !NUMERIC_FALLBACK_TITLE_PATTERN.test(title)
      && !items.some(existing => existing.title.trim() === title);
  };

  while (items.length < targetCount) {
    attempts += 1;
    if (attempts > maxAttempts) {
      throw new Error(`GPT가 발산 아이디어 ${targetCount}개 중 ${items.length}개만 생성했습니다. 잠시 후 다시 시도해 주세요.`);
    }

    const requestedCount = Math.min(batchSize, targetCount - items.length);
    const temperature = Math.min(1, 0.78 + consecutiveFailures * 0.04);
    let parsed = null;
    try {
      parsed = await requestGptJson(buildPrompt({
        text: projectContext.idea,
        mode: 'list',
        projectContext,
        count: requestedCount,
        sourceIdeas: items,
      }), { bypassCircuit: true, throwOnError: true, temperature });
    } catch (error) {
      console.warn(`GPT idea list batch failed. Retrying with a smaller batch. (${items.length}/${targetCount})`, error);
      consecutiveFailures += 1;
      batchSize = Math.max(1, Math.floor(batchSize / 2));
      continue;
    }
    const batch = toIdeaArray(parsed)
      .filter(isUsableIdea)
      .slice(0, requestedCount);

    if (!batch.length) {
      console.warn(`GPT returned no usable ideas after ${items.length}/${targetCount}. Retrying as single-item requests.`);
      consecutiveFailures += 1;
      batchSize = 1;
      continue;
    }

    batch.forEach((idea) => {
      items.push(idea);
      if (typeof onProgress === 'function') {
        const index = items.length - 1;
        onProgress({
          id: index + 1,
          tag: normalizeTag(idea.tag || makeTagFromText(`${idea.title} ${(idea.keywords || []).join(' ')}`, index), `IDEA_${index + 1}`),
          title: idea.title.trim(),
          desc: shortenText(idea.desc || idea.summary || '', 90),
          summary: shortenText(idea.summary || idea.desc || '', 35),
          keywords: normalizeKeywords(idea.keywords, []),
          stars: 0,
          evaluations: null,
          risk: { level: 'none', reasons: [] },
          aiGenerated: true,
          generationSource: 'openai',
        }, index, targetCount);
      }
    });
    consecutiveFailures = 0;
    if (batch.length < requestedCount) batchSize = 1;
    else if (batchSize < 5 && consecutiveFailures === 0) batchSize += 1;
  }

  const normalizedIdeas = items.slice(0, targetCount).map((idea, index) => ({
    id: index + 1,
    tag: normalizeTag(idea.tag || makeTagFromText(`${idea.title} ${(idea.keywords || []).join(' ')}`, index), `IDEA_${index + 1}`),
    title: idea.title.trim(),
    desc: shortenText(idea.desc || idea.summary || '', 90),
    summary: shortenText(idea.summary || idea.desc || '', 35),
    keywords: normalizeKeywords(idea.keywords, []),
    stars: 0,
    evaluations: null,
    risk: { level: 'none', reasons: [] },
    aiGenerated: true,
    generationSource: 'openai',
  }));
  return ensureIdeasAxisEvaluation(normalizedIdeas, projectContext, 4, { allowAi: evaluateWithAi });
}


export async function requestFinalPlan({ idea, projectContext = getProjectContext(), referenceIdeas = [] }) {
  const ideaTitle = idea?.title || '새로운 기획안';
  const ideaDesc = idea?.desc || idea?.summary || `${ideaTitle}을 프로젝트 주제에 맞게 구체화한 서비스 아이디어입니다.`;
  const featureItems = Array.isArray(idea?.features) && idea.features.length
    ? idea.features
    : [`${ideaTitle} 핵심 경험 설계`, '사용자 상황 기반 추천', '실행 결과 기록 및 피드백'];
  const goalItems = Array.isArray(idea?.goals) && idea.goals.length
    ? idea.goals
    : ['사용자의 핵심 문제를 빠르게 해결', '반복 사용 가능한 서비스 가치 검증'];
  const pros = Array.isArray(idea?.pros) && idea.pros.length ? idea.pros : [];
  const keywords = Array.isArray(idea?.keywords) && idea.keywords.length ? idea.keywords.join(', ') : '핵심 키워드';
  const fallback = {
    ideaName: ideaTitle,
    oneSentenceSummary: shortenText(idea?.summary || ideaDesc, 35),
    problemDefinition: shortenText(`${projectContext.idea || '현재 프로젝트'} 맥락에서 사용자가 겪는 불편을 ${ideaTitle}로 해결합니다. ${ideaDesc}`, 100),
    targetUser: shortenText(`${projectContext.domain || '서비스'} 영역에서 ${ideaDesc}에 공감하고 빠른 해결 경험을 원하는 사용자입니다.`, 90),
    coreFeatures: featureItems.slice(0, 3).map(item => `• ${item}`).join('\n'),
    differentiation: shortenText(`${keywords}를 중심으로 ${pros[0] || '사용자 맥락에 맞춘 구체적 실행 방식'}을 제공해 유사 서비스와 차별화합니다.`, 110),
    expectedEffect: shortenText(`${goalItems.slice(0, 2).join(' 및 ')}을 통해 사용자 만족도와 서비스 검증 가능성을 높입니다.`, 110),
  };
  const parsed = await requestGptJson(buildFinalPlanPrompt({ idea, projectContext, referenceIdeas }));
  if (!parsed || Array.isArray(parsed)) return fallback;
  return {
    ideaName: parsed.ideaName || fallback.ideaName,
    oneSentenceSummary: parsed.oneSentenceSummary || fallback.oneSentenceSummary,
    problemDefinition: parsed.problemDefinition || fallback.problemDefinition,
    targetUser: parsed.targetUser || fallback.targetUser,
    coreFeatures: parsed.coreFeatures || fallback.coreFeatures,
    differentiation: parsed.differentiation || fallback.differentiation,
    expectedEffect: parsed.expectedEffect || fallback.expectedEffect,
  };
}

export function toCanvasIdeas(ideas, count = 40) {
  const sourceIdeas = ideas.length >= count ? ideas : [
    ...ideas,
    ...Array.from({ length: count - ideas.length }, (_, index) => makeFallbackIdea({
      text: `확장 아이디어 ${index + 1}`,
      projectContext: getProjectContext(),
    })),
  ];
  const projectContext = getProjectContext();
  const xAxisId = normalizeAxisId(projectContext.axes?.xAxis, DEFAULT_X_AXIS_ID);
  const yAxisId = normalizeAxisId(projectContext.axes?.yAxis, DEFAULT_Y_AXIS_ID);
  const preparedIdeas = sourceIdeas.slice(0, count).map((idea, index) => ({
    idea,
    index,
  }));
  const buildRankMap = (axisId) => {
    const sorted = [...preparedIdeas].sort((a, b) => (
      getEvaluationScore(a.idea, axisId) - getEvaluationScore(b.idea, axisId) || a.index - b.index
    ));
    return new Map(sorted.map((item, rank) => [
      item.index,
      sorted.length === 1 ? 50 : 12 + (rank / (sorted.length - 1)) * 76,
    ]));
  };
  const xRanks = buildRankMap(xAxisId);
  const yRanks = buildRankMap(yAxisId);
  const placed = [];

  return preparedIdeas.map(({ idea, index }) => {
    const xScore = xRanks.get(index) ?? 50;
    const yScore = yRanks.get(index) ?? 50;
    const angle = index * 2.399963;
    let wx = 140 + (xScore / 100) * 3480 - 120 + Math.cos(angle) * 76;
    let wy = 140 + ((100 - yScore) / 100) * 2580 - 70 + Math.sin(angle) * 64;

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const close = placed.find(point => Math.hypot(point.cx - (wx + 120), point.cy - (wy + 70)) < 300);
      if (!close) break;
      const pushAngle = angle + attempt * 0.92;
      const pushDistance = 86 + Math.floor(attempt / 6) * 52;
      wx += Math.cos(pushAngle) * pushDistance;
      wy += Math.sin(pushAngle) * pushDistance;
    }

    wx = Math.round(Math.max(80, Math.min(3680, wx)));
    wy = Math.round(Math.max(80, Math.min(2740, wy)));
    placed.push({ cx: wx + 120, cy: wy + 70 });

    const full = makeFallbackIdea({
      text: idea.title,
      projectContext,
      wx,
      wy,
    });
    return {
      ...full,
      ...idea,
      id: idea.id || full.id,
      wx,
      wy,
      summary: idea.summary || full.summary,
      stars: Number(idea.stars) === 1 ? 1 : 0,
      evaluations: idea.evaluations || full.evaluations || null,
      risk: idea.risk || full.risk || { level: 'none', reasons: [] },
      position: {
        x_axis: xAxisId,
        y_axis: yAxisId,
        x: getEvaluationScore(idea, xAxisId),
        y: getEvaluationScore(idea, yAxisId),
      },
      axisPosition: {
        xAxis: xAxisId,
        yAxis: yAxisId,
        xScore: getEvaluationScore(idea, xAxisId),
        yScore: getEvaluationScore(idea, yAxisId),
        wx,
        wy,
        locked: true,
      },
      positionLocked: true,
      pros: idea.pros || full.pros,
      cons: idea.cons || full.cons,
      features: idea.features || full.features,
      goals: idea.goals || full.goals,
      aiGenerated: idea.aiGenerated ?? false,
      showAiBadge: ['regenerated', 'whitespace'].includes(idea.aiBadgeType),
    };
  });
}
