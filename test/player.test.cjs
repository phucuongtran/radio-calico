// Exercise the player controller without network access or browser dependencies.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let initPlayer;
before(async () => { ({ initPlayer } = await import('../static/player.js')); });
const stream = 'https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8';

class Element {
  constructor() {
    this.handlers = {};
    this.attributes = {};
    this.dataset = { state: 'idle' };
    this.style = { setProperty() {} };
    this.classList = { toggle() {} };
  }
  addEventListener(name, handler) { (this.handlers[name] ??= []).push(handler); }
  emit(name) { return Promise.all((this.handlers[name] ?? []).map(handler => handler())); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  remove() { this.removed = true; }
}

function setup({ native = true, library = true, supported = true, playError = null, pending = false, autoManifest = true, diagnosticFetch } = {}) {
  const ids = ['radio-audio', 'play-toggle', 'player-status', 'elapsed'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const player = new Element();
  const audio = elements['radio-audio'];
  audio.paused = true;
  audio.currentTime = 0;
  audio.readyState = 4;
  audio.seeking = false;
  audio.muted = false;
  audio.seekable = { length: 0 };
  audio.canPlayType = () => native ? 'probably' : '';
  Object.defineProperty(audio, 'src', { set(value) { this.attributes.src = value; } });
  audio.playCalls = 0;
  audio.play = async () => {
    audio.playCalls++;
    if (playError) throw Object.assign(new Error('Playback rejected'), { name: playError });
    if (!pending) { audio.paused = false; await audio.emit('playing'); }
  };
  audio.pause = () => {
    if (!audio.paused) { audio.paused = true; void audio.emit('pause'); }
  };
  audio.load = () => { audio.loads = (audio.loads ?? 0) + 1; };
  const instances = [];
  class Hls {
    static Events = { ERROR: 'error', MEDIA_ATTACHED: 'mediaAttached', MANIFEST_PARSED: 'manifestParsed', FRAG_LOADED: 'fragLoaded', FRAG_BUFFERED: 'fragBuffered' };
    static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };
    static isSupported() { return supported; }
    constructor() { instances.push(this); this.liveSyncPosition = 120; this.handlers = {}; }
    on(name, callback) { this.handlers[name] = callback; }
    once(name, callback) { this.handlers[name] = (...args) => { delete this.handlers[name]; return callback(...args); }; }
    loadSource(url) {
      this.url = url;
      if (autoManifest) queueMicrotask(() => this.handlers.manifestParsed?.());
    }
    attachMedia(media) { this.media = media; }
    destroy() { this.destroyed = true; }
    recoverMediaError() { this.recoveries = (this.recoveries ?? 0) + 1; audio.pause(); audio.error = null; }
    error(type, fatal = true) { this.handlers.error('error', { type, fatal }); }
  }
  const scripts = [];
  const timers = new Map();
  let timerId = 0;
  const window = new Element();
  const diagnostics = [];
  if (library) window.Hls = Hls;
  const context = {
    document: { getElementById: id => elements[id], querySelector: () => player, body: new Element(), createElement: () => new Element(), head: { append: script => scripts.push(script) } },
    navigator: {}, window, console: { warn: (...args) => diagnostics.push(args) },
    fetch: diagnosticFetch,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), setInterval() {},
  };
  initPlayer(context);
  return { elements, audio, player, window, Hls, scripts, instances, timers, diagnostics,
    click: () => elements['play-toggle'].emit('click'),
    message: () => elements['player-status'].textContent,
    timeout: delay => { const item = [...timers.values()].find(timer => timer.delay === delay); assert.ok(item); item.callback(); },
  };
}

test('native HLS is user initiated; pause releases the stream and resume reconnects', async () => {
  const ui = setup({ supported: false });
  assert.equal(ui.audio.playCalls, 0);
  assert.equal(ui.elements['play-toggle'].disabled, false);
  await ui.click();
  assert.equal(ui.audio.getAttribute('src'), stream);
  assert.equal(ui.player.dataset.state, 'playing');
  assert.equal(ui.elements['play-toggle'].getAttribute('aria-label'), 'Pause Radio Calico');
  assert.equal(ui.timers.size, 0);
  await ui.click();
  assert.equal(ui.player.dataset.state, 'paused');
  assert.equal(ui.audio.getAttribute('src'), undefined);
  assert.equal(ui.audio.paused, true);
  await ui.click();
  assert.equal(ui.audio.playCalls, 2);
  assert.equal(ui.audio.getAttribute('src'), stream);
});

