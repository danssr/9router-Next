// Register the alias resolver as a loader hook. Use:
//   node --import ./scripts/register.mjs <script>
import { register } from "node:module";
register("./alias-loader.mjs", import.meta.url);
