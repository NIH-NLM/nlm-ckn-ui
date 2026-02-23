import collMaps from "assets/nlm-ckn-collection-maps.json";
import ListDocuments from "components/ListDocuments";
import { DEFAULT_GRAPH_TYPE } from "constants/index";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchCollectionDocuments, fetchCollections } from "services";
import { getLabel, parseCollections } from "utils";

const collectionMaps = new Map(collMaps.maps);
const ITEMS_PER_LOAD = 50;

const BrowseBox = () => {
  const { coll: currentCollectionFromUrl } = useParams();
  const currentCollection = currentCollectionFromUrl;
  const graphType = DEFAULT_GRAPH_TYPE;

  const [collections, setCollections] = useState([]);
  const [documentList, setDocumentList] = useState([]);
  const [filterText, setFilterText] = useState("");
  const [documentDisplayLimit, setDocumentDisplayLimit] = useState(ITEMS_PER_LOAD);

  const documentListScrollRef = useRef(null);

  useEffect(() => {
    setCollections([]);
    fetchCollections(graphType).then((data) => {
      setCollections(parseCollections(data, collectionMaps));
    });
  }, []);

  const sortDocumentList = useCallback((documents) => {
    const sortedList = Object.values(documents);
    const labeledItems = sortedList.filter((item) => getLabel(item));
    const keyItems = sortedList.filter((item) => !getLabel(item));
    labeledItems.sort((a, b) => {
      const labelA = Array.isArray(getLabel(a)) ? getLabel(a)[0] : getLabel(a);
      const labelB = Array.isArray(getLabel(b)) ? getLabel(b)[0] : getLabel(b);
      return labelA.localeCompare(labelB);
    });
    keyItems.sort((a, b) => Number.parseInt(a._key, 10) - Number.parseInt(b._key, 10));
    setDocumentList([...labeledItems, ...keyItems]);
  }, []);

  useEffect(() => {
    const fetchDocuments = async () => {
      if (!currentCollection) {
        setDocumentList([]);
        return;
      }
      try {
        const data = await fetchCollectionDocuments(currentCollection, graphType);
        sortDocumentList(data);
      } catch (error) {
        console.error("Failed to fetch document list:", error);
        setDocumentList([]);
      }
    };

    setFilterText(""); // Clear filter when collection changes
    setDocumentDisplayLimit(ITEMS_PER_LOAD);
    if (documentListScrollRef.current) {
      documentListScrollRef.current.scrollTop = 0;
    }
    fetchDocuments();
  }, [currentCollection, sortDocumentList]);

  const filteredDocuments = documentList.filter((doc) => {
    const searchLower = filterText.toLowerCase();
    const label = getLabel(doc).toLowerCase();
    const key = (doc._key ? doc._key.toString() : "").toLowerCase();
    return label.includes(searchLower) || key.includes(searchLower);
  });

  const sortedFilteredDocuments =
    filterText.trim() !== ""
      ? [...filteredDocuments].sort((a, b) => {
          const searchLower = filterText.toLowerCase();
          const labelA = (
            a.label && Array.isArray(a.label) ? a.label[0] : a.label || ""
          ).toLowerCase();
          const keyA = (a._key ? a._key.toString() : "").toLowerCase();
          const labelB = (
            b.label && Array.isArray(b.label) ? b.label[0] : b.label || ""
          ).toLowerCase();
          const keyB = (b._key ? b._key.toString() : "").toLowerCase();
          const scoreA = labelA === searchLower || keyA === searchLower ? 0 : 1;
          const scoreB = labelB === searchLower || keyB === searchLower ? 0 : 1;
          return scoreA - scoreB;
        })
      : filteredDocuments;

  const handleFilterChange = (e) => {
    setFilterText(e.target.value);
    setDocumentDisplayLimit(ITEMS_PER_LOAD);
    if (documentListScrollRef.current) {
      documentListScrollRef.current.scrollTop = 0;
    }
  };

  const currentItemsToDisplay = sortedFilteredDocuments.slice(0, documentDisplayLimit);

  // Scroll handler for the document list
  const handleDocumentListScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const threshold = 10; // pixels from bottom

    if (scrollHeight - scrollTop - clientHeight < threshold) {
      if (documentDisplayLimit < sortedFilteredDocuments.length) {
        setDocumentDisplayLimit((prevLimit) =>
          Math.min(prevLimit + ITEMS_PER_LOAD, sortedFilteredDocuments.length),
        );
      }
    }
  };

  return (
    <div className="browse-box-component-wrapper">
      <div className="browse-box-description">
        <h1 className="page-title">Inspect Data Collections</h1>
        <p>Select a collection from the list below to view its members.</p>
        <p>Once a collection is selected, you can filter its members further.</p>
      </div>

      <div className="browse-box-content">
        <div className="collections-list-panel">
          {collections.length === 0 ? (
            <p className="loading-collections-message">Loading collections...</p>
          ) : (
            <ul className="collections-list">
              {collections.map((collKey) => {
                const collectionInfo = collectionMaps.get(collKey);
                const displayName = collectionInfo?.display_name || collKey;
                const abbreviatedName = collectionInfo?.abbreviated_name || collKey;
                const moreInfo = collectionInfo?.more_info || `More about ${displayName}`;
                return (
                  <li key={collKey} className="collection-list-item">
                    <Link
                      to={`/collections/${collKey}`}
                      className={`collection-link ${collKey === currentCollection ? "active" : ""}`}
                      title={moreInfo}
                    >
                      <h3 className="collection-name">{displayName}</h3>
                      <span className="collection-abbreviation">({abbreviatedName})</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="document-list-panel">
          {currentCollection ? (
            <>
              <header className="document-list-header">
                <input
                  type="text"
                  className="document-filter-input"
                  placeholder={`Filter items in ${collectionMaps.get(currentCollection)?.display_name || currentCollection}...`}
                  value={filterText}
                  onChange={handleFilterChange}
                />
                <p className="document-count">{sortedFilteredDocuments.length} results</p>
              </header>
              {currentItemsToDisplay.length > 0 ? (
                <div
                  className="document-list-items-container"
                  ref={documentListScrollRef}
                  onScroll={handleDocumentListScroll}
                >
                  {currentItemsToDisplay.map((document, index) => (
                    <ListDocuments key={document._id || index} document={document} />
                  ))}
                  {documentDisplayLimit < sortedFilteredDocuments.length && (
                    <div className="loading-more-documents">Loading more...</div>
                  )}
                </div>
              ) : (
                <p className="no-documents-message">
                  {documentList.length > 0 && filterText
                    ? "No matching documents found for your filter."
                    : "Loading..."}
                </p>
              )}
            </>
          ) : (
            <p className="select-collection-prompt">
              Please select a collection from the list to view its contents.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default BrowseBox;
