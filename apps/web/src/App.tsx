import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import District, { DistrictIndex } from './pages/District';
import Pendency from './pages/Pendency';
import Anomalies from './pages/Anomalies';
import Ask from './pages/Ask';
import Privacy from './pages/Privacy';
import Audit from './pages/Audit';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Starting SevaLens…" className="h-full" />;
  if (!user)
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="districts" element={<DistrictIndex />} />
        <Route path="districts/:id" element={<District />} />
        <Route path="pendency" element={<Pendency />} />
        <Route path="anomalies" element={<Anomalies />} />
        <Route path="ask" element={<Ask />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="audit" element={user.role === 'STATE_ADMIN' ? <Audit /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
