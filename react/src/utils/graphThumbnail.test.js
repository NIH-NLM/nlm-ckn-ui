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

  it("returns null for a non-element", async () => {
    expect(await captureGraphThumbnail(null)).toBeNull();
  });

  it("serializes an SVG to a namespaced data URL", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    svg.appendChild(circle);
    const url = await captureGraphThumbnail(svg);
    expect(url).toMatch(/^data:image\/svg\+xml/);
    // The decoded markup must carry the SVG namespace, or browsers render a broken image.
    expect(decodeURIComponent(url)).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("frames the clone to a fixed size with preserveAspectRatio so content isn't cropped", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const url = await captureGraphThumbnail(svg);
    const markup = decodeURIComponent(url);
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(markup).toMatch(/height="160"/);
  });

  it("tight-frames the viewBox to the content bounding box (with 8% padding) when getBBox is available", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    // jsdom doesn't implement getBBox, so stub known bounds to exercise the
    // tight-frame path. padX = 100*0.08 = 8, padY = 50*0.08 = 4 →
    // viewBox = "(10-8) (20-4) (100+16) (50+8)" = "2 16 116 58".
    svg.getBBox = () => ({ x: 10, y: 20, width: 100, height: 50 });
    const url = await captureGraphThumbnail(svg);
    expect(decodeURIComponent(url)).toContain('viewBox="2 16 116 58"');
  });

  it("honors custom width/height options on the framed clone", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const url = await captureGraphThumbnail(svg, { width: 300, height: 200 });
    const markup = decodeURIComponent(url);
    expect(markup).toMatch(/width="300"/);
    expect(markup).toMatch(/height="200"/);
  });
});
