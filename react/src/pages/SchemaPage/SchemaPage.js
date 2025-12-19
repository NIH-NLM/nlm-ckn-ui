import schemaImage from "assets/schema.png";

const SchemaPage = () => {
  return (
    <div className="content-page-layout">
      <div className="content-box schema-display-box">
        <h1 className="content-page-title">MVP Schema</h1>
        <div className="image-container schema-image-container">
          <img
            src={schemaImage}
            alt="Database Schema Diagram"
            className="responsive-image schema-image-actual"
          />
        </div>
      </div>
    </div>
  );
};

export default SchemaPage;
