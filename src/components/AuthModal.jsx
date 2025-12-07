import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import './AuthModal.css'

function AuthModal({ onClose }) {
    const [mode, setMode] = useState('signin') // 'signin' or 'signup'
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')
    const { signIn, signUp, error } = useAuth()

    const handleSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)
        setMessage('')

        try {
            if (mode === 'signup') {
                await signUp(email, password)
                setMessage('Check your email for the confirmation link!')
            } else {
                await signIn(email, password)
                onClose()
            }
        } catch (err) {
            // Error is handled by useAuth
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="modal-close" onClick={onClose}>×</button>

                <h2 className="modal-title">
                    {mode === 'signin' ? 'Welcome Back!' : 'Join the Game'}
                </h2>

                <p className="modal-subtitle">
                    {mode === 'signin'
                        ? 'Sign in to track your scores'
                        : 'Create an account to compete with friends'}
                </p>

                <form onSubmit={handleSubmit} className="auth-form">
                    <div className="form-group">
                        <label htmlFor="email">Email</label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            minLength={6}
                            required
                        />
                    </div>

                    {error && <p className="error-message">{error}</p>}
                    {message && <p className="success-message">{message}</p>}

                    <button type="submit" className="submit-btn" disabled={loading}>
                        {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
                    </button>
                </form>

                <div className="auth-switch">
                    {mode === 'signin' ? (
                        <p>
                            Don't have an account?{' '}
                            <button onClick={() => setMode('signup')}>Sign up</button>
                        </p>
                    ) : (
                        <p>
                            Already have an account?{' '}
                            <button onClick={() => setMode('signin')}>Sign in</button>
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}

export default AuthModal
