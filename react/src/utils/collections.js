/**
 * Collection and label utilities for processing collection data and generating labels/URLs.
 */
import { cardTitleFields, fieldSections, omittedFields } from "config/fieldSections";
import collMaps from "../assets/nlm-ckn-collection-maps.json";
import { capitalCase } from "./strings";

/**
 * Module-level collection config map built from the JSON asset.
 * Shared across all functions to avoid re-creating the Map on every call.
 */
export const collectionConfigMap = new Map(collMaps.maps);

/**
 * Collections that exist in the database but should not appear in the
 * browsable collections list. "Life cycle stage" (HsapDv) is sparsely
 * populated and not meant for browsing.
 */
export const NON_BROWSABLE_COLLECTIONS = new Set(["HsapDv"]);

/**
 * Apply a collection-config field transform to a raw value.
 *
 * A config entry may rewrite a substring — CURIEs such as "CL:0002399" become
 * "CL_0002399" before being appended to an ontology base URL — and/or lowercase
 * the result. Every consumer of individual_labels, individual_urls and
 * individual_fields needs those same two steps.
 *
 * Callers keep their own null/empty handling and fallbacks: the label and URL
 * helpers disagree about whether an empty string counts as a value, and that
 * difference is deliberate rather than something to unify here.
 *
 * @param {object} config - A field config entry from the collection maps.
 * @param {*} value - The raw field value.
 * @returns {string} The transformed value, coerced to a string.
 */
export const applyFieldTransform = (config, value) => {
  let result = String(value);

  if (config.to_be_replaced) {
    result = result.replaceAll(config.to_be_replaced, config.replace_with ?? "");
  }

  return config.make_lower_case ? result.toLowerCase() : result;
};

/**
 * Remove collections that should not be browsable from a list of collection keys.
 * @param {Array<string>} collections - Array of collection names.
 * @returns {Array<string>} Filtered array excluding non-browsable collections.
 */
export const filterBrowsableCollections = (collections) =>
  collections.filter((collection) => !NON_BROWSABLE_COLLECTIONS.has(collection));

/**
 * Sort and parse collections with optional display name mapping.
 * @param {Array<string>} collections - Array of collection names.
 * @param {Map|null} collectionMaps - Optional map of collection configurations.
 * @returns {Array<string>} Sorted array of collection names.
 */
