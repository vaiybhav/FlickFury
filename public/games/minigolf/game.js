// Game state
let gameState = {
    mode: null, // 'single' or 'multiplayer'
    currentPlayer: 1,
    strokes: { 1: 0, 2: 0 },
    isDragging: false,
    dragStart: null,
    dragCurrent: null,
    ballVelocity: null,
    gameActive: false,
    ballInHole: false,
    hasSwitchedTurn: false,
    allBallsStopped: true // Track if all balls have stopped
};

// ========== HAND GESTURE CONFIGURATION ==========
// ========== HAND GESTURE CONFIGURATION ==========
const GESTURE_CONFIG = {
    flickEndpoint: `${window.GAME_CONFIG.API_URL}/flick`,
    handsEndpoint: `${window.GAME_CONFIG.API_URL}/hands`,
    gameEndpoint: `${window.GAME_CONFIG.API_URL}/game`,

    // Update webcam feed dynamically
    document.addEventListener('DOMContentLoaded', () => {
        const webcamImg = document.querySelector('.webcam-feed');
        if (webcamImg) webcamImg.src = `${window.GAME_CONFIG.API_URL}/video_feed`;
    });
    pollInterval: 50,
    enabled: true,
    powerMultiplier: 12,  // Convert flick velocity to putt power
    maxPower: 15,
    loftMultiplier: 0.5   // How much the ball goes up based on swing angle
};

// Register minigolf as active game
function registerGame() {
    fetch(GESTURE_CONFIG.gameEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'minigolf' })
    }).catch(() => { });
}

// Unregister when leaving
window.addEventListener('beforeunload', function () {
    fetch(GESTURE_CONFIG.gameEndpoint, { method: 'DELETE' }).catch(() => { });
});

// Hand aim data (360 degree control)
let handAim = {
    directionX: 0,  // -1 to 1, left hand X position for left/right aim
    directionY: 0,  // -1 to 1, left hand Y position for forward/back aim
    loftAngle: 0.2  // 0 to 1, right hand Y position for loft (higher = more air)
};

// Three.js setup
let scene, camera, renderer, world;
let balls = []; // Array of ball meshes
let ballBodies = []; // Array of physics bodies
let course, hole;
let obstacles = [];
let isPointerDown = false;
let pointerStart = { x: 0, y: 0 };
let pointerCurrent = { x: 0, y: 0 };
let glowRing, glowRingMaterial; // For hole glow animation
let aimArrow = null; // Visual aim direction arrow

// Initialize game
function init() {
    setupEventListeners();
    setupThreeJS();
    setupPhysics(); // Must be called before createCourse to set up materials
    createCourse();
    createBalls(); // Create both balls
    createHole();
    createObstacles();
    animate();
}

function setupEventListeners() {
    // Menu buttons
    const singlePlayerBtn = document.getElementById('single-player-btn');
    const multiplayerBtn = document.getElementById('multiplayer-btn');

    if (singlePlayerBtn) {
        // Add visual feedback
        singlePlayerBtn.addEventListener('mousedown', () => {
            singlePlayerBtn.style.transform = 'scale(0.95)';
        });
        singlePlayerBtn.addEventListener('mouseup', () => {
            singlePlayerBtn.style.transform = '';
        });

        singlePlayerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('✅ Single player button clicked!');
            singlePlayerBtn.style.opacity = '0.7';
            setTimeout(() => {
                singlePlayerBtn.style.opacity = '1';
                startGame('single');
            }, 100);
        });
        singlePlayerBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('✅ Single player button touched!');
            startGame('single');
        });
    } else {
        console.error('❌ Single player button not found!');
    }

    if (multiplayerBtn) {
        // Add visual feedback
        multiplayerBtn.addEventListener('mousedown', () => {
            multiplayerBtn.style.transform = 'scale(0.95)';
        });
        multiplayerBtn.addEventListener('mouseup', () => {
            multiplayerBtn.style.transform = '';
        });

        multiplayerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('✅ Multiplayer button clicked!');
            multiplayerBtn.style.opacity = '0.7';
            setTimeout(() => {
                multiplayerBtn.style.opacity = '1';
                startGame('multiplayer');
            }, 100);
        });
        multiplayerBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('✅ Multiplayer button touched!');
            startGame('multiplayer');
        });
    } else {
        console.error('❌ Multiplayer button not found!');
    }

    const resetBtn = document.getElementById('reset-btn');
    const menuBtn = document.getElementById('menu-btn');
    const playAgainBtn = document.getElementById('play-again-btn');
    const backToMenuBtn = document.getElementById('back-to-menu-btn');

    if (resetBtn) resetBtn.addEventListener('click', resetBall);
    if (menuBtn) menuBtn.addEventListener('click', showMenu);
    if (playAgainBtn) playAgainBtn.addEventListener('click', () => startGame(gameState.mode));
    if (backToMenuBtn) backToMenuBtn.addEventListener('click', showMenu);

    // Drag controls
    const canvas = document.getElementById('game-canvas');

    // Mouse events
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('mouseleave', onPointerUp);

    // Touch events
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
}

function onPointerDown(event) {
    if (gameState.ballInHole || !gameState.gameActive) return;

    // In multiplayer, only allow shooting if all balls have stopped
    if (gameState.mode === 'multiplayer' && !gameState.allBallsStopped) {
        return; // Can't shoot while balls are moving
    }

    const rect = event.target.getBoundingClientRect();
    pointerStart.x = (event.clientX - rect.left) / rect.width;
    pointerStart.y = (event.clientY - rect.top) / rect.height;
    isPointerDown = true;
    gameState.isDragging = true;
    document.getElementById('power-indicator').classList.add('active');
}

function onPointerMove(event) {
    if (!isPointerDown || !gameState.isDragging) return;

    const rect = event.target.getBoundingClientRect();
    pointerCurrent.x = (event.clientX - rect.left) / rect.width;
    pointerCurrent.y = (event.clientY - rect.top) / rect.height;

    updatePowerIndicator();
}

