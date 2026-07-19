const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function showNotice(el, text, type = '') {
  if (!text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = type ? `notice notice--${type}` : 'notice';
}

function readFilterSettings() {
  return {
    filterTypes: $$('input[name="filterTypes"]:checked').map((el) => el.value),
    filterScore: $('#filterScore').value || 'all',
    filterComplexity: $('#filterComplexity').value || 'all',
    filterHubsExclude: $('#filterHubsExclude').value.trim(),
    filterTagsExclude: $('#filterTagsExclude').value.trim(),
  };
}

function applyFilterSettings(s) {
  $$('input[name="filterTypes"]').forEach((el) => {
    el.checked = (s.filterTypes || ['articles']).includes(el.value);
  });
  $('#filterScore').value = s.filterScore || '100';
  $('#filterComplexity').value = s.filterComplexity || 'all';
  $('#filterHubsExclude').value = s.filterHubsExclude || '';
  $('#filterTagsExclude').value = s.filterTagsExclude || '';
  syncChips();
}

function syncChips() {
  $$('.chip input').forEach((input) => {
    input.parentElement.classList.toggle('chip--on', input.checked);
  });
}

function readAllSettings() {
  return {
    ...readFilterSettings(),
    downloadFolder: $('#downloadFolder').value.trim() || 'downloads',
    filenameTemplate: $('#filenameTemplate').value.trim() || '{id}_{title}',
    subfolderByType: $('#subfolderByType').checked,
    subfolderByHub: $('#subfolderByHub').checked,
    downloadComments: $('#downloadComments').checked,
    downloadImages: $('#downloadImages').checked,
    useRssDiscovery: $('#useRssDiscovery').checked,
    batchDelayMs: Math.max(1500, parseInt($('#batchDelay').value, 10) || 3000),
    redownloadAfterDays: Math.max(0, parseInt($('#redownloadAfterDays').value, 10) || 0),
    showFloatingButton: $('#showFloatingButton').checked,
    enableNotifications: $('#enableNotifications').checked,
    enableContextMenu: $('#enableContextMenu').checked,
    watchEnabled: $('#watchEnabled').checked,
    watchIntervalMinutes: Math.max(5, parseInt($('#watchInterval').value, 10) || 15),
    watchMaxPages: Math.min(3, Math.max(1, parseInt($('#watchMaxPages').value, 10) || 1)),
    watchMaxDownloadsPerCycle: Math.min(20, Math.max(1, parseInt($('#watchMaxDownloads').value, 10) || 5)),
    watchSources: $('#watchSources').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
  };
}

function applySettings(s) {
  applyFilterSettings(s);
  $('#downloadFolder').value = s.downloadFolder || 'downloads';
  $('#filenameTemplate').value = s.filenameTemplate || '{id}_{title}';
  $('#subfolderByType').checked = Boolean(s.subfolderByType);
  $('#subfolderByHub').checked = Boolean(s.subfolderByHub);
  $('#downloadComments').checked = s.downloadComments !== false;
  $('#downloadImages').checked = Boolean(s.downloadImages);
  $('#useRssDiscovery').checked = Boolean(s.useRssDiscovery);
  $('#batchDelay').value = s.batchDelayMs ?? 3000;
  $('#redownloadAfterDays').value = s.redownloadAfterDays ?? 0;
  $('#showFloatingButton').checked = s.showFloatingButton !== false;
  $('#enableNotifications').checked = Boolean(s.enableNotifications);
  $('#enableContextMenu').checked = s.enableContextMenu !== false;
  $('#watchEnabled').checked = Boolean(s.watchEnabled);
  $('#watchInterval').value = s.watchIntervalMinutes ?? 15;
  $('#watchMaxPages').value = s.watchMaxPages ?? 1;
  $('#watchMaxDownloads').value = s.watchMaxDownloadsPerCycle ?? 5;
  $('#watchSources').value = (s.watchSources || ['https://habr.com/ru/feed/']).join('\n');
}

async function saveSettings() {
  const settings = readAllSettings();
  if (!settings.filterTypes.length) {
    throw new Error('Выберите хотя бы один тип публикации');
  }
  const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  if (!res?.success) throw new Error(res?.error || 'Ошибка сохранения');
  return res.settings;
}

function formatBatchProgress(batch) {
  if (!batch) return '';
  if (batch.running) {
    return `${batch.done}/${batch.total} · скачано ${batch.ok}, пропущено ${batch.skipped}${batch.failed ? `, ошибок ${batch.failed}` : ''}`;
  }
  if (!batch.total) return '';
  return `Готово: ${batch.ok} скачано, ${batch.skipped} пропущено${batch.failed ? `, ${batch.failed} ошибок` : ''}`;
}

function formatWatchProgress(watch) {
  if (!watch) return '';
  if (watch.skipped && watch.lastError) return watch.lastError;
  if (watch.skipped) return 'Включите слежение переключателем выше';
  if (watch.running) return 'Проверяю ленту…';
  const t = watch.checkedAt ? new Date(watch.checkedAt).toLocaleTimeString() : '';
  return `${t}: найдено ${watch.found}, скачано ${watch.downloaded}, пропущено ${watch.skipped}${watch.lastError ? `\n${watch.lastError}` : ''}`;
}

async function pollState() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!res?.success) return;

  const batchText = formatBatchProgress(res.batch);
  if (batchText) showNotice($('#batchProgress'), batchText);

  const watchText = formatWatchProgress(res.watch);
  if (watchText) showNotice($('#watchProgress'), watchText);

  if (res.batch?.running || res.watch?.running) {
    setTimeout(pollState, 2000);
  }
}

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#panel-${tab.dataset.tab}`).classList.add('active');
  });
});

