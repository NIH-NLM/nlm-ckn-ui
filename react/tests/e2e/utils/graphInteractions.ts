import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Right-clicks a force-graph node and waits for its context menu
 * (`.document-popup`) to open, returning the popup locator.
 *
 * Graph nodes keep drifting until the d3 force simulation cools, and the tests
 * right-click with `{ force: true }`, which skips Playwright's "element is
 * stable" wait. A single right-click can therefore land just as the node moves
 * and the context menu never opens — the source of intermittent
 * `.document-popup` failures in CI.
 *
 * This retries the right-click until the popup is visible. It only re-clicks
 * when the popup is not already open, since a second right-click on an open
 * menu would toggle it shut.
 */
export async function openNodeContextMenu(page: Page, node: Locator): Promise<Locator> {
  const popup = page.locator(".document-popup");
  await expect(async () => {
    if (!(await popup.isVisible())) {
      await node.click({ button: "right", force: true });
    }
    await expect(popup).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  return popup;
}

/**
 * Clicks Generate/Update Graph and waits until that build's layout settles.
 *
 * The SVG's data-sim-settled starts as "true" (an empty graph has nothing to
 * settle), and a build first runs an empty update before the real one. Waiting
 * for "true" straight after the click can therefore pass before the nodes have
 * laid out, and a position read then is mid-layout or missing. This watches the
 * attribute from before the click and resolves only once it goes "false" and
 * back to "true" with nodes rendered.
 */
export async function generateGraphAndSettle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { settled: 0, unsettled: false };
    (window as unknown as { __graphSettles: typeof state }).__graphSettles = state;
    new MutationObserver((records) => {
      for (const record of records) {
        const value = (record.target as Element).getAttribute("data-sim-settled");
        if (value === "false") {
          state.unsettled = true;
        } else if (value === "true" && state.unsettled) {
          state.unsettled = false;
          if (document.querySelectorAll("g.node").length > 0) state.settled += 1;
        }
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-sim-settled"],
    });
  });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();
  await page.waitForFunction(
    () => (window as unknown as { __graphSettles: { settled: number } }).__graphSettles.settled > 0,
    null,
    { timeout: 15000 },
  );
}
