"use client";
import { useEffect, useRef, Suspense, useState, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, useGLTF, Center } from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { AlertCircle, AlertTriangle, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "next-themes";
import * as THREE from "three";

// Visualization settings interface
interface ViewerSettings {
  modelColor: string;
  wireframe: boolean;
  showEdges: boolean;
  /** Average normals at shared vertices so shading crosses facet boundaries. Cosmetic only. */
  smoothShading: boolean;
  background: 'gradient' | 'solid-dark' | 'solid-light' | 'white' | 'responsive';
  showGrid: boolean;
  roughness: number;
  metalness: number;
  opacity: number;
  environmentPreset: 'studio' | 'sunset' | 'dawn' | 'night' | 'warehouse' | 'forest' | 'apartment' | 'city' | 'park' | 'lobby';
}

// Default settings
const DEFAULT_SETTINGS: ViewerSettings = {
  modelColor: '#c41e3a', // Cardiac tissue color
  wireframe: false,
  showEdges: false,
  smoothShading: true,
  background: 'responsive',
  showGrid: true,
  roughness: 0.4,
  metalness: 0.1,
  opacity: 1.0,
  environmentPreset: 'studio',
};

// Preset color palette for cardiac structures
const COLOR_PRESETS = {
  'Red': '#c41e3a',
  'Blue': '#4a90e2',
  'Green': '#09af00',
  'Purple': '#4a26fd',
};

// Model loader that supports both GLB/GLTF and OBJ formats
interface ModelProps { 
  url: string;
  settings: ViewerSettings;
  /**
   * Fired when real geometry is in the scene graph -- NOT when the component mounts.
   * <Center> measures its children exactly once and never re-measures (children are not in its
   * effect deps), so it must be told when there is something real to measure. Before this fired,
   * it was measuring the 1x1x1 placeholder below and keeping that offset forever.
   */
  onReady?: () => void;
}

function Model({ url, settings, onReady }: ModelProps) {
  const [fileType, setFileType] = useState<'obj' | 'glb' | null>(null);
  
  // Detect file type from blob MIME type (for blob URLs) or extension (for regular URLs)
  useEffect(() => {
    const detectFileType = async () => {
      if (url.startsWith('blob:')) {
        // For blob URLs, fetch and check MIME type
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          const mimeType = blob.type;
          
          console.log('[Model] Detected blob MIME type:', mimeType);
          
          if (mimeType === 'text/plain') {
            setFileType('obj');
          } else {
            setFileType('glb');
          }
        } catch (err) {
          console.error('[Model] Failed to detect file type:', err);
          setFileType('glb'); // Default to GLB
        }
      } else {
        // For regular URLs, check file extension
        const fileExtension = url.split('.').pop()?.toLowerCase();
        setFileType(fileExtension === 'obj' ? 'obj' : 'glb');
      }
    };
    
    detectFileType();
  }, [url]);
  
  if (!fileType) {
    // Placeholder while the file type is detected. This renders synchronously and does NOT
    // suspend, which is why <Center> used to measure this box instead of the model.
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#888888" wireframe />
      </mesh>
    );
  }
  
  if (fileType === 'obj') {
    return <OBJModel url={url} settings={settings} onReady={onReady} />;
  } else {
    return <GLBModel url={url} settings={settings} onReady={onReady} />;
  }
}

