import { fetchNodeExpansion } from "./graph";

jest.mock("./fetchWrapper", () => ({
  ...jest.requireActual("./fetchWrapper"),
  postJson: jest.fn(() => Promise.resolve({})),
}));

import { postJson } from "./fetchWrapper";

beforeEach(() => postJson.mockClear());

describe("fetchNodeExpansion edge filter forwarding", () => {
  it("forwards the provided edge filters instead of an empty object", async () => {
    await fetchNodeExpansion("CL/1", "ontologies", ["CL"], true, {
      Label: ["IS_A"],
    });
    const [, body] = postJson.mock.calls[0];
    expect(body.edge_filters).toEqual({ Label: ["IS_A"] });
    expect(body.node_ids).toEqual(["CL/1"]);
  });

  it("defaults edge filters to an empty object when omitted", async () => {
    await fetchNodeExpansion("CL/1", "ontologies", ["CL"], true);
    const [, body] = postJson.mock.calls[0];
    expect(body.edge_filters).toEqual({});
  });
});
