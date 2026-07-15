import logo from "assets/nlm-ckn-logo.png";
import SearchBar from "components/SearchBar/SearchBar";

/**
 * Navy title bar: brand (logo + wordmark) on the left, global search on the right.
 * Sits above the nav Menu Bar in Header.
 */
const TitleBar = () => (
  <div className="app-title-bar">
    <div className="app-title-brand">
      <img
        className="app-title-logo"
        src={logo}
        alt="NLM Cell Knowledge Network logo"
        width="56"
        height="56"
      />
      <span className="app-title-wordmark">NLM Cell Knowledge Network</span>
    </div>
    <SearchBar placeholder="Search gene, tissue, cell set, publication..." />
  </div>
);

export default TitleBar;