function onPointerUp(event) {
    if (!isPointerDown || !gameState.isDragging) return;

    const rect = event.target.getBoundingClientRect();
    pointerCurrent.x = (event.clientX - rect.left) / rect.width;
    pointerCurrent.y = (event.clientY - rect.top) / rect.height;

    shootBall();
    isPointerDown = false;
    gameState.isDragging = false;
    document.getElementById('power-indicator').classList.remove('active');
}

function onTouchStart(event) {
    event.preventDefault();
    if (gameState.ballInHole || !gameState.gameActive) return;

    // In multiplayer, only allow shooting if all balls have stopped
    if (gameState.mode === 'multiplayer' && !gameState.allBallsStopped) {
        return; // Can't shoot while balls are moving
    }

    const touch = event.touches[0];
    const rect = event.target.getBoundingClientRect();
    pointerStart.x = (touch.clientX - rect.left) / rect.width;
    pointerStart.y = (touch.clientY - rect.top) / rect.height;
    isPointerDown = true;
    gameState.isDragging = true;
    document.getElementById('power-indicator').classList.add('active');
}

function onTouchMove(event) {
    event.preventDefault();
    if (!isPointerDown || !gameState.isDragging) return;

    const touch = event.touches[0];
    const rect = event.target.getBoundingClientRect();
    pointerCurrent.x = (touch.clientX - rect.left) / rect.width;
    pointerCurrent.y = (touch.clientY - rect.top) / rect.height;

    updatePowerIndicator();
}

function onTouchEnd(event) {
    event.preventDefault();
    if (!isPointerDown || !gameState.isDragging) return;

    if (event.changedTouches.length > 0) {
        const touch = event.changedTouches[0];
        const rect = event.target.getBoundingClientRect();
        pointerCurrent.x = (touch.clientX - rect.left) / rect.width;
        pointerCurrent.y = (touch.clientY - rect.top) / rect.height;
    }

    shootBall();
    isPointerDown = false;
    gameState.isDragging = false;
    document.getElementById('power-indicator').classList.remove('active');
}

function updatePowerIndicator() {
    const dx = pointerCurrent.x - pointerStart.x;
    const dy = pointerCurrent.y - pointerStart.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const power = Math.min(distance * 500, 100);

    document.getElementById('power-bar').style.width = power + '%';
}

function shootBall() {
    const currentBallBody = ballBodies[gameState.currentPlayer - 1];
    if (!currentBallBody || gameState.ballInHole) return;

    const dx = pointerCurrent.x - pointerStart.x;
    const dy = pointerCurrent.y - pointerStart.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.01) return; // Too small to register

    const power = Math.min(distance * 25, 12); // Increased from 15 to 25, max from 8 to 12

    // Convert screen coordinates to world coordinates
    const ballPos = currentBallBody.position;
    const direction = new CANNON.Vec3(-dx, 0, -dy).unit();

    // Apply force to current player's ball
    currentBallBody.velocity.set(0, 0, 0);
    currentBallBody.angularVelocity.set(0, 0, 0);
    currentBallBody.applyImpulse(
        direction.scale(power),
        currentBallBody.position
    );

    // Increment stroke count
    gameState.strokes[gameState.currentPlayer]++;
    gameState.hasSwitchedTurn = false; // Reset turn switch flag when shooting
    updateScoreDisplay();

    // Reset power indicator
    document.getElementById('power-bar').style.width = '0%';
}

// ========== HAND GESTURE CONTROL ==========
let gesturePollingActive = false;

function startGesturePolling() {
    if (gesturePollingActive || !GESTURE_CONFIG.enabled) return;
    gesturePollingActive = true;
    registerGame();  // Register minigolf as active
    console.log('⛳ Hand gesture control enabled for minigolf');
    pollFlick();
    pollHands();
}

function pollFlick() {
    if (!gesturePollingActive) return;

    fetch(GESTURE_CONFIG.flickEndpoint)
        .then(response => response.json())
        .then(data => {
            // Only trigger on flicks when game is active
            if (data && data.vy !== undefined && gameState.gameActive && !gameState.ballInHole) {
                console.log('⛳ Flick received:', data);
                shootBallWithGesture(data);
            }
        })
        .catch(() => { })
        .finally(() => {
            setTimeout(pollFlick, GESTURE_CONFIG.pollInterval);
        });
}

function pollHands() {
    if (!gesturePollingActive) return;

    fetch(GESTURE_CONFIG.handsEndpoint)
        .then(response => response.json())
        .then(data => {
            if (data) {
                // LEFT HAND: X and Y position for 360 degree aim direction
                if (data.left) {
                    // X: 0 = left side of camera, 1 = right side
                    // Map to -1 to 1 for left/right aim
                    handAim.directionX = (data.left.x - 0.5) * 2;

                    // Y: 0 = top of camera, 1 = bottom
                    // Map to forward/back direction (-1 to 1)
                    handAim.directionY = (0.5 - data.left.y) * 2;
                }

                // RIGHT HAND: Y position controls loft (swing angle)
                // Higher hand = more loft (ball goes up more)
                if (data.right) {
                    // Y: 0 = top (high loft), 1 = bottom (ground shot)
                    handAim.loftAngle = Math.max(0, 1 - data.right.y);
                }

                updateAimArrow();
            }
        })
        .catch(() => { })
        .finally(() => {
            setTimeout(pollHands, GESTURE_CONFIG.pollInterval);
        });
}

