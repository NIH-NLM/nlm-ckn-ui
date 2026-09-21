// Path-keying helper shared by the tree and its D3 constructor.
//
// The CL hierarchy is a DAG -- 1,148 cell types have more than one parent --
// so a bare node `_id` can appear at many positions and cannot identify one
// occurrence. A root-to-node id path can. `TreeConstructor` and `Tree` must
// produce byte-identical keys for the same path, or expansion silently stops
// matching with no error, so both import this single implementation rather
// than keeping their own copies in sync by hand.
export const pathKey = (path) => JSON.stringify(path);
