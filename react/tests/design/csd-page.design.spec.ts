import { expect, type Page, test } from "@playwright/test";

// Cell set dataset page vs Figma frame V (930:487, "Dev UI Feedback - 09/22/26").
// Every expected value below comes from that frame or from a designer comment
// pinned in the same section; the comment's pin number is noted where it applies.
// Soft assertions, so one run lists every mismatch rather than stopping at the first.

const CSD_PATH = "/#/collections/CSD/4cb45d80-499a-48ae-a056-c71ac3552c94__respiratory_system";

const GRAY_TEXT = "rgb(91, 97, 107)"; // #5B616B
const GRAY_DARK = "rgb(50, 58, 69)"; // #323A45
const GRAY_LIGHTEST = "rgb(241, 241, 241)"; // #F1F1F1
const COOL_BLUE_LIGHTEST = "rgb(220, 228, 239)"; // #DCE4EF
const PRIMARY_DARKEST = "rgb(17, 46, 81)"; // #112E51
const BG_LIGHT_BLUE = "rgb(247, 251, 253)"; // #F7FBFD

type Box = { x: number; y: number; width: number; height: number };

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} is not rendered`);
  return b;
}

async function css(page: Page, selector: string, prop: string, pseudo?: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((el, [p, ps]) => getComputedStyle(el, ps).getPropertyValue(p), [
      prop,
      pseudo ?? null,
    ] as const);
}

// Rounds to the nearest px so sub-pixel layout doesn't read as a mismatch.
const px = (n: number) => Math.round(n);

// The workspace ends 16px above the site footer, which the team requires on
// every page (frame V draws the page without one).
async function workspaceBottom(page: Page): Promise<number> {
  return px((await box(page, ".site-footer")).y) - 16;
}

test.beforeEach(async ({ page }) => {
  await page.goto(CSD_PATH);
  await expect(page.locator(".graph-title")).toBeVisible({ timeout: 30_000 });
});

test("page fits the viewport with no scrolling", async ({ page }) => {
  const { scrollW, scrollH, w, h } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  expect.soft(scrollW, "horizontal page scroll").toBeLessThanOrEqual(w);
  expect
    .soft(scrollH, "vertical page scroll (history strip is pinned to the bottom)")
    .toBeLessThanOrEqual(h);
});

test("title bar", async ({ page }, testInfo) => {
  const bar = await box(page, ".app-title-bar");
  expect.soft(px(bar.height), "height (pin 6)").toBe(64);
  expect
    .soft(await css(page, ".app-title-bar", "background-color"), "bg (pin 1)")
    .toBe(PRIMARY_DARKEST);

  expect
    .soft(await css(page, ".app-title-wordmark", "font-size"), "title size (pin 2)")
    .toBe("24px");
  const logo = await box(page, ".app-title-logo");
  const word = await box(page, ".app-title-wordmark");
  expect.soft(px(word.x - (logo.x + logo.width)), "logo to title gap (pin 3)").toBe(32);

  // WebKit ignores the pseudo-element argument to getComputedStyle, so the
  // placeholder color can only be checked in the other engines.
  if (testInfo.project.name !== "webkit") {
    expect
      .soft(
        await css(page, ".app-title-bar .search-input", "color", "::placeholder"),
        "placeholder (pin 4)",
      )
      .toBe(GRAY_TEXT);
  }
  expect
    .soft(await css(page, ".app-title-bar .search-icon", "color"), "search icon (pin 5)")
    .toBe(GRAY_DARK);
});

test("menu bar", async ({ page }) => {
  const nav = await box(page, ".navbar");
  expect.soft(px(nav.height), "height (pin 7)").toBe(46);
  expect.soft(await css(page, ".navbar", "border-bottom-width"), "no stroke (pin 8)").toBe("0px");
  expect.soft(await css(page, ".navbar", "box-shadow"), "no shadow (pin 8)").toBe("none");

  const item = await box(page, ".navbar a");
  expect.soft(px(item.x), "first item at the 40px margin").toBe(40);
  expect.soft(px(item.width), "item width").toBe(80);
  expect.soft(await css(page, ".navbar h4", "font-weight"), "label weight").toBe("500");

  const content = await box(page, ".graph-workspace");
  expect.soft(px(content.y - (nav.y + nav.height)), "gap below menu (pin 9)").toBe(16);
});

test("column grid", async ({ page }) => {
  const inspector = await box(page, ".graph-workspace-inspector");
  const canvas = await box(page, ".graph-workspace-canvas");
  expect.soft(px(inspector.x), "left margin").toBe(40);
  expect.soft(px(inspector.width), "info panel width (pin 17)").toBe(345);
  expect.soft(px(canvas.x - (inspector.x + inspector.width)), "gutter (pin 10)").toBe(20);
  expect.soft(px(1440 - (canvas.x + canvas.width)), "right margin").toBe(40);
});

test("info panel", async ({ page }) => {
  expect
    .soft(await css(page, ".inspector-card-title", "font-weight"), "title weight (pin 11)")
    .toBe("500");
  expect.soft(await css(page, ".inspector-card-title", "font-size"), "title size").toBe("14px");
  expect
    .soft(await css(page, ".inspector-section-title", "font-weight"), "heading weight (pin 14)")
    .toBe("500");
  expect
    .soft(await css(page, ".inspector-section-title", "font-size"), "heading size")
    .toBe("12px");
  expect
    .soft(
      await css(page, ".inspector-section-title", "border-bottom-color"),
      "divider under heading (pin 15)",
    )
    .toBe(COOL_BLUE_LIGHTEST);
  expect
    .soft(
      await css(page, ".inspector-section-title", "border-bottom-style"),
      "divider under heading (pin 15)",
    )
    .toBe("solid");

  // The card scrolls inside the panel instead of stretching the page (pin 22):
  // some ancestor of the last section must scroll, and scrolling it to the end
  // must bring that section fully into its visible area.
  const lastSectionReachable = await page
    .locator(".inspector-section")
    .last()
    .evaluate((section) => {
      let el = section.parentElement;
      while (el && !["auto", "scroll"].includes(getComputedStyle(el).overflowY)) {
        el = el.parentElement;
      }
      if (!el || el === document.documentElement || el === document.body) return false;
      el.scrollTop = el.scrollHeight;
      return section.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1;
    });
  expect
    .soft(lastSectionReachable, "panel scrolls internally to its last section (pin 22)")
    .toBe(true);
  const card = await box(page, ".inspector-card");
  const learn = await box(page, ".learn-explore");
  expect
    .soft(px(card.y + card.height), "panel ends above Learn & Explore")
    .toBeLessThanOrEqual(px(learn.y));
  expect
    .soft(px(learn.y + learn.height), "Learn & Explore pinned to the bottom (pin 25)")
    .toBe(await workspaceBottom(page));
});

test("graph section", async ({ page }) => {
  expect.soft(await css(page, ".graph-title", "font-size"), "title size").toBe("24px");
  expect.soft(await css(page, ".graph-title", "font-weight"), "title weight").toBe("500");
  expect
    .soft(
      await css(page, ".graph-title-bar", "border-bottom-style"),
      "no line under title (pin 13)",
    )
    .toBe("none");

  const btn = ".toggle-options-button";
  expect
    .soft(await css(page, btn, "background-color"), "Show Options bg (pin 12)")
    .toBe(GRAY_LIGHTEST);
  expect
    .soft(await css(page, btn, "border-top-style"), "Show Options border (pin 12)")
    .toBe("none");
  expect.soft(await css(page, btn, "color"), "Show Options text (pin 12)").toBe(GRAY_DARK);
  expect.soft(await css(page, btn, "font-weight"), "Show Options weight (pin 12)").toBe("500");
  expect.soft(px((await box(page, btn)).height), "Show Options height (pin 12)").toBe(40);

  // Canvas controls: square 40px #F1F1F1 tiles, one column, 12px apart (pin 18).
  const icons = page.locator(".graph-canvas-icon-button");
  const boxes = await icons.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().toJSON()),
  );
  expect
    .soft(await css(page, ".graph-canvas-icon-button", "background-color"), "control bg (pin 18)")
    .toBe(GRAY_LIGHTEST);
  expect
    .soft(
      await css(page, ".graph-canvas-icon-button", "border-top-left-radius"),
      "control radius (pin 18)",
    )
    .toBe("4px");
  expect
    .soft(await css(page, ".graph-canvas-icon-button", "color"), "control glyph (pin 18)")
    .toBe(GRAY_DARK);
  // The frame shows two controls; the app adds its own, so require at least two.
  expect.soft(boxes.length, "control count (pin 18)").toBeGreaterThanOrEqual(2);
  boxes.forEach((b, i) => {
    expect.soft([px(b.width), px(b.height)], `control ${i} size (pin 18)`).toEqual([40, 40]);
  });
  for (let i = 1; i < boxes.length; i++) {
    expect.soft(px(boxes[i].x), `control ${i} stacked vertically (pin 18)`).toBe(px(boxes[0].x));
    expect.soft(px(boxes[i].y - boxes[i - 1].bottom), `control ${i} spacing (pin 18)`).toBe(12);
  }
});

test("history strip", async ({ page }) => {
  await expect(page.locator(".saved-graph-card").first()).toBeVisible();
  const graph = await box(page, ".graph-workspace-canvas-body");
  const shelf = await box(page, ".graph-workspace-shelf");
  const gap = px(shelf.y - (graph.y + graph.height));
  expect.soft(gap, "graph to strip gap (pin 19)").toBeGreaterThanOrEqual(16);
  expect.soft(gap, "graph to strip gap (pin 19)").toBeLessThanOrEqual(20);
  expect
    .soft(px(shelf.y + shelf.height), "strip pinned to the bottom")
    .toBe(await workspaceBottom(page));
  expect
    .soft(await css(page, ".graph-workspace-shelf", "background-color"), "strip bg (pin 21)")
    .toBe(BG_LIGHT_BLUE);

  await expect
    .soft(page.locator(".graph-history-title"), "breadcrumb (pin 20)")
    .toHaveText(/^Workflow Builder \/ /);

  // Vis card 674:3149 (pin 24).
  const card = ".saved-graph-card";
  const c = await box(page, card);
  expect.soft([px(c.width), px(c.height)], "card size (pin 24)").toEqual([180, 164]);
  expect.soft(await css(page, card, "background-color"), "card bg (pin 24)").toBe(GRAY_LIGHTEST);
  expect
    .soft(await css(page, card, "border-top-color"), "card border (pin 24)")
    .toBe(COOL_BLUE_LIGHTEST);
  expect.soft(await css(page, card, "border-top-left-radius"), "card radius (pin 24)").toBe("4px");
  const title = await box(page, ".saved-graph-card-title");
  const thumb = await box(page, ".saved-graph-card-thumb");
  expect.soft(title.y, "title above thumbnail (pin 24)").toBeLessThan(thumb.y);

  // Nothing overflows the card (pin 23).
  const overflow = Math.max(
    0,
    title.x + title.width - (c.x + c.width),
    title.y + title.height - (c.y + c.height),
  );
  expect.soft(px(overflow), "title overflows card (pin 23)").toBe(0);
});
