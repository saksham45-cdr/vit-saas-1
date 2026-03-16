import { chromium } from "playwright";
import { logError } from "../lib/logger";

export interface ScrapedPage {
  url: string;
  html: string;
}

// Signals that Booking.com returned a CAPTCHA or block page instead of hotel content
const CAPTCHA_SIGNALS = [
  "captcha",
  "cf-challenge",
  "recaptcha",
  "robot check",
  "access denied",
  "just a moment",
  "attention required",
  "blocked",
  "verifying you are human",
];

function isCaptchaPage(html: string, title: string): boolean {
  const titleLower = title.toLowerCase();
  const htmlLower = html.toLowerCase();

  // Check title for block signals
  if (CAPTCHA_SIGNALS.some((s) => titleLower.includes(s))) return true;

  // Check for Cloudflare / bot challenge markup in body
  if (htmlLower.includes("cf-browser-verification")) return true;
  if (htmlLower.includes("id=\"challenge-form\"")) return true;
  if (htmlLower.includes("class=\"g-recaptcha\"")) return true;

  // Legitimate hotel pages are long — a very short page is a block page
  if (html.length < 10_000) return true;

  return false;
}

export async function scrapeBookingPage(url: string): Promise<ScrapedPage | null> {
  const headless = process.env.PLAYWRIGHT_HEADLESS !== "false";

  const browser = await chromium.launch({ headless });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "en-US",
    });

    const page = await context.newPage();

    await page.goto(url, { timeout: 30_000, waitUntil: "domcontentloaded" });

    // Wait for review score or hotel title — gives JS time to render ratings
    await page.waitForSelector(
      '[data-testid="review-score-badge"], [data-testid="review-score"], h2.pp-header__name, .hp__hotel-name',
      { timeout: 15_000 }
    ).catch(() => {
      // Selector not found — page may still have useful data, continue to CAPTCHA check
    });

    const html = await page.content();
    const title = await page.title();

    // Detect CAPTCHA or block page — do NOT return content so pipeline skips caching
    if (isCaptchaPage(html, title)) {
      logError("scrapeBookingPage", url, 403, new Error(`CAPTCHA or block page detected for: ${url}`));
      return null;
    }

    return { url, html };
  } finally {
    await browser.close();
  }
}
