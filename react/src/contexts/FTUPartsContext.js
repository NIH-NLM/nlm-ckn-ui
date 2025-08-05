import { createContext, useState, useEffect, useContext, useMemo } from "react";

// URL from HRA
const FTU_ILLUSTRATIONS_URL =
  "https://apps.humanatlas.io/api/v1/ftu-illustrations";

// Define context
const FtuPartsContext = createContext({
  ftuParts: [],
  isLoading: true,
  error: null,
});

function getFtuPartsFromIllustrationsJsonLd(jsonld) {
  if (jsonld["@graph"]?.length > 0) {
    const partsArray = jsonld["@graph"]
      .map((illustration) =>
        illustration.mapping.map((part) => ({
          ftu_digital_object: illustration["@id"],
          ftu_iri: illustration.representation_of.replace(
            "UBERON:",
            "http://purl.obolibrary.org/obo/UBERON_",
          ),
          ftu_part_iri: part.representation_of,
        })),
      )
      .flat();

    return partsArray;
  } else {
    return [];
  }
}

// Create Provider
export const FtuPartsProvider = ({ children }) => {
  const [ftuParts, setFtuParts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch data
  useEffect(() => {
    const fetchFtuParts = async () => {
      try {
        const response = await fetch(FTU_ILLUSTRATIONS_URL);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const ftuParts = getFtuPartsFromIllustrationsJsonLd(data);
        setFtuParts(ftuParts);
      } catch (e) {
        console.error("Failed to fetch FTU parts:", e);
        setError(e.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFtuParts();
  }, []);

  // Memoize
  const value = useMemo(
    () => ({
      ftuParts,
      isLoading,
      error,
    }),
    [ftuParts, isLoading, error],
  );

  return (
    <FtuPartsContext.Provider value={value}>
      {children}
    </FtuPartsContext.Provider>
  );
};

// Create hook
export const useFtuParts = () => {
  const context = useContext(FtuPartsContext);
  if (context === undefined) {
    throw new Error("useFtuParts must be used within a FtuPartsProvider");
  }
  return context;
};
