const HLS_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.19/dist/hls.min.js';

export function createHlsLoader({ document, window, setTimeout, clearTimeout }) {
  let libraryPromise = null;

  return function loadHlsLibrary() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => finish(new Error('Player library timed out')), 12000);
      function finish(error) {
        clearTimeout(timeout);
        script.onload = script.onerror = null;
        if (error) {
          script.remove();
          libraryPromise = null;
          reject(error);
        } else {
          resolve(window.Hls);
        }
      }
      script.src = HLS_LIBRARY_URL;
      script.async = true;
      script.onload = () => finish(window.Hls ? null : new Error('Player library unavailable'));
      script.onerror = () => finish(new Error('Player library unavailable'));
      document.head.append(script);
    });
    return libraryPromise;
  };
}
