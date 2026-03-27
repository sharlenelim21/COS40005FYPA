import numpy as np
# EDIT 06AUG 2025
#from mesh_to_sdf import ComputeNormalizationParameters, transformation
from mesh_to_sdf.mesh_to_sdf import ComputeNormalizationParameters, transformation
import os
import SimpleITK as sitk
import cv2

# Fixes the problem with extreme cases of segmentation masks (especially those simply drawn)
def safe_contour_to_mask(contour_points, mask_shape):
    """
    Safely set contour pixels in a mask with bounds checking by clipping.
    
    Args:
        contour_points: numpy array of shape (N, 2) with (x, y) coordinates from OpenCV
        mask_shape: tuple (height, width) of the target mask
        
    Returns:
        numpy array (height, width) with contour pixels set to 255
    """
    result = np.zeros(mask_shape, dtype=np.uint8)
    
    if contour_points.size == 0:
        return result
    
    # Ensure contour_points is 2D
    if contour_points.ndim == 1:
        if contour_points.size == 2:
            contour_points = contour_points.reshape(1, 2)
        else:
            return result
    
    # OpenCV contours are (x, y), numpy indexing is (row, col) = (y, x)
    cols = contour_points[:, 0].astype(int)  # x coordinates
    rows = contour_points[:, 1].astype(int)  # y coordinates
    
    # Clip to valid bounds
    cols = np.clip(cols, 0, mask_shape[1] - 1)  # width
    rows = np.clip(rows, 0, mask_shape[0] - 1)  # height
    
    # Set pixels
    result[rows, cols] = 255
    
    return result

def normalize_nifti_dimensions(pred_npy):
    """
    Normalize NIfTI array dimensions to ensure consistent 3D structure.
    
    Args:
        pred_npy: Array from sitk.GetArrayFromImage
        
    Returns:
        Normalized array with shape (slices, height, width)
        
    SimpleITK loads:
    - 3D files (X, Y, Z) as (Z, Y, X) - shape has 3 dimensions
    - 4D files (X, Y, Z, T) as (T, Z, Y, X) - shape has 4 dimensions
    
    For 3D files (e.g., 225x225x10), we already have (10, 225, 225) which is correct.
    For 4D files (e.g., 225x225x10x1), we get (1, 10, 225, 225), need to squeeze first dim.
    """
    if pred_npy.ndim == 4:
        # 4D array: (T, Z, Y, X) - squeeze the time dimension if it's size 1
        if pred_npy.shape[0] == 1:
            pred_npy = np.squeeze(pred_npy, axis=0)  # Now (Z, Y, X)
        else:
            # Multiple time points - take the first one
            pred_npy = pred_npy[0, :, :, :]
    elif pred_npy.ndim == 3:
        # 3D array: already (Z, Y, X) - this is what we want
        pass
    elif pred_npy.ndim < 3:
        raise ValueError(f"Invalid NIfTI dimensions: {pred_npy.shape}. Expected 3D or 4D array.")
    
    return pred_npy

def extract_spatial_metadata(sitk_image):
    """
    Extract spatial metadata (origin, spacing, direction) from a SimpleITK image.
    Handles both 3D and 4D images by extracting only the spatial (X, Y, Z) components.
    
    Args:
        sitk_image: SimpleITK Image object
        
    Returns:
        Tuple of (origin, spacing, direction_matrix) all as numpy arrays for 3D space
    """
    dimension = sitk_image.GetDimension()
    
    if dimension == 3:
        # 3D image - use as is
        origin = np.array(sitk_image.GetOrigin())  # 3 elements
        spacing = np.array(sitk_image.GetSpacing())  # 3 elements
        direction = np.array(sitk_image.GetDirection()).reshape(3, 3, order='C')  # 3x3 matrix
    elif dimension == 4:
        # 4D image - extract only spatial components (first 3 dimensions)
        origin = np.array(sitk_image.GetOrigin()[:3])  # First 3 elements (X, Y, Z)
        spacing = np.array(sitk_image.GetSpacing()[:3])  # First 3 elements (X, Y, Z)
        # Direction is 4x4, extract top-left 3x3 submatrix
        direction_4d = np.array(sitk_image.GetDirection()).reshape(4, 4, order='C')
        direction = direction_4d[:3, :3]  # Top-left 3x3 for spatial orientation
    else:
        raise ValueError(f"Unsupported image dimension: {dimension}. Expected 3 or 4.")
    
    return origin, spacing, direction

