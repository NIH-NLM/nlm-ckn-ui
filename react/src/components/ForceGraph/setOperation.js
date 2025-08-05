export function performSetOperation(data, operation, originNodeIds) {
  if (!data || !data.nodes) {
    console.warn("performSetOperation called with invalid data:", data);
    return { nodes: [], links: [] };
  }

  const nodes = data.nodes;
  const links = data.links || [];

  const getAllNodeIdsFromOrigins = (operation) => {
    if (typeof nodes !== "object" || nodes === null) return new Set();

    const nodeIdsPerOrigin = Object.values(nodes).map((originGroup) => {
      if (!Array.isArray(originGroup)) return new Set();
      return new Set(
        originGroup
          .filter((item) => item && item.node && item.node._id)
          .map((item) => item.node._id),
      );
    });

    if (nodeIdsPerOrigin.length === 0) return new Set();

    if (operation === "Intersection") {
      if (nodeIdsPerOrigin.length < 2)
        return new Set(nodeIdsPerOrigin[0] || []);

      let intersectionResult = new Set(nodeIdsPerOrigin[0]);
      for (let i = 1; i < nodeIdsPerOrigin.length; i++) {
        intersectionResult = new Set(
          [...intersectionResult].filter((id) => nodeIdsPerOrigin[i].has(id)),
        );
      }
      return intersectionResult;
    } else if (operation === "Union") {
      return new Set(nodeIdsPerOrigin.flatMap((nodeIdsSet) => [...nodeIdsSet]));
    } else if (operation === "Symmetric Difference") {
      if (nodeIdsPerOrigin.length < 2)
        return new Set(nodeIdsPerOrigin[0] || []);

      let result = new Set(nodeIdsPerOrigin[0]);
      for (let i = 1; i < nodeIdsPerOrigin.length; i++) {
        const currentSet = nodeIdsPerOrigin[i];
        const nextResult = new Set();
        result.forEach((id) => {
          if (!currentSet.has(id)) nextResult.add(id);
        });
        currentSet.forEach((id) => {
          if (!result.has(id)) nextResult.add(id);
        });
        result = nextResult;
      }
      return result;
    }

    console.error("Unknown set operation:", operation);
    return new Set();
  };

  const addNodesFromPathsToSet = (nodeIdsSet) => {
    // This function needs to be adapted or removed if `findShortestPaths` logic changes
    if (typeof nodes !== "object" || nodes === null) return;

    Object.values(nodes).forEach((originGroup) => {
      if (!Array.isArray(originGroup)) return;

      originGroup.forEach((item) => {
        if (
          item?.node?._id &&
          item?.path?.vertices &&
          nodeIdsSet.has(item.node._id)
        ) {
          item.path.vertices.forEach((vertex) => {
            if (vertex?._id) nodeIdsSet.add(vertex._id);
          });
        }
      });
    });
  };

  let finalNodeIdSet = getAllNodeIdsFromOrigins(operation);
  // You might need to pass `findShortestPaths` in as an argument if you keep this logic
  // if (!findShortestPaths) {
  //   addNodesFromPathsToSet(finalNodeIdSet);
  // }

  const seenLinks = new Set();
  const filteredLinks = links.filter((link) => {
    if (!link?._from || !link?._to) return false;

    if (finalNodeIdSet.has(link._from) && finalNodeIdSet.has(link._to)) {
      const linkKey = `${link._from}-${link._to}`;
      if (seenLinks.has(linkKey)) return false;

      seenLinks.add(linkKey);
      return true;
    }
    return false;
  });

  const nodeIdsInLinks = new Set();
  filteredLinks.forEach((link) => {
    nodeIdsInLinks.add(link._from);
    nodeIdsInLinks.add(link._to);
  });

  // We must ensure the origin nodes are always included, even if they are isolates
  originNodeIds.forEach((id) => nodeIdsInLinks.add(id));

  const addedNodeIds = new Set();
  const filteredNodes = [];
  if (typeof nodes === "object" && nodes !== null) {
    Object.values(nodes).forEach((originGroup) => {
      if (Array.isArray(originGroup)) {
        originGroup.forEach((item) => {
          if (
            item?.node?._id &&
            nodeIdsInLinks.has(item.node._id) &&
            !addedNodeIds.has(item.node._id)
          ) {
            filteredNodes.push(item.node);
            addedNodeIds.add(item.node._id);
          }
        });
      }
    });
  }

  return {
    nodes: filteredNodes,
    links: filteredLinks,
  };
}
