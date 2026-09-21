import { HashRouter as Router } from "react-router-dom";

// Import consolidated stylesheet entry point so ordering stays consistent
import "./styles/index.css";

import AppRoutes from "./AppRoutes";
import Footer from "./components/Footer/Footer";
import Header from "./components/Header/Header";
import { ToastProvider } from "./components/Toast";
import { ActiveNavProvider, FtuPartsProvider, GraphProvider } from "./contexts";

function App() {
  return (
    <Router>
      <ToastProvider>
        <ActiveNavProvider>
          <GraphProvider>
            <FtuPartsProvider>
              <div className="site-container background-color-white">
                <Header />
                <div className="app">
                  <AppRoutes />
                </div>
                <Footer />
              </div>
            </FtuPartsProvider>
          </GraphProvider>
        </ActiveNavProvider>
      </ToastProvider>
    </Router>
  );
}

export default App;
