import "@/App.css";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Configurator from "@/pages/Configurator";
// Product analytics — PostHog. Initialised once on app boot in opt-out
// mode; only starts capturing once the user accepts the consent banner.
import { initAnalytics, identify } from "@/lib/analytics";
import ConsentBanner from "@/components/ConsentBanner";
import { getUser } from "@/lib/auth";
// OTP-based auth (see backend/auth.py + src/lib/auth.js).  AuthGuard wraps
// every protected route; RedirectIfAuthed wraps /login so a logged-in user
// can't stare at the auth screen.
import AuthScreen from "@/pages/AuthScreen";
import AuthGuard, { RedirectIfAuthed } from "@/lib/AuthGuard";
// Standalone wall-visualizer trial — fully isolated from Configurator.
// To remove the feature, delete src/visualizer/ and the matching <Route>
// entry below.  See src/visualizer/README.md for setup + removal notes.
import VisualizerPage from "@/visualizer/VisualizerPage";
// Second standalone wall-visualizer (manual / no-AI variant).  Fully
// isolated from both Configurator and /visualizer.  See
// src/visualizer-draw/README.md for setup + removal notes.
import DrawVisualizerPage from "@/visualizer-draw/DrawVisualizerPage";

function App() {
  // Boot PostHog once (idempotent — multiple calls are safe). If the user
  // is already authenticated from a previous session (token in localStorage),
  // re-identify them so events from this session continue stitching to the
  // same user profile in PostHog.
  useEffect(() => {
    initAnalytics();
    const cached = getUser();
    if (cached?.id) {
      identify(cached.id, {
        email: cached.email,
        marketing_consent: cached.marketing_consent,
        signup_source: cached.signup_source,
        signup_campaign: cached.signup_campaign,
      });
    }
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="App">
        <BrowserRouter>
          <Routes>
            {/* /visualizer — standalone wall-visualizer trial.  No discovery
                from the main app (no link or button).  Reachable only by
                typing the URL.  Listed BEFORE the catch-all configurator
                routes so it isn't swallowed by `/:surfaceType`. */}
            <Route path="/visualizer" element={<AuthGuard><VisualizerPage /></AuthGuard>} />
            {/* /visualizer-draw — second standalone visualizer using a
                manual furniture-mask approach (no AI).  Same isolation
                pattern as /visualizer; remove by deleting
                src/visualizer-draw/ + this Route. */}
            <Route path="/visualizer-draw" element={<AuthGuard><DrawVisualizerPage /></AuthGuard>} />

            {/* /login — auth screen.  Wrapped in RedirectIfAuthed so a
                logged-in user lands back at "/" if they navigate here. */}
            <Route path="/login" element={<RedirectIfAuthed><AuthScreen /></RedirectIfAuthed>} />

            {/* URL shape: /:surfaceType/:productType
                Surface types: flat | embossed | grooving.  The Configurator
                validates the surface + series combination itself and
                redirects to /flat for anything that doesn't match —
                including bare series slugs (/ombre, /vicstrip), invalid
                surface names, and invalid (surface × series) combos.
                Every Configurator entry point is wrapped in <AuthGuard>
                so an unauthenticated user is bounced to /login. */}
            <Route path="/" element={<AuthGuard><Configurator /></AuthGuard>} />
            <Route path="/:surfaceType" element={<AuthGuard><Configurator /></AuthGuard>} />
            <Route path="/:surfaceType/:productType" element={<AuthGuard><Configurator /></AuthGuard>} />
          </Routes>
        </BrowserRouter>
        {/* No `richColors` — toast status is shown by the built-in icon, not
            by a coloured background (all toasts use a dark background; see
            components/ui/sonner.jsx). */}
        <Toaster position="top-center" />
        {/* Renders only on first visit (until the user accepts/declines).
            Sits above the routes so it's visible on /login too. */}
        <ConsentBanner />
      </div>
    </TooltipProvider>
  );
}

export default App;
