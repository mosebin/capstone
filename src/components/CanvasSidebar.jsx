import { useState } from 'react';

const ICON_LAYERS = '/solar_layers-bold.png';
const ICON_CURSOR = '/iconamoon_cursor-fill.svg';
const ICON_GROUP  = '/carbon_cics-system-group.svg';
const ICON_SPACE  = '/icon-white-space.svg';
const ICON_UNION  = '/fluent_shape-union-20-regular.svg';

const SIDEBAR_BG =
  'rgba(26,26,26,0.2) padding-box, ' +
  'linear-gradient(180deg, #666666 0%, #353535 50%, #666666 100%) border-box';

const ACTIVE_BG =
  'linear-gradient(135.26deg, rgba(51,53,56,0.5) 1.11%, rgba(212,255,0,0.2) 98.89%)';

const TOOLS = [
  { key: 'cursor', icon: ICON_CURSOR, label: '탐색하기' },
  { key: 'group',  icon: ICON_GROUP,  label: '그룹화' },
  { key: 'space',  icon: ICON_SPACE,  label: '공백 탐색' },
  { key: 'union',  icon: ICON_UNION,  label: '결합하기' },
];

/* activeTool / onToolChange 는 Canvas에서 내려받아 lifting state up */
export default function CanvasSidebar({
  activeTool,
  onToolChange,
  showSpacePanel,
  onSpaceClick,
  onCompleteProject,
  completeLoading = false,
}) {
  const [completeHover, setCompleteHover] = useState(false);
  const handleTool = (t) => {
    if (t.key === 'group' || t.key === 'space') {
      onToolChange(t.key);
      return;
    }
    const next = activeTool === t.key ? 'cursor' : t.key;
    onToolChange(next);
  };

  return (
    <aside style={{
      position: 'absolute',
      left: 20, top: 32, bottom: 28,
      width: 80,
      borderRadius: 12,
      background: SIDEBAR_BG,
      border: '1.5px solid transparent',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), 0 12px 36px rgba(0,0,0,0.22)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 0',
      zIndex: 30,
      overflow: 'visible',
    }}>

      {/* 공간 이동 — active bg when space panel is open */}
      <div
        onClick={onSpaceClick}
        style={{
          paddingBottom: 20,
          borderBottom: '1.3px solid #B0B0B0',
          width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          cursor: 'pointer',
          gap: 5,
        }}
      >
        <div style={{
          width: 52, height: 52,
          borderRadius: 6,
          background: showSpacePanel ? ACTIVE_BG : '#2a2a2a',
          border: showSpacePanel ? '1px solid #666' : 'none',
          boxShadow: showSpacePanel ? '0 0 10px rgba(195,238,65,0.2), inset 0 0 0 1px rgba(255,255,255,0.08)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all .18s',
        }}>
          <img src={ICON_LAYERS} alt="layers" style={{ width: 24, height: 24, filter: showSpacePanel ? 'brightness(0) invert(1)' : 'none' }} />
        </div>
      </div>

      {/* 툴 버튼 */}
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', flex: 1 }}>
        {TOOLS.map(t => {
          const isActive = activeTool === t.key;
          return (
            <button
              key={t.key}
              onClick={() => handleTool(t)}
              title={t.label}
              style={{
                width: 60,
                height: isActive ? 60 : 72,
                minHeight: isActive ? 60 : 72,
                borderRadius: 6,
                padding: isActive ? 0 : 8,
                background: isActive ? ACTIVE_BG : 'transparent',
                border: isActive ? '1px solid #666' : 'none',
                boxShadow: isActive ? '0 0 10px rgba(195,238,65,0.2), inset 0 0 0 1px rgba(255,255,255,0.08)' : 'none',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 4,
                opacity: isActive ? 1 : 0.7,
                transition: 'width .18s, height .18s, background .18s, box-shadow .18s, opacity .18s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.opacity = '0.7'; }}
            >
              <img
                src={t.icon}
                alt={t.label}
                style={{
                  width: isActive ? 32 : 28,
                  height: isActive ? 32 : 28,
                  display: 'block',
                  objectFit: 'contain',
                  filter: isActive ? 'brightness(0) invert(1)' : 'none',
                  transition: 'width .18s, height .18s, filter .18s',
                }}
              />
              {!isActive && (
                <span style={{ fontSize: 11, color: '#b0b0b0', letterSpacing: -0.3, whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                  {t.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 프로젝트 완료 */}
      <div style={{ paddingTop: 20, borderTop: '1px solid rgba(67,70,86,0.15)', width: '100%', display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <button
          type="button"
          aria-label={completeLoading ? '프로젝트 완료 처리 중' : '프로젝트 완료'}
          title={completeLoading ? '완료 처리 중...' : '프로젝트 완료'}
          disabled={completeLoading}
          onClick={onCompleteProject}
          onMouseEnter={() => setCompleteHover(true)}
          onMouseLeave={() => setCompleteHover(false)}
          style={{ width: 52, height: 52, borderRadius: 8, background: '#2a2a2a', border: '1px solid #3a3a3a', cursor: completeLoading ? 'wait' : 'pointer', opacity: completeLoading ? 0.45 : completeHover ? 1 : 0.72, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity .18s, box-shadow .18s', boxShadow: completeHover && !completeLoading ? '0 0 14px rgba(203,255,0,.18)' : 'none' }}
        >
          <svg width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 3.5h6.4L18 8.1v12.4H7V3.5Z" stroke="#b0b0b0" strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="M13 3.8V8h4.2M9.4 12.2h5.2M9.4 15.4h5.2" stroke="#b0b0b0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {completeHover && (
          <div style={{ position: 'absolute', left: '50%', bottom: -32, transform: 'translateX(-50%)', background: '#111', color: '#CBFF00', border: '1px solid rgba(203,255,0,.28)', borderRadius: 7, padding: '6px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 12px 28px rgba(0,0,0,.36)' }}>
            {completeLoading ? '완료 처리 중...' : '프로젝트 완료'}
          </div>
        )}
      </div>
    </aside>
  );
}
