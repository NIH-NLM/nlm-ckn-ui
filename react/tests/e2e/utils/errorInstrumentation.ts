import { Page } from '@playwright/test';

// Installs global error & console instrumentation into the page so tests can assert absence of runtime errors.
// Records into window.__ERRORS__ an array of objects: { type, msg, stack?, args?, src?, line?, col? }
export async function installErrorInstrumentation(page: Page) {
    await page.addInitScript(() => {
        (window as any).__ERRORS__ = [];
        const prevOnError = window.onerror;
        window.onerror = function (msg, src, line, col, err) {
            (window as any).__ERRORS__.push({ type: 'onerror', msg, src, line, col, stack: err?.stack });
            if (prevOnError) return prevOnError(msg, src, line, col, err);
        };
        const prevConsoleError = console.error;
        console.error = function (...args) {
            (window as any).__ERRORS__.push({ type: 'console', args: args.map(a => String(a)) });
            return prevConsoleError.apply(console, args as any);
        };
    });
    page.on('pageerror', (err) => {
        page.evaluate(({ message, stack }) => {
            if ((window as any).__ERRORS__) {
                (window as any).__ERRORS__.push({ type: 'pageerror', msg: message, stack });
            }
        }, { message: err.message, stack: err.stack }).catch(() => { });
    });
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            page.evaluate(({ text }) => {
                if ((window as any).__ERRORS__) {
                    (window as any).__ERRORS__.push({ type: 'console-event', text });
                }
            }, { text: msg.text() }).catch(() => { });
        }
    });
}

// Fetch collected errors from page context.
export async function getCollectedErrors(page: Page) {
    return await page.evaluate(() => (window as any).__ERRORS__ || []);
}

// Assert helper: ensure no errors contain substring (e.g. 'split')
export function filterErrorsContaining(errors: any[], needle: string) {
    return errors.filter(e => JSON.stringify(e).includes(needle));
}