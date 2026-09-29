/* ============================================================
   AI FAKE NEWS DETECTOR — MAIN SCRIPT
   Handles: detection request, result rendering, DB updates,
            keyboard shortcuts, dark-mode toggle
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     DOM REFERENCES
     ---------------------------------------------------------- */
  const textarea     = document.getElementById('newsText');
  const detectBtn    = document.getElementById('detectBtn');
  const clearBtn     = document.getElementById('clearBtn');
  const verdictEl    = document.getElementById('verdictText');
  const confidenceEl = document.getElementById('confidenceText');
  const dbBody       = document.getElementById('dbBody');
  const resultBox    = document.getElementById('resultBox');
  const themeToggle  = document.getElementById('themeToggle'); // optional

  /* ----------------------------------------------------------
     CONSTANTS
     ---------------------------------------------------------- */
  const MAX_ROWS = 10;          // keep only last N rows in the table
  const ENDPOINT = '/detect';   // Flask endpoint

  /* ----------------------------------------------------------
     UTILITIES
     ---------------------------------------------------------- */

  /**
   * Escape HTML to prevent XSS when injecting user text.
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Shorten a headline to a maximum number of characters.
   */
  function truncate(text, max = 50) {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '…' : text;
  }

  /**
   * Return the appropriate tag class + label for a verdict.
   */
  function tagFor(verdict) {
    if (verdict === 'FAKE')  return { cls: 'tag-fake',      label: 'FAKE' };
    if (verdict === 'REAL')  return { cls: 'tag-real',      label: 'REAL' };
    return                          { cls: 'tag-uncertain', label: '?'    };
  }

  /* ----------------------------------------------------------
     UI UPDATERS
     ---------------------------------------------------------- */

  /**
   * Update the "Analysis" result box.
   */
  function setVerdictDisplay(verdict, confidence) {
    // Reset classes
    verdictEl.className = 'verdict';

    if (verdict === 'FAKE') {
      verdictEl.textContent = 'FAKE';
      verdictEl.classList.add('fake');
      resultBox.style.borderColor = '#d0314e';
      resultBox.style.borderStyle = 'solid';
    } else if (verdict === 'REAL') {
      verdictEl.textContent = 'REAL';
      verdictEl.classList.add('real');
      resultBox.style.borderColor = '#1f8b4c';
      resultBox.style.borderStyle = 'solid';
    } else if (verdict === 'UNCERTAIN') {
      verdictEl.textContent = 'UNCERTAIN';
      verdictEl.classList.add('uncertain');
      resultBox.style.borderColor = '#6f7b9c';
      resultBox.style.borderStyle = 'solid';
    } else {
      verdictEl.textContent = '—';
      resultBox.style.borderColor = 'rgba(67, 97, 238, 0.45)';
      resultBox.style.borderStyle = 'dashed';
    }

    confidenceEl.innerHTML = `confidence <span>${confidence}%</span>`;
  }

  /**
   * Prepend a new row to the news.db table (live update).
   */
  function prependRow(headline, verdict, confidence) {
    const tag = tagFor(verdict);
    const safeHeadline = escapeHtml(truncate(headline, 50));

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${safeHeadline}</td>
      <td><span class="tag ${tag.cls}">${tag.label}</span></td>
      <td>${confidence}%</td>
    `;

    // Insert as first child
    dbBody.insertBefore(row, dbBody.firstChild);

    // Trim rows if exceeding MAX_ROWS
    while (dbBody.children.length > MAX_ROWS) {
      dbBody.removeChild(dbBody.lastChild);
    }

    // Add a subtle fade-in animation
    row.style.opacity = '0';
    row.style.transition = 'opacity 0.4s ease';
    requestAnimationFrame(() => {
      row.style.opacity = '1';
    });
  }

  /* ----------------------------------------------------------
     MAIN ACTIONS
     ---------------------------------------------------------- */

  /**
   * Send the textarea content to the Flask backend and render the result.
   */
  async function runDetection() {
    const text = (textarea.value || '').trim();

    // Empty input guard
    if (!text) {
      setVerdictDisplay('—', 0);
      confidenceEl.textContent = 'awaiting input';
      resultBox.style.borderColor = 'rgba(67, 97, 238, 0.45)';
      resultBox.style.borderStyle = 'dashed';
      textarea.focus();
      return;
    }

    // Loading state
    detectBtn.disabled = true;
    const originalBtnHTML = detectBtn.innerHTML;
    detectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing…';
    verdictEl.textContent = '…';
    verdictEl.className = 'verdict';
    confidenceEl.textContent = 'processing';

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const data = await response.json();

      // Update result panel
      setVerdictDisplay(data.verdict, data.confidence);

      // Update DB table (live)
      prependRow(text, data.verdict, data.confidence);

    } catch (err) {
      console.error('[Detector] Error:', err);
      verdictEl.textContent = 'ERROR';
      verdictEl.className = 'verdict';
      confidenceEl.textContent = 'could not reach server';
      resultBox.style.borderColor = '#d0314e';
      resultBox.style.borderStyle = 'solid';
    } finally {
      // Restore button
      detectBtn.disabled = false;
      detectBtn.innerHTML = originalBtnHTML;
    }
  }

  /**
   * Reset the form + result panel.
   */
  function resetForm() {
    textarea.value = '';
    verdictEl.textContent = '—';
    verdictEl.className = 'verdict';
    confidenceEl.textContent = 'awaiting input';
    resultBox.style.borderColor = 'rgba(67, 97, 238, 0.45)';
    resultBox.style.borderStyle = 'dashed';
    textarea.focus();
  }

  /* ----------------------------------------------------------
     DARK MODE (OPTIONAL)
     ---------------------------------------------------------- */

  function initThemeToggle() {
    if (!themeToggle) return;

    // Restore saved preference
    if (localStorage.getItem('theme') === 'dark') {
      document.body.classList.add('dark-mode');
      const icon = themeToggle.querySelector('i');
      if (icon) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
      }
    }

    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');

      const icon = themeToggle.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-moon', !isDark);
        icon.classList.toggle('fa-sun',  isDark);
      }
    });
  }

  /* ----------------------------------------------------------
     EVENT BINDINGS
     ---------------------------------------------------------- */

  // Main actions
  if (detectBtn) detectBtn.addEventListener('click', runDetection);
  if (clearBtn)  clearBtn.addEventListener('click', resetForm);

  // Ctrl/Cmd + Enter inside textarea → detect
  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runDetection();
      }
    });
  }

  // Esc inside textarea → clear
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement === textarea) {
      resetForm();
    }
  });

  /* ----------------------------------------------------------
     INITIALISATION
     ---------------------------------------------------------- */

  // Theme toggle (only if the button exists in HTML)
  initThemeToggle();

  // Auto-focus the textarea on load for a smoother UX
  if (textarea) {
    window.addEventListener('load', () => textarea.focus());
  }

})();