function shootBallWithGesture(flickData) {
    const currentBallBody = ballBodies[gameState.currentPlayer - 1];
    if (!currentBallBody || gameState.ballInHole) return;

    // In multiplayer, only allow shooting if all balls have stopped AND it's your turn
    if (gameState.mode === 'multiplayer' && !gameState.allBallsStopped) {
        return;
    }

    // Calculate power from flick velocity
    const power = Math.min(flickData.vy * GESTURE_CONFIG.powerMultiplier, GESTURE_CONFIG.maxPower);

    if (power < 1) return; // Too weak to register

    // 360 degree aim using left hand position
    // directionX: -1 = left, 0 = center, 1 = right
    // directionY: -1 = back, 0 = center, 1 = forward
    let dx = handAim.directionX;
    let dz = handAim.directionY;

    // Normalize direction but ensure minimum forward movement if aiming is weak
    const magnitude = Math.sqrt(dx * dx + dz * dz);
    if (magnitude < 0.1) {
        // Default to forward if no clear aim direction
        dx = 0;
        dz = 1;
    } else {
        dx /= magnitude;
        dz /= magnitude;
    }

    // Grounded putt - no vertical velocity
    const dy = 0;

    // Create direction vector
    const direction = new CANNON.Vec3(dx, dy, dz);

    // Apply force to current player's ball
    currentBallBody.velocity.set(0, 0, 0);
    currentBallBody.angularVelocity.set(0, 0, 0);
    currentBallBody.applyImpulse(
        direction.scale(power),
        currentBallBody.position
    );

    // Increment stroke count
    gameState.strokes[gameState.currentPlayer]++;
    gameState.hasSwitchedTurn = false;
    updateScoreDisplay();

    // Visual feedback
    document.getElementById('power-bar').style.width = (power / GESTURE_CONFIG.maxPower * 100) + '%';
    setTimeout(() => {
        document.getElementById('power-bar').style.width = '0%';
    }, 300);

    console.log('⛳ Shot fired! Power:', power.toFixed(2),
        'Dir X:', dx.toFixed(2), 'Dir Z:', dz.toFixed(2),
        'Loft:', loft.toFixed(2));
}

function createAimArrow() {
    // Create an arrow to show aim direction
    const arrowLength = 3;
    const arrowGeometry = new THREE.ConeGeometry(0.2, 0.5, 8);
    const arrowMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.7
    });

    const arrowHead = new THREE.Mesh(arrowGeometry, arrowMaterial);

    // Line for arrow body
    const lineGeometry = new THREE.CylinderGeometry(0.05, 0.05, arrowLength, 8);
    const lineMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.5
    });
    const arrowLine = new THREE.Mesh(lineGeometry, lineMaterial);

    aimArrow = new THREE.Group();
    arrowLine.position.z = arrowLength / 2;
    arrowLine.rotation.x = Math.PI / 2;
    arrowHead.position.z = arrowLength;
    arrowHead.rotation.x = Math.PI / 2;

    aimArrow.add(arrowLine);
    aimArrow.add(arrowHead);
    aimArrow.visible = false;

    scene.add(aimArrow);
}

function updateAimArrow() {
    if (!aimArrow || !gameState.gameActive) return;

    const currentBall = balls[gameState.currentPlayer - 1];
    if (!currentBall) return;

    // Position arrow at ball
    aimArrow.position.copy(currentBall.position);
    aimArrow.position.y = 0.5; // Above ground

    // Calculate rotation from 360 degree aim
    // directionX: left/right, directionY: forward/back
    const angle = Math.atan2(-handAim.directionX, handAim.directionY);
    aimArrow.rotation.y = angle;

    // Scale arrow based on loft (smaller = more loft/chip shot)
    const scale = 1 - (handAim.loftAngle * 0.3);
    aimArrow.scale.set(scale, scale, scale);

    // Show arrow only when ball is stopped
    const currentBallBody = ballBodies[gameState.currentPlayer - 1];
    const velocity = currentBallBody ? currentBallBody.velocity.length() : 0;
    aimArrow.visible = velocity < 0.1 && gameState.allBallsStopped;
}

