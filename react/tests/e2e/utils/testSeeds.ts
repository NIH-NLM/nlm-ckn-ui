// Reusable generators for TEST_COLLECTION data used across e2e tests.
// These helpers keep labels deterministic by matching the TEST_COLLECTION mapping.

export type TestDoc = {
  _id: string;
  label?: string;
  value?: number;
  children?: TestDoc[];
};

const DOC_COLL = "TEST_DOCUMENT_COLLECTION";
const EDGE_COLL = "TEST_EDGE_COLLECTION";

export function doc(key: string, label?: string, extra: Partial<TestDoc> = {}): TestDoc {
  return {
    _id: `${DOC_COLL}/${key}`,
    label,
    ...extra,
  };
}

export function sunburstRoot(
  opts: { label?: string; children?: TestDoc[]; value?: number } = {},
): TestDoc {
  const { label = "Root", children = [], value = 1 } = opts;
  return doc("ROOT", label, { value, children });
}

export function simpleChildren(labels: string[]): TestDoc[] {
  return labels.map((l, i) => doc(`CHILD${i + 1}`, l, { value: 1 }));
}

// Create a deeper hierarchy: Root -> A,B with each having two grandchildren
export function deepChildren(): TestDoc[] {
  return [
    doc("A", "A", { value: 1, children: [doc("A1", "A1"), doc("A2", "A2")] }),
    doc("B", "B", { value: 1, children: [doc("B1", "B1"), doc("B2", "B2")] }),
  ];
}

// --- CL hierarchy shape, for /arango_api/hierarchy/ and hierarchy/labels/ ---
// Real payloads carry descendant_count/weight/value/_hasChildren on every
// node, not just id/label/children -- the sunburst and tree both read those
// fields, so a mock missing them isn't representative of the real endpoint.
export type HierarchyNode = {
  _id: string;
  label: string;
  descendant_count: number;
  weight: number;
  value: number;
  _hasChildren: boolean;
  children: HierarchyNode[] | null;
};

const HIERARCHY_COLL = "CL";

export function hierarchyNode(
  key: string,
  label: string,
  opts: { children?: HierarchyNode[] | null; coll?: string } = {},
): HierarchyNode {
  const children = opts.children ?? null;
  const coll = opts.coll ?? HIERARCHY_COLL;
  const descendantCount = (children ?? []).reduce(
    (sum, child) => sum + 1 + child.descendant_count,
    0,
  );
  return {
    _id: `${coll}/${key}`,
    label,
    descendant_count: descendantCount,
    weight: Math.max(1, Math.sqrt(descendantCount)),
    value: Math.max(1, Math.sqrt(descendantCount)),
    _hasChildren: (children ?? []).length > 0,
    children,
  };
}

// Root -> A,B with each having two grandchildren, in the hierarchy shape.
export function hierarchyDeepChildren(coll?: string): HierarchyNode[] {
  return [
    hierarchyNode("A", "A", {
      coll,
      children: [hierarchyNode("A1", "A1", { coll }), hierarchyNode("A2", "A2", { coll })],
    }),
    hierarchyNode("B", "B", {
      coll,
      children: [hierarchyNode("B1", "B1", { coll }), hierarchyNode("B2", "B2", { coll })],
    }),
  ];
}

export function hierarchyRoot(
  opts: { label?: string; children?: HierarchyNode[]; coll?: string } = {},
): HierarchyNode {
  const { label = "cell", children = [], coll } = opts;
  return hierarchyNode("0000000", label, { children, coll });
}

export const hierarchyLabelsResponse = [
  { label: "SUB_CLASS_OF", root: "CL/0000000", edge_count: 4664 },
];

// Arango-style edge document
export type TestEdge = {
  _id: string;
  _key: string;
  _from: string;
  _to: string;
  Label?: string;
};

export function edge(key: string, fromDocId: string, toDocId: string, label = "related"): TestEdge {
  return {
    _id: `${EDGE_COLL}/${key}`,
    _key: key,
    _from: fromDocId,
    _to: toDocId,
    Label: label,
  };
}

export function edgeWithSource(
  key: string,
  fromDocId: string,
  toDocId: string,
  label: string,
  source: string,
): TestEdge & { Source: string } {
  return {
    ...edge(key, fromDocId, toDocId, label),
    Source: source,
  };
}

// Build a small connected graph with documents and edges
export function smallGraphWithEdges() {
  const r = doc("ROOT", "Root");
  const [c1, c2] = simpleChildren(["Child One", "Child Two"]);
  const g1 = doc("GC1", "Grandchild One");
  const g2 = doc("GC2", "Grandchild Two");
  r.children = [c1, c2];
  c1.children = [g1];
  c2.children = [g2];

  const e1 = edge("E1", r._id, c1._id, "has_child");
  const e2 = edge("E2", r._id, c2._id, "has_child");
  const e3 = edge("E3", c1._id, g1._id, "has_child");
  const e4 = edge("E4", c2._id, g2._id, "has_child");
  return { root: r, edges: [e1, e2, e3, e4] };
}

// Another test collection id to exercise allowedCollections filter behavior
export const OTHER_COLL = "OTHER_TEST_COLLECTION";

export type RawGraph = { nodes: TestDoc[]; links: TestEdge[] };

// Build two raw graphs keyed by two origin ids with partial overlap:
// Shared nodes: ROOT, MID. Unique nodes: Y only in first, Z only in second.
export function twoOriginRawGraphs(originA: string, originB: string) {
  const r = doc("ROOT", "Root");
  const mid = doc("MID", "Mid");
  const c1 = doc("C1", "C1");
  const y = doc("Y", "Y");
  const z = doc("Z", "Z");
  const e_rm = edge("E_RM", r._id, mid._id, "has_child");
  const e_mc1 = edge("E_MC1", mid._id, c1._id, "has_child");
  const e_ry = edge("E_RY", r._id, y._id, "has_child");
  const e_c1z = edge("E_C1Z", c1._id, z._id, "has_child");

  const graphA: RawGraph = { nodes: [r, mid, c1, y], links: [e_rm, e_mc1, e_ry] };
  const graphB: RawGraph = { nodes: [r, mid, c1, z], links: [e_rm, e_mc1, e_c1z] };

  return {
    [originA]: graphA,
    [originB]: graphB,
  } as Record<string, RawGraph>;
}

// Build a simple shortest-path-shaped graph: A -> B -> C
export function shortestPathGraph(originA: string, originB: string) {
  // Dynamic origins with a mid path node to mimic backend shortest path response
  const a: TestDoc = { _id: originA, label: originA.split("/")[1] };
  const mid = doc("MID_PATH", "MID_PATH");
  const b: TestDoc = { _id: originB, label: originB.split("/")[1] };
  const e_ab = edge("PATH1", a._id, mid._id, "path");
  const e_mb = edge("PATH2", mid._id, b._id, "path");
  return { nodes: [a, mid, b], links: [e_ab, e_mb] };
}
