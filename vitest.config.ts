import { defineConfig } from "vitest/config";
export default defineConfig({ test: { fileParallelism: false, include: ["lib/**/*.spec.ts"] } });
