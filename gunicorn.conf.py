"""Single-host SQLite deployment with concurrent request threads."""

bind = '0.0.0.0:3000'
workers = 1
worker_class = 'gthread'
threads = 4
timeout = 30
graceful_timeout = 30
worker_tmp_dir = '/tmp'
accesslog = '-'
errorlog = '-'
capture_output = True
# The immutable runtime has no writable home for Gunicorn's control socket.
control_socket_disable = True
