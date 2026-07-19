/* global HabrParser, HabrCore, HabrFilters, HabrFetch, HabrRss, HabrJournal, HabrFilename, HabrMarkdown */
const HabrCore = (() => {
  const DEFAULT_SETTINGS = {
    downloadFolder: 'downloads',
    watchEnabled: false,
    watchIntervalMinutes: 15,
    watchSources: ['https://habr.com/ru/feed/'],
    watchMaxPages: 1,
    watchMaxDownloadsPerCycle: 5,
    watchMaxItemsScan: 25,
    watchMaxFetchesPerCycle: 8,
    useRssDiscovery: false,
    filterTypes: ['articles'],
    filterScore: '100',
    filterComplexity: 'all',
    filterHubsInclude: '',
    filterHubsExclude: 'блог компании',
    filterTagsInclude: '',
    filterTagsExclude: '',
    batchDelayMs: 3000,
    downloadImages: false,
    downloadComments: true,
    filenameTemplate: '{id}_{title}',
    subfolderByType: false,
    subfolderByHub: false,
    redownloadAfterDays: 0,
    maxDownloadedIds: 5000,
    downloadedIdsMaxAgeDays: 365,
    showFloatingButton: true,
    enableNotifications: false,
    enableContextMenu: true,
    downloadedIds: {},
  };

  const WATCH_ALARM = 'habr-watch';
  const BATCH_STATE_KEY = 'batchState';
  const WATCH_STATE_KEY = 'watchState';

  async function getSettings() {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    return { ...DEFAULT_SETTINGS, ...stored, ...HabrFilters.normalizeSettings(stored) };
  }

  async function saveSettings(partial) {
    await chrome.storage.local.set(partial);
    if ('watchEnabled' in partial || 'watchIntervalMinutes' in partial) {
      await syncWatchAlarm(await getSettings());
    }
  }

  async function setBadge(text, color = '#5b8fa8') {
    const value = text ? String(text).slice(0, 4) : '';
    await chrome.action.setBadgeText({ text: value });
    await chrome.action.setBadgeBackgroundColor({ color });
  }

  async function notify(title, message) {
    const settings = await getSettings();
    if (!settings.enableNotifications) return;
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title,
        message: message.slice(0, 240),
      });
    } catch {
      // notifications permission optional
    }
  }

  function sanitizeFolder(folder) {
    return String(folder || 'downloads')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.\./g, '')
      || 'downloads';
  }

  function markdownToDataUrl(markdown) {
    const base64 = btoa(unescape(encodeURIComponent(markdown)));
    return `data:text/markdown;charset=utf-8;base64,${base64}`;
  }

  async function downloadMarkdownToPath(markdown, relativePath) {
    return chrome.downloads.download({
      url: markdownToDataUrl(markdown),
      filename: relativePath.replace(/\\/g, '/'),
      conflictAction: 'uniquify',
      saveAs: false,
    });
  }

  async function downloadBinaryUrl(url, relativePath) {
    return chrome.downloads.download({
      url,
      filename: relativePath.replace(/\\/g, '/'),
      conflictAction: 'uniquify',
      saveAs: false,
    });
  }

  async function markDownloaded(publicationKey, options = {}) {
    const settings = await getSettings();
    settings.downloadedIds[publicationKey] = Date.now();
    await chrome.storage.local.set({ downloadedIds: settings.downloadedIds });
    if (options.prune !== false) {
      await pruneDownloadedIds();
    }
  }

  async function isDownloaded(publicationKey) {
    const settings = await getSettings();
    return Boolean(settings.downloadedIds[publicationKey]);
  }

  async function shouldRedownload(publicationKey, settings) {
    if (!publicationKey) return true;
    const ts = settings.downloadedIds[publicationKey];
    if (!ts) return true;
    if (!settings.redownloadAfterDays) return false;
    const ageMs = Date.now() - ts;
    return ageMs > settings.redownloadAfterDays * 86400000;
  }

  async function pruneDownloadedIds() {
    const settings = await getSettings();
    const entries = Object.entries(settings.downloadedIds || {});
    const maxAge = (settings.downloadedIdsMaxAgeDays || 365) * 86400000;
    const now = Date.now();

    let filtered = entries.filter(([, ts]) => now - ts <= maxAge);
    if (filtered.length > (settings.maxDownloadedIds || 5000)) {
      filtered = filtered.sort((a, b) => b[1] - a[1]).slice(0, settings.maxDownloadedIds);
    }

    await chrome.storage.local.set({
      downloadedIds: Object.fromEntries(filtered),
    });
  }

  async function migrateDownloadedIds() {
    const { downloadedIds = {} } = await chrome.storage.local.get('downloadedIds');
    let changed = false;
    const migrated = { ...downloadedIds };

    for (const [key, value] of Object.entries(downloadedIds)) {
      if (/^\d+$/.test(key)) {
        migrated[`articles:${key}`] = value;
        delete migrated[key];
        changed = true;
      }
    }

    if (changed) await chrome.storage.local.set({ downloadedIds: migrated });
  }

  function appendPageUrl(sourceUrl, page) {
    const url = new URL(sourceUrl);
    url.searchParams.set('page', String(page));
    return url.href;
  }

  async function discoverFromSource(sourceUrl, settings) {
    const items = new Map();
    const maxPages = Math.min(settings.watchMaxPages || 1, 3);
    const scanLimit = settings.watchMaxItemsScan || 25;

    if (settings.useRssDiscovery) {
      const rssItems = await HabrRss.discoverItems(sourceUrl, HabrFetch.fetchHtml, scanLimit);
      if (rssItems?.length) {
        rssItems.forEach((item) => items.set(item.url, item));
        return [...items.values()];
      }
    }

    for (let page = 1; page <= maxPages; page += 1) {
      const url = page === 1 ? sourceUrl : appendPageUrl(sourceUrl, page);
      const html = await HabrFetch.fetchHtml(url);
      const pageItems = HabrParser.extractPublicationsFromListHtml(html, url);
      if (!pageItems.length) break;

      for (const item of pageItems) {
        items.set(item.url, item);
        if (items.size >= scanLimit) break;
      }

      if (items.size >= scanLimit) break;

      let allKnown = true;
      for (const item of pageItems) {
        const key = HabrParser.getPublicationKey(item.url);
        if (key && !(await isDownloaded(key))) allKnown = false;
      }

      if (page > 1 && allKnown) break;
    }

    return [...items.values()];
  }

  async function downloadImagesForMarkdown(markdown, meta, settings) {
    if (!settings.downloadImages) return markdown;

    const imageRe = /!\[[^\]]*]\((https?:\/\/[^)]+)\)/g;
    const folderBase = HabrFilename.buildRelativeFolder(meta, settings);
    const imageFolder = `${folderBase}/images/${meta.publicationType}_${meta.articleId}`;
    const urlMap = {};
    let index = 0;

    const matches = [...markdown.matchAll(imageRe)];
    for (const match of matches) {
      const absolute = match[1];
      if (urlMap[absolute]) continue;
      index += 1;
      const ext = absolute.split('.').pop()?.split('?')[0]?.slice(0, 4) || 'img';
      const filename = `${String(index).padStart(2, '0')}.${ext}`.replace(/[^a-z0-9.]/gi, '');
      const relative = `images/${meta.publicationType}_${meta.articleId}/${filename}`;
      urlMap[absolute] = relative;
      try {
        await downloadBinaryUrl(absolute, `${imageFolder}/${filename}`);
        await HabrFetch.sleep(300);
      } catch {
        // keep remote URL
        delete urlMap[absolute];
      }
    }

    return HabrMarkdown.replaceImageUrls(markdown, urlMap);
  }

  async function downloadPublicationByUrl(url, settings, options = {}) {
    const normalized = HabrParser.normalizePublicationUrl(url);
    if (!normalized) {
      return { success: false, url, error: 'Некорректный URL публикации Habr' };
    }

    const publicationKey = HabrParser.getPublicationKey(normalized);
    const articleId = HabrParser.getPublicationId(normalized);

    const skipFilters = Boolean(options.skipFilters);

    if (!skipFilters && !HabrFilters.passesType(normalized, settings)) {
      return { success: true, url: normalized, articleId, publicationKey, skipped: true, reason: 'type' };
    }

    if (!skipFilters && options.preview && HabrFilters.canSkipByPreview(options.preview, settings)) {
      return { success: true, url: normalized, articleId, publicationKey, skipped: true, reason: 'filter' };
    }

    const already = publicationKey && await isDownloaded(publicationKey);
    const redownload = publicationKey && await shouldRedownload(publicationKey, settings);

    if (!options.force && already && !redownload) {
      return { success: true, url: normalized, articleId, publicationKey, skipped: true, reason: 'downloaded' };
    }

    try {
      const html = await HabrFetch.fetchHtml(normalized);
      const article = HabrParser.extractPublicationFromHtml(html, normalized, {
        includeComments: settings.downloadComments,
      });

      if (!article.success) {
        await HabrJournal.add({ action: 'download', url: normalized, status: 'error', message: article.error });
        return { success: false, url: normalized, articleId, publicationKey, error: article.error };
      }

      if (!skipFilters && !HabrFilters.passesFilters(article.meta, normalized, settings, options.preview)) {
        return { success: true, url: normalized, articleId, publicationKey, skipped: true, reason: 'filter' };
      }

      let markdown = article.markdown;
      markdown = await downloadImagesForMarkdown(markdown, article.meta, settings);

      const relativePath = HabrFilename.buildFullPath(article.meta, settings);
      await downloadMarkdownToPath(markdown, relativePath);

      if (publicationKey) await markDownloaded(publicationKey, { prune: false });

      await HabrJournal.add({
        action: 'download',
        url: normalized,
        status: 'ok',
        filename: relativePath.split('/').pop(),
        message: article.meta.title,
      });

      return {
        success: true,
        url: normalized,
        articleId,
        publicationKey,
        filename: relativePath.split('/').pop(),
        path: relativePath,
      };
    } catch (err) {
      await HabrJournal.add({ action: 'download', url: normalized, status: 'error', message: err.message });
      return { success: false, url: normalized, articleId, publicationKey, error: err.message };
    }
  }

  async function runBatch(urls, source = 'batch') {
    const settings = await getSettings();
    const uniqueUrls = [...new Set(urls.map((u) => HabrParser.normalizePublicationUrl(u)).filter(Boolean))];

    const state = {
      running: true,
      source,
      total: uniqueUrls.length,
      done: 0,
      ok: 0,
      skipped: 0,
      failed: 0,
      current: null,
      lastError: null,
      finishedAt: null,
    };
    await chrome.storage.local.set({ [BATCH_STATE_KEY]: state });
    await setBadge('…');

    for (const url of uniqueUrls) {
      state.current = url;
      await chrome.storage.local.set({ [BATCH_STATE_KEY]: { ...state } });
      await setBadge(`${state.done}/${state.total}`);

      const result = await downloadPublicationByUrl(url, settings);
      state.done += 1;
      if (result.success && result.skipped) state.skipped += 1;
      else if (result.success) state.ok += 1;
      else {
        state.failed += 1;
        state.lastError = result.error;
      }

      await chrome.storage.local.set({ [BATCH_STATE_KEY]: { ...state } });

      if (settings.batchDelayMs > 0) {
        await HabrFetch.sleep(settings.batchDelayMs);
      }
    }

    state.running = false;
    state.current = null;
    state.finishedAt = Date.now();
    await chrome.storage.local.set({ [BATCH_STATE_KEY]: state });
    await pruneDownloadedIds();
    await setBadge(state.ok ? `+${state.ok}` : '');
    setTimeout(() => setBadge(''), 8000);
    if (state.ok && settings.enableNotifications) {
      await notify('Habr Downloader', `Скачано: ${state.ok}, пропущено: ${state.skipped}`);
    }
    return state;
  }

  async function runWatchCycle(options = {}) {
    const settings = await getSettings();
    if (!options.manual && !settings.watchEnabled) return { skipped: true };

    if (HabrFetch.isRateLimited()) {
      return {
        skipped: true,
        running: false,
        lastError: 'Habr временно ограничил запросы. Подождите 2–3 минуты.',
      };
    }

    const watchState = {
      running: true,
      checkedAt: Date.now(),
      sources: settings.watchSources.length,
      found: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      fetches: 0,
      lastError: null,
    };
    await chrome.storage.local.set({ [WATCH_STATE_KEY]: watchState });
    await setBadge('…');

    const allItems = new Map();
    const maxPerCycle = settings.watchMaxDownloadsPerCycle || 5;
    const maxChecks = settings.watchMaxItemsScan || 25;
    const maxFetches = settings.watchMaxFetchesPerCycle || 8;

    try {
      for (const source of settings.watchSources) {
        const trimmed = source.trim();
        if (!trimmed) continue;
        try {
          const items = await discoverFromSource(trimmed, settings);
          items.forEach((item) => allItems.set(item.url, item));
        } catch (err) {
          watchState.lastError = err.message;
          if (err.name === 'RateLimitError') break;
        }
      }

      watchState.found = allItems.size;
      let downloadedThisCycle = 0;
      let checked = 0;

      for (const item of allItems.values()) {
        if (downloadedThisCycle >= maxPerCycle || checked >= maxChecks) break;
        checked += 1;

        const key = HabrParser.getPublicationKey(item.url);
        const already = key && await isDownloaded(key);
        const redownload = key && await shouldRedownload(key, settings);

        if (already && !redownload) {
          watchState.skipped += 1;
          continue;
        }

        if (!HabrFilters.passesType(item.url, settings)) {
          watchState.skipped += 1;
          continue;
        }

        if (HabrFilters.canSkipByPreview(item, settings)) {
          watchState.skipped += 1;
          continue;
        }

        if (watchState.fetches >= maxFetches) {
          watchState.skipped += 1;
          continue;
        }

        watchState.fetches += 1;
        const result = await downloadPublicationByUrl(item.url, settings, { preview: item });

        if (result.success && result.skipped) {
          watchState.skipped += 1;
        } else if (result.success) {
          watchState.downloaded += 1;
          downloadedThisCycle += 1;
        } else {
          watchState.failed += 1;
          watchState.lastError = result.error;
          if (String(result.error || '').includes('429')) break;
        }

        if (settings.batchDelayMs > 0) {
          await HabrFetch.sleep(settings.batchDelayMs);
        }
      }
    } catch (err) {
      watchState.lastError = err.message;
    }

    watchState.running = false;
    watchState.checkedAt = Date.now();
    await chrome.storage.local.set({ [WATCH_STATE_KEY]: watchState });
    await pruneDownloadedIds();
    await setBadge(watchState.downloaded ? `+${watchState.downloaded}` : '');
    setTimeout(() => setBadge(''), 8000);
    if (watchState.downloaded && settings.enableNotifications) {
      await notify('Habr Слежение', `Новых статей: ${watchState.downloaded}`);
    }
    return watchState;
  }

  async function syncWatchAlarm(settings) {
    await chrome.alarms.clear(WATCH_ALARM);
    if (settings.watchEnabled) {
      const period = Math.max(5, settings.watchIntervalMinutes || 15);
      await chrome.alarms.create(WATCH_ALARM, {
        delayInMinutes: period,
        periodInMinutes: period,
      });
    }
  }

  async function exportSettings() {
    const settings = await getSettings();
    const { downloadedIds, ...rest } = settings;
    return JSON.stringify({ ...rest, exportedAt: new Date().toISOString() }, null, 2);
  }

  async function importSettings(jsonText) {
    const parsed = JSON.parse(jsonText);
    delete parsed.exportedAt;
    delete parsed.downloadedIds;
    await saveSettings(parsed);
    return getSettings();
  }

  async function init() {
    await migrateDownloadedIds();
    const stored = await chrome.storage.local.get(null);
    const patches = {};
    if (stored.watchMaxFetchesPerCycle == null) patches.watchMaxFetchesPerCycle = 8;
    if (stored.watchMaxItemsScan == null) patches.watchMaxItemsScan = 25;
    if (Object.keys(patches).length) await chrome.storage.local.set(patches);
    await pruneDownloadedIds();
    const settings = await getSettings();
    await syncWatchAlarm(settings);
  }

  return {
    DEFAULT_SETTINGS,
    WATCH_ALARM,
    BATCH_STATE_KEY,
    WATCH_STATE_KEY,
    getSettings,
    saveSettings,
    exportSettings,
    importSettings,
    downloadMarkdownToPath,
    downloadPublicationByUrl,
    downloadArticleByUrl: (...args) => downloadPublicationByUrl(...args),
    markDownloaded,
    isDownloaded,
    runBatch,
    runWatchCycle,
    syncWatchAlarm,
    setBadge,
    notify,
    init,
    parseUrlsFromText: HabrParser.parseUrlsFromText,
  };
})();
