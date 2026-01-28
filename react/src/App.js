import { Route, HashRouter as Router, Routes } from "react-router-dom";

// Import consolidated stylesheet entry point so ordering stays consistent
import "./styles/index.css";

import Footer from "./components/Footer/Footer";
import Header from "./components/Header/Header";
import { ActiveNavProvider, FtuPartsProvider, GraphProvider } from "./contexts";
import AboutPage from "./pages/AboutPage/AboutPage";
import CollectionsPage from "./pages/CollectionsPage/CollectionsPage";
import DocumentPage from "./pages/DocumentPage/DocumentPage";
import FTUExplorerPage from "./pages/FTUExplorerPage/FTUExplorerPage";
import GraphPage from "./pages/GraphPage/GraphPage";
import NotFoundPage from "./pages/NotFoundPage/NotFoundPage";
import SearchPage from "./pages/SearchPage/SearchPage";
import SunburstPage from "./pages/SunburstPage/SunburstPage";
import TreePage from "./pages/TreePage/TreePage";
import WorkflowBuilderPage from "./pages/WorkflowBuilderPage/WorkflowBuilderPage";

function App() {
  return (
    <Router>
      <ActiveNavProvider>
        <GraphProvider>
          <FtuPartsProvider>
            <div className="site-container background-color-white">
              <Header />
              <div className="app">
                <Routes>
                  <Route path="/collections/:coll/:id" element={<DocumentPage />} />
                  <Route path="/collections/:coll" element={<CollectionsPage />} />
                  <Route path="/collections" element={<CollectionsPage />} />
                  <Route path="/graph" element={<GraphPage />} />
                  <Route path="/workflow-builder" element={<WorkflowBuilderPage />} />
                  <Route path="/ftu" element={<FTUExplorerPage />} />
                  <Route path="/about" element={<AboutPage />} />
                  <Route path="/tree" element={<TreePage />} />
                  <Route path="/sunburst" element={<SunburstPage />} />
                  <Route path="/" element={<SearchPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </div>
              <Footer />
            </div>
          </FtuPartsProvider>
        </GraphProvider>
      </ActiveNavProvider>
    </Router>
  );
}

export default App;
