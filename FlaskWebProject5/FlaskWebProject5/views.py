"""
Routes and views for the flask application.
"""

from datetime import datetime
from pathlib import Path

from flask import render_template, send_from_directory, url_for
from FlaskWebProject5 import app


MEME_DIRECTORY = Path(app.root_path) / 'meme'
SUPPORTED_MEME_EXTENSIONS = {'.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm'}


def get_meme_filenames():
    """Returns the list of meme audio/video files available for humor mode."""
    if not MEME_DIRECTORY.exists():
        return []

    return sorted(
        file_path.name
        for file_path in MEME_DIRECTORY.iterdir()
        if file_path.is_file() and file_path.suffix.lower() in SUPPORTED_MEME_EXTENSIONS
    )

@app.route('/')
@app.route('/home')
def home():
    """Renders the home page."""
    meme_filenames = get_meme_filenames()

    return render_template(
        'index.html',
        title='Cellular Automata Lab',
        year=datetime.now().year,
        meme_sound_urls=[url_for('serve_meme_file', filename=filename) for filename in meme_filenames],
    )


@app.route('/blog')
def blog():
    """Renders the lab blog post."""
    return render_template(
        'blog.html',
        title='Lab Blog',
        year=datetime.now().year,
    )


@app.route('/meme/<path:filename>')
def serve_meme_file(filename):
    """Serves meme audio assets for humor mode."""
    return send_from_directory(MEME_DIRECTORY, filename)

@app.route('/contact')
def contact():
    """Renders the contact page."""
    return render_template(
        'contact.html',
        title='Contact',
        year=datetime.now().year,
        message='Your contact page.'
    )

@app.route('/about')
def about():
    """Renders the about page."""
    return render_template(
        'about.html',
        title='About',
        year=datetime.now().year,
        message='Your application description page.'
    )
