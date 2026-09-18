/* global HabrMarkdown */
const HabrMarkdown = (() => {
  let service;

  function getLanguageFromCode(node) {
    const cls = node.className || '';
    const match = cls.match(/language-(\w+)/) || cls.match(/highlight(?:-source)?-(\w+)/);
    if (match) return match[1];
    return node.getAttribute('data-lang') || '';
  }

  // В service worker DOM эмулируется шимом, у которого нет HTMLTableElement.rows.
  // turndown-plugin-gfm смотрит именно на table.rows[0]: без него таблица остаётся
  // сырым HTML. На открытой вкладке таблицы конвертировались, в фоне — нет.
  // Патчим прототип, а не элемент: turndown клонирует узел и теряет своё свойство.
  function ensureTableRowsSupport() {
    try {
      if (typeof DOMParser === 'undefined') return;
      const doc = new DOMParser().parseFromString('<table><tr><td></td></tr></table>', 'text/html');
      const table = doc.querySelector('table');
      if (!table || table.rows) return;
      const proto = Object.getPrototypeOf(table);
      if (!proto || Object.prototype.hasOwnProperty.call(proto, 'rows')) return;
      Object.defineProperty(proto, 'rows', {
        get() {
          return [...this.querySelectorAll('tr')];
        },
        configurable: true,
      });
    } catch {
      // без поддержки таблицы просто останутся HTML — не ломаем конвертацию
    }
  }

  function createService() {
    if (typeof TurndownService === 'undefined') {
      throw new Error('TurndownService не загружен');
    }

    ensureTableRowsSupport();

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

  // Habr оборачивает содержимое ячеек в <p align="left">. turndown считает таблицу
  // с блочным содержимым неподдерживаемой и оставляет её сырым HTML — разворачиваем.
  function prepareRoot(root) {
    if (!root?.cloneNode || !root.querySelectorAll) return root;
    let clone;
    try {
      clone = root.cloneNode(true);
    } catch {
      return root;
    }
    try {
      clone.querySelectorAll('th > p, td > p').forEach((p) => {
        const cell = p.parentNode;
        if (!cell || cell.children.length !== 1) return;
        while (p.firstChild) cell.insertBefore(p.firstChild, p);
        cell.removeChild(p);
      });
    } catch {
      return root;
    }
    return clone;
  }

  function htmlToMarkdown(root, _baseUrl) {
    const md = getService().turndown(prepareRoot(root));
    return md
      // ВАЖНО: не трогаем '!' и '[' перед скобкой, иначе ![alt](src) ломается в '! [alt](src)'
      .replace(/([^\s!\[\]])\[(\s*[^\]]+\s*)\]\(/g, '$1 [$2](')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function countWords(text) {
    return text.split(/\s+/).filter(Boolean).length;
  }

  function replaceImageUrls(markdown, urlMap) {
    let result = markdown;
    // Длинные URL первыми: иначе короткий адрес, являющийся префиксом другого
    // (например, с ?query), подменит его начало и порвёт ссылку.
    const entries = Object.entries(urlMap).sort((a, b) => b[0].length - a[0].length);
    for (const [absolute, relative] of entries) {
      result = result.split(absolute).join(relative);
      // тот же адрес мог встретиться без схемы: //habrastorage.org/...
      const schemeless = absolute.replace(/^https?:/, '');
      result = result.split(schemeless).join(relative);
    }
    return result;
  }

  function fragmentToMarkdown(html) {
    if (!html) return '';
    try {
      const doc = new DOMParser().parseFromString(`<div id="habr-frag">${html}</div>`, 'text/html');
      const node = doc.getElementById('habr-frag') || doc.body;
      return htmlToMarkdown(node);
    } catch {
      return String(html).replace(/<[^>]+>/g, '').trim();
    }
  }

  return { htmlToMarkdown, fragmentToMarkdown, countWords, replaceImageUrls };

})();
