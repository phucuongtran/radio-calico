/* Station metadata is independent of the audio connection and its controls. */
import { normalizeMetadata } from './metadata-data.js';

export function initMetadata(environment = globalThis) {
  const { document, window, navigator, fetch, AbortController, CustomEvent, MediaMetadata,
    console, setTimeout, clearTimeout } = environment;
  const METADATA_URL = 'https://d3d4yli4hf5bmh.cloudfront.net/metadatav2.json';
  const COVER_URL = 'https://d3d4yli4hf5bmh.cloudfront.net/cover.jpg';
  const FALLBACK_ART = '/static/images/radio-calico-logo.png';
  const REFRESH_MS = 10000;
  const title = document.getElementById('current-track-title');
  const artist = document.getElementById('current-track-artist');
  const cover = document.getElementById('current-album-art');
  const recentList = document.getElementById('recent-tracks');
  const empty = document.getElementById('recent-empty');
  const status = document.getElementById('metadata-status');
  let timer;
  let request = null;
  let generation = 0;
  let rendered = null;
  let artworkTrack = null;
  let artworkFailed = false;
  let artworkRevision = 0;

  cover.addEventListener('error', () => {
    if (!cover.src.startsWith(COVER_URL)) return;
    artworkFailed = true;
    cover.src = FALLBACK_ART;
    cover.alt = 'Album artwork unavailable';
  });

  function updateArtwork(current, album) {
    const key = JSON.stringify({ ...current, album });
    if (key === artworkTrack && !artworkFailed) return;
    artworkTrack = key;
    artworkFailed = false;
    // The station overwrites cover.jpg. Use a fresh URL for each new track,
    // but keep the same image during unchanged ten-second metadata polls.
    cover.alt = album ? `Cover of ${album} by ${current.artist}` : `Album cover for ${current.title} by ${current.artist}`;
    cover.src = `${COVER_URL}?t=${Date.now()}-${++artworkRevision}`;
  }

  function renderRecentTracks(recent) {
    const rows = recent.map(previous => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      const performer = document.createElement('span');
      name.className = 'recent-track-title';
      performer.className = 'recent-track-artist';
      // Treat all station-provided strings as text, never HTML.
      name.textContent = previous.title;
      performer.textContent = previous.artist;
      row.append(name, performer);
      return row;
    });
    recentList.replaceChildren(...rows);
    recentList.hidden = recent.length === 0;
    empty.hidden = recent.length > 0;
    empty.textContent = 'No recently played tracks available yet.';
  }

  function render(data) {
    const { current, album, recent } = normalizeMetadata(data);
    updateArtwork(current, album);
    const signature = JSON.stringify({ current, recent });
    if (signature !== rendered) {
      title.textContent = current.title;
      artist.textContent = current.artist;
      renderRecentTracks(recent);
      rendered = signature;
      if ('mediaSession' in navigator && 'MediaMetadata' in window) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: current.title,
          artist: current.artist,
          album: album || 'Radio Calico',
          artwork: [{ src: cover.src, type: 'image/jpeg' }],
        });
      }
    }
    status.hidden = true;
    window.dispatchEvent(new CustomEvent('radiocalico:track', { detail: { ...current, available: true } }));
  }

  async function refresh() {
    clearTimeout(timer);
    if (document.hidden || request) return;
    const thisGeneration = ++generation;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${METADATA_URL}?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Station metadata HTTP ${response.status}`);
      const data = await response.json();
      if (thisGeneration !== generation) return;
      render(data);
    } catch (error) {
      if (thisGeneration !== generation) return;
      if (rendered === null) {
        title.textContent = 'Track information unavailable';
        artist.textContent = 'Radio Calico';
        empty.textContent = 'Recent tracks are temporarily unavailable.';
      }
      status.textContent = rendered === null
        ? 'Waiting for track information. Retrying automatically…'
        : 'Showing the last received track information. Retrying automatically…';
      status.hidden = false;
      console.warn('[Radio Calico] Metadata unavailable', error.message);
      window.dispatchEvent(new CustomEvent('radiocalico:track', { detail: { available: false } }));
    } finally {
      clearTimeout(timeout);
      if (thisGeneration === generation) {
        request = null;
        if (!document.hidden) timer = setTimeout(refresh, REFRESH_MS);
      }
    }
  }

  function stop() {
    clearTimeout(timer);
    generation++;
    if (request) request.abort();
    request = null;
  }

  document.addEventListener('visibilitychange', () => document.hidden ? stop() : void refresh());
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => { void refresh(); });
  void refresh();
}
