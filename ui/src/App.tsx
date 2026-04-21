import { Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import ProfilesPage from './pages/ProfilesPage'
import ProvidersPage from './pages/ProvidersPage'
import GroupsPage from './pages/GroupsPage'
import ProxyPage from './pages/ProxyPage'
import SettingsPage from './pages/SettingsPage'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/proxy" element={<ProxyPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  )
}

export default App
