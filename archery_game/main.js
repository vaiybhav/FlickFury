import * as THREE from 'three';

// Game state
let scene, camera, renderer;
let arrow, targets = [];
let bullseye = null;
let isCharging = false;
let chargeStartTime = 0;
let currentPower = 0;
let score = 0;
let combo = 0;
let bestCombo = 0;
let arrowInFlight = false;
let currentArrow = null;
let arrowVelocity = new THREE.Vector3();

// Aiming state (separate from power)
let mouseX = 0;
let mouseY = 0;

// Joystick state
let joystickConnected = false;
let joystickX = 50; // 0-100, 50 is center
let joystickY = 50; // 0-100, 50 is center
let joystickButton = false;
let joystickButtonPrev = false;
let serialPort = null;
let serialReader = null;

// Arrow aim angles (persistent - don't reset to center)
let arrowAngleX = 0;
let arrowAngleY = 0;

// Particle systems
let particles = [];
let trailParticles = [];

// Camera controls
let cameraAngle = { horizontal: 0, vertical: 0.3 };
let cameraDistance = 5;

// Environment
let clouds = [];
let trees = [];

// Aiming line
let aimingLine = null;
let aimingDots = [];

// Audio context
let audioContext = null;

// Constants
const MAX_CHARGE_TIME = 1500; // 1.5 seconds to full power

// Connect to joystick via Web Serial API
async function connectJoystick() {
    if (!('serial' in navigator)) {
        alert('Web Serial API not supported. Use Chrome or Edge.');
        return;
    }

    try {
        // Request port from user
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: 9600 });

        joystickConnected = true;
        document.getElementById('joystick-btn').textContent = '🎮 Connected!';
        document.getElementById('joystick-btn').style.background = 'linear-gradient(135deg, #32CD32, #228B22)';

        // Start reading
        readSerialData();

        console.log('Joystick connected!');
    } catch (error) {
        console.error('Failed to connect:', error);
        alert('Failed to connect to joystick. Make sure it\'s plugged in.');
    }
}

// Read serial data continuously
async function readSerialData() {
    if (!serialPort || !serialPort.readable) return;

    const decoder = new TextDecoderStream();
    const readableStreamClosed = serialPort.readable.pipeTo(decoder.writable);
    serialReader = decoder.readable.getReader();

    let buffer = '';

    try {
        while (true) {
            const { value, done } = await serialReader.read();
            if (done) break;

            buffer += value;

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                parseJoystickData(line.trim());
            }
        }
    } catch (error) {
        console.error('Serial read error:', error);
    }
}

// Parse joystick data: "X: 49   Y: 50   Z: true"
function parseJoystickData(data) {
    if (!data) return;

    // Actual format: "X: 49   Y: 50   Z: true"
    // Only use X and Y for aiming (ignore Z button)
    const xMatch = data.match(/X:\s*(\d+)/);
    const yMatch = data.match(/Y:\s*(\d+)/);

    if (xMatch && yMatch) {
        const x = parseInt(xMatch[1]);
        const y = parseInt(yMatch[1]);

        if (!isNaN(x) && !isNaN(y) && x >= 0 && x <= 100 && y >= 0 && y <= 100) {
            joystickX = x;
            joystickY = y;
        }
    }

    // Update aiming based on joystick
    updateJoystickAim();
}

// Handle joystick button press/release
function handleJoystickButton() {
    if (arrowInFlight) return;

    const powerIndicator = document.getElementById('power-indicator');
    const powerBar = document.getElementById('power-bar');

    // Button just pressed - start charging
    if (joystickButton && !joystickButtonPrev) {
        if (!audioContext) initAudio();
        isCharging = true;
        chargeStartTime = Date.now();
        currentPower = 0;
        powerIndicator.classList.add('active');
        playSound('charge');
        updateJoystickCharge();
    }

    // Button just released - shoot
    if (!joystickButton && joystickButtonPrev) {
        if (isCharging) {
            isCharging = false;
            powerIndicator.classList.remove('active');

            if (currentPower > 0.05) {
                const angleX = arrow.rotation.y;
                const angleY = arrow.rotation.x;
                shootArrow(currentPower, angleX, angleY);
            }

            currentPower = 0;
            powerBar.style.width = '0%';
        }
    }
}

// Update charging while button held (called in animation loop)
function updateJoystickCharge() {
    if (!isCharging || arrowInFlight || !joystickButton) return;

    const elapsed = Date.now() - chargeStartTime;
    currentPower = Math.min(1, elapsed / MAX_CHARGE_TIME);

    const percentage = currentPower * 100;
    document.getElementById('power-bar').style.width = percentage + '%';
    document.getElementById('power-label').textContent = `Power: ${Math.round(percentage)}%`;

    // Visual feedback on arrow - pull back based on power
    if (arrow) {
        arrow.position.z = -currentPower * 0.5;
    }

    requestAnimationFrame(updateJoystickCharge);
}

