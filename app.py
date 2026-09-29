"""
============================================================
AI FAKE NEWS DETECTOR — Flask Backend
============================================================
Features:
  - Serves the main UI (index.html)
  - Detects fake news via keyword heuristics
  - Stores every detection in SQLite (database/news.db)
  - Provides a JSON API for recent records
============================================================
"""

import os
import re
import sqlite3
from datetime import datetime

from flask import Flask, render_template, request, jsonify


# ------------------------------------------------------------
# APP CONFIG
# ------------------------------------------------------------
app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR   = os.path.join(BASE_DIR, 'database')
DB_PATH  = os.path.join(DB_DIR, 'news.db')


# ------------------------------------------------------------
# DATABASE HELPERS
# ------------------------------------------------------------
def get_connection():
    """Return a new SQLite connection with row access by name."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create the database folder + news table if they don't exist."""
    os.makedirs(DB_DIR, exist_ok=True)

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS news (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            headline   TEXT    NOT NULL,
            verdict    TEXT    NOT NULL,
            confidence INTEGER NOT NULL,
            created_at TEXT    NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def insert_news(headline: str, verdict: str, confidence: int) -> None:
    """Insert a new detection record."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO news (headline, verdict, confidence, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (headline, verdict, confidence, datetime.now().isoformat(timespec='seconds'))
    )
    conn.commit()
    conn.close()


def fetch_recent(limit: int = 10):
    """Return the most recent detections (newest first)."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT headline, verdict, confidence, created_at
        FROM news
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,)
    )
    rows = cur.fetchall()
    conn.close()
    return rows


# ------------------------------------------------------------
# FAKE-NEWS DETECTION LOGIC
# ------------------------------------------------------------
# Keywords that strongly suggest fake / sensational content
FAKE_KEYWORDS = [
    'alien', 'cheese', 'lizard', 'miracle', 'cure all',
    'reverses aging', 'predict the future', 'secretly',
    'illuminati', 'flat earth', 'magic pill', 'shocking truth',
    'conspiracy', 'hoax', 'time travel', 'immortal',
    'telepathy', 'free energy', 'fake moon', 'secret cure'
]

# Keywords that suggest credible / official content
REAL_KEYWORDS = [
    'research', 'study', 'announced', 'report', 'university',
    'scientists', 'fda', 'who', 'economy', 'data',
    'official', 'according to', 'published', 'peer-reviewed',
    'journal', 'evidence', 'clinical', 'statistics', 'government',
    'spokesperson', 'confirmed by'
]


def clean_text(text: str) -> str:
    """Normalise whitespace and lowercase for scoring."""
    return re.sub(r'\s+', ' ', text or '').strip().lower()


def analyze_news(text: str):
    """
    Return (verdict, confidence) based on keyword scoring.

    verdict ∈ {'FAKE', 'REAL', 'UNCERTAIN'}
    confidence ∈ [0, 100]
    """
    if not text or len(text.strip()) < 3:
        return 'UNCERTAIN', 0

    lower = clean_text(text)

    # ----- Base scoring -----
    fake_score = sum(2.0 for kw in FAKE_KEYWORDS if kw in lower)
    real_score = sum(1.5 for kw in REAL_KEYWORDS if kw in lower)

    # ----- Contextual adjustments -----
    # Very short + contains fake keywords → extra fake weight
    if len(text) < 30 and fake_score > 0:
        fake_score += 1

    # Long, detailed text → slight credibility boost
    if len(text) > 200:
        real_score += 0.5

    # Multiple exclamation marks (clickbait signal)
    if text.count('!') >= 3:
        fake_score += 0.8

    # ALL-CAPS words (shouting headlines)
    words = text.split()
    if words and sum(1 for w in words if w.isupper() and len(w) > 3) >= 2:
        fake_score += 0.6

    # ----- Hard-coded obvious cases -----
    if 'alien' in lower and 'landed' in lower:
        return 'FAKE', 99
    if 'moon' in lower and 'cheese' in lower:
        return 'FAKE', 99
    if 'lizard' in lower and 'politician' in lower:
        return 'FAKE', 97
    if 'stock market' in lower and 'all-time high' in lower:
        return 'REAL', 93
    if 'who' in lower and 'warns' in lower:
        return 'REAL', 88

    # ----- Decision boundaries -----
    diff = fake_score - real_score

    if diff > 0.8 or (fake_score > 2.5 and real_score < 1):
        confidence = int(min(98, max(70, 70 + fake_score * 6)))
        return 'FAKE', confidence

    if diff < -0.5 or (real_score > 2.5 and fake_score < 1.2):
        confidence = int(min(97, max(68, 68 + real_score * 6)))
        return 'REAL', confidence

    # Borderline — lean toward whichever score is higher
    if fake_score > real_score + 0.5:
        return 'FAKE', 60
    if real_score > fake_score + 0.2:
        return 'REAL', 62

    return 'UNCERTAIN', 50


# ------------------------------------------------------------
# ROUTES
# ------------------------------------------------------------
@app.route('/')
def index():
    """Render the main UI with the most recent detections."""
    recent = fetch_recent(10)
    return render_template('index.html', recent=recent)


@app.route('/detect', methods=['POST'])
def detect():
    """
    Accepts JSON { "text": "..." }.
    Runs detection, saves to DB, returns { verdict, confidence }.
    """
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    verdict, confidence = analyze_news(text)

    # Save (trim headline to 120 chars to keep the DB tidy)
    insert_news(text[:120], verdict, confidence)

    return jsonify({
        'verdict':    verdict,
        'confidence': confidence,
        'saved':      True
    })


@app.route('/api/recent')
def api_recent():
    """JSON API — returns the 10 most recent detections."""
    rows = fetch_recent(10)
    return jsonify([
        {
            'headline':   r['headline'],
            'verdict':    r['verdict'],
            'confidence': r['confidence'],
            'created_at': r['created_at'],
        }
        for r in rows
    ])


@app.route('/api/stats')
def api_stats():
    """JSON API — aggregate stats (total, fake count, real count)."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS total FROM news")
    total = cur.fetchone()['total']

    cur.execute("SELECT COUNT(*) AS c FROM news WHERE verdict = 'FAKE'")
    fake = cur.fetchone()['c']

    cur.execute("SELECT COUNT(*) AS c FROM news WHERE verdict = 'REAL'")
    real = cur.fetchone()['c']

    conn.close()

    return jsonify({
        'total':     total,
        'fake':      fake,
        'real':      real,
        'uncertain': total - fake - real,
    })


@app.errorhandler(404)
def not_found(e):
    """JSON 404 for API routes, otherwise default."""
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Not found'}), 404
    return render_template('index.html', recent=[]), 404


# ------------------------------------------------------------
# ENTRY POINT
# ------------------------------------------------------------
if __name__ == '__main__':
    init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)