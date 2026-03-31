#!/usr/bin/env python3
"""
Interactive MedSAM Segmentation Tool

This script provides a GUI for:
1. Downloading images from a presigned URL
2. Selecting an image
3. Drawing a bounding box
4. Sending the box to the MedSAM API 
5. Displaying the segmentation result
"""

import os
import sys
import json
import tempfile
import requests
import numpy as np
import cv2
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
from PIL import Image, ImageTk
import urllib.parse
from pathlib import Path

# Add parent directory to Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.classes.file_fetch_handler import FileFetchHandler


class MedSAMApp:
    def __init__(self, root):
        self.root = root
        self.root.title("MedSAM Interactive Segmentation")
        self.root.geometry("1200x800")
        
        # API endpoint
        self.api_url = "http://localhost:8001/inference/v1/medsam-inference-manual"
        
        # State variables
        self.presigned_url = None
        self.handler = None
        self.temp_dir = None
        self.available_images = []
        self.current_image_path = None
        self.current_image = None
        self.current_image_display = None
        self.drawing = False
        self.bbox_start = None
        self.bbox_end = None
        self.bbox_rect = None
        self.current_mask = None
        
        # Setup UI
        self.create_ui()
        
    def create_ui(self):
        """Create the main UI components"""
        self.main_frame = ttk.Frame(self.root)
        self.main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # URL Input Section
        url_frame = ttk.LabelFrame(self.main_frame, text="S3 Presigned URL")
        url_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.url_entry = ttk.Entry(url_frame, width=80)
        self.url_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5, pady=5)
        
        fetch_button = ttk.Button(url_frame, text="Fetch Images", command=self.fetch_images)
        fetch_button.pack(side=tk.RIGHT, padx=5, pady=5)
        
        # Image Selection Section
        selection_frame = ttk.LabelFrame(self.main_frame, text="Image Selection")
        selection_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.image_listbox = tk.Listbox(selection_frame, height=5)
        self.image_listbox.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5, pady=5)
        self.image_listbox.bind('<<ListboxSelect>>', self.select_image)
        
        # Image Display Section
        display_frame = ttk.LabelFrame(self.main_frame, text="Image View (Draw Box)")
        display_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # Canvas for image display and drawing
        self.canvas_frame = ttk.Frame(display_frame)
        self.canvas_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.canvas = tk.Canvas(self.canvas_frame, bg="black", cursor="crosshair")
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.canvas.bind("<ButtonPress-1>", self.start_bbox)
        self.canvas.bind("<B1-Motion>", self.update_bbox)
        self.canvas.bind("<ButtonRelease-1>", self.end_bbox)
        
        # Results Section
        result_frame = ttk.LabelFrame(self.main_frame, text="Segmentation Result")
        result_frame.pack(fill=tk.X, padx=5, pady=5)
        
        # Buttons for actions
        action_frame = ttk.Frame(result_frame)
        action_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.segment_button = ttk.Button(
            action_frame, text="Run Segmentation", command=self.run_segmentation, state=tk.DISABLED
        )
        self.segment_button.pack(side=tk.LEFT, padx=5, pady=5)
        
        self.clear_button = ttk.Button(
            action_frame, text="Clear Box", command=self.clear_bbox, state=tk.DISABLED
        )
        self.clear_button.pack(side=tk.LEFT, padx=5, pady=5)
        
        self.save_button = ttk.Button(
            action_frame, text="Save Result", command=self.save_result, state=tk.DISABLED
        )
        self.save_button.pack(side=tk.LEFT, padx=5, pady=5)
        
        # Log and status area
        self.log_text = scrolledtext.ScrolledText(self.main_frame, height=5)
        self.log_text.pack(fill=tk.X, padx=5, pady=5)
        self.log_text.insert(tk.END, "Welcome to MedSAM Interactive Segmentation Tool\n")
        self.log_text.insert(tk.END, "1. Enter a presigned S3 URL and click 'Fetch Images'\n")
        self.log_text.insert(tk.END, "2. Select an image from the list\n")
        self.log_text.insert(tk.END, "3. Draw a bounding box around the area of interest\n")
        self.log_text.insert(tk.END, "4. Click 'Run Segmentation' to get the result\n")
        
    def log(self, message):
        """Add a message to the log area"""
        self.log_text.insert(tk.END, f"{message}\n")
        self.log_text.see(tk.END)
        
    def fetch_images(self):
        """Download and extract images from the presigned URL"""
        url = self.url_entry.get().strip()
        if not url:
            messagebox.showerror("Error", "Please enter a valid presigned URL")
            return
            
        self.presigned_url = url
        self.log(f"Fetching images from URL... (this may take a moment)")
        self.root.update()
        
        try:
            # Clean up previous handler if exists
            if self.handler:
                self.handler.__exit__(None, None, None)
                self.handler = None
                
            # Create a new handler
            self.handler = FileFetchHandler(url)
            self.handler.__enter__()
            
            # Check if extraction was successful
            if not hasattr(self.handler, "extracted_dir") or not os.path.exists(self.handler.extracted_dir):
                messagebox.showerror("Error", "Failed to extract files from the URL")
                return
                
            # Find all image files
            self.available_images = [
                f for f in os.listdir(self.handler.extracted_dir)
                if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))
            ]
            
            if not self.available_images:
                messagebox.showerror("Error", "No valid image files found in the archive")
                return
                
            # Update the listbox
            self.image_listbox.delete(0, tk.END)
            for img in self.available_images:
                self.image_listbox.insert(tk.END, img)
                
            self.log(f"Found {len(self.available_images)} images in the archive")
            
        except Exception as e:
            messagebox.showerror("Error", f"Failed to fetch images: {str(e)}")
            self.log(f"Error: {str(e)}")
            
    def select_image(self, event):
        """Handle image selection from the listbox"""
        selection = self.image_listbox.curselection()
        if not selection:
            return
            
        image_name = self.image_listbox.get(selection[0])
        self.current_image_path = os.path.join(self.handler.extracted_dir, image_name)
        
        try:
            # Load and display the image
            self.current_image = cv2.imread(self.current_image_path)
            if self.current_image is None:
                messagebox.showerror("Error", f"Failed to load image: {image_name}")
                return
                
            # Convert to RGB for display
            self.current_image_rgb = cv2.cvtColor(self.current_image, cv2.COLOR_BGR2RGB)
            
            # Clear previous drawings
            self.clear_bbox()
            
            # Resize image to fit canvas while maintaining aspect ratio
            self.display_image()
            
            self.log(f"Selected image: {image_name}")
            
        except Exception as e:
            messagebox.showerror("Error", f"Error loading image: {str(e)}")
            self.log(f"Error: {str(e)}")
            
    def display_image(self):
        """Display the current image on the canvas"""
        if self.current_image is None:
            return
            
        # Get canvas dimensions
        canvas_width = self.canvas.winfo_width()
        canvas_height = self.canvas.winfo_height()
        
        if canvas_width <= 1 or canvas_height <= 1:
            # Canvas not fully initialized yet, wait a bit and retry
            self.root.after(100, self.display_image)
            return
            
        # Get image dimensions
        img_height, img_width = self.current_image.shape[:2]
        
        # Calculate scaling to fit the canvas
        width_ratio = canvas_width / img_width
        height_ratio = canvas_height / img_height
        scale = min(width_ratio, height_ratio)
        
        # Calculate new dimensions
        new_width = int(img_width * scale)
        new_height = int(img_height * scale)
        
        # Resize the image
        resized_img = cv2.resize(self.current_image_rgb, (new_width, new_height))
        
        # Convert to PhotoImage
        self.display_img = Image.fromarray(resized_img)
        self.photo_img = ImageTk.PhotoImage(image=self.display_img)
        
        # Clear canvas and display image
        self.canvas.delete("all")
        self.img_id = self.canvas.create_image(
            canvas_width//2, canvas_height//2, 
            image=self.photo_img, anchor=tk.CENTER
        )
        
        # Store information for coordinate conversion
        self.img_position = {
            'x': (canvas_width - new_width) // 2,
            'y': (canvas_height - new_height) // 2,
            'scale': scale,
            'width': new_width,
            'height': new_height
        }
        
        # Enable buttons
        self.clear_button.config(state=tk.NORMAL)
        
    def start_bbox(self, event):
        """Start drawing a bounding box"""
        if self.current_image is None:
            return
            
        # Convert canvas coordinates to image coordinates
        img_pos = self.img_position
        x = (event.x - img_pos['x']) / img_pos['scale']
        y = (event.y - img_pos['y']) / img_pos['scale']
        
        # Check if click is within the image
        if 0 <= x < self.current_image.shape[1] and 0 <= y < self.current_image.shape[0]:
            self.drawing = True
            self.bbox_start = (x, y)
            
            # Clear any previous bounding box
            if self.bbox_rect:
                self.canvas.delete(self.bbox_rect)
                self.bbox_rect = None
                
            # Create a new rectangle
            canvas_x = event.x
            canvas_y = event.y
            self.bbox_rect = self.canvas.create_rectangle(
                canvas_x, canvas_y, canvas_x, canvas_y,
                outline="red", width=2
            )
            
    def update_bbox(self, event):
        """Update the bounding box as the mouse is dragged"""
        if not self.drawing or self.bbox_rect is None:
            return
            
        # Calculate the coordinates on the canvas
        img_pos = self.img_position
        start_canvas_x = self.bbox_start[0] * img_pos['scale'] + img_pos['x']
        start_canvas_y = self.bbox_start[1] * img_pos['scale'] + img_pos['y']
        
        # Update the rectangle
        self.canvas.coords(self.bbox_rect, start_canvas_x, start_canvas_y, event.x, event.y)
        
    def end_bbox(self, event):
        """Finalize the bounding box"""
        if not self.drawing:
            return
            
        self.drawing = False
        
        # Convert canvas coordinates to image coordinates
        img_pos = self.img_position
        end_x = (event.x - img_pos['x']) / img_pos['scale']
        end_y = (event.y - img_pos['y']) / img_pos['scale']
        
        # Ensure coordinates are within image bounds
        end_x = max(0, min(end_x, self.current_image.shape[1]-1))
        end_y = max(0, min(end_y, self.current_image.shape[0]-1))
        
        # Order coordinates properly (x1,y1,x2,y2)
        x1 = min(self.bbox_start[0], end_x)
        y1 = min(self.bbox_start[1], end_y)
        x2 = max(self.bbox_start[0], end_x)
        y2 = max(self.bbox_start[1], end_y)
        
        self.bbox_end = (end_x, end_y)
        self.bbox_coords = [x1, y1, x2, y2]
        
        # Log the coordinates
        self.log(f"Bounding box: {[round(x, 2) for x in self.bbox_coords]}")
        
        # Enable segmentation button
        self.segment_button.config(state=tk.NORMAL)
        
    def clear_bbox(self):
        """Clear the current bounding box"""
        if self.bbox_rect:
            self.canvas.delete(self.bbox_rect)
            self.bbox_rect = None
            self.bbox_start = None
            self.bbox_end = None
            self.bbox_coords = None
            self.segment_button.config(state=tk.DISABLED)
            self.save_button.config(state=tk.DISABLED)
            self.log("Cleared bounding box")
            
    def run_segmentation(self):
        """Call the MedSAM API to generate a segmentation mask"""
        if not self.current_image_path or not self.bbox_coords:
            messagebox.showerror("Error", "Please select an image and draw a bounding box first")
            return
            
        try:
            # Prepare the request payload
            image_name = os.path.basename(self.current_image_path)
            payload = {
                "url": self.presigned_url,
                "image_name": image_name,
                "bbox": self.bbox_coords
            }
            
            self.log(f"Sending request to MedSAM API...")
            self.root.update()
            
            # Add Authorization header for development environments
            headers = {
                "Authorization": "Bearer dummy-token-for-development"
            }
            
            # Call the API with the Authorization header
            response = requests.post(self.api_url, json=payload, headers=headers)
            
            if response.status_code != 200:
                error_msg = f"API error: {response.status_code} - {response.text}"
                messagebox.showerror("API Error", error_msg)
                self.log(error_msg)
                return
                
            # Parse the response
            result = response.json()
            
            if not result or image_name not in result:
                messagebox.showerror("Error", "No valid segmentation result received")
                return
                
            # Display the segmentation result
            self.display_segmentation(result[image_name])
            
        except Exception as e:
            messagebox.showerror("Error", f"Error running segmentation: {str(e)}")
            self.log(f"Error: {str(e)}")
            
    def display_segmentation(self, mask_data):
        """Display the segmentation result on the image"""
        if self.current_image is None:
            return
            
        try:
            # Create a copy of the original image
            overlay = self.current_image.copy()
            height, width = overlay.shape[:2]
            
            # Define colors for different classes (BGR format)
            colors = {
                "manual": (0, 255, 255),  # Yellow for manual mask
                "lv": (0, 255, 0),        # Green for left ventricle
                "rv": (255, 0, 0),        # Blue for right ventricle
                "myo": (0, 0, 255),       # Red for myocardium
            }
            
            # Process each mask
            for class_name, rle_string in mask_data.items():
                # Decode RLE string to binary mask
                runs = [int(x) for x in rle_string.split()]
                size = height * width
                mask = np.zeros(size, dtype=np.uint8)
                
                for i in range(0, len(runs), 2):
                    start_idx = runs[i]
                    if i + 1 < len(runs) and start_idx < size:
                        end_idx = min(start_idx + runs[i + 1], size)
                        mask[start_idx:end_idx] = 1
                
                binary_mask = mask.reshape(height, width)
                
                # Create a colored mask
                color = colors.get(class_name, (255, 255, 255))
                colored_mask = np.zeros_like(overlay)
                colored_mask[binary_mask == 1] = color
                
                # Apply the mask with transparency
                alpha = 0.5
                mask_pixels = binary_mask == 1
                overlay[mask_pixels] = cv2.addWeighted(
                    overlay[mask_pixels], 1-alpha, colored_mask[mask_pixels], alpha, 0
                )
                
                # Draw contour around the mask
                contours, _ = cv2.findContours(
                    binary_mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
                )
                cv2.drawContours(overlay, contours, -1, color, 2)
                
                self.log(f"Applied mask for class: {class_name}")
                
            # Convert to RGB for display
            overlay_rgb = cv2.cvtColor(overlay, cv2.COLOR_BGR2RGB)
            
            # Save the result for later saving
            self.current_mask = {
                'overlay': overlay,
                'mask_data': mask_data
            }
            
            # Update the display
            self.current_image_rgb = overlay_rgb
            self.display_image()
            
            # Enable save button
            self.save_button.config(state=tk.NORMAL)
            
            self.log("Segmentation complete")
            
        except Exception as e:
            messagebox.showerror("Error", f"Error displaying segmentation: {str(e)}")
            self.log(f"Error: {str(e)}")
            
    def save_result(self):
        """Save the segmentation result to a file"""
        if self.current_mask is None:
            return
            
        try:
            # Generate a default filename
            image_name = os.path.basename(self.current_image_path)
            base_name = os.path.splitext(image_name)[0]
            default_filename = f"{base_name}_segmentation.jpg"
            
            # Ask user for save location
            from tkinter import filedialog
            save_path = filedialog.asksaveasfilename(
                initialfile=default_filename,
                defaultextension=".jpg",
                filetypes=[("JPEG files", "*.jpg"), ("All files", "*.*")]
            )
            
            if not save_path:
                return
                
            # Save the overlay image
            cv2.imwrite(save_path, self.current_mask['overlay'])
            
            # Also save the mask data as JSON
            json_path = os.path.splitext(save_path)[0] + "_masks.json"
            with open(json_path, 'w') as f:
                json.dump({image_name: self.current_mask['mask_data']}, f, indent=2)
                
            self.log(f"Saved segmentation to: {save_path}")
            self.log(f"Saved mask data to: {json_path}")
            
        except Exception as e:
            messagebox.showerror("Error", f"Error saving result: {str(e)}")
            self.log(f"Error: {str(e)}")
            
    def cleanup(self):
        """Clean up resources when the application closes"""
        if self.handler:
            try:
                self.handler.__exit__(None, None, None)
            except:
                pass


if __name__ == "__main__":
    root = tk.Tk()
    app = MedSAMApp(root)
    
    # Clean up when the window is closed
    root.protocol("WM_DELETE_WINDOW", lambda: [app.cleanup(), root.destroy()])
    
    root.mainloop()