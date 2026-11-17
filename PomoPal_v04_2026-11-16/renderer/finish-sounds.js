(function initFinishSounds(globalScope) {
  const FINISH_SOUNDS = ['bright', 'gentle', 'sparkle'];

  function chooseFinishSound(mode = 'random', previous = null, random = Math.random) {
    if (FINISH_SOUNDS.includes(mode)) return mode;
    const choices = FINISH_SOUNDS.filter((sound) => sound !== previous);
    return choices[Math.floor(random() * choices.length)] || FINISH_SOUNDS[0];
  }

  const exportsObject = { FINISH_SOUNDS, chooseFinishSound };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoFinishSounds = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
