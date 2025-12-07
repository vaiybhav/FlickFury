"""
🎮 FlickFury Gesture Controller
Run this script to play games with hand gestures!

Requirements: pip install mediapipe opencv-python numpy requests
"""

import mediapipe as mp
import cv2
import time
import numpy as np
import requests
from collections import deque

# ========== SERVER URL ==========
# This should already be set to the live server
SERVER_URL = "https://flickfury.onrender.com"

FLASK_URL = f"{SERVER_URL}/flick"
PUNCH_URL = f"{SERVER_URL}/punch"
AIM_URL = f"{SERVER_URL}/aim"
HANDS_URL = f"{SERVER_URL}/hands"
FRAME_URL = f"{SERVER_URL}/video_frame"
GAME_URL = f"{SERVER_URL}/game"

# ========== SETTINGS ==========
CAMERA_INDEX = 0  # Change if you have multiple cameras
VELOCITY_THRESHOLD = 0.5
FLICK_COOLDOWN = 0.5
PUNCH_Z_THRESHOLD = 0.2
PUNCH_COOLDOWN = 0.2
HISTORY_SIZE = 8

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils

# ========== GAME STATE ==========
class GameState:
    WAITING_FOR_HIGHFIVE = 0
    COUNTDOWN = 1
    PLAYING = 2

game_state = GameState.WAITING_FOR_HIGHFIVE
countdown_start = 0
COUNTDOWN_DURATION = 5

# ========== HAND TRACKING ==========
hand_data = {
    'Left': {'position_history': deque(maxlen=HISTORY_SIZE), 'time_history': deque(maxlen=HISTORY_SIZE), 
             'last_flick_time': 0, 'last_punch_time': 0, 'prev_velocity': np.zeros(3)},
    'Right': {'position_history': deque(maxlen=HISTORY_SIZE), 'time_history': deque(maxlen=HISTORY_SIZE), 
              'last_flick_time': 0, 'last_punch_time': 0, 'prev_velocity': np.zeros(3)}
}

def get_active_game():
    try:
        resp = requests.get(GAME_URL, timeout=0.5)
        if resp.status_code == 200:
            return resp.json().get('game')
    except:
        pass
    return None

def is_high_five(hand_landmarks):
    tips = [mp_hands.HandLandmark.THUMB_TIP, mp_hands.HandLandmark.INDEX_FINGER_TIP,
            mp_hands.HandLandmark.MIDDLE_FINGER_TIP, mp_hands.HandLandmark.RING_FINGER_TIP,
            mp_hands.HandLandmark.PINKY_TIP]
    pips = [mp_hands.HandLandmark.THUMB_IP, mp_hands.HandLandmark.INDEX_FINGER_PIP,
            mp_hands.HandLandmark.MIDDLE_FINGER_PIP, mp_hands.HandLandmark.RING_FINGER_PIP,
            mp_hands.HandLandmark.PINKY_PIP]
    
    fingers_extended = sum(1 for tip, pip in zip(tips, pips) 
                          if hand_landmarks.landmark[tip].y < hand_landmarks.landmark[pip].y)
    return fingers_extended >= 4

def compute_velocity(positions, times):
    if len(positions) < 2:
        return np.zeros(3)
    recent_pos = list(positions)[-4:]
    recent_times = list(times)[-4:]
    if len(recent_pos) < 2:
        return np.zeros(3)
    dt = recent_times[-1] - recent_times[0]
    if dt <= 0:
        return np.zeros(3)
    return (recent_pos[-1] - recent_pos[0]) / dt

def detect_flick(velocity, hand_label):
    curr_time = time.time()
    data = hand_data[hand_label]
    if curr_time - data['last_flick_time'] < FLICK_COOLDOWN:
        return None
    upward_speed = -velocity[1]
    if upward_speed > VELOCITY_THRESHOLD:
        hand_data[hand_label]['last_flick_time'] = curr_time
        return {"vx": float(velocity[0]), "vy": float(upward_speed), 
                "magnitude": float(np.sqrt(velocity[0]**2 + velocity[1]**2)), "hand": hand_label}
    return None

