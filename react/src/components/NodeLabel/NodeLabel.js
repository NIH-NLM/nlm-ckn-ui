import { getBadges, getLabel, getTitle } from "utils";

/**
 * An item's label, or its collection-prefixed title, followed by its badges.
 * Use it wherever the full name renders as markup; places that need plain text
 * (graph canvas labels, aria labels) keep calling getLabel.
 */
const NodeLabel = ({ item, asTitle = false }) => (
  <>
    {asTitle ? getTitle(item) : getLabel(item)}
    {getBadges(item).map((badge) => (
      <span key={badge.key} className="node-badge" title={badge.tooltip}>
        {badge.text}
      </span>
    ))}
  </>
);

export default NodeLabel;
