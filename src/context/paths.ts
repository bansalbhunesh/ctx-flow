import { lstat } from "fs/promises";
import { join } from "path";
import { loadConfig } from "../config.js";
import { isDomain } from "../validation.js";

// Refuse symlink/junction redirects below the configured context root.
export async function contextPath(...segments: string[]): Promise<string> {
  const cfg = await loadConfig();
  let path = cfg.contextDir;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || /[\\/:\0]/.test(segment)) {
      throw new Error("Invalid context path segment");
    }
    path = join(path, segment);
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        throw new Error("Context paths must not contain symbolic links");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return path;
}

export async function domainPath(domain: string): Promise<string> {
  if (!isDomain(domain)) throw new Error("Invalid domain name");
  return contextPath("domains", `${domain}.md`);
}
