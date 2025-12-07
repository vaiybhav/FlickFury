import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import './Landing.css'

function Landing() {
    const { user } = useAuth()

    return (
        <div className="landing">
            {/* Hero Section */}
            <section className="hero">
                <div className="hero-bg">
                    <div className="hero-glow hero-glow-1"></div>
                    <div className="hero-glow hero-glow-2"></div>
                </div>

                <div className="hero-content">
                    <h1 className="hero-title">
                        <span className="hero-emoji">🎮</span>
                        <span>Play Games</span>
                        <span className="hero-highlight">With Friends</span>
                    </h1>

                    <p className="hero-subtitle">
                        Fun multiplayer games you can play with friends online.
                        No downloads, just instant fun!
                    </p>

                    <div className="hero-cta">
                        <Link to="/games" className="cta-primary">
                            🏀 Start Playing
                        </Link>
                        {!user && (
                            <span className="cta-hint">No account needed to play!</span>
                        )}
                    </div>

                    <div className="hero-stats">
                        <div className="stat">
                            <span className="stat-value">🏀</span>
                            <span className="stat-label">Basketball</span>
                        </div>
                        <div className="stat">
                            <span className="stat-value">🎯</span>
                            <span className="stat-label">More Coming</span>
                        </div>
                        <div className="stat">
                            <span className="stat-value">🌐</span>
                            <span className="stat-label">Multiplayer</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="features">
                <h2 className="features-title">Why Play Here?</h2>

                <div className="features-grid">
                    <div className="feature-card">
                        <div className="feature-icon">⚡</div>
                        <h3>Instant Play</h3>
                        <p>No downloads or installations. Just click and play in your browser.</p>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">👥</div>
                        <h3>Play Together</h3>
                        <p>Connect with friends anywhere in the world. Real-time multiplayer.</p>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">📱</div>
                        <h3>Any Device</h3>
                        <p>Works on phones, tablets, and computers. Play anywhere.</p>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">🏆</div>
                        <h3>Compete</h3>
                        <p>Track your scores and compete for the top spot on leaderboards.</p>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="cta-section">
                <h2>Ready to Play?</h2>
                <p>Jump into a game right now!</p>
                <Link to="/games" className="cta-primary cta-large">
                    Browse Games →
                </Link>
            </section>
        </div>
    )
}

export default Landing
