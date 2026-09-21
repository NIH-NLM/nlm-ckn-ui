import { Navigate, Route, Routes } from "react-router-dom";
import AboutPage from "./pages/AboutPage/AboutPage";
import BrowsePage from "./pages/BrowsePage/BrowsePage";
import CollectionsPage from "./pages/CollectionsPage/CollectionsPage";
import DocumentPage from "./pages/DocumentPage/DocumentPage";
import FTUExplorerPage from "./pages/FTUExplorerPage/FTUExplorerPage";
import GraphPage from "./pages/GraphPage/GraphPage";
import NotFoundPage from "./pages/NotFoundPage/NotFoundPage";
import SchemaPage from "./pages/SchemaPage/SchemaPage";
import SearchPage from "./pages/SearchPage/SearchPage";
import WorkflowBuilderPage from "./pages/WorkflowBuilderPage/WorkflowBuilderPage";

/**
 * The application's route table, shared by App and by tests that need to
 * verify routing behavior (e.g. the legacy /sunburst and /tree redirects)
 * against the routes actually served, rather than a copy of them.
 */
const AppRoutes = () => (
  <Routes>
    <Route path="/collections/:coll/:id" element={<DocumentPage />} />
    <Route path="/collections/:coll" element={<CollectionsPage />} />
    <Route path="/collections" element={<CollectionsPage />} />
    <Route path="/graph" element={<GraphPage />} />
    <Route path="/workflow-builder" element={<WorkflowBuilderPage />} />
    <Route path="/ftu" element={<FTUExplorerPage />} />
    <Route path="/about" element={<AboutPage />} />
    <Route path="/schema" element={<SchemaPage />} />
    <Route path="/browse" element={<BrowsePage />} />
    <Route path="/sunburst" element={<Navigate to="/browse?view=sunburst" replace />} />
    <Route path="/tree" element={<Navigate to="/browse?view=tree" replace />} />
    <Route path="/" element={<SearchPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>
);

export default AppRoutes;
