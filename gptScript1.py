import mediapipe as mp
import cv2
import time
import numpy as np
import requests
import base64
from collections import deque

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils

# ========== CONFIGURATION ==========
FLASK_URL = "http://localhost:5001/flick"
PUNCH_URL = "http://localhost:5001/punch"
AIM_URL = "http://localhost:5001/aim"
HANDS_URL = "http://localhost:5001/hands"
FRAME_URL = "http://localhost:5001/video_frame"
GAME_URL = "http://localhost:5001/game"
CAMERA_INDEX = 0

# Game-specific gesture mapping
# Which gestures are enabled for each game
GAME_GESTURES = {
    'basketball': ['flick', 'aim', 'hands'],
    'boxing': ['punch', 'hands'],
    'minigolf': ['flick', 'aim', 'hands'],
    None: []  # No game active = no gestures
}

def get_active_game():
    """Check which game is currently active."""
    try:
        resp = requests.get(GAME_URL, timeout=0.1)
        if resp.status_code == 200:
            return resp.json().get('game')
    except:
        pass
    return None

# Flick detection parameters (basketball/minigolf)
VELOCITY_THRESHOLD = 0.5   # Slightly more sensitive (was 0.6)
FLICK_COOLDOWN = 0.5       # Cooldown between flicks

# Punch detection parameters (boxing) - MORE SENSITIVE
PUNCH_Z_THRESHOLD = 0.2   # Lower = more sensitive (was 0.35)
PUNCH_COOLDOWN = 0.2      # Faster punching (was 0.3)

HISTORY_SIZE = 8

# ========== GAME STATE ==========
class GameState:
    WAITING_FOR_HIGHFIVE = 0
    COUNTDOWN = 1
    PLAYING = 2

game_state = GameState.WAITING_FOR_HIGHFIVE
countdown_start = 0
COUNTDOWN_DURATION = 5  # seconds

# Hand detection timeout - reset if hands not visible for too long
hands_visible = False
hands_gone_time = 0  # When hands disappeared
HANDS_TIMEOUT = 10.0  # 10 seconds without hands = force 5s countdown

# ========== TRACKING STATE (per hand) ==========
# Track both left and right hands
hand_data = {
    'Left': {
        'position_history': deque(maxlen=HISTORY_SIZE), 
        'time_history': deque(maxlen=HISTORY_SIZE), 
        'last_flick_time': 0, 
        'last_punch_time': 0,
        'prev_velocity': np.zeros(3)
    },
    'Right': {
        'position_history': deque(maxlen=HISTORY_SIZE), 
        'time_history': deque(maxlen=HISTORY_SIZE), 
        'last_flick_time': 0, 
        'last_punch_time': 0,
        'prev_velocity': np.zeros(3)
    }
}

def is_high_five(hand_landmarks):
    """
    Detect high-five gesture: all fingers extended (open palm).
    Check if all fingertips are above their corresponding knuckles.
    """
    tips = [
        mp_hands.HandLandmark.THUMB_TIP,
        mp_hands.HandLandmark.INDEX_FINGER_TIP,
        mp_hands.HandLandmark.MIDDLE_FINGER_TIP,
        mp_hands.HandLandmark.RING_FINGER_TIP,
        mp_hands.HandLandmark.PINKY_TIP
    ]
    
    pips = [
        mp_hands.HandLandmark.THUMB_IP,  # For thumb, use IP joint
        mp_hands.HandLandmark.INDEX_FINGER_PIP,
        mp_hands.HandLandmark.MIDDLE_FINGER_PIP,
        mp_hands.HandLandmark.RING_FINGER_PIP,
        mp_hands.HandLandmark.PINKY_PIP
    ]
    
    fingers_extended = 0
    for tip, pip in zip(tips, pips):
        if hand_landmarks.landmark[tip].y < hand_landmarks.landmark[pip].y:
            fingers_extended += 1
    
    # All 5 fingers extended = high five
    return fingers_extended >= 4  # Allow for some tolerance

