import { computeBigDipperTargets, computeFitTransform } from "./simulationUtils";

/** The seven collections that occupy stars, in bowl-then-handle order. */
const MOTIF = ["GS", "PR", "CHEMBL", "MONDO", "CS", "CL", "UBERON"];

describe("computeBigDipperTargets", () => {
  it("gives every motif collection a distinct star slot", () => {
    const targets = computeBigDipperTargets(MOTIF, 1000, 1000);

    for (const coll of MOTIF) {
      expect(targets[coll]).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    }

    const positions = MOTIF.map((c) => `${targets[c].x},${targets[c].y}`);
    expect(new Set(positions).size).toBe(MOTIF.length);
  });

  it("runs the handle outward from the gene star, one link at a time", () => {
    const targets = computeBigDipperTargets(MOTIF, 1000, 1000);
    const gene = targets.GS;
    const distanceFromGene = (coll) =>
      Math.hypot(targets[coll].x - gene.x, targets[coll].y - gene.y);

    // Alioth -> Mizar -> Alkaid hang off the gene in that order, so each must
    // sit farther out than the one before it.
    expect(distanceFromGene("CS")).toBeLessThan(distanceFromGene("CL"));
    expect(distanceFromGene("CL")).toBeLessThan(distanceFromGene("UBERON"));

    // The handle leaves the bowl rather than crossing it.
    const bowlMinX = Math.min(targets.GS.x, targets.PR.x, targets.CHEMBL.x, targets.MONDO.x);
    for (const coll of ["CS", "CL", "UBERON"]) {
      expect(targets[coll].x).toBeLessThan(bowlMinX);
    }
  });

  // Handle ordering alone would still pass if two bowl collections swapped
  // corners, so pin the bowl by its shape: walking the four collections in
  // dipper-edge order must trace a convex quadrilateral. A swap makes the
  // polygon self-intersect and flips the sign of one cross product.
  it("walks the bowl as a convex quadrilateral in dipper-edge order", () => {
    const targets = computeBigDipperTargets(MOTIF, 1000, 1000);
    const BOWL = ["GS", "PR", "CHEMBL", "MONDO"];

    const crossProducts = BOWL.map((_, i) => {
      const a = targets[BOWL[i]];
      const b = targets[BOWL[(i + 1) % 4]];
      const c = targets[BOWL[(i + 2) % 4]];
      return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    });

    expect(crossProducts.every((z) => z > 0)).toBe(true);
  });

  it("parks off-motif collections below the asterism, spread apart", () => {
    const targets = computeBigDipperTargets([...MOTIF, "BMC", "GO", "PATO"], 1000, 1000);
    const lowestStar = Math.max(...MOTIF.map((c) => targets[c].y));
    const parked = ["BMC", "GO", "PATO"];

    for (const coll of parked) {
      expect(targets[coll].y).toBeGreaterThan(lowestStar);
    }

    // Spread across the row in the order given, not stacked on one point.
    const xs = parked.map((c) => targets[c].x);
    expect(new Set(xs).size).toBe(parked.length);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("omits collections that are not in the graph", () => {
    const targets = computeBigDipperTargets(["GS", "MONDO"], 1000, 1000);

    expect(Object.keys(targets).sort()).toEqual(["GS", "MONDO"]);
  });

  it("scales with the canvas and stays centered on the origin", () => {
    const small = computeBigDipperTargets(MOTIF, 500, 500);
    const large = computeBigDipperTargets(MOTIF, 1000, 1000);

    expect(large.UBERON.x).toBeCloseTo(small.UBERON.x * 2);
    expect(large.PR.y).toBeCloseTo(small.PR.y * 2);

    // The seven stars are balanced around the origin, so the canvas centers on
    // the asterism rather than on one end of it.
    const mean = (axis) => MOTIF.reduce((sum, c) => sum + large[c][axis], 0) / MOTIF.length;
    expect(mean("x")).toBeCloseTo(0);
    expect(mean("y")).toBeCloseTo(0);
  });

  it("uses the short canvas axis so the shape survives a wide viewport", () => {
    const wide = computeBigDipperTargets(MOTIF, 4000, 600);
    const square = computeBigDipperTargets(MOTIF, 600, 600);

    expect(wide).toEqual(square);
  });
});

describe("computeFitTransform", () => {
  it("scales a graph larger than the view down so every node fits inside the padding", () => {
    const nodes = [
      { x: -1000, y: -500 },
      { x: 1000, y: 500 },
    ];
    const { k, x, y } = computeFitTransform(nodes, 1000, 800, 1, 50);
    expect(k).toBeCloseTo(900 / 2000);
    // Symmetric graph around the origin stays centred.
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it("centres an off-centre graph", () => {
    const nodes = [
      { x: 100, y: 200 },
      { x: 300, y: 400 },
    ];
    const { k, x, y } = computeFitTransform(nodes, 1000, 1000, 1, 0);
    expect(k).toBe(1);
    expect(x).toBeCloseTo(-200);
    expect(y).toBeCloseTo(-300);
  });

  it("never zooms in past maxScale on a small graph", () => {
    const { k } = computeFitTransform(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      1000,
      800,
      1,
      48,
    );
    expect(k).toBe(1);
  });

  it("returns null for an empty graph", () => {
    expect(computeFitTransform([], 1000, 800, 1, 48)).toBeNull();
  });
});
