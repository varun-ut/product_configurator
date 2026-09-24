/**
 * UniVicoustic Configurator — First-Time User Walkthrough
 * ---------------------------------------------------------------
 * Drop-in script. Paste once, attach before </body>. It will:
 *   1. Auto-load Shepherd.js (tour engine) + its CSS from CDN.
 *   2. Detect first-time visitors via localStorage.
 *   3. Wait until the DOM is ready, then launch the 24-step tour.
 *   4. Expose window.startUnivicousticTour() so you can re-run it
 *      from a "How it works" help link.
 *
 * Selectors use the TEXT content of section headers (e.g. "PRODUCT TYPE",
 * "SERIES") and accessible button labels — stable across Tailwind class
 * churn. If your dev team later adds data-tour="..." attributes, swap
 * them in for even stronger anchors.
 *
 * Library: Shepherd.js 12.x (MIT licensed). Works on desktop + tablet.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'uv_tour_seen_v1';
  var SHEPHERD_CSS = 'https://cdn.jsdelivr.net/npm/shepherd.js@12.0.0/dist/css/shepherd.css';
  var SHEPHERD_JS  = 'https://cdn.jsdelivr.net/npm/shepherd.js@12.0.0/dist/js/shepherd.min.js';

  /* ---------- loader helpers ---------- */
  function loadCss(href) {
    return new Promise(function (resolve) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = resolve;
      document.head.appendChild(l);
    });
  }
  function loadJs(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  /* ---------- selector helpers (text-based, robust) ---------- */
  // Return the container for a given sidebar section (e.g. "SIZE").
  function sectionBlockByLabel(label) {
    var labels = document.querySelectorAll('label.section-header, label');
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].textContent || '').trim().toUpperCase() === label.toUpperCase()) {
        // Return the nearest wrapping div that contains the control below.
        return labels[i].parentElement;
      }
    }
    return null;
  }
  function buttonByText(txt) {
    var b = document.querySelectorAll('button');
    for (var i = 0; i < b.length; i++) {
      if ((b[i].innerText || '').trim() === txt) return b[i];
    }
    return null;
  }
  // Find element by descendant text (e.g. the toggle row "T-Profile Overlay").
  function rowByText(txt) {
    var all = document.querySelectorAll('div, label');
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].innerText || '').trim();
      if (t === txt && all[i].children.length < 3) return all[i].parentElement;
    }
    return null;
  }

  /* ---------- theme override ---------- */
  var STYLE = `
    .shepherd-theme-uv .shepherd-content { border-radius: 12px; font-family: inherit; }
    .shepherd-theme-uv .shepherd-header { background: #fff; padding: 16px 18px 4px; border-radius: 12px 12px 0 0; }
    .shepherd-theme-uv .shepherd-title { color: #0f0f0f; font-weight: 600; font-size: 15px; }
    .shepherd-theme-uv .shepherd-text { color: #444; font-size: 14px; line-height: 1.5; padding: 6px 18px 16px; }
    .shepherd-theme-uv .shepherd-footer { padding: 0 18px 16px; }
    .shepherd-theme-uv .shepherd-button {
      background: #B27B4B; color: #fff; border-radius: 8px;
      padding: 8px 14px; font-size: 13px; font-weight: 500;
    }
    .shepherd-theme-uv .shepherd-button:hover { background: #9a683d; }
    .shepherd-theme-uv .shepherd-button.shepherd-button-secondary {
      background: #f3f3f3; color: #444;
    }
    .shepherd-theme-uv .shepherd-button.shepherd-button-secondary:hover { background: #e6e6e6; }
    .shepherd-theme-uv .shepherd-cancel-icon { color: #999; font-size: 18px; }
    .shepherd-modal-overlay-container { fill: rgba(15,15,15,0.55); }
    .uv-tour-progress {
      font-size: 11px; color: #888; letter-spacing: .5px;
      text-transform: uppercase; margin-right: auto; padding-top: 8px;
    }
  `;
  function injectStyle() {
    var s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  /* ---------- step definitions ---------- */
  function buildSteps(tour) {
    var totalSteps = 24;
    var mkProgress = function (n) {
      return '<span class="uv-tour-progress">Step ' + n + ' of ' + totalSteps + '</span>';
    };
    var nextBtn = { text: 'Next', action: function () { tour.next(); } };
    var backBtn = { text: 'Back', classes: 'shepherd-button-secondary', action: function () { tour.back(); } };
    var skipBtn = { text: 'Skip tour', classes: 'shepherd-button-secondary', action: function () { tour.cancel(); } };
    var doneBtn = { text: 'Got it', action: function () { tour.complete(); } };

    var steps = [
      {
        id: 'welcome',
        title: 'Welcome to the UniVicoustic Configurator',
        text: 'Design acoustic panels the way you would in a showroom — pick a product, dial in a finish, and see it in a real room. This quick tour (2 minutes) shows you every control.',
        buttons: [skipBtn, { text: 'Start tour', action: function () { tour.next(); } }]
      },
      {
        id: 'product-type',
        title: '1. Pick a product type',
        text: 'Three panel families to start with. <b>Flat</b> — smooth print surface. <b>Embossed</b> — raised texture. <b>Grooving</b> — slatted/fluted strip. Your sidebar changes based on what you pick here.',
        attachTo: { element: function () { return sectionBlockByLabel('PRODUCT TYPE'); }, on: 'right' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'series',
        title: '2. Choose a Series',
        text: 'The Series is the design family — <i>Wood, Fabrics, Bespoke Graphics, Ombre,</i> or <i>Univic Strip</i>. Each series unlocks its own category or pattern list below.',
        attachTo: { element: function () { return sectionBlockByLabel('SERIES'); }, on: 'right' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'category',
        title: '3. Category or Pattern',
        text: 'After Series, pick a <b>Category</b> (e.g. Wood Classics, Classic Parquet) — or a <b>Pattern</b> on Grooving (Single Groove, Double Groove). This narrows the design catalog.',
        attachTo: { element: function () { return sectionBlockByLabel('CATEGORY') || sectionBlockByLabel('PATTERN'); }, on: 'right' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 't-profile',
        title: '4. T-Profile Overlay',
        text: 'Toggles the T-profile trim between panels on or off in the preview. Shows how seams will actually look once installed on a wall.',
        attachTo: { element: function () { return rowByText('T-Profile Overlay'); }, on: 'right' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'size',
        title: '5. Size',
        text: 'Sheet dimensions in millimetres. Sizes that are available for the selected series appear here. Changing size updates the preview tiling.',
        attachTo: { element: function () { return sectionBlockByLabel('SIZE'); }, on: 'right' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'thickness',
        title: '6. Thickness & Acoustic Rating',
        text: 'Each option lists its substrate (PET Panel / PET Wool). Hover an option to see the <b>NRC</b> acoustic rating — e.g. <i>"0.45 NRC can be increased to 0.9"</i>. Thicker panel = more absorption.',
        attachTo: { element: function () { return sectionBlockByLabel('THICKNESS'); }, on: 'right' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'print-gallery',
        title: '7. Print / Designs gallery',
        text: 'Thumbnail grid of every finish in the current category. Click a swatch to apply it — the 3D room preview re-renders instantly. Scroll to see the full range.',
        attachTo: { element: function () { return sectionBlockByLabel('PRINT') || sectionBlockByLabel('DESIGNS'); }, on: 'right' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'preview',
        title: '8. Live room preview',
        text: 'Your panel rendered in a real-world scene (office, lounge, or studio). This updates every time you change a selection on the left.',
        attachTo: { element: function () {
          return document.querySelector('main') ||
                 document.querySelector('[class*="preview"]') ||
                 document.querySelectorAll('div')[0];
        }, on: 'left' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'config-tags',
        title: '9. Configuration summary',
        text: 'These chips at the bottom-left of the preview mirror your live selection: T-Profile, Thickness, Size, Design, Category, Series. A quick read-out of your spec.',
        attachTo: { element: function () {
          // Chip strip lives over the preview footer area.
          var el = document.querySelector('main') || document.body;
          return el;
        }, on: 'top' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'hint-banner',
        title: '10. "Fill in all selections" prompt',
        text: 'A dark banner appears across the preview until you\'ve chosen every required field. Once it disappears, your configuration is complete and ready to save or download.',
        attachTo: { element: function () {
          // Try to find the banner text, fall back to main preview area.
          var spans = document.querySelectorAll('div, span, p');
          for (var i = 0; i < spans.length; i++) {
            if ((spans[i].textContent || '').indexOf('fill in all selections') !== -1) return spans[i].parentElement;
          }
          return document.querySelector('main') || document.body;
        }, on: 'top' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'zoom',
        title: '11. Zoom controls',
        text: 'Zoom in (+) to inspect texture detail, zoom out (−) to see the panel at room scale. Current zoom level is shown as a percentage.',
        attachTo: { element: function () {
          var svgs = document.querySelectorAll('[class*="zoom"], button[aria-label*="zoom" i]');
          if (svgs.length) return svgs[0].parentElement;
          // Fallback: top-right corner of preview
          return document.querySelector('main') || document.body;
        }, on: 'left' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'studio-lighting',
        title: '12. Studio Lighting',
        text: 'Three presets: <b>Off</b> (neutral), <b>Warm</b> (incandescent feel), <b>Soft</b> (cool daylight). Each tells a different story about how the panel reads in a space.',
        attachTo: { element: function () {
          var labels = document.querySelectorAll('label, p, span, div');
          for (var i = 0; i < labels.length; i++) {
            if ((labels[i].textContent || '').trim() === 'STUDIO LIGHTING') return labels[i].parentElement;
          }
          return null;
        }, on: 'left' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'angle',
        title: '13. Angle dial',
        text: 'Drag the dot around the dial to rotate the key light. The degree readout updates live. Appears when Warm or Soft lighting is active.',
        attachTo: { element: function () {
          var labels = document.querySelectorAll('label, p, span, div');
          for (var i = 0; i < labels.length; i++) {
            if ((labels[i].textContent || '').trim() === 'ANGLE') return labels[i].parentElement;
          }
          return null;
        }, on: 'left' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'save',
        title: '14. Save this configuration',
        text: 'Stores your current spec in your browser so you can come back to it. A green "Configuration saved!" toast confirms. No sign-in needed.',
        attachTo: { element: function () { return buttonByText('Save'); }, on: 'bottom' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'saved-list',
        title: '15. Saved configurations',
        text: 'Opens a modal with every saved spec (with a colour swatch and date). Click one to reload it; click the trash icon to delete. The badge shows how many you have.',
        attachTo: { element: function () { return buttonByText('Saved'); }, on: 'top' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'download',
        title: '16. Download',
        text: 'The primary action. Generates a PDF / image of your current configuration — ready to share with clients, architects, or your installer.',
        attachTo: { element: function () { return buttonByText('Download'); }, on: 'bottom' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'compare',
        title: '17. Compare two configurations',
        text: 'Puts your current design in <b>Slot A</b> and lets you load another saved spec into <b>Slot B</b>. Hit Apply to view both side by side — perfect for client presentations.',
        attachTo: { element: function () { return buttonByText('Compare') || buttonByText('Close Compare'); }, on: 'bottom' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'tech-specs',
        title: '18. View Tech Specs',
        text: 'Opens the official spec sheet PDF for your selected product — dimensions, tolerances, fire rating, NRC curves, installation guidance. Opens in a new tab.',
        attachTo: { element: function () { return buttonByText('View Tech Specs'); }, on: 'bottom' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'reset',
        title: '19. Reset',
        text: 'Clears every selection and returns to a blank configurator. Handy when you want to start fresh without reloading the page.',
        attachTo: { element: function () { return buttonByText('Reset'); }, on: 'top' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'disclaimer',
        title: '20. About the preview',
        text: 'The 3D render is <i>indicative</i>. Real colour, sheen, and grain vary with lighting and installation. For specification-grade samples, order a physical swatch.',
        attachTo: { element: function () {
          var all = document.querySelectorAll('p, div, span');
          for (var i = 0; i < all.length; i++) {
            if ((all[i].innerText || '').indexOf('indicative visualization') !== -1) return all[i];
          }
          return null;
        }, on: 'top' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'help-chat',
        title: '21. Need a human?',
        text: 'The chat bubble (bottom-right) connects you to our specifier team. Ask about lead times, custom prints, bulk pricing, or installation questions.',
        attachTo: { element: function () {
          var btns = document.querySelectorAll('button, a, div[role="button"]');
          for (var i = 0; i < btns.length; i++) {
            var r = btns[i].getBoundingClientRect();
            if (r.right > window.innerWidth - 100 && r.bottom > window.innerHeight - 100 && r.width < 80 && r.width > 30) {
              return btns[i];
            }
          }
          return null;
        }, on: 'left' },
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'workflow-tip',
        title: '22. The quickest workflow',
        text: 'Left column top to bottom: Product → Series → Category → Size → Thickness → Print. Then Save, Download, or Compare. You can switch any selection at any time — the preview always catches up.',
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'compare-tip',
        title: '23. Pro tip — saved + Compare',
        text: 'Configure option A → <b>Save</b>. Configure option B → <b>Save</b>. Now open <b>Compare</b>, drop A into one slot and B into the other, hit Apply, and screenshot the split view for your moodboard.',
        buttons: [backBtn, nextBtn]
      },
      {
        id: 'done',
        title: "24. You're ready to design",
        text: 'You can relaunch this tour anytime from the help menu. If anything is unclear, the chat bubble in the corner is staffed by humans who know the products inside out.',
        buttons: [{ text: 'Start exploring', action: function () { tour.complete(); } }]
      }
    ];

    // Attach per-step progress counters.
    steps.forEach(function (s, idx) {
      var existingTitle = s.title;
      s.title = existingTitle + '<div class="uv-tour-progress" style="display:block;font-size:10px;color:#B27B4B;font-weight:400;margin-top:2px;">Step ' + (idx + 1) + ' of ' + totalSteps + '</div>';
    });
    return steps;
  }

  /* ---------- launcher ---------- */
  function startTour() {
    if (!window.Shepherd) {
      console.warn('[UV-tour] Shepherd not loaded yet.');
      return;
    }
    var tour = new Shepherd.Tour({
      useModalOverlay: true,
      defaultStepOptions: {
        classes: 'shepherd-theme-uv',
        scrollTo: { behavior: 'smooth', block: 'center' },
        cancelIcon: { enabled: true },
        arrow: true,
        modalOverlayOpeningPadding: 6,
        modalOverlayOpeningRadius: 8
      }
    });
    var steps = buildSteps(tour);
    steps.forEach(function (s) { tour.addStep(s); });
    tour.on('complete', function () { try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {} });
    tour.on('cancel',   function () { try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {} });
    tour.start();
    return tour;
  }

  /* ---------- boot ---------- */
  function boot() {
    Promise.all([loadCss(SHEPHERD_CSS), loadJs(SHEPHERD_JS)]).then(function () {
      injectStyle();
      window.startUnivicousticTour = startTour;

      var seen = false;
      try { seen = !!localStorage.getItem(STORAGE_KEY); } catch (e) {}
      if (!seen) {
        // Delay slightly so the SPA has mounted.
        setTimeout(startTour, 1200);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