def get_contour(input_mask_path):
    """
    segmentation label: 1: RV, 2: LVM, 3: LV
    return: 3D point cloud contour obtained by segmentation
    """
    pred_name = os.path.join(input_mask_path)
    pred_in = sitk.ReadImage(pred_name)
    pred_npy = sitk.GetArrayFromImage(pred_in)
    
    # Normalize dimensions to handle both 3D and 4D inputs
    pred_npy = normalize_nifti_dimensions(pred_npy)

    p_w_list = []
    for j in range(pred_npy.shape[0]):
        mask = np.zeros([pred_npy.shape[1], pred_npy.shape[2]])
        list = np.where(pred_npy[j, :, :].astype(np.int32) == 2)  # LVM        
        mask[list] = 255

        mask = mask.astype(np.uint8)
        #EDIT 06AUG2025 - Need both inner and outer contours
        #contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        if len(contours) == 0:
            continue

        result = np.zeros(mask.shape, np.uint8)
        list = []
        for k in range(len(contours)):
            contours_list = np.squeeze(contours[k])
            # Handle single points or ragged contours
            if contours_list.ndim == 1:
                # Single point: reshape to (1, 2)
                if contours_list.size == 2:
                    contours_list = contours_list.reshape(1, 2)
                else:
                    continue
            elif contours_list.ndim != 2 or contours_list.shape[1] != 2:
                # Invalid shape, skip
                continue
            list.extend(contours_list)

        if len(list) == 0:
            # No contours found in this slice, skip
            continue
            
        list = np.array(list)
        # Ensure list is 2D with shape (N, 2)
        if list.ndim == 1:
            if list.size == 2:
                list = list.reshape(1, 2)
            else:
                continue
        
        # FIX: Use safe_contour_to_mask helper with bounds checking
        result = safe_contour_to_mask(list, mask.shape)

        # Extract spatial metadata (handles both 3D and 4D images)
        space_origin, space_spacing, space_directions = extract_spatial_metadata(pred_in)
        space_directions = space_spacing * space_directions

        lps2world = np.identity(4)
        lps2world[0:3, 0:3] = space_directions
        lps2world[0:3, 3] = space_origin
        
        # Transform contour points to world coordinates
        # list is already (N, 2) with (x, y) coordinates
        p_lps = np.column_stack((list, np.ones([list.shape[0], 1]) * j))
        homogeneous = np.column_stack((p_lps, np.ones([p_lps.shape[0], 1])))

        p_w = np.dot(lps2world, homogeneous.transpose())[0:3, :].transpose()
        p_w_list.extend(p_w)

    p_w_list = np.array(p_w_list)
    return(p_w_list)