function setupThreeJS() {
    console.log('Setting up Three.js...');
    const canvas = document.getElementById('game-canvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }

    scene = new THREE.Scene();
    // Cool dark blue sky with gradient effect
    scene.background = new THREE.Color(0x0a0f2e);
    scene.fog = new THREE.FogExp2(0x0a0f2e, 0.02);

    // Camera setup for portrait orientation - looking from behind ball toward hole
    const aspect = window.innerHeight / window.innerWidth;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    // Start camera behind the ball, looking toward the hole
    camera.position.set(0, 10, -18);
    camera.lookAt(0, 0, 15); // Look toward the hole

    // Renderer with better quality
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    console.log('Three.js setup complete');

    // Enhanced lighting for cool 3D effect
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    scene.add(ambientLight);

    // Main directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(15, 25, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 100;
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    directionalLight.shadow.bias = -0.0001;
    scene.add(directionalLight);

    // Fill light for better visibility
    const fillLight = new THREE.DirectionalLight(0x7fb3ff, 0.3);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);

    // Rim light for depth
    const rimLight = new THREE.DirectionalLight(0xffaa00, 0.2);
    rimLight.position.set(0, 5, -20);
    scene.add(rimLight);

    // Handle window resize
    window.addEventListener('resize', () => {
        const aspect = window.innerHeight / window.innerWidth;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function setupPhysics() {
    console.log('Setting up physics...');
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 15; // Increased for better collision accuracy

    // Ball material
    const ballMaterial = new CANNON.Material('ball');
    ballMaterial.friction = 0.8;
    ballMaterial.restitution = 0.3;

    // Wall material - more bouncy
    const wallMaterial = new CANNON.Material('wall');
    wallMaterial.friction = 0.5;
    wallMaterial.restitution = 0.7; // Much more bouncy!

    // Obstacle material
    const obstacleMaterial = new CANNON.Material('obstacle');
    obstacleMaterial.friction = 0.7;
    obstacleMaterial.restitution = 0.4;

    // Ground material
    const groundMaterial = new CANNON.Material('ground');
    groundMaterial.friction = 0.8;
    groundMaterial.restitution = 0.1;

    // Ball-to-ball collisions
    const ballContactMaterial = new CANNON.ContactMaterial(ballMaterial, ballMaterial, {
        friction: 0.8,
        restitution: 0.6, // Increased bounce between balls
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3
    });
    world.addContactMaterial(ballContactMaterial);

    // Ball-to-wall collisions - more bouncy
    const ballWallContact = new CANNON.ContactMaterial(ballMaterial, wallMaterial, {
        friction: 0.5,
        restitution: 0.7, // Much more bouncy!
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3
    });
    world.addContactMaterial(ballWallContact);

    // Ball-to-obstacle collisions
    const ballObstacleContact = new CANNON.ContactMaterial(ballMaterial, obstacleMaterial, {
        friction: 0.75,
        restitution: 0.5,
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3
    });
    world.addContactMaterial(ballObstacleContact);

    // Ball-to-ground collisions
    const ballGroundContact = new CANNON.ContactMaterial(ballMaterial, groundMaterial, {
        friction: 0.8,
        restitution: 0.1,
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3
    });
    world.addContactMaterial(ballGroundContact);

    console.log('Physics setup complete');
}

function createCourse() {
    // Course ground with better material and texture-like appearance
    const courseGeometry = new THREE.PlaneGeometry(30, 40, 30, 40);

    // Create a more realistic grass texture using procedural approach
    const courseMaterial = new THREE.MeshStandardMaterial({
        color: 0x2d5016,
        roughness: 0.95,
        metalness: 0.0,
        bumpScale: 1.0
    });

    // Add subtle color variation for texture
    const colors = new Float32Array(courseGeometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
        const variation = 0.85 + Math.random() * 0.15; // 85-100% brightness variation
        colors[i] = 0.18 * variation;     // R
        colors[i + 1] = 0.31 * variation; // G
        colors[i + 2] = 0.10 * variation; // B
    }
    courseGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    courseMaterial.vertexColors = true;

    course = new THREE.Mesh(courseGeometry, courseMaterial);
    course.rotation.x = -Math.PI / 2;
    course.receiveShadow = true;
    scene.add(course);

    // Add subtle grid lines for a cleaner look
    const gridHelper = new THREE.GridHelper(30, 30, 0x00ffff, 0x002222);
    gridHelper.position.y = 0.01;
    gridHelper.material.opacity = 0.3;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Physics ground - use material from setupPhysics
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0 });
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);

    // Get or create ground material
    let groundMaterial = world.materials.find(m => m && m.name === 'ground');
    if (!groundMaterial) {
        groundMaterial = new CANNON.Material('ground');
        groundMaterial.friction = 0.8;
        groundMaterial.restitution = 0.1;
    }
    groundBody.material = groundMaterial;
    world.add(groundBody);

    // Contact material is already set up in setupPhysics

    // Course walls
    const wallHeight = 1;
    const wallThickness = 0.5;
    const courseWidth = 30;
    const courseLength = 40;

    const walls = [
        { pos: [0, wallHeight / 2, -courseLength / 2], size: [courseWidth, wallHeight, wallThickness] },
        { pos: [0, wallHeight / 2, courseLength / 2], size: [courseWidth, wallHeight, wallThickness] },
        { pos: [-courseWidth / 2, wallHeight / 2, 0], size: [wallThickness, wallHeight, courseLength] },
        { pos: [courseWidth / 2, wallHeight / 2, 0], size: [wallThickness, wallHeight, courseLength] }
    ];

    walls.forEach((wall, index) => {
        // Create rounded wall with top rail for more realistic look
        const wallGroup = new THREE.Group();

        // Main wall body with rounded edges effect
        const wallGeometry = new THREE.BoxGeometry(...wall.size);
        const wallMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b6f47,
            roughness: 0.6,
            metalness: 0.1
        });

        // Add color variation for wood grain
        const colors = new Float32Array(wallGeometry.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) {
            const variation = 0.9 + Math.random() * 0.1;
            colors[i] = 0.55 * variation;     // R
            colors[i + 1] = 0.44 * variation; // G
            colors[i + 2] = 0.28 * variation; // B
        }
        wallGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        wallMaterial.vertexColors = true;

        const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        wallGroup.add(wallMesh);

        // Add rounded top rail for realistic minigolf wall look
        const railHeight = 0.15;
        const railGeometry = new THREE.BoxGeometry(wall.size[0], railHeight, wall.size[2]);
        const railMaterial = new THREE.MeshStandardMaterial({
            color: 0xa0826d,
            roughness: 0.4,
            metalness: 0.2
        });
        const rail = new THREE.Mesh(railGeometry, railMaterial);
        rail.position.y = wall.size[1] / 2 + railHeight / 2;
        rail.castShadow = true;
        rail.receiveShadow = true;
        wallGroup.add(rail);

        // Add rounded corners using cylinders
        const cornerRadius = 0.1;
        const cornerGeometry = new THREE.CylinderGeometry(cornerRadius, cornerRadius, wall.size[1], 8);
        const cornerMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b6f47,
            roughness: 0.5,
            metalness: 0.15
        });

        // Add corners at each end (for horizontal walls) or top/bottom (for vertical walls)
        if (index < 2) {
            // Horizontal walls - corners on left and right
            const leftCorner = new THREE.Mesh(cornerGeometry, cornerMaterial);
            leftCorner.rotation.z = Math.PI / 2;
            leftCorner.position.set(-wall.size[0] / 2, wall.size[1] / 2, 0);
            wallGroup.add(leftCorner);

            const rightCorner = new THREE.Mesh(cornerGeometry, cornerMaterial);
            rightCorner.rotation.z = Math.PI / 2;
            rightCorner.position.set(wall.size[0] / 2, wall.size[1] / 2, 0);
            wallGroup.add(rightCorner);
        } else {
            // Vertical walls - corners on front and back
            const frontCorner = new THREE.Mesh(cornerGeometry, cornerMaterial);
            frontCorner.rotation.x = Math.PI / 2;
            frontCorner.position.set(0, wall.size[1] / 2, wall.size[2] / 2);
            wallGroup.add(frontCorner);

            const backCorner = new THREE.Mesh(cornerGeometry, cornerMaterial);
            backCorner.rotation.x = Math.PI / 2;
            backCorner.position.set(0, wall.size[1] / 2, -wall.size[2] / 2);
            wallGroup.add(backCorner);
        }

        wallGroup.position.set(...wall.pos);
        scene.add(wallGroup);

        // Physics - use box shape for walls
        const wallShape = new CANNON.Box(new CANNON.Vec3(...wall.size.map(s => s / 2)));
        const wallBody = new CANNON.Body({ mass: 0 });
        wallBody.addShape(wallShape);
        wallBody.position.set(...wall.pos);

        // Use the bouncy wall material
        const wallMaterial_phys = world.materials.find(m => m && m.name === 'wall');
        if (wallMaterial_phys) {
            wallBody.material = wallMaterial_phys;
        }

        world.add(wallBody);
    });
}