def is_fist(hand_landmarks):
    """
    Detect fist gesture: all fingers curled (closed hand).
    Check if all fingertips are BELOW their corresponding knuckles.
    """
    tips = [
        mp_hands.HandLandmark.INDEX_FINGER_TIP,
        mp_hands.HandLandmark.MIDDLE_FINGER_TIP,
        mp_hands.HandLandmark.RING_FINGER_TIP,
        mp_hands.HandLandmark.PINKY_TIP
    ]
    
    pips = [
        mp_hands.HandLandmark.INDEX_FINGER_PIP,
        mp_hands.HandLandmark.MIDDLE_FINGER_PIP,
        mp_hands.HandLandmark.RING_FINGER_PIP,
        mp_hands.HandLandmark.PINKY_PIP
    ]
    
    fingers_curled = 0
    for tip, pip in zip(tips, pips):
        # Tip is below (higher Y) the PIP joint = finger curled
        if hand_landmarks.landmark[tip].y > hand_landmarks.landmark[pip].y:
            fingers_curled += 1
    
    # At least 3 of 4 fingers curled = fist (excluding thumb)
    return fingers_curled >= 3

# Shoot mode state: False = aim mode (open hand), True = shoot mode (fist)
shoot_mode = False
# Stored aim position: captured when entering shoot mode
stored_aim = {"x": 0.5, "y": 0.5}  # Center by default

def compute_velocity(positions, times):
    if len(positions) < 2:
        return np.zeros(3)
    
    recent_positions = list(positions)[-4:]
    recent_times = list(times)[-4:]
    
    if len(recent_positions) < 2:
        return np.zeros(3)
    
    dt = recent_times[-1] - recent_times[0]
    if dt <= 0:
        return np.zeros(3)
    
    vel = (recent_positions[-1] - recent_positions[0]) / dt
    return vel

def detect_flick(velocity, hand_label):
    global hand_data
    
    curr_time = time.time()
    data = hand_data[hand_label]
    
    if curr_time - data['last_flick_time'] < FLICK_COOLDOWN:
        return None
    
    upward_speed = -velocity[1]
    horizontal_speed = velocity[0]
    
    if upward_speed > VELOCITY_THRESHOLD:
        hand_data[hand_label]['last_flick_time'] = curr_time
        magnitude = np.sqrt(velocity[0]**2 + velocity[1]**2)
        
        return {
            "vx": float(horizontal_speed),
            "vy": float(upward_speed),
            "magnitude": float(magnitude),
            "hand": hand_label,
            "timestamp": curr_time
        }
    return None

def send_flick(flick_data):
    try:
        requests.post(FLASK_URL, json=flick_data, timeout=0.1)
        print(f"🏀 FLICK ({flick_data['hand']})! vx={flick_data['vx']:.2f}, vy={flick_data['vy']:.2f}")
        return True
    except:
        return False

def detect_punch(velocity, hand_label):
    """Detect forward punch motion (positive Z velocity = forward)."""
    global hand_data
    
    curr_time = time.time()
    data = hand_data[hand_label]
    
    if curr_time - data['last_punch_time'] < PUNCH_COOLDOWN:
        return None
    
    # Z velocity: positive = moving toward camera (punching forward)
    # In MediaPipe, Z is depth - closer = smaller value
    # So we detect sudden decrease in Z (moving toward camera)
    forward_speed = -velocity[2]  # Negative Z = forward punch
    
    if forward_speed > PUNCH_Z_THRESHOLD:
        hand_data[hand_label]['last_punch_time'] = curr_time
        power = min(forward_speed / PUNCH_Z_THRESHOLD, 3.0)  # Cap power at 3x
        
        return {
            "hand": hand_label,
            "power": float(power),
            "velocity_z": float(forward_speed),
            "timestamp": curr_time
        }
    return None

def send_punch(punch_data):
    try:
        requests.post(PUNCH_URL, json=punch_data, timeout=0.1)
        print(f"🥊 PUNCH ({punch_data['hand']})! power={punch_data['power']:.2f}")
        return True
    except:
        return False

def send_aim(x, y):
    """Send left hand position for trajectory aiming."""
    try:
        requests.post(AIM_URL, json={"x": float(x), "y": float(y)}, timeout=0.02)
    except:
        pass

