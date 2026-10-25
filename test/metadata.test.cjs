const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let initMetadata;
before(async () => { ({ initMetadata } = await import('../static/metadata.js')); });

class Element {
  constructor() { this.handlers = {}; this.children = []; this.textContent = ''; this.hidden = false; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  dispatchEvent(event) { this.handlers[event.type]?.(event); }
  set innerHTML(_value) { throw new Error('Metadata must never be inserted as HTML'); }
}

function station() {
  return Object.assign({ title: 'Current song', artist: 'Current artist' },
    ...Array.from({ length: 6 }, (_, index) => ({ [`prev_title_${index + 1}`]: `Previous ${index + 1}`, [`prev_artist_${index + 1}`]: `Artist ${index + 1}` })));
}

function setup(responses) {
  const ids = ['current-track-title', 'current-track-artist', 'current-album-art', 'recent-tracks', 'recent-empty', 'metadata-status'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const timers = new Map();
  const requests = [];
  let timerId = 0;
  const document = Object.assign(new Element(), { getElementById: id => elements[id], createElement: () => new Element() });
  const window = new Element();
  initMetadata({
    document, window, navigator: {}, AbortController,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console: { warn() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (typeof response === 'function') return response(options);
      if (!response) throw new Error('No queued response');
      return { ok: response.ok ?? true, status: response.status ?? 200, json: async () => response.data };
    },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const settle = async () => { for (let step = 0; step < 12; step++) await Promise.resolve(); };
  return { elements, document, window, requests, timers, settle,
    refresh: async () => {
      const next = [...timers.entries()].find(([, timer]) => timer.delay === 10000);
      assert.ok(next, 'Next metadata refresh is scheduled');
      timers.delete(next[0]);
      await next[1].callback();
    },
  };
}

test('shows current title and artist plus exactly five previous tracks, newest first', async () => {
  const ui = setup([{ data: station() }]);
  await ui.settle();
  assert.equal(ui.elements['current-track-title'].textContent, 'Current song');
  assert.equal(ui.elements['current-track-artist'].textContent, 'Current artist');
  assert.match(ui.elements['current-album-art'].src, /^https:\/\/d3d4yli4hf5bmh\.cloudfront\.net\/cover\.jpg\?t=/);
  assert.match(ui.elements['current-album-art'].alt, /Current song.*Current artist/);
  const rows = ui.elements['recent-tracks'].children;
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.children.map(child => child.textContent)),
    Array.from({ length: 5 }, (_, index) => [`Previous ${index + 1}`, `Artist ${index + 1}`]));
  assert.equal(ui.elements['recent-tracks'].hidden, false);
  assert.equal(ui.elements['recent-empty'].hidden, true);
  assert.equal(ui.elements['metadata-status'].hidden, true);
  assert.match(ui.requests[0].url, /^https:\/\/d3d4yli4hf5bmh\.cloudfront\.net\/metadatav2\.json\?t=\d+$/);
  assert.equal(ui.requests[0].options.cache, 'no-store');
});

test('refresh replaces the station snapshot without accumulating or reordering history', async () => {
  const next = station();
  next.title = 'Next song';
  next.artist = 'Next artist';
  next.prev_title_1 = 'Current song';
  next.prev_artist_1 = 'Current artist';
  const ui = setup([{ data: station() }, { data: next }]);
  await ui.settle();
  const originalCover = ui.elements['current-album-art'].src;
  await ui.refresh();
  assert.notEqual(ui.elements['current-album-art'].src, originalCover);
  assert.match(ui.elements['current-album-art'].alt, /Next song.*Next artist/);
  assert.equal(ui.elements['current-track-title'].textContent, 'Next song');
  assert.equal(ui.elements['recent-tracks'].children.length, 5);
  assert.equal(ui.elements['recent-tracks'].children[0].children[0].textContent, 'Current song');
});

test('unchanged metadata does not rebuild the track list', async () => {
  const ui = setup([{ data: station() }, { data: station() }]);
  await ui.settle();
  const firstRow = ui.elements['recent-tracks'].children[0];
  const originalCover = ui.elements['current-album-art'].src;
  await ui.refresh();
  assert.equal(ui.elements['recent-tracks'].children[0], firstRow);
  assert.equal(ui.elements['current-album-art'].src, originalCover);
});

test('station strings render as plain text and incomplete history entries are skipped', async () => {
  const data = station();
  data.title = '<img src=x onerror=alert(1)>';
  data.prev_title_1 = '<script>bad()</script>';
  data.prev_artist_2 = null;
  data.prev_title_3 = ' ';
  const ui = setup([{ data }]);
  await ui.settle();
  assert.equal(ui.elements['current-track-title'].textContent, data.title);
  const rows = ui.elements['recent-tracks'].children;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].children[0].textContent, data.prev_title_1);
  assert.equal(rows[1].children[0].textContent, 'Previous 4');
});

test('empty history uses an honest empty state, with no invented track names', async () => {
  const ui = setup([{ data: { title: 'Current song', artist: 'Current artist' } }]);
  await ui.settle();
  assert.equal(ui.elements['recent-tracks'].hidden, true);
  assert.equal(ui.elements['recent-empty'].hidden, false);
  assert.match(ui.elements['recent-empty'].textContent, /No recently played tracks/);
});

