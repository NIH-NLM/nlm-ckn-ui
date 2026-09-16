import {
  applyFieldTransform,
  capitalCase,
  filterBrowsableCollections,
  formatFieldValue,
  getDisplayFields,
  getLabel,
  getNodeExternalUrl,
  getNodeLabel,
  getTitle,
  getUrl,
  hasNodesInRawData,
  humanizeSlug,
  parseCollections,
} from "./index";

// --- Mocking ---

// Mock the collectionsMapData import
jest.mock(
  "../assets/nlm-ckn-collection-maps.json",
  () => ({
    maps: [
      [
        "nodes_a",
        {
          display_name: "Nodes A",
          individual_labels: [{ field_to_use: "name" }, { field_to_use: "key" }],
          individual_urls: [
            {
              individual_url: "/data/nodes-a/<FIELD_TO_USE>",
              field_to_use: "key",
              to_be_replaced: "_",
              replace_with: "-",
              make_lower_case: true,
            },
          ],
        },
      ],
      [
        "nodes_b",
        {
          display_name: "Nodes B",
          individual_labels: [{ field_to_use: "title" }],
        },
      ],
      [
        "edges",
        {
          display_name: "Relationships",
          individual_labels: [{ field_to_use: "label" }],
        },
      ],
      [
        "nodes_c",
        {
          individual_labels: [{ field_to_use: "description" }],
        },
      ],
      [
        "nodes_d",
        {
          display_name: "Nodes D",
          individual_labels: [{ field_to_use: "name" }],
          individual_fields: [
            { field_to_display: "name", display_field_as: "Name" },
            {
              field_to_display: "ontology_purl",
              display_field_as: "Ontology term",
              field_url: "http://purl.obolibrary.org/obo/<FIELD_TO_USE>",
              field_to_use: "ontology_purl",
              to_be_replaced: ":",
              replace_with: "_",
            },
            {
              field_to_display: "publication",
              display_field_as: "Publication (DOI)",
              field_url: "https://doi.org/<FIELD_TO_USE>",
              field_to_use: "publication",
            },
          ],
        },
      ],
    ],
  }),
  { virtual: true },
);

// --- Tests ---

