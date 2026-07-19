/* global HabrMarkdown */
const HabrMarkdown = (() => {
  let service;

  function getLanguageFromCode(node) {
    const cls = node.className || '';
    const match = cls.match(/language-(\w+)/) || cls.match(/highlight(?:-source)?-(\w+)/);
    if (match) return match[1];
    return node.getAttribute('data-lang') || '';
  }

  function createService() {
    if (typeof TurndownService === 'undefined') {
      throw new Error('TurndownService не загружен');
    }

    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      bulletListMarker: '-',
    });

    if (typeof turndownPluginGfm !== 'undefined') {
      td.use(turndownPluginGfm.gfm);
    }

    td.addRule('habrFormula', {
      filter(node) {
        return node.nodeName === 'IMG' && node.classList.contains('formula');
      },
      replacement(_content, node) {
        const source = node.getAttribute('source');
        if (source) return `\n\n$$${source}$$\n\n`;
        const alt = node.getAttribute('alt');
        return alt ? `\n\n$$${alt}$$\n\n` : '';
      },
    });

    td.addRule('habrIframe', {
      filter: 'iframe',
      replacement(_content, node) {
        const src = node.getAttribute('src');
        return src ? `\n\n[Встроенный контент](${src})\n\n` : '';
      },
    });

    td.addRule('habrSpoiler', {
      filter(node) {
        return node.nodeName === 'DETAILS';
      },
      replacement(content, node) {
        const summary = node.querySelector('summary');
        const title = summary ? summary.textContent.trim() : 'Спойлер';
        const body = content.replace(title, '').trim();
        return `\n\n<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>\n\n`;
      },
    });

    td.addRule('habrFigure', {
      filter: 'figure',
      replacement(content, node) {
        const img = node.querySelector('img');
        const caption = node.querySelector('figcaption');
        let result = '';

        if (img) {
          const alt = img.getAttribute('alt') || '';
          const src = img.getAttribute('src') || '';
          const absolute = src.startsWith('http') ? src : `https:${src}`;
          result += `\n\n![${alt}](${absolute})\n\n`;
        }

        if (caption) {
          const cap = caption.textContent.trim();
          const alt = img?.getAttribute('alt')?.trim() || '';
          if (cap && cap !== alt) {
            result += `*${cap}*\n\n`;
          }
        }

        return result || content;
      },
    });

    td.addRule('habrPreCode', {
      filter(node) {
        return node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE';
      },
      replacement(_content, node) {
        const code = node.firstChild;
        const lang = getLanguageFromCode(code);
        const text = code.textContent.replace(/\n$/, '');
        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      },
    });

    td.remove(['script', 'style', 'noscript']);

    return td;
  }

  function getService() {
    if (!service) service = createService();
    return service;
  }

  function htmlToMarkdown(root, _baseUrl) {
    const md = getService().turndown(root);
    return md
      .replace(/([^\s])\[(\s*[^\]]+\s*)\]\(/g, '$1 [$2](')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function countWords(text) {
    return text.split(/\s+/).filter(Boolean).length;
  }

  function replaceImageUrls(markdown, urlMap) {
    let result = markdown;
    for (const [absolute, relative] of Object.entries(urlMap)) {
      result = result.split(absolute).join(relative);
      const https = absolute.replace(/^https:/, '');
      result = result.split(https).join(relative);
    }
    return result;
  }

  return { htmlToMarkdown, countWords, replaceImageUrls };
})();
