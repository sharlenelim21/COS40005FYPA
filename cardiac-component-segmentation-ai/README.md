# VisHeart Local Deployment

**For running VisHeart Web Application for Cardiac Segmentation locally**

> ⚠️ **Windows Only** - This application is designed to run on Windows.

---

## 🚀 Quick Start

### 1. Start VisHeart

Simply double-click the **`start.bat`** file in this folder.

### 2. Stop VisHeart

Double-click the **`stop.bat`** file to shut everything down.

---

## 📋 Prerequisites

Before running the application, you must have the following installed:

1. **Docker Desktop for Windows**
   - [Download & Install Docker Desktop](https://docs.docker.com/desktop/install/windows-install/)
   - Ensure the **WSL 2** backend is enabled during installation.

2. **NVIDIA Drivers & CUDA (For AI Features)**
   - To use the AI segmentation features, you need an NVIDIA GPU.
   - [Install NVIDIA Drivers for CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)

---

## 🌐 Accessing the Application

Once the application is running (wait a few minutes for it to start), you can access the services below via the web browser:

| Service | URL | Username | Password |
|---------|-----|----------|----------|
| **VisHeart App (Frontend)** | [http://localhost:3000](http://localhost:3000) | `admin` | `P@ssw0rd123!` |
| **Backend Server** | [http://localhost:5000](http://localhost:5000) | - | - |
| **GPU Inference Server** | [http://localhost:8001/docs](http://localhost:8001/docs) | - | - |
| **File Storage** | [http://localhost:9001](http://localhost:9001) | `minioadmin` | `minioadmin123` |

**Database Credentials (for developers):**

- **MongoDB:** `localhost:27017` (User: `admin`, Pass: `P@ssw0rd123!`)
- **Redis:** `localhost:6379` (No Password)

---

## Troubleshooting

- **"Docker is not running"**: Make sure you have started Docker Desktop and the whale icon is visible in your taskbar.
- **Application not loading**: It may take 2-3 minutes for all services to start up completely.
- **AI/GPU not working**: Ensure you have installed the NVIDIA drivers for WSL linked above. To check use the ` docker run --rm -it --gpus=all nvcr.io/nvidia/k8s/cuda-sample:nbody nbody -gpu -benchmark` command or refer to [GPU support in Docker Desktop for Windows](https://docs.docker.com/desktop/features/gpu/) for more details.

For advanced issues, please refer to the [Official Docker Documentation](https://docs.docker.com/).