describe("Utils Module", () => {
  // --- hasNodesInRawData ---
  describe("hasNodesInRawData", () => {
    it("should return false for null or undefined data", () => {
      expect(hasNodesInRawData(null)).toBe(false);
      expect(hasNodesInRawData(undefined)).toBe(false);
    });

    it("should return false if data is not an object", () => {
      expect(hasNodesInRawData("string")).toBe(false);
      expect(hasNodesInRawData(123)).toBe(false);
    });

    it("should return false for empty object", () => {
      expect(hasNodesInRawData({})).toBe(false);
    });

    // Shortest-path shape: { nodes: Array, links: Array }
    it("should return true for shortest-path shape with nodes", () => {
      expect(hasNodesInRawData({ nodes: [{ _id: "CL/1" }], links: [] })).toBe(true);
    });

    it("should return false for shortest-path shape with empty nodes", () => {
      expect(hasNodesInRawData({ nodes: [], links: [] })).toBe(false);
    });

    // Per-origin shape: { [originId]: { nodes: Array, links: Array } }
    it("should return true for per-origin shape with nodes", () => {
      expect(
        hasNodesInRawData({
          "CL/123": { nodes: [{ _id: "CL/123" }], links: [] },
        }),
      ).toBe(true);
    });

    it("should return true if any origin has nodes", () => {
      expect(
        hasNodesInRawData({
          "CL/123": { nodes: [], links: [] },
          "UBERON/456": { nodes: [{ _id: "UBERON/456" }], links: [] },
        }),
      ).toBe(true);
    });

    it("should return false for per-origin shape with all empty nodes", () => {
      expect(
        hasNodesInRawData({
          "CL/123": { nodes: [], links: [] },
          "UBERON/456": { nodes: [], links: [] },
        }),
      ).toBe(false);
    });

    it("should return false for per-origin shape with invalid structure", () => {
      expect(
        hasNodesInRawData({
          "CL/123": { links: [] }, // missing nodes
        }),
      ).toBe(false);
      expect(
        hasNodesInRawData({
          "CL/123": null,
        }),
      ).toBe(false);
    });
  });

  // --- parseCollections ---
  describe("parseCollections", () => {
    const unsortedCollections = ["nodes_c", "Edges", "nodes_A"]; // Mixed case

    it("should sort collections alphabetically (case-insensitive) without a map", () => {
      const expected = ["Edges", "nodes_A", "nodes_c"];
      expect(parseCollections(unsortedCollections)).toEqual(expected);
    });

    it("should sort collections using display_name from map (case-insensitive)", () => {
      // Use the mocked collectionsMapData via the Map constructor
      const collectionMaps = new Map(require("../assets/nlm-ckn-collection-maps.json").maps);
      const input = ["nodes_b", "nodes_a"]; // Based on mock display names: Nodes B, Nodes A
      const expected = ["nodes_a", "nodes_b"]; // Sorted: Nodes A, Nodes B
      expect(parseCollections(input, collectionMaps)).toEqual(expected);
    });

    it("should fallback to collection key for sorting if display_name is missing", () => {
      const collectionMaps = new Map(require("../assets/nlm-ckn-collection-maps.json").maps);
      // nodes_c has no display_name in mock, nodes_a has "Nodes A"
      const input = ["nodes_c", "nodes_a"];
      // Expected: nodes_a ("Nodes A"), nodes_c (key)
      const expected = ["nodes_a", "nodes_c"];
      expect(parseCollections(input, collectionMaps)).toEqual(expected);
    });

    it("should fallback to collection key for sorting if collection not in map", () => {
      const collectionMaps = new Map(require("../assets/nlm-ckn-collection-maps.json").maps);
      // nodes_x not in mock map, nodes_a has "Nodes A"
      const input = ["nodes_x", "nodes_a"];
      // Expected: nodes_a ("Nodes A"), nodes_x (key)
      const expected = ["nodes_a", "nodes_x"];
      expect(parseCollections(input, collectionMaps)).toEqual(expected);
    });

    it("should handle mixed cases with and without map entries", () => {
      const collectionMaps = new Map(require("../assets/nlm-ckn-collection-maps.json").maps);
      // nodes_a: "Nodes A", nodes_b: "Nodes B", nodes_c: no display, nodes_x: no entry
      const input = ["nodes_x", "nodes_c", "nodes_b", "nodes_a"];
      const expected = ["nodes_a", "nodes_b", "nodes_c", "nodes_x"];
      expect(parseCollections(input, collectionMaps)).toEqual(expected);
    });
  });

  // --- filterBrowsableCollections ---
  describe("filterBrowsableCollections", () => {
    it("should remove the Life cycle stage (HsapDv) collection", () => {
      const input = ["CL", "HsapDv", "GO"];
      expect(filterBrowsableCollections(input)).toEqual(["CL", "GO"]);
    });

    it("should leave the list unchanged when no non-browsable collections are present", () => {
      const input = ["CL", "GO", "UBERON"];
      expect(filterBrowsableCollections(input)).toEqual(["CL", "GO", "UBERON"]);
    });

    it("should preserve order of the remaining collections", () => {
      const input = ["GO", "HsapDv", "CL"];
      expect(filterBrowsableCollections(input)).toEqual(["GO", "CL"]);
    });
  });

  // --- getLabel ---
  describe("getLabel", () => {
    it("should return label based on the first 'individual_labels' option found", () => {
      const item = { _id: "nodes_a/1", name: "Label A", key: "key_a" };
      expect(getLabel(item)).toBe("Label A"); // 'name' exists
    });

    it("should return label based on the second 'individual_labels' option if first is missing", () => {
      const item = { _id: "nodes_a/2", key: "key_a2" }; // 'name' is missing
      expect(getLabel(item)).toBe("key_a2"); // falls back to 'key'
    });

    it("should return label from default 'edges' config if specific collection config is missing or labels not found", () => {
      const item = { _id: "edges/e1", label: "Edge Label" }; // Use edge label config
      expect(getLabel(item)).toBe("Edge Label");
    });

    it("should handle label values that are arrays by converting to string", () => {
      const item = { _id: "nodes_b/3", title: ["Part 1", "Part 2"] };
      expect(getLabel(item)).toBe("Part 1,Part 2");
    });

    it("should handle numeric labels", () => {
      const item = { _id: "nodes_a/4", key: 12345 }; // 'name' is missing
      expect(getLabel(item)).toBe("12345");
    });

    it("should return NAME UNKNOWN if no label options are found", () => {
      const item = { _id: "nodes_a/5", other_prop: "value" }; // neither 'name' nor 'key' exist
      expect(getLabel(item)).toBe("NAME UNKNOWN");
    });
  });

  // --- getUrl ---
  describe("getUrl", () => {
    it("should generate the correct URL with replacement and lowercasing", () => {
      const item = { _id: "nodes_a/1", key: "Item_Key_1" };
      expect(getUrl(item)).toBe("/data/nodes-a/item-key-1");
    });

    it("should return null if config has no url", () => {
      const item = { _id: "nodes_b/1", title: "Test Title" }; // nodes_b has no URL config in mock
      expect(getUrl(item)).toBeNull();
    });
  });

  // --- getDisplayFields ---
  describe("getDisplayFields", () => {
    it("should rewrite CURIEs before building a field URL", () => {
      const item = { _id: "nodes_d/1", name: "item", ontology_purl: "CL:0002399" };
      const purl = getDisplayFields(item).find((field) => field.key === "ontology_purl");
      expect(purl.url).toBe("http://purl.obolibrary.org/obo/CL_0002399");
      expect(purl.value).toBe("CL:0002399");
    });

    it("should build field URLs without a replacement rule unchanged", () => {
      const item = { _id: "nodes_d/1", name: "item", publication: "10.1038/s41467-023-40173-5" };
      const doi = getDisplayFields(item).find((field) => field.key === "publication");
      expect(doi.url).toBe("https://doi.org/10.1038/s41467-023-40173-5");
    });

    it("should omit fields the document does not carry", () => {
      const item = { _id: "nodes_d/1", name: "item" };
      expect(getDisplayFields(item).map((field) => field.key)).toEqual(["name"]);
    });
  });

  // --- formatFieldValue ---
  describe("formatFieldValue", () => {
    it("should round full-precision decimal strings to two places", () => {
      expect(formatFieldValue("0.6556691514777705")).toBe("0.66");
      expect(formatFieldValue("0.5901353591296488")).toBe("0.59");
      expect(formatFieldValue(0.8412340000000001)).toBe("0.84");
    });

    it("should keep significant digits for values below the rounding threshold", () => {
      expect(formatFieldValue("0.0000123456")).toBe("0.000012");
      expect(formatFieldValue("0.004")).toBe("0.004");
      expect(formatFieldValue("-0.004")).toBe("-0.004");
      expect(formatFieldValue("0.009")).toBe("0.009");
    });

    it("should round at the threshold itself", () => {
      expect(formatFieldValue("0.01")).toBe("0.01");
      expect(formatFieldValue("0.014")).toBe("0.01");
    });

    it("should add thousands separators to large integers only", () => {
      expect(formatFieldValue("236977")).toBe("236,977");
      expect(formatFieldValue("2594")).toBe("2594");
      expect(formatFieldValue("2021")).toBe("2021");
    });

    it("should leave identifiers, CURIEs and DOIs untouched", () => {
      expect(formatFieldValue("CL:0002399")).toBe("CL:0002399");
      expect(formatFieldValue("10.1038/s41467-023-40173-5")).toBe("10.1038/s41467-023-40173-5");
      expect(formatFieldValue("2d9f0e25-3e7f-4e4b-86ea-18fda98dc8be")).toBe(
        "2d9f0e25-3e7f-4e4b-86ea-18fda98dc8be",
      );
    });

    it("should join arrays and stringify booleans and objects", () => {
      expect(formatFieldValue(["a", "b"])).toBe("a, b");
      expect(formatFieldValue(true)).toBe("true");
      expect(formatFieldValue({ a: 1 })).toBe('{\n  "a": 1\n}');
    });
  });

  // --- getTitle ---
  describe("getTitle", () => {
    it("should generate title using display_name and the label as getLabel returns it", () => {
      const item = { _id: "nodes_a/1", name: "item one", key: "key_1" };
      expect(getTitle(item)).toBe(`Nodes A: ${getLabel(item)}`);
      expect(getTitle(item)).toBe("Nodes A: item one");
    });

    it("should handle complex labels in title (arrays become comma-separated)", () => {
      const item = { _id: "nodes_b/3", title: ["part 1", "part 2"] };
      expect(getTitle(item)).toBe("Nodes B: part 1,part 2");
    });
  });

  // --- capitalCase ---
  describe("capitalCase", () => {
    it("should capitalize the first letter of each word in a string", () => {
      expect(capitalCase("hello world")).toBe("Hello World");
      expect(capitalCase("singleword")).toBe("Singleword");
      expect(capitalCase("already Capitalized")).toBe("Already Capitalized");
    });

    it("should handle empty strings", () => {
      expect(capitalCase("")).toBe("");
    });

    it("should capitalize words in each string of an array and join with '|'", () => {
      expect(capitalCase(["hello world", "test case"])).toBe("Hello World|Test Case");
      expect(capitalCase(["single"])).toBe("Single");
    });

    it("should handle arrays with non-string elements gracefully", () => {
      expect(capitalCase(["string one", 123, "string two"])).toBe("String One|123|String Two"); // Only strings are modified
    });

    it("should handle empty arrays", () => {
      expect(capitalCase([])).toBe(""); // .join results in empty string
    });

    it("should return non-string, non-array inputs as is", () => {
      expect(capitalCase(null)).toBeNull();
      expect(capitalCase(undefined)).toBeUndefined();
      expect(capitalCase(123)).toBe(123);
      expect(capitalCase({ a: 1 })).toEqual({ a: 1 });
    });
  });
});

