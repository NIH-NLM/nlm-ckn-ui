import { faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { isGeneField, parseGeneTokens } from "config/geneFields";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { formatFieldValue, getDisplayFields, getSectionedFields, getTitle, getUrl } from "utils";

/**
 * The design's outbound-link mark (Figma "External Link"), drawn in the link's
 * own colour after its text, with the new-tab behaviour spelled out for screen
 * readers.
 */
const ExternalLinkIcon = () => (
  <>
    <svg
      className="external-link-icon"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.667 3.333H5.467c-.747 0-1.12 0-1.406.146a1.333 1.333 0 0 0-.582.582c-.146.286-.146.659-.146 1.406v5.066c0 .747 0 1.12.146 1.406.128.25.332.455.582.583.285.145.658.145 1.403.145h5.07c.746 0 1.118 0 1.403-.145.251-.128.455-.332.583-.583.146-.285.146-.658.146-1.403V9.333M10 2.667h3.333V6m0-3.333L8.667 7.333" />
    </svg>
    <span className="visually-hidden"> (opens in a new tab)</span>
  </>
);

/**
 * Renders a structured inspector card for a single document.
 * For collections with a UI section config, renders one titled section per the
 * config's sections plus an "Additional" catch-all for anything it does not
 * name; otherwise renders a single flat Overview table.
 * @param {object} props
 * @param {object} props.document - The document data object to display.
 */
const DocumentCard = ({ document }) => {
  const sections = getSectionedFields(document);
  const collection = document._id.split("/")[0];

  /**
   * Renders a gene field as one internal link per symbol, so each gene reaches
   * its own page (which in turn links out to NCBI Gene). Tokens with no gene
   * page — Ensembl identifiers — stay as text rather than becoming dead links.
   * @param {Array<{symbol: string, key: string, linkable: boolean}>} tokens
   */
  const renderGeneTokens = (tokens) =>
    tokens.map(({ symbol, key, linkable }, index) => (
      <Fragment key={key}>
        {index > 0 && ", "}
        {linkable ? (
          <Link to={`/collections/GS/${symbol}`} className="gene-link">
            {symbol}
          </Link>
        ) : (
          symbol
        )}
      </Fragment>
    ));

  /**
   * Renders a field's value, as an external link when it carries a URL.
   * @param {object} field - { key, value, url }
   */
  const renderValue = (field) => {
    if (isGeneField(collection, field.key)) {
      const tokens = parseGeneTokens(field.value);
      if (tokens.length > 0) {
        return renderGeneTokens(tokens);
      }
    }
    return field.url ? (
      <a href={field.url} target="_blank" rel="noopener noreferrer" className="external-link">
        {formatFieldValue(field.value)}
        <ExternalLinkIcon />
      </a>
    ) : (
      formatFieldValue(field.value)
    );
  };

  // Sectioned path (configured collections, e.g. CSD).
  if (sections && sections.length > 0) {
    return (
      <div className="document-item-list-wrapper inspector-card">
        <h3 className="inspector-card-title">{getTitle(document)}</h3>
        {sections.map(({ section, fields, description, info }) => {
          const descriptions = fields.filter((f) => f.variant === "description");
          const rows = fields.filter((f) => f.variant !== "description");
          return (
            <section className="inspector-section" key={section}>
              <h4 className="inspector-section-title">
                {section}
                {info && (
                  <FontAwesomeIcon
                    icon={faCircleInfo}
                    title={info}
                    className="inspector-section-info"
                  />
                )}
              </h4>
              {description && <p className="inspector-section-description">{description}</p>}
              {descriptions.map((f) => (
                <p className="inspector-section-description" key={f.key}>
                  {formatFieldValue(f.value)}
                </p>
              ))}
              {rows.length > 0 && (
                <table className="document-attributes-table">
                  <tbody>
                    {rows.map((field) => (
                      <tr key={field.key}>
                        <td className="attribute-key wrap">{field.label}</td>
                        <td className="attribute-value wrap">{renderValue(field)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  // Flat fallback (collections without a section config).
  const url = getUrl(document);
  const legendContent = document._id.replace("/", "_");
  const displayFields = getDisplayFields(document);
  return (
    <div className="document-item-list-wrapper inspector-overview">
      {/* A collection without a section config still names its document, so
          every card reads the same way (#271). */}
      <h3 className="inspector-card-title">{getTitle(document)}</h3>
      <h4 className="inspector-overview-title">Overview</h4>
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
              <ExternalLinkIcon />
            </a>
          ) : (
            <span>{legendContent}</span>
          )}
        </legend>
        <table className="document-attributes-table">
          <tbody>
            {displayFields.map((field) => (
              <tr key={field.key}>
                <td className="attribute-key wrap">{field.label}</td>
                <td className="attribute-value wrap">{renderValue(field)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
    </div>
  );
};

export default DocumentCard;
