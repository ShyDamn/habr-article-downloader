/* global HabrApi, HabrFetch */
const HabrApi = (() => {
  const BASE = 'https://habr.com/kek/v2';

  function articleUrl(articleId, lang = 'ru') {
    return `${BASE}/articles/${articleId}/?fl=${lang}&hl=${lang}`;
  }

  function commentsUrl(articleId, lang = 'ru') {
    return `${BASE}/articles/${articleId}/comments/?fl=${lang}&hl=${lang}`;
  }

  async function fetchJson(url) {
    const text = await HabrFetch.fetchText(url, {
      headers: { Accept: 'application/json' },
    });
    return JSON.parse(text);
  }

  function isVisible(c) {
    if (!c) return false;
    if (c.isSuspended) return false;
    if (c.status && c.status !== 'published') return false;
    return true;
  }

  function mapComment(c) {
    return {
      id: String(c.id ?? ''),
      parentId: c.parentId != null ? String(c.parentId) : null,
      level: Number.isFinite(c.level) ? c.level : 0,
      author: c.author?.alias || c.author?.fullname || 'anonymous',
      score: Number.isFinite(c.score) ? c.score : null,
      time: c.timePublished || null,
      isArticleAuthor: Boolean(c.isPostAuthor || c.isPublicationAuthor),
      isPinned: Boolean(c.isPinned),
      html: c.message || '',
    };
  }

  // API отдаёт плоскую карту comments, порядок веток в threads[], детей в children[].
  // Обходим в глубину: сортировка по времени оторвала бы ответы от их комментариев.
  function normalizeCommentTree(payload) {
    const raw = payload?.comments;
    if (!raw) return [];

    const byId = new Map();
    const source = Array.isArray(raw) ? raw : Object.values(raw);
    source.forEach((c) => {
      if (c?.id != null) byId.set(String(c.id), c);
    });

    const threads = Array.isArray(payload.threads) ? payload.threads.map(String) : [];
    if (!threads.length) {
      return source
        .filter(isVisible)
        .sort((a, b) => Date.parse(a.timePublished || 0) - Date.parse(b.timePublished || 0))
        .map(mapComment);
    }

    const out = [];
    const seen = new Set();

    const walk = (id) => {
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      const node = byId.get(key);
      if (!node) return;
      if (isVisible(node)) out.push(mapComment(node));
      (node.children || []).forEach(walk);
    };

    threads.forEach(walk);
    source.forEach((c) => {
      const key = String(c?.id ?? '');
      if (key && !seen.has(key) && isVisible(c)) out.push(mapComment(c));
    });

    return out;
  }

  async function fetchComments(articleId, options = {}) {
    const limit = options.limit || 500;
    const payload = await fetchJson(commentsUrl(articleId, options.lang || 'ru'));
    return normalizeCommentTree(payload).slice(0, limit);
  }

  async function fetchArticle(articleId, options = {}) {
    return fetchJson(articleUrl(articleId, options.lang || 'ru'));
  }

  return { articleUrl, commentsUrl, fetchComments, fetchArticle, normalizeCommentTree };
})();
