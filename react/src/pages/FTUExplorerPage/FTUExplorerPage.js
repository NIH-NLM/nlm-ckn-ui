import FTUIllustration from "../../components/FTUIllustration/FTUIllustration";

const FTUExplorerPage = () => {
  return (
    <div>
      <FTUIllustration
        selectedIllustration={"https://purl.humanatlas.io/2d-ftu/lung-pulmonary-alveolus"}
        illustrations={
          "https://cdn.humanatlas.io/digital-objects/graph/2d-ftu-illustrations/latest/assets/2d-ftu-illustrations.jsonld"
        }
      />
    </div>
  );
};

export default FTUExplorerPage;