function createBall(playerNumber, startX, startZ, color, emissiveColor) {
    const radius = 0.2;
    const ballGeometry = new THREE.SphereGeometry(radius, 32, 32);

    // Create ball with player-specific colors
    const ballMaterial = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.2,
        metalness: 0.8,
        emissive: emissiveColor,
        emissiveIntensity: 0.2
    });
    const ball = new THREE.Mesh(ballGeometry, ballMaterial);
    ball.position.set(startX, radius + 0.1, startZ);
    ball.castShadow = true;
    scene.add(ball);

    // Add a glow effect
    const glowGeometry = new THREE.SphereGeometry(radius * 1.1, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: emissiveColor,
        transparent: true,
        opacity: 0.3
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    ball.add(glow);

    // Physics ball with increased friction
    const ballShape = new CANNON.Sphere(radius);
    const ballBody = new CANNON.Body({ mass: 1 });
    ballBody.addShape(ballShape);
    ballBody.position.set(startX, radius + 0.1, startZ);
    ballBody.material = new CANNON.Material('ball');
    ballBody.material.friction = 0.8; // Increased friction
    ballBody.material.restitution = 0.2; // Less bouncy
    ballBody.linearDamping = 0.4; // Add damping for more realistic stopping
    ballBody.angularDamping = 0.4;
    world.add(ballBody);

    // Store player number for reference
    ball.userData.playerNumber = playerNumber;
    ballBody.userData = { playerNumber: playerNumber };

    return { mesh: ball, body: ballBody };
}

function createBalls() {
    // Clear existing balls
    while (balls.length > 0) {
        const ball = balls.pop();
        if (ball) scene.remove(ball);
    }
    while (ballBodies.length > 0) {
        const body = ballBodies.pop();
        if (body) world.remove(body);
    }

    // Create balls based on game mode
    if (gameState.mode === 'multiplayer') {
        // Create two balls with different colors and starting positions
        // Player 1: Cyan ball, left side
        const ball1 = createBall(1, -2, -15, 0xffffff, 0x00ffff);
        balls.push(ball1.mesh);
        ballBodies.push(ball1.body);

        // Player 2: Magenta ball, right side
        const ball2 = createBall(2, 2, -15, 0xffffff, 0xff00ff);
        balls.push(ball2.mesh);
        ballBodies.push(ball2.body);
    } else {
        // Single player: only one ball
        const ball1 = createBall(1, 0, -15, 0xffffff, 0x00ffff);
        balls.push(ball1.mesh);
        ballBodies.push(ball1.body);
    }
}

function createHole() {
    const holeRadius = 0.6;
    const holeDepth = 1.0; // Deeper hole for clarity

    // Create a hole in the ground by cutting it out
    // First, create a visible rim around the hole
    const rimGeometry = new THREE.TorusGeometry(holeRadius + 0.1, 0.15, 16, 32);
    const rimMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.9,
        roughness: 0.1,
        emissive: 0xffffff,
        emissiveIntensity: 0.2
    });
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0.01, 15);
    rim.receiveShadow = true;
    scene.add(rim);

    // Visual hole (deep black cylinder)
    const holeGeometry = new THREE.CylinderGeometry(holeRadius, holeRadius, holeDepth, 32);
    const holeMaterial = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 1.0,
        metalness: 0.0
    });
    hole = new THREE.Mesh(holeGeometry, holeMaterial);
    hole.position.set(0, -holeDepth / 2, 15);
    hole.rotation.x = Math.PI / 2;
    scene.add(hole);

    // Add inner rim glow
    const innerRimGeometry = new THREE.TorusGeometry(holeRadius - 0.05, 0.08, 16, 32);
    const innerRimMaterial = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.9
    });
    const innerRim = new THREE.Mesh(innerRimGeometry, innerRimMaterial);
    innerRim.rotation.x = Math.PI / 2;
    innerRim.position.set(0, 0.02, 15);
    scene.add(innerRim);

    // Physics hole (trigger zone)
    const holeShape = new CANNON.Cylinder(holeRadius, holeRadius, 0.8, 32);
    const holeBody = new CANNON.Body({
        mass: 0,
        isTrigger: true,
        type: CANNON.Body.KINEMATIC
    });
    holeBody.addShape(holeShape);
    holeBody.position.set(0, 0.1, 15);
    holeBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
    world.add(holeBody);

    // Hole flag with glow - taller and more visible
    const flagPoleGeometry = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 8);
    const flagPoleMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.8,
        roughness: 0.2,
        emissive: 0xffffff,
        emissiveIntensity: 0.1
    });
    const flagPole = new THREE.Mesh(flagPoleGeometry, flagPoleMaterial);
    flagPole.position.set(0, 1.25, 15);
    flagPole.castShadow = true;
    scene.add(flagPole);

    // Larger, more visible flag
    const flagGeometry = new THREE.PlaneGeometry(1.0, 0.8);
    const flagMaterial = new THREE.MeshStandardMaterial({
        color: 0xff00ff,
        emissive: 0xff00ff,
        emissiveIntensity: 0.5,
        side: THREE.DoubleSide
    });
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(0.5, 1.65, 15);
    scene.add(flag);

    // Add a pulsing glow effect around the hole
    const glowRingGeometry = new THREE.TorusGeometry(holeRadius + 0.2, 0.1, 16, 32);
    glowRingMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
    });
    glowRing = new THREE.Mesh(glowRingGeometry, glowRingMaterial);
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.set(0, 0.03, 15);
    scene.add(glowRing);
}

