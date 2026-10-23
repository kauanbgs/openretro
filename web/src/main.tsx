import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Website } from "./Website";
import "./website.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Website />
  </StrictMode>,
);
