import React, { useEffect, useState, useContext, useMemo } from "react";
import { useParams } from "react-router-dom";
import DocumentCard from "../../components/DocumentCard/DocumentCard";
import ForceGraph from "../../components/ForceGraph/ForceGraph";
import { PrunedCollectionsContext } from "../../contexts/PrunedCollectionsContext";
import {
  findFtuUrlById,
  getTitle,
  parseId,
} from "../../components/Utils/Utils";
import FTUIllustration from "../../components/FTUIllustration/FTUIllustration";
import { useFtuParts } from "../../contexts/FTUPartsContext";
import { initializeGraph } from "../../store/graphSlice";
import { useDispatch } from "react-redux";

const DocumentPage = () => {
  const dispatch = useDispatch();
  const { coll, id } = useParams();
  const [document, setDocument] = useState(null);
  const [nodeIds, setNodeIds] = useState(null);
  const [isPanelVisible, setIsPanelVisible] = useState(true);

  const prunedCollections = useContext(PrunedCollectionsContext);
  const { ftuParts, ftuPartsIsLoading, ftuPartsError } = useFtuParts();

  const filteredPrunedCollections = prunedCollections.includes(coll)
    ? prunedCollections.filter((item) => item !== coll)
    : prunedCollections;

  useEffect(() => {
    const getDocument = async () => {
      try {
        const response = await fetch(`/arango_api/collection/${coll}/${id}/`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setDocument(data);
        setNodeIds(parseId(data));
        dispatch(initializeGraph({ nodeIds: parseId(data) }));
      } catch (error) {
        console.error("Failed to fetch document:", error);

        setDocument(null);
      }
    };

    if (id && coll) {
      setDocument(null);
      getDocument();
    }
  }, [id, coll]);

  const ftuIllustrationUrl = useMemo(() => {
    if (!document || !ftuParts || ftuParts.length === 0) {
      return null;
    }
    const ftuUrl = findFtuUrlById(ftuParts, coll + "_" + id);
    console.log(ftuUrl);
    return ftuUrl;
  }, [document, ftuParts, id]);

  const forceGraphSettings = useMemo(
    () => ({
      collectionsToPrune: filteredPrunedCollections,
      defaultDepth: nodeIds ? (nodeIds.length > 1 ? 0 : 2) : 2,
    }),
    [filteredPrunedCollections, nodeIds],
  );

  const isLoading = !document && id && coll;

  if (isLoading) {
    return (
      <div className="content-page-layout">
        {" "}
        <div className="loading-message">Loading document details...</div>{" "}
      </div>
    );
  }

  if (!document) {
    return (
      <div className="content-page-layout">
        <div className="error-message">
          Document not found or failed to load. Please check the URL or try
          again.
        </div>
      </div>
    );
  }

  // Document is loaded
  return (
    <div className="content-page-layout document-details-page-layout">
      <div className="content-box document-details-content-box">
        <div className="document-item-header">
          <button
            onClick={() => setIsPanelVisible(!isPanelVisible)}
            className={"toggle-options-button"}
            style={{ position: "static" }}
          >
            {isPanelVisible ? "<" : ">"}
          </button>
          <h1>{getTitle(document)}</h1>
          {document.term && <span>Term: {document.term}</span>}{" "}
        </div>
        <div className="document-page-main-content-area">
          <div
            className={`document-card-panel ${isPanelVisible ? "" : "hidden"}`}
          >
            <DocumentCard document={document} />
            {ftuIllustrationUrl && (
              <FTUIllustration
                selectedIllustration={ftuIllustrationUrl}
                illustrations={
                  "https://cdn.humanatlas.io/digital-objects/graph/2d-ftu-illustrations/latest/assets/2d-ftu-illustrations.jsonld"
                }
              />
            )}
          </div>
          <div
            className={`force-graph-panel ${isPanelVisible ? "" : "flex-full"}`}
          >
            <ForceGraph nodeIds={nodeIds} settings={forceGraphSettings} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentPage;
