import FTUIllustration from "components/FTUIllustration";
import { DEFAULT_FTU_ILLUSTRATION_URL, FTU_ILLUSTRATIONS_JSONLD_URL } from "constants/index";

const FTUExplorerPage = () => {
  return (
    <div>
      <FTUIllustration
        selectedIllustration={DEFAULT_FTU_ILLUSTRATION_URL}
        illustrations={FTU_ILLUSTRATIONS_JSONLD_URL}
      />
    </div>
  );
};

export default FTUExplorerPage;
