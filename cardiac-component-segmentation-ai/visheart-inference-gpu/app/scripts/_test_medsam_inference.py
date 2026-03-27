import os
import sys
import numpy as np
import matplotlib.pyplot as plt  # Keep for optional visualization
import torch
import torch.nn.functional as F
from segment_anything import sam_model_registry
from skimage import io, transform
import argparse
import time  # For basic timing
from pathlib import Path
import cv2
from tqdm import tqdm  # For progress bar
from collections import defaultdict  # To group detections by class

# To run:
# python app/scripts/_test_medsam_inference.py --images app/scripts/test_folder --output app/scripts/test_medsam_results_optimized --yolo_model app/models/24April2025-single-stage-usethis.engine --medsam_model app/models/medsam_vit_b.pth

# Add parent directory ('app') to the Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from classes.yolo_handler import YoloHandler  # noqa: E402


# --- Visualization Functions (Optional) ---
# (Keep show_mask, show_box, create_overlay functions as they are in the original file)
def show_mask(mask, ax, random_color=False):
    """Displays a segmentation mask on a matplotlib Axes object."""
    if random_color:
        color = np.concatenate([np.random.random(3), np.array([0.6])], axis=0)
    else:
        color = np.array([251 / 255, 252 / 255, 30 / 255, 0.6])  # Yellowish
    h, w = mask.shape[-2:]
    mask_image = mask.reshape(h, w, 1) * color.reshape(1, 1, -1)
    ax.imshow(mask_image)


def show_box(box, ax):
    """Displays a bounding box on a matplotlib Axes object."""
    x0, y0 = box[0], box[1]
    w, h = box[2] - box[0], box[3] - box[1]
    ax.add_patch(
        plt.Rectangle((x0, y0), w, h, edgecolor="blue", facecolor=(0, 0, 0, 0), lw=2)
    )


def create_overlay(image_3c, detections, masks, output_path):
    """Creates and saves overlay visualization using Matplotlib."""
    num_detections = len(detections)
    # Check if masks list/array has same length as detections
    if num_detections == 0 or (
        isinstance(masks, (list, np.ndarray)) and len(masks) != num_detections
    ):
        print(
            f"Warning: Skipping visualization for {os.path.basename(output_path)} due to detection/mask count mismatch ({num_detections} vs {len(masks) if masks is not None else 'None'})."
        )
        return  # Skip if mismatch

    fig, axes = plt.subplots(
        2, num_detections, figsize=(num_detections * 5, 10), squeeze=False
    )

    for i, det in enumerate(detections):
        bbox = det["bbox"]
        class_name = det["class_name"]
        # Safely get the mask, handle case where masks might not be fully populated on error
        mask = masks[i] if (masks is not None and i < len(masks)) else None

        # Row 1: Original image with YOLO bounding box
        axes[0, i].imshow(image_3c)
        show_box(bbox, axes[0, i])
        axes[0, i].set_title(f"Detection: {class_name} ({i})")
        axes[0, i].axis("off")

        # Row 2: Original image with MedSAM segmentation overlay
        axes[1, i].imshow(image_3c)
        if mask is not None:
            show_mask(mask, axes[1, i])
        else:
            axes[1, i].text(
                0.5,
                0.5,
                "Mask Error",
                horizontalalignment="center",
                verticalalignment="center",
                transform=axes[1, i].transAxes,
                color="red",
            )

        show_box(bbox, axes[1, i])  # Show box for context
        axes[1, i].set_title(f"Segmentation: {class_name} ({i})")
        axes[1, i].axis("off")

    # Try to get original filename from detections if available
    img_file_name = "image"
    if detections:
        # Use the path stored in the detection dictionary
        img_file_name = os.path.basename(detections[0].get("img_path", "image"))

    plt.suptitle(f"Results for {img_file_name}", fontsize=16)
    plt.tight_layout(rect=[0, 0.03, 1, 0.97])
    plt.savefig(output_path)
    plt.close(fig)  # Close the figure to free memory


