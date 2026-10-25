const REQUEST_TIMEOUT_MS = 8000;

export function createRatingsApi({ fetch, AbortController, setTimeout, clearTimeout }) {
  function request(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const promise = (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin', ...options, signal: controller.signal });
        if (!response.ok) throw new Error(`Ratings HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    })();
    return { promise, abort: () => controller.abort() };
  }

  return {
    read(song) {
      return request(`/api/ratings?${new URLSearchParams(song)}`, { cache: 'no-store' });
    },
    submit(song, rating, csrf) {
      return request('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ ...song, rating }),
      });
    },
  };
}