def get_contour_safe(input_mask_path):
    """
    segmentation label: 1: RV, 2: LVM, 3: LV
    return: 3D point cloud contour obtained by segmentation
    Safer version of get_contour that does the following: Avoids 'list' variable; handles empty/single-point/ragged contours robustly; enforces (N,2) coord array; preserves cols-rows ordering for result[rows, cols]; optional debug print for no contours.
    """
    pred_in = sitk.ReadImage(input_mask_path)
    pred_npy = sitk.GetArrayFromImage(pred_in)
    
    # Normalize dimensions to handle both 3D and 4D inputs
    pred_npy = normalize_nifti_dimensions(pred_npy)

    p_w_list = []
    for j in range(pred_npy.shape[0]):
        mask = np.zeros([pred_npy.shape[1], pred_npy.shape[2]], dtype=np.uint8)
        coords = np.where(pred_npy[j, :, :].astype(np.int32) == 2)  # LVM
        if coords[0].size == 0:
            # no LVM in this slice
            continue
        mask[coords] = 255

        # find both inner and outer contours
        contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        if len(contours) == 0:
            continue

        result = np.zeros(mask.shape, np.uint8)
        all_pts = []
        for cnt in contours:
            pts = np.squeeze(cnt)  # could be (N,2) or (2,) for single point
            if pts.ndim == 1:
                # single point; convert to shape (1,2)
                pts = pts.reshape(1, 2)
            # ensure dtype and shape
            pts = np.asarray(pts, dtype=int)
            if pts.size == 0:
                continue
            # pts is now (M,2)
            all_pts.append(pts)

        if len(all_pts) == 0:
            continue

        all_pts = np.vstack(all_pts)  # shape (K,2)
        # In original code they used [list[:,0], list[:,1]] then result[tuple(list)] = 255
        # That maps to (rows, cols) = (y, x) => result[rows, cols] = 255
        cols = all_pts[:, 0]
        rows = all_pts[:, 1]
        # Clip indices to valid range just in case
        cols = np.clip(cols, 0, result.shape[1] - 1)
        rows = np.clip(rows, 0, result.shape[0] - 1)
        result[rows, cols] = 255

        # convert to world coords - extract spatial metadata (handles both 3D and 4D images)
        space_origin, space_spacing, space_directions = extract_spatial_metadata(pred_in)
        space_directions = space_spacing * space_directions

        lps2world = np.identity(4)
        lps2world[0:3, 0:3] = space_directions
        lps2world[0:3, 3] = space_origin

        pts_xy = np.column_stack((all_pts, np.ones([all_pts.shape[0], 1]) * j))
        homogeneous = np.column_stack((pts_xy, np.ones([pts_xy.shape[0], 1])))
        p_w = (lps2world @ homogeneous.T)[0:3, :].T
        p_w_list.extend(p_w)

    p_w_list = np.array(p_w_list)
    return p_w_list

# EDIT 06AUG 2025
#def decide_orient(input_pa):
def decide_orient(input_pa, dataset_name='', patient='', patient_file=''):
    """Determine the direction of the heart from input segmentation.
    """
    if dataset_name == 'acdc':
      input_file = os.path.join(input_pa, patient, patient_file)
    else:
      input_file = os.path.join(input_pa, "mask", "00.nii.gz")
    
    pred_in = sitk.ReadImage(input_file)
    pred_npy = sitk.GetArrayFromImage(pred_in)  # [slice, z, y, x]
    
    # Normalize dimensions to handle both 3D and 4D inputs
    pred_npy = normalize_nifti_dimensions(pred_npy)
    
    countlist = []
    for i in range(pred_npy.shape[0]):
        if np.any(pred_npy[i, :, :].astype(np.int32) == 2):
            count = np.sum(pred_npy[i, :, :].astype(np.int32) == 2)
            countlist.append(count)
    
    # VALIDATION: Check if any LVM (label 2) was found across ALL slices
    if len(countlist) == 0:
        unique_values = np.unique(pred_npy.astype(np.int32))
        max_val = np.max(pred_npy)
        min_val = np.min(pred_npy)
        raise ValueError(
            f"No LVM (label 2) found in ANY slice of the segmentation mask. "
            f"This function requires a segmentation mask with labels: 1=RV, 2=LVM, 3=LV. "
            f"Unique values found: {unique_values[:20]}{'...' if len(unique_values) > 20 else ''}. "
            f"Value range: [{min_val}, {max_val}]. "
            f"If all values are continuous (e.g., 0-255 grayscale), you likely provided "
            f"the original MRI image instead of a segmentation mask."
        )
    
    # Safe handling for edge cases: if countlist has fewer than 3 elements after trimming
    if len(countlist) <= 2:
        # Not enough slices to determine orientation reliably, default to base-to-apex
        return "btoa"
    
    countlist = countlist[1:-1]
    
    if len(countlist) <= 1:
        # Still not enough data after trimming, default to base-to-apex
        return "btoa"
    
    differences = [countlist[i] - countlist[i + 1] for i in range(len(countlist) - 1)]
    positive_count = sum(1 for num in differences if num > 0)
    negative_count = sum(1 for num in differences if num < 0)
    if positive_count > negative_count:
        datatype = "btoa"  # ACDC, base to apex
    else:
        datatype = "atob"  # JSH, apex to base
    return datatype