// --- applyFieldTransform ---
// The transform config-driven label and URL helpers share. Pinned directly
// because five call sites depend on it behaving identically for all of them.
describe("applyFieldTransform", () => {
  it("rewrites every occurrence, not just the first", () => {
    expect(applyFieldTransform({ to_be_replaced: ":", replace_with: "_" }, "a:b:c")).toBe("a_b_c");
  });

  it("drops the substring when replace_with is absent", () => {
    // The two dialects this replaced disagreed here: one stripped, the other
    // left the value untouched. No shipped config hits this case, so either was
    // defensible; stripping is what the majority of call sites already did.
    expect(applyFieldTransform({ to_be_replaced: ":" }, "CL:0002399")).toBe("CL0002399");
  });

  it("lowercases only when asked", () => {
    expect(applyFieldTransform({ make_lower_case: true }, "MiXeD")).toBe("mixed");
    expect(applyFieldTransform({}, "MiXeD")).toBe("MiXeD");
  });

  it("coerces non-strings before rewriting", () => {
    // getNodeExternalUrl previously called .split() on the raw value, so a
    // numeric field with a rewrite rule threw instead of producing a URL.
    expect(applyFieldTransform({ to_be_replaced: "2", replace_with: "-" }, 12345)).toBe("1-345");
  });
});

