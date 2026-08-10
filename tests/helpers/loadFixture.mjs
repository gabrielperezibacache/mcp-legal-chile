import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** Load a UTF-8 fixture relative to tests/fixtures/. */
export function loadFixture(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}
