import { useActiveNav } from "contexts";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

const Header = () => {
  const { activeNav, setActive } = useActiveNav();
  const location = useLocation();

  // Update activeNav whenever location changes
  useEffect(() => {
    setActive(location.pathname);
  }, [location, setActive]);

  return (
    <div>
      <div className="app-header background-color-main">
        <h1>NLM Cell Knowledge Network</h1>
        {/*<div>Login</div>*/}
      </div>
      <div className="navbar background-color-light-bg">
        <Link to="/">
          <h4 className={activeNav === "/" ? "active-nav" : ""}>Search</h4>
        </Link>
        <Link to="/sunburst">
          <h4 className={activeNav === "/sunburst" ? "active-nav" : ""}>Browse</h4>
        </Link>
        <Link to="/tree">
          <h4 className={activeNav === "/tree" ? "active-nav" : ""}>Explore</h4>
        </Link>
        <Link to="/collections">
          <h4 className={activeNav.startsWith("/collections") ? "active-nav" : ""}>Collections</h4>
        </Link>
        <Link to="/graph">
          <h4 className={activeNav.startsWith("/graph") ? "active-nav" : ""}>Graph</h4>
        </Link>
        <Link to="/workflow-builder">
          <h4 className={activeNav.startsWith("/workflow-builder") ? "active-nav" : ""}>Workflow</h4>
        </Link>
        <Link to="/about">
          <h4 className={activeNav.startsWith("/about") ? "active-nav" : ""}>About</h4>
        </Link>
      </div>
    </div>
  );
};

export default Header;
