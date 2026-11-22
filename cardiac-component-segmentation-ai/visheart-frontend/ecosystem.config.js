// PM2 config from the original server deployment. The local install does not use it: the frontend is built into the
// visheart-local image, which runs visheart-local-deployment/ecosystem.config.js.
module.exports = {
  apps : [{
    name: "visheart-frontend",
    script: "pnpm", // We'll call pnpm directly now
    args: ["start"], // Pass 'start' as an argument to pnpm
    cwd: __dirname, // This folder, wherever the repository is
  }]
};
