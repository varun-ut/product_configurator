Subject: Configurator walkthrough — deployment request (one script, ~10 min)

Hi [Developer name],

Can we add a first-time-user walkthrough to configurator.univicoustic.com? The goal is a guided 24-step tour that auto-launches on a visitor's first session and points at each control — same pattern as Figma, Notion, Canva.

Everything is written and tested. You just need to host one file and add one line.


WHAT TO ADD
-----------

Attach the file univicoustic-tour.js (included with this email) to your static assets bundle and load it once on every configurator page, just before the closing </body> tag:

    <script src="/assets/univicoustic-tour.js" defer></script>

(Use whichever asset path matches your build setup — /public, /static, /assets, whatever you normally use.)

That's it. The script is self-contained: it injects Shepherd.js + its CSS from jsDelivr (no npm install needed), detects first-time visitors via localStorage, auto-launches the tour, and exposes window.startUnivicousticTour() for a help-menu relaunch button later.


TESTING (takes about 2 minutes)
-------------------------------

1. Open the configurator in an Incognito window. Tour should auto-launch within ~1 second.
2. Click Next through all 24 steps. Confirm each tooltip anchors to the right element.
3. Close the window, open a fresh Incognito tab. Tour should auto-launch again.
4. Open a normal (non-Incognito) tab. Tour should NOT re-launch — first run is persisted in localStorage.
5. Run window.startUnivicousticTour() in DevTools console. Tour should re-launch on demand.


THREE CONDITIONAL SKIPS
-----------------------

Three steps should be skipped under certain live conditions. The script handles these gracefully if the anchor is missing, but hard skips would be cleaner. If you have 10 extra minutes:

- Step 5 (T-Profile Overlay) — only shown on Flat and Embossed. Skip when product type is Grooving.
- Step 11 (Fill-in banner) — skip if all required selections are already complete when the step fires.
- Step 14 (Angle dial) — skip when Studio Lighting is Off (dial is hidden in that state).

The full spec with target elements, tooltip copy, positions, and these conditional rules is in the attached Word doc (UniVicoustic-Walkthrough-Spec.docx). Happy to walk you through it if useful.


ENTRY POINT FOR RELAUNCH
------------------------

Once returning users have finished the tour, we need a way for them to replay it. Suggestion: a small "?" or "How it works" link in the top bar, or inside the chat bubble menu. Wire it to call:

    window.startUnivicousticTour()

Whichever placement you prefer — just let me know what you build.


SELECTOR STRATEGY
-----------------

Tooltips anchor via text content (section labels like PRODUCT TYPE, SERIES, SIZE, and button text like Save, Download, Compare, View Tech Specs). This avoids coupling to Tailwind utility classes.

If you'd rather use stable data-tour attributes, I can swap the selectors — just add data-tour="product-type", data-tour="series", etc. to the relevant elements and let me know; I'll push an updated script within the day.


ANALYTICS HOOKS (optional)
--------------------------

Shepherd fires show, complete, and cancel events per step. If you want to track completion / drop-off, add this after the script loads:

    tour.on("show",     (e) => analytics.track("tour_step_shown", { step: e.step.id }));
    tour.on("complete", () => analytics.track("tour_completed"));
    tour.on("cancel",   () => analytics.track("tour_cancelled"));

Skip if analytics isn't needed for v1.


WHAT I NEED BACK
----------------

- A staging URL where I can preview before going to production.
- Confirmation that the tour launches in Incognito, pauses on completion, and relaunches via the help entry point.

Ballpark 10–15 minutes for the deploy, plus another 15 if you do the conditional skips and analytics hooks. Let me know if anything is unclear or if you'd rather approach it differently.

Thanks,
Sukanya


---

ATTACHMENTS
- univicoustic-tour.js (drop-in script)
- UniVicoustic-Walkthrough-Spec.docx (24-step spec with copy, targets, and conditional rules)
- univicoustic-tour-demo.html (optional — local preview with a simplified configurator mockup)
- preview-on-real-site.html (optional — bookmarklet to preview the tour on the live site without deploying)
