import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestRegisterOtp, verifyRegisterOtp, login as loginCall } from "@/lib/auth";
import { PRIVACY_POLICY_URL, TERMS_URL, legalLinkProps } from "@/lib/legalLinks";

// Hero image — can be a public/* path or any URL. Replace anytime.
const HERO_IMAGE = "/auth-hero.png";

const OTP_LENGTH = 6;

// Optional professional role, captured on the sign-up form only. Analytics-only:
// it never gates anything and is never required. Values are stable slugs.
const PROFILE_OPTIONS = [
  { value: "architect",           label: "Architect" },
  { value: "interior_designer",   label: "Interior Designer" },
  { value: "pmc",                 label: "Project Management Consultant" },
  { value: "acoustic_consultant", label: "Acoustic Consultant" },
  { value: "other",               label: "Other" },
];

/**
 * AuthScreen
 * ----------
 * Three-screen flow on a single route (/login):
 *
 *   • mode "login"     — single email field. Submits to /api/auth/login
 *                        which returns a JWT (no OTP). Email-only login is
 *                        intentional per product decision; see backend/auth.py.
 *
 *   • mode "register"  — email field. On submit, requests an OTP via
 *                        /api/auth/register/request-otp and transitions
 *                        to "otp" mode.
 *
 *   • mode "otp"       — six single-character boxes for the verification
 *                        code. Auto-advance forward on type, backward on
 *                        Backspace; full-paste of a 6-digit code into any
 *                        box distributes across all six. Submits to
 *                        /api/auth/register/verify-otp; on success stores
 *                        the JWT + redirects to /.
 *
 * Layout: split screen. ~45% form, ~55% hero image. Mobile = form only.
 */