// --- getNodeLabel ---
// Characterization tests: this helper deliberately does not share getLabel's
// fallback contract, so the differences are pinned rather than unified.
describe("getNodeLabel", () => {
  it("resolves a label from the collection config", () => {
    expect(getNodeLabel({ name: "Cell A" }, "nodes_a/1")).toBe("Cell A");
  });

  it("accepts a bare collection key as well as a full node id", () => {
    expect(getNodeLabel({ name: "Cell A" }, "nodes_a")).toBe("Cell A");
  });

  it("treats an empty string as absent, unlike getLabel", () => {
    expect(getNodeLabel({ name: "", key: "key_a2" }, "nodes_a/1")).toBe("key_a2");
    expect(getLabel({ _id: "nodes_a/1", name: "", key: "key_a2" })).toBe("NAME UNKNOWN");
  });

  it("falls back to the node id, not to NAME UNKNOWN", () => {
    expect(getNodeLabel({}, "nodes_a/1")).toBe("nodes_a/1");
    expect(getNodeLabel(null, "nodes_a/1")).toBe("nodes_a/1");
    expect(getNodeLabel({}, "nodes_a")).toBe("-");
  });

  it("uses generic node fields when the collection has no label config", () => {
    expect(getNodeLabel({ label: "from label" }, "unmapped/1")).toBe("from label");
    expect(getNodeLabel({ _key: "from key" }, "unmapped/1")).toBe("from key");
  });
});

// --- getNodeExternalUrl ---
describe("getNodeExternalUrl", () => {
  it("builds a URL with the config transform applied", () => {
    expect(getNodeExternalUrl({ key: "ITEM_KEY_1" }, "nodes_a")).toBe("/data/nodes-a/item-key-1");
  });

  it("returns null when the collection has no URL config", () => {
    expect(getNodeExternalUrl({ key: "x" }, "nodes_b")).toBeNull();
  });

  it("returns null when the source field has no value", () => {
    expect(getNodeExternalUrl({}, "nodes_a")).toBeNull();
  });
});

describe("humanizeSlug", () => {
  it("turns an underscore slug into a sentence-cased phrase", () => {
    expect(humanizeSlug("respiratory_system")).toBe("Respiratory system");
  });

  it("collapses the _plus_ connector used by compound structures", () => {
    // "heart_plus_pericardium" is one anatomical structure collection, not two.
    expect(humanizeSlug("heart_plus_pericardium")).toBe("Heart and pericardium");
  });

  it("leaves an already-humanized value alone", () => {
    expect(humanizeSlug("kidney")).toBe("Kidney");
  });

  it("returns non-string input unchanged", () => {
    expect(humanizeSlug(undefined)).toBeUndefined();
    expect(humanizeSlug(42)).toBe(42);
  });
});
