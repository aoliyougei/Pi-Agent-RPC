import { AsyncLocalStorage } from "node:async_hooks";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { getAllowedFileRoots } from "./file-access.js";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security.js";

const scopes = new AsyncLocalStorage<string | undefined>();

export function currentSessionCwd(): string | undefined {
  return scopes.getStore();
}

export function withSessionCwd<T>(cwd: string | undefined, operation: () => T): T {
  return scopes.run(cwd, operation);
}

export function sessionScopeError(status: number, code: string, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

export async function validateSessionCwd(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !cwd || !isAbsolute(cwd)) {
    throw sessionScopeError(400, "invalid_request", "cwd must be an absolute path");
  }
  let canonical: string;
  try {
    canonical = realpathSync(cwd);
    if (!statSync(canonical).isDirectory()) throw sessionScopeError(400, "invalid_request", "cwd must be a directory");
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) throw error;
    throw sessionScopeError(400, "invalid_request", "cwd is missing or inaccessible");
  }
  if (!isExistingPathWithinRoots(canonical, await getAllowedFileRoots())) {
    throw sessionScopeError(403, "invalid_request", "cwd has not been authorized; validate the directory first");
  }
  return canonical;
}

/** Missing storage is empty; existing storage must stay inside the selected workspace. */
export function projectSessionsDirectory(cwd: string): string | undefined {
  const directory = join(cwd, ".pi", "sessions");
  try {
    const canonical = realpathSync(directory);
    if (!isPathWithinRoots(canonical, new Set([cwd]))) {
      throw sessionScopeError(403, "invalid_request", "Project session storage escapes cwd");
    }
    if (!statSync(canonical).isDirectory()) throw sessionScopeError(400, "invalid_request", "Project session storage is not a directory");
    return canonical;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // A dangling symlink is not the same as absent optional storage.
      for (const path of [join(cwd, ".pi"), directory]) {
        let link = false;
        try { link = lstatSync(path).isSymbolicLink(); }
        catch (statError) { if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError; }
        if (link) {
          let target: string;
          try { target = realpathSync(path); }
          catch { throw sessionScopeError(403, "invalid_request", "Project session storage contains an inaccessible link"); }
          if (!isPathWithinRoots(target, new Set([cwd]))) throw sessionScopeError(403, "invalid_request", "Project session storage escapes cwd");
        }
      }
      return undefined;
    }
    throw error;
  }
}

export function regularSessionPath(file: string, directory: string): string | undefined {
  try {
    if (!lstatSync(file).isFile()) return undefined;
    const canonical = realpathSync(file);
    return resolve(canonical, "..") === realpathSync(directory) ? canonical : undefined;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw error;
  }
}

export function sessionIdConflict(): Error & { status: number; code: string } {
  return sessionScopeError(409, "session_id_conflict", "Multiple distinct session files share this session ID");
}
