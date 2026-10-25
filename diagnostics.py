"""Playback diagnostic filtering shared by the HTTP endpoint and its tests."""

MAX_DIAGNOSTIC_BYTES = 8192
DIAGNOSTIC_EVENTS = frozenset({
    'engine-selected', 'manifest-parsed', 'waiting', 'stalled', 'hls-error', 'timeout',
})
DIAGNOSTIC_FIELDS = (
    'event', 'engine', 'state', 'currentTime', 'paused', 'seeking',
    'readyState', 'networkState', 'buffered', 'seekable', 'mediaError',
    'lastHlsError', 'fragmentsLoaded', 'fragmentsBuffered', 'lastFragment',
)


def filter_diagnostic(data):
    """Keep playback fields only; never accept listener or CSRF information."""
    if not isinstance(data, dict):
        raise ValueError('Invalid playback diagnostic.')
    event = data.get('event')
    if not isinstance(event, str) or event not in DIAGNOSTIC_EVENTS:
        raise ValueError('Invalid playback diagnostic.')
    return {key: data[key] for key in DIAGNOSTIC_FIELDS if key in data}
