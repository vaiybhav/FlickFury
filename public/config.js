window.GAME_CONFIG = {
    // ⚠️ UPDATE THIS AFTER DEPLOYING BACKEND TO RENDER ⚠️
    API_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:5001'
        : 'https://flickfury.onrender.com'
};
