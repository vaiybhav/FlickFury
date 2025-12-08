from flask import Flask, request, jsonify, send_from_directory, Response
from flask_socketio import SocketIO, emit, join_room, leave_room
import cv2
import threading
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = 'flick-games-secret!'

# Initialize Socket.IO for real-time multiplayer
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ========== DATA STORES ==========
joystick_data = {"x": 0, "y": 0, "sw": 0}
flick_data = None
punch_data = None
aim_data = {"x": 0.5, "y": 0.5}
hands_data = {"left": {"x": 0.3, "y": 0.5}, "right": {"x": 0.7, "y": 0.5}}
active_game = None
game_state = {"status": "waiting", "message": "Show high-five to start"}  # waiting, countdown, playing, paused

# ========== MULTIPLAYER STATE ==========
players = {}  # {session_id: {name, game, room, hands, score, ...}}
rooms = {}    # {room_code: {game, players: [], state: {}}}

# ========== VIDEO STREAMING ==========
camera = None
camera_lock = threading.Lock()
latest_frame = None

def generate_frames():
    """Generator for video streaming - optimized for smooth playback."""
    global latest_frame
    while True:
        if latest_frame is not None:
            ret, buffer = cv2.imencode('.jpg', latest_frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ret:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        time.sleep(0.016)

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/video_frame', methods=['POST'])
def receive_frame():
    global latest_frame
    import base64
    import numpy as np
    
    data = request.json
    if data and 'frame' in data:
        img_data = base64.b64decode(data['frame'])
        nparr = np.frombuffer(img_data, np.uint8)
        latest_frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return {"status": "ok"}

# ========== CORS HANDLING ==========
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, DELETE'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.route("/flick", methods=["OPTIONS"])
@app.route("/joystick", methods=["OPTIONS"])
@app.route("/video_frame", methods=["OPTIONS"])
@app.route("/punch", methods=["OPTIONS"])
@app.route("/aim", methods=["OPTIONS"])
@app.route("/hands", methods=["OPTIONS"])
@app.route("/game", methods=["OPTIONS"])
@app.route("/game_state", methods=["OPTIONS"])
def handle_options():
    return '', 204

# ========== JOYSTICK ENDPOINTS ==========
@app.route("/joystick", methods=["POST"])
def update_joystick():
    global joystick_data
    joystick_data = request.json
    return {"status": "ok"}

@app.route("/joystick", methods=["GET"])
def get_joystick():
    return jsonify(joystick_data)

# ========== FLICK GESTURE ENDPOINTS ==========
@app.route("/flick", methods=["POST"])
def receive_flick():
    global flick_data
    flick_data = request.json
    print(f"🏀 Flick: vx={flick_data.get('vx', 0):.2f}, vy={flick_data.get('vy', 0):.2f}")
    # Broadcast flick to all players in the room
    socketio.emit('opponent_flick', flick_data, broadcast=True)
    return {"status": "ok"}

@app.route("/flick", methods=["GET"])
def get_flick():
    global flick_data
    if flick_data:
        result = flick_data
        flick_data = None
        return jsonify(result)
    return jsonify(None)

# ========== PUNCH GESTURE ENDPOINTS (Boxing) ==========
@app.route("/punch", methods=["POST"])
def receive_punch():
    global punch_data
    punch_data = request.json
    hand = punch_data.get('hand', 'Unknown')
    power = punch_data.get('power', 0)
    print(f"🥊 Punch ({hand}): power={power:.2f}")
    # Broadcast punch to opponent
    socketio.emit('opponent_punch', punch_data, broadcast=True)
    return {"status": "ok"}

@app.route("/punch", methods=["GET"])
def get_punch():
    global punch_data
    if punch_data:
        result = punch_data
        punch_data = None
        return jsonify(result)
    return jsonify(None)

# ========== AIM POSITION ENDPOINTS ==========
@app.route("/aim", methods=["POST"])
def receive_aim():
    global aim_data
    aim_data = request.json
    return {"status": "ok"}

@app.route("/aim", methods=["GET"])
def get_aim():
    return jsonify(aim_data)

# ========== HANDS POSITION ENDPOINTS ==========
@app.route("/hands", methods=["POST"])
def receive_hands():
    global hands_data
    hands_data = request.json
    # Broadcast hand positions to opponent for boxing
    socketio.emit('opponent_hands', hands_data, broadcast=True)
    return {"status": "ok"}

@app.route("/hands", methods=["GET"])
def get_hands():
    return jsonify(hands_data)

# ========== GAME STATE ENDPOINTS (auto start/pause) ==========
@app.route("/game_state", methods=["POST"])
def update_game_state():
    global game_state
    data = request.json
    if data:
        game_state = data
        print(f"🎮 Game state: {game_state.get('status')} - {game_state.get('message', '')}")
        # Broadcast to all connected games
        socketio.emit('game_state_change', game_state, broadcast=True)
    return {"status": "ok"}

@app.route("/game_state", methods=["GET"])
def get_game_state():
    return jsonify(game_state)

# ========== ACTIVE GAME REGISTRATION ==========
@app.route("/game", methods=["POST"])
def register_game():
    global active_game
    data = request.json
    active_game = data.get('game') if data else None
    print(f"🎮 Active game: {active_game}")
    return {"status": "ok", "game": active_game}

@app.route("/game", methods=["GET"])
def get_game():
    return jsonify({"game": active_game})

@app.route("/game", methods=["DELETE"])
def unregister_game():
    global active_game
    print(f"🎮 Game closed: {active_game}")
    active_game = None
    return {"status": "ok"}

# ========== SOCKET.IO EVENTS (Multiplayer) ==========
@socketio.on('connect')
def handle_connect():
    print(f"🔌 Player connected: {request.sid}")
    players[request.sid] = {
        'id': request.sid,
        'name': f'Player {len(players) + 1}',
        'room': None,
        'score': 0,
        'hands': hands_data.copy()
    }
    emit('player_id', {'id': request.sid, 'playerNum': len(players)})

@socketio.on('disconnect')
def handle_disconnect():
    print(f"🔌 Player disconnected: {request.sid}")
    if request.sid in players:
        room = players[request.sid].get('room')
        if room and room in rooms:
            rooms[room]['players'].remove(request.sid)
            emit('player_left', {'id': request.sid}, room=room)
        del players[request.sid]

@socketio.on('join_room')
def handle_join_room(data):
    room_code = data.get('room', 'default')
    game = data.get('game', 'unknown')
    
    if room_code not in rooms:
        rooms[room_code] = {
            'game': game,
            'players': [],
            'state': {'scores': {}, 'turn': 0}
        }
    
    join_room(room_code)
    rooms[room_code]['players'].append(request.sid)
    players[request.sid]['room'] = room_code
    
    player_count = len(rooms[room_code]['players'])
    print(f"🚪 Player joined room '{room_code}' ({player_count} players)")
    
    emit('room_joined', {
        'room': room_code,
        'playerNum': player_count,
        'players': rooms[room_code]['players']
    })
    emit('player_joined', {
        'id': request.sid,
        'playerNum': player_count
    }, room=room_code, include_self=False)

@socketio.on('leave_room')
def handle_leave_room(data):
    room_code = data.get('room')
    if room_code:
        leave_room(room_code)
        if room_code in rooms and request.sid in rooms[room_code]['players']:
            rooms[room_code]['players'].remove(request.sid)
        emit('player_left', {'id': request.sid}, room=room_code)

@socketio.on('update_hands')
def handle_update_hands(data):
    """Real-time hand position updates for boxing."""
    if request.sid in players:
        players[request.sid]['hands'] = data
        room = players[request.sid].get('room')
        if room:
            emit('opponent_hands', {
                'id': request.sid,
                'hands': data
            }, room=room, include_self=False)

@socketio.on('update_score')
def handle_update_score(data):
    """Score updates for basketball/minigolf."""
    if request.sid in players:
        players[request.sid]['score'] = data.get('score', 0)
        room = players[request.sid].get('room')
        if room:
            emit('score_update', {
                'id': request.sid,
                'score': data.get('score', 0)
            }, room=room, include_self=False)

@socketio.on('punch_hit')
def handle_punch_hit(data):
    """When a punch lands on opponent."""
    room = players.get(request.sid, {}).get('room')
    if room:
        emit('got_punched', {
            'by': request.sid,
            'hand': data.get('hand'),
            'power': data.get('power')
        }, room=room, include_self=False)

@socketio.on('ball_update')
def handle_ball_update(data):
    """Minigolf ball position updates."""
    room = players.get(request.sid, {}).get('room')
    if room:
        emit('opponent_ball', {
            'id': request.sid,
            'position': data.get('position'),
            'velocity': data.get('velocity')
        }, room=room, include_self=False)

# ========== STATIC FILES ==========
@app.route("/")
def serve_page():
    return send_from_directory(".", "index.html")

# ========== GET LOCAL IP FOR LAN ==========
def get_local_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "localhost"

# ========== RUN SERVER ==========
if __name__ == "__main__":
    local_ip = get_local_ip()
    print("🎮 Starting Flick Games Multiplayer Server...")
    print(f"📡 Local: http://localhost:5001")
    print(f"🌐 LAN:   http://{local_ip}:5001")
    print("-" * 40)
    print("Share the LAN URL with other players on the same network!")
    print("-" * 40)
    # Bind to 0.0.0.0 to allow network access
    socketio.run(app, host='0.0.0.0', port=5001, debug=True, use_reloader=False)