// Update arrow aim from joystick (incremental - doesn't snap back)
function updateJoystickAim() {
    if (!arrow || arrowInFlight) return;

    // Convert joystick 0-100 to normalized delta
    // Only move when joystick is away from center
    const normalizedX = (joystickX - 50) / 50; // -1 to 1
    const normalizedY = (joystickY - 50) / 50; // -1 to 1

    // Incremental movement - add to current angle
    const speed = 0.015; // How fast the aim moves
    arrowAngleX += -normalizedX * speed;
    arrowAngleY += -normalizedY * speed;

    // Clamp to max angles
    const maxAngleX = Math.PI * 0.4;
    const maxAngleY = Math.PI * 0.3;
    arrowAngleX = Math.max(-maxAngleX, Math.min(maxAngleX, arrowAngleX));
    arrowAngleY = Math.max(-maxAngleY, Math.min(maxAngleY, arrowAngleY));

    arrow.rotation.y = arrowAngleX;
    arrow.rotation.x = arrowAngleY;

    // Update aiming line
    updateAimingLine(arrowAngleX, arrowAngleY);
}

// Initialize audio
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.log('Audio not supported');
    }
}

// Play sound effect
function playSound(type) {
    if (!audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === 'shoot') {
        oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.2);
    } else if (type === 'hit') {
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1200, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.3);
    } else if (type === 'miss') {
        oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.3);
    } else if (type === 'charge') {
        oscillator.frequency.setValueAtTime(100, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    }
}

// Initialize
function init() {
    try {
        // Scene setup
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);

        // Camera
        camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        // Renderer
        const canvas = document.getElementById('game-canvas');
        renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xFFF5E1, 1.8);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 100;
        directionalLight.shadow.camera.left = -30;
        directionalLight.shadow.camera.right = 30;
        directionalLight.shadow.camera.top = 30;
        directionalLight.shadow.camera.bottom = -30;
        scene.add(directionalLight);

        // Hemisphere light for better ambient
        const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x7CFC00, 0.4);
        scene.add(hemiLight);

        // Ground with gradient effect
        createGround();

        // Create environment
        createClouds();
        createTrees();
        createDecorations();

        // Create bullseye
        createBullseye();

        // Create targets
        createTargets();

        // Create arrow
        createArrow();

        // Set camera position
        updateCameraPosition();

        // Event listeners
        setupEventListeners();

        // Initialize audio on first interaction
        document.addEventListener('click', () => {
            if (!audioContext) initAudio();
        }, { once: true });

        // Start animation
        animate();

        // Update UI
        updateUI();
    } catch (error) {
        console.error('Error initializing game:', error);
    }
}

function createGround() {
    // Main ground
    const groundGeometry = new THREE.PlaneGeometry(200, 200, 50, 50);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x7CFC00,
        roughness: 0.9,
        metalness: 0.0
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Shooting platform
    const platformGeometry = new THREE.CylinderGeometry(2, 2.2, 0.3, 32);
    const platformMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.7,
        metalness: 0.2
    });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.set(0, 0.15, 0);
    platform.receiveShadow = true;
    platform.castShadow = true;
    scene.add(platform);

    // Platform ring
    const ringGeometry = new THREE.TorusGeometry(2.1, 0.1, 8, 32);
    const ringMaterial = new THREE.MeshStandardMaterial({
        color: 0xFFD700,
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0xFFD700,
        emissiveIntensity: 0.3
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.31, 0);
    scene.add(ring);
}

function createClouds() {
    const cloudPositions = [
        { x: -20, y: 15, z: -30 },
        { x: 15, y: 18, z: -40 },
        { x: -10, y: 20, z: -50 },
        { x: 25, y: 16, z: -25 },
        { x: -30, y: 22, z: -35 },
        { x: 5, y: 19, z: -45 }
    ];

    cloudPositions.forEach(pos => {
        const cloudGroup = new THREE.Group();

        const cloudMaterial = new THREE.MeshStandardMaterial({
            color: 0xFFFFFF,
            roughness: 1,
            metalness: 0,
            transparent: true,
            opacity: 0.9
        });

        // Create puffy cloud from multiple spheres
        const sphereCount = 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < sphereCount; i++) {
            const size = 1 + Math.random() * 2;
            const sphereGeometry = new THREE.SphereGeometry(size, 16, 16);
            const sphere = new THREE.Mesh(sphereGeometry, cloudMaterial);
            sphere.position.set(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 1.5,
                (Math.random() - 0.5) * 2
            );
            cloudGroup.add(sphere);
        }

        cloudGroup.position.set(pos.x, pos.y, pos.z);
        scene.add(cloudGroup);
        clouds.push({ mesh: cloudGroup, speed: 0.01 + Math.random() * 0.02 });
    });
}

