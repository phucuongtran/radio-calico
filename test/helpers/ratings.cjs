const assert = require('node:assert/strict');

class Element {
  constructor() { this.handlers = {}; this.attributes = {}; this.textContent = ''; }
  addEventListener(name, callback) { this.handlers[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
}

const summary = (extra = {}) => ({ thumbs_up: 2, thumbs_down: 1, user_rating: null, csrf_token: 'server-token', ...extra });
const result = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
// Flush promise continuations without sleeping or relying on a fixed number of microtasks.
const settle = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function abortableResponse(options) {
  return new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

function createHttpHarness(responses = []) {
  const queue = [...responses];
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const environment = {
    AbortController, URLSearchParams,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (!queue.length) throw new Error('No queued response');
      const response = queue.shift();
      if (response instanceof Error) throw response;
      return typeof response === 'function' ? response(options) : response;
    },
  };
  function runTimeout(delay = 8000) {
    const timer = [...timers].find(([, value]) => value.delay === delay);
    assert.ok(timer, `Expected a ${delay}ms timer`);
    timers.delete(timer[0]);
    timer[1].callback();
  }
  return { environment, requests, timers, queue, runTimeout, settle };
}

function setup(initRatings, responses) {
  const http = createHttpHarness(responses);
  const ids = ['thumbs-up', 'thumbs-down', 'thumbs-up-count', 'thumbs-down-count', 'rating-status'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const window = new Element();
  initRatings({ ...http.environment, document: { getElementById: id => elements[id] }, window });
  return { ...http, elements,
    track: data => window.handlers['radiocalico:track']({ detail: { title: 'Song & title', artist: 'Artist', available: true, ...data } }),
    click: value => elements[value === 1 ? 'thumbs-up' : 'thumbs-down'].handlers.click(),
  };
}

module.exports = { summary, result, settle, deferred, abortableResponse, createHttpHarness, setup };
