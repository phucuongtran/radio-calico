const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let initRatings;
before(async () => { ({ initRatings } = await import('../static/ratings.js')); });

class Element {
  constructor() { this.handlers = {}; this.attributes = {}; this.textContent = ''; }
  addEventListener(name, callback) { this.handlers[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
}

const summary = (extra = {}) => ({ thumbs_up: 2, thumbs_down: 1, user_rating: null, csrf_token: 'server-token', ...extra });
const result = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

function setup(responses) {
  const ids = ['thumbs-up', 'thumbs-down', 'thumbs-up-count', 'thumbs-down-count', 'rating-status'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const window = new Element();
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  initRatings({
    document: { getElementById: id => elements[id] }, window, AbortController, URLSearchParams,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (typeof response === 'function') return response(options);
      if (!response) throw new Error('No queued response');
      return response;
    },
  });
  const settle = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
  return { elements, requests, timers, settle,
    track: data => window.handlers['radiocalico:track']({ detail: { title: 'Song & title', artist: 'Artist', available: true, ...data } }),
    click: value => elements[value === 1 ? 'thumbs-up' : 'thumbs-down'].handlers.click(),
  };
}

test('voting waits for track and server data, then displays both shared totals', async () => {
  const ui = setup([result(summary())]);
  assert.equal(ui.elements['thumbs-up'].disabled, true);
  ui.track();
  assert.equal(ui.elements['thumbs-up'].disabled, true);
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  assert.equal(ui.elements['thumbs-up-count'].textContent, '2');
  assert.equal(ui.elements['thumbs-down-count'].textContent, '1');
  const query = new URL(ui.requests[0].url, 'http://localhost').searchParams;
  assert.equal(query.get('title'), 'Song & title');
  assert.equal(ui.requests[0].credentials, 'same-origin');
});

test('one click posts once, updates totals, and keeps both buttons editable', async () => {
  const ui = setup([result(summary()), result(summary({ thumbs_up: 3, user_rating: 1 }))]);
  ui.track();
  await ui.settle();
  const pending = ui.click(1);
  assert.equal(ui.elements['thumbs-up'].disabled, true);
  await ui.click(-1);
  await pending;
  assert.equal(ui.requests.filter(request => request.method === 'POST').length, 1);
  const post = ui.requests[1];
  assert.equal(post.headers['X-CSRF-Token'], 'server-token');
  assert.deepEqual(JSON.parse(post.body), { title: 'Song & title', artist: 'Artist', rating: 1 });
  assert.equal(ui.elements['thumbs-up-count'].textContent, '3');
  assert.equal(ui.elements['thumbs-up'].attributes['aria-pressed'], 'true');
  assert.equal(ui.elements['thumbs-down'].disabled, false);
  assert.equal(ui.elements['thumbs-up'].disabled, false);
});

test('a saved vote stays highlighted and editable when the song plays again', async () => {
  const ui = setup([result(summary({ user_rating: -1 })), result(summary()), result(summary({ user_rating: -1 }))]);
  ui.track();
  await ui.settle();
  assert.equal(ui.elements['thumbs-down'].attributes['aria-pressed'], 'true');
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  await ui.click(-1);
  assert.equal(ui.requests.length, 1);
  ui.track({ title: 'Different song' });
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  ui.track();
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  assert.equal(ui.elements['thumbs-down'].attributes['aria-pressed'], 'true');
});

test('ratings can switch up, down, and up again without counting the listener twice', async () => {
  const ui = setup([result(summary()),
    result(summary({ user_rating: 1, thumbs_up: 3 })),
    result(summary({ user_rating: -1, thumbs_up: 2, thumbs_down: 2 })),
    result(summary({ user_rating: 1, thumbs_up: 3, thumbs_down: 1 })),
  ]);
  ui.track();
  await ui.settle();
  await ui.click(1);
  await ui.click(-1);
  assert.equal(ui.elements['thumbs-down'].attributes['aria-pressed'], 'true');
  assert.equal(ui.elements['thumbs-down-count'].textContent, '2');
  assert.equal(ui.elements['thumbs-up-count'].textContent, '2');
  await ui.click(1);
  assert.equal(ui.elements['thumbs-up'].attributes['aria-pressed'], 'true');
  assert.equal(ui.elements['thumbs-down-count'].textContent, '1');
  assert.equal(ui.elements['thumbs-up-count'].textContent, '3');
  await ui.click(1);
  assert.equal(ui.requests.length, 4);
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  assert.match(ui.elements['rating-status'].textContent, /change it anytime/);
});

test('a late old-song response cannot replace new-song totals', async () => {
  let finishOld;
  const ui = setup([() => new Promise(resolve => { finishOld = resolve; }), result(summary({ thumbs_up: 20 }))]);
  ui.track();
  await ui.settle();
  ui.track({ title: 'New song' });
  await ui.settle();
  finishOld(result(summary()));
  await ui.settle();
  assert.equal(ui.elements['thumbs-up-count'].textContent, '20');
});

test('an in-flight read cannot erase a submitted vote', async () => {
  let finishRead;
  const ui = setup([result(summary()), () => new Promise(resolve => { finishRead = resolve; }), result(summary({ user_rating: 1, thumbs_up: 3 }), 201)]);
  ui.track();
  await ui.settle();
  ui.track();
  await ui.settle();
  await ui.click(1);
  finishRead(result(summary()));
  await ui.settle();
  assert.equal(ui.elements['thumbs-up-count'].textContent, '3');
  assert.equal(ui.elements['thumbs-up'].attributes['aria-pressed'], 'true');
});

test('a lost POST response is checked against the server before allowing another vote', async () => {
  const ui = setup([result(summary()), new Error('Lost response'), result(summary({ user_rating: 1, thumbs_up: 3 }))]);
  ui.track();
  await ui.settle();
  await ui.click(1);
  await ui.settle();
  assert.equal(ui.requests.length, 3);
  assert.equal(ui.elements['thumbs-up-count'].textContent, '3');
  assert.equal(ui.elements['thumbs-up'].disabled, false);
});

test('failed totals do not look like zero votes or allow unverified voting', async () => {
  const ui = setup([result({}, 503), result(summary())]);
  ui.track();
  await ui.settle();
  assert.equal(ui.elements['thumbs-up-count'].textContent, '—');
  assert.equal(ui.elements['thumbs-up'].disabled, true);
  ui.track();
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].disabled, false);
});

