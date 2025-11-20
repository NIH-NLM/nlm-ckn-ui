import { Link } from "react-router-dom";

const NotFoundPage = () => {
  return (
    <div className="content-page-layout not-found-page">
      <div className="content-box">
        <h1>404 — Page Not Found</h1>
        <p>The page you're looking for doesn't exist or may have been moved.</p>
        <p>
          <Link to="/">Return to the home page</Link>
        </p>
      </div>
    </div>
  );
};

export default NotFoundPage;
