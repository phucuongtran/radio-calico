// Count media progress, excluding pauses and seeks, across live connections.
export function createListeningTime(audio, element, isListening) {
  let listeningSeconds = 0;
  let position = null;

  function update() {
    const current = audio.currentTime;
    if (!isListening() || audio.paused || audio.seeking || !Number.isFinite(current)) return;
    if (position !== null && current > position) listeningSeconds += current - position;
    position = current;
    const seconds = Math.floor(listeningSeconds);
    const minutes = Math.floor(seconds / 60);
    element.textContent = minutes < 60
      ? `${minutes}:${String(seconds % 60).padStart(2, '0')}`
      : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    element.setAttribute('datetime', `PT${seconds}S`);
  }

  return {
    update,
    resetPosition() { position = null; },
    syncPosition() { position = audio.currentTime; },
  };
}
