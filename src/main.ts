import "./styles.css";
import { boot } from "./app";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app");
}
boot(root);
