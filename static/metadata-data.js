function track(title, artist) {
  if (typeof title !== 'string' || typeof artist !== 'string') return null;
  const cleanTitle = title.trim();
  const cleanArtist = artist.trim();
  return cleanTitle && cleanArtist ? { title: cleanTitle, artist: cleanArtist } : null;
}

// Normalize the station feed independently of DOM rendering and polling.
export function normalizeMetadata(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid station metadata');
  const current = track(data.title, data.artist);
  if (!current) throw new Error('Current track is missing');
  const album = typeof data.album === 'string' ? data.album.trim() : '';
  const recent = [];
  // Preserve the feed's newest-first order and real repeat plays.
  for (let index = 1; index <= 5; index++) {
    const previous = track(data[`prev_title_${index}`], data[`prev_artist_${index}`]);
    if (previous) recent.push(previous);
  }
  return { current, album, recent };
}
