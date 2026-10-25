import { value } from "./module-value.mjs";
document.querySelector("#result").dataset.ok = value === 42 ? "yes" : "no";
