(function initTimerModel(globalScope) {
  class PomoTimer {
    constructor({ minutes = 25, onChange = () => {} } = {}) {
      this.minutes = minutes;
      this.remaining = minutes * 60;
      this.status = 'ready';
      this.justCompleted = false;
      this.onChange = onChange;
    }

    snapshot(extra = {}) {
      return {
        minutes: this.minutes,
        remaining: this.remaining,
        status: this.status,
        running: this.status === 'running',
        justCompleted: this.justCompleted,
        ...extra,
      };
    }

    notify(extra = {}) {
      this.onChange(this.snapshot(extra));
    }

    start() {
      if (this.status === 'complete') return false;
      this.status = 'running';
      this.justCompleted = false;
      this.notify();
      return true;
    }

    pause() {
      if (this.status !== 'running') return false;
      this.status = 'paused';
      this.notify();
      return true;
    }

    toggle() {
      return this.status === 'running' ? this.pause() : this.start();
    }

    tick(seconds = 1) {
      if (this.status !== 'running') return false;
      this.remaining = Math.max(0, this.remaining - Math.max(0, Number(seconds) || 0));
      this.justCompleted = this.remaining === 0;
      if (this.justCompleted) this.status = 'complete';
      this.notify();
      this.justCompleted = false;
      return true;
    }

    reset() {
      this.remaining = this.minutes * 60;
      this.status = 'ready';
      this.justCompleted = false;
      this.notify();
    }

    continueWith(minutes = this.minutes) {
      if (this.status !== 'complete') return false;
      this.minutes = Number(minutes);
      this.reset();
      return true;
    }

    setMinutes(minutes) {
      if (this.status !== 'ready') return false;
      this.minutes = Number(minutes);
      this.reset();
      return true;
    }
  }

  function formatTime(totalSeconds) {
    const safe = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  const exportsObject = { PomoTimer, formatTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoTimerModel = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