function createObstacles() {
    // Add realistic obstacles with varied shapes
    const obstacleData = [
        { x: -5, z: 0, type: 'cylinder', radius: 0.8, height: 1, color: 0xff6b6b },
        { x: 5, z: 5, type: 'cylinder', radius: 0.6, height: 1, color: 0x4ecdc4 },
        { x: -3, z: 10, type: 'sphere', radius: 0.6, color: 0xffe66d },
        { x: 4, z: -5, type: 'roundedBox', size: [1.5, 1, 1.5], radius: 0.2, color: 0x95e1d3 },
        { x: 0, z: 5, type: 'cylinder', radius: 0.5, height: 0.8, color: 0xff9f43 },
        { x: -2, z: -8, type: 'sphere', radius: 0.5, color: 0xa29bfe }
    ];

    obstacleData.forEach(obs => {
        let obstacleMesh;
        let obstacleShape;
        let obstacleBody;
        const yPos = obs.height ? obs.height / 2 : (obs.radius || obs.size[1] / 2);

        if (obs.type === 'cylinder') {
            // Cylindrical obstacle
            const obstacleGeometry = new THREE.CylinderGeometry(obs.radius, obs.radius, obs.height, 16);
            const obstacleMaterial = new THREE.MeshStandardMaterial({
                color: obs.color,
                roughness: 0.3,
                metalness: 0.4,
                emissive: obs.color,
                emissiveIntensity: 0.1
            });
            obstacleMesh = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
            obstacleMesh.rotation.x = Math.PI / 2;
            obstacleMesh.position.set(obs.x, yPos, obs.z);

            // Physics
            obstacleShape = new CANNON.Cylinder(obs.radius, obs.radius, obs.height, 16);
            obstacleBody = new CANNON.Body({ mass: 0 });
            obstacleBody.addShape(obstacleShape);
            obstacleBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);

        } else if (obs.type === 'sphere') {
            // Spherical obstacle
            const obstacleGeometry = new THREE.SphereGeometry(obs.radius, 16, 16);
            const obstacleMaterial = new THREE.MeshStandardMaterial({
                color: obs.color,
                roughness: 0.2,
                metalness: 0.6,
                emissive: obs.color,
                emissiveIntensity: 0.15
            });
            obstacleMesh = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
            obstacleMesh.position.set(obs.x, yPos, obs.z);

            // Physics
            obstacleShape = new CANNON.Sphere(obs.radius);
            obstacleBody = new CANNON.Body({ mass: 0 });
            obstacleBody.addShape(obstacleShape);

        } else if (obs.type === 'roundedBox') {
            // Rounded box obstacle (using regular box with beveled appearance)
            const obstacleGeometry = new THREE.BoxGeometry(...obs.size, 2, 2, 2);
            const obstacleMaterial = new THREE.MeshStandardMaterial({
                color: obs.color,
                roughness: 0.4,
                metalness: 0.3,
                emissive: obs.color,
                emissiveIntensity: 0.12
            });
            obstacleMesh = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
            obstacleMesh.position.set(obs.x, yPos, obs.z);

            // Physics - use box shape
            obstacleShape = new CANNON.Box(new CANNON.Vec3(...obs.size.map(s => s / 2)));
            obstacleBody = new CANNON.Body({ mass: 0 });
            obstacleBody.addShape(obstacleShape);
        }

        if (obstacleMesh) {
            obstacleMesh.castShadow = true;
            obstacleMesh.receiveShadow = true;
            scene.add(obstacleMesh);
            obstacles.push(obstacleMesh);

            if (obstacleBody) {
                obstacleBody.position.set(obs.x, yPos, obs.z);

                // Use obstacle material from setupPhysics
                const obstacleMaterial_phys = world.materials.find(m => m && m.name === 'obstacle');
                if (obstacleMaterial_phys) {
                    obstacleBody.material = obstacleMaterial_phys;
                }

                world.add(obstacleBody);
            }
        }
    });
}

function resetBall() {
    const currentPlayer = gameState.currentPlayer;
    const currentBallBody = ballBodies[currentPlayer - 1];
    const currentBall = balls[currentPlayer - 1];

    if (!currentBallBody || !currentBall) return;

    // Reset current player's ball to starting position
    const startX = currentPlayer === 1 ? -2 : 2;
    currentBallBody.velocity.set(0, 0, 0);
    currentBallBody.angularVelocity.set(0, 0, 0);
    currentBallBody.position.set(startX, 0.3, -15);
    currentBallBody.quaternion.set(0, 0, 0, 1);

    // Update visual ball position
    currentBall.position.set(startX, 0.3, -15);

    gameState.ballInHole = false;
}

