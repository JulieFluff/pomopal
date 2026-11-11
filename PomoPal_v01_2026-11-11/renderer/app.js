(() => {
  const { PomoTimer, formatTime } = window.PomoTimerModel;
  const { FINISH_SOUNDS, chooseFinishSound } = window.PomoFinishSounds;
  const { parsePreferences, normaliseMinutes, normaliseFinishSound } = window.PomoPreferences;
  const desktop = window.pomoDesktop || {
    setMiniMode() {}, onMiniModeChanged() {}, onOpenSettings() {}, setAlwaysOnTop() {}, setTimerState() {},
    recordCompletedSession() { return Promise.resolve({ ok: false }); }, hide() {},
  };
  const isDesktopApp = Boolean(window.pomoDesktop);
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const MASCOTS = ['tomato', 'apple', 'pear', 'cat', 'dog', 'hamster'];
  const saved = parsePreferences(localStorage.getItem('pomopal.preferences'));
  const state = {
    muted: Boolean(saved.muted),
    mascot: MASCOTS.includes(saved.mascot) ? saved.mascot : 'tomato',
    mini: isDesktopApp && Boolean(saved.mini),
    alwaysOnTop: Boolean(saved.alwaysOnTop),
    theme: saved.theme === 'dark' ? 'dark' : 'light',
    finishSound: normaliseFinishSound(saved.finishSound),
    previousFinishSound: FINISH_SOUNDS.includes(saved.previousFinishSound) ? saved.previousFinishSound : null,
  };
  const time = $('#time');
  const status = $('#status');
  const mascot = $('#mascot');
  const startStop = $('#start-stop');
  const settingsDialog = $('#settings-dialog');
  const customDuration = $('#custom-duration');
  const customMinutes = $('#custom-minutes');
  let intervalId = null;
  let completionClassTimer = null;
  let idleBlinkTimer = null;
  let audioContext = null;

  const persist = () => localStorage.setItem('pomopal.preferences', JSON.stringify({
    ...state, intention: $('#intention').value, minutes: timer.minutes,
  }));

  async function playTone(kind) {
    if (state.muted) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const now = audioContext.currentTime;
    let notes = [{ frequency: 523.25, offset: 0, duration: .48 }];

    if (kind === 'done') {
      const sound = chooseFinishSound(state.finishSound, state.previousFinishSound);
      state.previousFinishSound = sound;
      const patterns = {
        bright: [{ frequency: 659.25, endFrequency: 880, offset: 0, duration: .72 }],
        gentle: [{ frequency: 523.25, offset: 0, duration: .48 }, { frequency: 659.25, offset: .18, duration: .62 }],
        sparkle: [{ frequency: 783.99, offset: 0, duration: .34 }, { frequency: 987.77, offset: .14, duration: .38 }, { frequency: 1174.66, offset: .28, duration: .5 }],
      };
      notes = patterns[sound] || patterns.bright;
      persist();
    }

    notes.forEach(({ frequency, endFrequency, offset, duration }) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startsAt = now + offset;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startsAt);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startsAt + duration * .45);
      gain.gain.setValueAtTime(.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(.045, startsAt + .03);
      gain.gain.exponentialRampToValueAtTime(.0001, startsAt + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + duration + .03);
    });
  }

  function completeMascot() {
    mascot.classList.remove('completed');
    mascot.classList.add('completing');
    clearTimeout(completionClassTimer);
    completionClassTimer = setTimeout(() => {
      mascot.classList.remove('completing');
      mascot.classList.add('completed');
    }, 650);
  }

  function scheduleIdleBlink() {
    clearTimeout(idleBlinkTimer);
    idleBlinkTimer = setTimeout(() => {
      if (!mascot.classList.contains('completed') && !mascot.classList.contains('completing')) {
        mascot.classList.add('blinking');
        setTimeout(() => mascot.classList.remove('blinking'), 280);
      }
      scheduleIdleBlink();
    }, 3600 + Math.random() * 2600);
  }

  function render(snapshot = timer.snapshot()) {
    const complete = snapshot.status === 'complete';
    document.body.classList.toggle('timer-complete', complete);
    time.value = formatTime(snapshot.remaining);
    time.textContent = formatTime(snapshot.remaining);
    startStop.textContent = snapshot.status === 'running' ? 'Pause' : snapshot.status === 'paused' ? 'Resume' : complete ? 'Continue' : 'Start';
    startStop.disabled = false;
    $('#completion-actions').hidden = !complete;
    $('#completed-task').textContent = complete ? ($('#intention').value.trim() || 'This activity') : '';
    $('#continue-task').textContent = `Continue for ${snapshot.minutes} min`;
    const statusMessage = snapshot.status === 'running' ? 'Activity time' : snapshot.status === 'paused' ? 'Paused' : complete ? 'Lovely work' : 'Ready when you are';
    if (status.textContent !== statusMessage) status.textContent = statusMessage;
    updateMascotAction(snapshot);
    mascot.classList.toggle('completed', complete && !snapshot.justCompleted && !mascot.classList.contains('completing'));
    if (snapshot.justCompleted) {
      completeMascot();
      playTone('done');
      desktop.recordCompletedSession({
        activity: $('#intention').value.trim() || 'Unspecified activity',
        durationMinutes: snapshot.minutes,
      }).catch((error) => console.error('PomoPal could not record the completed session', error));
      stopClock();
    }
    desktop.setTimerState(snapshot.status);
  }

  const timer = new PomoTimer({ minutes: normaliseMinutes(saved.minutes), onChange: render });

  function startClock() {
    stopClock();
    intervalId = setInterval(() => timer.tick(1), 1000);
  }

  function stopClock() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }

  function continueTask(minutes = timer.minutes, startNow = false) {
    stopClock();
    mascot.classList.remove('completing', 'completed');
    if (!timer.continueWith(minutes)) return false;
    setDurationSelection();
    if (startNow) {
      timer.start();
      startClock();
      playTone('start');
    }
    persist();
    return true;
  }

  function toggleTimer() {
    if (timer.status === 'complete') {
      continueTask(timer.minutes, true);
      return;
    }
    const startingFresh = timer.status === 'ready';
    timer.toggle();
    if (timer.status === 'running') {
      startClock();
      if (startingFresh) playTone('start');
    } else {
      stopClock();
    }
    persist();
  }

  function resetTimer() {
    stopClock();
    mascot.classList.remove('completing', 'completed');
    timer.reset();
    $('#intention').value = '';
    persist();
  }

  function startNewTask() {
    resetTimer();
    if (typeof $('#intention').focus === 'function') $('#intention').focus();
  }

  function setMiniMode(enabled) {
    state.mini = Boolean(enabled);
    document.body.classList.toggle('mini', state.mini);
    updateMascotAction(timer.snapshot());
    desktop.setMiniMode(state.mini);
    persist();
  }

  function setMascot(name) {
    state.mascot = name;
    mascot.dataset.active = name;
    persist();
  }

  function cycleMascot() {
    const nextIndex = (MASCOTS.indexOf(state.mascot) + 1) % MASCOTS.length;
    setMascot(MASCOTS[nextIndex]);
  }

  function updateMascotAction(snapshot = timer.snapshot()) {
    const canContinue = state.mini && snapshot.status === 'complete';
    mascot.disabled = state.mini && snapshot.status !== 'complete';
    const label = canContinue ? 'Continue the same activity for another session' : state.mini ? 'Drag PomoPal around your desktop' : 'Change PomoPal friend';
    mascot.setAttribute('aria-label', label);
    mascot.title = label;
  }

  function activateMascot() {
    if (state.mini) {
      if (timer.status === 'complete') continueTask(timer.minutes, true);
      return;
    }
    cycleMascot();
  }

  function setDurationSelection() {
    $$('[data-minutes]').forEach((button) => {
      const selected = Number(button.dataset.minutes) === timer.minutes;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    customMinutes.value = String(timer.minutes);
  }

  function updateMuteUI() {
    $('#mute-toggle').textContent = state.muted ? '×♪' : '♪';
    $('#mute-toggle').setAttribute('aria-pressed', String(state.muted));
    $('#mute-toggle').setAttribute('aria-label', state.muted ? 'Unmute sounds' : 'Mute sounds');
  }

  function applyTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    if (document.documentElement) document.documentElement.dataset.theme = state.theme;
    const dark = state.theme === 'dark';
    $('#theme-toggle').textContent = dark ? '☀' : '☾';
    $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    $('#theme-toggle').setAttribute('aria-pressed', String(dark));
    persist();
  }

  function isInteractiveTarget(target) {
    return Boolean(target?.closest?.('input, select, textarea, button, [role="button"]'));
  }

  startStop.addEventListener('click', toggleTimer);
  $('#reset').addEventListener('click', resetTimer);
  $('#continue-task').addEventListener('click', () => continueTask(timer.minutes, true));
  $('#new-task').addEventListener('click', startNewTask);
  $('#theme-toggle').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('#compact-toggle').addEventListener('click', () => setMiniMode(true));
  $('#expand-toggle').addEventListener('click', () => setMiniMode(false));
  $('#mute-toggle').addEventListener('click', () => {
    state.muted = !state.muted;
    updateMuteUI();
    persist();
  });
  $('#always-on-top').addEventListener('change', (event) => {
    state.alwaysOnTop = event.target.checked;
    desktop.setAlwaysOnTop(state.alwaysOnTop);
    persist();
  });
  $('#finish-sound').addEventListener('change', (event) => {
    state.finishSound = event.target.value;
    persist();
  });
  $('#intention').addEventListener('input', persist);
  mascot.addEventListener('click', activateMascot);
  mascot.addEventListener('pointerup', () => mascot.blur());

  $$('[data-minutes]').forEach((button) => button.addEventListener('click', () => {
    const minutes = Number(button.dataset.minutes);
    if (timer.status === 'complete') {
      continueTask(minutes);
      return;
    }
    if (!timer.setMinutes(minutes)) return;
    setDurationSelection();
    persist();
  }));

  customDuration.addEventListener('submit', (event) => {
    event.preventDefault();
    const minutes = normaliseMinutes(customMinutes.value, NaN);
    if (!Number.isFinite(minutes)) return;
    if (timer.status === 'complete') continueTask(minutes);
    else if (!timer.setMinutes(minutes)) return;
    setDurationSelection();
    customMinutes.value = String(minutes);
    persist();
  });

  window.addEventListener('keydown', (event) => {
    if (settingsDialog.open || state.mini) return;
    if (event.code === 'Space' && !isInteractiveTarget(event.target)) {
      event.preventDefault();
      toggleTimer();
    }
    if (event.key === 'Escape') resetTimer();
  });

  $('#intention').value = saved.intention || '';
  updateMuteUI();
  $('#always-on-top').checked = state.alwaysOnTop;
  $('#finish-sound').value = state.finishSound;
  setDurationSelection();
  desktop.onMiniModeChanged(setMiniMode);
  desktop.onOpenSettings(() => {
    if (!settingsDialog.open) settingsDialog.showModal();
  });
  applyTheme(state.theme);
  setMascot(state.mascot);
  setMiniMode(state.mini);
  desktop.setAlwaysOnTop(state.alwaysOnTop);
  render();
  scheduleIdleBlink();
})();
