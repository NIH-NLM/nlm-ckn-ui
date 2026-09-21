import Browse from "components/Browse";
import ErrorBoundary from "components/ErrorBoundary";

const BrowsePage = () => {
  return (
    <div className="visualization-page-layout">
      <div className="visualization-content-box">
        <h1 className="page-title">Browse the Database</h1>
        <div className="sunburst-visualization-container">
          <ErrorBoundary>
            <Browse />
          </ErrorBoundary>
        </div>
        <p className="visualization-description">
          This visualization shows the structure and distribution of data entities within this
          database, as a sunburst chart or a collapsible tree. Click on a node to expand or center
          on it.
        </p>
      </div>
    </div>
  );
};

export default BrowsePage;