function GLBModel({ url, settings, onReady }: ModelProps) {
  const { scene } = useGLTF(url);

  // useGLTF suspends until the file is parsed, so reaching here means `scene` is real geometry.
  useEffect(() => {
    onReady?.();
  }, [scene, onReady]);

  useEffect(() => { 
    console.log("[GLBViewer] GLB/GLTF Model loaded");
    
    // Apply customizable materials to all meshes
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;

        // Marching-cubes output carries no vertex normals, so three.js falls back to flat
        // per-face shading. At the default resolution (N=32) the facets are ~17x larger by area
        // than at N=128, and each one reflects the environment as a single uniform value --
        // facets angled at a bright part of the HDRI turn near-white and read as holes in a
        // surface that is in fact closed (measured: watertight, winding-consistent, euler 2).
        //
        // Averaging normals at shared vertices shades across facet boundaries instead.
        // NOTE: this is cosmetic. It makes a coarse mesh look smooth without adding any
        // information to it -- raise the reconstruction resolution for actual detail.
        if (mesh.geometry && (settings.smoothShading || !mesh.geometry.getAttribute("normal"))) {
          mesh.geometry.computeVertexNormals();
        }

        if (mesh.material) {
          const material = mesh.material as THREE.MeshStandardMaterial;
          
          // Apply settings
          material.color = new THREE.Color(settings.modelColor);
          material.roughness = settings.roughness;
          material.metalness = settings.metalness;
          material.wireframe = settings.wireframe;
          material.transparent = settings.opacity < 1;
          material.opacity = settings.opacity;
          material.envMapIntensity = 1.2;
          
          // Fix transparency rendering issues
          material.side = THREE.DoubleSide; // Render both sides of faces
          material.depthWrite = settings.opacity >= 1; // Disable depth writing for transparent objects
          
          material.needsUpdate = true; // Force material update
          
          // Edge wireframe overlay
          if (settings.showEdges && !settings.wireframe) {
            const edges = new THREE.EdgesGeometry(mesh.geometry);
            const line = new THREE.LineSegments(
              edges, 
              new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 })
            );
            mesh.add(line);
          }
        }
      }
    });
  }, [scene, settings, url]); // Include url to trigger reapplication when frame changes
  
  // Deliberately NOT wrapped in <Center> here. Centering happens once around the whole model
  // group in the Canvas, so that when a second chamber is overlaid the two meshes keep their true
  // relative position instead of each being independently snapped to the origin.
  return <primitive object={scene} />;
}

function OBJModel({ url, settings, onReady }: ModelProps) {
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("[OBJViewer] Starting OBJ load from URL:", url);
    const loader = new OBJLoader();
    
    loader.load(
      url,
      (loadedObj) => {
        console.log("[OBJViewer] OBJ Model loaded successfully", loadedObj);
        
        // Apply customizable materials to OBJ
        loadedObj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            
            console.log("[OBJViewer] Applying material to mesh:", mesh.name || "unnamed");

            // See the GLB path above: marching-cubes OBJ has no vertex normals, so without this
            // every facet is flat-shaded and coarse meshes read as punctured.
            if (mesh.geometry && (settings.smoothShading || !mesh.geometry.getAttribute("normal"))) {
              mesh.geometry.computeVertexNormals();
            }
            
            mesh.material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(settings.modelColor),
              roughness: settings.roughness,
              metalness: settings.metalness,
              wireframe: settings.wireframe,
              transparent: settings.opacity < 1,
              opacity: settings.opacity,
              envMapIntensity: 1.2,
              side: THREE.DoubleSide, // Render both sides of faces
              depthWrite: settings.opacity >= 1, // Disable depth writing for transparent objects
            });
            
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            // Edge wireframe overlay
            if (settings.showEdges && !settings.wireframe) {
              const edges = new THREE.EdgesGeometry(mesh.geometry);
              const line = new THREE.LineSegments(
                edges, 
                new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 })
              );
              mesh.add(line);
            }
          }
        });
        
        setObj(loadedObj);
        setError(null);
        onReady?.();
      },
      (progress) => {
        console.log("[OBJViewer] Loading progress:", (progress.loaded / progress.total * 100).toFixed(2) + "%");
      },
      (err) => {
        const errorMessage = err instanceof Error ? err.message : "Failed to load OBJ file";
        console.error("[OBJViewer] Error loading OBJ:", err);
        setError(errorMessage);
      }
    );
  }, [url, settings, onReady]);

  if (error) {
    console.error("[OBJViewer] Render error:", error);
    return (
      <mesh>
        <boxGeometry args={[10, 10, 10]} />
        <meshStandardMaterial color="red" wireframe />
      </mesh>
    );
  }

  if (!obj) {
    console.log("[OBJViewer] Waiting for OBJ to load...");
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#888" wireframe />
      </mesh>
    );
  }
  
  // See GLBModel: centering is done once around the whole group, not per mesh.
  return <primitive object={obj} />;
}

interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

// Anatomical camera preset positions
const CAMERA_PRESETS = {
  default: { position: [70, 20, -75], target: [0, 0, 0] },
  front: { position: [0, 0, 100], target: [0, 0, 0] },
  back: { position: [0, 0, -100], target: [0, 0, 0] },
  top: { position: [0, 100, 0], target: [0, 0, 0] },
  bottom: { position: [0, -100, 0], target: [0, 0, 0] },
  left: { position: [-100, 0, 0], target: [0, 0, 0] },
  right: { position: [100, 0, 0], target: [0, 0, 0] },
  isometric: { position: [70, 70, 70], target: [0, 0, 0] },
} as const;

type CameraPreset = keyof typeof CAMERA_PRESETS;

interface CameraControllerProps {
  onCameraChange: (state: CameraState) => void;
  initialState: CameraState | null;
  activePreset: CameraPreset | null;
  onPresetComplete: () => void;
}

function CameraController({ onCameraChange, initialState, activePreset, onPresetComplete }: CameraControllerProps) {
  const { camera } = useThree();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const hasRestoredRef = useRef(false);
  const lastSavedStateRef = useRef<string>("");

  // Handle preset camera movements
  useEffect(() => {
    if (activePreset && controlsRef.current) {
      const preset = CAMERA_PRESETS[activePreset];
      const controls = controlsRef.current;
      
      // Smoothly animate to preset position
      const startPos = camera.position.clone();
      const endPos = new THREE.Vector3(...preset.position);
      const startTarget = controls.target.clone();
      const endTarget = new THREE.Vector3(...preset.target);
      
      const duration = 1000; // 1 second animation
      const startTime = Date.now();
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Smooth easing function (ease-in-out)
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        
        // Interpolate position and target
        camera.position.lerpVectors(startPos, endPos, eased);
        controls.target.lerpVectors(startTarget, endTarget, eased);
        controls.update();
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          onPresetComplete();
        }
      };
      
      animate();
    }
  }, [activePreset, camera, onPresetComplete]);

  useEffect(() => {
    if (initialState && controlsRef.current && !hasRestoredRef.current) {
      camera.position.set(...initialState.position);
      controlsRef.current.target.set(...initialState.target);
      controlsRef.current.update();
      hasRestoredRef.current = true;
      console.log("[GLBViewer] Restored camera state:", initialState);
    }
  }, [initialState, camera]);

  const handleChangeEnd = () => {
    // Only save state when user finishes moving (not during movement)
    if (controlsRef.current) {
      const state: CameraState = {
        position: camera.position.toArray() as [number, number, number],
        target: controlsRef.current.target.toArray() as [number, number, number],
      };
      
      // Only update if state actually changed (prevents unnecessary re-renders)
      const stateString = JSON.stringify(state);
      if (stateString !== lastSavedStateRef.current) {
        lastSavedStateRef.current = stateString;
        onCameraChange(state);
      }
    }
  };

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableZoom
      enablePan
      enableRotate
      zoomSpeed={1.0}
      panSpeed={1.0}
      rotateSpeed={1.0}
      onEnd={handleChangeEnd}
    />
  );
}

/**
 * Frames the camera on whatever is actually in the scene.
 *
 * The camera was pinned at [70, 20, -75] with the ground grid nailed to y=-30, sized for one
 * particular mesh. LV alone has a much smaller bounding sphere than LV+RV, so the same fixed
 * camera left it small and sitting high in the frame. This recomputes distance from the measured
 * bounding sphere, so one chamber and two chambers are both framed properly.
 *
 * It runs only when `radius` changes -- i.e. when the set of chambers changes, not per frame --
 * so it never fights the user's own zoom/rotate afterwards.
 */
