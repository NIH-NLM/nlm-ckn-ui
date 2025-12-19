import BrowseBox from "components/BrowseBox";

const CollectionsPage = (currentCollection) => {
  return (
    <div className="collections-page-layout">
      <div className="collections-content-box">
        <div className="browsebox-container">
          <BrowseBox currentCollection={currentCollection} />
        </div>
      </div>
    </div>
  );
};

export default CollectionsPage;
