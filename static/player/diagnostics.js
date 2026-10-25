function ranges(source) {
  if (!source) return [];
  const result = [];
  for (let index = 0; index < source.length; index++) result.push([source.start(index), source.end(index)]);
  return result;
}

export function createPlaybackDiagnostics(audio, getState, { console, fetch }) {
  let engine = 'not started';
  let lastHlsError = null;
  let fragmentsLoaded = 0;
  let fragmentsBuffered = 0;
  let lastFragment = null;

  function snapshot() {
    return {
      engine,
      state: getState(),
      currentTime: audio.currentTime,
      paused: audio.paused,
      seeking: audio.seeking,
      readyState: audio.readyState,
      networkState: audio.networkState,
      buffered: ranges(audio.buffered),
      seekable: ranges(audio.seekable),
      mediaError: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
      lastHlsError,
      fragmentsLoaded,
      fragmentsBuffered,
      lastFragment,
    };
  }

  function report(event) {
    const diagnostic = { event, ...snapshot() };
    console.warn('[Radio Calico] Playback diagnostic', diagnostic);
    // Diagnostics must never interrupt audio if the local server is unavailable.
    if (typeof fetch === 'function') {
      try {
        void fetch('/api/playback-diagnostics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(diagnostic), keepalive: true,
        }).catch(() => {});
      } catch { /* Diagnostic reporting is optional. */ }
    }
  }

  return {
    snapshot,
    report,
    selectEngine(value) { engine = value; },
    reset() {
      lastHlsError = null;
      fragmentsLoaded = fragmentsBuffered = 0;
      lastFragment = null;
    },
    recordError(data) {
      lastHlsError = { type: data.type, details: data.details, fatal: data.fatal, httpStatus: data.response?.code };
    },
    fragmentLoaded(frag) {
      fragmentsLoaded++;
      lastFragment = { sequence: frag.sn, duration: frag.duration };
    },
    fragmentBuffered() { fragmentsBuffered++; },
  };
}
