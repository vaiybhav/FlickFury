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
                        <span className="hero-brand">FlickFury</span>
                        <span className="hero-highlight">Motion Gaming</span>
                    </h1>

                    <p className="hero-subtitle">
                        Experience the next generation of gesture-controlled games.
                        Real-time hand tracking. Instant multiplayer.
                    </p>

                    <div className="hero-cta">
                        <Link to="/games" className="cta-primary">
                            Start Playing
                        </Link>
                        {!user && (
                            <span className="cta-hint">No account needed to play</span>
                        )}
                    </div>

                    <div className="hero-stats">
                        <div className="stat">
                            <span className="stat-value">4</span>
                            <span className="stat-label">Games</span>
                        </div>
                        <div className="stat">
                            <span className="stat-value">LAN</span>
                            <span className="stat-label">Multiplayer</span>
                        </div>
                        <div className="stat">
                            <span className="stat-value">60fps</span>
                            <span className="stat-label">Tracking</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="features">
                <h2 className="features-title">Why FlickFury?</h2>

                <div className="features-grid">
                    <div className="feature-card">
                        <div className="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                            </svg>
                        </div>
                        <h3>Instant Play</h3>
                        <p>No downloads or installations. Just click and play in your browser.</p>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                        </div>
                        <h3>Play Together</h3>
                        <p>Connect with friends on the same network. Real-time multiplayer.</p>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                                <line x1="12" y1="18" x2="12" y2="18" />
                            </svg>
                        </div>
                        <h3>Hand Tracking</h3>
                        <p>Use your webcam for gesture controls. No controllers needed.</p>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                                <path d="M4 22h16" />
                                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                            </svg>
                        </div>
                        <h3>Compete</h3>
                        <p>Track your scores and compete for the top spot against friends.</p>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="cta-section">
                <h2>Ready to Play?</h2>
                <p>Jump into a game right now</p>
                <Link to="/games" className="cta-primary cta-large">
                    Browse Games
                </Link>
            </section>
        </div>
    )
}

export default Landing
