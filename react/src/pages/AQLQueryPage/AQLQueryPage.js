import { useEffect, useState } from "react";
import ForceGraph from "../../components/ForceGraph/ForceGraph";
import { executeAqlQuery, fetchPredefinedQueries } from "../../services";

const AQLQueryPage = () => {
  const [queryTemplate, setQueryTemplate] = useState("");
  const [nodeIds, setNodeIds] = useState({});
  const [error, setError] = useState(null);
  const [predefinedQueries, setPredefinedQueries] = useState([]);
  const [selectedQuery, setSelectedQuery] = useState("");
  const [value1, setValue1] = useState("");
  const [value2, setValue2] = useState("");

  useEffect(() => {
    // Fetch predefined queries on component mount
    const loadPredefinedQueries = async () => {
      try {
        const data = await fetchPredefinedQueries();
        setPredefinedQueries(data);
      } catch (err) {
        console.error(err);
      }
    };

    loadPredefinedQueries();
  }, []);

  const handleQueryChange = (event) => {
    const selectedId = event.target.value;
    const sq = predefinedQueries.find((q) => q.id === Number.parseInt(selectedId, 10));
    setSelectedQuery(sq);
    setQueryTemplate(sq ? sq.query : "");
  };

  function replaceAll(obj, replacements) {
    if (typeof obj === "string") {
      // Replace placeholders in strings
      let mutated = obj;
      for (const key of Object.keys(replacements)) {
        const regex = new RegExp(`@${key}`, "g");
        mutated = mutated.replace(regex, replacements[key]);
      }
      return mutated;
    }

    if (Array.isArray(obj)) {
      // Recurse through each item in the array
      return obj.map((item) => replaceAll(item, replacements));
    }

    if (typeof obj === "object" && obj !== null) {
      // Recurse through each key in the object
      const newObj = {};
      for (const key of Object.keys(obj)) {
        newObj[key] = replaceAll(obj[key], replacements);
      }
      return newObj;
    }

    // Return other data types as-is
    return obj;
  }

  const executeQuery = async () => {
    setError(null); // Reset any previous error
    try {
      const query = queryTemplate.replace(/@value1/g, `${value1}`).replace(/@value2/g, `${value2}`);
      const data = await executeAqlQuery(query);

      // Check if response has information
      if (data?.nodes?.[0]) {
        //TODO: avoid hard-coding expected results?
        setNodeIds(data.nodes.map((obj) => obj._id));
      } else {
        setError("Nothing found. Please refine your search and try again");
      }
    } catch (err) {
      // TODO: Fix error logic. Currently error will almost always be about mapping over null, given a blank return
      setError(err.message);
      setNodeIds([]); // Clear previous results on error
    }
  };

  return (
    <div className="aql-query-container">
      <div className="aql-query-input">
        <select onChange={handleQueryChange} defaultValue="">
          <option value="" disabled>
            Select a predefined query
          </option>
          {predefinedQueries.map((query) => (
            <option key={query.id} value={query.id}>
              {query.name}
            </option>
          ))}
        </select>
        {/* TODO: Dynamically decide how many placeholders there are based on the query itself */}
        <input
          type="text"
          placeholder={selectedQuery.placeholder_1}
          value={value1}
          onChange={(e) => setValue1(e.target.value)}
        />
        <input
          type="text"
          placeholder={selectedQuery.placeholder_2}
          value={value2}
          onChange={(e) => setValue2(e.target.value)}
        />
        <button type="button" onClick={executeQuery}>
          Execute
        </button>
      </div>
      {error && <div className="error-message">{error}</div>}
      {Object.keys(nodeIds).length > 0 && (
        <ForceGraph
          nodeIds={nodeIds}
          settings={replaceAll(selectedQuery.settings, {
            value1: value1,
            value2: value2,
          })}
        />
      )}
    </div>
  );
};

export default AQLQueryPage;
