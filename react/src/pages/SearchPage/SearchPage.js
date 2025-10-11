import React from "react";
import { Link } from "react-router-dom";
import SearchBar from "../../components/SearchBar/SearchBar";

const SearchPage = () => {
  return (
    <div className="search-page-layout">
      <div className="main-search-box">
        <h1 className="search-page-title">Search the Knowledge Network</h1>
        <div className="search-bar-wrapper">
          <SearchBar />
        </div>
      </div>

      <div className="about-section-container">
        <h2 className="about-title">About NCKN</h2>
        <p>
          The National Library of Medicine (NLM) Cell Knowledge Network is a knowledgebase focused
          on cell characteristics (phenotypes) derived from single-cell technologies. It integrates
          this information with data from reference ontologies, NCBI resources, and text mining
          efforts.
        </p>
        <p>
          The network is structured as a knowledge graph of biomedical entities (nodes) and their
          relationships (edges). This graph links experimental single-cell genomics data to the
          reference Cell Ontology, providing evidence for assertions and integrating information
          about cells, tissues, biomarkers, pathways, drugs, and diseases.
        </p>
        <p>
          Use the search bar above to find and explore entities within this network. You can add
          items to your graph or navigate to their specific pages.
          <Link to="/about" className="learn-more-link internal-learn-more">
            Learn more...
          </Link>
        </p>
      </div>
    </div>
  );
};

export default SearchPage;
