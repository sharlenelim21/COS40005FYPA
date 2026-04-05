import torch
import numpy as np
import json
import os
import sys
import asyncio
import threading
import time
import gc
import tempfile
import warnings
import SimpleITK as sitk
import cv2
import trimesh
import plyfile
from typing import Dict, List, Any, Optional, Tuple
import logging

# Add the dependencies directory to path
DEPENDENCIES_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dependencies")
sys.path.insert(0, DEPENDENCIES_PATH)

import deep_sdf
import deep_sdf.workspace as ws
import deep_sdf.mesh
import deep_sdf.dataset
from mesh_to_sdf.mesh_to_sdf import ComputeNormalizationParameters, transformation, sample_sdf_near_surface
from deep_sdf.obj_process import obj_read

# Import from get_P.py for contour extraction and affine matrix computation
from get_P import get_contour, get_T


class FourDReconstructionHandler:
    def __init__(self, model_path: str, specs_config: Optional[dict] = None):
        """
        Initialize the 4D Reconstruction handler
        
        Args:
            model_path (str): Direct path to the model .pth file
            specs_config (dict): Optional specifications config. If None, uses default config.
        """
        self.model_path = model_path
        self.specs = specs_config or self._get_default_specs()
        self.decoder = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Model configuration from specs
        self.frame_num = self.specs["FrameNum"]
        self.Cs_size = self.specs["CsLength"]
        self.Cm_size = self.specs["CmLength"]
        self.N = self.specs["SamplesPerScene"]
        self.clamp_dist = self.specs.get("ClampingDistance", 0.1)
        self.max_batch = int(2 ** 17)
        
        self._load_model()
    
    def _get_default_specs(self):
        """Return default specifications for the 4D reconstruction model"""
        # Default specs.json
        return {
            "NetworkArch": "decoder",
            "NetworkSpecs": {
                "motionmodel_kargs": {
                    "dim": 4,
                    "in_features": 256,
                    "out_features": 3,
                    "num_filters": 32
                },
                "shapemodel_kargs": {
                    "latent_size": 256,
                    "dims": [512, 512, 512, 512, 512, 512, 512, 512],
                    "dropout": [0, 1, 2, 3, 4, 5, 6, 7],
                    "dropout_prob": 0.2,
                    "norm_layers": [0, 1, 2, 3, 4, 5, 6, 7],
                    "latent_in": [4],
                    "xyz_in_all": False,
                    "use_tanh": False,
                    "latent_dropout": False,
                    "weight_norm": True
                }
            },
            "CsLength": 256,
            "CmLength": 256,
            "FrameNum": 25,
            "SamplesPerScene": 1000,
            "ClampingDistance": 0.1
        }
        
    def _load_model(self):
        """Load the 4D reconstruction model from the specified model file path"""
        logger = logging.getLogger("visheart")
        try:
            model_name = self.model_path.split('/')[-1]
            logger.info(f"Loading 4D Reconstruction from {model_name}")
            logger.info(f"Frame num: {self.frame_num}, Cs size: {self.Cs_size}, Cm size: {self.Cm_size}")
            
            # Import architecture dynamically
            arch = __import__("networks." + self.specs["NetworkArch"], fromlist=["Decoder"])
            
            # Create decoder instance
            self.decoder = arch.Decoder(**self.specs["NetworkSpecs"]).to(self.device)
            
            # Load trained weights directly from the model file
            if not os.path.isfile(self.model_path):
                raise Exception(f'Model file not found: {self.model_path}')
            
            # Suppress warnings during model loading
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=FutureWarning, message=".*torch.load.*weights_only.*")
                warnings.filterwarnings("ignore", category=FutureWarning, message=".*weight_norm.*deprecated.*")
                saved_model_state = torch.load(self.model_path, map_location=self.device)
            
            self.decoder.load_state_dict(saved_model_state["model_state_dict"])
            self.decoder.eval()
            
            # AUTOGRAD FIX: Initialize model with clean gradient state
            for param in self.decoder.parameters():
                param.grad = None
                param.requires_grad_(True)  # Enable gradients for training/optimization
            
            epoch = saved_model_state.get('epoch', 'unknown')
            logger.info(f"4D Reconstruction model loaded successfully from epoch {epoch}")
            
        except Exception as e:
            logger.error(f"Error loading 4D Reconstruction model: {e}")
            raise e
    
    def _clear_gpu_memory(self):
        """Clear GPU memory and cache"""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            gc.collect()
    
    def _reset_model_state(self):
        """Reset model state to prevent autograd graph conflicts"""
        if self.decoder is not None:
            # Clear any accumulated gradients
            for param in self.decoder.parameters():
                param.grad = None
            
            # Ensure model is in evaluation mode
            self.decoder.eval()
            
            # Clear GPU cache
            torch.cuda.empty_cache()
    
    def _prepare_frame_processing(self):
        """Prepare for frame processing to avoid autograd conflicts"""
        self._reset_model_state()
    
    def _force_gpu_sync(self):
        """Force GPU synchronization and memory cleanup"""
        if torch.cuda.is_available():
            torch.cuda.synchronize()  # Wait for all GPU operations to complete
            torch.cuda.empty_cache()  # Clear cache
            gc.collect()  # Force garbage collection
    
    def _create_isolated_tensor(self, data, requires_grad=False):
        """Create completely isolated tensor to prevent graph connections"""
        if isinstance(data, torch.Tensor):
            # Detach, clone, and ensure correct device placement
            return data.detach().clone().to(self.device).requires_grad_(requires_grad)
        elif isinstance(data, np.ndarray):
            # Create fresh tensor from numpy
            return torch.from_numpy(data.copy()).float().to(self.device).requires_grad_(requires_grad)
        else:
            # Create new tensor with explicit device placement
            return torch.tensor(data, dtype=torch.float32, device=self.device, requires_grad=requires_grad)
    
    def _complete_model_reset(self):
        """Complete model reset for maximum autograd isolation"""
        if self.decoder is not None:
            # Step 1: Clear all gradients and set to eval mode
            self.decoder.eval()
            for param in self.decoder.parameters():
                param.grad = None
                param.requires_grad_(True)  # Reset to default trainable state
            
            # Step 2: Force GPU synchronization and memory cleanup
            self._force_gpu_sync()
            
            # Step 3: Reset internal optimizer states (if any cached in model)
            # This is important for models that might cache optimizer state
            for module in self.decoder.modules():
                if hasattr(module, 'reset_parameters'):
                    # Don't reset weights, just internal states
                    pass
            
            # Step 4: Clear any potential cached intermediate results
            if hasattr(self.decoder, 'cached_forward'):
                self.decoder.cached_forward = None
            
            # Step 5: Final GPU sync
            torch.cuda.synchronize()
    
    def _verify_tensor_devices(self, **tensors):
        """Verify all tensors are on the correct device"""
        for name, tensor in tensors.items():
            if isinstance(tensor, torch.Tensor):
                if tensor.device != self.device:
                    print(f"WARNING: Tensor '{name}' is on {tensor.device}, expected {self.device}")
                    return False
        return True
    
    def _get_random_seed(self) -> int:
        """
        Get random seed from environment variables
        
        Returns:
            Random seed integer (default: 42)
        
        Environment Variables:
            RECONSTRUCTION_USE_FIXED_SEED: If "true", use fixed seed; otherwise use time-based seed
            RECONSTRUCTION_RANDOM_SEED: Fixed seed value (default: 42)
        """
        use_fixed_seed = os.getenv('RECONSTRUCTION_USE_FIXED_SEED', 'true').lower() == 'true'
        
        if use_fixed_seed:
            seed = int(os.getenv('RECONSTRUCTION_RANDOM_SEED', '42'))
            print(f"Using fixed random seed: {seed}")
            return seed
        else:
            seed = int(time.time()) % 10000
            print(f"Using time-based random seed: {seed}")
            return seed
    
    def _isolate_request_context(self):
        """Create completely isolated context for each request"""
        # Complete model reset
        self._complete_model_reset()
        
        # Force garbage collection
        gc.collect()
        
        # Additional GPU memory management
        if torch.cuda.is_available():
            # Clear all GPU caches
            torch.cuda.empty_cache()
            # Reset GPU memory stats (if available)
            if hasattr(torch.cuda, 'reset_peak_memory_stats'):
                torch.cuda.reset_peak_memory_stats()
        
        # Set random seeds for reproducibility
        seed = self._get_random_seed()
        torch.manual_seed(seed)
        np.random.seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)  # For multi-GPU setups
        
        # Force garbage collection
        gc.collect()
        
        print(f"GPU memory before frame processing: {torch.cuda.memory_allocated() / 1024**2:.1f} MB")
    
    def _detect_nifti_dimensions(self, nifti_file_path: str) -> Tuple[bool, int]:
        """
        Detect if NiFTI is 4D and return temporal dimension size
        
        Args:
            nifti_file_path: Path to NiFTI file
            
        Returns:
            Tuple of (is_4d, num_temporal_frames)
        """
        try:
            img = sitk.ReadImage(nifti_file_path)
            size = img.GetSize()
            
            if len(size) == 4:  # 4D NiFTI (X, Y, Z, T)
                print(f"Detected 4D NiFTI with dimensions: {size}")
                return True, size[3]
            elif len(size) == 3:  # 3D NiFTI (X, Y, Z)
                print(f"Detected 3D NiFTI with dimensions: {size}")
                return False, 1
            else:
                raise ValueError(f"Unsupported NiFTI dimensions: {len(size)} - Expected 3D or 4D")
                
        except Exception as e:
            print(f"Error detecting NiFTI dimensions: {e}")
            raise e
    
    def _extract_temporal_frames(self, nifti_4d_path: str, ed_frame_index: int, 
                               process_all_frames: bool = True) -> Tuple[List[str], List[int]]:
        """
        Extract individual 3D frames from 4D NiFTI and save as temporary files
        
        Args:
            nifti_4d_path: Path to 4D NiFTI file
            ed_frame_index: Zero-indexed ED frame number
            process_all_frames: Whether to process all frames or ED only
            
        Returns:
            Tuple of (temp_frame_paths, frame_indices)
        """
        try:
            img_4d = sitk.ReadImage(nifti_4d_path)
            size = img_4d.GetSize()
            num_frames = size[3]
            
            print(f"Processing 4D NiFTI: {num_frames} temporal frames")
            
            # Validate ED frame index
            if ed_frame_index >= num_frames:
                raise ValueError(f"ED frame index {ed_frame_index} >= total frames {num_frames}")
            
            # Determine which frames to process
            if process_all_frames:
                # Process all frames
                frame_indices = list(range(num_frames))
                print(f"Processing all {len(frame_indices)} frames")
            else:
                frame_indices = [ed_frame_index]  # ED only
                print(f"Processing ED frame only: {ed_frame_index}")
            
            # Create temporary directory for extracted frames
            temp_dir = tempfile.mkdtemp(prefix="4d_frames_")
            temp_frame_paths = []
            
            # Extract frames
            for i, frame_idx in enumerate(frame_indices):
                # Extract single frame from 4D volume
                frame_3d = img_4d[:, :, :, frame_idx]
                
                # Save as temporary 3D NiFTI
                frame_filename = f"frame_{i:02d}_orig{frame_idx:02d}.nii.gz"
                frame_path = os.path.join(temp_dir, frame_filename)
                sitk.WriteImage(frame_3d, frame_path)
                temp_frame_paths.append(frame_path)
                
                print(f"Extracted frame {i} (original {frame_idx}) -> {frame_path}")
            
            return temp_frame_paths, frame_indices
            
        except Exception as e:
            print(f"Error extracting temporal frames: {e}")
            raise e
    
    def _is_4d_nifti(self, nifti_path: str) -> bool:
        """Check if input is 4D NiFTI"""
        is_4d, _ = self._detect_nifti_dimensions(nifti_path)
        return is_4d
    
    def _extract_contour_from_nifti_sync(self, nifti_file_path: str) -> np.ndarray:
        """
        Extract 3D point cloud contour from NiFTI segmentation file
        
        Args:
            nifti_file_path: Path to NiFTI segmentation file
            
        Returns:
            numpy array of 3D points
        """
        try:
            # Suppress SimpleITK warnings
            sitk.ProcessObject_SetGlobalWarningDisplay(False)
            
            # Use get_contour from get_P.py
            points = get_contour(nifti_file_path)
            print(f"Extracted {len(points)} contour points from {nifti_file_path}")
            return points
            
        except Exception as e:
            print(f"Error extracting contour from {nifti_file_path}: {e}")
            raise e
    
    def _extract_affine_matrix_sync(self, nifti_file_path: str) -> Tuple[np.ndarray, np.ndarray, float]:
        """
        Extract affine transformation matrix from NiFTI file
        
        Args:
            nifti_file_path: Path to NiFTI segmentation file
            
        Returns:
            Tuple of (T matrix, offset, scale)
        """
        try:
            # Create temporary directory structure expected by get_T
            with tempfile.TemporaryDirectory() as temp_dir:
                # Create the directory structure that get_T expects
                patient_dir = os.path.join(temp_dir, "patient001")
                os.makedirs(patient_dir, exist_ok=True)
                
                # Copy the NiFTI file to expected location
                import shutil
                filename = os.path.basename(nifti_file_path)
                temp_nifti_path = os.path.join(patient_dir, filename)
                shutil.copy2(nifti_file_path, temp_nifti_path)
                
                # Extract affine matrix using get_T
                T, offset, scale = get_T(temp_dir, "acdc", "patient001", filename)
                
                print(f"Extracted affine matrix from {nifti_file_path}")
                return T, offset, scale
                
        except Exception as e:
            print(f"Error extracting affine matrix from {nifti_file_path}: {e}")
            raise e
    
    def _transform_to_canonical_in_memory(self, point_cloud: np.ndarray, T: np.ndarray, 
                                        offset: np.ndarray, scale: float, 
                                        test_sampling: bool = True) -> Dict[str, Any]:
        """
        In-memory version of transform_to_canonical function
        
        Args:
            point_cloud: 3D points as numpy array
            T: Affine transformation matrix
            offset: Normalization offset
            scale: Normalization scale
            test_sampling: Whether this is for testing (True) or training (False)
            
        Returns:
            Dictionary containing SDF data
        """
        try:
            # Transform points to canonical space
            v_1 = transformation(T, point_cloud.transpose())
            v_2 = (v_1 + offset) * scale
            
            # Compute inverse transformation matrix
            Ti = np.identity(4)
            Ti[0:3, 0:3] = np.linalg.inv(T[0:3, 0:3])
            Ti[0:3, 3] = -np.dot(np.linalg.inv(T[0:3, 0:3]), T[0:3, 3])
            
            if test_sampling:
                # For testing: just use the points as point cloud data
                pos_xyz = v_2
                pos_sdf = np.zeros([pos_xyz.shape[0], 1])
                pcd = np.concatenate((pos_xyz, pos_sdf), axis=1)
                
                return {
                    'pcd': pcd,
                    't': 0.0,  # Single frame, so t=0
                    'T': T,
                    'Ti': Ti,
                    'offset': offset,
                    'scale': scale
                }
            else:
                # For training: we would need mesh data to generate SDF samples
                # Since we're working with point clouds, we'll use test_sampling approach
                print("Warning: Training mode not fully supported with point cloud input, using test sampling")
                return self._transform_to_canonical_in_memory(point_cloud, T, offset, scale, test_sampling=True)
                
        except Exception as e:
            print(f"Error in transform_to_canonical_in_memory: {e}")
            raise e
    
    def _optimize_latent_codes_sync(self, sdf_data: Dict, num_iterations: int = 50, lr: float = 5e-4, 
                                   code_reg_lambda: float = 1e-4, verbose_logging: bool = False) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Optimize latent codes for reconstruction (single frame)
        
        Args:
            sdf_data: SDF data dictionary
            num_iterations: Number of optimization iterations
            lr: Learning rate
            code_reg_lambda: L2 regularization weight for latent codes (default 1e-4, set to 0 to disable)
            verbose_logging: If True, log detailed optimization progress
            
        Returns:
            Optimized shape (c_s) and motion (c_m) codes
        """
        try:
            # AUTOGRAD FIX: Force complete GPU synchronization and cleanup
            self._force_gpu_sync()
            
            # Ensure decoder parameters don't accumulate gradients
            if self.decoder is not None:
                for param in self.decoder.parameters():
                    param.grad = None
                self.decoder.eval()
            
            # For single frame reconstruction
            frame_num = 1
            
            # Initialize latent codes using isolated tensor creation
            c_s = self._create_isolated_tensor(torch.zeros(1, self.Cs_size), requires_grad=True)
            c_m = self._create_isolated_tensor(torch.zeros(frame_num, self.Cm_size), requires_grad=True)
            
            # Initialize with proper distributions - completely isolated
            with torch.no_grad():
                c_s.normal_(mean=0, std=0.1)
                c_m.normal_(mean=0, std=1.0 / np.sqrt(self.Cm_size))
            
            # Create fresh optimizer instance
            optimizer = torch.optim.Adam([c_s, c_m], lr=lr)
            
            # Prepare data using isolated tensor creation with explicit device placement
            pcd = sdf_data['pcd']  # [N, 4] where last column is SDF values (zeros for point cloud)
            t_val = self._create_isolated_tensor([sdf_data['t']], requires_grad=False)
            
            # Extract points and SDF values - use isolated tensor creation
            xyz = self._create_isolated_tensor(pcd[:, 0:3], requires_grad=False)
            sdf_gt = self._create_isolated_tensor(pcd[:, 3], requires_grad=False)
            
            num_points = xyz.shape[0]
            # Ensure t tensor is on correct device
            t = t_val.repeat(num_points).to(self.device)
            
            # Optimization loop with enhanced autograd isolation
            for epoch in range(num_iterations):
                # AUTOGRAD FIX: Complete state reset each iteration
                if self.decoder is not None:
                    self.decoder.eval()
                    for param in self.decoder.parameters():
                        param.grad = None
                        param.requires_grad_(False)  # Disable by default
                
                # Clear optimizer gradients
                optimizer.zero_grad()
                
                # DEVICE FIX: Verify all base tensors are on correct device
                if epoch == 0:  # Only check on first epoch to avoid spam
                    self._verify_tensor_devices(
                        c_s=c_s, c_m=c_m, xyz=xyz, t=t, sdf_gt=sdf_gt
                    )
                
                # AUTOGRAD FIX: Create fresh tensor expansions with device verification
                cs_vecs = c_s.expand(num_points, -1).contiguous().to(self.device)
                cm_vecs = c_m[0].unsqueeze(0).expand(num_points, -1).contiguous().to(self.device)
                
                # Forward pass with complete gradient isolation
                try:
                    # Ensure decoder is in eval mode (no gradients for parameters)
                    if self.decoder is not None:
                        self.decoder.eval()
                        for param in self.decoder.parameters():
                            param.requires_grad_(False)
                    
                    # DEVICE FIX: Ensure all tensors are on the same device before forward pass
                    xyz_device = xyz.to(self.device)
                    t_device = t.to(self.device)
                    cs_vecs_device = cs_vecs.to(self.device)
                    cm_vecs_device = cm_vecs.to(self.device)
                    
                    # Forward pass - only latent codes have gradients
                    new_xyz, sdf_pred = self.decoder(xyz_device, t_device, cm_vecs_device, cs_vecs_device)
                    sdf_pred = torch.clamp(sdf_pred.squeeze(1), -self.clamp_dist, self.clamp_dist)
                    
                    # For point cloud data, we minimize the SDF values (should be close to 0 at surface)
                    sdf_loss = torch.mean(torch.abs(sdf_pred))
                    loss = sdf_loss
                    
                    # L2 regularization using device-corrected tensors (configurable)
                    if code_reg_lambda > 0:
                        reg_loss_s = code_reg_lambda * torch.mean(cs_vecs_device.pow(2))
                        reg_loss_m = code_reg_lambda * torch.mean(cm_vecs_device.pow(2))
                        loss += reg_loss_s + reg_loss_m
                    else:
                        reg_loss_s = torch.tensor(0.0, device=self.device)
                        reg_loss_m = torch.tensor(0.0, device=self.device)
                    
                    # Backward pass and optimization
                    loss.backward()
                    optimizer.step()
                    
                    # Enhanced logging for debugging
                    if verbose_logging and epoch % 10 == 0:
                        c_s_norm = torch.norm(c_s).item()
                        c_m_norm = torch.norm(c_m).item()
                        print(f"Epoch {epoch:4d} | SDF: {sdf_loss.item():.9e} | "
                              f"Reg_s: {reg_loss_s.item():.9e} | Reg_m: {reg_loss_m.item():.9e} | "
                              f"||c_s||: {c_s_norm:.4f} | ||c_m||: {c_m_norm:.4f}")
                    elif epoch % 10 == 0:
                        print(f"Optimization epoch {epoch}, SDF loss = {sdf_loss.item():.9e}")
                    
                except Exception as e:
                    print(f"Error in optimization epoch {epoch}: {e}")
                    break
                
                finally:
                    # AUTOGRAD FIX: Aggressive cleanup of intermediate variables
                    locals_to_del = ['sdf_pred', 'sdf_loss', 'loss', 'cs_vecs', 'cm_vecs', 'new_xyz', 
                                   'xyz_device', 't_device', 'cs_vecs_device', 'cm_vecs_device',
                                   'reg_loss_s', 'reg_loss_m']
                    for var_name in locals_to_del:
                        if var_name in locals():
                            del locals()[var_name]
                    
                    # Force GPU sync every few iterations to prevent accumulation
                    if epoch % 20 == 0:
                        self._force_gpu_sync()
            
            # AUTOGRAD FIX: Return properly detached tensors and clear GPU cache
            result_c_s = c_s.detach().clone()
            result_c_m = c_m.detach().clone()
            
            # Clean up optimization variables
            del c_s, c_m, optimizer, xyz, sdf_gt, t
            torch.cuda.empty_cache()
            
            return result_c_s, result_c_m
            
        except Exception as e:
            print(f"Error in latent code optimization: {e}")
            # AUTOGRAD FIX: Clean up on error
            torch.cuda.empty_cache()
            raise e
    
    def _generate_mesh_sync(self, c_s: torch.Tensor, c_m: torch.Tensor, 
                           sdf_data: Dict, output_file: str, resolution: int = 128, 
                           export_format: str = "obj",
                           extract_point_cloud: bool = False,
                           point_cloud_format: str = "npy",
                           extract_sdf: bool = False,
                           verify_sdf_sign: bool = False) -> str:
        """
        Generate 3D mesh from optimized latent codes
        
        Args:
            c_s: Shape latent code
            c_m: Motion latent code
            sdf_data: SDF data containing transformation parameters
            output_file: Path to save the mesh file (with correct extension)
            resolution: Marching cubes resolution
            export_format: Output format - "obj" or "glb"
            extract_point_cloud: If true, save point cloud extracted from near-zero SDF band
            point_cloud_format: Point cloud format, "npy" or "ply"
            extract_sdf: If true, save dense SDF volume as .npy
            verify_sdf_sign: If true, save SDF sign spot-check report as JSON
            
        Returns:
            Path to generated mesh file
        """
        try:
            # AUTOGRAD FIX: Force complete GPU synchronization before mesh generation
            self._force_gpu_sync()
            
            # Create completely isolated tensors for mesh generation
            c_s_vec = self._create_isolated_tensor(c_s, requires_grad=False)
            c_m_vec = self._create_isolated_tensor(c_m[0].unsqueeze(0), requires_grad=False)
            phase_t = self._create_isolated_tensor([[0.0]], requires_grad=False)
            
            # Extract transformation parameters
            Ti = sdf_data['Ti']
            offset = sdf_data['offset']
            scale = sdf_data['scale']
            
            # Create output directory if it doesn't exist
            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            
            # AUTOGRAD FIX: Complete model state isolation for mesh generation
            if self.decoder is not None:
                self.decoder.eval()
                for param in self.decoder.parameters():
                    param.grad = None
                    param.requires_grad_(False)  # Disable gradients during mesh generation
            
            # Generate mesh using deep_sdf with complete gradient isolation
            with torch.no_grad():
                # Force another GPU sync before mesh generation
                torch.cuda.synchronize()
                
                # Create a dummy motion filename (not used for single frame)
                # Get base name without extension for flexibility
                base_name = os.path.splitext(output_file)[0]
                motion_filename = base_name + '_motion'
                
                # The create_mesh_4dsdf function automatically adds .ply extension
                # So we need to provide the filename without extension
                ply_base_name = base_name

                point_cloud_ext = point_cloud_format.lower().strip()
                if point_cloud_ext not in ["npy", "ply"]:
                    raise ValueError(f"Unsupported point_cloud_format: {point_cloud_format}. Use 'npy' or 'ply'.")

                sdf_output_filename = f"{ply_base_name}_sdf.npy" if extract_sdf else None
                point_cloud_output_filename = f"{ply_base_name}_pointcloud.{point_cloud_ext}" if extract_point_cloud else None
                sdf_sign_report_filename = f"{ply_base_name}_sdf_sign_check.json" if verify_sdf_sign else None
                
                deep_sdf.mesh.create_mesh_4dsdf(
                    self.decoder, c_s_vec, c_m_vec, phase_t,
                    ply_base_name, motion_filename,
                    N=resolution, max_batch=self.max_batch,
                    offset=offset, scale=scale, Ti=Ti,
                    sdf_output_filename=sdf_output_filename,
                    point_cloud_output_filename=point_cloud_output_filename,
                    verify_sdf_sign=verify_sdf_sign,
                    sdf_sign_report_filename=sdf_sign_report_filename,
                )
                
                # Force GPU sync after mesh generation
                torch.cuda.synchronize()
            
            # AUTOGRAD FIX: Re-enable gradients with fresh state
            if self.decoder is not None:
                for param in self.decoder.parameters():
                    param.requires_grad_(True)
                    param.grad = None  # Clear any potential gradients
            
            # The function creates a PLY file, convert to requested format
            ply_file = ply_base_name + ".ply"
            
            if os.path.exists(ply_file):
                # Convert based on requested format
                if export_format == "glb":
                    self._convert_ply_to_glb(ply_file, output_file)
                else:  # default to OBJ
                    self._convert_ply_to_obj(ply_file, output_file)
                
                # Clean up the temporary PLY file
                os.remove(ply_file)
                print(f"Generated mesh saved to: {output_file}")
                
                # AUTOGRAD FIX: Clean up tensor variables and free GPU memory
                del c_s_vec, c_m_vec, phase_t
                torch.cuda.empty_cache()
                
                return output_file
            else:
                raise FileNotFoundError(f"PLY file not generated: {ply_file}")
            
        except Exception as e:
            print(f"Error generating mesh: {e}")
            # AUTOGRAD FIX: Clean up on error
            torch.cuda.empty_cache()
            raise e
    
    def _convert_ply_to_obj(self, ply_file: str, obj_file: str):
        """
        Convert PLY file to OBJ format
        
        Args:
            ply_file: Path to input PLY file
            obj_file: Path to output OBJ file
        """
        try:
            # Read PLY file
            plydata = plyfile.PlyData.read(ply_file)
            
            # Extract vertices and faces
            vertices = plydata['vertex']
            faces = plydata['face']
            
            # Write OBJ file
            with open(obj_file, 'w') as f:
                # Write vertices
                for vertex in vertices:
                    f.write(f"v {vertex['x']} {vertex['y']} {vertex['z']}\n")
                
                # Write faces (OBJ uses 1-based indexing)
                for face in faces:
                    indices = face['vertex_indices']
                    f.write(f"f {indices[0]+1} {indices[1]+1} {indices[2]+1}\n")
                    
        except Exception as e:
            print(f"Error converting PLY to OBJ: {e}")
            raise e
    
    def _convert_ply_to_glb(self, ply_file: str, glb_file: str):
        """
        Convert PLY file to GLB format using trimesh
        
        Args:
            ply_file: Path to input PLY file
            glb_file: Path to output GLB file
        """
        try:
            # Load PLY file with trimesh
            mesh = trimesh.load(ply_file)
            
            # Export as GLB (binary glTF 2.0)
            mesh.export(glb_file, file_type='glb')
            
            print(f"Converted PLY to GLB: {glb_file}")
                    
        except Exception as e:
            print(f"Error converting PLY to GLB: {e}")
            raise e
    
    async def predict(self, nifti_file_path: str, output_dir: str, **kwargs) -> Dict[str, Any]:
        """
        Main async prediction interface for 4D reconstruction from NiFTI file
        Handles both 3D and 4D NiFTI inputs
        
        Args:
            nifti_file_path: Path to input NiFTI segmentation file (3D or 4D)
            output_dir: Directory to save output OBJ file(s)
            **kwargs: Additional parameters (num_iterations, resolution, ed_frame_index, etc.)
            
        Returns:
            Dictionary containing reconstruction results
        """
        # Detect input type and route to appropriate handler
        if self._is_4d_nifti(nifti_file_path):
            return await asyncio.to_thread(self._predict_4d_sequence, nifti_file_path, output_dir, **kwargs)
        else:
            return await asyncio.to_thread(self._predict_single_frame, nifti_file_path, output_dir, **kwargs)
    
    def _predict_single_frame(self, nifti_file_path: str, output_dir: str, **kwargs) -> Dict[str, Any]:
        """
        Synchronous prediction logic for 4D reconstruction
        
        Args:
            nifti_file_path: Path to input NiFTI file
            output_dir: Directory to save output
            **kwargs: Additional parameters
            
        Returns:
            Reconstruction results dictionary
        """
        start_time = time.time()
        
        try:
            # AUTOGRAD FIX: Complete request isolation
            self._isolate_request_context()
            
            # Extract parameters
            num_iterations = kwargs.get('num_iterations', 50)
            resolution = kwargs.get('resolution', 128)
            export_format = kwargs.get('export_format', 'obj')
            extract_point_cloud = kwargs.get('extract_point_cloud', False)
            point_cloud_format = kwargs.get('point_cloud_format', 'npy')
            extract_sdf = kwargs.get('extract_sdf', False)
            verify_sdf_sign = kwargs.get('verify_sdf_sign', False)
            
            # PHASE 1 EXPERIMENT: Configurable regularization and verbose logging
            code_reg_lambda = kwargs.get('code_reg_lambda', 1e-4)  # Default 1e-4, can be reduced or set to 0
            verbose_logging = kwargs.get('verbose_logging', False)  # Enable detailed optimization logs
            
            print(f"Starting 4D reconstruction for: {nifti_file_path}")
            print(f"Export format: {export_format.upper()}")
            print(
                f"Extraction config: point_cloud={extract_point_cloud} ({point_cloud_format}), "
                f"sdf={extract_sdf}, verify_sdf_sign={verify_sdf_sign}"
            )
            print(f"Optimization config: iterations={num_iterations}, lr=5e-4, reg_lambda={code_reg_lambda}")
            if verbose_logging:
                print(f"Verbose logging: ENABLED")
            
            # Step 1: Extract point cloud from NiFTI
            print("Step 1: Extracting contour points...")
            point_cloud = self._extract_contour_from_nifti_sync(nifti_file_path)
            
            # Step 2: Extract affine transformation matrix
            print("Step 2: Extracting affine matrix...")
            T, offset, scale = self._extract_affine_matrix_sync(nifti_file_path)
            
            # Step 3: Transform to canonical space (in-memory)
            print("Step 3: Transforming to canonical space...")
            sdf_data = self._transform_to_canonical_in_memory(
                point_cloud, T, offset, scale, test_sampling=True
            )
            
            # Step 4: Optimize latent codes
            print("Step 4: Optimizing latent codes...")
            c_s, c_m = self._optimize_latent_codes_sync(sdf_data, num_iterations, 
                                                       code_reg_lambda=code_reg_lambda,
                                                       verbose_logging=verbose_logging)
            
            # Step 5: Generate mesh
            print("Step 5: Generating mesh...")
            os.makedirs(output_dir, exist_ok=True)
            
            # Create output filename with correct extension
            input_filename = os.path.splitext(os.path.basename(nifti_file_path))[0]
            file_extension = export_format  # "obj" or "glb"
            output_file = os.path.join(output_dir, f"{input_filename}_reconstructed.{file_extension}")
            
            mesh_file = self._generate_mesh_sync(
                c_s,
                c_m,
                sdf_data,
                output_file,
                resolution,
                export_format,
                extract_point_cloud=extract_point_cloud,
                point_cloud_format=point_cloud_format,
                extract_sdf=extract_sdf,
                verify_sdf_sign=verify_sdf_sign,
            )

            extraction_files = []
            output_base = os.path.splitext(output_file)[0]
            if extract_point_cloud:
                point_cloud_file = f"{output_base}_pointcloud.{point_cloud_format.lower()}"
                if os.path.exists(point_cloud_file):
                    extraction_files.append(point_cloud_file)
            if extract_sdf:
                sdf_file = f"{output_base}_sdf.npy"
                if os.path.exists(sdf_file):
                    extraction_files.append(sdf_file)
            if verify_sdf_sign:
                sign_file = f"{output_base}_sdf_sign_check.json"
                if os.path.exists(sign_file):
                    extraction_files.append(sign_file)
            
            # Debug mode: Copy to persistent location if enabled
            debug_save = kwargs.get('debug_save', False)
            if debug_save:
                debug_dir = kwargs.get('debug_dir', '/tmp/4d_reconstruction_debug')
                os.makedirs(debug_dir, exist_ok=True)
                debug_file = os.path.join(debug_dir, f"debug_{input_filename}_reconstructed.{file_extension}")
                
                import shutil
                shutil.copy2(mesh_file, debug_file)
                print(f"Debug: Mesh file copied to persistent location: {debug_file}")
            
            # Clear GPU memory after processing
            self._clear_gpu_memory()
            
            reconstruction_time = time.time() - start_time
            
            return {
                "success": True,
                "input_file": nifti_file_path,
                "mesh_file": mesh_file,
                "reconstruction_time": reconstruction_time,
                "num_iterations": num_iterations,
                "resolution": resolution,
                "export_format": export_format,
                "extraction_files": extraction_files,
                "output_directory": output_dir,
                # New metadata for consistency with 4D processing
                "is_4d_input": False,
                "ed_frame_index": 0,  # N/A for 3D, but use 0 for consistency
                "total_frames_processed": 1,
                "temporal_info": {"type": "single_frame_3d"}
            }
            
        except Exception as e:
            # Clear GPU memory on error
            self._clear_gpu_memory()
            
            error_msg = f"Error during 4D reconstruction: {e}"
            print(error_msg)
            
            return {
                "success": False,
                "error": error_msg,
                "input_file": nifti_file_path,
                "reconstruction_time": time.time() - start_time,
                "export_format": kwargs.get('export_format', 'obj'),
                # Error case metadata
                "is_4d_input": False,
                "ed_frame_index": 0,
                "total_frames_processed": 0,
                "temporal_info": {"type": "error"}
            }
    
    def _predict_4d_sequence(self, nifti_file_path: str, output_dir: str, **kwargs) -> Dict[str, Any]:
        """
        4D sequence prediction logic for temporal reconstruction
        
        Args:
            nifti_file_path: Path to 4D NiFTI file
            output_dir: Directory to save output
            **kwargs: Additional parameters (ed_frame_index, process_all_frames, etc.)
            
        Returns:
            4D reconstruction results dictionary
        """
        start_time = time.time()
        
        try:
            # AUTOGRAD FIX: Complete request isolation for 4D sequence processing
            self._isolate_request_context()
            
            # Extract parameters
            ed_frame_index = kwargs.get('ed_frame_index', 0)
            process_all_frames = kwargs.get('process_all_frames', True)
            num_iterations = kwargs.get('num_iterations', 50)
            resolution = kwargs.get('resolution', 128)
            export_format = kwargs.get('export_format', 'obj')
            extract_point_cloud = kwargs.get('extract_point_cloud', False)
            point_cloud_format = kwargs.get('point_cloud_format', 'npy')
            extract_sdf = kwargs.get('extract_sdf', False)
            verify_sdf_sign = kwargs.get('verify_sdf_sign', False)
            
            # PHASE 1 EXPERIMENT: Configurable regularization
            code_reg_lambda = kwargs.get('code_reg_lambda', 1e-4)
            verbose_logging = kwargs.get('verbose_logging', False)
            
            print(f"Starting 4D reconstruction for: {nifti_file_path}")
            print(f"ED frame index: {ed_frame_index}, Process all frames: {process_all_frames}")
            print(f"Export format: {export_format.upper()}")
            print(
                f"Extraction config: point_cloud={extract_point_cloud} ({point_cloud_format}), "
                f"sdf={extract_sdf}, verify_sdf_sign={verify_sdf_sign}"
            )
            print(f"Optimization config: iterations={num_iterations}, reg_lambda={code_reg_lambda}")
            
            # Step 1: Detect and validate 4D input
            is_4d, num_temporal_frames = self._detect_nifti_dimensions(nifti_file_path)
            if not is_4d:
                raise ValueError("Expected 4D NiFTI input for 4D sequence processing")
            
            if ed_frame_index >= num_temporal_frames:
                raise ValueError(f"ED frame index {ed_frame_index} >= total frames {num_temporal_frames}")
            
            # Step 2: Extract temporal frames
            print("Step 1: Extracting temporal frames...")
            temp_frame_paths, frame_indices = self._extract_temporal_frames(
                nifti_file_path, ed_frame_index, process_all_frames
            )
            
            # Step 3: Process ED frame to get transformation parameters
            print("Step 2: Processing ED frame for transformation parameters...")
            ed_position = frame_indices.index(ed_frame_index)
            ed_frame_path = temp_frame_paths[ed_position]
            
            # Extract affine matrix from ED frame
            # If ED frame doesn't have LVM, try to find another frame that does
            T, offset, scale = None, None, None
            frames_to_try = [ed_position] + [i for i in range(len(temp_frame_paths)) if i != ed_position]
            
            for attempt_idx, frame_pos in enumerate(frames_to_try):
                try:
                    frame_path = temp_frame_paths[frame_pos]
                    original_idx = frame_indices[frame_pos]
                    if attempt_idx == 0:
                        print(f"Attempting to extract affine matrix from ED frame (original frame {original_idx})...")
                    else:
                        print(f"ED frame failed, trying frame {frame_pos} (original frame {original_idx})...")
                    
                    T, offset, scale = self._extract_affine_matrix_sync(frame_path)
                    
                    if attempt_idx > 0:
                        print(f"Successfully extracted affine matrix from frame {frame_pos} (original frame {original_idx})")
                    break  # Success, exit loop
                    
                except ValueError as ve:
                    error_msg = str(ve)
                    if "No LVM (label 2) found" in error_msg:
                        if "apex or base of the heart" in error_msg or "cannot be used for transformation" in error_msg:
                            # This is expected - frame doesn't have LVM (apex/base slice)
                            if attempt_idx == len(frames_to_try) - 1:
                                # We've tried all frames
                                raise ValueError(
                                    f"None of the {len(temp_frame_paths)} extracted frames contain LVM (label 2). "
                                    f"This suggests the segmentation mask may be empty or all frames are outside "
                                    f"the myocardium region. Please verify the segmentation mask contains proper labels."
                                )
                            else:
                                # Try next frame
                                continue
                        else:
                            # This looks like raw image data, not a segmentation mask
                            raise ve
                    else:
                        # Some other error
                        raise ve
            
            if T is None:
                raise ValueError("Failed to extract affine transformation matrix from any frame")
            
            # Type assertion for type checker - we know these are not None if we reach here
            assert T is not None and offset is not None and scale is not None
            
            # Phase 2: Multi-frame processing implementation
            if process_all_frames:
                print("Step 3: Processing multiple frames (Phase 2 implementation)...")
                mesh_files = []
                extraction_files = []
                processed_frame_indices = []
                
                os.makedirs(output_dir, exist_ok=True)
                input_filename = os.path.splitext(os.path.basename(nifti_file_path))[0]
                file_extension = export_format  # "obj" or "glb"
                
                # Process each extracted frame
                for i, (frame_path, original_frame_idx) in enumerate(zip(temp_frame_paths, frame_indices)):
                    print(f"Processing frame {i+1}/{len(temp_frame_paths)}: original frame {original_frame_idx}")
                    
                    try:
                        # AUTOGRAD FIX: Complete isolation for each frame processing
                        self._complete_model_reset()
                        print(f"GPU memory before frame processing: {torch.cuda.memory_allocated() / 1024**2:.1f} MB")
                        
                        # Extract contour for this frame
                        try:
                            frame_point_cloud = self._extract_contour_from_nifti_sync(frame_path)
                            
                            # Check if we got any points
                            if len(frame_point_cloud) == 0:
                                print(f"⚠️  Frame {original_frame_idx} has no contour points (likely apex/base slice). Skipping...")
                                continue
                                
                        except Exception as contour_error:
                            # Check if this is expected (no LVM in frame)
                            if "No LVM" in str(contour_error) or "apex or base" in str(contour_error):
                                print(f"⚠️  Frame {original_frame_idx} contains no myocardium (apex/base slice). Skipping...")
                                continue
                            else:
                                # Unexpected error, re-raise
                                raise contour_error
                        
                        # Transform to canonical space (using ED frame transformation)
                        frame_sdf_data = self._transform_to_canonical_in_memory(
                            frame_point_cloud, T, offset, scale, test_sampling=True
                        )
                        
                        # AUTOGRAD FIX: Optimize latent codes for this frame with clean state
                        print(f"Starting optimization for frame {original_frame_idx}...")
                        frame_c_s, frame_c_m = self._optimize_latent_codes_sync(frame_sdf_data, num_iterations,
                                                                                code_reg_lambda=code_reg_lambda,
                                                                                verbose_logging=verbose_logging)
                        print(f"Completed optimization for frame {original_frame_idx}")
                        
                        # Generate mesh for this frame with correct extension
                        if original_frame_idx == ed_frame_index:
                            # Mark ED frame clearly
                            output_file = os.path.join(output_dir, f"{input_filename}_4D_frame{original_frame_idx:02d}_ED.{file_extension}")
                        else:
                            output_file = os.path.join(output_dir, f"{input_filename}_4D_frame{original_frame_idx:02d}.{file_extension}")
                        
                        print(f"Generating mesh for frame {original_frame_idx}...")
                        frame_mesh_file = self._generate_mesh_sync(
                            frame_c_s,
                            frame_c_m,
                            frame_sdf_data,
                            output_file,
                            resolution,
                            export_format,
                            extract_point_cloud=extract_point_cloud,
                            point_cloud_format=point_cloud_format,
                            extract_sdf=extract_sdf,
                            verify_sdf_sign=verify_sdf_sign,
                        )
                        mesh_files.append(frame_mesh_file)
                        processed_frame_indices.append(original_frame_idx)

                        frame_base = os.path.splitext(output_file)[0]
                        if extract_point_cloud:
                            frame_point_cloud = f"{frame_base}_pointcloud.{point_cloud_format.lower()}"
                            if os.path.exists(frame_point_cloud):
                                extraction_files.append(frame_point_cloud)
                        if extract_sdf:
                            frame_sdf = f"{frame_base}_sdf.npy"
                            if os.path.exists(frame_sdf):
                                extraction_files.append(frame_sdf)
                        if verify_sdf_sign:
                            frame_sign = f"{frame_base}_sdf_sign_check.json"
                            if os.path.exists(frame_sign):
                                extraction_files.append(frame_sign)
                        
                        print(f"✅ Successfully generated mesh for frame {original_frame_idx}: {os.path.basename(frame_mesh_file)}")
                        
                        # AUTOGRAD FIX: Aggressive cleanup after frame processing
                        del frame_c_s, frame_c_m, frame_sdf_data, frame_point_cloud
                        self._force_gpu_sync()
                        print(f"GPU memory after frame processing: {torch.cuda.memory_allocated() / 1024**2:.1f} MB")
                        
                    except Exception as e:
                        print(f"❌ Error processing frame {original_frame_idx}: {e}")
                        import traceback
                        traceback.print_exc()
                        
                        # AUTOGRAD FIX: Aggressive cleanup on error to prevent contamination
                        self._force_gpu_sync()
                        self._complete_model_reset()
                        
                        # Continue with other frames
                        continue
                
                # Primary mesh file is the ED frame
                ed_mesh_file = None
                for mesh_file in mesh_files:
                    # Search for ED frame with correct file extension
                    if f"frame{ed_frame_index:02d}_ED.{file_extension}" in mesh_file:
                        ed_mesh_file = mesh_file
                        break
                
                # Fallback to first mesh if ED not found
                primary_mesh_file = ed_mesh_file if ed_mesh_file else (mesh_files[0] if mesh_files else None)
                
                if not mesh_files:
                    raise ValueError("No mesh files were successfully generated")
                    
            else:
                print("Step 3: Processing ED frame only (Phase 1 mode)...")
                
                # Extract and process ED frame only
                try:
                    ed_point_cloud = self._extract_contour_from_nifti_sync(ed_frame_path)
                    
                    # Check if we got any points
                    if len(ed_point_cloud) == 0:
                        raise ValueError(
                            f"ED frame (frame {ed_frame_index}) has no contour points. "
                            f"This frame may be at the apex or base of the heart with no myocardium. "
                            f"Please select a different ED frame index that contains the myocardium."
                        )
                        
                except Exception as contour_error:
                    # Check if this is because no LVM in frame
                    if "No LVM" in str(contour_error) or "apex or base" in str(contour_error):
                        raise ValueError(
                            f"ED frame (frame {ed_frame_index}) contains no myocardium (likely apex/base slice). "
                            f"Please select a different ED frame index that contains visible myocardium. "
                            f"Original error: {contour_error}"
                        )
                    else:
                        # Unexpected error, re-raise
                        raise contour_error
                
                sdf_data = self._transform_to_canonical_in_memory(
                    ed_point_cloud, T, offset, scale, test_sampling=True
                )
                
                # Optimize latent codes (single frame)
                c_s, c_m = self._optimize_latent_codes_sync(sdf_data, num_iterations,
                                                           code_reg_lambda=code_reg_lambda,
                                                           verbose_logging=verbose_logging)
                
                # Generate mesh with correct extension
                os.makedirs(output_dir, exist_ok=True)
                input_filename = os.path.splitext(os.path.basename(nifti_file_path))[0]
                file_extension = export_format  # "obj" or "glb"
                output_file = os.path.join(output_dir, f"{input_filename}_4D_ED{ed_frame_index:02d}.{file_extension}")
                
                primary_mesh_file = self._generate_mesh_sync(
                    c_s,
                    c_m,
                    sdf_data,
                    output_file,
                    resolution,
                    export_format,
                    extract_point_cloud=extract_point_cloud,
                    point_cloud_format=point_cloud_format,
                    extract_sdf=extract_sdf,
                    verify_sdf_sign=verify_sdf_sign,
                )
                mesh_files = [primary_mesh_file]
                processed_frame_indices = [ed_frame_index]
                extraction_files = []

                frame_base = os.path.splitext(output_file)[0]
                if extract_point_cloud:
                    frame_point_cloud = f"{frame_base}_pointcloud.{point_cloud_format.lower()}"
                    if os.path.exists(frame_point_cloud):
                        extraction_files.append(frame_point_cloud)
                if extract_sdf:
                    frame_sdf = f"{frame_base}_sdf.npy"
                    if os.path.exists(frame_sdf):
                        extraction_files.append(frame_sdf)
                if verify_sdf_sign:
                    frame_sign = f"{frame_base}_sdf_sign_check.json"
                    if os.path.exists(frame_sign):
                        extraction_files.append(frame_sign)
            
            # Clean up temporary files
            import shutil
            temp_dir = os.path.dirname(temp_frame_paths[0])
            shutil.rmtree(temp_dir)
            
            # Clear GPU memory after processing
            self._clear_gpu_memory()
            
            reconstruction_time = time.time() - start_time
            
            return {
                "success": True,
                "input_file": nifti_file_path,
                "mesh_file": primary_mesh_file,  # Primary mesh (ED frame or first available)
                "mesh_files": mesh_files,  # All generated mesh files
                "reconstruction_time": reconstruction_time,
                "num_iterations": num_iterations,
                "resolution": resolution,
                "export_format": export_format,
                "extraction_files": extraction_files,
                "output_directory": output_dir,
                # 4D-specific metadata
                "is_4d_input": True,
                "ed_frame_index": ed_frame_index,
                "total_frames_processed": len(processed_frame_indices),
                "processed_frames": len(mesh_files),
                "temporal_info": {
                    "type": "4d_sequence_phase2" if process_all_frames else "4d_sequence_phase1",
                    "total_temporal_frames": num_temporal_frames,
                    "processed_frame_indices": processed_frame_indices,
                    "ed_frame_position": ed_position,
                    "mesh_file_count": len(mesh_files),
                    "note": f"Phase {'2' if process_all_frames else '1'}: {'Full temporal sequence' if process_all_frames else 'ED frame only'} processing."
                }
            }
            
        except Exception as e:
            # Clean up temporary files on error
            try:
                if 'temp_frame_paths' in locals() and temp_frame_paths:
                    import shutil
                    temp_dir = os.path.dirname(temp_frame_paths[0])
                    shutil.rmtree(temp_dir)
            except:
                pass
            
            # Clear GPU memory on error
            self._clear_gpu_memory()
            
            error_msg = f"Error during 4D reconstruction: {e}"
            print(error_msg)
            
            return {
                "success": False,
                "error": error_msg,
                "input_file": nifti_file_path,
                "reconstruction_time": time.time() - start_time,
                "export_format": kwargs.get('export_format', 'obj'),
                # Error case metadata
                "is_4d_input": True,
                "ed_frame_index": kwargs.get('ed_frame_index', 0),
                "total_frames_processed": 0,
                "temporal_info": {"type": "error"}
            }
