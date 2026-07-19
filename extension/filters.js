/* global HabrFilters, HabrParser */
const HabrFilters = (() => {
  const SCORE_OPTIONS = ['all', '0', '10', '25', '50', '100'];
  const COMPLEXITY_OPTIONS = ['all', 'easy', 'medium', 'hard'];
  const TYPE_OPTIONS = ['articles', 'posts', 'news'];

  const DEFAULTS = {
    filterTypes: ['articles'],
    filterScore: 'all',
    filterComplexity: 'all',
    filterHubsInclude: '',
    filterHubsExclude: '',
    filterTagsInclude: '',
    filterTagsExclude: '',
  };

  function parseList(value) {
    return String(value || '')
      .split(/[\n,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  function normalizeSettings(settings) {
    const filterTypes = Array.isArray(settings.filterTypes) && settings.filterTypes.length
      ? settings.filterTypes.filter((t) => TYPE_OPTIONS.includes(t))
      : DEFAULTS.filterTypes;

    let filterScore = settings.filterScore ?? DEFAULTS.filterScore;
    if (filterScore === undefined && settings.minRating != null) {
      filterScore = settings.minRating > 0 ? String(settings.minRating) : 'all';
    }
    if (!SCORE_OPTIONS.includes(String(filterScore))) {
      filterScore = DEFAULTS.filterScore;
    }

    let filterComplexity = settings.filterComplexity ?? DEFAULTS.filterComplexity;
    if (!COMPLEXITY_OPTIONS.includes(filterComplexity)) {
      filterComplexity = DEFAULTS.filterComplexity;
    }

    return {
      filterTypes,
      filterScore: String(filterScore),
      filterComplexity,
      filterHubsInclude: settings.filterHubsInclude ?? DEFAULTS.filterHubsInclude,
      filterHubsExclude: settings.filterHubsExclude ?? DEFAULTS.filterHubsExclude,
      filterTagsInclude: settings.filterTagsInclude ?? DEFAULTS.filterTagsInclude,
      filterTagsExclude: settings.filterTagsExclude ?? DEFAULTS.filterTagsExclude,
    };
  }

  function passesHubTagFilters(meta, settings) {
    const filters = normalizeSettings(settings);
    const hubs = (meta?.hubs || []).map((hub) => hub.toLowerCase());
    const tags = (meta?.tags || []).map((tag) => tag.toLowerCase());

    const includeHubs = parseList(filters.filterHubsInclude);
    const excludeHubs = parseList(filters.filterHubsExclude);
    const includeTags = parseList(filters.filterTagsInclude);
    const excludeTags = parseList(filters.filterTagsExclude);

    if (includeHubs.length && !includeHubs.some((needle) => hubs.some((hub) => hub.includes(needle)))) {
      return false;
    }

    if (excludeHubs.some((needle) => hubs.some((hub) => hub.includes(needle)))) {
      return false;
    }

    if (includeTags.length && !includeTags.some((needle) => tags.some((tag) => tag.includes(needle)))) {
      return false;
    }

    if (excludeTags.some((needle) => tags.some((tag) => tag.includes(needle)))) {
      return false;
    }

    return true;
  }

  function passesType(url, settings) {
    const filters = normalizeSettings(settings);
    const type = HabrParser.getPublicationType(url);
    return filters.filterTypes.includes(type);
  }

  function passesFilters(meta, url, settings, preview = null) {
    const filters = normalizeSettings(settings);
    const type = HabrParser.getPublicationType(url || meta?.url);
    if (!filters.filterTypes.includes(type)) return false;

    if (filters.filterScore !== 'all') {
      const threshold = parseInt(filters.filterScore, 10);
      const rating = meta?.rating ?? preview?.rating;
      if (rating == null || !Number.isFinite(rating) || rating < threshold) {
        return false;
      }
    }

    if (filters.filterComplexity !== 'all') {
      const level = meta?.complexityLevel
        ?? preview?.complexity
        ?? HabrParser.normalizeComplexity(meta?.complexity);
      if (level !== filters.filterComplexity) return false;
    }

    if (meta && !passesHubTagFilters(meta, settings)) return false;

    return true;
  }

  function canSkipByPreview(preview, settings) {
    if (!preview) return false;
    if (!passesType(preview.url, settings)) return true;

    const filters = normalizeSettings(settings);

    if (filters.filterScore !== 'all' && preview.rating != null) {
      const threshold = parseInt(filters.filterScore, 10);
      if (preview.rating < threshold) return true;
    }

    if (filters.filterComplexity !== 'all' && preview.complexity) {
      if (preview.complexity !== filters.filterComplexity) return true;
    }

    return false;
  }

  return {
    SCORE_OPTIONS,
    COMPLEXITY_OPTIONS,
    TYPE_OPTIONS,
    DEFAULTS,
    normalizeSettings,
    passesType,
    passesHubTagFilters,
    passesFilters,
    canSkipByPreview,
  };
})();