function createTrees() {
    const treePositions = [
        { x: -15, z: -20 },
        { x: 18, z: -25 },
        { x: -20, z: -35 },
        { x: 22, z: -30 },
        { x: -8, z: -40 },
        { x: 12, z: -45 },
        { x: -25, z: -15 },
        { x: 25, z: -40 }
    ];

    treePositions.forEach(pos => {
        const treeGroup = new THREE.Group();
        const height = 3 + Math.random() * 2;

        // Trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.35, height, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B4513,
            roughness: 0.9
        });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = height / 2;
        trunk.castShadow = true;
        treeGroup.add(trunk);

        // Foliage layers
        const foliageColors = [0x228B22, 0x32CD32, 0x2E8B57];
        for (let i = 0; i < 3; i++) {
            const foliageGeometry = new THREE.ConeGeometry(1.5 - i * 0.3, 2, 8);
            const foliageMaterial = new THREE.MeshStandardMaterial({
                color: foliageColors[i % foliageColors.length],
                roughness: 0.8
            });
            const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
            foliage.position.y = height + i * 1.2;
            foliage.castShadow = true;
            treeGroup.add(foliage);
        }

        treeGroup.position.set(pos.x, 0, pos.z);
        scene.add(treeGroup);
        trees.push(treeGroup);
    });
}

function createDecorations() {
    // Flowers scattered around
    const flowerColors = [0xFF69B4, 0xFF1493, 0xFFD700, 0xFF6347, 0x9370DB];
    for (let i = 0; i < 30; i++) {
        const flowerGroup = new THREE.Group();

        // Stem
        const stemGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6);
        const stemMaterial = new THREE.MeshBasicMaterial({ color: 0x228B22 });
        const stem = new THREE.Mesh(stemGeometry, stemMaterial);
        stem.position.y = 0.15;
        flowerGroup.add(stem);

        // Petals
        const petalGeometry = new THREE.SphereGeometry(0.1, 8, 8);
        const color = flowerColors[Math.floor(Math.random() * flowerColors.length)];
        const petalMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.2
        });
        const petal = new THREE.Mesh(petalGeometry, petalMaterial);
        petal.position.y = 0.35;
        flowerGroup.add(petal);

        const x = (Math.random() - 0.5) * 40;
        const z = (Math.random() - 0.5) * 40 - 10;
        if (Math.abs(x) > 3 || z < -5) { // Avoid spawn area
            flowerGroup.position.set(x, 0, z);
            scene.add(flowerGroup);
        }
    }

    // Rocks
    const rockColors = [0x808080, 0x696969, 0xA9A9A9];
    for (let i = 0; i < 15; i++) {
        const rockGeometry = new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.3, 0);
        const rockMaterial = new THREE.MeshStandardMaterial({
            color: rockColors[Math.floor(Math.random() * rockColors.length)],
            roughness: 0.9,
            metalness: 0.1
        });
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        const x = (Math.random() - 0.5) * 50;
        const z = (Math.random() - 0.5) * 50 - 10;
        if (Math.abs(x) > 3 || z < -5) {
            rock.position.set(x, 0.1, z);
            rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            rock.castShadow = true;
            scene.add(rock);
        }
    }

    // Fence behind targets
    for (let i = -30; i <= 30; i += 3) {
        const postGeometry = new THREE.BoxGeometry(0.15, 1.5, 0.15);
        const postMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B4513,
            roughness: 0.8
        });
        const post = new THREE.Mesh(postGeometry, postMaterial);
        post.position.set(i, 0.75, -55);
        post.castShadow = true;
        scene.add(post);
    }

    // Fence rails
    for (let y of [0.4, 1.0]) {
        const railGeometry = new THREE.BoxGeometry(60, 0.1, 0.1);
        const railMaterial = new THREE.MeshStandardMaterial({
            color: 0xA0522D,
            roughness: 0.8
        });
        const rail = new THREE.Mesh(railGeometry, railMaterial);
        rail.position.set(0, y, -55);
        scene.add(rail);
    }
}

