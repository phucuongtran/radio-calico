"""Render the static homepage at image build time without opening any database."""

from pathlib import Path
import sys

from flask import Flask, render_template


def render(destination):
    root = Path(__file__).resolve().parents[1]
    app = Flask('frontend', template_folder=str(root / 'templates'), static_folder=str(root / 'static'))
    with app.test_request_context('/'):
        page = render_template('index.html')
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(page, encoding='utf-8')


if __name__ == '__main__':
    render(sys.argv[1])