export const parseCollections = (collections, collectionMaps = null) => {
  if (collectionMaps) {
    return collections.sort((a, b) => {
      const aDisplay = collectionMaps.get(a)?.display_name ? collectionMaps.get(a).display_name : a;
      const bDisplay = collectionMaps.get(b)?.display_name ? collectionMaps.get(b).display_name : b;
      return aDisplay.toLowerCase().localeCompare(bDisplay.toLowerCase());
    });
  }
  return collections.sort((a, b) => {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
};

/**
 * Number of trailing UUID characters kept as a dataset differentiator. Six is
 * the convention agreed for the collection view (nlm-ckn#303); it is unique
 * across every dataset UUID in the graph.
 */
const UUID_SUFFIX_LENGTH = 6;

/**
 * Decorate a cell set dataset label so multi-organ datasets can be told apart.
 *
 * A dataset covering several organs yields one CSD document per organ, all
 * carrying the same Name — the collection list then shows a run of identical
 * rows. Appending the anatomical structure and the tail of the dataset UUID
 * disambiguates both cases: the same dataset split by organ, and different
 * datasets from the same author and organ.
 *
 * Each part is appended only when the document carries it, so a document
 * missing either field degrades to the plain label rather than to a gap.
 *
 * @param {object} item - The CSD document.
 * @param {string} label - The label chosen from the collection config.
 * @returns {string} The decorated label.
 */
const decorateCellSetDatasetLabel = (item, label) => {
  // The key is "<uuid>__<anatomical structure>", so it already carries both
  // parts; decorating it would just repeat them.
  if (label === item._key) {
    return label;
  }

  const uuid = item.version ?? String(item._key ?? "").split("__")[0];
  const organ = item.anatomical_structure;

  let decorated = label;
  if (organ) {
    decorated += ` — ${String(organ).replaceAll("_", " ")}`;
  }
  if (uuid.length >= UUID_SUFFIX_LENGTH) {
    decorated += ` (${uuid.slice(-UUID_SUFFIX_LENGTH)})`;
  }
  return decorated;
};

/**
 * Generates display label for data item based on dynamic configuration.
 * Finds first valid field from options, applies transformations, and returns result.
 * @param {object} item - Data object needing label. Must contain `_id` property.
 * @returns {string} Processed label string or default "NAME UNKNOWN" fallback.
 */
export const getLabel = (item) => {
  try {
    const itemCollection = item._id.split("/")[0];

    const labelOptions =
      collectionConfigMap.get(itemCollection)?.individual_labels ??
      collectionConfigMap.get("edges")?.individual_labels;

    let label;

    if (Array.isArray(labelOptions)) {
      for (const config of labelOptions) {
        const value = item[config.field_to_use];

        if (value !== null && value !== undefined) {
          label = applyFieldTransform(config, value);
          break;
        }
      }
    }

    if (label && itemCollection === "CSD") {
      return decorateCellSetDatasetLabel(item, label);
    }

    return label || "NAME UNKNOWN";
  } catch (error) {
    console.error(`getLabel failed with exception: ${error}`);
    return "NAME UNKNOWN";
  }
};

/**
 * Generates dynamic URL for data item based on configuration.
 * Finds first valid URL rule, applies transformations, and returns result.
 * @param {object} item - Data object needing URL. Must contain `_id` property.
 * @returns {string|null} Processed URL string, or null if no URL could be generated.
 */
export const getUrl = (item) => {
  try {
    const itemCollection = item._id.split("/")[0];
    const collectionMap = collectionConfigMap.get(itemCollection);

    if (collectionMap) {
      const urlOptions = collectionMap.individual_urls;

      if (Array.isArray(urlOptions)) {
        for (const config of urlOptions) {
          const value = item[config.field_to_use];

          if (value !== null && value !== undefined) {
            const replacement = applyFieldTransform(config, value);
            return config.individual_url.replace("<FIELD_TO_USE>", replacement);
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`getUrl failed with exception: ${error}`);
    return null;
  }
};

/**
 * Extracts and formats ordered list of fields for display.
 * Uses 'individual_fields' config to select, order, and format item properties.
 * @param {object} item - Data object to process. Must contain `_id` property.
 * @returns {Array<object>} Array of field objects { key, label, value, url }, or empty array.
 */
export const getDisplayFields = (item) => {
  try {
    const itemCollection = item._id.split("/")[0];

    const fieldConfigs =
      collectionConfigMap.get(itemCollection)?.individual_fields ??
      collectionConfigMap.get("edges")?.individual_fields;

    if (!Array.isArray(fieldConfigs)) {
      return [];
    }

    return fieldConfigs
      .map((config) => {
        const value = item[config.field_to_display];
        let fieldUrl = null;

        if (config.field_url && config.field_to_use) {
          const urlValue = item[config.field_to_use];
          if (urlValue !== null && urlValue !== undefined) {
            const replacement = applyFieldTransform(config, urlValue);
            fieldUrl = config.field_url.replace("<FIELD_TO_USE>", replacement);
          }
        }

        return {
          key: config.field_to_display,
          label: config.display_field_as,
          value: value,
          url: fieldUrl,
        };
      })
      .filter((field) => field.value !== null && field.value !== undefined);
  } catch (error) {
    console.error(`getDisplayFields failed with exception: ${error}`);
    return [];
  }
};

/**
 * Groups an item's fields into UI-local sidebar sections.
 * Configured keys resolve their value/URL via getDisplayFields (DRY URLs);
 * keys absent from the collection map resolve their plain value from the
 * document. A field descriptor may declare a `transform`, applied to the
 * resolved value before the empty-value filter, so a transform that returns
 * "" drops the row. Empty values and empty sections are dropped.
 * @param {object} item - Data object. Must contain `_id`.
 * @returns {Array<{section: string, fields: Array<object>}>|null} Sections, or
 *   null when the item's collection has no section config (caller falls back).
 */
export const getSectionedFields = (item) => {
  try {
    const itemCollection = item._id.split("/")[0];
    const sections = fieldSections[itemCollection];
    if (!Array.isArray(sections)) {
      return null;
    }

    const displayFields = getDisplayFields(item);
    const byKey = new Map(displayFields.map((f) => [f.key, f]));
    const isPresent = (v) => v !== null && v !== undefined && v !== "";
    const placed = new Set();

    const curated = sections.map(({ section, fields, description, info }) => {
      const resolved = fields
        .map(({ key, label, variant, transform, value: fixed }) => {
          placed.add(key);
          const configured = byKey.get(key);
          // A field may declare a fixed value the data does not carry.
          const raw = fixed ?? (configured ? configured.value : item[key]);
          return {
            key,
            label,
            variant,
            value: transform ? transform(raw) : raw,
            url: configured ? configured.url : null,
          };
        })
        .filter((f) => isPresent(f.value));
      return { section, description, info, fields: resolved };
    });

    // Show-all: every configured attribute not placed in a curated section lands
    // in a catch-all "Additional" section, except those deliberately omitted.
    const omitted = new Set(omittedFields[itemCollection] ?? []);
    const extras = displayFields
      .filter((f) => !placed.has(f.key) && !omitted.has(f.key) && isPresent(f.value))
      .map((f) => ({ key: f.key, label: f.label, value: f.value, url: f.url }));
    if (extras.length > 0) {
      // A collection may curate its own "Additional" section (CSD names the
      // secondary quality statistics there). Merge into it rather than emitting
      // a second section under the same heading.
      const existing = curated.find((s) => s.section === "Additional");
      if (existing) {
        existing.fields.push(...extras);
      } else {
        curated.push({ section: "Additional", fields: extras });
      }
    }

    return curated.filter((s) => s.fields.length > 0 || s.description);
  } catch (error) {
    console.error(`getSectionedFields failed with exception: ${error}`);
    return null;
  }
};

/**
 * Title for a document's node card. Collections with a `cardTitleFields`
 * entry join the populated parts after the collection name; the rest, and a
 * document carrying none of the parts, fall back to getTitle.
 * @param {object} item - Data object. Must contain `_id`.
 * @returns {string} The card title.
 */
export const getCardTitle = (item) => {
  const itemCollection = item._id.split("/")[0];
  const parts = cardTitleFields[itemCollection];
  const displayName = collectionConfigMap.get(itemCollection)?.display_name;
  if (!parts || !displayName) {
    return getTitle(item);
  }
  const values = parts
    .map(({ key, transform }) => (transform ? transform(item[key]) : item[key]))
    .filter((v) => v !== null && v !== undefined && v !== "");
  if (values.length === 0) {
    return getTitle(item);
  }
  return `${capitalCase(displayName)}: ${values.join(" — ")}`;
};

/**
 * Generate a title for a document/item.
 * @param {object} item - Data object. Must contain `_id` property.
 * @returns {string} Formatted title string.
 */
export const getTitle = (item) => {
  const itemCollection = item._id.split("/")[0];
  const collectionMap = collectionConfigMap.get(itemCollection);

  if (collectionMap) {
    const title = `${collectionMap.display_name}: ${getLabel(item)}`;
    return capitalCase(title);
  }
  const title = `${itemCollection}: ${item.label ? item.label : item._id}`;
  return capitalCase(title);
};

/**
 * Extracts the source text for a link using the edges collection config.
 * Reads the "Source" field as defined in the edges individual_fields map,
 * avoiding any collision with D3's `source` property on links.
 * @param {object} link - Raw or processed link object.
 * @returns {string|undefined} The source text value, or undefined.
 */
export const getLinkSourceText = (link) => {
  const edgeConfig = collectionConfigMap.get("edges");
  if (!edgeConfig?.individual_fields) return undefined;
  const sourceFieldConfig = edgeConfig.individual_fields.find(
    (f) => f.field_to_display === "Source",
  );
  if (!sourceFieldConfig) return undefined;
  const value = link[sourceFieldConfig.field_to_display];
  return value !== null && value !== undefined ? String(value) : undefined;
};

/**
 * Extracts filterable edge attribute names from collection maps configuration.
 * @returns {Array<string>} Sorted array of unique field names for filtering.
 */
export const getFilterableEdgeFields = () => {
  try {
    const edgeConfig = collectionConfigMap.get("edges");

    if (!edgeConfig || !Array.isArray(edgeConfig.individual_fields)) {
      console.warn("No 'edges' configuration found in collection maps.");
      return [];
    }

    const fields = edgeConfig.individual_fields
      .map((field) => field.field_to_display)
      .filter(Boolean);

    return [...new Set(fields)].sort();
  } catch (error) {
    console.error("Failed to parse filterable edge fields:", error);
    return [];
  }
};

/**
 * Get all searchable fields from collection maps configuration.
 * @returns {Set<String>} Set of unique field names for searching.
 */
export const getAllSearchableFields = () => {
  const fieldsToDisplay = new Set();
  collectionConfigMap.forEach((collectionMap, _collection, _collectionMaps) => {
    collectionMap.individual_fields.forEach((fieldMap, _index) => {
      fieldsToDisplay.add(fieldMap.field_to_display);
    });
  });

  return fieldsToDisplay;
};

/**
 * Get the display name for a collection key.
 * @param {string} collectionKey - The collection key (e.g., "CL")
 * @returns {string} The display name, or the key itself if not found.
 */
export const getCollectionDisplayName = (collectionKey) => {
  return collectionConfigMap.get(collectionKey)?.display_name || collectionKey;
};

/**
 * Get the field definitions for a collection (schema-level, without populating values).
 * @param {string} collection - The collection key (e.g., "CL")
 * @returns {Array<{fieldName: string, displayName: string}>}
 */
export const getCollectionFields = (collection) => {
  const config = collectionConfigMap.get(collection);
  if (!config?.individual_fields) return [];
  return config.individual_fields.map((f) => ({
    fieldName: f.field_to_display,
    displayName: f.display_field_as,
  }));
};

/**
 * Get the display label for a node using the collection's individual_labels config.
 * Tries each field in order until one has a value.
 *
 * Supports two calling conventions:
 *   - getNodeLabel(nodeData, nodeId)  -- nodeId contains "/" (e.g., "CL/0000540")
 *   - getNodeLabel(nodeData, collectionKey) -- plain collection key (e.g., "CL")
 *
 * @param {Object} nodeData - The node data object (may be partial or null)
 * @param {string} nodeIdOrCollection - Either a full node ID ("CL/0000540") or a collection key ("CL")
 * @returns {string} The display label
 */
export const getNodeLabel = (nodeData, nodeIdOrCollection) => {
  const isNodeId = nodeIdOrCollection?.includes("/");
  const collection = isNodeId ? nodeIdOrCollection?.split("/")[0] || "" : nodeIdOrCollection || "";
  const fallback = isNodeId ? nodeIdOrCollection : "-";

  if (!nodeData) return fallback;

  const config = collectionConfigMap.get(collection);

  if (!config?.individual_labels) {
    return nodeData.label || nodeData.name || nodeData._key || fallback;
  }

  for (const labelConfig of config.individual_labels) {
    const value = nodeData[labelConfig.field_to_use];
    if (value !== undefined && value !== null && value !== "") {
      return applyFieldTransform(labelConfig, value);
    }
  }

  return fallback;
};

/**
 * Get the external URL for a node based on its collection config.
 * @param {Object} node - The node data object
 * @param {string} collection - The collection key
 * @returns {string|null} The URL or null
 */
export const getNodeExternalUrl = (node, collection) => {
  const config = collectionConfigMap.get(collection);
  if (!config?.individual_urls?.[0]) return null;

  const urlConfig = config.individual_urls[0];
  const fieldValue = node[urlConfig.field_to_use];
  if (!fieldValue) return null;

  return urlConfig.individual_url.replace(
    "<FIELD_TO_USE>",
    applyFieldTransform(urlConfig, fieldValue),
  );
};