# --- MedSAM Inference (Single Prompt - Reverted) ---
@torch.no_grad()
def medsam_inference_single_prompt(medsam_model, img_embed, box_1024, H, W):
    """
    Performs MedSAM inference for a single image embedding and a single bounding box.
    (Reverted to original non-batch logic for stability).
    """
    box_torch = torch.as_tensor(box_1024, dtype=torch.float, device=img_embed.device)
    # Ensure box_torch has the shape (1, 1, 4) for a single box prompt
    if len(box_torch.shape) == 2:  # If shape is (1, 4)
        box_torch = box_torch[:, None, :]  # Add the prompt dimension -> (1, 1, 4)
    # If shape is already (N, 1, 4) and N=1, it's fine.

    # Encode the prompt (single box)
    sparse_embeddings, dense_embeddings = medsam_model.prompt_encoder(
        points=None,
        boxes=box_torch,  # Should be (1, 1, 4)
        masks=None,
    )

    # Decode the mask
    low_res_logits, _ = medsam_model.mask_decoder(
        image_embeddings=img_embed,  # (1, 256, 64, 64)
        image_pe=medsam_model.prompt_encoder.get_dense_pe(),  # (1, 256, 64, 64)
        sparse_prompt_embeddings=sparse_embeddings,  # (1, 2, 256) - 2 comes from pos/neg point/box embeds
        dense_prompt_embeddings=dense_embeddings,  # (1, 256, 64, 64)
        multimask_output=False,
    )
    # low_res_logits: (1, 1, 256, 256)

    # Upsample mask
    low_res_pred = torch.sigmoid(low_res_logits)  # (1, 1, 256, 256)
    low_res_pred = F.interpolate(
        low_res_pred,
        size=(H, W),
        mode="bilinear",
        align_corners=False,
    )  # (1, 1, H, W)

    # Convert to numpy array and threshold
    medsam_seg = low_res_pred.squeeze().cpu().numpy()  # (H, W)
    medsam_seg = (medsam_seg > 0.5).astype(np.uint8)
    return medsam_seg


# --- Image Preprocessing ---
def preprocess_image_medsam(img_np, device):
    """Preprocesses a numpy image array for MedSAM inference."""
    if img_np is None:
        raise ValueError("Input image is None")
    if len(img_np.shape) == 2:
        img_3c = np.repeat(img_np[:, :, None], 3, axis=-1)
    elif img_np.shape[2] == 4:  # Handle RGBA
        img_3c = cv2.cvtColor(img_np, cv2.COLOR_RGBA2RGB)
    else:
        img_3c = img_np

    H, W, _ = img_3c.shape

    # Resize to 1024x1024 using cv2
    img_1024 = cv2.resize(img_3c, (1024, 1024), interpolation=cv2.INTER_LINEAR)

    # Normalize pixel values to [0, 1] range
    img_1024_normalized = img_1024.astype(np.float32) / 255.0

    # Convert to PyTorch tensor format (B, C, H, W)
    img_1024_tensor = (
        torch.tensor(img_1024_normalized)
        .float()
        .permute(2, 0, 1)
        .unsqueeze(0)
        .to(device)
    )

    return img_1024_tensor, img_3c, H, W


