/* global HabrParser */
const HabrParser = (() => {
  const PUBLICATION_PATTERNS = {
    articles: /\/(?:companies\/[^/]+\/)?articles\/(\d+)/,
    news: /\/news\/(\d+)/,
    posts: /\/post\/(\d+)/,
  };

  const ARTICLE_URL_RE = PUBLICATION_PATTERNS.articles;

  function text(el) {
    return el?.textContent?.trim() || '';
  }

  function getPublicationType(url) {
    try {
      const path = new URL(url).pathname;
      if (PUBLICATION_PATTERNS.posts.test(path)) return 'posts';
      if (PUBLICATION_PATTERNS.news.test(path)) return 'news';
      if (PUBLICATION_PATTERNS.articles.test(path)) return 'articles';
    } catch {
      return null;
    }
    return null;
  }

  function getPublicationId(url) {
    const type = getPublicationType(url);
    if (!type) return null;
    const match = new URL(url).pathname.match(PUBLICATION_PATTERNS[type]);
    return match ? match[1] : null;
  }

  function getPublicationKey(url) {
    const type = getPublicationType(url);
    const id = getPublicationId(url);
    return type && id ? `${type}:${id}` : null;
  }

  function getArticleId(url) {
    return getPublicationId(url);
  }

  function isPublicationUrl(url) {
    return Boolean(getPublicationType(url));
  }

  function isArticleUrl(url) {
    return getPublicationType(url) === 'articles';
  }

  function normalizePublicationUrl(url) {
    try {
      const parsed = new URL(url, 'https://habr.com');
      if (!parsed.hostname.includes('habr.com') || !isPublicationUrl(parsed.href)) return null;
      const path = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
      return `https://habr.com${path}`;
    } catch {
      return null;
    }
  }

  function normalizeArticleUrl(url) {
    return normalizePublicationUrl(url);
  }

  function normalizeComplexity(value) {
    const v = String(value || '').toLowerCase();
    if (v.includes('easy') || v.includes('прост')) return 'easy';
    if (v.includes('medium') || v.includes('средн')) return 'medium';
    if (v.includes('hard') || v.includes('слож')) return 'hard';
    return null;
  }

  function normalizeComplexityFromClass(className = '') {
    if (/complexity-easy/i.test(className)) return 'easy';
    if (/complexity-medium/i.test(className)) return 'medium';
    if (/complexity-hard/i.test(className)) return 'hard';
    return null;
  }

  function parseRatingValue(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/\s+/g, '');
    const match = cleaned.match(/-?\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  function parseUrlsFromText(text) {
    const urls = new Set();
    const lines = String(text).split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const matches = trimmed.matchAll(/https?:\/\/[^\s]+/g);
      for (const match of matches) {
        const normalized = normalizePublicationUrl(match[0].replace(/[),.;]+$/, ''));
        if (normalized) urls.add(normalized);
      }
      if (!trimmed.includes(' ')) {
        const normalized = normalizePublicationUrl(trimmed);
        if (normalized) urls.add(normalized);
      }
    }
    return [...urls];
  }

  function getMetaList(doc, titleKeyword) {
    const lists = doc.querySelectorAll('.tm-article-presenter__meta .tm-separated-list');
    for (const list of lists) {
      const title = list.querySelector('.tm-separated-list__title');
      if (title && title.textContent.includes(titleKeyword)) {
        return [...list.querySelectorAll('.tm-separated-list__item span')]
          .map((el) => el.textContent.trim())
          .filter(Boolean);
      }
    }
    return [];
  }

  function getHubs(doc) {
    const hubs = [...doc.querySelectorAll('.tm-publication-hubs .tm-publication-hub__link')]
      .map((link) => {
        const span = link.querySelector('span');
        return span ? span.textContent.replace(/\s*\*\s*$/, '').trim() : '';
      })
      .filter(Boolean);

    return hubs.length ? hubs : getMetaList(doc, 'Хабы');
  }

  function getCorporateBlog(doc, pageUrl) {
    const companyLink = doc.querySelector('.tm-publication-hubs a[href*="/companies/"]');
    if (companyLink) {
      const span = companyLink.querySelector('span');
      if (span) return span.textContent.trim();
    }

    try {
      const match = new URL(pageUrl).pathname.match(/\/companies\/([^/]+)\//);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  function getRatingDetails(doc) {
    const scoreEl = doc.querySelector('.tm-votes-lever__score-counter');
    const rating = scoreEl ? parseInt(scoreEl.textContent.trim(), 10) : null;

    const voteItems = doc.querySelectorAll('.tm-votes-lever__vote');
    let up = null;
    let down = null;

    voteItems.forEach((item) => {
      const label = item.getAttribute('aria-label') || item.title || '';
      const countEl = item.querySelector('.tm-votes-lever__vote-count, .counter');
      const count = countEl ? parseInt(countEl.textContent.trim(), 10) : null;
      if (/положитель|plus|up|за/i.test(label)) up = count;
      if (/отрицатель|minus|down|против/i.test(label)) down = count;
    });

    return { rating: Number.isFinite(rating) ? rating : null, votes: { up, down } };
  }

  function getLabels(doc) {
    return [...new Set(
      [...doc.querySelectorAll('.tm-article-labels .publication-label span')]
        .map((el) => el.textContent.trim())
        .filter(Boolean),
    )];
  }

  function yamlQuote(value) {
    if (value == null || value === '') return '""';
    const str = String(value);
    if (/[:#\[\]{}&*!|>'"%@`]/.test(str) || str.includes('\n') || /^\s|\s$/.test(str)) {
      return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return str;
  }

  function yamlList(items, indent = 0) {
    if (!items?.length) return `${' '.repeat(indent)}[]`;
    const pad = ' '.repeat(indent);
    return items.map((item) => `${pad}- ${yamlQuote(item)}`).join('\n');
  }

  function safeFilename(title, articleId) {
    const slug = title
      .slice(0, 30)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    return `${articleId}_${slug || 'article'}.md`;
  }

  function parseReadingMinutes(label) {
    const match = String(label || '').match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  function extractComments(doc, limit = 25) {
    const selectors = [
      '.comment-item',
      '.tm-comment',
      '.comment',
      '[class*="comment-item"]',
    ];
    const comments = [];
    const seen = new Set();

    for (const selector of selectors) {
      doc.querySelectorAll(selector).forEach((el) => {
        if (comments.length >= limit) return;
        const body = el.querySelector(
          '.comment-item__body, .comment__body, .tm-comment__body, .comment-formatted-body',
        );
        const bodyText = body?.textContent?.trim();
        if (!bodyText || seen.has(bodyText)) return;
        seen.add(bodyText);
        comments.push({
          author: text(el.querySelector('.comment-item__username, .tm-user-info__username, .comment__author')),
          body: bodyText,
          score: text(el.querySelector('.comment-item__rating, .tm-votes-lever__score-counter')),
        });
      });
    }

    return comments;
  }

  function formatCommentsMarkdown(comments) {
    if (!comments.length) return '';
    let md = '\n\n---\n\n## Комментарии\n\n';
    comments.forEach((comment, index) => {
      const header = comment.author || 'anonymous';
      const score = comment.score ? ` · ${comment.score}` : '';
      md += `### ${index + 1}. ${header}${score}\n\n${comment.body}\n\n`;
    });
    return md;
  }

  function buildFrontmatter(meta) {
    const lines = ['---'];
    lines.push(`url: ${yamlQuote(meta.url)}`);
    lines.push(`article_id: ${meta.articleId}`);
    if (meta.publicationType) lines.push(`publication_type: ${meta.publicationType}`);
    lines.push(`title: ${yamlQuote(meta.title)}`);
    lines.push(`author: ${yamlQuote(meta.author)}`);

    if (meta.published) lines.push(`published: ${yamlQuote(meta.published)}`);
    if (meta.complexity) lines.push(`complexity: ${yamlQuote(meta.complexity)}`);
    if (meta.readingTime) lines.push(`reading_time: ${yamlQuote(meta.readingTime)}`);
    if (meta.reach != null) lines.push(`reach: ${meta.reach}`);

    if (meta.hubs?.length) {
      lines.push('hubs:');
      lines.push(yamlList(meta.hubs, 2));
    }

    if (meta.tags?.length) {
      lines.push('tags:');
      lines.push(yamlList(meta.tags, 2));
    }

    if (meta.labels?.length) {
      lines.push('labels:');
      lines.push(yamlList(meta.labels, 2));
    }

    if (meta.rating != null) lines.push(`rating: ${meta.rating}`);

    if (meta.votes && (meta.votes.up != null || meta.votes.down != null)) {
      lines.push('votes:');
      if (meta.votes.up != null) lines.push(`  up: ${meta.votes.up}`);
      if (meta.votes.down != null) lines.push(`  down: ${meta.votes.down}`);
    }

    if (meta.bookmarks != null) lines.push(`bookmarks: ${meta.bookmarks}`);
    if (meta.comments != null) lines.push(`comments: ${meta.comments}`);
    if (meta.corporateBlog) lines.push(`corporate_blog: ${yamlQuote(meta.corporateBlog)}`);
    if (meta.isCorporate != null) lines.push(`is_corporate: ${meta.isCorporate}`);
    if (meta.wordCount != null) lines.push(`word_count: ${meta.wordCount}`);
    if (meta.readingMinutes != null) lines.push(`reading_time_minutes: ${meta.readingMinutes}`);

    lines.push('---');
    return lines.join('\n');
  }

  function findBodyElement(doc) {
    return doc.querySelector('.article-formatted-body')
      || doc.querySelector('.post__body')
      || doc.querySelector('.tm-article-presenter__content');
  }

  function extractPublicationFromDocument(doc, pageUrl, options = {}) {
    const publicationType = getPublicationType(pageUrl);
    if (!publicationType) {
      return {
        success: false,
        error: 'Это не страница публикации Habr (/articles/, /news/, /post/)',
      };
    }

    const articleId = getPublicationId(pageUrl);
    const titleEl = doc.querySelector('h1.tm-title span') || doc.querySelector('h1.tm-title');
    const title = text(titleEl);

    if (!title) {
      return { success: false, error: 'Не найден заголовок публикации' };
    }

    const bodyEl = findBodyElement(doc);
    if (!bodyEl) {
      return { success: false, error: 'Не найдено тело публикации' };
    }

    const baseUrl = pageUrl.split('?')[0];
    const dateEl = doc.querySelector('.tm-article-datetime-published time[datetime]')
      || doc.querySelector('time[datetime]');
    const reachEl = doc.querySelector('.reach-counter .tm-icon-counter__value');
    const bookmarksEl = doc.querySelector('.bookmarks-button .counter');
    const commentsEl = doc.querySelector('.article-comments-counter-link .value');
    const complexityEl = doc.querySelector('.tm-article-complexity');
    const complexityLabel = text(doc.querySelector('.tm-article-complexity__label'));
    const readingTime = text(doc.querySelector('.tm-article-reading-time__label'));
    const { rating, votes } = getRatingDetails(doc);

    const reachRaw = reachEl?.getAttribute('title') || reachEl?.textContent || '';
    const reach = parseInt(reachRaw.replace(/\D/g, ''), 10);
    const corporateBlog = getCorporateBlog(doc, pageUrl);

    const meta = {
      url: baseUrl,
      articleId,
      publicationType,
      title,
      author: text(doc.querySelector('.tm-user-info__username')),
      published: dateEl?.getAttribute('datetime') || null,
      complexity: complexityLabel,
      complexityLevel: normalizeComplexity(complexityLabel)
        || normalizeComplexityFromClass(complexityEl?.className || ''),
      readingTime,
      readingMinutes: parseReadingMinutes(readingTime),
      reach: Number.isFinite(reach) ? reach : null,
      hubs: getHubs(doc),
      tags: getMetaList(doc, 'Теги'),
      labels: getLabels(doc),
      rating,
      votes,
      bookmarks: bookmarksEl ? parseInt(bookmarksEl.textContent.trim(), 10) : null,
      comments: commentsEl ? parseInt(commentsEl.textContent.trim(), 10) : null,
      corporateBlog,
      isCorporate: Boolean(corporateBlog),
    };

    let bodyMd = HabrMarkdown.htmlToMarkdown(bodyEl, baseUrl);
    meta.wordCount = HabrMarkdown.countWords(bodyMd);

    const comments = options.includeComments
      ? extractComments(doc, options.commentsLimit || 25)
      : [];
    if (comments.length) {
      bodyMd += formatCommentsMarkdown(comments);
    }

    const markdown = `${buildFrontmatter(meta)}\n\n${bodyMd}\n`;
    const filename = safeFilename(title, articleId);

    return {
      success: true,
      markdown,
      filename,
      articleId,
      publicationKey: getPublicationKey(pageUrl),
      publicationType,
      meta,
      commentsCount: comments.length,
    };
  }

  function extractArticleFromDocument(doc, pageUrl, options = {}) {
    return extractPublicationFromDocument(doc, pageUrl, options);
  }

  function extractPublicationFromHtml(html, pageUrl, options = {}) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return extractPublicationFromDocument(doc, pageUrl, options);
  }

  function extractArticleFromHtml(html, pageUrl, options = {}) {
    return extractPublicationFromHtml(html, pageUrl, options);
  }

  function parsePreviewFromCard(card, sourceUrl) {
    const link = card.querySelector(
      'a[href*="/articles/"], a[href*="/news/"], a[href*="/post/"]',
    );
    if (!link) return null;

    const url = normalizePublicationUrl(new URL(link.getAttribute('href'), sourceUrl).href);
    if (!url) return null;

    const ratingEl = card.querySelector(
      '.tm-votes-lever__score-counter, .tm-article-snippet__stats-value, .tm-votes-meter__value',
    );
    const complexityEl = card.querySelector('.tm-article-complexity');

    return {
      url,
      rating: parseRatingValue(ratingEl?.textContent),
      complexity: normalizeComplexity(text(complexityEl?.querySelector('.tm-article-complexity__label')))
        || normalizeComplexityFromClass(complexityEl?.className || ''),
    };
  }

  function extractPublicationsFromListHtml(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = new Map();

    const cards = doc.querySelectorAll(
      'article, .tm-articles-list__item, .tm-posts-list__item, .tm-news-list__item',
    );

    cards.forEach((card) => {
      const preview = parsePreviewFromCard(card, sourceUrl);
      if (preview) items.set(preview.url, preview);
    });

    if (items.size === 0) {
      doc.querySelectorAll('a[href*="/articles/"], a[href*="/news/"], a[href*="/post/"]').forEach((link) => {
        const href = link.getAttribute('href');
        if (!href) return;
        const url = normalizePublicationUrl(new URL(href, sourceUrl).href);
        if (url) items.set(url, { url, rating: null, complexity: null });
      });
    }

    return [...items.values()];
  }

  function extractArticleUrlsFromListHtml(html, sourceUrl) {
    return extractPublicationsFromListHtml(html, sourceUrl).map((item) => item.url);
  }

  return {
    ARTICLE_URL_RE,
    PUBLICATION_PATTERNS,
    getPublicationType,
    getPublicationId,
    getPublicationKey,
    getArticleId,
    isPublicationUrl,
    isArticleUrl,
    normalizePublicationUrl,
    normalizeArticleUrl,
    normalizeComplexity,
    normalizeComplexityFromClass,
    parseUrlsFromText,
    extractPublicationFromDocument,
    extractArticleFromDocument,
    extractPublicationFromHtml,
    extractArticleFromHtml,
    extractPublicationsFromListHtml,
    extractArticleUrlsFromListHtml,
    safeFilename,
  };
})();