test('HLS.js attaches the provided stream without seeking before it is ready', async () => {
  const ui = setup({ native: false });
  await ui.click();
  assert.equal(ui.instances.length, 1);
  assert.equal(ui.instances[0].url, stream);
  assert.equal(ui.instances[0].media, ui.audio);
  assert.equal(ui.audio.currentTime, 0);
  assert.equal(ui.player.dataset.state, 'playing');
  await ui.click();
  assert.equal(ui.instances[0].destroyed, true);
  await ui.click();
  assert.equal(ui.instances.length, 2);
});

test('elapsed listening time follows stream progress across pause, resume, and live seeks', async () => {
  const ui = setup();
  // Live HLS media timestamps need not begin at zero.
  ui.audio.currentTime = 100000;
  await ui.click();
  ui.audio.currentTime += 65;
  await ui.audio.emit('timeupdate');
  assert.equal(ui.elements.elapsed.textContent, '1:05');
  await ui.click();
  ui.audio.currentTime += 60;
  await ui.audio.emit('timeupdate');
  assert.equal(ui.elements.elapsed.textContent, '1:05');
  ui.audio.currentTime = 200000;
  await ui.click();
  ui.audio.currentTime += 5;
  await ui.audio.emit('timeupdate');
  assert.equal(ui.elements.elapsed.textContent, '1:10');
  await ui.audio.emit('waiting');
  await ui.audio.emit('timeupdate');
  assert.equal(ui.elements.elapsed.textContent, '1:10');
  await ui.audio.emit('seeking');
  ui.audio.currentTime += 1000;
  await ui.audio.emit('seeked');
  ui.audio.currentTime += 1;
  await ui.audio.emit('timeupdate');
  assert.equal(ui.elements.elapsed.textContent, '1:11');
  assert.equal(ui.elements.elapsed.getAttribute('datetime'), 'PT71S');
});

test('fatal network failure releases HLS and supports a clean retry', async () => {
  const ui = setup({ native: false });
  await ui.click();
  ui.instances[0].error('networkError');
  assert.equal(ui.player.dataset.state, 'error');
  assert.equal(ui.instances[0].destroyed, true);
  assert.match(ui.message(), /unavailable/);
  await ui.click();
  assert.equal(ui.player.dataset.state, 'playing');
  assert.equal(ui.instances.length, 2);
});

test('codec errors allow one recovery, then report an actionable failure', async () => {
  const ui = setup({ native: false });
  await ui.click();
  ui.instances[0].error('mediaError');
  assert.equal(ui.player.dataset.state, 'buffering');
  assert.equal(ui.instances[0].recoveries, 1);
  assert.equal(ui.instances[0].destroyed, undefined);
  ui.instances[0].handlers.mediaAttached();
  await Promise.resolve();
  assert.equal(ui.audio.playCalls, 2);
  assert.equal(ui.player.dataset.state, 'playing');
  ui.instances[0].error('mediaError');
  assert.equal(ui.player.dataset.state, 'error');
  assert.match(ui.message(), /decode/);
});

test('canceling during library loading prevents late playback', async () => {
  const ui = setup({ native: false, library: false });
  const firstClick = ui.click();
  assert.equal(ui.player.dataset.state, 'connecting');
  await ui.click();
  ui.window.Hls = ui.Hls;
  ui.scripts[0].onload();
  await firstClick;
  assert.equal(ui.player.dataset.state, 'paused');
  assert.equal(ui.audio.playCalls, 0);
  assert.equal(ui.instances.length, 0);
});

test('failed CDN load displays an error and retry creates a new request', async () => {
  const ui = setup({ native: false, library: false });
  const firstClick = ui.click();
  ui.scripts[0].onerror();
  await firstClick;
  assert.equal(ui.player.dataset.state, 'error');
  assert.match(ui.message(), /player could not load/);
  const retry = ui.click();
  assert.equal(ui.scripts.length, 2);
  ui.window.Hls = ui.Hls;
  ui.scripts[1].onload();
  await retry;
  assert.equal(ui.player.dataset.state, 'playing');
});

