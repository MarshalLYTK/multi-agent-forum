import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
await rm(resolve(projectRoot, "dist"), { recursive: true, force: true });
