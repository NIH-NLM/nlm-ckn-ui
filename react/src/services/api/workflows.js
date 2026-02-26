import { getJson } from "./fetchWrapper";
import { WORKFLOW_PRESETS_ENDPOINT } from "constants/index";

export const fetchWorkflowPresets = async () => {
  return getJson(WORKFLOW_PRESETS_ENDPOINT);
};