function updateScoreDisplay() {
    document.getElementById('stroke-count').textContent = gameState.strokes[gameState.currentPlayer];

    if (gameState.mode === 'multiplayer') {
        const playerColors = ['', 'Cyan', 'Magenta'];
        const playerColor = playerColors[gameState.currentPlayer] || '';
        const canShoot = gameState.allBallsStopped ? '' : ' (Wait for balls to stop)';
        document.getElementById('player-turn').textContent = `Player ${gameState.currentPlayer}'s Turn (${playerColor} Ball)${canShoot}`;
    } else {
        document.getElementById('player-turn').textContent = '';
    }

    // Highlight the active ball visually
    for (let i = 0; i < balls.length; i++) {
        if (balls[i]) {
            const isActive = (i + 1) === gameState.currentPlayer;
            // Make active ball more visible
            if (balls[i].children[0]) { // glow child
                balls[i].children[0].material.opacity = isActive ? 0.5 : 0.2;
            }
            // Add outline or scale effect for active ball
            if (isActive && gameState.mode === 'multiplayer') {
                balls[i].scale.set(1.1, 1.1, 1.1);
            } else {
                balls[i].scale.set(1, 1, 1);
            }
        }
    }
}

function checkBallInHole() {
    if (gameState.ballInHole) return;

    // Check both balls
    for (let i = 0; i < ballBodies.length; i++) {
        const ballBody = ballBodies[i];
        if (!ballBody) continue;

        const ballPos = ballBody.position;
        const holePos = { x: 0, y: 0.1, z: 15 };
        const distance = Math.sqrt(
            Math.pow(ballPos.x - holePos.x, 2) +
            Math.pow(ballPos.y - holePos.y, 2) +
            Math.pow(ballPos.z - holePos.z, 2)
        );

        // Check if this ball is in the hole
        if (distance < 0.6 && Math.abs(ballBody.velocity.length()) < 0.5) {
            const playerNumber = i + 1;
            // Only trigger game over if it's the current player's ball
            if (playerNumber === gameState.currentPlayer) {
                gameState.ballInHole = true;
                setTimeout(() => {
                    showGameOver();
                }, 500);
                break;
            }
        }
    }
}

function showGameOver() {
    const finalScore = gameState.strokes[gameState.currentPlayer];
    document.getElementById('final-score').textContent = `Completed in ${finalScore} stroke${finalScore !== 1 ? 's' : ''}!`;
    switchScreen('game-over-screen');
}

function startGame(mode) {
    console.log('=== STARTING GAME ===');
    console.log('Mode:', mode);
    console.log('Current screen before switch:', document.querySelector('.screen.active')?.id);

    gameState.mode = mode;
    gameState.currentPlayer = 1;
    gameState.strokes = { 1: 0, 2: 0 };
    gameState.gameActive = true;
    gameState.ballInHole = false;
    gameState.hasSwitchedTurn = false;
    gameState.allBallsStopped = true;

    // Create balls based on mode
    createBalls();

    // Reset balls to starting positions
    for (let i = 0; i < ballBodies.length; i++) {
        const playerNum = i + 1;
        const ballBody = ballBodies[i];
        const ball = balls[i];
        if (ballBody && ball) {
            let startX = 0;
            if (mode === 'multiplayer') {
                startX = playerNum === 1 ? -2 : 2;
            } else {
                startX = 0; // Single player starts in center
            }
            ballBody.velocity.set(0, 0, 0);
            ballBody.angularVelocity.set(0, 0, 0);
            ballBody.position.set(startX, 0.3, -15);
            ballBody.quaternion.set(0, 0, 0, 1);
            ball.position.set(startX, 0.3, -15);
        }
    }

    updateScoreDisplay();

    // Create aim arrow for hand gesture control
    if (!aimArrow) {
        createAimArrow();
    }

    // Start hand gesture polling
    startGesturePolling();

    // Force screen switch
    switchScreen('game-screen');

    // Verify switch worked
    setTimeout(() => {
        const activeScreen = document.querySelector('.screen.active');
        console.log('Active screen after switch:', activeScreen?.id);
        console.log('Game screen element:', document.getElementById('game-screen'));
        console.log('Game screen display:', window.getComputedStyle(document.getElementById('game-screen')).display);
        console.log('Canvas element:', document.getElementById('game-canvas'));
        console.log('Scene exists:', !!scene);
        console.log('Renderer exists:', !!renderer);
    }, 100);

    console.log('=== GAME STARTED ===');
}

function showMenu() {
    gameState.gameActive = false;
    switchScreen('menu-screen');
}

function switchScreen(screenId) {
    console.log('Switching to screen:', screenId);
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
        console.log('Removed active from:', screen.id);
    });
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        console.log('Added active to:', screenId);
        console.log('Screen display style:', window.getComputedStyle(targetScreen).display);
    } else {
        console.error('Screen not found:', screenId);
    }
}

function animate() {
    requestAnimationFrame(animate);

    // Step physics
    world.step(1 / 60);

    // Update all ball positions
    for (let i = 0; i < balls.length && i < ballBodies.length; i++) {
        if (balls[i] && ballBodies[i]) {
            balls[i].position.copy(ballBodies[i].position);
            balls[i].quaternion.copy(ballBodies[i].quaternion);
        }
    }

    // Animate hole glow
    if (glowRing && glowRingMaterial) {
        const time = Date.now() * 0.001;
        glowRingMaterial.opacity = 0.3 + Math.sin(time * 2) * 0.2;
        glowRing.rotation.z += 0.01;
    }

    // Check if ball is in hole
    checkBallInHole();

    // Check if all balls have stopped in multiplayer mode
    if (gameState.mode === 'multiplayer') {
        let allBallsStopped = true;
        for (let i = 0; i < ballBodies.length; i++) {
            if (ballBodies[i] && ballBodies[i].velocity.length() >= 0.15) {
                allBallsStopped = false;
                break;
            }
        }
        gameState.allBallsStopped = allBallsStopped;

        // If all balls stopped and it's multiplayer, switch turns
        if (allBallsStopped && !gameState.isDragging && !gameState.ballInHole && !gameState.hasSwitchedTurn) {
            // Switch to next player
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
            gameState.hasSwitchedTurn = true;
            updateScoreDisplay();
        }

        // Reset turn switch flag when any ball starts moving
        if (!allBallsStopped) {
            gameState.hasSwitchedTurn = false;
        }
    } else {
        gameState.allBallsStopped = true; // Single player can always shoot
    }

    // Update camera to follow current player's ball smoothly - always looking from behind toward hole
    const currentBallBody = ballBodies[gameState.currentPlayer - 1];
    if (currentBallBody && camera) {
        const ballPos = currentBallBody.position;
        // Camera should be behind the ball, looking toward the hole
        const targetX = ballPos.x * 0.3;
        const targetZ = ballPos.z - 8; // Behind the ball (negative z)
        const targetY = 10 + Math.sin(Date.now() * 0.001) * 0.5; // Subtle camera movement

        // Smooth camera follow
        camera.position.x += (targetX - camera.position.x) * 0.1;
        camera.position.z += (targetZ - camera.position.z) * 0.1;
        camera.position.y += (targetY - camera.position.y) * 0.05;

        // Look ahead toward the hole direction, slightly ahead of ball
        const lookAheadZ = Math.min(ballPos.z + 5, 15); // Look toward hole but don't go past it
        camera.lookAt(ballPos.x, 0, lookAheadZ);
    }

    renderer.render(scene, camera);
}