test('a real repeated song is preserved as a separate previous play', async () => {
  const data = station();
  data.prev_title_2 = data.prev_title_1;
  data.prev_artist_2 = data.prev_artist_1;
  const ui = setup([{ data }]);
  await ui.settle();
  const rows = ui.elements['recent-tracks'].children;
  assert.equal(rows.length, 5);
  assert.equal(rows[0].children[0].textContent, rows[1].children[0].textContent);
});

test('failed and malformed refreshes keep the last valid tracks and mark them stale', async () => {
  const ui = setup([{ data: station() }, { ok: false, status: 503 }, { data: {} }, { data: station() }]);
  await ui.settle();
  const firstRow = ui.elements['recent-tracks'].children[0];
  await ui.refresh();
  assert.equal(ui.elements['current-track-title'].textContent, 'Current song');
  assert.equal(ui.elements['recent-tracks'].children[0], firstRow);
  assert.equal(ui.elements['metadata-status'].hidden, false);
  assert.match(ui.elements['metadata-status'].textContent, /last received/);
  await ui.refresh();
  assert.equal(ui.elements['recent-tracks'].children[0], firstRow);
  await ui.refresh();
  assert.equal(ui.elements['metadata-status'].hidden, true);
});

test('initial failure displays unavailable state and retries successfully', async () => {
  const ui = setup([new Error('Offline'), { data: station() }]);
  await ui.settle();
  assert.equal(ui.elements['current-track-title'].textContent, 'Track information unavailable');
  assert.equal(ui.elements['recent-tracks'].children.length, 0);
  assert.match(ui.elements['metadata-status'].textContent, /Retrying automatically/);
  await ui.refresh();
  assert.equal(ui.elements['current-track-title'].textContent, 'Current song');
});

test('hiding the page aborts the old request and late results cannot replace fresh data', async () => {
  let completeOld;
  const ui = setup([
    () => new Promise(resolve => { completeOld = resolve; }),
    { data: { title: 'Fresh song', artist: 'Fresh artist' } },
  ]);
  await ui.settle();
  assert.equal(ui.requests.length, 1);
  ui.document.hidden = true;
  ui.document.handlers.visibilitychange();
  assert.equal(ui.requests[0].options.signal.aborted, true);
  ui.document.hidden = false;
  ui.document.handlers.visibilitychange();
  await ui.settle();
  assert.equal(ui.elements['current-track-title'].textContent, 'Fresh song');
  completeOld({ ok: true, json: async () => station() });
  await ui.settle();
  assert.equal(ui.elements['current-track-title'].textContent, 'Fresh song');
});

test('album artwork errors keep the track visible and retry on the next snapshot', async () => {
  const ui = setup([{ data: station() }, { data: station() }]);
  await ui.settle();
  const cover = ui.elements['current-album-art'];
  const firstUrl = cover.src;
  cover.handlers.error();
  assert.equal(cover.src, '/static/images/radio-calico-logo.png');
  assert.equal(ui.elements['current-track-title'].textContent, 'Current song');
  await ui.refresh();
  assert.notEqual(cover.src, firstUrl);
  assert.match(cover.src, /^https:\/\/.*\/cover\.jpg\?t=/);
});

test('the module entry connects the first metadata update to ratings without autoplay', async () => {
  class BrowserElement extends Element {
    constructor() {
      super();
      this.attributes = {};
      this.dataset = { state: 'idle' };
      this.classList = { toggle() {} };
      this.paused = true;
      this.playCalls = 0;
    }
    addEventListener(name, handler) { (this.handlers[name] ??= []).push(handler); }
    dispatchEvent(event) { for (const handler of this.handlers[event.type] ?? []) handler(event); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    pause() { this.paused = true; }
    load() {}
    play() { this.playCalls++; throw new Error('Playback requires a user action'); }
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new BrowserElement());
    return elements.get(id);
  };
  const window = Object.assign(new BrowserElement(), { location: { href: 'http://localhost/' } });
  const document = Object.assign(new BrowserElement(), {
    getElementById: element,
    querySelector: element,
    createElement: () => new BrowserElement(),
    body: new BrowserElement(),
  });
  const mediaSession = { actions: {}, setActionHandler(action, handler) { this.actions[action] = handler; } };
  const requests = [];
  class MediaMetadata { constructor(data) { Object.assign(this, data); } }
  window.MediaMetadata = MediaMetadata;
  const environment = {
    document, window, navigator: { mediaSession }, MediaMetadata,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: async url => {
      requests.push(url);
      const data = url.startsWith('/api/ratings?')
        ? { thumbs_up: 4, thumbs_down: 1, user_rating: null, csrf_token: 'session-token' }
        : station();
      return { ok: true, json: async () => data };
    },
  };
  const originals = Object.fromEntries(Object.keys(environment).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(environment)) {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    await import('../static/main.js');
    for (let step = 0; step < 20; step++) await Promise.resolve();
    assert.equal(requests.length, 2);
    const query = new URL(requests[1], 'http://localhost').searchParams;
    assert.equal(query.get('title'), 'Current song');
    assert.equal(element('thumbs-up-count').textContent, '4');
    assert.equal(element('thumbs-up').disabled, false);
    assert.equal(element('radio-audio').playCalls, 0);
    assert.equal(element('.player').dataset.state, 'idle');
    assert.equal(mediaSession.metadata.title, 'Current song');
    assert.equal(typeof mediaSession.actions.play, 'function');
  } finally {
    window.dispatchEvent({ type: 'pagehide' });
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
