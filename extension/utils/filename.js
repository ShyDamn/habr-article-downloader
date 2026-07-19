/* global HabrFilename, HabrParser */
const HabrFilename = (() => {
  function slugify(text, maxLen = 40) {
    return String(text || '')
      .slice(0, maxLen)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'publication';
  }

  function formatDate(iso) {
    if (!iso) return 'unknown-date';
    try {
      return iso.slice(0, 10);
    } catch {
      return 'unknown-date';
    }
  }

  function sanitizePathPart(text) {
    return slugify(text, 24).toLowerCase();
  }

  function buildFilename(meta, settings) {
    const template = settings.filenameTemplate || '{id}_{title}';
    const id = meta.articleId || '0';
    const titleSlug = slugify(meta.title, 30);

    let name = template
      .replace(/\{id\}/g, id)
      .replace(/\{title\}/g, titleSlug)
      .replace(/\{date\}/g, formatDate(meta.published))
      .replace(/\{author\}/g, sanitizePathPart(meta.author))
      .replace(/\{type\}/g, meta.publicationType || 'articles');

    if (!name.endsWith('.md')) name += '.md';
    return name.replace(/[<>:"|?*]/g, '_');
  }

  function buildRelativeFolder(meta, settings) {
    const parts = [settings.downloadFolder || 'downloads'];

    if (settings.subfolderByType && meta.publicationType) {
      parts.push(meta.publicationType);
    }

    if (settings.subfolderByHub && meta.hubs?.length) {
      parts.push(sanitizePathPart(meta.hubs.find((h) => !/блог компании/i.test(h)) || meta.hubs[0]));
    }

    return parts.filter(Boolean).join('/');
  }

  function buildFullPath(meta, settings) {
    const folder = buildRelativeFolder(meta, settings);
    const filename = buildFilename(meta, settings);
    return `${folder}/${filename}`.replace(/\\/g, '/');
  }

  return {
    slugify,
    buildFilename,
    buildRelativeFolder,
    buildFullPath,
  };
})();
