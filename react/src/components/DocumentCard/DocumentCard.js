import { getDisplayFields, getUrl } from "../../utils";

/**
 * Renders structured card for single document.
 * Displays document ID as link and key-value pairs from configuration.
 * @param {object} props - Component props.
 * @param {object} props.document - The document data object to display.
 */
const DocumentCard = ({ document }) => {
  const url = getUrl(document);
  const legendContent = document._id.replace("/", "_");
  const displayFields = getDisplayFields(document);

  /**
   * Formats attribute value for display in table cell.
   * Handles boolean, array, and object types appropriately.
   * @param {*} value - The value to format.
   * @returns {string} Formatted value for rendering.
   */
  const formatValue = (value) => {
    if (typeof value === "boolean") return value.toString();
    if (Array.isArray(value)) return value.join(", ");
    if (value !== null && typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return value;
  };

  return (
    <div className="document-item-list-wrapper">
      <fieldset className="document-info-fieldset">
        <legend className="document-info-legend">
          {/* Render legend as link only if primary URL exists. */}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="external-link document-id-link"
            >
              {legendContent}
            </a>
          ) : (
            <span>{legendContent}</span>
          )}
        </legend>
        <table className="document-attributes-table">
          <tbody>
            {/* Map over structured field data from helper function. */}
            {displayFields.map((field) => (
              <tr key={field.key}>
                <td className="attribute-key wrap">{field.label}</td>
                <td className="attribute-value wrap">
                  {/* Render value as link if field-specific URL exists. */}
                  {field.url ? (
                    <a
                      href={field.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="external-link"
                    >
                      {formatValue(field.value)}
                    </a>
                  ) : (
                    formatValue(field.value)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
    </div>
  );
};

export default DocumentCard;
