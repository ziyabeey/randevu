import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { MarketingHome } from "./MarketingHome";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Marketing preview root not found.");
}

createRoot(root).render(
  <StrictMode>
    <MarketingHome />
  </StrictMode>,
);
