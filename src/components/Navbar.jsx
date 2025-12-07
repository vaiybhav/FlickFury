import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AuthModal from './AuthModal'
import './Navbar.css'

function Navbar() {
    const { user, signOut } = useAuth()
    const [showAuthModal, setShowAuthModal] = useState(false)
    const location = useLocation()

    const handleSignOut = async () => {
        try {
            await signOut()
        } catch (err) {
            console.error('Sign out error:', err)
        }
    }

    return (
        <>
            <nav className="navbar">
                <div className="navbar-container">
                    <Link to="/" className="navbar-brand">
                        <span className="brand-icon">🎮</span>
                        <span className="brand-text">Flick Games</span>
                    </Link>

                    <div className="navbar-links">
                        <Link
                            to="/games"
                            className={`nav-link ${location.pathname === '/games' ? 'active' : ''}`}
                        >
                            Games
                        </Link>

                        {user ? (
                            <>
                                <Link
                                    to="/profile"
                                    className={`nav-link ${location.pathname === '/profile' ? 'active' : ''}`}
                                >
                                    Profile
                                </Link>
                                <button onClick={handleSignOut} className="nav-btn nav-btn-secondary">
                                    Sign Out
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => setShowAuthModal(true)}
                                className="nav-btn nav-btn-primary"
                            >
                                Sign In
                            </button>
                        )}
                    </div>
                </div>
            </nav>

            {showAuthModal && (
                <AuthModal onClose={() => setShowAuthModal(false)} />
            )}
        </>
    )
}

export default Navbar