function createBullseye() {
    const bullseyeGroup = new THREE.Group();

    // Back board
    const boardGeometry = new THREE.BoxGeometry(2.5, 2.5, 0.2);
    const boardMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.8
    });
    const board = new THREE.Mesh(boardGeometry, boardMaterial);
    board.position.z = -0.1;
    board.castShadow = true;
    board.receiveShadow = true;
    bullseyeGroup.add(board);

    const ringColors = [0xFFFFFF, 0xFF0000, 0xFFFFFF, 0xFF0000, 0xFFFFFF, 0xFF0000];
    const ringSizes = [1.0, 0.85, 0.7, 0.55, 0.4, 0.25];

    ringSizes.forEach((size, i) => {
        const ringGeometry = new THREE.CircleGeometry(size, 32);
        const ringMaterial = new THREE.MeshStandardMaterial({
            color: ringColors[i],
            side: THREE.DoubleSide,
            roughness: 0.3,
            metalness: 0.2,
            emissive: ringColors[i] === 0xFF0000 ? 0x660000 : 0x333333,
            emissiveIntensity: 0.3
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.position.z = 0.01 * (i + 1);
        bullseyeGroup.add(ring);
    });

    // Gold center
    const centerGeometry = new THREE.CircleGeometry(0.1, 16);
    const centerMaterial = new THREE.MeshStandardMaterial({
        color: 0xFFD700,
        side: THREE.DoubleSide,
        emissive: 0xFFD700,
        emissiveIntensity: 0.8
    });
    const center = new THREE.Mesh(centerGeometry, centerMaterial);
    center.position.z = 0.08;
    bullseyeGroup.add(center);

    // Stand legs
    const legGeometry = new THREE.BoxGeometry(0.15, 3, 0.15);
    const legMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.8
    });

    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.8, -1.5, 0.3);
    leftLeg.rotation.x = 0.2;
    leftLeg.castShadow = true;
    bullseyeGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.8, -1.5, 0.3);
    rightLeg.rotation.x = 0.2;
    rightLeg.castShadow = true;
    bullseyeGroup.add(rightLeg);

    bullseyeGroup.position.set(0, 2, -8);
    scene.add(bullseyeGroup);
    bullseye = bullseyeGroup;
}

