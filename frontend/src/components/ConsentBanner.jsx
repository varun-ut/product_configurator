import { useEffect, useState } from "react";
import { Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasDecidedConsent, setConsent, onConsentChange } from "@/lib/analytics";
import { PRIVACY_POLICY_URL, legalLinkProps } from "@/lib/legalLinks";

/**
 * ConsentBanner
 * -------------
 * GDPR-friendly opt-in for analytics (PRD Section 6).
 *
 *   • Renders only when the user hasn't decided yet (no localStorage flag).
 *   • Two buttons: "Accept all" → flips analytics opt-in (events flow to
 *                                 our /api/events endpoint);
 *                   "Decline"   → keeps analytics opt-out (no events sent).
 *   • Either choice persists in localStorage so the banner doesn't
 *     reappear on the next visit.
 *   • Sits at the bottom of the viewport, doesn't block interaction —
 *     a user can keep using the app with the banner present.
 *
 * The banner self-hides via the `onConsentChange` subscription so once
 * setConsent() is called from anywhere (e.g. a privacy settings page we
 * might add later), this component reacts.
 */
export default function ConsentBanner() {
  const [visible, setVisible] = useState(() => !hasDecidedConsent());

  useEffect(() => onConsentChange(() => setVisible(!hasDecidedConsent())), []);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,720px)]"
      data-testid="consent-banner"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-2xl p-5 md:p-6 flex flex-col md:flex-row items-start md:items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center">
            <Cookie className="h-4 w-4 text-accent" />
          </div>
          <div className="flex-1 text-sm text-[hsl(215,25%,27%)] leading-relaxed">
            <p className="font-medium">We use cookies for analytics.</p>
            {/* Wording supplied by legal. The previous copy said "anonymous
                usage", which stopped being accurate once a signed-in user's
                email started reaching Brevo for email personalisation. */}
            <p className="text-[hsl(215,16%,47%)] text-[13px] mt-0.5">
              We use cookies to improve the Configurator and, if you're signed in, to
              personalise our emails.{" "}
              <a
                href={PRIVACY_POLICY_URL}
                {...legalLinkProps}
                className="underline hover:text-[hsl(215,25%,27%)] transition-colors"
              >
                Privacy Policy
              </a>
            </p>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConsent(false)}
            className="flex-1 md:flex-none border-[hsl(var(--border))] text-[hsl(215,25%,27%)]"
            data-testid="consent-decline-btn"
          >
            Decline
          </Button>
          <Button
            size="sm"
            onClick={() => setConsent(true)}
            className="flex-1 md:flex-none bg-accent hover:bg-accent-hover text-white"
            data-testid="consent-accept-btn"
          >
            Accept all
          </Button>
        </div>
        {/* Tiny X to dismiss without choosing — treated same as Decline so
            we don't capture anything until the user explicitly opts in. */}
        <button
          type="button"
          onClick={() => setConsent(false)}
          className="absolute top-2 right-2 text-[hsl(215,16%,55%)] hover:text-[hsl(215,25%,27%)] transition-colors"
          aria-label="Close consent banner"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
