import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b14);
  scene.fog = new THREE.Fog(0x070b14, 22, 48);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 13, 11);
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0a0f1e, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  const controls = new OrbitControls(camera, canvas);
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = false;
  controls.enableDamping = true;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.15;
  controls.minDistance = 5;
  controls.maxDistance = 40;

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();
  return { renderer, scene, camera, controls };
}
