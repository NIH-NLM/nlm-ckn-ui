import {
  fetchCollections,
  hasAnyNodes,
  parseCollections,
  getLabel,
  getUrl,
  getTitle,
  capitalCase,
} from "./Utils";

// --- Mocking ---

// Mock the collectionsMapData import
jest.mock(
  "../../assets/cell-kn-mvp-collection-maps.json",
  () => [
    [
      "nodes_a",
      {
        display_name: "Nodes A",
        individual_labels: ["name", "key"],
        individual_url: "/data/nodes-a/<FIELD_TO_USE>",
        field_to_use: "key",
        to_be_replaced: "_",
        replace_with: "-",
        make_lower_case: true,
      },
    ],
    [
      "nodes_b",
      {
        display_name: "Nodes B",
        individual_labels: ["title"],
      },
    ],
    [
      "edges",
      {
        // Mock default edge config
        display_name: "Relationships",
        individual_labels: ["label"],
      },
    ],
    [
      "nodes_c",
      {
        individual_labels: ["description"],
      },
    ],
  ],
  { virtual: true },
);

// Mock the global fetch function
global.fetch = jest.fn();

// Helper to reset mocks before each test
beforeEach(() => {
  fetch.mockClear();
});

// --- Tests ---

describe("Utils Module", () => {
  // --- fetchCollections ---
  describe("fetchCollections", () => {
    it("should fetch collections successfully", async () => {
      const mockData = { collections: ["col1", "col2"] };
      const graphType = "myGraph";

      // Configure the mock fetch response for success
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      });

      const result = await fetchCollections(graphType);

      // Check if fetch was called correctly
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith("/arango_api/collections/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph: graphType }),
      });

      // Check if the result is the expected data
      expect(result).toEqual(mockData);
    });

    it("should throw an error if fetch fails", async () => {
      const graphType = "myGraph";
      const errorStatus = 500;
      const errorText = "Server Error";

      // Configure the mock fetch response for failure
      fetch.mockResolvedValueOnce({
        ok: false,
        status: errorStatus,
        text: async () => errorText, // Mock the .text() method for error logging
      });

      // Spy on console.error to ensure it's called
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Assert that the function call rejects with the expected error
      await expect(fetchCollections(graphType)).rejects.toThrow(
        `Network response was not ok (${errorStatus})`,
      );

      // Check if fetch was called
      expect(fetch).toHaveBeenCalledTimes(1);
      // Check if console.error was called
      expect(consoleSpy).toHaveBeenCalledWith(
        "Fetch collections failed:",
        errorStatus,
        errorText,
      );

      // Restore console.error spy
      consoleSpy.mockRestore();
    });
  });

  // --- hasAnyNodes ---
  describe("hasAnyNodes", () => {
    const nodeId = "nodes_a/123";
    it("should return false for null or undefined data", () => {
      expect(hasAnyNodes(null, nodeId)).toBe(false);
      expect(hasAnyNodes(undefined, nodeId)).toBe(false);
    });

    it("should return false if data is not an object", () => {
      expect(hasAnyNodes("string", nodeId)).toBe(false);
      expect(hasAnyNodes(123, nodeId)).toBe(false);
    });

    it("should return false if data.nodes is missing or not an object", () => {
      expect(hasAnyNodes({}, nodeId)).toBe(false);
      expect(hasAnyNodes({ nodes: null }, nodeId)).toBe(false);
      expect(hasAnyNodes({ nodes: "string" }, nodeId)).toBe(false);
    });

    it("should return false if the specific nodeId key is missing in data.nodes", () => {
      expect(hasAnyNodes({ nodes: { "other_nodes/456": [] } }, nodeId)).toBe(
        false,
      );
    });

    it("should return false if the value for nodeId is not an array", () => {
      expect(hasAnyNodes({ nodes: { [nodeId]: null } }, nodeId)).toBe(false);
      expect(hasAnyNodes({ nodes: { [nodeId]: {} } }, nodeId)).toBe(false);
      expect(hasAnyNodes({ nodes: { [nodeId]: "string" } }, nodeId)).toBe(
        false,
      );
    });

    it("should return false for an empty array", () => {
      expect(hasAnyNodes({ nodes: { [nodeId]: [] } }, nodeId)).toBe(false);
    });

    it("should return false if array entries are null or not objects", () => {
      expect(
        hasAnyNodes({ nodes: { [nodeId]: [null, undefined] } }, nodeId),
      ).toBe(false);
      expect(hasAnyNodes({ nodes: { [nodeId]: [1, "a"] } }, nodeId)).toBe(
        false,
      );
    });

    it("should return false if array entries lack a 'node' property", () => {
      expect(
        hasAnyNodes({ nodes: { [nodeId]: [{ id: 1 }, {}] } }, nodeId),
      ).toBe(false);
    });

    it("should return false if all 'node' properties are null", () => {
      expect(
        hasAnyNodes(
          { nodes: { [nodeId]: [{ node: null }, { node: null }] } },
          nodeId,
        ),
      ).toBe(false);
    });

    it("should return true if at least one entry has a non-null 'node' property", () => {
      expect(hasAnyNodes({ nodes: { [nodeId]: [{ node: {} }] } }, nodeId)).toBe(
        true,
      );
      expect(
        hasAnyNodes(
          { nodes: { [nodeId]: [{ node: null }, { node: { id: 1 } }] } },
          nodeId,
        ),
      ).toBe(true);
      expect(
        hasAnyNodes({ nodes: { [nodeId]: [{ node: "some_value" }] } }, nodeId),
      ).toBe(true);
      expect(hasAnyNodes({ nodes: { [nodeId]: [{ node: 0 }] } }, nodeId)).toBe(
        true,
      ); // 0 is not null
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
      const collectionsMap = new Map(
        require("../../assets/cell-kn-mvp-collection-maps.json"),
      );
      const input = ["nodes_b", "nodes_a"]; // Based on mock display names: Nodes B, Nodes A
      const expected = ["nodes_a", "nodes_b"]; // Sorted: Nodes A, Nodes B
      expect(parseCollections(input, collectionsMap)).toEqual(expected);
    });

    it("should fallback to collection key for sorting if display_name is missing", () => {
      const collectionsMap = new Map(
        require("../../assets/cell-kn-mvp-collection-maps.json"),
      );
      // nodes_c has no display_name in mock, nodes_a has "Nodes A"
      const input = ["nodes_c", "nodes_a"];
      // Expected: nodes_a ("Nodes A"), nodes_c (key)
      const expected = ["nodes_a", "nodes_c"];
      expect(parseCollections(input, collectionsMap)).toEqual(expected);
    });

    it("should fallback to collection key for sorting if collection not in map", () => {
      const collectionsMap = new Map(
        require("../../assets/cell-kn-mvp-collection-maps.json"),
      );
      // nodes_x not in mock map, nodes_a has "Nodes A"
      const input = ["nodes_x", "nodes_a"];
      // Expected: nodes_a ("Nodes A"), nodes_x (key)
      const expected = ["nodes_a", "nodes_x"];
      expect(parseCollections(input, collectionsMap)).toEqual(expected);
    });

    it("should handle mixed cases with and without map entries", () => {
      const collectionsMap = new Map(
        require("../../assets/cell-kn-mvp-collection-maps.json"),
      );
      // nodes_a: "Nodes A", nodes_b: "Nodes B", nodes_c: no display, nodes_x: no entry
      const input = ["nodes_x", "nodes_c", "nodes_b", "nodes_a"];
      const expected = ["nodes_a", "nodes_b", "nodes_c", "nodes_x"];
      expect(parseCollections(input, collectionsMap)).toEqual(expected);
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

    it("should handle label values that are arrays by joining with ' | '", () => {
      const item = { _id: "nodes_b/3", title: ["Part 1", "Part 2"] };
      expect(getLabel(item)).toBe("Part 1 | Part 2");
    });

    it("should handle numeric labels", () => {
      const item = { _id: "nodes_a/4", key: 12345 }; // 'name' is missing
      expect(getLabel(item)).toBe("12345");
    });

    it("should return undefined string if no label options are found", () => {
      const item = { _id: "nodes_a/5", other_prop: "value" }; // neither 'name' nor 'key' exist
      expect(getLabel(item)).toBeUndefined();
    });
  });

  // --- getUrl ---
  describe("getUrl", () => {
    it("should generate the correct URL with replacement and lowercasing", () => {
      const item = { _id: "nodes_a/1", key: "Item_Key_1" };
      expect(getUrl(item)).toBe("/data/nodes-a/item-key-1");
    });

    it("should throw if config has no url", () => {
      const item = { _id: "nodes_b/1", title: "Test Title" }; // nodes_b has no URL config in mock
      expect(() => getUrl(item)).toThrow();
    });
  });

  // --- getTitle ---
  describe("getTitle", () => {
    it("should generate title using display_name and capitalized label", () => {
      const item = { _id: "nodes_a/1", name: "item one", key: "key_1" };
      expect(getTitle(item)).toBe("Nodes A: Item One");
    });

    it("should handle complex labels in title", () => {
      const item = { _id: "nodes_b/3", title: ["part 1", "part 2"] };
      expect(getTitle(item)).toBe("Nodes B: Part 1 | Part 2");
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
      expect(capitalCase(["hello world", "test case"])).toBe(
        "Hello World|Test Case",
      );
      expect(capitalCase(["single"])).toBe("Single");
    });

    it("should handle arrays with non-string elements gracefully", () => {
      expect(capitalCase(["string one", 123, "string two"])).toBe(
        "String One|123|String Two",
      ); // Only strings are modified
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
