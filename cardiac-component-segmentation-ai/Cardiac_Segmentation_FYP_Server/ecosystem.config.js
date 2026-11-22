// PM2 config from the original server deployment. The local install does not use it: its image runs
// visheart-local-deployment/ecosystem.config.js. Paths are relative to this folder, wherever the repository is.
const path = require("path");

module.exports = {
  apps : [{
    name: "visheart",
    script: "pnpm", // We'll call pnpm directly now
    args: ["start"], // Pass 'start' as an argument to pnpm
    cwd: __dirname, // Ensure correct working directory
    env: {
      NODE_ENV: "development",
      // The Python virtual environment's bin directory comes first on PATH.
      PATH: [path.join(__dirname, "dist", "opt", "venv", "bin"), "/usr/local/sbin", "/usr/local/bin", "/usr/sbin",
             "/usr/bin", "/sbin", "/bin"].join(":"),
    }
  }]
};
