import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

/**
 * The LV's own apex/base/azimuth-anchor alignment convention (see
 * ReconstructedHeartModel's alignCenterAndScale for the LV case this
 * mirrors), factored out so it can be reused as the SHARED reference frame
 * for any chamber that needs to be oriented "the way it would appear next
 * to LV" -- not just CombinedHeartModel (which renders both chambers
 * together) but also a standalone RV view that wants to match Combined's
 * orientation without actually showing LV.
 */
export const LV_APEX_LABELS = [17];
export const LV_BASE_LABELS = [1, 2, 3, 4, 5, 6];
export const LV_AZIMUTH_ANCHOR_LABEL = 1;
export const AZIMUTH_TARGET_DIRECTION = new THREE.Vector3(0, 0, 1);
export const LV_TARGET_SIZE = 3.55;

export function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) found = child as THREE.Mesh;
  });
  return found;
}

export function loadMesh(url: string, format: "obj" | "glb"): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    if (format === "glb") {
      new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
    } else {
      new OBJLoader().load(url, (object) => resolve(object), undefined, reject);
    }
  });
}

/**
 * Computes the rigid rotation + center + scale that ReconstructedHeartModel
 * would apply to an LV mesh with these vertices/labels, as one Matrix4.
 * Any OTHER mesh sharing the same raw coordinate space (true for LV/RV
 * reconstructions of the same patient/frame -- the backend's NIfTI-to-world
 * transform never takes a `chamber` argument) can have this SAME matrix
 * applied to land in the identical shared frame LV would define, without
 * needing its own apex/base labels.
 */
export function computeLvAlignment(lvVertices: THREE.BufferAttribute, lvLabels: number[]): THREE.Matrix4 {
  const centroidOf = (wanted: Set<number>): THREE.Vector3 | null => {
    const sum = new THREE.Vector3();
    let count = 0;
    for (let i = 0; i < lvVertices.count; i++) {
      const label = lvLabels[i];
      if (label === undefined || !wanted.has(label)) continue;
      sum.x += lvVertices.getX(i);
      sum.y += lvVertices.getY(i);
      sum.z += lvVertices.getZ(i);
      count++;
    }
    return count >= 3 ? sum.divideScalar(count) : null;
  };

  let rotation = new THREE.Quaternion();
  const apex = centroidOf(new Set(LV_APEX_LABELS));
  const base = centroidOf(new Set(LV_BASE_LABELS));
  if (apex && base) {
    const apexToBase = base.clone().sub(apex);
    if (apexToBase.lengthSq() > 1e-8) {
      apexToBase.normalize();
      rotation = new THREE.Quaternion().setFromUnitVectors(apexToBase, new THREE.Vector3(0, 1, 0));
      const anchor = centroidOf(new Set([LV_AZIMUTH_ANCHOR_LABEL]));
      if (anchor) {
        const rotatedAnchor = anchor.clone().sub(base).applyQuaternion(rotation);
        rotatedAnchor.y = 0;
        if (rotatedAnchor.lengthSq() > 1e-8) {
          rotatedAnchor.normalize();
          const azimuthRotation = new THREE.Quaternion().setFromUnitVectors(rotatedAnchor, AZIMUTH_TARGET_DIRECTION);
          rotation = azimuthRotation.multiply(rotation);
        }
      }
    }
  }

  const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotation);

  // Bounding box of the ROTATED LV mesh only -- any other chamber sharing
  // this matrix rides along at whatever size that puts it at, which is
  // correct (it's the real chamber whose size is relative to LV, not
  // something to independently normalize).
  const rotatedLv = new Float32Array(lvVertices.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < lvVertices.count; i++) {
    v.set(lvVertices.getX(i), lvVertices.getY(i), lvVertices.getZ(i)).applyMatrix4(rotationMatrix);
    rotatedLv[i * 3] = v.x; rotatedLv[i * 3 + 1] = v.y; rotatedLv[i * 3 + 2] = v.z;
  }
  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(rotatedLv, 3));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
  const scale = LV_TARGET_SIZE / maxDimension;

  const centerAndScale = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

  return centerAndScale.multiply(rotationMatrix);
}
