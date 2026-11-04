import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * A model of many parts (each its own mesh, so its own draw call) baked into ONE geometry with each part's colour
 * in its vertices: the same shape, drawn in a single call with one plain material. Used for things seen from a
 * distance, where textures and separate materials make no visible difference.
 */
export function mergeColored(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert(), local = new THREE.Matrix4();
  const parts: THREE.BufferGeometry[] = [];
  const colour = new THREE.Color();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
    const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial | undefined;
    if (!material || material.visible === false) return;
    const source = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const position = source.getAttribute("position"), normal = source.getAttribute("normal");
    if (!position) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", position.clone());
    if (normal) g.setAttribute("normal", normal.clone());
    g.applyMatrix4(local.multiplyMatrices(inverse, o.matrixWorld));
    if (!normal) g.computeVertexNormals();
    // The part's colour (lights keep their glow colour so they still read as lights).
    colour.copy(material.color ?? new THREE.Color("#ffffff"));
    if (material.emissive && (material.emissiveIntensity ?? 0) > 0.5 && material.emissive.getHex() !== 0) colour.copy(material.emissive);
    const n = g.getAttribute("position").count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = colour.r; c[i * 3 + 1] = colour.g; c[i * 3 + 2] = colour.b; }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    parts.push(g);
    if (source !== o.geometry) source.dispose();
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}
