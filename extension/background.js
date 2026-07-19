importScripts(
  'lib/dom-shim.js',
  'lib/turndown.js',
  'lib/turndown-plugin-gfm.js',
  'utils/fetch-retry.js',
  'utils/rss.js',
  'utils/journal.js',
  'utils/filename.js',
  'markdown.js',
  'parser.js',
  'filters.js',
  'habr-core.js',
);

let batchPromise = null;
let watchPromise = null;
let menuSetupPromise = null;

async function setupContextMenus() {
  if (menuSetupPromise) return menuSetupPromise;

  menuSetupPromise = (async () => {
    const settings = await HabrCore.getSettings();
    await chrome.contextMenus.removeAll();

    if (!settings.enableContextMenu) return;

    await chrome.contextMenus.create({
      id: 'habr-download-page',
      title: 'Скачать Habr → Markdown',
      contexts: ['page'],
      documentUrlPatterns: ['https://habr.com/*'],
    });
    await chrome.contextMenus.create({
      id: 'habr-download-link',
      title: 'Скачать статью Habr',
      contexts: ['link'],
      targetUrlPatterns: [
        'https://habr.com/*/articles/*',
        'https://habr.com/*/news/*',
        'https://habr.com/*/post/*',
      ],
    });
    await chrome.contextMenus.create({
      id: 'habr-queue-link',
      title: 'Добавить в очередь пакета',
      contexts: ['link'],
      targetUrlPatterns: ['https://habr.com/*'],
    });
  })().finally(() => {
    menuSetupPromise = null;
  });

  return menuSetupPromise;
}

async function bootstrap() {
  await HabrCore.init();
  await setupContextMenus();
}

chrome.runtime.onInstalled.addListener(bootstrap);
chrome.runtime.onStartup.addListener(bootstrap);
bootstrap();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HabrCore.WATCH_ALARM) {
    if (watchPromise) return;
    watchPromise = HabrCore.runWatchCycle().finally(() => {
      watchPromise = null;
    });
    await watchPromise;
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const settings = await HabrCore.getSettings();
  if (!settings.enableContextMenu) return;

  if (info.menuItemId === 'habr-download-page' && info.pageUrl) {
    await HabrCore.downloadPublicationByUrl(info.pageUrl, settings, { skipFilters: true });
    return;
  }

  if (info.menuItemId === 'habr-download-link' && info.linkUrl) {
    await HabrCore.downloadPublicationByUrl(info.linkUrl, settings, { skipFilters: true });
    return;
  }

  if (info.menuItemId === 'habr-queue-link' && info.linkUrl) {
    if (batchPromise) return;
    batchPromise = HabrCore.runBatch([info.linkUrl], 'context-menu').finally(() => {
      batchPromise = null;
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'GET_SETTINGS':
          sendResponse({ success: true, settings: await HabrCore.getSettings() });
          break;

        case 'SAVE_SETTINGS':
          await HabrCore.saveSettings(message.settings || {});
          await setupContextMenus();
          sendResponse({ success: true, settings: await HabrCore.getSettings() });
          break;

        case 'GET_STATE': {
          const data = await chrome.storage.local.get([
            HabrCore.BATCH_STATE_KEY,
            HabrCore.WATCH_STATE_KEY,
          ]);
          sendResponse({
            success: true,
            batch: data[HabrCore.BATCH_STATE_KEY] || null,
            watch: data[HabrCore.WATCH_STATE_KEY] || null,
          });
          break;
        }

        case 'GET_JOURNAL':
          sendResponse({ success: true, journal: await HabrJournal.get(message.limit || 30) });
          break;

        case 'CLEAR_JOURNAL':
          await HabrJournal.clear();
          sendResponse({ success: true });
          break;

        case 'EXPORT_SETTINGS':
          sendResponse({ success: true, json: await HabrCore.exportSettings() });
          break;

        case 'IMPORT_SETTINGS':
          sendResponse({
            success: true,
            settings: await HabrCore.importSettings(message.json || '{}'),
          });
          break;

        case 'DOWNLOAD_MARKDOWN': {
          const settings = await HabrCore.getSettings();
          const path = message.path || `${settings.downloadFolder}/${message.filename}`;
          const downloadId = await HabrCore.downloadMarkdownToPath(message.markdown, path);
          if (message.publicationKey || message.articleId) {
            const key = message.publicationKey
              || (message.articleId ? `articles:${message.articleId}` : null);
            if (key) await HabrCore.markDownloaded(key);
          }
          sendResponse({ success: true, downloadId });
          break;
        }

        case 'DOWNLOAD_URL': {
          const settings = await HabrCore.getSettings();
          const result = await HabrCore.downloadPublicationByUrl(message.url, settings, {
            force: message.force,
            skipFilters: message.skipFilters !== false,
          });
          sendResponse({ success: result.success, result });
          break;
        }

        case 'BATCH_DOWNLOAD': {
          const urls = message.urls?.length
            ? message.urls
            : HabrCore.parseUrlsFromText(message.text || '');

          if (!urls.length) {
            sendResponse({ success: false, error: 'Не найдено ссылок на публикации Habr' });
            break;
          }

          if (batchPromise) {
            sendResponse({ success: false, error: 'Пакетное скачивание уже выполняется' });
            break;
          }

          sendResponse({ success: true, queued: urls.length });
          batchPromise = HabrCore.runBatch(urls, message.source || 'batch')
            .finally(() => { batchPromise = null; });
          break;
        }

        case 'RUN_WATCH_NOW': {
          if (watchPromise) {
            sendResponse({ success: false, error: 'Проверка уже выполняется' });
            break;
          }
          watchPromise = HabrCore.runWatchCycle({ manual: true }).finally(() => {
            watchPromise = null;
          });
          sendResponse({ success: true, started: true });
          break;
        }

        case 'CLEAR_DOWNLOADED_IDS':
          await chrome.storage.local.set({ downloadedIds: {} });
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});
