import { useParams, Link } from 'react-router-dom'
import './GamePlayer.css'

// Game data
const gameData = {
    'basketball': {
        title: 'Flick Hoops',
        description: 'Flick the ball into the hoop! Score as many as you can in 60 seconds.',
        path: '/games/basketball/index.html'
    },
    'boxing': {
        title: 'Punch Out',
        description: 'Punch the targets! Score as many hits as you can in 60 seconds.',
        path: '/games/boxing/index.html'
    },
    'minigolf': {
        title: '3D Minigolf',
        description: 'Putt your way to victory! Use hand gestures to aim and shoot.',
        path: '/games/minigolf/index.html'
    },
    'archery': {
        title: 'Archery Master',
        description: 'Realistic 3D archery! Use your joystick to aim and charge your shot.',
        path: '/games/archery/index.html'
    }
}

function GamePlayer() {
    const { gameId } = useParams()
    const game = gameData[gameId]

    if (!game) {
        return (
            <div className="game-player">
                <div className="game-not-found">
                    <h1>🎮 Coming Soon!</h1>
                    <p>This game is still in development. Check back later!</p>
                    <Link to="/games" className="back-btn">← Browse Games</Link>
                </div>
            </div>
        )
    }

    return (
        <div className="game-player">
            <div className="game-player-header">
                <Link to="/games" className="back-link">
                    <span>←</span> Games
                </Link>
                <h1 className="game-player-title">{game.title}</h1>
                <div className="header-spacer"></div>
            </div>

            <div className="game-layout">
                <div className="game-main">
                    <div className="game-frame">
                        <iframe
                            src={game.path}
                            title={game.title}
                            className="game-iframe"
                            allow="autoplay; fullscreen"
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default GamePlayer
