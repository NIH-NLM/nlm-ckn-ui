// Reusable generators for TEST_COLLECTION data used across e2e tests.
// These helpers keep labels deterministic by matching the TEST_COLLECTION mapping.

export type TestDoc = {
    _id: string;
    label?: string;
    value?: number;
    children?: TestDoc[];
};

const DOC_COLL = 'TEST_DOCUMENT_COLLECTION';
const EDGE_COLL = 'TEST_EDGE_COLLECTION';

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
    const { label = 'Root', children = [], value = 1 } = opts;
    return doc('ROOT', label, { value, children });
}

export function treeApiWrapper(root: TestDoc): TestDoc {
    // Tree component uses data.children[0] as root; wrap to mimic API
    return {
        _id: 'WRAP/0',
        label: 'Wrapper',
        children: [root],
    };
}

export function simpleChildren(labels: string[]): TestDoc[] {
    return labels.map((l, i) => doc(`CHILD${i + 1}`, l, { value: 1 }));
}

// Create a deeper hierarchy: Root -> A,B with each having two grandchildren
export function deepChildren(): TestDoc[] {
    return [
        doc('A', 'A', { value: 1, children: [doc('A1', 'A1'), doc('A2', 'A2')] }),
        doc('B', 'B', { value: 1, children: [doc('B1', 'B1'), doc('B2', 'B2')] }),
    ];
}

// Arango-style edge document
export type TestEdge = {
    _id: string;
    _from: string;
    _to: string;
    Label?: string;
};

export function edge(key: string, fromDocId: string, toDocId: string, label = 'related'): TestEdge {
    return {
        _id: `${EDGE_COLL}/${key}`,
        _from: fromDocId,
        _to: toDocId,
        Label: label,
    };
}

// Build a small connected graph with documents and edges
export function smallGraphWithEdges() {
    const r = doc('ROOT', 'Root');
    const [c1, c2] = simpleChildren(['Child One', 'Child Two']);
    const g1 = doc('GC1', 'Grandchild One');
    const g2 = doc('GC2', 'Grandchild Two');
    r.children = [c1, c2];
    c1.children = [g1];
    c2.children = [g2];

    const e1 = edge('E1', r._id, c1._id, 'has_child');
    const e2 = edge('E2', r._id, c2._id, 'has_child');
    const e3 = edge('E3', c1._id, g1._id, 'has_child');
    const e4 = edge('E4', c2._id, g2._id, 'has_child');
    return { root: r, edges: [e1, e2, e3, e4] };
}
