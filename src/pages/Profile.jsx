import { useAuth } from '../hooks/useAuth'
import { Link } from 'react-router-dom'
import './Profile.css'

function Profile() {
    const { user, isConfigured } = useAuth()

    if (!isConfigured) {
        return (
            <div className="profile-page">
                <div className="profile-card">
                    <h1>Profile</h1>
                    <p className="profile-note">
                        Supabase is not configured yet. Set up your .env file to enable authentication.
                    </p>
                    <Link to="/games" className="profile-btn">Play Games →</Link>
                </div>
            </div>
        )
    }

    if (!user) {
        return (
            <div className="profile-page">
                <div className="profile-card">
                    <h1>Profile</h1>
                    <p className="profile-note">Sign in to view your profile and track your scores!</p>
                    <Link to="/games" className="profile-btn">Play Games →</Link>
                </div>
            </div>
        )
    }

    return (
        <div className="profile-page">
            <div className="profile-card">
                <div className="profile-avatar">
                    {user.email?.charAt(0).toUpperCase() || '?'}
                </div>

                <h1 className="profile-name">
                    {user.email?.split('@')[0] || 'Player'}
                </h1>

                <p className="profile-email">{user.email}</p>

                <div className="profile-stats">
                    <div className="profile-stat">
                        <span className="stat-value">0</span>
                        <span className="stat-label">Games Played</span>
                    </div>
                    <div className="profile-stat">
                        <span className="stat-value">0</span>
                        <span className="stat-label">High Score</span>
                    </div>
                </div>

                <div className="profile-actions">
                    <Link to="/games" className="profile-btn">Play Games →</Link>
                </div>
            </div>
        </div>
    )
}

export default Profile
