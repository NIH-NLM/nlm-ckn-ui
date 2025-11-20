import type { Page } from "@playwright/test";

// Installs global error & console instrumentation into the page so tests can assert absence of runtime errors.
// Records into window.__ERRORS__ an array of objects: { type, msg, stack?, args?, src?, line?, col? }
export async function installErrorInstrumentation(page: Page) {
  await page.addInitScript(() => {
    // biome-ignore lint/suspicious/noExplicitAny: monkey-patching window for test instrumentation
    (window as any).__ERRORS__ = [];
    const prevOnError = window.onerror;
    window.onerror = (msg, src, line, col, err) => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
      (window as any).__ERRORS__.push({ type: "onerror", msg, src, line, col, stack: err?.stack });
      if (prevOnError) return prevOnError(msg, src, line, col, err);
    };
    const prevConsoleError = console.error;
    console.error = (...args) => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
      (window as any).__ERRORS__.push({ type: "console", args: args.map((a) => String(a)) });
      // biome-ignore lint/suspicious/noExplicitAny: passing args to apply
      return prevConsoleError.apply(console, args as any);
    };
  });
  page.on("pageerror", (err) => {
    page
      .evaluate(
        ({ message, stack }) => {
          // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
          if ((window as any).__ERRORS__) {
            // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
            (window as any).__ERRORS__.push({ type: "pageerror", msg: message, stack });
          }
        },
        { message: err.message, stack: err.stack },
      )
      .catch(() => {});
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      page
        .evaluate(
          ({ text }) => {
            // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
            if ((window as any).__ERRORS__) {
              // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
              (window as any).__ERRORS__.push({ type: "console-event", text });
            }
          },
          { text: msg.text() },
        )
        .catch(() => {});
    }
  });
}

// Fetch collected errors from page context.
export async function getCollectedErrors(page: Page) {
  // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
  return await page.evaluate(() => (window as any).__ERRORS__ || []);
}

// Assert helper: ensure no errors contain substring (e.g. 'split')
// biome-ignore lint/suspicious/noExplicitAny: generic error object
export function filterErrorsContaining(errors: any[], needle: string) {
  return errors.filter((e) => JSON.stringify(e).includes(needle));
}
