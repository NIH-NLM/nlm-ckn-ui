import ErrorBoundary from "../../components/ErrorBoundary";
import Sunburst from "../../components/Sunburst/Sunburst";

const SunburstPage = () => {
  return (
    <div className="visualization-page-layout">
      <div className="visualization-content-box">
        <h1 className="page-title">Browse the Database</h1>
        <div className="sunburst-visualization-container">
          <ErrorBoundary>
            <Sunburst />
          </ErrorBoundary>
        </div>
        <p className="visualization-description">
          This sunburst chart visualizes the structure and distribution of data entities within this
          database. Each arc represents a vertex with its size proportional to the number of
          downstream vertices.
        </p>
      </div>
    </div>
  );
};

export default SunburstPage;
