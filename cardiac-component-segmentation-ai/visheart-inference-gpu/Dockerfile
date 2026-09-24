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
    gnupg \
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
    # Add deadsnakes PPA directly via keyserver, not `add-apt-repository` --
    # that shells out to Launchpad's launchpadlib REST API for the signing
    # key, which intermittently 500s with GPGKeyTemporarilyNotFoundError.
    # This talks to the keyserver directly instead, sidestepping that API.
    mkdir -p /etc/apt/keyrings && \
    wget -qO- "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0xBA6932366A755776" | gpg --dearmor -o /etc/apt/keyrings/deadsnakes.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/deadsnakes.gpg] https://ppa.launchpadcontent.net/deadsnakes/ppa/ubuntu jammy main" > /etc/apt/sources.list.d/deadsnakes.list && \
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

# cupy (RV CPD-GPU acceleration, cpd_gpu.py) is intentionally not in requirements_prod.txt --
# it's GPU-only and gpu_available() already falls back to CPU cleanly without it. Baking it in
# here means it's downloaded once at image build time instead of on every fresh container start
# (docker-compose.yml previously installed it via a startup `command:` check, which re-ran the
# ~1.5GB cupy-cuda12x[ctk] download from scratch every time the gpu-nvidia container was
# recreated -- not just restarted). The [ctk] extra bundles its own CUDA 12 userspace libraries,
# so it doesn't need to match this image's CUDA 11.8 base.
RUN pip install --no-cache-dir "cupy-cuda12x[ctk]" && \
    rm -rf /root/.cache/pip

RUN python3 -c "import nibabel; print('NIBABEL INSTALLED OK')"

#------------------------------------------------------------------------------
# Final Stage
#------------------------------------------------------------------------------
FROM nvidia/cuda:11.8.0-base-ubuntu22.04

# Set DEBIAN_FRONTEND to noninteractive
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    software-properties-common \
    gnupg \
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
    # Add deadsnakes PPA for Python 3.12 runtime, directly via keyserver --
    # `add-apt-repository` shells out to Launchpad's launchpadlib REST API
    # for the signing key, which intermittently 500s with
    # GPGKeyTemporarilyNotFoundError. This talks to the keyserver directly.
    mkdir -p /etc/apt/keyrings && \
    wget -qO- "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0xBA6932366A755776" | gpg --dearmor -o /etc/apt/keyrings/deadsnakes.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/deadsnakes.gpg] https://ppa.launchpadcontent.net/deadsnakes/ppa/ubuntu jammy main" > /etc/apt/sources.list.d/deadsnakes.list && \
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

# Landmark checkpoints. UNETRESNET34 (architecture + trained weights) lives
# outside this repo's own build context (a sibling of the outer monorepo's
# cardiac-component-segmentation-ai/ folder, and its checkpoints/ is
# gitignored there too), so it can never be reached by a plain `COPY`
# rooted at this Dockerfile's context. build.ps1 / build.sh stage exactly
# the files needed (the architecture file + both .pth checkpoints) into
# _landmark_assets/ before invoking `docker build` -- run one of those
# instead of `docker build .` directly, or this COPY fails the build with a
# clear "no such file or directory" instead of silently shipping an image
# that's missing landmark detection (the previous behaviour: the image
# built fine, and only failed at runtime when a request needed the
# checkpoint that was never copied in).
COPY _landmark_assets/models/unet_resnet34.py /app/UNETRESNET34/models/unet_resnet34.py
COPY _landmark_assets/checkpoints/ /app/UNETRESNET34/checkpoints/

# Check if the models exist (and make script executable)
RUN chmod +x ./docker/scripts/docker_requisite_check.sh && \
    bash ./docker/scripts/docker_requisite_check.sh

# Make the start script executable
RUN chmod +x docker/scripts/start.sh

# Expose the port the app runs on
EXPOSE 8001

# Command to run the application
CMD ["bash","./docker/scripts/start.sh"]