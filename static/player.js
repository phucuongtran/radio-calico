/* Direct HLS playback: audio is never transcoded or routed through this server. */
import { createHlsLoader } from './player/hls-loader.js';
import { createListeningTime } from './player/listening-time.js';
import { createPlaybackDiagnostics } from './player/diagnostics.js';

export function initPlayer(environment = globalThis) {
  const { document, window, navigator, console, setTimeout, clearTimeout, MediaMetadata, URL } = environment;
  const STREAM_URL = 'https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8';
  const audio = document.getElementById('radio-audio');
  const player = document.querySelector('.player');
  const playButton = document.getElementById('play-toggle');
  const status = document.getElementById('player-status');
  const elapsed = document.getElementById('elapsed');
  let hls = null;
  let wantsPlayback = false;
  let operation = 0;
  let connectionTimer;
  let mediaRecoveries = 0;
  let recoveringMedia = false;
  let playAttempt = 0;
  let lastProgressPosition = 0;
  const loadHlsLibrary = createHlsLoader(environment);
  const listeningTime = createListeningTime(audio, elapsed, () => wantsPlayback);
  const diagnostics = createPlaybackDiagnostics(audio, () => player.dataset.state, environment);

  function setState(state, message) {
    player.dataset.state = state;
    document.body.classList.toggle('is-playing', state === 'playing');
    const active = ['connecting', 'buffering', 'playing'].includes(state);
    playButton.setAttribute('aria-pressed', String(active));
    playButton.setAttribute('aria-label', active ? 'Pause Radio Calico' : state === 'error' ? 'Retry Radio Calico' : 'Play Radio Calico');
    if (message) status.textContent = message;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state === 'playing' ? 'playing' : state === 'idle' || state === 'error' ? 'none' : 'paused';
  }

  function stopConnectionTimer() {
    clearTimeout(connectionTimer);
    connectionTimer = undefined;
  }

  function releaseStream() {
    listeningTime.resetPosition();
    playAttempt++;
    recoveringMedia = false;
    if (hls) { hls.destroy(); hls = null; }
    audio.removeAttribute('src');
    audio.load();
  }

  function fail(message) {
    listeningTime.update();
    wantsPlayback = false;
    operation++;
    stopConnectionTimer();
    setState('error', message);
    audio.pause();
    releaseStream();
  }

  function watchConnection() {
    if (connectionTimer) return;
    connectionTimer = setTimeout(() => {
      connectionTimer = undefined;
      if (wantsPlayback) {
        // A lack of playback progress cannot identify a network problem by
        // itself. Preserve the engine/buffer/error state before destroying it.
        console.warn('[Radio Calico] Playback timeout', diagnostics.snapshot());
        diagnostics.report('timeout');
        fail('Playback did not resume within 25 seconds. Press play to retry. The cause has not been identified; diagnostic details are in the browser console.');
      }
    }, 25000);
  }

  function handlePlayError(error, thisOperation) {
    if (thisOperation !== operation || !wantsPlayback) return;
    if (error.name === 'NotAllowedError') {
      pausePlayback();
      status.textContent = 'Your browser needs another click. Press play to start listening.';
    } else if (error.name === 'NotSupportedError') {
      fail('This browser could not play the stream’s audio format. Try an up-to-date browser or the direct stream link below.');
    } else {
      fail(error.message || 'We could not connect to the station. Press play to try again.');
    }
  }

  async function playAudio() {
    const thisOperation = operation;
    const thisAttempt = ++playAttempt;
    try { await audio.play(); }
    catch (error) {
      // Reattaching MediaSource aborts the old play promise. Only the new
      // attachment's play attempt is allowed to change the player's state.
      if (thisAttempt === playAttempt) handlePlayError(error, thisOperation);
    }
  }

  function recoverMedia() {
    if (!hls || recoveringMedia || !wantsPlayback) return;
    if (mediaRecoveries++ >= 1) {
      fail('This browser could not decode the stream’s audio. Try an up-to-date browser or use the direct stream link below.');
      return;
    }
    const recoveringHls = hls;
    const thisOperation = operation;
    recoveringMedia = true;
    playAttempt++;
    setState('buffering', 'Reconnecting the audio. Hang tight.');
    watchConnection();
    recoveringHls.once(window.Hls.Events.MEDIA_ATTACHED, () => {
      if (thisOperation !== operation || !wantsPlayback || hls !== recoveringHls) return;
      recoveringMedia = false;
      void playAudio();
    });
    recoveringHls.recoverMediaError();
  }

  async function startPlayback() {
    if (wantsPlayback) return;
    wantsPlayback = true;
    const thisOperation = ++operation;
    mediaRecoveries = 0;
    diagnostics.reset();
    setState('connecting', 'Connecting to the live station. A good thing is worth a moment.');
    watchConnection();
    try {
      const nativeHls = Boolean(audio.canPlayType('application/vnd.apple.mpegurl'));
      let Hls;
      try { Hls = await loadHlsLibrary(); }
      catch {
        if (!nativeHls) throw new Error('The player could not load. Check your connection or content blocker, then press play to retry.');
      }
      if (thisOperation !== operation || !wantsPlayback) return;
      // A positive canPlayType() result does not guarantee sustained playback
      // of this station's lossless stream. Prefer the managed HLS.js path.
      if (Hls && Hls.isSupported()) {
        diagnostics.selectEngine(`HLS.js ${Hls.version || ''}`.trim());
        // Radio benefits from a safety margin more than minimum live latency.
        // Let HLS.js choose a complete segment behind the live edge rather
        // than forcing a seek before the MediaSource has initialized.
        hls = new Hls({ enableWorker: true, lowLatencyMode: false, liveSyncDurationCount: 4, maxBufferLength: 60, maxMaxBufferLength: 120, backBufferLength: 30 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          diagnostics.recordError(data);
          console.warn('[Radio Calico] HLS error', diagnostics.snapshot());
          diagnostics.report('hls-error');
          if (!data.fatal || !wantsPlayback) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            recoverMedia();
          } else {
            fail('The live stream is unavailable. Check your connection and press play to reconnect.');
          }
        });
        hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
          diagnostics.fragmentLoaded(data.frag);
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => diagnostics.fragmentBuffered());
        hls.once(Hls.Events.MANIFEST_PARSED, () => {
          if (thisOperation !== operation || !wantsPlayback) return;
          diagnostics.report('manifest-parsed');
          void playAudio();
        });
        diagnostics.report('engine-selected');
        hls.loadSource(STREAM_URL);
        hls.attachMedia(audio);
        return;
      }
      if (!nativeHls) throw new Error('This browser cannot play this HLS stream. Try an up-to-date browser or open the stream using the link below.');
      diagnostics.selectEngine('native HLS');
      diagnostics.report('engine-selected');
      if (!audio.getAttribute('src')) audio.src = STREAM_URL;
      await playAudio();
    } catch (error) {
      handlePlayError(error, thisOperation);
    }
  }

  function pausePlayback() {
    listeningTime.update();
    wantsPlayback = false;
    operation++;
    stopConnectionTimer();
    audio.pause();
    // Release the live connection on pause; resuming starts a fresh live session.
    releaseStream();
    setState('paused', 'Come back whenever you like. Play resumes at the live broadcast.');
  }

  playButton.disabled = false;
  playButton.addEventListener('click', () => wantsPlayback ? pausePlayback() : startPlayback());
  audio.addEventListener('playing', () => {
    if (!wantsPlayback) { audio.pause(); return; }
    stopConnectionTimer();
    listeningTime.syncPosition();
    lastProgressPosition = audio.currentTime;
    setState('playing', 'You’re listening live. Make yourself at home.');
  });
  audio.addEventListener('timeupdate', () => {
    listeningTime.update();
    if (!wantsPlayback || audio.paused || audio.seeking || audio.currentTime <= lastProgressPosition) return;
    lastProgressPosition = audio.currentTime;
    stopConnectionTimer();
    if (player.dataset.state === 'buffering') {
      setState('playing', 'You’re listening live. Make yourself at home.');
    }
  });
  // Seeking to the live edge is a position change, not time spent listening.
  audio.addEventListener('seeking', listeningTime.resetPosition);
  audio.addEventListener('seeked', listeningTime.syncPosition);
  for (const event of ['waiting', 'stalled']) audio.addEventListener(event, () => {
    if (!wantsPlayback) return;
    // `stalled` reports a fetch delay, not necessarily a playback stop.
    // Buffered audio may still be advancing without a new `playing` event.
    if (event === 'stalled' && audio.readyState >= 3) return;
    const wasBuffering = player.dataset.state === 'buffering';
    setState('buffering', 'Catching up with the live stream…');
    if (!wasBuffering) diagnostics.report(event);
    watchConnection();
  });
  audio.addEventListener('pause', () => {
    if (wantsPlayback && audio.paused && player.dataset.state === 'playing') pausePlayback();
  });
  audio.addEventListener('error', () => {
    if (!wantsPlayback || !audio.error) return;
    console.warn('[Radio Calico] Media error', { code: audio.error.code, message: audio.error.message, currentTime: audio.currentTime, readyState: audio.readyState });
    // Native media errors arrive before HLS.js's fatal error event. Give the
    // HLS recovery path a chance instead of destroying its MediaSource here.
    if (hls && audio.error.code === 3) { recoverMedia(); return; }
    fail(audio.error.code === 3 || audio.error.code === 4
      ? 'This browser could not decode the stream. Try an up-to-date browser or open the direct stream link below.'
      : 'The stream connection was interrupted. Press play to reconnect.');
  });
  audio.addEventListener('ended', () => {
    if (wantsPlayback) fail('The broadcast has stopped. Press play to reconnect to the live station.');
  });
  window.addEventListener('offline', () => {
    if (wantsPlayback) fail('You’re offline. Reconnect to the internet, then press play to tune in.');
  });
  window.addEventListener('online', () => {
    if (player.dataset.state === 'error') status.textContent = 'Your connection is back. Press play to reconnect to the station.';
  });
  window.addEventListener('pagehide', pausePlayback);

  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Radio Calico', artist: 'Live radio · Lossless HLS', artwork: [{ src: new URL('/static/images/radio-calico-logo.png', window.location.href).href, sizes: '672x672', type: 'image/png' }] });
    for (const [action, handler] of [['play', startPlayback], ['pause', pausePlayback], ['stop', pausePlayback]]) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional browser integration. */ }
    }
  }
}
