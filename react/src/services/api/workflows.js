import { WORKFLOW_PRESETS_ENDPOINT } from "constants/index";
import { getJson } from "./fetchWrapper";

export const fetchWorkflowPresets = async () => {
  return getJson(WORKFLOW_PRESETS_ENDPOINT);
};
