// Firefox: chrome.* здесь коллбэчный, browser.* — промисифицированный. Выравниваем.
if (typeof browser !== 'undefined' && browser.runtime?.id) {
  globalThis.chrome = browser;
}

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
    useApiParser: $('#useApiParser').checked,
    useRssDiscovery: $('#useRssDiscovery').checked,
    batchDelayMs: Math.max(1500, parseInt($('#batchDelay').value, 10) || 3000),
    redownloadAfterDays: Math.max(0, parseInt($('#redownloadAfterDays').value, 10) || 0),
    showFloatingButton: $('#showFloatingButton').checked,
    enableNotifications: $('#enableNotifications').checked,
    enableContextMenu: $('#enableContextMenu').checked,
    watchEnabled: $('#watchEnabled').checked,
    watchIntervalMinutes: Math.max(5, parseInt($('#watchInterval').value, 10) || 15),
    watchMaxPages: Math.min(5, Math.max(1, parseInt($('#watchMaxPages').value, 10) || 1)),
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
  $('#useApiParser').checked = s.useApiParser !== false;
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

const JOURNAL_STATUS = {
  ok: ['✓', 'ok'],
  skip: ['–', 'skip'],
  warn: ['!', 'warn'],
  error: ['×', 'err'],
};

function renderJournal(entries) {
  const box = $('#journalList');
  if (!entries?.length) {
    const empty = document.createElement('p');
    empty.className = 'help';
    empty.textContent = 'Пока пусто — журнал заполнится при первой загрузке.';
    box.replaceChildren(empty);
    return;
  }
  box.replaceChildren();
  entries.forEach((e) => {
    const [icon, cls] = JOURNAL_STATUS[e.status] || ['·', ''];
    const row = document.createElement('div');
    row.className = `journal__row journal__row--${cls}`;

    const time = new Date(e.time).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const head = document.createElement('div');
    head.className = 'journal__head';
    head.textContent = `${icon} ${time}`;

    const body = document.createElement('div');
    body.className = 'journal__body';
    body.textContent = e.message || e.filename || e.url || '';

    const link = document.createElement('a');
    link.className = 'journal__link';
    link.href = e.url || '#';
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = e.url ? e.url.replace('https://habr.com', '') : '';

    row.append(head, body);
    if (e.url) row.append(link);
    box.append(row);
  });
}

async function loadJournal() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_JOURNAL', limit: 100 });
  if (res?.success) renderJournal(res.journal);
}

$('#journalRefreshBtn').addEventListener('click', loadJournal);

$('#journalClearBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_JOURNAL' });
  renderJournal([]);
});

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#panel-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'journal') loadJournal();
  });
});

// <label class="chip"> сам переключает вложенный input — своя обработка клика
// отменяла это обратно, и чипы визуально не нажимались. Слушаем только change.
$$('.chip input').forEach((input) => {
  input.addEventListener('change', syncChips);
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

// Firefox MV3 выдаёт host-permissions по запросу, а не при установке
async function checkHostPermission() {
  try {
    const origins = ['https://habr.com/*'];
    const granted = await chrome.permissions.contains({ origins });
    $('#permBanner').hidden = granted;
    if (granted) return;
    $('#permBtn').onclick = async () => {
      const ok = await chrome.permissions.request({ origins });
      $('#permBanner').hidden = ok;
    };
  } catch {
    $('#permBanner').hidden = true;
  }
}

(async function init() {
  await checkHostPermission();
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