test('unsupported browsers receive a useful compatibility message', async () => {
  const ui = setup({ native: false, supported: false });
  await ui.click();
  assert.equal(ui.player.dataset.state, 'error');
  assert.equal(ui.audio.playCalls, 0);
  assert.match(ui.message(), /browser cannot play/);
});

test('blocked autoplay allows retry without claiming that playback started', async () => {
  const ui = setup({ playError: 'NotAllowedError' });
  await ui.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ui.player.dataset.state, 'paused');
  assert.match(ui.message(), /another click/);
  assert.equal(ui.elements['play-toggle'].getAttribute('aria-pressed'), 'false');
});

test('stalled playback times out and offers a retry', async () => {
  const ui = setup({ supported: false });
  await ui.click();
  await ui.audio.emit('waiting');
  assert.equal(ui.player.dataset.state, 'buffering');
  ui.timeout(25000);
  assert.equal(ui.player.dataset.state, 'error');
  assert.equal(ui.audio.paused, true);
  assert.match(ui.message(), /did not resume within 25 seconds/);
  assert.equal(ui.diagnostics.at(-1)[0], '[Radio Calico] Playback diagnostic');
  assert.equal(ui.diagnostics.at(-1)[1].engine, 'native HLS');
  assert.equal(ui.diagnostics.at(-1)[1].state, 'buffering');
  assert.equal(ui.diagnostics.at(-1)[1].paused, false);
});

test('offline and online changes never restart audio without a click', async () => {
  const ui = setup();
  await ui.click();
  await ui.window.emit('offline');
  assert.equal(ui.player.dataset.state, 'error');
  assert.match(ui.message(), /offline/);
  await ui.window.emit('online');
  assert.equal(ui.audio.playCalls, 1);
  assert.match(ui.message(), /connection is back/);
});

test('a fetch stall with playable buffered audio does not arm a shutdown timer', async () => {
  const ui = setup();
  await ui.click();
  await ui.audio.emit('stalled');
  assert.equal(ui.player.dataset.state, 'playing');
  assert.equal(ui.timers.size, 0);
});

test('actual playback progress clears a stall without needing another playing event', async () => {
  const ui = setup();
  await ui.click();
  ui.audio.readyState = 2;
  await ui.audio.emit('stalled');
  assert.equal(ui.player.dataset.state, 'buffering');
  ui.audio.currentTime = 1;
  await ui.audio.emit('timeupdate');
  assert.equal(ui.player.dataset.state, 'playing');
  assert.equal(ui.timers.size, 0);
});

test('timeupdate events with no progress do not hide a genuine stall', async () => {
  const ui = setup();
  await ui.click();
  await ui.audio.emit('waiting');
  await ui.audio.emit('timeupdate');
  assert.equal(ui.player.dataset.state, 'buffering');
  ui.timeout(25000);
  assert.equal(ui.player.dataset.state, 'error');
});

test('native decode event on an HLS attachment recovers instead of destroying it', async () => {
  const ui = setup({ native: false });
  await ui.click();
  ui.audio.error = { code: 3, message: 'Decoder failed' };
  await ui.audio.emit('error');
  assert.equal(ui.instances[0].recoveries, 1);
  assert.equal(ui.instances[0].destroyed, undefined);
  ui.instances[0].handlers.mediaAttached();
  await Promise.resolve();
  assert.equal(ui.player.dataset.state, 'playing');
  assert.equal(ui.audio.paused, false);
});

test('pausing during media recovery prevents the reattachment from restarting audio', async () => {
  const ui = setup({ native: false });
  await ui.click();
  ui.instances[0].error('mediaError');
  await ui.click();
  ui.instances[0].handlers.mediaAttached();
  await Promise.resolve();
  assert.equal(ui.audio.playCalls, 1);
  assert.equal(ui.player.dataset.state, 'paused');
});

test('an obsolete queued pause event cannot stop audio that is already playing', async () => {
  const ui = setup();
  await ui.click();
  await ui.audio.emit('pause');
  assert.equal(ui.audio.paused, false);
  assert.equal(ui.player.dataset.state, 'playing');
});