def send_hands(left_x, left_y, right_x, right_y):
    """Send both hand positions for boxing cursors."""
    try:
        data = {
            "left": {"x": float(left_x), "y": float(left_y)},
            "right": {"x": float(right_x), "y": float(right_y)}
        }
        requests.post(HANDS_URL, json=data, timeout=0.02)
    except:
        pass

def send_game_state(status, message=""):
    """Send game state to trigger auto-start/pause in games."""
    try:
        data = {"status": status, "message": message}
        requests.post(FLASK_URL + "/game_state", json=data, timeout=0.05)
        print(f"📡 Sent game state: {status} - {message}")
    except:
        pass

def send_frame(frame):
    """Send frame to Flask for browser display - optimized for speed."""
    try:
        # Smaller resize for faster transfer
        small = cv2.resize(frame, (400, 300))
        _, buffer = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 70])
        b64 = base64.b64encode(buffer).decode('utf-8')
        # Use a very short timeout to avoid blocking
        requests.post(FRAME_URL, json={"frame": b64}, timeout=0.02)
    except:
        pass  # Don't block on frame send failures

# ========== MAIN LOOP ==========
print("🎮 Hand Gesture Controller (Two-Hand Mode)")
print(f"📷 Camera: {CAMERA_INDEX}")
print("✋ Show a HIGH-FIVE (open palm) to start!")
print("-" * 40)

cap = cv2.VideoCapture(CAMERA_INDEX)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

if not cap.isOpened():
    print(f"❌ Failed to open camera {CAMERA_INDEX}")
    exit(1)

frame_count = 0

