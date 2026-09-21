import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { fetchCellSetLabelLookups } from "services";
import { setCellSetLabelLookups } from "utils";
import App from "./App";
import { persistor, store } from "./store/store";

const root = ReactDOM.createRoot(document.getElementById("root"));

// Cell set labels read these lookups synchronously wherever a label is drawn,
// so they load before the first render. A failed load renders anyway, with
// labels leaving out the citation and anatomical structure.
fetchCellSetLabelLookups()
  .then(setCellSetLabelLookups)
  .finally(() =>
    root.render(
      <React.StrictMode>
        <Provider store={store}>
          <PersistGate loading={null} persistor={persistor}>
            <App />
          </PersistGate>
        </Provider>
      </React.StrictMode>,
    ),
  );
