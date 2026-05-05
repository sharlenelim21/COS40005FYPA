#------------------------------------------------------------------------------
# Builder Stage
#------------------------------------------------------------------------------
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04 AS builder

# Set DEBIAN_FRONTEND to noninteractive
ENV DEBIAN_FRONTEND=noninteractive
# Headless mode for GUI libraries
ENV DISPLAY=:99
ENV PYOPENGL_PLATFORM=egl
ENV MPLBACKEND=Agg

# Install build dependencies and Python 3.12
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    software-properties-common \
    wget \
    ca-certificates \
    libgl1 \
    libglib2.0-0 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxrandr2 \
    libxcursor1 \
    libxi6 \
    libxss1 \
    libxtst6 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libcairo-gobject2 \
    libpango-1.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libegl1 \
    libgles2 \
    libglvnd0 \
    libglx0 && \
    add-apt-repository ppa:deadsnakes/ppa -y && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    python3.12 \
    python3.12-venv \
    python3.12-dev \
    python3-pip && \
    # Clean up apt caches
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create a virtual environment
ENV VENV_PATH=/opt/venv/visheart
RUN python3.12 -m venv $VENV_PATH

# Activate the virtual environment by adding its bin directory to PATH for this stage
ENV PATH="$VENV_PATH/bin:$PATH"

# Upgrade pip in the virtual environment
RUN pip install --no-cache-dir --upgrade pip

# Copy requirements files
COPY requirements_torch.txt requirements_prod.txt ./

# Install PyTorch and other torch-related packages
RUN pip install --no-cache-dir -r requirements_torch.txt --index-url https://download.pytorch.org/whl/cu118 && \
    rm -rf /root/.cache/pip

# Install other Python packages
RUN pip install --no-cache-dir -r requirements_prod.txt && \
    rm -rf /root/.cache/pip

#------------------------------------------------------------------------------
# Final Stage
#------------------------------------------------------------------------------
FROM nvidia/cuda:11.8.0-base-ubuntu22.04

# Set DEBIAN_FRONTEND to noninteractive
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    software-properties-common \
    wget \
    ca-certificates \
    libgl1 \
    libglib2.0-0 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxrandr2 \
    libxcursor1 \
    libxi6 \
    libxss1 \
    libxtst6 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libcairo-gobject2 \
    libpango-1.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libegl1 \
    libgles2 \
    libglvnd0 \
    libglx0 && \
    # Add deadsnakes PPA for Python 3.12 runtime
    add-apt-repository ppa:deadsnakes/ppa -y && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    python3.12 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set up paths and environment variables
ENV VENV_PATH=/opt/venv/visheart
ENV PATH="$VENV_PATH/bin:$PATH"
ENV NVIDIA_TENSORRT_DISABLE_INTERNAL_PIP=0
# Headless mode for GUI libraries
ENV DISPLAY=:99
ENV PYOPENGL_PLATFORM=egl
ENV MPLBACKEND=Agg

# Copy the virtual environment from the builder stage
COPY --from=builder $VENV_PATH $VENV_PATH

# Set the working directory
WORKDIR /app

# Copy the rest of application code
COPY . .

# Check if the models exist (and make script executable)
RUN chmod +x ./docker/scripts/docker_requisite_check.sh && \
    bash ./docker/scripts/docker_requisite_check.sh

# Make the start script executable
RUN chmod +x docker/scripts/start.sh

# Expose the port the app runs on
EXPOSE 8001

# Command to run the application
CMD ["bash","./docker/scripts/start.sh"]