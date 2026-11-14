import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const lock = JSON.parse(await readFile("blocks.lock.json", "utf8"));
for (const block of lock.blocks) {
  const root =
    block.source === "Pramaan-OSS/blocks"
      ? (process.env.OSS_BLOCKS_ROOT ?? path.resolve("../../blocks"))
      : (process.env.PRODUCT_LOOP_ROOT ?? path.resolve("../../../../product-loop"));
  for (const [file, expected] of Object.entries(block.sourceHashes)) {
    const source =
      file.startsWith("registry/") || file === "theme.css" ? file : `${block.sourcePath}/${file}`;
    const bytes = execFileSync("git", ["-C", root, "show", `${block.sourceCommit}:${source}`]);
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw Error(`${block.id}: source hash mismatch for ${file}`);
  }
  if (!lock.adaptations[block.id]) throw Error(`${block.id}: missing adaptation notes`);
  console.log(`${block.id}: pinned source hashes verified`);
}
const roles = lock.blocks.find((b) => b.id === "roles");
const kept = execFileSync("git", [
  "-C",
  process.env.PRODUCT_LOOP_ROOT ?? path.resolve("../../../../product-loop"),
  "show",
  `${roles.sourceCommit}:blocks/roles/files/lib/roles/http.ts`,
]);
if (!kept.equals(await readFile("lib/roles/http.ts")))
  throw Error("lib/roles/http.ts is no longer the roles block's bytes");
console.log("roles: lib/roles/http.ts matches the block");
