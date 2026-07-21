import collectionDefaults from "assets/collection-defaults.json";
import Breadcrumbs from "components/Breadcrumbs";
import FTUIllustration from "components/FTUIllustration";
import GraphWorkspace from "components/GraphWorkspace";
import { FTU_ILLUSTRATIONS_JSONLD_URL } from "constants/index";
import { useFtuParts } from "contexts";
import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { useParams } from "react-router-dom";
import { fetchDocument } from "services";
import { initializeGraph } from "store";
import { findFtuUrlById, getTitle, parseId } from "utils";

const DocumentPage = () => {
  const dispatch = useDispatch();
  const { coll, id } = useParams();
  const [document, setDocument] = useState(null);
  const [nodeIds, setNodeIds] = useState(null);

  const { ftuParts } = useFtuParts();

  useEffect(() => {
    let cancelled = false;
    const getDocumentData = async () => {
      try {
        const data = await fetchDocument(coll, id);
        if (cancelled) return;
        setDocument(data);
        setNodeIds(parseId(data));
        dispatch(initializeGraph({ nodeIds: parseId(data) }));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch document:", error);
          setDocument(null);
        }
      }
    };

    if (id && coll) {
      setDocument(null);
      getDocumentData();
    }
    return () => {
      cancelled = true;
    };
  }, [id, coll, dispatch]);

  const ftuIllustrationUrl = useMemo(() => {
    if (!document || !ftuParts || ftuParts.length === 0) {
      return null;
    }
    const ftuUrl = findFtuUrlById(ftuParts, `${coll}_${id}`);
    return ftuUrl;
  }, [document, ftuParts, id, coll]);

  const forceGraphSettings = useMemo(() => {
    // Use collection-specific defaults, falling back to _defaults for unknown collections
    const collectionConfig = collectionDefaults[coll] || collectionDefaults._defaults || {};

    // Start with the resolved defaults
    const base = { ...collectionConfig };

    // If multiple origin nodes, prefer shallower depth unless explicitly set in defaults
    if (nodeIds && nodeIds.length > 1 && typeof base.depth !== "number") {
      base.depth = 0;
    }

    // Always use phenotypes graph
    base.graphType = "phenotypes";

    return base;
  }, [coll, nodeIds]);

  const isLoading = !document && id && coll;

  if (isLoading) {
    return (
      <div className="content-page-layout">
        <Breadcrumbs
          crumbs={[
            { label: "Collections", path: "/collections" },
            { label: id, path: "" },
          ]}
        />
        <div className="loading-message">Loading document details...</div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="content-page-layout">
        <Breadcrumbs
          crumbs={[
            { label: "Collections", path: "/collections" },
            { label: id, path: "" },
          ]}
        />
        <div className="error-message">
          Document not found or failed to load. Please check the URL or try again.
        </div>
      </div>
    );
  }

  // Document is loaded
  return (
    <div className="content-page-layout document-details-page-layout">
      <div className="content-box document-details-content-box">
        <Breadcrumbs
          crumbs={[
            { label: "Collections", path: "/collections" },
            { label: getTitle(document), path: "" },
          ]}
        />
        <div className="document-item-header">
          <h1>{getTitle(document)}</h1>
          {document.term && <span>Term: {document.term}</span>}{" "}
        </div>
        {ftuIllustrationUrl && (
          <FTUIllustration
            selectedIllustration={ftuIllustrationUrl}
            illustrations={FTU_ILLUSTRATIONS_JSONLD_URL}
          />
        )}
        <div className="document-page-main-content-area">
          <GraphWorkspace
            originDocument={document}
            nodeIds={nodeIds}
            settings={forceGraphSettings}
          />
        </div>
      </div>
    </div>
  );
};

export default DocumentPage;
