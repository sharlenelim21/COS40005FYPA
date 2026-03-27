# Example usage with FileFetchHandler
from app.classes.file_fetch_handler import FileFetchHandler
from app.classes.yolo_handler import YoloHandler
import os

# Initialize YOLO model handler with TensorRT engine for best performance
model_path = (
    "/root/visheart-inference-gpu/app/models/24April2025-single-stage-usethis.engine"
)
yolo_handler = YoloHandler(model_path)

presigned_url = (
    "https://devel-visheart-s3-bucket.s3.ap-southeast-1.amazonaws.com/source_nifti/680da34e858d216b6bcf9d52/680da34e858d216b6bcf9d52_680da34e858d216b6bcf9d59.tar"
    "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD"
    "&X-Amz-Credential=ASIAQB4Y5V67UVE3RPGC%2F20250428%2Fap-southeast-1%2Fs3%2Faws4_request"
    "&X-Amz-Date=20250428T063800Z&X-Amz-Expires=600"
    "&X-Amz-Security-Token=IQoJb3JpZ2luX2VjENb%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaDmFwLXNvdXRoZWFzdC0xIkcwRQIhAJvl3ibfGS439v6%2Fd%2BVE%2FIrq8kpPFeiuy%2BRSKq%2Fx%2B5LOAiBYI3EZkTHgzOrw9Ap6%2FCnJ6ysb%2Bd2hEyLn8%2BPaHx3v%2BirJBQhvEAAaDDAwNDA3ODgwOTAyMyIMHKIsyqTTxyN2BQQ8KqYFuY2njDj1AER03rtD%2BK1THPzCn8fD45i0FRzrvUyrWx8uyr%2FUb3aEh6w%2FdTr%2Bnic9F7JpMnOtGbPx%2Bz6japsk1qVfsRSdXKjPmin19cqDNL1duxAlfERFOz2KifeSH3iAadziEEy3V7bvFzNyq1ENY2pMJ1LEIx46vDXa78WXcJuyCXpeKuebWnOCfVDghFo%2B5JzO5cCSVovS35OJ3AXhOA7FO2sUKPUeVsM%2BNg5dJisLopx5WuMaFEQGoJnvVKc5E2m5ROd%2BGBV4SUOQo0zjRtvW1ifcJRxgngvjNEHucpcOO1Gi8xkDNVfhgRHkA28xWO7VxTf9RD%2B45BqhhkDxVwx3AQTh4Tmi95rPWIwRkI49URGdZKfvid9SWE9%2BYd9m%2FzoK0IQt%2FHOHq3TfU5E3jxq7gZAevTeJ6v36CoCmgPdN3lkQ9qpk1S%2Bs0xnbodEjNj%2FiVXgFzKZuVZkQuDEOOAaThr22fhraZJ6UgQC%2B95w5svjDLQAYiQj%2BRblhK5PywomA%2F7zSRGXGv385G6aAw43AvGRVd3YNaoAx%2B1runJb4K4KM2A6izSHnqiG3Cg4zP3tVd8TgdwYJbhhN%2BJ%2FG3tUXrslGGfkypBpEFlg5JEPwmLFNPjdxBrp9lkYECBJxO7yqXMty4%2F8wcBDpOJX3bJ9%2FVKK0zWMqupAlBeNIeRMuedOaxu7YGHAf8HqhZcgR3PyZeb%2BNEHyKdNdxPX6DdEzQPHvPEkEmAC%2BEwf5SoFgT4%2BRc%2FtItsId49Ann6cuTcwgatLsAayVbhPIHzgX9vy9e4RxQ4Ea%2Fuv%2BlBq0%2BE4tWvR30pgJyR9lU3gzXw0Swt8axG8AXP2zpHNRY0TKYpY1vOHjhq8W%2BSIAZqjP2cVpfcZsYX70ZLPM1Ho9z1MtQir4Q7cOHMLuovMAGOrIBrYRbng%2Bv1MEAFm%2BJZ4PIA61DgAZK33DKKrwBPn95XCFazXgoqLvi%2Ft8VKoi9bG1Ko7rP0yQK%2Fo8lzVpsO6Bl26ZOnyD0kXSbUKfuwBC2QeyBASHP9P4qcRPKOO8qK2YjFdtHblyJJOcnDg%2B9%2FJqUnteLxAry3lBBZiEuaGOS7OBbGsOph7uRXZffEytkXy0d6nEIsG5UgFIzCyU%2FVY0EinZ7FJx0Gt3%2BHMVPKuLgLk7pMw%3D%3D"
    "&X-Amz-Signature=60841acb517def0d904c3e476b8c0550d92370285f5754cee7f3e8132e541933"
    "&X-Amz-SignedHeaders=host"
    "&x-amz-checksum-mode=ENABLED"
    "&x-id=GetObject"
)

# Download files using FileFetchHandler
with FileFetchHandler(presigned_url) as handler:
    # Get path to extracted files or single file
    if handler.extracted_dir and os.path.exists(handler.extracted_dir):
        # Process all images in the directory
        results = yolo_handler.predict_batch(handler.extracted_dir)
    else:
        # Process single file
        results = yolo_handler.predict(handler.file_path)

    # Save or process results
    output_path = "./detection_results.json"
    yolo_handler.save_results(results, output_path)  # To fix

    # Visualize if needed
    for image_path, result in results.items():
        vis_path = f"/tmp/vis_{os.path.basename(image_path)}"
        yolo_handler.visualize_detections(image_path, result, vis_path)
        
    # Pause for user input before cleanup
    print("\nPress Enter to clean up and exit...")
    input()  # Wait for user input before cleanup
