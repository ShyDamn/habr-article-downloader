/* global HabrRss, HabrParser */
const HabrRss = (() => {
  function findRssUrlFromHtml(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const link = doc.querySelector('link[type="application/rss+xml"], link[type="application/atom+xml"]');
    if (!link) return null;
    const href = link.getAttribute('href');
    return href ? new URL(href, sourceUrl).href : null;
  }

  function parseRssItems(xmlText, sourceUrl) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    const items = [];

    doc.querySelectorAll('item link, entry link, item guid, entry id').forEach((node) => {
      let url = node.textContent?.trim() || node.getAttribute('href');
      if (!url && node.tagName.toLowerCase() === 'link') {
        url = node.getAttribute('href');
      }
      if (!url) return;

      const normalized = HabrParser.normalizePublicationUrl(
        url.startsWith('http') ? url : new URL(url, sourceUrl).href,
      );
      if (normalized) {
        items.push({ url: normalized, rating: null, complexity: null, source: 'rss' });
      }
    });

    return items;
  }

  async function discoverItems(sourceUrl, fetchHtmlFn, limit = 25) {
    try {
      const pageHtml = await fetchHtmlFn(sourceUrl);
      const rssUrl = findRssUrlFromHtml(pageHtml, sourceUrl);
      if (!rssUrl) return null;

      const xml = await fetchHtmlFn(rssUrl);
      const items = parseRssItems(xml, rssUrl).slice(0, limit);
      return items.length ? items : null;
    } catch {
      return null;
    }
  }

  return { findRssUrlFromHtml, parseRssItems, discoverItems };
})();
