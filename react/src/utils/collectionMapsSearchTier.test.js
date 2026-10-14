import collectionMaps from "../assets/nlm-ckn-collection-maps.json";

// Temporary guard on search_tier until a backend loader and schema validate the key.
const TIERS = ["label", "synonym", "identifier", "text"];
const entries = collectionMaps.maps.flatMap(([collection, map]) =>
  map.individual_fields.map((field) => ({ collection, field })),
);

describe("collection-maps search tiers", () => {
  it("defines exactly the four tiers", () => {
    expect(Object.keys(collectionMaps.search_tiers).sort()).toEqual([...TIERS].sort());
  });

  it("gives every field entry a valid search_tier", () => {
    for (const { field } of entries) {
      expect(field).toHaveProperty("search_tier");
      expect([...TIERS, null]).toContain(field.search_tier);
    }
  });

  it("leaves every TEST_* field untiered", () => {
    const test = entries.filter(({ collection }) => collection.startsWith("TEST_"));
    expect(test.every(({ field }) => field.search_tier === null)).toBe(true);
  });

  it("uses one tier per field name across collections", () => {
    const tiers = {};
    for (const { collection, field } of entries) {
      if (collection.startsWith("TEST_")) continue;
      tiers[field.field_to_display] ??= new Set();
      tiers[field.field_to_display].add(field.search_tier);
    }
    const mixed = Object.keys(tiers).filter((name) => tiers[name].size > 1);
    // Per-collection exception: CS dataset_name repeats the dataset name on 2,523 of
    // 2,617 cell sets, so tiering it would crowd dataset searches with cell sets.
    expect(mixed).toEqual(["dataset_name"]);
  });

  it("tiers dataset_name only on CSD", () => {
    const tiers = entries
      .filter(({ field }) => field.field_to_display === "dataset_name")
      .map(({ collection, field }) => [collection, field.search_tier]);
    expect(tiers).toEqual([
      ["CS", null],
      ["CSD", "label"],
    ]);
  });

  it("matches the expected per-tier entry counts", () => {
    const counts = {};
    for (const { field } of entries) {
      counts[field.search_tier] = (counts[field.search_tier] ?? 0) + 1;
    }
    expect(counts).toEqual({ label: 20, synonym: 7, identifier: 19, text: 37, null: 36 });
  });
});
