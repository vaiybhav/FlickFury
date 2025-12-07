import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import Navbar from './components/Navbar'
import Landing from './pages/Landing'
import Games from './pages/Games'
import GamePlayer from './pages/GamePlayer'
import Profile from './pages/Profile'

function App() {
    return (
        <AuthProvider>
            <div className="app">
                <Navbar />
                <main>
                    <Routes>
                        <Route path="/" element={<Landing />} />
                        <Route path="/games" element={<Games />} />
                        <Route path="/play/:gameId" element={<GamePlayer />} />
                        <Route path="/profile" element={<Profile />} />
                    </Routes>
                </main>
            </div>
        </AuthProvider>
    )
}

export default App
