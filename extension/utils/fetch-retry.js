/* global HabrFetch */
const HabrFetch = (() => {
  let lastRequestAt = 0;
  let circuitOpenUntil = 0;

  class RateLimitError extends Error {
    constructor(message) {
      super(message);
      this.name = 'RateLimitError';
    }
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSlot(minGapMs = 1500) {
    const now = Date.now();
    if (circuitOpenUntil > now) {
      throw new RateLimitError('Habr временно недоступен — подождите пару минут');
    }
    const wait = Math.max(0, minGapMs - (now - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  }

  function openCircuit(ms = 120000) {
    circuitOpenUntil = Date.now() + ms;
  }

  function isRateLimited() {
    return circuitOpenUntil > Date.now();
  }

  async function fetchHtml(url, options = {}) {
    const retries = options.retries ?? 1;
    const baseDelay = options.baseDelayMs ?? 3000;
    const minGapMs = options.minGapMs ?? 1500;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await waitForSlot(minGapMs);

        const response = await fetch(url, {
          credentials: 'include',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        if (response.status === 429) {
          openCircuit(180000);
          throw new RateLimitError(`HTTP 429 — Habr ограничил запросы`);
        }

        if (response.status >= 500) {
          throw new Error(`HTTP ${response.status}`);
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} для ${url}`);
        }

        return response.text();
      } catch (err) {
        lastError = err;
        if (err instanceof RateLimitError) throw err;
        if (attempt < retries) {
          await sleep(baseDelay * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  async function fetchText(url, options = {}) {
    return fetchHtml(url, options);
  }

  return {
    fetchHtml,
    fetchText,
    sleep,
    RateLimitError,
    isRateLimited,
    openCircuit,
  };
})();
