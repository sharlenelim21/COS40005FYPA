## 1. Optimize Model Loading and Memory Management

### Current Issue

In inference_route.py, MedSAM model is loaded for each request and `torch.cuda.empty_cache()` is called frequently, indicating memory pressure.

### Recommendation

```python
# Add model caching with singleton pattern in dependencies/model_init.py
# Keep models in memory between requests, but implement intelligent unloading
if torch.cuda.memory_allocated() / torch.cuda.max_memory_allocated() > 0.8:
    torch.cuda.empty_cache()
```

**Expected improvement**: Reduced latency between requests by ~2-3 seconds by avoiding model reloading.
**Trade-off**: Higher baseline memory usage but more consistent performance.

## 2. Implement True Batch Processing for MedSAM

### Current Issue

In \_test_medsam_inference.py, MedSAM processes one bounding box at a time, even though YOLO uses batch processing.

### Recommendation

```python
# Batch multiple prompts for a single image embedding
def process_batched_prompts(img_embed, boxes_1024, H, W):
    # Process multiple boxes in one forward pass
    boxes_torch = torch.as_tensor(boxes_1024, dtype=torch.float, device=img_embed.device)
    # Shape: (1, N, 4) where N is number of boxes
    sparse_embeddings, dense_embeddings = medsam_model.prompt_encoder(
        points=None,
        boxes=boxes_torch,
        masks=None,
    )
    # Process all boxes at once
    masks = medsam_model.mask_decoder(...)
    return masks
```

**Expected improvement**: 2-3x speedup for images with multiple detections (common in cardiac MRIs).
**Trade-off**: More memory usage per inference, but fewer total operations.

## 3. TensorRT Optimization for MedSAM

### Current Issue

While YOLO uses TensorRT (`.engine` files), MedSAM is still running in PyTorch (`medsam_vit_b.pth`).

### Recommendation

```python
# Create conversion script similar to app/scripts/_yolo_to_tensorrt.py for MedSAM
def convert_medsam_to_tensorrt():
    # Export image encoder and mask decoder to TensorRT
    # Use dynamic shapes for different input sizes

# In inference code, use TensorRT models where available
if os.path.exists("medsam_encoder.engine"):
    medsam_encoder = TRTModule()
    medsam_encoder.load_state_dict(torch.load("medsam_encoder.engine"))
```

**Expected improvement**: 2-4x speedup on inference time based on similar gains shown in \_torch_vs_tensorrt.py.
**Trade-off**: Conversion complexity and less flexibility with fixed input sizes.

## 4. Download and Extract Optimization

### Current Issue

In file_fetch_handler.py, files are fully downloaded before processing and the chunk size is small (8192 bytes).

### Recommendation

```python
# Increase chunk size for faster download
response = requests.get(self.presigned_url, stream=True)
with open(self.file_path, "wb") as f:
    for chunk in response.iter_content(chunk_size=1024*1024):  # Use 1MB chunks
        f.write(chunk)

# For tar files, implement on-demand extraction
# Only extract files as needed, not all at once
```

**Expected improvement**: 20-30% faster download times for large files, reduced disk I/O.
**Trade-off**: Slightly more complex extraction logic.

## 5. Model Pruning and Quantization

### Current Issue

Models are using full precision which is unnecessary for inference.

### Recommendation

```python
# Add quantization support to model loading
def load_quantized_model():
    # Load PyTorch model
    model = torch.load("medsam_vit_b.pth")
    # Quantize to INT8
    quantized_model = torch.quantization.quantize_dynamic(
        model, {torch.nn.Linear}, dtype=torch.qint8
    )
    return quantized_model
```

**Expected improvement**: 2-3x memory reduction and 30-50% inference speedup.
**Trade-off**: Small (<1%) potential reduction in accuracy, though medical applications are sensitive to this.

## 6. Filter Detections Earlier in Pipeline

### Current Issue

In inference_route.py, all detections are processed before filtering, creating unnecessary work.

### Recommendation

```python
# Move filtering earlier in the pipeline
def predict_and_filter(self, image_path):
    results = self.model(image_path, verbose=False)
    processed = self._process_results(results, image_path)

    # Filter immediately after detection
    filtered = filter_detections(processed["detections"])
    processed["detections"] = filtered

    return processed
```

**Expected improvement**: Reduces unnecessary processing by 30-50% for images with many initial detections.
**Trade-off**: Slightly more complex code flow.

## Implementation Priority

1. **TensorRT conversion for MedSAM** - Highest impact for core inference time
2. **True batch processing** - Significant impact for multi-detection cases
3. **Model quantization** - Good balance of impact vs. implementation difficulty
4. **Download optimization** - Important for production deployments
5. **Memory management improvements** - Critical for stability

Would you like me to provide more detailed implementation guidance for any specific optimization?
