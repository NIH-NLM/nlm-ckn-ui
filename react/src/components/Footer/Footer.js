import { faGithub } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import { fetchVersionInfo } from "services";

const Footer = () => {
  const currentYear = new Date().getFullYear();
  const [versions, setVersions] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchVersionInfo().then((data) => {
      if (!cancelled) setVersions(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer className="site-footer">
      <div className="footer-content-wrapper">
        <div className="footer-section footer-links">
          <a
            href="https://github.com/NIH-NLM/nlm-ckn"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link github-link"
            aria-label="View source code on GitHub"
          >
            <FontAwesomeIcon icon={faGithub} />
            <span>View on GitHub</span>
          </a>
          <a
            href="https://www.nlm.nih.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            NLM
          </a>
          <a
            href="https://www.ncbi.nlm.nih.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            NCBI
          </a>
        </div>

        {versions && (versions.ui_version || versions.etl_version) && (
          <div className="footer-section footer-versions">
            {versions.ui_version && <span>UI {versions.ui_version}</span>}
            {versions.ui_version && versions.etl_version && <span> · </span>}
            {versions.etl_version && <span>ETL {versions.etl_version}</span>}
          </div>
        )}

        <div className="footer-section footer-copyright">
          <p>© {currentYear} National Library of Medicine (NLM).</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