function CameraFramer({ radius }: { radius: number | null }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;

  useEffect(() => {
    if (!radius || radius <= 0) return;
    const cam = camera as THREE.PerspectiveCamera;
    const fovRadians = (cam.fov * Math.PI) / 180;
    // Distance at which a sphere of this radius fills the vertical FOV, plus margin.
    const distance = (radius / Math.sin(fovRadians / 2)) * 1.15;

    // Keep whatever direction the camera is already looking from, so this reframes without
    // yanking the user to a different viewpoint.
    const direction = cam.position.clone().normalize();
    if (direction.lengthSq() === 0) direction.set(1, 0.3, -1).normalize();
    cam.position.copy(direction.multiplyScalar(distance));

    cam.near = Math.max(0.01, distance - radius * 4);
    cam.far = distance + radius * 8;
    cam.updateProjectionMatrix();

    // <Center> puts the content's centre at the origin, so that is what to orbit around.
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [radius, camera, controls]);

  return null;
}

interface ReconstructionGLBViewerProps { 
  modelUrl: string | null; 
  frame: number; 
  className?: string; 
  /**
   * Optional second mesh drawn in the same scene as `modelUrl`. NOT an overlay: both meshes are
   * opaque peers sharing one <Center>, so each sits where it actually is relative to the other.
   *
   * Either slot may be null independently — passing only `secondaryModelUrl` shows just that
   * mesh. The empty state appears only when both are null.
   *
   * Used for the RV cavity, which is RESEARCH/REFERENCE ONLY. When this holds an RV mesh,
   * `secondaryIsResearchOnly` must be set too — an unlabelled second mesh reads as an equally
   * trustworthy part of the clinical result.
   */
  secondaryModelUrl?: string | null;
  primaryLabel?: string;
  secondaryLabel?: string;
  secondaryColor?: string;
  secondaryIsResearchOnly?: boolean;
}

// Distinct from the primary default (#c41e3a, deep red) so the two chambers are never confused
// with each other, and readable against both light and dark backgrounds.
const SECONDARY_DEFAULT_COLOR = '#2f9ed6';

export function ReconstructionGLBViewer({ 
  modelUrl, 
  frame, 
  className = "",
  secondaryModelUrl = null,
  primaryLabel = "LV myocardium",
  secondaryLabel = "RV cavity",
  secondaryColor = SECONDARY_DEFAULT_COLOR,
  secondaryIsResearchOnly = false,
}: ReconstructionGLBViewerProps) {
  // useTheme hook ensures component re-renders when theme changes (needed for responsive background)
  useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cameraState, setCameraState] = useState<CameraState | null>(null);
  const [activePreset, setActivePreset] = useState<CameraPreset | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_SETTINGS);

  // Which chambers currently have REAL geometry in the scene, as opposed to which were requested.
  // <Center> keys off this rather than off the URLs: the URL changes every frame during playback,
  // and re-centering per frame would cancel out the heart's own motion and pin it to the origin.
  // Keying off readiness re-measures exactly when it must -- when the first mesh actually arrives,
  // and when a chamber is added or removed.
  const [lvReady, setLvReady] = useState(false);
  const [rvReady, setRvReady] = useState(false);

  const handleLvReady = useCallback(() => setLvReady(true), []);
  const handleRvReady = useCallback(() => setRvReady(true), []);

  // Radius of the centred content, reported by <Center> when it measures. Drives both the camera
  // framing and the ground grid, so neither is hardcoded to one particular mesh size.
  const [fitRadius, setFitRadius] = useState<number | null>(null);
  // Must be referentially stable: <Center> lists onCentered in its layout-effect deps, so an
  // inline function would re-measure on every render.
  const handleCentered = useCallback(
    (info: { boundingSphere?: { radius: number } }) => {
      const radius = info?.boundingSphere?.radius;
      if (typeof radius === "number" && Number.isFinite(radius) && radius > 0) {
        setFitRadius(radius);
      }
    },
    [],
  );

  // A hidden or absent chamber is not ready, so bringing it back re-measures.
  useEffect(() => {
    if (!modelUrl) setLvReady(false);
  }, [modelUrl]);
  useEffect(() => {
    if (!secondaryModelUrl) setRvReady(false);
  }, [secondaryModelUrl]);

  const handleCameraChange = (state: CameraState) => {
    setCameraState(state);
  };

  const handlePresetClick = (preset: CameraPreset) => {
    setActivePreset(preset);
  };

  const handlePresetComplete = () => {
    setActivePreset(null);
  };

  // Background gradient mapping
  const getBackgroundClass = () => {
    switch (settings.background) {
      case 'gradient': return 'bg-gradient-to-b from-slate-900 to-slate-800';
      case 'solid-dark': return 'bg-slate-900';
      case 'solid-light': return 'bg-slate-400';
      case 'white': return 'bg-white';
      case 'responsive': return 'bg-background'; // Adapts to theme (black in dark, white in light)
      default: return 'bg-gradient-to-b from-slate-900 to-slate-800';
    }
  };

  // Either chamber alone is a valid view -- hiding LV to inspect RV on its own must still render.
  if (!modelUrl && !secondaryModelUrl) {
    return (
      <div className={"flex items-center justify-center bg-muted/30 rounded-lg border border-dashed " + className}>
        <div className="text-center p-8">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
          <h3 className="font-semibold mt-2">No Model Loaded</h3>
          <p className="text-sm text-muted-foreground">Select a frame, or show a chamber</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      className={"relative rounded-lg border overflow-hidden " + getBackgroundClass() + " " + className}
    >
      {/* Frame Badge */}
      <div className="absolute bottom-3 left-3 z-10 px-3 py-2 rounded-md bg-black/70 text-white text-xs font-semibold">
        Frame {frame}
      </div>

      {/* Chamber legend, bottom-left above the frame badge. NOT top-left: callers put their own
          chrome there (the standalone viewer's Back button), and the legend was rendering
          underneath it.
          Shown whenever the RV slot is in play — including when RV is the only
          mesh on screen, which is exactly when saying so matters most. The research-only marker
          travels with the legend so the warning is on the image itself, not only beside it. */}
      {secondaryModelUrl && (
        <div className="absolute bottom-14 left-3 z-10 px-3 py-2 rounded-md bg-black/70 text-white text-[11px] space-y-1.5 max-w-[240px]">
          {modelUrl && (
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full border border-white/40"
                style={{ backgroundColor: settings.modelColor }}
              />
              <span className="font-semibold">{primaryLabel}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full border border-white/40"
              style={{ backgroundColor: secondaryColor }}
            />
            <span className="font-semibold">{secondaryLabel}</span>
          </div>
          {secondaryIsResearchOnly && (
            <div className="flex items-start gap-1.5 pt-1 mt-1 border-t border-white/20 max-w-[210px] text-amber-300">
              <AlertTriangle className="h-3 w-3 mt-[1px] shrink-0" />
              <span className="leading-snug">
                {secondaryLabel} is research/reference only — not for clinical diagnosis.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Camera Preset Buttons */}
      <div className="absolute top-3 right-3 z-10 space-y-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowPresets(!showPresets)}
            className="bg-black/70 hover:bg-black/90 text-white text-xs"
          >
            <AlertCircle className="h-3 w-3 mr-1" />
            Views
          </Button>
          
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowSettings(!showSettings)}
            className="bg-black/70 hover:bg-black/90 text-white text-xs"
          >
            <Settings className="h-3 w-3 mr-1" />
            Settings
          </Button>
        </div>
        
        {showPresets && (
          <div className="grid grid-cols-2 gap-1 p-2 rounded-md bg-black/70 text-white text-[10px]">
            {Object.keys(CAMERA_PRESETS).map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant="ghost"
                onClick={() => handlePresetClick(preset as CameraPreset)}
                className="h-7 px-2 hover:bg-white/20 text-white text-[10px]"
              >
                {preset.charAt(0).toUpperCase() + preset.slice(1)}
              </Button>
            ))}
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="w-72 p-4 rounded-md bg-black/90 text-white text-xs space-y-4 max-h-[500px] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">Visualization Settings</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSettings(false)}
                className="h-6 w-6 p-0 hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Model Color */}
            <div className="space-y-2">
              <Label className="text-white text-xs">Model Color</Label>
              <Select
                value={settings.modelColor}
                onValueChange={(value: string) => setSettings({ ...settings, modelColor: value })}
              >
                <SelectTrigger className="w-full bg-white/10 border-white/20 text-white text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COLOR_PRESETS).map(([name, color]) => (
                    <SelectItem key={color} value={color} className="text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: color }} />
                        {name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                type="color"
                value={settings.modelColor}
                onChange={(e) => setSettings({ ...settings, modelColor: e.target.value })}
                className="w-full h-8 rounded cursor-pointer"
              />
            </div>

            {/* Background */}
            <div className="space-y-2">
              <Label className="text-white text-xs">Background</Label>
              <Select
                value={settings.background}
                onValueChange={(value: string) => setSettings({ ...settings, background: value as ViewerSettings['background'] })}
              >
                <SelectTrigger className="w-full bg-white/10 border-white/20 text-white text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gradient">Gradient (Slate)</SelectItem>
                  <SelectItem value="solid-dark">Solid Dark</SelectItem>
                  <SelectItem value="solid-light">Solid Light</SelectItem>
                  <SelectItem value="white">White</SelectItem>
                  <SelectItem value="responsive">Responsive (Theme)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Roughness */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-white text-xs">Roughness</Label>
                <span className="text-white/60 text-xs">{settings.roughness.toFixed(2)}</span>
              </div>
              <Slider
                value={[settings.roughness]}
                onValueChange={([value]) => setSettings({ ...settings, roughness: value })}
                min={0}
                max={1}
                step={0.05}
                className="[&>span:first-child]:bg-white/20"
              />
            </div>

            {/* Metalness */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-white text-xs">Metalness</Label>
                <span className="text-white/60 text-xs">{settings.metalness.toFixed(2)}</span>
              </div>
              <Slider
                value={[settings.metalness]}
                onValueChange={([value]) => setSettings({ ...settings, metalness: value })}
                min={0}
                max={1}
                step={0.05}
                className="[&>span:first-child]:bg-white/20"
              />
            </div>

            {/* Opacity */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-white text-xs">Opacity</Label>
                <span className="text-white/60 text-xs">{Math.round(settings.opacity * 100)}%</span>
              </div>
              <Slider
                value={[settings.opacity]}
                onValueChange={([value]) => setSettings({ ...settings, opacity: value })}
                min={0.1}
                max={1}
                step={0.05}
                className="[&>span:first-child]:bg-white/20"
              />
            </div>

            {/* Smooth shading. Exposed as a toggle rather than applied invisibly, because it
                changes how coarse a mesh LOOKS without changing how coarse it IS -- turning it
                off shows the real facet size the reconstruction actually produced. */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-white text-xs">Smooth Shading</Label>
                <p className="text-white/40 text-[10px]">Cosmetic; off shows true facets</p>
              </div>
              <Switch
                checked={settings.smoothShading}
                onCheckedChange={(checked) => setSettings({ ...settings, smoothShading: checked })}
              />
            </div>

            {/* Grid Toggle */}
            <div className="flex items-center justify-between">
              <Label className="text-white text-xs">Ground Grid</Label>
              <Switch
                checked={settings.showGrid}
                onCheckedChange={(checked) => setSettings({ ...settings, showGrid: checked })}
              />
            </div>

            {/* Reset to Defaults */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="w-full text-xs mt-4 bg-white/10 border-white/20 hover:bg-white/20 text-white"
            >
              Reset to Defaults
            </Button>
          </div>
        )}
      </div>
      
      <Canvas 
        camera={{ 
          position: [70, 20, -75], 
          fov: 50, // Reduced FOV for less distortion
          near: 0.1,
          far: 2000
        }} 
        style={{ width: "100%", height: "100%" }} 
        gl={{ 
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
      >
        <Suspense 
          fallback={
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color="#888" wireframe />
            </mesh>
          }
        >
          {/* Three-Point Lighting Setup (Medical Visualization Standard) */}
          {/* Key Light - Main light source (top-right, more angular) */}
          <directionalLight 
            position={[80, 60, 40]} 
            intensity={1.4} 
            castShadow
            shadow-mapSize={[2048, 2048]}
          />
          
          {/* Fill Light - Soften shadows (left side, lower intensity) */}
          <directionalLight 
            position={[-60, 35, 50]} 
            intensity={0.25} 
          />
          
          {/* Rim Light - Edge highlighting (back-top-left for depth) */}
          <directionalLight 
            position={[-40, 50, -60]} 
            intensity={0.4} 
            color="#c8d5e8"
          />
          
          {/* Ambient Light - Minimal for darker interiors */}
          <ambientLight intensity={0.05} />
          
          {/* Hemisphere Light - Very subtle */}
          <hemisphereLight 
            color="#ffffff" 
            groundColor="#222222" 
            intensity={0.1} 
          />
          
          {/* Ground Grid for spatial reference - toggleable */}
          {settings.showGrid && (
            <gridHelper
              // Scaled to the content rather than fixed at 200/-30, which was sized for one mesh
              // and left the grid a distant sliver under a smaller one.
              args={[fitRadius ? fitRadius * 8 : 200, 20, '#666666', '#333333']}
              position={[0, fitRadius ? -fitRadius * 1.4 : -30, 0]}
            />
          )}
          
          {/* Models with settings.
              One <Center> around both, so the overlaid chamber keeps its true offset from the
              primary mesh rather than being separately re-centered on the origin. */}
          {/* cacheKey is load-bearing, and must key off READINESS, not the requested URLs.
              <Center> measures its children once in a layout effect and never again -- children
              are not in its dependency array, and its default cacheKey is a constant 0. Model
              renders a 1x1x1 placeholder synchronously while it sniffs the file type, so that
              placeholder was what got measured, and the resulting near-zero offset was kept
              forever. The mesh then drew at its raw world coordinates, far from the origin --
              which is why the model sat in a corner in the segmentation panel and why turning RV
              on looked like everything flew off screen.
              Keying off which chambers actually have geometry re-measures exactly when it should:
              when the first real mesh lands, and when a chamber is added or removed. It
              deliberately does NOT change per frame -- re-centering every frame would cancel the
              heart's own motion and pin it to the origin. */}
          <CameraFramer radius={fitRadius} />
          <Center
            cacheKey={`${lvReady ? "lv" : ""}|${rvReady ? "rv" : ""}`}
            onCentered={handleCentered}
          >
            {modelUrl && <Model url={modelUrl} settings={settings} onReady={handleLvReady} />}
            {secondaryModelUrl && (
              <Model
                url={secondaryModelUrl}
                settings={{ ...settings, modelColor: secondaryColor }}
                onReady={handleRvReady}
              />
            )}
          </Center>
          
          {/* Environment Map for reflections - customizable preset */}
          <Environment preset={settings.environmentPreset} />
          
          <CameraController 
            onCameraChange={handleCameraChange} 
            initialState={cameraState}
            activePreset={activePreset}
            onPresetComplete={handlePresetComplete}
          />
        </Suspense>
      </Canvas>
      
      {/* Controls Info */}
      <div className="absolute bottom-3 right-3 z-10 px-3 py-2 rounded-md bg-black/70 text-white text-xs">
        <p className="font-semibold">Controls:</p>
        <p>Left Click+Drag: Rotate</p>
        <p>Right Click+Drag: Pan</p>
        <p>Scroll: Zoom</p>
      </div>
    </div>
  );
}
