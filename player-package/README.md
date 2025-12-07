# 🎮 FlickFury - Player Setup

## Quick Start (5 minutes)

### 1. Install Python
Download from [python.org](https://www.python.org/downloads/) (check "Add to PATH")

### 2. Install Dependencies
Open Terminal/Command Prompt and run:
```bash
pip install mediapipe opencv-python numpy requests
```

### 3. Run the Controller
```bash
python gesture_controller.py
```

### 4. Open the Game
Go to: **https://YOUR_VERCEL_URL_HERE.vercel.app**

---

## How to Play
1. Show a **high-five** (open palm) to start
2. Wait for countdown
3. Use hand gestures:
   - **Basketball/Minigolf**: Flick upward to shoot
   - **Boxing**: Punch forward to hit targets

## Troubleshooting
- **Camera not found?** Try changing `CAMERA_INDEX = 1` in the script
- **Connection issues?** Make sure you have internet access