def get_T(base_path, dataset_name='', patient='', patient_file=''): # ADDED CONSIDERATIONS FOR WORKING WITH ACDC
    """Get T from input segmentation.
        """
    data_type = decide_orient(base_path, dataset_name, patient, patient_file)
    if dataset_name == 'acdc':
      vertices_lvv_slice = get_contour(os.path.join(base_path, patient, patient_file))  # Get 3D contour from mask
    else:
      vertices_lvv_slice = get_contour(os.path.join(base_path, "mask", "00.nii.gz"))  # Get 3D contour from mask

    #################get ED: phase = 00 #################
    vm1 = np.array([0, 0, 1])  # from mean shape
    vm2 = np.array([0.993, 0.120, 0])

    if dataset_name == 'acdc':
      pred_name = os.path.join(base_path, patient, patient_file)  # input_pred
    else:
      pred_name = os.path.join(base_path, "mask", "00.nii.gz")  # input_pred
    pred_in = sitk.ReadImage(pred_name)
    pred_npy_raw = sitk.GetArrayFromImage(pred_in)
    
    # Normalize dimensions to handle both 3D and 4D inputs
    pred_npy_raw = normalize_nifti_dimensions(pred_npy_raw)
    
    pred_npy = pred_npy_raw.transpose(2, 1, 0)  # [z, y, x]

    #################get T matrix of ED (the process of registration)#################
    slice_list = []
    for k in range(pred_npy.shape[2]):
        if 2 in pred_npy[:, :, k].astype(np.int32):
            slice_list.append(k)
    
    # VALIDATION: Check if any LVM (label 2) was found across ALL slices
    # It's normal for some frames (especially at apex/base) to have no LVM
    if len(slice_list) == 0:
        # Get statistics about what's in the image
        unique_values = np.unique(pred_npy.astype(np.int32))
        max_val = np.max(pred_npy)
        min_val = np.min(pred_npy)
        
        # Check if this looks like a segmentation mask or raw image data
        if len(unique_values) > 10 or max_val > 10:
            # Likely raw image data, not a segmentation mask
            raise ValueError(
                f"No LVM (label 2) found in this frame, and the data appears to be raw image data. "
                f"This function requires a segmentation mask with labels: 1=RV, 2=LVM, 3=LV. "
                f"Unique values found: {unique_values[:20]}{'...' if len(unique_values) > 20 else ''}. "
                f"Value range: [{min_val}, {max_val}]. "
                f"Expected discrete labels (1, 2, 3), but found continuous values."
            )
        else:
            # Likely a valid segmentation mask, just no LVM in this frame
            # This can happen at apex/base slices - return None to signal this frame should be skipped
            raise ValueError(
                f"No LVM (label 2) found in this segmentation frame. "
                f"This is expected for frames at the apex or base of the heart. "
                f"Frame contains labels: {unique_values}. "
                f"This frame cannot be used for transformation matrix calculation."
            )
    
    zMin = min(slice_list)
    zMax = max(slice_list)

    slice_num = int((zMin + zMax) / 2)  # choose the mid slice
    #######################################get RV Union LVV#######################################
    mask = np.zeros([pred_npy.shape[0], pred_npy.shape[1]])
    list1 = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 2)
    list2 = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 1)
    list = [np.append(list1[0], list2[0]), np.append(list1[1], list2[1])]
    mask[tuple(list)] = 255
    # cv2.imshow("mask", mask)
    # cv2.waitKey()

    mask = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
    area = []
    for k in range(len(contours)):
        area.append(cv2.contourArea(contours[k]))
    max_idx = np.argmax(np.array(area))

    result_U = np.zeros(mask.shape, np.uint8)
    list = np.squeeze(contours[max_idx])
    list = np.array(list)
    list = [list[:, 1], list[:, 0]]
    result_U[tuple(list)] = 255
    # cv2.imshow("contour", result_U.transpose() / 255)
    # cv2.waitKey()

    #######################################get LVM contour#######################################
    mask = np.zeros([pred_npy.shape[0], pred_npy.shape[1]])
    list = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 2)
    mask[list] = 255

    mask = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
    area = []
    for k in range(len(contours)):
        area.append(cv2.contourArea(contours[k]))
    max_idx = np.argmax(np.array(area))

    result_lvv = np.zeros(mask.shape, np.uint8)
    list = np.squeeze(contours[max_idx])
    list = np.array(list)
    list = [list[:, 1], list[:, 0]]
    result_lvv[tuple(list)] = 255
    # cv2.imshow("result_lvv", result_lvv.transpose() / 255)

    #######################################get RV contour#######################################
    mask = np.zeros([pred_npy.shape[0], pred_npy.shape[1]])
    list = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 1)
    mask[list] = 255

    mask = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)

    result_rv = np.zeros(mask.shape, np.uint8)
    list = []
    for k in range(len(contours)):
        contours_list = np.squeeze(contours[k])  # [N，2]
        if len(contours_list.shape) == 1:
            continue
        list.extend(contours_list)

    if len(list) > 0:
        list = np.array(list)
        list = [list[:, 1], list[:, 0]]
        result_rv[tuple(list)] = 255
    # cv2.imshow("result_rv", result_rv.transpose() / 255)

    result_S = -(result_U.astype(np.float32) - result_lvv.astype(np.float32) - result_rv.astype(np.float32))
    list_S = np.array(np.where(result_S == 255)).transpose()
    
    ###### Here get the inter_point #####
    # Check if we have any intersection points
    if list_S.size == 0:
        # No intersection points found - this can happen if RV is missing
        # Use center of LVM contour as fallback
        lvm_points = np.where(result_lvv == 255)
        if lvm_points[0].size > 0:
            inter_point = np.array([np.mean(lvm_points[0]), np.mean(lvm_points[1])])
        else:
            raise ValueError(
                f"Cannot determine cardiac intersection point. "
                f"No RV or LVM contours found in slice {slice_num}. "
                f"This frame may not contain sufficient cardiac structure for reconstruction."
            )
    else:
        inter_point = np.mean(list_S, axis=0)
    
    result_S[inter_point[0].astype(np.uint8), inter_point[1].astype(np.uint8)] = 255
    # cv2.imshow("result_S", result_S.astype(np.uint8).transpose() / 255)
    # cv2.waitKey()

    #######################################get LV contour#######################################
    mask = np.zeros([pred_npy.shape[0], pred_npy.shape[1]])
    list = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 3)
    mask[list] = 255

    mask = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)

    area = []
    for k in range(len(contours)):
        area.append(cv2.contourArea(contours[k]))
    max_idx = np.argmax(np.array(area))

    result_lv = np.zeros(mask.shape, np.uint8)
    list_LV = np.squeeze(contours[max_idx])
    list_LV = np.array(list_LV)
    ###### Here get the LV MID point #####
    list_LV = [list_LV[:, 1], list_LV[:, 0]]
    lv_point = np.mean(list_LV, axis=1)
    result_lv[tuple(list_LV)] = 255
    result_lv[lv_point[0].astype(np.uint8), lv_point[1].astype(np.uint8)] = 255
    # cv2.imshow("result_lv", result_lv.astype(np.uint8).transpose() / 255)
    # cv2.waitKey()

    # Extract spatial metadata (handles both 3D and 4D images)
    space_origin, space_spacing, space_directions_matrix = extract_spatial_metadata(pred_in)
    space_directions = space_spacing * space_directions_matrix

    lps2world = np.identity(4)
    lps2world[0:3, 0:3] = space_directions
    lps2world[0:3, 3] = space_origin

    homogeneous = np.array([[inter_point[0], inter_point[1], slice_num, 1]])
    inter_point_w = np.dot(lps2world, homogeneous.transpose())[0:3, :].transpose()
    homogeneous = np.array([[lv_point[0], lv_point[1], slice_num, 1]])
    lv_point_w = np.dot(lps2world, homogeneous.transpose())[0:3, :].transpose()

    v1 = space_directions[0:3, 2]
    if data_type == "atob":  # for our dataset
        v1 = -v1 / np.linalg.norm(v1)
    else:  # for some dataset like acdc
        v1 = v1 / np.linalg.norm(v1)
    v2 = inter_point_w - lv_point_w
    v2 = v2[0, :] / np.linalg.norm(v2)

    v = np.cross(v1, vm1)
    s = np.linalg.norm(v)
    R1 = np.identity(4)
    if s != 0:
        c = np.dot(v1, vm1)
        Vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R1[0:3, 0:3] = np.identity(3) + Vx + np.dot(Vx, Vx) * (1 - c) / (s * s)

    v2 = np.dot(R1, np.array([v2[0], v2[1], v2[2], 1]))[0:3]

    v = np.cross(v2, vm2)
    s = np.linalg.norm(v)
    R2 = np.identity(4)
    if s != 0:
        c = np.dot(v2, vm2)
        Vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R2[0:3, 0:3] = np.identity(3) + Vx + np.dot(Vx, Vx) * (1 - c) / (s * s)

    T = np.dot(R2, R1)
    T[0:3, 3] = np.mean(vertices_lvv_slice, axis=0)
    Ti = np.identity(4)
    Ti[0:3, 0:3] = np.linalg.inv(T[0:3, 0:3])
    Ti[0:3, 3] = -np.dot(np.linalg.inv(T[0:3, 0:3]), T[0:3, 3])

    #### get normalization parameters
    shape_lvv_1 = transformation(T, vertices_lvv_slice.transpose())
    offset, scale = ComputeNormalizationParameters(shape_lvv_1)

    return T, offset, scale

