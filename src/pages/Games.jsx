import GameCard from '../components/GameCard'
import './Games.css'

// Game data - in a real app this would come from a database
const games = [
    {
        id: 'basketball',
        title: '🏀 Flick Hoops',
        description: 'Flick the ball into the hoop! Test your aim in this addictive basketball game.',
        thumbnail: '/games/basketball/thumbnail.png',
        players: '1-2 Players',
        featured: true
    },
    {
        id: 'boxing',
        title: '🥊 Punch Out',
        description: 'Throw punches at targets using hand tracking! Test your speed and accuracy.',
        thumbnail: '/games/boxing/thumbnail.png',
        players: '1 Player'
    },
    {
        id: 'minigolf',
        title: '⛳ 3D Minigolf',
        description: 'Putt your way to victory in this stunning 3D minigolf experience!',
        thumbnail: '/games/minigolf/thumbnail.png',
        players: '1-2 Players'
    },
    {
        id: 'archery',
        title: '🏹 Archery Master',
        description: 'Pull back, aim, and shoot! Connect your joystick via USB for a realistic archery experience.',
        thumbnail: '/games/archery/thumbnail.png',
        players: '1 Player'
    }
]

function Games() {
    const featuredGame = games.find(g => g.featured)
    const otherGames = games.filter(g => !g.featured)

    return (
        <div className="games-page">
            <div className="games-header">
                <h1>🎮 Games</h1>
                <p>Pick a game and start playing with friends!</p>
            </div>

            {/* Featured Game */}
            {featuredGame && (
                <div className="featured-section">
                    <h2 className="section-title">⭐ Featured</h2>
                    <div className="featured-game">
                        <GameCard game={featuredGame} />
                    </div>
                </div>
            )}

            {/* All Games */}
            <div className="games-section">
                <h2 className="section-title">All Games</h2>
                <div className="games-grid">
                    {otherGames.map((game) => (
                        <GameCard key={game.id} game={game} />
                    ))}
                </div>
            </div>
        </div>
    )
}

export default Games
