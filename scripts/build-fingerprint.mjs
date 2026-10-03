import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function buildFingerprint(root = process.cwd()) {
  const files = [];
  function collect(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.isDirectory()) collect(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  // Explicit inputs only: never scan .env, credentials, local caches, or report/user data.
  for (const dir of ["src", "fixtures", "public"]) collect(join(root, dir));
  for (const name of ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "scripts/build-fingerprint.mjs"]) {
    const path = join(root, name);
    if (existsSync(path)) files.push(path);
  }
  const hash = createHash("sha256");
  for (const path of files.sort()) hash.update(relative(root, path)).update("\0").update(readFileSync(path)).update("\0");
  return `tg-${hash.digest("hex").slice(0, 20)}`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(buildFingerprint());
