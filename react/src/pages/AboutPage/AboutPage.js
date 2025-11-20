import schemaImage from "../../assets/schema.png";

const AboutPage = () => {
  return (
    <div className="content-page-layout about-page-specific-layout">
      <div className="content-box about-content-box">
        <h1 className="content-page-title">About the NLM Cell Knowledge Network</h1>

        <div className="about-text-section">
          <p>
            The National Library of Medicine (NLM) Cell Knowledge Network is a knowledgebase about
            cell characteristics (phenotypes) emerging from single cell technologies, integrated
            with other sources of trusted knowledge, sourced from:
          </p>
          <ul className="about-sources-list">
            <li>Validated data processing and analysis pipelines</li>
            <li>Reference ontologies</li>
            <li>NCBI and other information resources</li>
            <li>LLM-based text mining</li>
          </ul>
          <p>
            A knowledge graph is produced from triple assertions (subject-predicate-object)
            corresponding to biomedical entities (nodes) and their relations (edges), and links
            experimental data to the reference Cell Ontology as evidence in support of assertions.
            The graph integrates single cell genomics experimental data with other information
            sources about cells, tissues, biomarkers, pathways, drugs, diseases.
          </p>
        </div>

        <hr className="section-divider" />

        <div className="schema-section">
          <h2 className="section-subtitle">Database Schema Overview</h2>
          <div className="image-container schema-image-container">
            <img
              src={schemaImage}
              alt="Database Schema Diagram"
              className="responsive-image schema-image-actual"
            />
          </div>
          <p className="image-caption">
            This diagram illustrates the relationships between different data collections and
            entities within this database.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
