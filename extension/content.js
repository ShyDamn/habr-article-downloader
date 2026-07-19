(function initHabrDownloaderUi() {
  const PUBLICATION_PATH_RE = /\/(?:companies\/[^/]+\/)?(?:articles|news|post)\/\d+/;

  let fabEnabled = true;
  let lastPath = location.pathname;
  let feedObserver = null;
  let syncTimer = null;

  function scheduleSync(delay = 400) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncUi, delay);
  }

  function normalizePublicationUrl(raw) {
    try {
      const url = new URL(raw, location.origin);
      if (!url.hostname.includes('habr.com')) return null;
      if (!PUBLICATION_PATH_RE.test(url.pathname)) return null;
      const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
      return `${url.origin}${path}`;
    } catch {
      return null;
    }
  }

  function isPublicationPath(pathname = location.pathname) {
    return PUBLICATION_PATH_RE.test(pathname);
  }

  function getPublicationUrlFromPage() {
    if (isPublicationPath()) {
      return normalizePublicationUrl(location.href);
    }

    const canonical = document.querySelector('link[rel="canonical"]')?.href
      || document.querySelector('meta[property="og:url"]')?.content;
    const fromCanonical = normalizePublicationUrl(canonical || '');
    if (fromCanonical) return fromCanonical;

    if (document.querySelector('.tm-article-presenter, .post__body')) {
      const titleLink = document.querySelector(
        'h1.tm-title a[href*="/articles/"], h1.tm-title a[href*="/news/"], h1.tm-title a[href*="/post/"]',
      );
      if (titleLink) return normalizePublicationUrl(titleLink.href);
    }

    const expandedBody = document.querySelector(
      '.tm-articles-list__item .article-formatted-body, article.tm-articles-list__item .article-formatted-body',
    );
    if (expandedBody) {
      const item = expandedBody.closest('article.tm-articles-list__item, .tm-articles-list__item');
      return getCardUrl(item);
    }

    return null;
  }

  function isFeedPage() {
    return Boolean(document.querySelector('.tm-articles-list, .tm-feed, .tm-posts-list, .tm-news-list'))
      && !isPublicationPath();
  }

  function isOurNode(node) {
    return node?.nodeType === 1 && (
      node.classList?.contains('habr-md-btn')
      || node.classList?.contains('habr-md-toast')
      || Boolean(node.closest?.('.habr-md-btn, .habr-md-toast'))
    );
  }

  function resetButtonState(btn) {
    btn.classList.remove(
      'habr-md-btn--loading',
      'habr-md-btn--success',
      'habr-md-btn--skip',
      'habr-md-btn--error',
    );
    delete btn.dataset.habrMdBusy;
    btn.disabled = false;
    const label = btn.querySelector('.habr-md-label');
    if (label) label.textContent = '.md';
    btn.title = btn.dataset.defaultTitle || 'Скачать в Markdown';
  }

  function showToast(btn, text, type = 'info') {
    const host = btn.closest('.habr-md-host') || btn.parentElement;
    if (!host) return;

    let toast = host.querySelector(':scope > .habr-md-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'habr-md-toast';
      host.appendChild(toast);
    }

    toast.className = `habr-md-toast habr-md-toast--${type}`;
    toast.textContent = text;
    toast.hidden = false;

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.hidden = true;
    }, 4000);
  }

  async function downloadUrl(url, button) {
    const label = button.querySelector('.habr-md-label') || button;

    button.dataset.habrMdBusy = '1';
    button.disabled = true;
    button.classList.remove('habr-md-btn--success', 'habr-md-btn--skip', 'habr-md-btn--error');
    button.classList.add('habr-md-btn--loading');
    label.textContent = '…';
    showToast(button, 'Скачиваю…', 'info');

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_URL',
        url,
        skipFilters: true,
      });

      if (!result?.success || result.result?.error) {
        throw new Error(result?.result?.error || result?.error || 'Ошибка скачивания');
      }

      button.classList.remove('habr-md-btn--loading');

      if (result.result?.skipped) {
        button.classList.add('habr-md-btn--skip');
        label.textContent = '—';
        const msg = result.result.reason === 'downloaded'
          ? 'Уже скачано ранее'
          : 'Пропущено фильтром';
        showToast(button, msg, 'skip');
      } else {
        button.classList.add('habr-md-btn--success');
        label.textContent = '✓';
        const file = result.result?.filename || result.result?.path?.split('/').pop() || 'файл .md';
        showToast(button, `Сохранено: ${file}`, 'success');
      }
    } catch (err) {
      button.classList.remove('habr-md-btn--loading');
      button.classList.add('habr-md-btn--error');
      label.textContent = '!';
      button.title = err.message;
      showToast(button, err.message, 'error');
    } finally {
      setTimeout(() => {
        if (button.isConnected) resetButtonState(button);
      }, 3500);
    }
  }

  function removeButtons(selector) {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.dataset.habrMdBusy) return;
      el.remove();
    });
  }

  function removeAllButtons() {
    document.querySelectorAll('.habr-md-btn').forEach((el) => {
      if (!el.dataset.habrMdBusy) el.remove();
    });
    document.querySelectorAll('.habr-md-toast').forEach((el) => el.remove());
    document.querySelectorAll('.habr-md-host').forEach((host) => {
      if (!host.querySelector('.habr-md-btn[data-habr-md-busy]')) {
        host.classList.remove('habr-md-host');
      }
    });
  }

  function createDownloadButton(url, variant) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `habr-md-btn habr-md-btn--${variant}`;
    btn.dataset.url = url;
    btn.dataset.defaultTitle = 'Скачать в Markdown';
    btn.title = btn.dataset.defaultTitle;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v2H5v-2z"/></svg>
      <span class="habr-md-label">.md</span>
    `;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadUrl(btn.dataset.url || url, btn);
    });
    return btn;
  }

  function mountArticleButton(url) {
    if (!fabEnabled || !url) return;

    const host = document.querySelector('.tm-article-presenter__snippet')
      || document.querySelector('.tm-article-presenter__header .article-snippet')
      || document.querySelector('.tm-article-presenter__header')
      || document.querySelector('.tm-article-presenter');

    if (!host) return;

    host.classList.add('habr-md-host');

    let btn = host.querySelector('.habr-md-btn--article');
    if (btn) {
      if (!btn.dataset.habrMdBusy) btn.dataset.url = url;
      return;
    }

    btn = createDownloadButton(url, 'article');
    host.insertBefore(btn, host.firstChild);
  }

  function getCardUrl(card) {
    if (!card) return null;
    const link = card.querySelector(
      'a.tm-title__link[href], a[data-article-link="true"][href], h2.tm-title a[href], a[href*="/articles/"], a[href*="/news/"], a[href*="/post/"]',
    );
    if (link) return normalizePublicationUrl(link.href);
    const id = card.id;
    if (id && /^\d+$/.test(id)) {
      return normalizePublicationUrl(`${location.origin}/ru/articles/${id}/`);
    }
    return null;
  }

  function injectFeedButtons() {
    if (!fabEnabled || !isFeedPage()) return;

    document.querySelectorAll('article.tm-articles-list__item, .tm-articles-list__item').forEach((card) => {
      const url = getCardUrl(card);
      if (!url) return;

      const host = card.querySelector('.article-snippet') || card;
      host.classList.add('habr-md-host');

      let btn = host.querySelector('.habr-md-btn--feed');
      if (btn) {
        if (!btn.dataset.habrMdBusy) btn.dataset.url = url;
        return;
      }

      btn = createDownloadButton(url, 'feed');
      host.insertBefore(btn, host.firstChild);
    });
  }

  function syncUi() {
    if (!fabEnabled) return;

    const pathChanged = location.pathname !== lastPath;
    if (pathChanged) {
      lastPath = location.pathname;
      removeAllButtons();
    }

    if (isFeedPage()) {
      removeButtons('.habr-md-btn--article');
      injectFeedButtons();
      return;
    }

    removeButtons('.habr-md-btn--feed');

    const url = getPublicationUrlFromPage();
    if (url && document.querySelector('.tm-article-presenter, .post__body')) {
      mountArticleButton(url);
    } else {
      removeButtons('.habr-md-btn--article');
    }
  }

  function isRelevantMutation(mutations) {
    for (const mutation of mutations) {
      if (isOurNode(mutation.target)) continue;

      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1 || isOurNode(node)) continue;
        if (node.matches?.('.tm-articles-list__item, .tm-article-presenter, .tm-articles-list, .article-snippet')) {
          return true;
        }
        if (node.querySelector?.('.tm-articles-list__item, .tm-article-presenter')) return true;
      }
    }
    return false;
  }

  function watchRouteChanges() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function pushStatePatched(...args) {
      origPush.apply(this, args);
      scheduleSync(0);
    };

    history.replaceState = function replaceStatePatched(...args) {
      origReplace.apply(this, args);
      scheduleSync(0);
    };

    window.addEventListener('popstate', () => scheduleSync(0));
  }

  function watchDomChanges() {
    if (feedObserver) feedObserver.disconnect();

    const root = document.querySelector('.tm-layout, main.tm-layout__container, body');

    feedObserver = new MutationObserver((mutations) => {
      if (!isRelevantMutation(mutations)) return;
      scheduleSync();
    });

    feedObserver.observe(root, { childList: true, subtree: true });
  }

  chrome.storage.local.get(['showFloatingButton'], (data) => {
    fabEnabled = data.showFloatingButton !== false;
    syncUi();
    watchRouteChanges();
    watchDomChanges();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('showFloatingButton' in changes)) return;
    fabEnabled = changes.showFloatingButton.newValue !== false;
    if (!fabEnabled) removeAllButtons();
    else syncUi();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_ARTICLE') {
      const url = getPublicationUrlFromPage() || location.href;
      sendResponse(HabrParser.extractPublicationFromDocument(document, url, {
        includeComments: message.includeComments !== false,
      }));
    }
    return false;
  });
})();