def detect_punch(velocity, hand_label):
    curr_time = time.time()
    data = hand_data[hand_label]
    if curr_time - data['last_punch_time'] < PUNCH_COOLDOWN:
        return None
    forward_speed = -velocity[2]
    if forward_speed > PUNCH_Z_THRESHOLD:
        hand_data[hand_label]['last_punch_time'] = curr_time
        power = min(forward_speed / PUNCH_Z_THRESHOLD, 3.0)
        return {"hand": hand_label, "power": float(power), "velocity_z": float(forward_speed)}
    return None

def send_data(url, data):
    try:
        requests.post(url, json=data, timeout=0.1)
        return True
    except:
        return False

# ========== MAIN ==========
print("🎮 FlickFury Gesture Controller")
print(f"🌐 Server: {SERVER_URL}")
print("✋ Show a HIGH-FIVE to start!")
print("-" * 40)

cap = cv2.VideoCapture(CAMERA_INDEX)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

if not cap.isOpened():
    print(f"❌ Failed to open camera {CAMERA_INDEX}")
    exit(1)

with mp_hands.Hands(max_num_hands=2, min_detection_confidence=0.6, min_tracking_confidence=0.6) as hands:
    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            continue

        frame = cv2.flip(frame, 1)
        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(image)
        curr_t = time.time()

        if game_state == GameState.WAITING_FOR_HIGHFIVE:
            cv2.putText(frame, "Show HIGH-FIVE to start!", (50, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 3)
            if results.multi_hand_landmarks:
                for hl in results.multi_hand_landmarks:
                    mp_draw.draw_landmarks(frame, hl, mp_hands.HAND_CONNECTIONS)
                    if is_high_five(hl):
                        print("✋ High-five! Starting...")
                        game_state = GameState.COUNTDOWN
                        countdown_start = curr_t
                        break

        elif game_state == GameState.COUNTDOWN:
            remaining = COUNTDOWN_DURATION - (curr_t - countdown_start)
            if remaining <= 0:
                print("🎮 GO!")
                game_state = GameState.PLAYING
            else:
                cv2.putText(frame, f"{int(remaining) + 1}", (280, 200), cv2.FONT_HERSHEY_SIMPLEX, 5, (0, 255, 0), 8)

        elif game_state == GameState.PLAYING:
            active_game = get_active_game()
            
            if results.multi_hand_landmarks and results.multi_handedness:
                left_pos = (0.3, 0.5)
                right_pos = (0.7, 0.5)
                
                for hl, hd in zip(results.multi_hand_landmarks, results.multi_handedness):
                    hand_label = hd.classification[0].label
                    mp_draw.draw_landmarks(frame, hl, mp_hands.HAND_CONNECTIONS)
                    
                    tip = hl.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
                    curr_pos = np.array([tip.x, tip.y, tip.z])
                    
                    data = hand_data[hand_label]
                    data['position_history'].append(curr_pos)
                    data['time_history'].append(curr_t)
                    
                    if hand_label == 'Left':
                        left_pos = (tip.x, tip.y)
                    else:
                        right_pos = (tip.x, tip.y)
                    
                    velocity = compute_velocity(data['position_history'], data['time_history'])
                    
                    # Flick detection (basketball/minigolf)
                    if active_game in ['basketball', 'minigolf']:
                        flick = detect_flick(velocity, hand_label)
                        if flick:
                            send_data(FLASK_URL, flick)
                            print(f"🏀 FLICK! vy={flick['vy']:.2f}")
                    
                    # Punch detection (boxing)
                    if active_game == 'boxing':
                        punch = detect_punch(velocity, hand_label)
                        if punch:
                            send_data(PUNCH_URL, punch)
                            print(f"🥊 PUNCH! power={punch['power']:.2f}")
                
                # Send hand positions
                send_data(HANDS_URL, {"left": {"x": left_pos[0], "y": left_pos[1]},
                                       "right": {"x": right_pos[0], "y": right_pos[1]}})
            else:
                cv2.putText(frame, "Show hands", (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (100, 100, 100), 2)

        cv2.imshow("FlickFury Controller", frame)
        if cv2.waitKey(1) & 0xFF == 27:
            break

cap.release()
cv2.destroyAllWindows()
