import { captureGraphThumbnail } from "./graphThumbnail";

describe("captureGraphThumbnail", () => {
  it("returns null when no element is provided", async () => {
    await expect(captureGraphThumbnail(null)).resolves.toBeNull();
  });

  it("serializes an svg element to a data url", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "100");
    const url = await captureGraphThumbnail(svg);
    expect(typeof url).toBe("string");
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("returns null (does not throw) on serialization failure", async () => {
    await expect(captureGraphThumbnail({})).resolves.toBeNull();
  });
});
