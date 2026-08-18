import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const H3_EXECUTABLE_BUNDLES = [
  "dist/h3-js.js",
  "dist/h3-js.es.js",
  "dist/browser/h3-js.js",
  "dist/browser/h3-js.es.js",
] as const;

describe("h3-js Expo runtime compatibility patch", () => {
  it.each(H3_EXECUTABLE_BUNDLES)(
    "removes the eager UTF-16 decoder from %s",
    (relativePath) => {
      const source = readFileSync(
        resolve(process.cwd(), "node_modules/h3-js", relativePath),
        "utf8",
      );

      expect(source).not.toContain('new TextDecoder("utf-16le")');
    },
  );
});