$$('.chip').forEach((chip) => {
  chip.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const input = chip.querySelector('input');
    input.checked = !input.checked;
    syncChips();
  });
});

$$('input[name="filterTypes"]').forEach((el) => {
  el.addEventListener('change', syncChips);
});

$('#batchFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const current = $('#batchLinks').value.trim();
  $('#batchLinks').value = current ? `${current}\n${text}` : text;
  event.target.value = '';
});

$('#batchBtn').addEventListener('click', async () => {
  const btn = $('#batchBtn');
  btn.disabled = true;
  showNotice($('#batchProgress'), 'Запуск…');
  try {
    await saveSettings();
    const res = await chrome.runtime.sendMessage({
      type: 'BATCH_DOWNLOAD',
      text: $('#batchLinks').value,
      source: 'popup-batch',
    });
    if (!res?.success) throw new Error(res?.error || 'Ошибка');
    showNotice($('#batchProgress'), `В очереди ${res.queued} ссылок…`);
    pollState();
  } catch (err) {
    showNotice($('#batchProgress'), err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

$('#saveWatchBtn').addEventListener('click', async () => {
  try {
    await saveSettings();
    showNotice($('#watchProgress'), 'Сохранено', 'ok');
  } catch (err) {
    showNotice($('#watchProgress'), err.message, 'err');
  }
});

$('#watchNowBtn').addEventListener('click', async () => {
  try {
    await saveSettings();
    showNotice($('#watchProgress'), 'Запуск…');
    const res = await chrome.runtime.sendMessage({ type: 'RUN_WATCH_NOW' });
    if (!res?.success) throw new Error(res?.error || 'Ошибка');
    showNotice($('#watchProgress'), res.started ? 'Проверка в фоне…' : formatWatchProgress(res.result));
    pollState();
  } catch (err) {
    showNotice($('#watchProgress'), err.message, 'err');
  }
});

$('#saveSettingsBtn').addEventListener('click', async () => {
  try {
    await saveSettings();
    showNotice($('#settingsStatus'), 'Сохранено', 'ok');
  } catch (err) {
    showNotice($('#settingsStatus'), err.message, 'err');
  }
});

$('#clearIdsBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_DOWNLOADED_IDS' });
  showNotice($('#settingsStatus'), 'История сброшена', 'ok');
});

$('#exportSettingsBtn').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'EXPORT_SETTINGS' });
  if (!res?.success) return;
  const blob = new Blob([res.json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: 'habr-downloader-settings.json', saveAs: true });
  URL.revokeObjectURL(url);
});

$('#importSettingsBtn').addEventListener('click', () => $('#importSettingsFile').click());

$('#importSettingsFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const json = await file.text();
  const res = await chrome.runtime.sendMessage({ type: 'IMPORT_SETTINGS', json });
  if (res?.success) {
    applySettings(res.settings);
    showNotice($('#settingsStatus'), 'Импортировано', 'ok');
  }
  event.target.value = '';
});

(async function init() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (res?.success) applySettings(res.settings);
  syncChips();

  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (state?.success) {
    if (formatBatchProgress(state.batch)) showNotice($('#batchProgress'), formatBatchProgress(state.batch));
    if (formatWatchProgress(state.watch)) showNotice($('#watchProgress'), formatWatchProgress(state.watch));
    if (state.batch?.running || state.watch?.running) pollState();
  }
})();
