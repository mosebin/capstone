import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './global.css';
import Navbar from './components/Navbar';
import Projects from './pages/Projects';
import NewProject from './pages/NewProject';
import Divergence from './pages/Divergence';
import AxisModal from './pages/AxisModal';
import Canvas from './pages/Canvas';
import Dashboard from './pages/Dashboard';

function Layout({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%' }}>
      <Navbar />
      <div style={{ flex: 1, width: '100%' }}>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout><Projects /></Layout>} />
        <Route path="/new-project" element={<Layout><NewProject /></Layout>} />
        <Route path="/divergence" element={<Layout><Divergence /></Layout>} />
        <Route path="/axis-modal" element={
          <Layout>
            <div style={{ position: 'relative' }}>
              <Divergence />
              <AxisModal />
            </div>
          </Layout>
        } />
        <Route path="/canvas" element={<Layout><Canvas /></Layout>} />
        <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
      </Routes>
    </BrowserRouter>
  );
}
