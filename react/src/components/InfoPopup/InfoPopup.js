import { Link } from "react-router-dom";

const InfoPopup = ({ data, position, onClose }) => {
  if (!data) {
    return null;
  }

  const popupStyle = {
    position: "fixed",
    top: `${position.y}px`,
    left: `${position.x}px`,
    transform: "translate(10px, 10px)",
  };

  return (
    <div className="cell-info-popup" style={popupStyle}>
      <button type="button" className="popup-close-btn" onClick={onClose}>
        x
      </button>
      <div className="popup-header">Cell Information</div>
      <div className="popup-content">
        <p>
          <strong>Label:</strong> {data.label}
        </p>
        <p>
          <strong>ID:</strong> {data.id}
        </p>
      </div>
      <div className="popup-actions">
        <Link
          className="popup-button"
          to={`/collections/${data.id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
        >
          Go To "{data.label}"
        </Link>
      </div>
    </div>
  );
};

export default InfoPopup;