function createArrow() {
    const arrowGroup = new THREE.Group();

    // Arrow shaft with gradient effect
    const shaftGeometry = new THREE.CylinderGeometry(0.025, 0.02, 0.8, 16);
    const shaftMaterial = new THREE.MeshStandardMaterial({
        color: 0xDEB887,
        roughness: 0.6,
        metalness: 0.2
    });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.4;
    shaft.castShadow = true;
    arrowGroup.add(shaft);

    // Arrow head - more detailed
    const headGeometry = new THREE.ConeGeometry(0.05, 0.18, 8);
    const headMaterial = new THREE.MeshStandardMaterial({
        color: 0xC0C0C0,
        metalness: 0.9,
        roughness: 0.1,
        emissive: 0x444444,
        emissiveIntensity: 0.2
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.rotation.x = -Math.PI / 2;
    head.position.z = 0.89;
    head.castShadow = true;
    arrowGroup.add(head);

    // Fletching - more realistic
    const fletchGeometry = new THREE.PlaneGeometry(0.08, 0.15);
    const fletchColors = [0xFF4444, 0xFF4444, 0xFFFFFF];
    for (let i = 0; i < 3; i++) {
        const fletchMaterial = new THREE.MeshStandardMaterial({
            color: fletchColors[i],
            side: THREE.DoubleSide,
            roughness: 0.8
        });
        const fletch = new THREE.Mesh(fletchGeometry, fletchMaterial);
        fletch.position.z = 0.08;
        fletch.rotation.z = (i * Math.PI * 2 / 3);
        fletch.rotation.y = Math.PI / 2;
        fletch.position.x = Math.cos(i * Math.PI * 2 / 3) * 0.04;
        fletch.position.y = Math.sin(i * Math.PI * 2 / 3) * 0.04;
        fletch.castShadow = true;
        arrowGroup.add(fletch);
    }

    // Nock (back of arrow)
    const nockGeometry = new THREE.CylinderGeometry(0.015, 0.025, 0.05, 8);
    const nockMaterial = new THREE.MeshStandardMaterial({
        color: 0xFF4444,
        roughness: 0.5
    });
    const nock = new THREE.Mesh(nockGeometry, nockMaterial);
    nock.rotation.x = Math.PI / 2;
    nock.position.z = -0.02;
    arrowGroup.add(nock);

    arrowGroup.position.set(0, 1.5, 0);
    scene.add(arrowGroup);
    arrow = arrowGroup;
    currentArrow = arrowGroup;
}

function createTargets() {
    const targetPositions = [
        { x: 0, y: 2, z: -12, points: 50 },
        { x: -5, y: 2, z: -16, points: 100 },
        { x: 5, y: 2, z: -16, points: 100 },
        { x: 0, y: 3, z: -20, points: 200 },
        { x: -8, y: 2, z: -14, points: 75 },
        { x: 8, y: 2.5, z: -18, points: 150 }
    ];

    targetPositions.forEach((pos) => {
        const targetGroup = new THREE.Group();

        // Back board
        const boardGeometry = new THREE.CylinderGeometry(0.9, 0.9, 0.15, 32);
        const boardMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B4513,
            roughness: 0.8
        });
        const board = new THREE.Mesh(boardGeometry, boardMaterial);
        board.rotation.x = Math.PI / 2;
        board.position.z = -0.08;
        board.castShadow = true;
        board.receiveShadow = true;
        targetGroup.add(board);

        const ringColors = [0xFFFFFF, 0xFF0000, 0xFFFFFF, 0xFF0000, 0xFFFFFF];
        const ringSizes = [0.8, 0.65, 0.5, 0.35, 0.2];

        ringSizes.forEach((size, i) => {
            const ringGeometry = new THREE.CircleGeometry(size, 32);
            const ringMaterial = new THREE.MeshStandardMaterial({
                color: ringColors[i],
                side: THREE.DoubleSide,
                roughness: 0.4,
                metalness: 0.1,
                emissive: ringColors[i] === 0xFF0000 ? 0x330000 : 0x111111,
                emissiveIntensity: 0.2
            });
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.position.z = 0.01 * (i + 1);
            ring.castShadow = true;
            ring.receiveShadow = true;
            targetGroup.add(ring);
        });

        // Gold center
        const centerGeometry = new THREE.CircleGeometry(0.08, 16);
        const centerMaterial = new THREE.MeshStandardMaterial({
            color: 0xFFD700,
            side: THREE.DoubleSide,
            emissive: 0xFFD700,
            emissiveIntensity: 0.5
        });
        const center = new THREE.Mesh(centerGeometry, centerMaterial);
        center.position.z = 0.06;
        targetGroup.add(center);

        // Stand
        const standGeometry = new THREE.CylinderGeometry(0.08, 0.12, 2.5, 8);
        const standMaterial = new THREE.MeshStandardMaterial({
            color: 0x654321,
            roughness: 0.8
        });
        const stand = new THREE.Mesh(standGeometry, standMaterial);
        stand.position.y = -1.25;
        stand.castShadow = true;
        stand.receiveShadow = true;
        targetGroup.add(stand);

        // Base
        const baseGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.15, 16);
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x555555,
            roughness: 0.6,
            metalness: 0.3
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.y = -2.5;
        base.castShadow = true;
        base.receiveShadow = true;
        targetGroup.add(base);

        targetGroup.position.set(pos.x, pos.y, pos.z);
        scene.add(targetGroup);

        targets.push({
            group: targetGroup,
            position: new THREE.Vector3(pos.x, pos.y, pos.z),
            hit: false,
            points: pos.points,
            originalY: pos.y
        });
    });
}

function createHitParticles(position, color = 0xFFD700) {
    const particleCount = 30;
    const colors = [0xFFD700, 0xFF6347, 0xFF1493, 0x00FF00, 0x00FFFF];

    for (let i = 0; i < particleCount; i++) {
        const geometry = new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: colors[Math.floor(Math.random() * colors.length)],
            transparent: true,
            opacity: 1
        });
        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 8,
            Math.random() * 6 + 2,
            (Math.random() - 0.5) * 8
        );

        scene.add(particle);
        particles.push({
            mesh: particle,
            velocity: velocity,
            life: 1.0,
            decay: 0.02 + Math.random() * 0.02
        });
    }

    // Star burst effect
    for (let i = 0; i < 8; i++) {
        const geometry = new THREE.OctahedronGeometry(0.1, 0);
        const material = new THREE.MeshBasicMaterial({
            color: 0xFFFFFF,
            transparent: true,
            opacity: 1
        });
        const star = new THREE.Mesh(geometry, material);
        star.position.copy(position);

        const angle = (i / 8) * Math.PI * 2;
        const velocity = new THREE.Vector3(
            Math.cos(angle) * 5,
            2,
            Math.sin(angle) * 5
        );

        scene.add(star);
        particles.push({
            mesh: star,
            velocity: velocity,
            life: 1.0,
            decay: 0.03,
            rotate: true
        });
    }
}

function createTrailParticle(position) {
    const geometry = new THREE.SphereGeometry(0.02, 6, 6);
    const material = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.8
    });
    const particle = new THREE.Mesh(geometry, material);
    particle.position.copy(position);

    scene.add(particle);
    trailParticles.push({
        mesh: particle,
        life: 1.0,
        decay: 0.05
    });
}

