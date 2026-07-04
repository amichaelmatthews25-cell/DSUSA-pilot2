import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { DataProviderHost } from "./data/context.tsx";
import { PresentationHost } from "./presentation/presentation.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DataProviderHost>
        <PresentationHost>
          <App />
        </PresentationHost>
      </DataProviderHost>
    </BrowserRouter>
  </React.StrictMode>,
);
