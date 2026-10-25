const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createHttpHarness, result, summary, abortableResponse } = require('./helpers/ratings.cjs');
let createRatingsApi;
before(async () => { ({ createRatingsApi } = await import('../static/ratings-api.js')); });

function setup(responses) {
  const http = createHttpHarness(responses);
  return { ...http, api: createRatingsApi(http.environment) };
}

test('read encodes Unicode and reserved characters and uses same-origin cookies', async () => {
  const data = summary();
  const http = setup([result(data)]);
  const song = { title: 'Café & Song? #1 + 2', artist: 'Nghệ sĩ / A=B' };
  assert.deepEqual(await http.api.read(song).promise, data);
  const request = http.requests[0];
  const url = new URL(request.url, 'http://localhost');
  assert.equal(url.pathname, '/api/ratings');
  assert.deepEqual(Object.fromEntries(url.searchParams), song);
  assert.equal(request.credentials, 'same-origin');
  assert.equal(request.cache, 'no-store');
  assert.equal(http.timers.size, 0);
});

test('submit sends the selected rating as JSON with the session CSRF token', async () => {
  const http = setup([result(summary({ user_rating: -1 }))]);
  const song = { title: 'Song', artist: 'Artist' };
  await http.api.submit(song, -1, 'test-csrf').promise;
  const request = http.requests[0];
  assert.equal(request.url, '/api/ratings');
  assert.equal(request.method, 'POST');
  assert.equal(request.credentials, 'same-origin');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(request.headers['X-CSRF-Token'], 'test-csrf');
  assert.deepEqual(JSON.parse(request.body), { ...song, rating: -1 });
  assert.equal(http.timers.size, 0);
});

for (const status of [400, 403, 413, 415, 503]) {
  test(`HTTP ${status} rejects the request and clears its timeout`, async () => {
    let parsed = false;
    const http = setup([{ ok: false, status, json: async () => { parsed = true; } }]);
    await assert.rejects(http.api.read({ title: 'Song', artist: 'Artist' }).promise, new RegExp(`HTTP ${status}`));
    assert.equal(parsed, false);
    assert.equal(http.timers.size, 0);
  });
}

test('network and JSON parsing failures propagate and clear their timers', async () => {
  for (const response of [new Error('Offline'), { ok: true, json: async () => { throw new SyntaxError('Bad JSON'); } }]) {
    const http = setup([response]);
    await assert.rejects(http.api.read({ title: 'Song', artist: 'Artist' }).promise, /Offline|Bad JSON/);
    assert.equal(http.timers.size, 0);
  }
});

test('timeouts abort reads and writes without resubmitting either request', async () => {
  for (const method of ['read', 'submit']) {
    const http = setup([abortableResponse]);
    const pending = http.api[method]({ title: 'Song', artist: 'Artist' }, 1, 'test-csrf');
    const rejection = assert.rejects(pending.promise, { name: 'AbortError' });
    http.runTimeout();
    await rejection;
    assert.equal(http.requests[0].signal.aborted, true);
    assert.equal(http.requests.length, 1);
    assert.equal(http.timers.size, 0);
  }
});

test('explicit cancellation only aborts the selected request', async () => {
  const http = setup([abortableResponse, result(summary())]);
  const first = http.api.read({ title: 'First', artist: 'Artist' });
  const second = http.api.read({ title: 'Second', artist: 'Artist' });
  const rejection = assert.rejects(first.promise, { name: 'AbortError' });
  first.abort();
  await rejection;
  assert.deepEqual(await second.promise, summary());
  assert.equal(http.requests[0].signal.aborted, true);
  assert.equal(http.requests[1].signal.aborted, false);
  assert.equal(http.timers.size, 0);
});