test('stale station metadata disables voting until current track information returns', async () => {
  const ui = setup([result(summary()), result(summary())]);
  ui.track();
  await ui.settle();
  ui.track({ available: false });
  await ui.click(1);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.elements['thumbs-up'].disabled, true);
  ui.track();
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].disabled, false);
});

test('a pending vote belongs to its original song when the current track changes', async () => {
  let finishVote;
  const ui = setup([result(summary()), () => new Promise(resolve => { finishVote = resolve; }), result(summary({ thumbs_up: 10 }))]);
  ui.track();
  await ui.settle();
  const pending = ui.click(1);
  await ui.settle();
  ui.track({ title: 'Next song' });
  await ui.settle();
  finishVote(result(summary({ user_rating: 1 }), 201));
  await pending;
  assert.equal(JSON.parse(ui.requests[1].body).title, 'Song & title');
  assert.equal(ui.elements['thumbs-up-count'].textContent, '10');
  assert.equal(ui.elements['thumbs-up'].disabled, false);
});

test('read timeouts abort the request, clear the timer, and allow a later refresh', async () => {
  const ui = setup([
    options => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Timed out')));
    }),
    result(summary()),
  ]);
  ui.track();
  await ui.settle();
  const timeout = [...ui.timers.values()].find(timer => timer.delay === 8000);
  assert.ok(timeout);
  timeout.callback();
  await ui.settle();
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.elements['thumbs-up'].disabled, true);
  ui.track();
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  assert.equal(ui.timers.size, 0);
});

test('a timed-out POST checks committed totals before accepting another vote', async () => {
  const ui = setup([
    result(summary()),
    options => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Timed out')));
    }),
    result(summary({ user_rating: 1, thumbs_up: 3 })),
  ]);
  ui.track();
  await ui.settle();
  const saving = ui.click(1);
  const timeout = [...ui.timers.values()].find(timer => timer.delay === 8000);
  assert.ok(timeout);
  timeout.callback();
  await saving;
  await ui.settle();
  assert.equal(ui.requests[1].signal.aborted, true);
  assert.equal(ui.requests[2].method, undefined);
  assert.equal(ui.elements['thumbs-up'].attributes['aria-pressed'], 'true');
  assert.equal(ui.elements['thumbs-up-count'].textContent, '3');
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  assert.equal(ui.timers.size, 0);
});