# Added 17SEPT2025 - James - Safer
def get_T_safe(base_path, dataset_name='', patient='', patient_file=''):
    """Get T from input segmentation.
    Safe version that uses get_contour_safe.
    """
    data_type = decide_orient(base_path, dataset_name, patient, patient_file)
    if dataset_name == 'acdc':
      vertices_lvv_slice = get_contour_safe(os.path.join(base_path, patient, patient_file))  # Get 3D contour from mask
    else:
      vertices_lvv_slice = get_contour_safe(os.path.join(base_path, "mask", "00.nii.gz"))  # Get 3D contour from mask

    #################get ED: phase = 00 #################
    vm1 = np.array([0, 0, 1])  # from mean shape
    vm2 = np.array([0.993, 0.120, 0])

    if dataset_name == 'acdc':
      pred_name = os.path.join(base_path, patient, patient_file)  # input_pred
    else:
      pred_name = os.path.join(base_path, "mask", "00.nii.gz")  # input_pred
    pred_in = sitk.ReadImage(pred_name)
    pred_npy_raw = sitk.GetArrayFromImage(pred_in)
    
    # Normalize dimensions to handle both 3D and 4D inputs
    pred_npy_raw = normalize_nifti_dimensions(pred_npy_raw)
    
    pred_npy = pred_npy_raw.transpose(2, 1, 0)  # [z, y, x]

    #################get T matrix of ED (the process of registration)#################
    slice_list = []
    for k in range(pred_npy.shape[2]):
        if 2 in pred_npy[:, :, k].astype(np.int32):
            slice_list.append(k)
    
    # VALIDATION: Check if any LVM (label 2) was found across ALL slices
    # It's normal for some frames (especially at apex/base) to have no LVM
    if len(slice_list) == 0:
        # Get statistics about what's in the image
        unique_values = np.unique(pred_npy.astype(np.int32))
        max_val = np.max(pred_npy)
        min_val = np.min(pred_npy)
        
        # Check if this looks like a segmentation mask or raw image data
        if len(unique_values) > 10 or max_val > 10:
            # Likely raw image data, not a segmentation mask
            raise ValueError(
                f"No LVM (label 2) found in this frame, and the data appears to be raw image data. "
                f"This function requires a segmentation mask with labels: 1=RV, 2=LVM, 3=LV. "
                f"Unique values found: {unique_values[:20]}{'...' if len(unique_values) > 20 else ''}. "
                f"Value range: [{min_val}, {max_val}]. "
                f"Expected discrete labels (1, 2, 3), but found continuous values."
            )
        else:
            # Likely a valid segmentation mask, just no LVM in this frame
            # This can happen at apex/base slices - return None to signal this frame should be skipped
            raise ValueError(
                f"No LVM (label 2) found in this segmentation frame. "
                f"This is expected for frames at the apex or base of the heart. "
                f"Frame contains labels: {unique_values}. "
                f"This frame cannot be used for transformation matrix calculation."
            )
    
    zMin = min(slice_list)
    zMax = max(slice_list)

    slice_num = int((zMin + zMax) / 2)  # choose the mid slice
    #######################################get RV Union LVV#######################################
    mask = np.zeros([pred_npy.shape[0], pred_npy.shape[1]])
    list1 = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 2)
    list2 = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 1)
    list = [np.append(list1[0], list2[0]), np.append(list1[1], list2[1])]
    mask[tuple(list)] = 255
    # cv2.imshow("mask", mask)
    # cv2.waitKey()

    mask = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
    area = []
    for k in range(len(contours)):
        area.append(cv2.contourArea(contours[k]))
    max_idx = np.argmax(np.array(area))

    result_U = np.zeros(mask.shape, np.uint8)
    list = np.squeeze(contours[max_idx])
    list = np.array(list)
    list = [list[:, 1], list[:, 0]]
    result_U[tuple(list)] = 255
    # cv2.imshow("contour", result_U.transpose() / 255)
    # cv2.waitKey()

    #######################################get LVM contour#######################################
    mask = np.zeros([pred_npy.shape[0], pred_npy.shape[1]])
    list = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 2)
    mask[list] = 255

    mask = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
    area = []
    for k in range(len(contours)):
        area.append(cv2.contourArea(contours[k]))
    max_idx = np.argmax(np.array(area))

    result_lvv = np.zeros(mask.shape, np.uint8)
    list = np.squeeze(contours[max_idx])
    list = np.array(list)
    list = [list[:, 1], list[:, 0]]
    result_lvv[tuple(list)] = 255
    # cv2.imshow("result_lvv", result_lvv.transpose() / 255)

    #######################################get RV contour#######################################
    mask = np.zeros([pred_npy.shape[0], pred_npy.shape[1]])
    list = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 1)
    mask[list] = 255

    mask = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)

    result_rv = np.zeros(mask.shape, np.uint8)
    list = []
    for k in range(len(contours)):
        contours_list = np.squeeze(contours[k])  # [N，2]
        if len(contours_list.shape) == 1:
            continue
        list.extend(contours_list)

    if len(list) > 0:
        list = np.array(list)
        list = [list[:, 1], list[:, 0]]
        result_rv[tuple(list)] = 255
    # cv2.imshow("result_rv", result_rv.transpose() / 255)

    result_S = -(result_U.astype(np.float32) - result_lvv.astype(np.float32) - result_rv.astype(np.float32))
    list_S = np.array(np.where(result_S == 255)).transpose()
    
    ###### Here get the inter_point #####
    # Check if we have any intersection points
    if list_S.size == 0:
        # No intersection points found - this can happen if RV is missing
        # Use center of LVM contour as fallback
        lvm_points = np.where(result_lvv == 255)
        if lvm_points[0].size > 0:
            inter_point = np.array([np.mean(lvm_points[0]), np.mean(lvm_points[1])])
        else:
            raise ValueError(
                f"Cannot determine cardiac intersection point. "
                f"No RV or LVM contours found in slice {slice_num}. "
                f"This frame may not contain sufficient cardiac structure for reconstruction."
            )
    else:
        inter_point = np.mean(list_S, axis=0)
    
    result_S[inter_point[0].astype(np.uint8), inter_point[1].astype(np.uint8)] = 255
    # cv2.imshow("result_S", result_S.astype(np.uint8).transpose() / 255)
    # cv2.waitKey()

    #######################################get LV contour#######################################
    mask = np.zeros([pred_npy.shape[0], pred_npy.shape[1]])
    list = np.where(pred_npy[:, :, slice_num].astype(np.int32) == 3)
    mask[list] = 255

    mask = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)

    area = []
    for k in range(len(contours)):
        area.append(cv2.contourArea(contours[k]))
    max_idx = np.argmax(np.array(area))

    result_lv = np.zeros(mask.shape, np.uint8)
    list_LV = np.squeeze(contours[max_idx])
    list_LV = np.array(list_LV)
    ###### Here get the LV MID point #####
    list_LV = [list_LV[:, 1], list_LV[:, 0]]
    lv_point = np.mean(list_LV, axis=1)
    result_lv[tuple(list_LV)] = 255
    result_lv[lv_point[0].astype(np.uint8), lv_point[1].astype(np.uint8)] = 255
    # cv2.imshow("result_lv", result_lv.astype(np.uint8).transpose() / 255)
    # cv2.waitKey()

    # Extract spatial metadata (handles both 3D and 4D images)
    space_origin, space_spacing, space_directions_matrix = extract_spatial_metadata(pred_in)
    space_directions = space_spacing * space_directions_matrix

    lps2world = np.identity(4)
    lps2world[0:3, 0:3] = space_directions
    lps2world[0:3, 3] = space_origin

    homogeneous = np.array([[inter_point[0], inter_point[1], slice_num, 1]])
    inter_point_w = np.dot(lps2world, homogeneous.transpose())[0:3, :].transpose()
    homogeneous = np.array([[lv_point[0], lv_point[1], slice_num, 1]])
    lv_point_w = np.dot(lps2world, homogeneous.transpose())[0:3, :].transpose()

    v1 = space_directions[0:3, 2]
    if data_type == "atob":  # for our dataset
        v1 = -v1 / np.linalg.norm(v1)
    else:  # for some dataset like acdc
        v1 = v1 / np.linalg.norm(v1)
    v2 = inter_point_w - lv_point_w
    v2 = v2[0, :] / np.linalg.norm(v2)

    v = np.cross(v1, vm1)
    s = np.linalg.norm(v)
    R1 = np.identity(4)
    if s != 0:
        c = np.dot(v1, vm1)
        Vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R1[0:3, 0:3] = np.identity(3) + Vx + np.dot(Vx, Vx) * (1 - c) / (s * s)

    v2 = np.dot(R1, np.array([v2[0], v2[1], v2[2], 1]))[0:3]

    v = np.cross(v2, vm2)
    s = np.linalg.norm(v)
    R2 = np.identity(4)
    if s != 0:
        c = np.dot(v2, vm2)
        Vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R2[0:3, 0:3] = np.identity(3) + Vx + np.dot(Vx, Vx) * (1 - c) / (s * s)

    T = np.dot(R2, R1)
    T[0:3, 3] = np.mean(vertices_lvv_slice, axis=0)
    Ti = np.identity(4)
    Ti[0:3, 0:3] = np.linalg.inv(T[0:3, 0:3])
    Ti[0:3, 3] = -np.dot(np.linalg.inv(T[0:3, 0:3]), T[0:3, 3])

    #### get normalization parameters
    shape_lvv_1 = transformation(T, vertices_lvv_slice.transpose())
    offset, scale = ComputeNormalizationParameters(shape_lvv_1)

    return T, offset, scale


if __name__ == "__main__":
    root = r'\examples\your_seg_path'
    patient_list = os.listdir(root)
    for patient in patient_list:
        input_path = os.path.join(root, patient)
        T, offset, scale = get_T(input_path)
        output_T = os.path.join(root, patient, "P.txt")
        np.savetxt(output_T, T, fmt='%0.6f')


