const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let initRatings;
before(async () => { ({ initRatings } = await import('../static/ratings.js')); });
const { setup: createUi, summary, result, deferred, abortableResponse } = require('./helpers/ratings.cjs');
const setup = responses => createUi(initRatings, responses);

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
  const oldResponse = deferred();
  // Deliberately ignore abort to verify that even a late response is harmless.
  const ui = setup([() => oldResponse.promise, result(summary({ thumbs_up: 20 }))]);
  ui.track();
  await ui.settle();
  ui.track({ title: 'New song' });
  await ui.settle();
  oldResponse.resolve(result(summary()));
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

const invalidSummaries = [
  ['null body', null], ['missing fields', {}],
  ['negative count', summary({ thumbs_up: -1 })],
  ['fractional count', summary({ thumbs_down: 1.5 })],
  ['string count', summary({ thumbs_up: '2' })],
  ['unsafe count', summary({ thumbs_up: Number.MAX_SAFE_INTEGER + 1 })],
  ['invalid choice', summary({ user_rating: 0 })],
  ['string choice', summary({ user_rating: '1' })],
  ['missing choice', summary({ user_rating: undefined })],
  ['empty CSRF', summary({ csrf_token: '' })],
  ['non-string CSRF', summary({ csrf_token: 1 })],
];

for (const [description, data] of invalidSummaries) {
  test(`a response with ${description} disables voting and can recover on refresh`, async () => {
    const ui = setup([result(data), result(summary())]);
    ui.track();
    await ui.settle();
    assert.equal(ui.elements['thumbs-up'].disabled, true);
    assert.equal(ui.elements['thumbs-down'].disabled, true);
    assert.equal(ui.elements['thumbs-up-count'].textContent, '—');
    await ui.click(1);
    assert.equal(ui.requests.length, 1);
    ui.track();
    await ui.settle();
    assert.equal(ui.elements['thumbs-up'].disabled, false);
    assert.equal(ui.elements['thumbs-up-count'].textContent, '2');
    assert.equal(ui.timers.size, 0);
  });
}

test('a malformed POST response is confirmed by reading the saved vote', async () => {
  const ui = setup([result(summary()), result({}), result(summary({ user_rating: -1, thumbs_down: 2 }))]);
  ui.track();
  await ui.settle();
  await ui.click(-1);
  await ui.settle();
  assert.deepEqual(ui.requests.map(request => request.method || 'GET'), ['GET', 'POST', 'GET']);
  assert.equal(ui.elements['thumbs-down'].attributes['aria-pressed'], 'true');
  assert.equal(ui.elements['thumbs-down-count'].textContent, '2');
  assert.equal(ui.elements['thumbs-up'].disabled, false);
});

test('failed confirmation keeps voting disabled until a later successful read', async () => {
  const ui = setup([result(summary()), new Error('Lost POST'), result({}, 503),
    result(summary({ user_rating: 1, thumbs_up: 3 })),
  ]);
  ui.track();
  await ui.settle();
  await ui.click(1);
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].disabled, true);
  await ui.click(1);
  assert.equal(ui.requests.length, 3);
  ui.track();
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  assert.equal(ui.elements['thumbs-up-count'].textContent, '3');
  assert.equal(ui.requests.filter(request => request.method === 'POST').length, 1);
});

test('changing tracks cancels the previous read and clears both request timers', async () => {
  const ui = setup([abortableResponse, result(summary({ thumbs_up: 10 }))]);
  ui.track();
  await ui.settle();
  ui.track({ title: 'Next song' });
  await ui.settle();
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.elements['thumbs-up-count'].textContent, '10');
  assert.equal(ui.elements['thumbs-up'].disabled, false);
  assert.equal(ui.timers.size, 0);
});

test('accessible button labels and pressed states follow confirmed totals', async () => {
  const ui = setup([result(summary()), result(summary({ user_rating: -1, thumbs_down: 2 }))]);
  ui.track();
  await ui.settle();
  assert.equal(ui.elements['thumbs-up'].attributes['aria-pressed'], 'false');
  assert.equal(ui.elements['thumbs-down'].attributes['aria-pressed'], 'false');
  assert.equal(ui.elements['thumbs-up'].attributes['aria-label'], 'Thumbs up: 2 votes');
  await ui.click(-1);
  assert.equal(ui.elements['thumbs-up'].attributes['aria-pressed'], 'false');
  assert.equal(ui.elements['thumbs-down'].attributes['aria-pressed'], 'true');
  assert.equal(ui.elements['thumbs-down'].attributes['aria-label'], 'Thumbs down: 2 votes');
});