# --- MODIFIED Main Pipeline Function ---
def run_yolo_medsam_pipeline_fixed(
    image_folder,
    output_folder,
    yolo_model_path,
    medsam_model_path,
    device="cuda:0",
    yolo_batch_size=8,  # Keep configurable YOLO batch
    visualize=True,
):
    """
    Runs the fixed and modified YOLO+MedSAM pipeline.
    - Filters detections: Max 3 per image, highest confidence per class.
    """
    start_time_total = time.time()

    # --- Setup ---
    masks_folder = os.path.join(output_folder, "masks")
    overlays_folder = os.path.join(output_folder, "overlays")
    os.makedirs(output_folder, exist_ok=True)
    os.makedirs(masks_folder, exist_ok=True)
    if visualize:
        os.makedirs(overlays_folder, exist_ok=True)

    # --- Load Models ---
    print(f"Loading YOLO model: {yolo_model_path}")
    yolo_handler = YoloHandler(yolo_model_path)  #

    print(f"Loading MedSAM model: {medsam_model_path}")
    medsam_model = sam_model_registry["vit_b"](checkpoint=medsam_model_path)  #
    medsam_model = medsam_model.to(device)  #
    medsam_model.eval()  #

    # --- Find Images ---
    try:
        image_files = [
            os.path.join(image_folder, f)
            for f in os.listdir(image_folder)
            if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))
        ]  #
    except FileNotFoundError:
        print(f"Error: Image folder not found at {image_folder}")
        sys.exit(1)

    if not image_files:
        print(f"Error: No images found in folder: {image_folder}")
        return

    print(f"Found {len(image_files)} images. Running YOLO batch inference...")

    # --- 1. Batch YOLO Inference ---
    start_time_yolo = time.time()
    try:
        # Perform batch prediction using YoloHandler [cite: 1]
        all_yolo_results = yolo_handler.predict_batch(
            image_files, batch_size=yolo_batch_size
        )
    except Exception as e:
        print(f"Error during YOLO batch prediction: {e}")
        if "out of memory" in str(e).lower():
            print(
                "CUDA out of memory during YOLO batch inference. Try reducing --yolo_batch_size."
            )
        return

    yolo_time = time.time() - start_time_yolo
    print(f"YOLO inference completed in {yolo_time:.2f} seconds.")

    # --- Prepare Data Structure for MedSAM & **FILTER DETECTIONS** ---
    images_to_process = {}
    total_yolo_detections_filtered = 0
    print("Filtering YOLO detections (max 3 per image, best per class)...")
    for img_path, result in all_yolo_results.items():
        detections = result.get("detections", [])
        # Add img_path to each detection dict for later reference
        for det in detections:
            det["img_path"] = img_path

        if detections:
            # --- Filtering Logic START ---
            class_groups = defaultdict(list)
            # Group detections by class name
            for det in detections:
                class_groups[det["class_name"]].append(det)

            top_detections_by_class = []
            # Find the highest confidence detection for each class
            for class_name, group in class_groups.items():
                group.sort(
                    key=lambda x: x["confidence"], reverse=True
                )  # Sort by confidence [cite: 1]
                top_detections_by_class.append(group[0])  # Keep the best one

            # Sort the best detections across all classes by confidence
            top_detections_by_class.sort(key=lambda x: x["confidence"], reverse=True)

            # Keep only the top 3 detections overall
            filtered_detections = top_detections_by_class[:3]
            # --- Filtering Logic END ---

            if filtered_detections:
                images_to_process[img_path] = {
                    "detections": filtered_detections,  # Use filtered list
                    "img_3c": None,
                    "H": None,
                    "W": None,
                    "embedding": None,
                    "masks": [],
                }
                total_yolo_detections_filtered += len(filtered_detections)
            else:
                # This case should be rare if there were initial detections
                print(
                    f"Info: No detections remained after filtering for {os.path.basename(img_path)}"
                )
        else:
            print(f"Info: No initial YOLO detections for {os.path.basename(img_path)}")

    num_imgs_with_dets = len(images_to_process)
    if num_imgs_with_dets == 0:
        print("No images with detections found after filtering. Exiting.")
        return

    print(
        f"Processing {num_imgs_with_dets} images with MedSAM (using {total_yolo_detections_filtered} filtered detections)..."
    )

    # --- 2. MedSAM Processing (Image by Image, Single Prompt per Detection) ---
    start_time_medsam = time.time()
    processed_count = 0
    skipped_error = 0
    total_medsam_segmentations = 0

    # Wrap the loop with tqdm for progress
    for img_path in tqdm(images_to_process.keys(), desc="MedSAM Processing"):
        img_data = images_to_process[img_path]
        img_file_name = os.path.basename(img_path)
        current_image_masks = []  # Store masks for this image

        try:
            # Load and Preprocess Image (once per image)
            img_np = io.imread(img_path)  #
            if img_np is None:
                raise ValueError("Failed to load image.")

            # Preprocess image for MedSAM input
            img_1024_tensor, img_3c, H, W = preprocess_image_medsam(img_np, device)
            img_data["img_3c"] = img_3c
            img_data["H"] = H
            img_data["W"] = W

            # Get MedSAM Image Embedding (once per image)
            with torch.no_grad():
                # Encode image using MedSAM's encoder
                img_data["embedding"] = medsam_model.image_encoder(img_1024_tensor)

            # Iterate through the *filtered* detections for this image
            for i, det in enumerate(img_data["detections"]):
                try:
                    bbox = det["bbox"]  # Format [x1, y1, x2, y2] [cite: 1]
                    class_name = det["class_name"]  # [cite: 1]

                    # Prepare single box prompt, scaled to 1024x1024
                    box_np = np.array([bbox])  # Shape (1, 4)
                    box_1024 = box_np / np.array([W, H, W, H]) * 1024

                    # Run MedSAM Inference for this single box
                    medsam_seg = medsam_inference_single_prompt(
                        medsam_model, img_data["embedding"], box_1024, H, W
                    )  # Returns shape (H, W)
                    current_image_masks.append(medsam_seg)
                    total_medsam_segmentations += 1

                    # Save individual mask as binary image
                    binary_mask_img = (medsam_seg * 255).astype(np.uint8)
                    mask_filename = f"{os.path.splitext(img_file_name)[0]}_{class_name}_{i}_mask.png"
                    mask_save_path = os.path.join(masks_folder, mask_filename)
                    cv2.imwrite(mask_save_path, binary_mask_img)  #

                except Exception as e_inner:
                    print(
                        f"  - Error processing detection {i} for {img_file_name}: {e_inner}"
                    )
                    current_image_masks.append(None)  # Add placeholder for error

            # Store collected masks for the image
            img_data["masks"] = current_image_masks

            # Create overlay visualization if enabled
            if visualize:
                overlay_filename = f"{os.path.splitext(img_file_name)[0]}_results.png"
                overlay_save_path = os.path.join(overlays_folder, overlay_filename)
                create_overlay(
                    img_data["img_3c"],
                    img_data["detections"],
                    img_data["masks"],
                    overlay_save_path,
                )

            processed_count += 1

            # Clean up embedding tensor for this image
            del img_data["embedding"]
            # Avoid clearing cache too often unless OOM occurs
            # if torch.cuda.is_available():
            #     torch.cuda.empty_cache()

        except Exception as e_outer:
            print(f"  - Error processing image {img_file_name}: {e_outer}")
            skipped_error += 1
            # Ensure embedding is deleted if calculated before error
            if "img_data" in locals() and img_data.get("embedding") is not None:
                del img_data["embedding"]

    medsam_time = time.time() - start_time_medsam
    total_time = time.time() - start_time_total

    # --- 4. Print Summary ---
    print("\n--- Pipeline Summary ---")
    print(f"Total images found:         {len(image_files)}")
    print(f"Images with detections:     {num_imgs_with_dets}")
    print(f"Successfully processed:     {processed_count}")
    print(f"Skipped (error):            {skipped_error}")
    print("-" * 29)
    # Updated to show filtered count
    print(f"Total Filtered YOLO dets:   {total_yolo_detections_filtered}")
    print(f"Total MedSAM segmentations: {total_medsam_segmentations}")
    print("-" * 29)
    print(f"YOLO Inference Time:        {yolo_time:.2f}s")
    print(
        f"MedSAM Inference Time:      {medsam_time:.2f}s (incl. loading, preprocessing)"
    )
    print(f"Total Pipeline Time:        {total_time:.2f}s")
    print("-" * 29)
    print(f"Results saved in:           {output_folder}")
    print(f" - Masks:                   {masks_folder}")
    if visualize:
        print(f" - Overlays:                {overlays_folder}")
    print("--- Processing Complete ---")


