/* Shared ratings are authoritative on the server, never in local storage. */
import { createRatingsApi } from './ratings-api.js';

export function initRatings(environment = globalThis) {
  const { document, window } = environment;
  const api = createRatingsApi(environment);
  const up = document.getElementById('thumbs-up');
  const down = document.getElementById('thumbs-down');
  const upCount = document.getElementById('thumbs-up-count');
  const downCount = document.getElementById('thumbs-down-count');
  const status = document.getElementById('rating-status');
  let current = null;
  let key = null;
  let version = 0;
  let available = false;
  let ready = false;
  let posting = false;
  let userRating = null;
  let csrf = null;
  let loading = null;

  function updateButtons() {
    up.disabled = down.disabled = !available || !ready || posting;
    up.setAttribute('aria-pressed', String(userRating === 1));
    down.setAttribute('aria-pressed', String(userRating === -1));
  }

  function applyTotals(data) {
    if (!Number.isSafeInteger(data.thumbs_up) || data.thumbs_up < 0 ||
        !Number.isSafeInteger(data.thumbs_down) || data.thumbs_down < 0 ||
        ![null, 1, -1].includes(data.user_rating) || typeof data.csrf_token !== 'string' || !data.csrf_token) {
      throw new Error('Invalid rating response');
    }
    upCount.textContent = String(data.thumbs_up);
    downCount.textContent = String(data.thumbs_down);
    up.setAttribute('aria-label', `Thumbs up: ${data.thumbs_up} votes`);
    down.setAttribute('aria-label', `Thumbs down: ${data.thumbs_down} votes`);
    userRating = data.user_rating;
    csrf = data.csrf_token;
    ready = true;
  }

  function cancelLoad() {
    if (loading) loading.abort();
    loading = null;
  }

  async function loadTotals() {
    if (!current || !available || posting || loading) return;
    const snapshot = version;
    const pending = api.read(current);
    loading = pending;
    try {
      const data = await pending.promise;
      if (snapshot !== version || loading !== pending) return;
      applyTotals(data);
      status.textContent = userRating === null ? 'Choose a thumb. Totals from all listeners.' : 'You can change your rating anytime.';
    } catch {
      if (snapshot !== version || loading !== pending) return;
      ready = false;
      status.textContent = 'Ratings are temporarily unavailable. Retrying automatically…';
    } finally {
      if (loading === pending) {
        loading = null;
        updateButtons();
      }
    }
  }

  async function submit(rating) {
    if (!available || !ready || posting || userRating === rating) return;
    cancelLoad();
    posting = true;
    updateButtons();
    status.textContent = 'Saving your rating…';
    const snapshot = version;
    const song = { ...current };
    let confirm = false;
    try {
      const data = await api.submit(song, rating, csrf).promise;
      if (snapshot !== version) return;
      applyTotals(data);
      if (available) status.textContent = 'Rating saved. You can change it anytime.';
    } catch {
      if (snapshot !== version) return;
      ready = false;
      confirm = true;
      if (available) status.textContent = 'Couldn’t confirm your vote. Checking the saved rating…';
    } finally {
      if (snapshot === version) {
        posting = false;
        updateButtons();
        // A lost response may still have committed. Read back before enabling
        // another attempt; repeated submissions still count as one vote.
        if (confirm) void loadTotals();
      }
    }
  }

  window.addEventListener('radiocalico:track', event => {
    const data = event.detail;
    if (!data?.available || typeof data.title !== 'string' || typeof data.artist !== 'string') {
      available = false;
      cancelLoad();
      updateButtons();
      status.textContent = 'Waiting for current song information before enabling ratings.';
      return;
    }
    const next = { title: data.title, artist: data.artist };
    const nextKey = JSON.stringify(next);
    if (nextKey !== key) {
      version++;
      cancelLoad();
      current = next;
      key = nextKey;
      ready = false;
      posting = false;
      userRating = null;
      csrf = null;
      upCount.textContent = downCount.textContent = '—';
      up.setAttribute('aria-label', 'Thumbs up');
      down.setAttribute('aria-label', 'Thumbs down');
      status.textContent = 'Loading ratings…';
    }
    available = true;
    updateButtons();
    void loadTotals();
  });

  up.addEventListener('click', () => submit(1));
  down.addEventListener('click', () => submit(-1));
  updateButtons();
}