with mp_hands.Hands(
    max_num_hands=2,  # Track BOTH hands
    min_detection_confidence=0.6,
    min_tracking_confidence=0.6
) as hands:

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            continue

        frame = cv2.flip(frame, 1)
        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image.flags.writeable = False
        results = hands.process(image)
        image.flags.writeable = True

        curr_t = time.time()
        
        # ========== STATE MACHINE ==========
        if game_state == GameState.WAITING_FOR_HIGHFIVE:
            # Display "Show high-five to start"
            cv2.putText(frame, "Show HIGH-FIVE to start!", (50, 80), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 3)
            cv2.putText(frame, "(Open palm)", (120, 120), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2)
            
            # Check for high-five gesture
            if results.multi_hand_landmarks:
                for hand_landmarks in results.multi_hand_landmarks:
                    mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
                    
                    if is_high_five(hand_landmarks):
                        print("✋ High-five detected! Starting countdown...")
                        game_state = GameState.COUNTDOWN
                        countdown_start = curr_t
                        break
        
        elif game_state == GameState.COUNTDOWN:
            # Countdown requires hands to be visible continuously
            if results.multi_hand_landmarks:
                elapsed = curr_t - countdown_start
                remaining = COUNTDOWN_DURATION - elapsed
                
                if remaining <= 0:
                    print("🎮 GO! Start flicking!")
                    game_state = GameState.PLAYING
                    hands_visible = True  # Start with hands visible
                    hands_gone_time = 0
                    send_game_state("playing", "Game started - flick away!")
                else:
                    # Display countdown
                    cv2.putText(frame, f"Keep hands visible!", (80, 80), 
                               cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 3)
                    cv2.putText(frame, f"{int(remaining) + 1}", (280, 200), 
                               cv2.FONT_HERSHEY_SIMPLEX, 5, (0, 255, 0), 8)
                    
                    # Draw hands during countdown
                    for hand_landmarks in results.multi_hand_landmarks:
                        mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
            else:
                # Hands not visible - reset countdown
                countdown_start = curr_t  # Reset the countdown
                cv2.putText(frame, "Show hands to continue!", (60, 80), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 165, 255), 3)
                cv2.putText(frame, "5", (280, 200), 
                           cv2.FONT_HERSHEY_SIMPLEX, 5, (0, 165, 255), 8)
        
        elif game_state == GameState.PLAYING:
            # Normal gameplay - track both hands
            if results.multi_hand_landmarks and results.multi_handedness:
                # Hands are visible - reset the gone timer
                if not hands_visible:
                    hands_visible = True
                    hands_gone_time = 0  # Reset timeout
                    print("✋ Hands back!")
                for hand_landmarks, handedness in zip(results.multi_hand_landmarks, results.multi_handedness):
                    # Get hand label (Left or Right)
                    hand_label = handedness.classification[0].label
                    
                    # Draw hand landmarks
                    color = (0, 255, 0) if hand_label == "Right" else (255, 100, 100)
                    mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS,
                                          mp_draw.DrawingSpec(color=color, thickness=2, circle_radius=2),
                                          mp_draw.DrawingSpec(color=color, thickness=2))
                    
                    # Get index finger tip
                    tip = hand_landmarks.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
                    curr_pos = np.array([tip.x, tip.y, tip.z])
                    
                    # LEFT HAND: Only used for boxing cursors, not aiming in flick games
                    # (Right hand handles both aim + shoot in flick games)
                    
                    # Update history for this hand
                    data = hand_data[hand_label]
                    data['position_history'].append(curr_pos)
                    data['time_history'].append(curr_t)
                    
                    # Store hand position for boxing cursors
                    if hand_label == 'Left':
                        hand_data['Left']['current_pos'] = (tip.x, tip.y)
                    else:
                        hand_data['Right']['current_pos'] = (tip.x, tip.y)
                    
                    # Compute velocity
                    velocity = compute_velocity(data['position_history'], data['time_history'])
                    
                    # Check active game to filter gestures
                    active_game = get_active_game()
                    allowed_gestures = GAME_GESTURES.get(active_game, [])
                    
                    # === CONTROL LOGIC BASED ON GAME ===
                    
                    if active_game == 'minigolf':
                        # MINIGOLF: Single-Hand Two-Phase Control (Right Hand)
                        if hand_label == 'Right' and 'flick' in allowed_gestures:
                            right_hand_fist = is_fist(hand_landmarks)
                            right_hand_open = is_high_five(hand_landmarks)
                            
                            # Update shoot mode based on hand gesture
                            if right_hand_fist and not shoot_mode:
                                shoot_mode = True
                                # LOCK IN AIM: Store current aim position when entering shoot mode
                                stored_aim["x"] = tip.x
                                stored_aim["y"] = tip.y
                                print(f"✊ SHOOT MODE - Aim locked at ({tip.x:.2f}, {tip.y:.2f})")
                            elif right_hand_open and shoot_mode:
                                shoot_mode = False
                                print("✋ AIM MODE - Move to aim")
                            
                            # Show mode indicator
                            cx = int(tip.x * frame.shape[1])
                            cy = int(tip.y * frame.shape[0])
                            if shoot_mode:
                                # SHOOT MODE: Red indicator, waiting for flick
                                cv2.circle(frame, (cx, cy), 35, (0, 0, 255), -1)
                                cv2.putText(frame, "SHOOT", (cx - 35, cy - 45), 
                                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                                
                                # Only detect flick in shoot mode
                                flick = detect_flick(velocity, hand_label)
                                if flick:
                                    # USE STORED AIM for direction instead of raw velocity
                                    # Convert aim position (0-1) to direction (-1 to 1)
                                    aim_vx = (0.5 - stored_aim["x"]) * 2
                                    
                                    directional_flick = {
                                        "vx": aim_vx, 
                                        "vy": flick["vy"], 
                                        "magnitude": flick["magnitude"]
                                    }
                                    send_flick(directional_flick)
                                    
                                    cv2.circle(frame, (cx, cy), 50, (0, 255, 0), 5)
                                    cv2.putText(frame, "FLICK!", (cx - 40, cy - 60), 
                                               cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 3)
                                    # Reset to aim mode after flick
                                    shoot_mode = False
                            else:
                                # AIM MODE: Yellow indicator, send position for aiming
                                send_aim(tip.x, tip.y)
                                cv2.circle(frame, (cx, cy), 25, (0, 255, 255), 3)
                                cv2.putText(frame, "AIM", (cx - 20, cy - 30), 
                                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
                                           
                    elif active_game == 'basketball':
                        # BASKETBALL: Two-Hand Control (Left=Aim, Right=Flick)
                        if hand_label == 'Left':
                             send_aim(tip.x, tip.y)
                             cx = int(tip.x * frame.shape[1])
                             cy = int(tip.y * frame.shape[0])
                             cv2.circle(frame, (cx, cy), 25, (255, 255, 0), 3) # Cyan for Aim
                             cv2.putText(frame, "AIM", (cx - 20, cy - 30), 
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
                        
                        elif hand_label == 'Right':
                             # Standard flick detection (always active, no mode switching)
                             flick = detect_flick(velocity, hand_label)
                             if flick:
                                 send_flick(flick)
                                 cx = int(tip.x * frame.shape[1])
                                 cy = int(tip.y * frame.shape[0])
                                 cv2.circle(frame, (cx, cy), 50, (0, 255, 0), 5)
                                 cv2.putText(frame, "FLICK!", (cx - 40, cy - 60), 
                                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 3)
                    
                    elif active_game == 'boxing':
                        # BOXING: Both hands for cursor tracking + punch detection
                        cx = int(tip.x * frame.shape[1])
                        cy = int(tip.y * frame.shape[0])
                        cursor_color = (255, 100, 100) if hand_label == 'Left' else (100, 100, 255)
                        cv2.circle(frame, (cx, cy), 30, cursor_color, 3)
                        cv2.putText(frame, hand_label[0], (cx - 10, cy - 35), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, cursor_color, 2)
                    
                    # Detect punch (boxing only)
                    if 'punch' in allowed_gestures:
                        punch = detect_punch(velocity, hand_label)
                        if punch:
                            send_punch(punch)
                            cx = int(tip.x * frame.shape[1])
                            cy = int(tip.y * frame.shape[0])
                            punch_color = (255, 100, 100) if hand_label == 'Left' else (100, 100, 255)
                            cv2.circle(frame, (cx, cy), 60, punch_color, -1)
                            cv2.putText(frame, "PUNCH!", (cx - 50, cy - 70), 
                                       cv2.FONT_HERSHEY_SIMPLEX, 1, punch_color, 3)
                    
                    data['prev_velocity'] = velocity
                
                # Send both hand positions (always useful for debugging)
                left_pos = hand_data['Left'].get('current_pos', (0.3, 0.5))
                right_pos = hand_data['Right'].get('current_pos', (0.7, 0.5))
                send_hands(left_pos[0], left_pos[1], right_pos[0], right_pos[1])
                
                # Show velocity bars
                for i, (label, data) in enumerate(hand_data.items()):
                    if len(data['position_history']) > 0:
                        vel = compute_velocity(data['position_history'], data['time_history'])
                        vy_display = min(-vel[1] * 2, 1.0)
                        bar_width = int(max(0, vy_display) * 100)
                        y_pos = 30 + i * 40
                        color = (0, 255, 0) if -vel[1] > VELOCITY_THRESHOLD else (100, 100, 100)
                        cv2.rectangle(frame, (10, y_pos), (10 + bar_width, y_pos + 25), color, -1)
                        cv2.rectangle(frame, (10, y_pos), (110, y_pos + 25), (255, 255, 255), 2)
                        cv2.putText(frame, f"{label[0]}", (115, y_pos + 20), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            else:
                # No hands detected - start or continue timeout
                if hands_visible:
                    # Hands just disappeared - start timer
                    hands_visible = False
                    hands_gone_time = curr_t
                    print("👋 Hands gone - 10s timeout started...")
                
                if hands_gone_time > 0:
                    time_gone = curr_t - hands_gone_time
                    if time_gone > HANDS_TIMEOUT:
                        print("⚠️ 10s timeout - forcing 5 second countdown...")
                        game_state = GameState.COUNTDOWN
                        countdown_start = curr_t
                        hands_gone_time = 0
                        send_game_state("paused", "Hands lost - show hands to resume")
                        # Clear hand histories
                        for label in hand_data:
                            hand_data[label]['position_history'].clear()
                            hand_data[label]['time_history'].clear()
                    else:
                        timeout_remaining = HANDS_TIMEOUT - time_gone
                        cv2.putText(frame, f"Show hands! ({int(timeout_remaining)+1}s)", (10, 40), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)

        # Send EVERY frame to browser for smooth preview
        send_frame(frame)

        cv2.imshow("Flick Hoops - Two Hands", frame)
        if cv2.waitKey(1) & 0xFF == 27:
            break

cap.release()
cv2.destroyAllWindows()