# Keep the __main__ block as is from the original file
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Optimized YOLO+MedSAM inference pipeline (Fixed)."
    )
    parser.add_argument(
        "--images",
        type=str,
        required=True,
        help="Path to the folder containing test images.",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="Path to the folder where results will be saved.",
    )
    parser.add_argument(
        "--yolo_model",
        type=str,
        required=True,
        help="Path to the YOLO model file (.pt, .onnx, or .engine).",
    )
    parser.add_argument(
        "--medsam_model",
        type=str,
        required=True,
        help="Path to the MedSAM model checkpoint file (.pth).",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cuda:0" if torch.cuda.is_available() else "cpu",
        help="Device for inference (e.g., 'cuda:0', 'cpu').",
    )
    parser.add_argument(
        "--yolo_batch_size",
        type=int,
        default=4,  # Smaller default for 10GB VRAM
        help="Batch size for YOLO inference.",
    )
    parser.add_argument(
        "--no-visualize",
        action="store_true",
        help="Disable saving overlay visualization images.",
    )

    args = parser.parse_args()

    # --- Path Resolution & Validation ---
    images_folder = os.path.abspath(args.images)
    output_folder = os.path.abspath(args.output)
    yolo_model_path = os.path.abspath(args.yolo_model)
    medsam_model_path = os.path.abspath(args.medsam_model)

    if not os.path.isdir(images_folder):
        print(f"Error: Images folder not found: {images_folder}")
        sys.exit(1)
    if not os.path.isfile(yolo_model_path):
        print(f"Error: YOLO model not found: {yolo_model_path}")
        sys.exit(1)
    if not os.path.isfile(medsam_model_path):
        print(f"Error: MedSAM model not found: {medsam_model_path}")
        sys.exit(1)

    # --- Run Pipeline ---
    print("\n--- Starting Fixed YOLO+MedSAM Pipeline ---")
    print(f"Image Folder:      {images_folder}")
    print(f"Output Folder:     {output_folder}")
    print(f"YOLO Model:        {yolo_model_path}")
    print(f"MedSAM Model:      {medsam_model_path}")
    print(f"Device:            {args.device}")
    print(f"YOLO Batch Size:   {args.yolo_batch_size}")
    print(f"Visualize Overlays:{not args.no_visualize}")
    print("-" * 45)

    # Call the modified function
    run_yolo_medsam_pipeline_fixed(
        images_folder,
        output_folder,
        yolo_model_path,
        medsam_model_path,
        args.device,
        args.yolo_batch_size,
        visualize=not args.no_visualize,
    )
