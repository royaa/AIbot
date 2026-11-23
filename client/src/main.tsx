import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

console.log("[renderer] UI 已挂载");
createRoot(document.getElementById("root")!).render(<App />);
