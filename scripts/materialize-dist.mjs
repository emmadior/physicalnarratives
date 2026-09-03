/**
 * Cloudflare Pages cannot upload a directory that is (or contains) a symlink
 * to files outside that directory. `nuxi generate` creates `dist` → `.output/public`.
 * Replace that link with a real copy so a dashboard output of `dist` still works.
 */
import { cp, lstat, realpath, rm } from "node:fs/promises";

const dist = "dist";

try {
  const stat = await lstat(dist);
  if (!stat.isSymbolicLink()) process.exit(0);
  const target = await realpath(dist);
  await rm(dist);
  await cp(target, dist, { recursive: true });
  console.log(`[cf] materialized ${dist} from ${target}`);
} catch (err) {
  if (err && err.code === "ENOENT") process.exit(0);
  throw err;
}