function updateParticles() {
    // Update hit particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.mesh.position.add(p.velocity.clone().multiplyScalar(0.016));
        p.velocity.y -= 0.3; // Gravity
        p.life -= p.decay;
        p.mesh.material.opacity = p.life;
        p.mesh.scale.setScalar(p.life);

        if (p.rotate) {
            p.mesh.rotation.x += 0.2;
            p.mesh.rotation.y += 0.3;
        }

        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }

    // Update trail particles
    for (let i = trailParticles.length - 1; i >= 0; i--) {
        const p = trailParticles[i];
        p.life -= p.decay;
        p.mesh.material.opacity = p.life * 0.8;
        p.mesh.scale.setScalar(p.life);

        if (p.life <= 0) {
            scene.remove(p.mesh);
            trailParticles.splice(i, 1);
        }
    }
}

function setupEventListeners() {
    const canvas = document.getElementById('game-canvas');
    const powerIndicator = document.getElementById('power-indicator');
    const powerBar = document.getElementById('power-bar');

    // Mouse move for aiming (always active when not in flight)
    canvas.addEventListener('mousemove', onMouseMove);

    // Mouse down/up for charging power
    canvas.addEventListener('mousedown', onChargeStart);
    canvas.addEventListener('mouseup', onChargeEnd);
    canvas.addEventListener('mouseleave', onChargeEnd);

    // Touch support
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
        onChargeStart();
    });
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
    });
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        onChargeEnd();
    });

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);

    // Joystick button
    document.getElementById('joystick-btn').addEventListener('click', connectJoystick);

    // Reset button
    document.getElementById('reset-btn').addEventListener('click', resetGame);

    function onMouseMove(event) {
        // Mouse no longer controls aiming - only joystick does
        // Just track position for other potential uses
        mouseX = event.clientX;
        mouseY = event.clientY;
    }

    function onChargeStart() {
        if (!audioContext) initAudio();
        if (arrowInFlight) return;

        isCharging = true;
        chargeStartTime = Date.now();
        currentPower = 0;

        powerIndicator.classList.add('active');

        playSound('charge');

        // Start charging animation
        updateCharge();
    }

    function onChargeEnd() {
        if (!isCharging || arrowInFlight) return;

        isCharging = false;
        powerIndicator.classList.remove('active');

        if (currentPower > 0.05) {
            const angleX = arrow.rotation.y;
            const angleY = arrow.rotation.x;
            shootArrow(currentPower, angleX, angleY);
        }

        currentPower = 0;
        powerBar.style.width = '0%';
    }

    function updateCharge() {
        if (!isCharging || arrowInFlight) return;

        const elapsed = Date.now() - chargeStartTime;
        currentPower = Math.min(1, elapsed / MAX_CHARGE_TIME);

        const percentage = currentPower * 100;
        powerBar.style.width = percentage + '%';
        document.getElementById('power-label').textContent = `Power: ${Math.round(percentage)}%`;

        // Visual feedback on arrow - pull back based on power
        if (arrow) {
            arrow.position.z = -currentPower * 0.5;
        }

        requestAnimationFrame(updateCharge);
    }

    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

function updateArrowAim() {
    if (!arrow || arrowInFlight) return;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    const deltaX = (mouseX - centerX) / window.innerWidth;
    const deltaY = (mouseY - centerY) / window.innerHeight;

    // 75% of original sensitivity for finer control
    const angleX = -deltaX * Math.PI * 0.45;
    const angleY = -deltaY * Math.PI * 0.3;

    arrow.rotation.y = angleX;
    arrow.rotation.x = angleY;

    // Update aiming line
    updateAimingLine(angleX, angleY);
}

function updateAimingLine(angleX, angleY) {
    // Remove old aiming dots
    aimingDots.forEach(dot => scene.remove(dot));
    aimingDots = [];

    // Calculate trajectory preview
    const baseSpeed = 22;
    const power = isCharging ? currentPower : 0.5; // Show medium power when not charging
    const speed = baseSpeed * (0.5 + power * 0.5);
    const baseUpwardVelocity = 4;

    const velocity = new THREE.Vector3(
        -Math.sin(angleX) * Math.cos(angleY) * speed,
        Math.sin(angleY) * speed + baseUpwardVelocity,
        -Math.cos(angleX) * Math.cos(angleY) * speed
    );

    const startPos = new THREE.Vector3(0, 1.5, 0);
    const timeScale = 0.35;
    const gravity = 9.8 * timeScale;

    // Create dotted line showing trajectory
    const dotCount = 20;
    for (let i = 1; i <= dotCount; i++) {
        const t = i * 0.15; // Time step

        const x = startPos.x + velocity.x * t;
        const y = startPos.y + velocity.y * t - 0.5 * gravity * t * t;
        const z = startPos.z + velocity.z * t;

        // Stop if below ground
        if (y < 0) break;

        const dotGeometry = new THREE.SphereGeometry(0.05, 8, 8);
        const dotMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFFFFF,
            transparent: true,
            opacity: 1 - (i / dotCount) * 0.7 // Fade out
        });
        const dot = new THREE.Mesh(dotGeometry, dotMaterial);
        dot.position.set(x, y, z);

        scene.add(dot);
        aimingDots.push(dot);
    }
}

