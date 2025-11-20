import { Link } from "react-router-dom";
import { getLabel } from "../Utils/Utils";

const ListDocuments = ({ document }) => {
  return (
    <Link to={`/collections/${document._id}`}>
      <div className="list-document">
        <h3>{getLabel(document)}</h3>
      </div>
    </Link>
  );
};

export default ListDocuments;
