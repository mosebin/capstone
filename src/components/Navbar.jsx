import { NavLink, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { clearActiveProjectSession } from '../lib/gpt';

const STEPS = [
  { num: 1, label: '새프로젝트', eyebrow: 'NEW PROJECT', path: '/new-project' },
  { num: 2, label: '발산',       eyebrow: 'DIVERGE',     paths: ['/divergence', '/axis-modal'] },
  { num: 3, label: '캔버스',     eyebrow: 'CANVAS',      paths: ['/canvas', '/dashboard'] },
];
function getActiveStep(pathname) {
  for (let i = STEPS.length - 1; i >= 0; i--) {
    const s = STEPS[i];
    const allPaths = s.paths ?? [s.path];
    if (allPaths.some(p => pathname === p)) return s.num;
  }
  return 0;
}

export default function Navbar() {
  const location = useLocation();
  const activeStep = getActiveStep(location.pathname);
  const showProgress = location.pathname !== '/';
  const [hoveredAction, setHoveredAction] = useState(null);
  const goHome = () => {
    clearActiveProjectSession();
  };

  return (
    <nav style={{
      width: '100%',
      background: 'rgba(17,19,22,0.8)',
      backdropFilter: 'blur(18px)',
      borderBottom: '1px solid #2a2a2a',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 100,
        padding: '0 36px',
        boxSizing: 'border-box',
        position: 'relative',
      }}>
        {/* Logo */}
        <NavLink to="/" onClick={goHome} style={{ display: 'flex', alignItems: 'center' }}>
          <img src="/LOGO.svg" alt="neo:Node" style={{ height: 32 }} />
        </NavLink>

        {/* Progress steps — absolutely centered */}
        {showProgress && (
          <div style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
          }}>
            {STEPS.map((step, idx) => {
              const isActive = step.num === activeStep;
              const isPast   = step.num < activeStep;
              const isLast   = idx === STEPS.length - 1;
              const to = step.path ?? step.paths[0];

              return (
                <div key={step.num} style={{ display: 'flex', alignItems: 'center' }}>
                  <NavLink
                    to={to}
                    onClick={step.num === 1 ? goHome : undefined}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                  >
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%',
                      background: isActive ? '#CBFF00' : 'transparent',
                      border: isActive ? 'none' : isPast ? '2px solid #CBFF00' : '2px solid #444',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 700,
                      color: isActive ? '#111' : isPast ? '#CBFF00' : '#555',
                      transition: 'all .2s',
                    }}>
                      {step.num}
                    </div>
                    <div style={{ textAlign: 'center', lineHeight: 1.12 }}>
                      <div style={{ fontSize: 9, fontWeight: 850, letterSpacing: 0.8, color: isActive ? '#CBFF00' : isPast ? '#CBFF00' : '#555', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>
                        {step.eyebrow}
                      </div>
                      <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: isActive ? '#CBFF00' : isPast ? '#CBFF00' : '#555', whiteSpace: 'nowrap' }}>
                        {step.label}
                      </div>
                    </div>
                  </NavLink>
                  {!isLast && (
                    <div style={{
                      width: 96, height: 1.5,
                      background: step.num < activeStep ? '#CBFF00' : '#333',
                      marginBottom: 34, transition: 'background .2s',
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NavLink
            to="/"
            onClick={goHome}
            aria-label="프로젝트 아카이브"
            title="프로젝트 아카이브"
            onMouseEnter={() => setHoveredAction('home')}
            onMouseLeave={() => setHoveredAction(null)}
            style={{
              width: 44, height: 44, padding: 0, borderRadius: 10,
              background: hoveredAction === 'home' ? '#303030' : '#242424', color: hoveredAction === 'home' ? '#CBFF00' : '#eee',
              border: `1px solid ${hoveredAction === 'home' ? 'rgba(203,255,0,.48)' : '#3a3a3a'}`, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box',
              boxShadow: hoveredAction === 'home' ? '0 0 18px rgba(203,255,0,.16)' : 'none',
              transform: hoveredAction === 'home' ? 'translateY(-1px)' : 'none',
              transition: 'background .18s, color .18s, border-color .18s, box-shadow .18s, transform .18s',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
            </svg>
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
