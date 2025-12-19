import ErrorBoundary from "components/ErrorBoundary";
import Tree from "components/Tree";

const TreePage = () => {
  return (
    <div className="visualization-page-layout">
      <div className="visualization-content-box">
        <h1 className="page-title">Explore the Tree</h1>
        <div className="sunburst-visualization-container">
          <ErrorBoundary>
            <Tree />
          </ErrorBoundary>
        </div>
        <p className="visualization-description">
          This interactive tree visualizes the structure and distribution of data entities within
          this database. Click on a vertex to expand or collapse connections.
        </p>
      </div>
    </div>
  );
};

export default TreePage;
