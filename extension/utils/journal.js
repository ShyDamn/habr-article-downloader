/* global HabrJournal */
const HabrJournal = (() => {
  const JOURNAL_KEY = 'journal';
  const MAX_ENTRIES = 100;

  async function add(entry) {
    const data = await chrome.storage.local.get(JOURNAL_KEY);
    const journal = data[JOURNAL_KEY] || [];
    journal.unshift({
      time: Date.now(),
      ...entry,
    });
    await chrome.storage.local.set({
      [JOURNAL_KEY]: journal.slice(0, MAX_ENTRIES),
    });
  }

  async function get(limit = 50) {
    const data = await chrome.storage.local.get(JOURNAL_KEY);
    return (data[JOURNAL_KEY] || []).slice(0, limit);
  }

  async function clear() {
    await chrome.storage.local.set({ [JOURNAL_KEY]: [] });
  }

  return { JOURNAL_KEY, add, get, clear };
})();
