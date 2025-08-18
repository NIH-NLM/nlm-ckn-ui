import { useContext, useState, useRef, useEffect } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import SearchBar from "../../components/SearchBar/SearchBar";
import ForceGraph from "../../components/ForceGraph/ForceGraph";
import { PrunedCollectionsContext } from "../../contexts/PrunedCollectionsContext";

const SearchPage = () => {
  // Read the origin node IDs directly from the Redux cart slice.
  const cartNodeIds = useSelector((state) => state.cart.originNodeIds);
  const prunedCollections = useContext(PrunedCollectionsContext);
  const graphDisplayAreaRef = useRef(null);

  // Local state to control the visibility of the graph component.
  const [showGraph, setShowGraph] = useState(false);

  // Effect to scroll to the graph area after the "Generate Graph" button is clicked.
  useEffect(() => {
    if (showGraph && graphDisplayAreaRef.current) {
      graphDisplayAreaRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [showGraph]);

  return (
    <div className="search-page-layout">
      <div className="main-search-box">
        <h1 className="search-page-title">Search the Knowledge Network</h1>
        <div className="search-bar-wrapper">
          <SearchBar onGenerateGraph={() => setShowGraph(true)} />
        </div>
      </div>

      <div className="about-section-container">
        <h2 className="about-title">About NCKN</h2>
        <p>
          The National Library of Medicine (NLM) Cell Knowledge Network is a
          knowledgebase focused on cell characteristics (phenotypes) derived
          from single-cell technologies. It integrates this information with
          data from reference ontologies, NCBI resources, and text mining
          efforts.
        </p>
        <p>
          The network is structured as a knowledge graph of biomedical entities
          (nodes) and their relationships (edges). This graph links experimental
          single-cell genomics data to the reference Cell Ontology, providing
          evidence for assertions and integrating information about cells,
          tissues, biomarkers, pathways, drugs, and diseases.
        </p>
        <p>
          Use the search bar above to find and explore entities within this
          network. Selected items can be used to generate interactive graphs
          visualizing their connections.
          <Link to="/about" className="learn-more-link internal-learn-more">
            Learn more...
          </Link>
        </p>
      </div>

      {showGraph && cartNodeIds.length > 0 && (
        <div className="graph-display-area" ref={graphDisplayAreaRef}>
          <ForceGraph
            settings={{
              defaultDepth: 1,
              findShortestPaths: false,
              collectionsToPrune: prunedCollections,
            }}
          />
        </div>
      )}
    </div>
  );
};

export default SearchPage;