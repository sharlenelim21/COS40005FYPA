#!/usr/bin/env python3
"""
File-based NPZ to OBJ converter for 4D cardiac reconstruction
Converts NPZ mesh files to OBJ format using temporary file processing
"""
import sys
import os
import numpy as np
import argparse
from typing import Optional

def npz_to_obj_string(vertices: np.ndarray, faces: np.ndarray) -> str:
    """
    Convert numpy arrays to OBJ format string
    
    Args:
        vertices: Nx3 array of vertex coordinates
        faces: Mx3 array of face indices (0-based, will be converted to 1-based for OBJ)
    
    Returns:
        OBJ format string
    """
    obj_lines = []
    obj_lines.append("# OBJ file generated from NPZ cardiac mesh data")
    obj_lines.append(f"# Vertices: {len(vertices)}, Faces: {len(faces)}")
    obj_lines.append("")
    
    # Write vertices (v x y z)
    for vertex in vertices:
        obj_lines.append(f"v {vertex[0]:.6f} {vertex[1]:.6f} {vertex[2]:.6f}")
    
    obj_lines.append("")
    
    # Write faces (f v1 v2 v3) - OBJ uses 1-based indexing
    for face in faces:
        obj_lines.append(f"f {face[0]+1} {face[1]+1} {face[2]+1}")
    
    return "\n".join(obj_lines)

def npz_to_obj_file(npz_file_path: str, obj_file_path: str) -> bool:
    """
    Convert NPZ mesh file to OBJ format file
    
    Args:
        npz_file_path: Path to input NPZ file
        obj_file_path: Path to output OBJ file
    
    Returns:
        True if successful, False otherwise
    """
    try:
        # Load NPZ data from file
        try:
            npz_data = np.load(npz_file_path)
        except Exception as e:
            print(f"ERROR: Failed to load NPZ file '{npz_file_path}': {e}", file=sys.stderr)
            return False
        
        # Extract vertices and faces
        if 'vertices' not in npz_data or 'faces' not in npz_data:
            available_keys = list(npz_data.keys())
            print(f"ERROR: Required keys 'vertices' and 'faces' not found in NPZ. Available keys: {available_keys}", file=sys.stderr)
            npz_data.close()
            return False
        
        vertices = npz_data['vertices']
        faces = npz_data['faces']
        
        # Validate array shapes
        if vertices.ndim != 2 or vertices.shape[1] != 3:
            print(f"ERROR: Invalid vertices shape {vertices.shape}, expected (N, 3)", file=sys.stderr)
            npz_data.close()
            return False
        
        if faces.ndim != 2 or faces.shape[1] != 3:
            print(f"ERROR: Invalid faces shape {faces.shape}, expected (M, 3)", file=sys.stderr)
            npz_data.close()
            return False
        
        print(f"INFO: Processing mesh with {len(vertices)} vertices and {len(faces)} faces", file=sys.stderr)
        
        # Convert to OBJ format string
        obj_content = npz_to_obj_string(vertices, faces)
        
        # Write OBJ content to file
        try:
            with open(obj_file_path, 'w', encoding='utf-8') as obj_file:
                obj_file.write(obj_content)
        except Exception as e:
            print(f"ERROR: Failed to write OBJ file '{obj_file_path}': {e}", file=sys.stderr)
            npz_data.close()
            return False
        
        npz_data.close()
        print(f"SUCCESS: Converted NPZ to OBJ successfully. Output: {obj_file_path}", file=sys.stderr)
        return True
        
    except Exception as e:
        print(f"ERROR: Unexpected error during conversion: {e}", file=sys.stderr)
        return False

def main():
    """
    Main function to handle command-line arguments and perform NPZ to OBJ conversion
    """
    parser = argparse.ArgumentParser(
        description="Convert NPZ mesh files to OBJ format",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
        Examples:
        python convert_npz_to_obj.py input.npz output.obj
        python convert_npz_to_obj.py mesh_data.npz cardiac_mesh.obj
        """
    )
    
    parser.add_argument('input_npz', help='Path to input NPZ file')
    parser.add_argument('output_obj', help='Path to output OBJ file')
    parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    # Validate input file exists
    if not os.path.exists(args.input_npz):
        print(f"ERROR: Input NPZ file '{args.input_npz}' does not exist", file=sys.stderr)
        return False
    
    # Ensure output directory exists
    output_dir = os.path.dirname(os.path.abspath(args.output_obj))
    if output_dir and not os.path.exists(output_dir):
        try:
            os.makedirs(output_dir, exist_ok=True)
            if args.verbose:
                print(f"INFO: Created output directory '{output_dir}'", file=sys.stderr)
        except Exception as e:
            print(f"ERROR: Failed to create output directory '{output_dir}': {e}", file=sys.stderr)
            return False
    
    # Perform conversion
    if args.verbose:
        print(f"INFO: Converting '{args.input_npz}' to '{args.output_obj}'", file=sys.stderr)
    
    success = npz_to_obj_file(args.input_npz, args.output_obj)
    
    if success:
        if args.verbose:
            file_size = os.path.getsize(args.output_obj) if os.path.exists(args.output_obj) else 0
            print(f"INFO: Conversion completed successfully. Output file size: {file_size} bytes", file=sys.stderr)
        return True
    else:
        print(f"ERROR: Conversion failed", file=sys.stderr)
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)