// Start the game when page loads
window.addEventListener('load', () => {
    // Wait a bit longer for all scripts to load
    setTimeout(() => {
        // Check if libraries are loaded
        if (typeof THREE === 'undefined') {
            console.error('❌ Three.js failed to load');
            alert('Error: Three.js library failed to load. Please check your internet connection and refresh the page.');
            return;
        }

        // Check if Cannon.js loaded (should be from local file now)
        if (typeof CANNON === 'undefined') {
            console.error('❌ Cannon.js failed to load from local file');
            alert('Error: Cannon.js physics library failed to load. Please refresh the page.');
            return;
        }

        console.log('✅ All libraries loaded successfully');
        initializeGame();
    }, 100);
});

function initializeGame() {
    console.log('🎮 Initializing game...');
    try {
        init();
        console.log('✅ Game initialized successfully');

        // Verify buttons exist and are clickable
        const singleBtn = document.getElementById('single-player-btn');
        const multiBtn = document.getElementById('multiplayer-btn');
        console.log('Single player button:', singleBtn ? '✅ Found' : '❌ NOT FOUND');
        console.log('Multiplayer button:', multiBtn ? '✅ Found' : '❌ NOT FOUND');

        if (singleBtn) {
            console.log('Single button pointer-events:', window.getComputedStyle(singleBtn).pointerEvents);
            console.log('Single button z-index:', window.getComputedStyle(singleBtn).zIndex);
        }
    } catch (error) {
        console.error('❌ Error initializing game:', error);
        console.error('Stack trace:', error.stack);
        alert('Error initializing game: ' + error.message + '\n\nCheck the console for details.');
    }
}

// ========== MULTIPLAYER (Socket.IO) ==========
const MP_SERVER_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:5001'
    : `http://${window.location.hostname}:5001`;
let mpSocket = null;
let myPlayerNum = 1;

function initMinigolfMultiplayer() {
    if (typeof io === 'undefined') {
        console.log('Socket.IO not loaded, multiplayer disabled');
        return;
    }

    mpSocket = io(MP_SERVER_URL);

    mpSocket.on('connect', () => {
        console.log('⛳ Connected to multiplayer server');
        mpSocket.emit('join_room', { room: 'minigolf-default', game: 'minigolf' });
    });

    mpSocket.on('player_id', (data) => {
        myPlayerNum = data.playerNum;
        console.log(`⛳ You are Player ${myPlayerNum}`);
    });

    mpSocket.on('player_joined', (data) => {
        console.log(`⛳ Opponent joined! Player ${data.playerNum}`);
        // Update UI to show opponent connected
        const turnEl = document.getElementById('player-turn');
        if (turnEl) turnEl.textContent = 'Opponent connected!';
    });

    mpSocket.on('opponent_ball', (data) => {
        // Update opponent's ball position in the scene
        if (gameState.mode === 'multiplayer' && data.position) {
            updateOpponentBall(data.position, data.velocity);
        }
    });

    mpSocket.on('score_update', (data) => {
        // Show opponent's stroke count
        console.log(`Opponent strokes: ${data.score}`);
    });
}

function updateOpponentBall(position, velocity) {
    // If we have a second ball for multiplayer, update it
    if (ballBodies.length > 1 && myPlayerNum === 1) {
        const opponentBall = ballBodies[1];
        opponentBall.position.set(position.x, position.y, position.z);
        if (velocity) {
            opponentBall.velocity.set(velocity.x, velocity.y, velocity.z);
        }
    } else if (ballBodies.length > 0 && myPlayerNum === 2) {
        const opponentBall = ballBodies[0];
        opponentBall.position.set(position.x, position.y, position.z);
        if (velocity) {
            opponentBall.velocity.set(velocity.x, velocity.y, velocity.z);
        }
    }
}

// Broadcast ball position after each shot
function broadcastBallPosition() {
    if (mpSocket && mpSocket.connected && gameState.mode === 'multiplayer') {
        const myBall = ballBodies[myPlayerNum - 1];
        if (myBall) {
            mpSocket.emit('ball_update', {
                position: { x: myBall.position.x, y: myBall.position.y, z: myBall.position.z },
                velocity: { x: myBall.velocity.x, y: myBall.velocity.y, z: myBall.velocity.z }
            });
        }
    }
}

// Broadcast stroke count after each shot
function broadcastStrokeCount() {
    if (mpSocket && mpSocket.connected) {
        mpSocket.emit('update_score', { score: gameState.strokes[myPlayerNum] });
    }
}

// Initialize multiplayer when game loads
setTimeout(() => {
    initMinigolfMultiplayer();
}, 500);