test('recovery ignores the aborted play promise from the old MediaSource', async () => {
  const ui = setup({ native: false });
  const normalPlay = ui.audio.play;
  let rejectOldPlay;
  ui.audio.play = () => new Promise((_resolve, reject) => { rejectOldPlay = reject; });
  const starting = ui.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(typeof rejectOldPlay, 'function');
  ui.instances[0].error('mediaError');
  ui.audio.play = normalPlay;
  ui.instances[0].handlers.mediaAttached();
  rejectOldPlay(Object.assign(new Error('The media was detached'), { name: 'AbortError' }));
  await starting;
  assert.equal(ui.player.dataset.state, 'playing');
  assert.equal(ui.instances[0].destroyed, undefined);
});

test('HLS.js is preferred even when the browser advertises native HLS support', async () => {
  const ui = setup({ native: true, autoManifest: false });
  await ui.click();
  assert.equal(ui.instances.length, 1);
  assert.equal(ui.audio.getAttribute('src'), undefined);
  assert.equal(ui.audio.playCalls, 0);
  assert.equal(ui.player.dataset.state, 'connecting');
  ui.instances[0].handlers.manifestParsed();
  await Promise.resolve();
  assert.equal(ui.audio.playCalls, 1);
  assert.equal(ui.player.dataset.state, 'playing');
});

test('canceling before the playlist is parsed prevents late playback', async () => {
  const ui = setup({ autoManifest: false });
  await ui.click();
  await ui.click();
  ui.instances[0].handlers.manifestParsed();
  await Promise.resolve();
  assert.equal(ui.audio.playCalls, 0);
  assert.equal(ui.player.dataset.state, 'paused');
});

test('buffering diagnostics preserve fragment download and append counters', async () => {
  const ui = setup();
  await ui.click();
  const engine = ui.instances[0];
  engine.handlers.fragLoaded('fragLoaded', { frag: { sn: 20, duration: 2 } });
  engine.handlers.fragBuffered();
  engine.handlers.fragLoaded('fragLoaded', { frag: { sn: 21, duration: 2 } });
  await ui.audio.emit('waiting');
  const record = ui.diagnostics.at(-1)[1];
  assert.equal(record.engine, 'HLS.js');
  assert.equal(record.event, 'waiting');
  assert.equal(record.fragmentsLoaded, 2);
  assert.equal(record.fragmentsBuffered, 1);
  assert.equal(record.lastFragment.sequence, 21);
});

test('native HLS remains available if the library cannot be downloaded', async () => {
  const ui = setup({ native: true, library: false });
  const start = ui.click();
  ui.scripts[0].onerror();
  await start;
  assert.equal(ui.player.dataset.state, 'playing');
  assert.equal(ui.audio.getAttribute('src'), stream);
});

test('a library timeout releases its script and permits a fresh retry', async () => {
  const ui = setup({ native: false, library: false });
  const first = ui.click();
  ui.timeout(12000);
  await first;
  assert.equal(ui.scripts[0].removed, true);
  assert.equal(ui.player.dataset.state, 'error');
  const retry = ui.click();
  assert.equal(ui.scripts.length, 2);
  ui.window.Hls = ui.Hls;
  ui.scripts[1].onload();
  await retry;
  assert.equal(ui.player.dataset.state, 'playing');
});

test('elapsed time formats an hour without resetting after a new connection', async () => {
  const ui = setup();
  ui.audio.currentTime = 100000;
  await ui.click();
  ui.audio.currentTime += 3661;
  await ui.audio.emit('timeupdate');
  assert.equal(ui.elements.elapsed.textContent, '1:01:01');
  await ui.click();
  ui.audio.currentTime = 200000;
  await ui.click();
  ui.audio.currentTime += 1;
  await ui.audio.emit('timeupdate');
  assert.equal(ui.elements.elapsed.textContent, '1:01:02');
  assert.equal(ui.elements.elapsed.getAttribute('datetime'), 'PT3662S');
});

test('diagnostic delivery failures never interrupt playback', async () => {
  for (const diagnosticFetch of [
    () => { throw new Error('Reporting unavailable'); },
    async () => { throw new Error('Reporting unavailable'); },
  ]) {
    const ui = setup({ diagnosticFetch });
    await ui.click();
    assert.equal(ui.player.dataset.state, 'playing');
    assert.equal(ui.audio.paused, false);
    await ui.click();
    assert.equal(ui.player.dataset.state, 'paused');
  }
});
