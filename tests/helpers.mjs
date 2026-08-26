import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function temporaryDirectory(prefix = "multi-agent-forum-test-") {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTemporaryDirectory(directory) {
  await rm(directory, { recursive: true, force: true });
}
