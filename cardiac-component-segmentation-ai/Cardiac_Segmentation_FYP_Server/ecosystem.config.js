module.exports = {
  apps : [{
    name: "visheart",
    script: "pnpm", // We'll call pnpm directly now
    args: ["start"], // Pass 'start' as an argument to pnpm
    cwd: "/home/ubuntu/fyp_monorepo/Cardiac_Segmentation_FYP_Server", // Ensure correct working directory
    env: {
      NODE_ENV: "development",
      // IMPORTANT: Add your virtual environment's bin path to the PATH
      // This path must be absolute to your venv's bin directory
      PATH: "/home/ubuntu/fyp_monorepo/Cardiac_Segmentation_FYP_Server/dist/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      // You can also include other necessary paths from the "Divergent env variables" like /root/.local/share/pnpm
      // For safety, you might want to include the paths PM2 lists in 'Divergent env variables' as well
      // For example:
      // PATH: "/home/ubuntu/fyp_monorepo/Cardiac_Segmentation_FYP_Server/dist/opt/venv/bin:/root/.local/share/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    }
  }]
};
