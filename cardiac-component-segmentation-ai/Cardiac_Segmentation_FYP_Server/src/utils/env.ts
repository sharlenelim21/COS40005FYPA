import dotenv from "dotenv";
import fs from "fs";
import path from "path";

const candidateEnvPaths = (baseDir: string): string[] => [
  path.resolve(baseDir, "../../.env"),
  path.resolve(baseDir, "../.env"),
  path.resolve(process.cwd(), ".env"),
];

export const loadEnvFromKnownLocations = (baseDir: string): string | null => {
  for (const envPath of candidateEnvPaths(baseDir)) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: true });
      return envPath;
    }
  }

  dotenv.config({ override: true });
  return null;
};
