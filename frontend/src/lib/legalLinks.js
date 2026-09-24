/**
 * legalLinks.js
 * -------------
 * Canonical URLs for the public legal pages, kept in one place because they
 * appear in three spots (consent banner, sign-up checkbox, sign-up footer).
 *
 * These live on the marketing WordPress site, not in this app — so they are
 * absolute URLs and always open in a new tab, keeping the user's in-progress
 * configuration intact.
 */
export const PRIVACY_POLICY_URL =
  "https://apac-middleeast.univicoustic.com/privacy-policy";
export const TERMS_URL =
  "https://apac-middleeast.univicoustic.com/terms-and-conditions";

/** Shared props for an external legal link — noopener/noreferrer on every one. */
export const legalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
};
