(function initPreferences(globalScope) {
  function parsePreferences(raw) {
    if (!raw) return {};
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function normaliseMinutes(value, fallback = 25) {
    const minutes = Number(value);
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 180 ? minutes : fallback;
  }

  function normaliseFinishSound(value, supported = ['random', 'bright', 'gentle', 'sparkle'], fallback = 'random') {
    return supported.includes(value) ? value : fallback;
  }

  const exportsObject = { parsePreferences, normaliseMinutes, normaliseFinishSound };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoPreferences = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
