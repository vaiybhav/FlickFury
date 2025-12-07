import { Link } from 'react-router-dom'
import './GameCard.css'

function GameCard({ game }) {
    return (
        <Link to={`/play/${game.id}`} className="game-card">
            <div className="game-card-image">
                <img
                    src={game.thumbnail || '/images/default-game.png'}
                    alt={game.title}
                    onError={(e) => {
                        e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="%231a1a2e" width="200" height="200"/><text x="100" y="100" font-family="Arial" font-size="60" fill="%23ff6b35" text-anchor="middle" dominant-baseline="middle">🎮</text></svg>'
                    }}
                />
                <div className="game-card-overlay">
                    <span className="play-button">▶ Play</span>
                </div>
            </div>
            <div className="game-card-content">
                <h3 className="game-card-title">{game.title}</h3>
                <p className="game-card-description">{game.description}</p>
                {game.players && (
                    <span className="game-card-badge">{game.players}</span>
                )}
            </div>
        </Link>
    )
}

export default GameCard