export default function AuthScreen() {
  const [mode, setMode] = useState("login"); // 'login' | 'register' | 'otp'
  const [email, setEmail] = useState("");
  // Optional profile chosen on the sign-up form; kept here so it survives the
  // register → OTP step. Applied to analytics once the account is created.
  const [profile, setProfile] = useState("");
  // Marketing opt-in from the sign-up form. Sent as its OWN field, not
  // nested inside `profile` — `profile` is a role slug string ("architect"),
  // so a boolean cannot live under it.
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [otp, setOtp] = useState(Array(OTP_LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  // Resend cooldown — counts down from the value the backend gave us so the
  // UI matches whatever rate-limit policy the server enforces.
  const [resendIn, setResendIn] = useState(0);
  // Dev convenience: when SMTP is unconfigured, the backend includes the OTP
  // in the response. Surface it on the page so the dev can copy it without
  // tabbing to the backend log. Stripped automatically once SMTP is wired.
  const [devOtp, setDevOtp] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  // If the user was bounced here by AuthGuard, location.state.from holds
  // the path they originally tried to reach. Send them back there after
  // a successful login/register; otherwise default to "/".
  const redirectTarget = location.state?.from || "/";

  // Auto-launch the first-time-user walkthrough after the redirect so the
  // user actually sees it on their first run-through. Same storage flag the
  // tour script itself uses (public/univicoustic-tour.js → uv_tour_seen_v1)
  // so existing users who already ran the tour aren't shown it again.
  // The 1500ms delay gives Configurator time to mount + fetch products so
  // the tour's text-based selectors find their anchors.
  const TOUR_SEEN_KEY = "uv_tour_seen_v1";
  const maybeStartTour = () => {
    // Skip the tour when the post-login redirect is a deep-link (dl=1) — the
    // tour's demo-fill would overwrite the specific combo the link encodes.
    // (The tour script's own auto-launch is guarded the same way.)
    if (/[?&]dl=1(&|$)/.test(redirectTarget)) return;
    let seen = false;
    try { seen = !!localStorage.getItem(TOUR_SEEN_KEY); } catch (_) { return; }
    if (seen) return;
    setTimeout(() => {
      if (typeof window.startUnivicousticTour === "function") {
        window.startUnivicousticTour();
      }
    }, 1500);
  };

  // ── Resend countdown ticker ──────────────────────────────────────────────
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const resetOtpState = () => {
    setOtp(Array(OTP_LENGTH).fill(""));
    setDevOtp(null);
  };

  const goToMode = (next) => {
    setMode(next);
    resetOtpState();
  };

  // ── Submit handlers ──────────────────────────────────────────────────────

  // mode === 'login'  →  email only, immediate JWT
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await loginCall(email);
      toast.success("Welcome back!");
      maybeStartTour();
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // mode === 'register'  →  request OTP, transition to 'otp'
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const data = await requestRegisterOtp(email, profile || null, marketingConsent);
      // TEMPORARY OTP bypass: backend (OTP_ENABLED=0) already created the user
      // and issued a token — skip the code-entry screen and go straight in.
      if (data.otp_bypassed || data.token) {
        toast.success("Account created — welcome!");
        maybeStartTour();
        navigate(redirectTarget, { replace: true });
        return;
      }
      setResendIn(data.resend_cooldown_seconds ?? 30);
      if (data._dev_otp) setDevOtp(data._dev_otp);
      goToMode("otp");
      toast.success(
        data.delivered_via === "smtp"
          ? "Code sent — check your email."
          : "Code generated — check the page or backend console."
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // mode === 'otp'  →  verify, store JWT, redirect
  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== OTP_LENGTH) return;
    setBusy(true);
    try {
      await verifyRegisterOtp(email, code, profile || null, marketingConsent);
      toast.success("Account verified — welcome!");
      maybeStartTour();
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      toast.error(err.message);
      // Bad code? Clear so the user can retype. Don't change mode.
      resetOtpState();
    } finally {
      setBusy(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendIn > 0 || busy) return;
    setBusy(true);
    try {
      const data = await requestRegisterOtp(email, profile || null, marketingConsent);
      setResendIn(data.resend_cooldown_seconds ?? 30);
      if (data._dev_otp) setDevOtp(data._dev_otp);
      resetOtpState();
      toast.success("New code sent.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-white">
      {/* ── Form pane (left) ──────────────────────────────────────────── */}
      <div className="flex-1 md:w-[45%] md:flex-none flex flex-col px-6 py-8 md:px-16 md:py-12">
        {/* Top bar: Back (OTP step only — login/register have nowhere to go
            since the configurator is gated) + brand logo. */}
        <div className="flex items-center justify-between mb-10 md:mb-14">
          {mode === "otp" ? (
            <button
              type="button"
              onClick={() => goToMode("register")}
              className="flex items-center gap-1.5 text-sm text-[hsl(215,16%,47%)] hover:text-[hsl(215,25%,27%)] transition-colors"
              data-testid="auth-back-btn"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          ) : (
            // Spacer to keep the logo right-aligned without the Back button
            <div aria-hidden="true" />
          )}
          <img
            src="/univicoustic-logo.png"
            alt="UniVicoustic"
            className="h-12 md:h-14 w-auto object-contain"
            data-testid="auth-brand-logo"
          />
        </div>

        <div className="flex-1 flex flex-col justify-center w-full max-w-sm mx-auto">
          {mode === "login" && (
            <LoginPanel
              email={email}
              setEmail={setEmail}
              busy={busy}
              onSubmit={handleLoginSubmit}
              onSwitchToRegister={() => goToMode("register")}
            />
          )}

          {mode === "register" && (
            <RegisterPanel
              email={email}
              setEmail={setEmail}
              profile={profile}
              marketingConsent={marketingConsent}
              setMarketingConsent={setMarketingConsent}
              setProfile={setProfile}
              busy={busy}
              onSubmit={handleRegisterSubmit}
              onSwitchToLogin={() => goToMode("login")}
            />
          )}

          {mode === "otp" && (
            <OtpPanel
              email={email}
              otp={otp}
              setOtp={setOtp}
              busy={busy}
              resendIn={resendIn}
              onSubmit={handleOtpSubmit}
              onResend={handleResendOtp}
              onChangeEmail={() => goToMode("register")}
              devOtp={devOtp}
            />
          )}
        </div>

        {/* Terms footer */}
        <p className="text-[11px] text-[hsl(215,16%,55%)] text-center mt-8 leading-relaxed">
          By continuing, you agree to our{" "}
          <a href="#" onClick={(e) => e.preventDefault()} className="underline hover:text-[hsl(215,25%,27%)]">Terms</a>
          {" "}and{" "}
          <a href="#" onClick={(e) => e.preventDefault()} className="underline hover:text-[hsl(215,25%,27%)]">Privacy Policy</a>.
        </p>
      </div>

      {/* ── Hero pane (right) — hidden on mobile ──────────────────────── */}
      <div className="hidden md:flex md:w-[55%] relative overflow-hidden bg-accent">
        <img
          src={HERO_IMAGE}
          alt="UniVicoustic acoustic wall paneling in a styled interior"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
        <div className="relative z-10 mt-auto p-10 lg:p-14 text-white max-w-2xl">
          <p className="font-manrope text-2xl lg:text-[28px] font-semibold leading-tight">
            Acoustic walls, designed your way.
          </p>
          <p className="text-sm lg:text-[15px] mt-3 text-white/85 leading-relaxed max-w-md">
            From custom prints to bespoke embossing — visualise, configure
            and download your panel design in minutes.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-panels ──────────────────────────────────────────────────────────────

function LoginPanel({ email, setEmail, busy, onSubmit, onSwitchToRegister }) {
  return (
    <>
      <h1 className="font-manrope text-2xl md:text-3xl font-semibold text-[hsl(215,25%,27%)] tracking-tight">
        Welcome back
      </h1>
      <p className="text-sm text-[hsl(215,16%,47%)] mt-2 mb-8">
        Sign in to access your saved configurations and downloads.
      </p>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="auth-login-form">
        <EmailField email={email} setEmail={setEmail} />
        <Button
          type="submit"
          disabled={busy || !email.trim()}
          className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-medium mt-2 shadow-sm disabled:opacity-50"
          data-testid="auth-login-submit"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4 ml-1.5" /></>}
        </Button>
      </form>
      <p className="text-sm text-[hsl(215,16%,47%)] text-center mt-6">
        Don't have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="text-accent hover:underline font-medium"
          data-testid="auth-mode-toggle"
        >
          Sign up
        </button>
      </p>
    </>
  );
}

function RegisterPanel({ email, setEmail, profile, setProfile, marketingConsent, setMarketingConsent, busy, onSubmit, onSwitchToLogin }) {
  return (
    <>
      <h1 className="font-manrope text-2xl md:text-3xl font-semibold text-[hsl(215,25%,27%)] tracking-tight">
        Create your account
      </h1>
      <p className="text-sm text-[hsl(215,16%,47%)] mt-2 mb-8">
        Enter your email to create your account.
      </p>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="auth-register-form">
        <EmailField email={email} setEmail={setEmail} />
        <ProfileField profile={profile} setProfile={setProfile} />
        {/* Marketing opt-in. Unticked by default and never required to sign
            up — consent has to be a positive action, so no pre-ticking and no
            blocking the submit button on it. */}
        <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-[hsl(var(--border))] text-accent focus:ring-accent cursor-pointer"
            data-testid="auth-marketing-consent"
          />
          <span className="text-[13px] text-[hsl(215,16%,47%)] leading-relaxed">
            Email me about the Visual Configurator and UniVicoustic products.
            Unsubscribe anytime.{" "}
            <a
              href={PRIVACY_POLICY_URL}
              {...legalLinkProps}
              onClick={(e) => e.stopPropagation()}
              className="underline hover:text-[hsl(215,25%,27%)] transition-colors"
            >
              Privacy Policy
            </a>
          </span>
        </label>
        <Button
          type="submit"
          disabled={busy || !email.trim()}
          className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-medium mt-2 shadow-sm disabled:opacity-50"
          data-testid="auth-register-submit"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign up <ArrowRight className="h-4 w-4 ml-1.5" /></>}
        </Button>
        {/* Sits under the submit button, per the wording legal supplied. */}
        <p className="text-[13px] text-[hsl(215,16%,47%)] text-center leading-relaxed">
          By creating an account you agree to our{" "}
          <a href={TERMS_URL} {...legalLinkProps} className="underline hover:text-[hsl(215,25%,27%)] transition-colors">
            Terms
          </a>{" "}
          and{" "}
          <a href={PRIVACY_POLICY_URL} {...legalLinkProps} className="underline hover:text-[hsl(215,25%,27%)] transition-colors">
            Privacy Policy
          </a>.
        </p>
      </form>
      <p className="text-sm text-[hsl(215,16%,47%)] text-center mt-6">
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-accent hover:underline font-medium"
          data-testid="auth-mode-toggle"
        >
          Sign in
        </button>
      </p>
    </>
  );
}

function OtpPanel({ email, otp, setOtp, busy, resendIn, onSubmit, onResend, onChangeEmail, devOtp }) {
  const inputsRef = useRef([]);

  // Auto-focus first empty box when the panel mounts.
  useEffect(() => {
    const idx = otp.findIndex((v) => v === "");
    inputsRef.current[idx === -1 ? OTP_LENGTH - 1 : idx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDigit = (idx, value) => {
    setOtp((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  // Handle a single keypress in any box.
  const handleKeyDown = (idx, e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      // If current is empty, jump back and clear that one.
      if (otp[idx] === "" && idx > 0) {
        setDigit(idx - 1, "");
        inputsRef.current[idx - 1]?.focus();
      } else {
        setDigit(idx, "");
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      e.preventDefault();
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < OTP_LENGTH - 1) {
      e.preventDefault();
      inputsRef.current[idx + 1]?.focus();
    } else if (/^\d$/.test(e.key)) {
      e.preventDefault();
      setDigit(idx, e.key);
      if (idx < OTP_LENGTH - 1) inputsRef.current[idx + 1]?.focus();
    }
  };

  // Pasting a full code (e.g. "482917") into ANY box should distribute
  // across all six and submit-on-fill via auto-focus on last.
  const handlePaste = (idx, e) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    e.preventDefault();
    const digits = text.slice(0, OTP_LENGTH - idx).split("");
    setOtp((prev) => {
      const next = [...prev];
      digits.forEach((d, i) => { next[idx + i] = d; });
      return next;
    });
    const lastFilled = Math.min(idx + digits.length - 1, OTP_LENGTH - 1);
    inputsRef.current[lastFilled]?.focus();
  };

  const isComplete = otp.every((d) => d !== "");

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-4">
          <Mail className="h-5 w-5 text-accent" />
        </div>
        <h1 className="font-manrope text-2xl md:text-3xl font-semibold text-[hsl(215,25%,27%)] tracking-tight">
          Check your email
        </h1>
        <p className="text-sm text-[hsl(215,16%,47%)] mt-2">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-[hsl(215,25%,27%)]">{email}</span>.
          {" "}
          <button
            type="button"
            onClick={onChangeEmail}
            className="text-accent hover:underline font-medium"
          >
            Change email
          </button>
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5" data-testid="auth-otp-form">
        <div className="flex gap-2 justify-between" data-testid="auth-otp-inputs">
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={(el) => (inputsRef.current[i] = el)}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={1}
              value={digit}
              onChange={() => { /* setDigit is handled by keydown; this just satisfies React */ }}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={(e) => handlePaste(i, e)}
              className={
                "w-11 h-12 text-center text-lg font-semibold font-manrope " +
                "border-2 rounded-lg focus:outline-none transition-colors " +
                (digit
                  ? "border-accent text-[hsl(215,25%,27%)] bg-accent/[0.04]"
                  : "border-[hsl(var(--border))] text-[hsl(215,25%,27%)] focus:border-accent")
              }
              data-testid={`auth-otp-input-${i}`}
              aria-label={`Digit ${i + 1}`}
            />
          ))}
        </div>

        {devOtp && (
          // Visible only in dev (when backend is in console mode). Easy
          // copy of the OTP so we don't need to tab to the backend log.
          <div className="text-[11px] text-[hsl(215,16%,47%)] text-center bg-[hsl(var(--secondary))] rounded-md py-2 px-3 font-mono">
            DEV — code: <span className="font-semibold text-[hsl(215,25%,27%)]">{devOtp}</span>
          </div>
        )}

        <Button
          type="submit"
          disabled={busy || !isComplete}
          className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-medium shadow-sm disabled:opacity-50"
          data-testid="auth-otp-submit"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify and continue"}
        </Button>
      </form>

      <p className="text-sm text-[hsl(215,16%,47%)] text-center mt-6">
        Didn't get the code?{" "}
        {resendIn > 0 ? (
          <span className="text-[hsl(215,16%,55%)]">Resend in {resendIn}s</span>
        ) : (
          <button
            type="button"
            onClick={onResend}
            disabled={busy}
            className="text-accent hover:underline font-medium disabled:opacity-50"
            data-testid="auth-otp-resend"
          >
            Resend code
          </button>
        )}
      </p>
    </>
  );
}

function EmailField({ email, setEmail }) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor="auth-email"
        className="text-[11px] font-semibold text-[hsl(215,25%,27%)] uppercase tracking-wider"
      >
        Email
      </Label>
      <Input
        id="auth-email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-11"
        autoComplete="email"
        required
        data-testid="auth-email-input"
      />
    </div>
  );
}

// Optional professional role — sign-up form only. Never required; leaving it on
// "Select your role…" simply records no profile.
function ProfileField({ profile, setProfile }) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor="auth-profile"
        className="text-[11px] font-semibold text-[hsl(215,25%,27%)] uppercase tracking-wider"
      >
        Your profile <span className="text-[hsl(215,16%,55%)] font-normal normal-case tracking-normal">(optional)</span>
      </Label>
      <select
        id="auth-profile"
        value={profile}
        onChange={(e) => setProfile(e.target.value)}
        className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-[hsl(215,25%,27%)] cursor-pointer ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="auth-profile-select"
      >
        <option value="">Select your role…</option>
        {PROFILE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
