module.exports = {
  apps : [{
    name: "visheart-frontend",
    script: "pnpm", // We'll call pnpm directly now
    args: ["start"], // Pass 'start' as an argument to pnpm
    cwd: "/home/ubuntu/fyp_monorepo/visheart-frontend/", // Ensure correct working directory
  }]
};