function updateCameraPosition() {
    if (!camera) return;
    const x = Math.sin(cameraAngle.horizontal) * cameraDistance;
    const z = Math.cos(cameraAngle.horizontal) * cameraDistance;
    const y = 1.5 + Math.sin(cameraAngle.vertical) * cameraDistance * 0.5;

    camera.position.set(x, y, z);
    camera.lookAt(0, 1.5, -8);
}

function onKeyDown(event) {
    const speed = 0.1;
    switch (event.key) {
        case 'ArrowLeft':
            cameraAngle.horizontal -= speed;
            updateCameraPosition();
            break;
        case 'ArrowRight':
            cameraAngle.horizontal += speed;
            updateCameraPosition();
            break;
        case 'ArrowUp':
            cameraAngle.vertical = Math.min(Math.PI / 2 - 0.1, cameraAngle.vertical + speed);
            updateCameraPosition();
            break;
        case 'ArrowDown':
            cameraAngle.vertical = Math.max(-Math.PI / 2 + 0.1, cameraAngle.vertical - speed);
            updateCameraPosition();
            break;
        case 'r':
        case 'R':
            resetGame();
            break;
    }
}

function shootArrow(power, angleX, angleY) {
    if (!arrow || arrowInFlight) return;

    arrowInFlight = true;
    playSound('shoot');

    // Hide aiming line
    aimingDots.forEach(dot => scene.remove(dot));
    aimingDots = [];

    const baseSpeed = 22;
    const speed = baseSpeed * (0.5 + power * 0.5);

    // Add base upward velocity for a nice arc
    const baseUpwardVelocity = 4;

    arrowVelocity.set(
        -Math.sin(angleX) * Math.cos(angleY) * speed,
        Math.sin(angleY) * speed + baseUpwardVelocity,
        -Math.cos(angleX) * Math.cos(angleY) * speed
    );

    const startTime = Date.now();
    const startPosition = arrow.position.clone();
    const timeScale = 0.35;
    let lastTrailTime = 0;

    function animateArrow() {
        if (!arrowInFlight || !currentArrow) return;

        const elapsed = (Date.now() - startTime) / 1000 * timeScale;
        const gravity = 9.8 * timeScale;

        currentArrow.position.x = startPosition.x + arrowVelocity.x * elapsed;
        currentArrow.position.y = startPosition.y + arrowVelocity.y * elapsed - 0.5 * gravity * elapsed * elapsed;
        currentArrow.position.z = startPosition.z + arrowVelocity.z * elapsed;

        // Create trail particles
        if (Date.now() - lastTrailTime > 30) {
            createTrailParticle(currentArrow.position.clone());
            lastTrailTime = Date.now();
        }

        const velocity = new THREE.Vector3(
            arrowVelocity.x,
            arrowVelocity.y - gravity * elapsed,
            arrowVelocity.z
        ).normalize();
        currentArrow.rotation.y = Math.atan2(velocity.x, velocity.z);
        currentArrow.rotation.x = -Math.asin(velocity.y);

        checkCollisions();

        if (currentArrow.position.y < -2 ||
            Math.abs(currentArrow.position.x) > 50 ||
            currentArrow.position.z < -60) {
            playSound('miss');
            combo = 0;
            updateUI();
            resetArrow();
            return;
        }

        requestAnimationFrame(animateArrow);
    }

    animateArrow();
}

