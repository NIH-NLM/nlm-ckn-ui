import NodeLabel from "components/NodeLabel";
import { Link } from "react-router-dom";

const ListDocuments = ({ document }) => {
  return (
    <Link to={`/collections/${document._id}`}>
      <div className="list-document">
        <h3>
          <NodeLabel item={document} />
        </h3>
      </div>
    </Link>
  );
};

export default ListDocuments;
