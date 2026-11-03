# VisHeart Local Deployment

`docker-compose.yml` runs the whole stack: the combined frontend + backend (`visheart-app`), MongoDB, Redis,
MinIO, and the inference service (`gpu-cpu` or `gpu-nvidia` profile). On Windows, `start.bat` / `start.ps1` start
it. On Linux, use `./start.sh` (`--cpu` or `--gpu` to force a profile) after the one-time setup below.

## Linux setup

Docker Desktop on Windows hides several steps that a fresh Linux clone needs. Do these once, from the repository
root (`COS40005FYPA/`), with Docker Engine and the compose plugin installed and your user in the `docker` group.

### 1. Build the backend's `dist` folder (Node 18)

`visheart-app` mounts `Cardiac_Segmentation_FYP_Server/dist` read-only and runs the backend from it. `dist` is
gitignored, so a fresh clone has none and the container cannot start. Build it with Node 18 (the version the
image uses):

```bash
cd cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server
npm ci && npm run build
```

Without Node 18 on the host, build it in a container instead (files stay owned by you):

```bash
cd cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/src -w /src node:18 sh -c "npm ci && npm run build"
```

Rebuild after pulling backend changes.

### 2. Folders Docker mounts into

Docker on Linux cannot create a mount point inside a read-only mount, so these folders must exist before
`docker compose up` ("read-only file system" error otherwise):

- `Cardiac_Segmentation_FYP_Server/dist/temp_jpeg`, `temp_mesh`, `temp_upload`, `temp_exports`: created by
  `npm run build` (its `postbuild` step).
- `UNETRESNET34/checkpoints`: kept in the repository with a `.gitkeep`.

On an older checkout without those changes, create them by hand:

```bash
mkdir -p UNETRESNET34/checkpoints \
  cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server/dist/{temp_jpeg,temp_mesh,temp_upload,temp_exports}
```

### 3. Copy `unet.pth` and `medsam_vit_b.pth` out of the inference image

The inference services mount `visheart-inference-gpu/app/models` over the image's model folder, which hides the
`unet.pth` and `medsam_vit_b.pth` baked into `sharlene21/visheart-gpu`. Both are gitignored, so copy them out of
the image once:

```bash
cd cardiac-component-segmentation-ai/visheart-inference-gpu
docker pull sharlene21/visheart-gpu:latest
docker run --rm --entrypoint ls sharlene21/visheart-gpu:latest -l /app/app/models   # check what the image has
id=$(docker create sharlene21/visheart-gpu:latest)
docker cp "$id:/app/app/models/unet.pth" app/models/unet.pth
docker cp "$id:/app/app/models/medsam_vit_b.pth" app/models/medsam_vit_b.pth
docker rm "$id"
```

If the stack is already running, restart the inference container afterwards (`docker restart visheart-gpu-cpu`
or `visheart-gpu-nvidia`). MedSAM only runs on the `gpu` profile; the CPU profile skips loading it.

### 4. NVIDIA GPU: install the NVIDIA Container Toolkit (`--profile gpu` only)

The `gpu-nvidia` service needs the NVIDIA driver on the host plus the NVIDIA Container Toolkit. On Ubuntu/Debian
(see NVIDIA's "Installing the NVIDIA Container Toolkit" guide for other distributions):

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Check: this is the same test start.sh runs before choosing the gpu profile.
docker run --rm --gpus all nvidia/cuda:12.3.0-base-ubuntu22.04 nvidia-smi
```

Without it, `start.sh` falls back to the CPU profile.

### 5. MinIO images that cannot be pulled

`minio/minio` and `minio/mc` were removed from Docker Hub (around September 2026), so `docker compose pull` fails
for them on a machine that has never pulled them. Until the compose file moves to a replacement image, copy them
from a machine that still has them cached:

```bash
# On the machine that has the images (check with: docker image ls minio/*)
docker save minio/minio:latest minio/mc:latest -o visheart-minio-images.tar

# On the new machine
docker load -i visheart-minio-images.tar
```

Then start the stack without pulling MinIO again (`./start.sh`, or `docker compose --profile cpu up -d`).

### 6. Start

```bash
cd cardiac-component-segmentation-ai/visheart-local-deployment
./start.sh          # or ./start.sh --cpu / --gpu
```

Open http://localhost:3000.
