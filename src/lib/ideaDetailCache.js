const DETAIL_CACHE_KEY = 'neo-node-idea-detail-cache';

const getLocalStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage || null;
};

const getSessionStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage || null;
};

export const getIdeaDetailCacheEntryKey = (projectContext = {}, idea = {}) => {
  const projectId = projectContext?.projectId || 'local';
  const ideaKey = String(idea?.id || idea?.title || 'unknown');
  return `${projectId}:${ideaKey}`;
};

export function readIdeaDetailCache(projectContext, idea) {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const cache = JSON.parse(storage.getItem(DETAIL_CACHE_KEY) || '{}');
    const entryKey = getIdeaDetailCacheEntryKey(projectContext, idea);
    if (cache[entryKey]) return cache[entryKey];

    // Migrate detail edits saved by earlier versions from sessionStorage.
    const sessionStorage = getSessionStorage();
    const sessionCache = JSON.parse(sessionStorage?.getItem(DETAIL_CACHE_KEY) || '{}');
    if (!sessionCache[entryKey]) return null;
    cache[entryKey] = sessionCache[entryKey];
    storage.setItem(DETAIL_CACHE_KEY, JSON.stringify(cache));
    return cache[entryKey];
  } catch {
    return null;
  }
}

export function writeIdeaDetailCache(projectContext, idea, detail) {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    const cache = JSON.parse(storage.getItem(DETAIL_CACHE_KEY) || '{}');
    cache[getIdeaDetailCacheEntryKey(projectContext, idea)] = {
      ...detail,
      cachedAt: new Date().toISOString(),
    };
    storage.setItem(DETAIL_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to save idea detail cache', error);
  }
}