function checkCollisions() {
    if (!currentArrow) return;

    const arrowPos = currentArrow.position;

    // Check bullseye
    if (bullseye) {
        const bullseyePos = new THREE.Vector3(0, 2, -8);
        const distance = arrowPos.distanceTo(bullseyePos);
        if (distance < 1.2) {
            playSound('hit');
            score += 25 * (combo + 1);
            combo++;
            if (combo > bestCombo) bestCombo = combo;
            createHitParticles(arrowPos.clone());
            showFloatingText(arrowPos.clone(), `+${25 * combo}`, 0xFFD700);
            updateUI();
            setTimeout(() => resetArrow(), 800);
            return;
        }
    }

    // Check targets
    targets.forEach(target => {
        if (target.hit) return;

        const distance = arrowPos.distanceTo(target.position);
        if (distance < 0.9) {
            target.hit = true;
            playSound('hit');
            const points = target.points * (combo + 1);
            score += points;
            combo++;
            if (combo > bestCombo) bestCombo = combo;

            createHitParticles(arrowPos.clone());
            showFloatingText(arrowPos.clone(), `+${points}`, 0x00FF00);
            updateUI();

            // Visual feedback - turn green and pulse
            target.group.children.forEach((child) => {
                if (child.material && child.material.color) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x00FF00,
                        emissive: 0x00FF00,
                        emissiveIntensity: 0.6
                    });
                }
            });

            // Animate target
            animateTargetHit(target);

            setTimeout(() => resetArrow(), 800);
        }
    });
}

function animateTargetHit(target) {
    let scale = 1;
    let growing = true;

    function pulse() {
        if (!target.hit) return;

        if (growing) {
            scale += 0.02;
            if (scale >= 1.15) growing = false;
        } else {
            scale -= 0.02;
            if (scale <= 1) {
                scale = 1;
                growing = true;
            }
        }

        target.group.scale.setScalar(scale);

        if (target.hit) {
            requestAnimationFrame(pulse);
        }
    }

    pulse();
}

function showFloatingText(position, text, color) {
    const floatingText = document.createElement('div');
    floatingText.className = 'floating-text';
    floatingText.textContent = text;
    floatingText.style.color = `#${color.toString(16).padStart(6, '0')}`;

    // Project 3D position to screen
    const vector = position.clone();
    vector.project(camera);

    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;

    floatingText.style.left = `${x}px`;
    floatingText.style.top = `${y}px`;

    document.getElementById('ui-overlay').appendChild(floatingText);

    setTimeout(() => {
        floatingText.remove();
    }, 1500);
}

function resetArrow() {
    if (currentArrow) {
        scene.remove(currentArrow);
    }
    arrowInFlight = false;
    createArrow();

    // Restore aim to persistent angles
    if (arrow) {
        arrow.rotation.y = arrowAngleX;
        arrow.rotation.x = arrowAngleY;
        updateAimingLine(arrowAngleX, arrowAngleY);
    }
}

function resetGame() {
    score = 0;
    combo = 0;

    // Reset all targets
    targets.forEach(target => {
        target.hit = false;
        target.group.scale.setScalar(1);

        // Reset colors
        const ringColors = [0xFFFFFF, 0xFF0000, 0xFFFFFF, 0xFF0000, 0xFFFFFF];
        let ringIndex = 0;
        target.group.children.forEach((child, i) => {
            if (i === 0) {
                // Board
                child.material = new THREE.MeshStandardMaterial({
                    color: 0x8B4513,
                    roughness: 0.8
                });
            } else if (i <= 5) {
                // Rings
                const color = ringColors[ringIndex % ringColors.length];
                child.material = new THREE.MeshStandardMaterial({
                    color: color,
                    side: THREE.DoubleSide,
                    roughness: 0.4,
                    metalness: 0.1,
                    emissive: color === 0xFF0000 ? 0x330000 : 0x111111,
                    emissiveIntensity: 0.2
                });
                ringIndex++;
            } else if (i === 6) {
                // Center
                child.material = new THREE.MeshStandardMaterial({
                    color: 0xFFD700,
                    side: THREE.DoubleSide,
                    emissive: 0xFFD700,
                    emissiveIntensity: 0.5
                });
            }
        });
    });

    resetArrow();
    updateUI();
}

function updateUI() {
    document.getElementById('score').textContent = `Score: ${score}`;
    document.getElementById('combo').textContent = `Combo: x${combo + 1}`;
    document.getElementById('best-combo').textContent = `Best: x${bestCombo + 1}`;

    // Update targets hit counter
    const hitCount = targets.filter(t => t.hit).length;
    document.getElementById('targets-hit').textContent = `Targets: ${hitCount}/${targets.length}`;
}

function animate() {
    requestAnimationFrame(animate);

    // Animate clouds
    clouds.forEach(cloud => {
        cloud.mesh.position.x += cloud.speed;
        if (cloud.mesh.position.x > 50) {
            cloud.mesh.position.x = -50;
        }
    });

    // Rotate active targets slightly
    targets.forEach(target => {
        if (!target.hit) {
            target.group.rotation.y += 0.003;
            // Gentle bobbing
            target.group.position.y = target.originalY + Math.sin(Date.now() * 0.001) * 0.1;
        }
    });

    // Update particles
    updateParticles();

    renderer.render(scene, camera);
}

// Start game
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
