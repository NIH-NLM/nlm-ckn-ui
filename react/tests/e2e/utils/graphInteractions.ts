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
