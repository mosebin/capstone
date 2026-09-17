import { useEffect, useRef, useState } from 'react';
import IdeaMenu from './ideaMenu';
import StarRating from './starRating';

const formatTag = (tag = '') => (
  String(tag)
    .normalize('NFKD')
    .replace(/[^A-Za-z_\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
);

const RISK_STYLES = {
  none: { label: 'Risk 없음', color: '#777', border: '#333', background: '#242424' },
  low: { label: 'Risk 낮음', color: '#aaa', border: '#454545', background: '#282828' },
  medium: { label: 'Risk 중간', color: '#FFB800', border: 'rgba(255,184,0,.55)', background: 'rgba(255,184,0,.09)' },
  high: { label: 'Risk 높음', color: '#ff7070', border: 'rgba(255,112,112,.78)', background: 'rgba(255,112,112,.12)' },
};

export default function Node({ idea, isSelected, onToggle, onStarsChange, onEdit, onRegenerate, ...cardProps }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const menuRef = useRef(null);
  const selectable = typeof onToggle === 'function';
  const riskLevel = ['none', 'low', 'medium', 'high'].includes(idea.risk?.level) ? idea.risk.level : 'none';
  const riskStyle = RISK_STYLES[riskLevel];
  const riskReasons = (idea.risk?.reasons || []).join('\n') || '식별된 리스크 없음';

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div
      {...cardProps}
      onClick={onToggle}
      style={{
        background: '#1a1a1a',
        borderRadius: 12,
        padding: '20px',
        border: selectable && isSelected ? '2px solid #CBFF00' : '1px solid #2a2a2a',
        borderLeft: selectable && isSelected ? '3px solid #CBFF00' : '3px solid rgba(203,255,0,0.3)',
        cursor: selectable ? 'pointer' : 'default',
        position: 'relative',
        transition: 'opacity .3s, border .2s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <StarRating count={idea.stars || 0} interactive onChange={onStarsChange} />
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 18, lineHeight: 1, padding: '0 4px', borderRadius: 4 }}
            onMouseEnter={e => e.currentTarget.style.color = '#aaa'}
            onMouseLeave={e => e.currentTarget.style.color = '#555'}
          >⋮</button>
          {menuOpen && (
            <IdeaMenu
              idea={idea}
              onClose={() => setMenuOpen(false)}
              onStarsChange={onStarsChange}
              onEdit={onEdit}
              onRegenerate={handleRegenerate}
            />
          )}
        </div>
      </div>

      {regenerating && (
        <div style={{ position: 'absolute', inset: 0, borderRadius: 12, background: 'rgba(26,26,26,0.94)', zIndex: 5, padding: 20, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            <span className="skeleton" style={{ width: 18, height: 18, borderRadius: '50%', display: 'block' }} />
          </div>
          <div className="skeleton" style={{ width: 112, height: 12, borderRadius: 6, marginBottom: 10 }} />
          <div className="skeleton" style={{ width: '74%', height: 22, borderRadius: 8, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: '100%', height: 12, borderRadius: 6, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: '82%', height: 12, borderRadius: 6, marginBottom: 18 }} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
            <span className="skeleton" style={{ width: 58, height: 20, borderRadius: 4, display: 'block' }} />
            <span className="skeleton" style={{ width: 84, height: 20, borderRadius: 4, display: 'block' }} />
          </div>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#CBFF00', padding: '8px 14px', borderRadius: 999, background: 'rgba(17,17,17,0.82)', border: '1px solid rgba(203,255,0,0.24)' }}>재생성 중...</span>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#555', margin: '4px 0 2px', letterSpacing: 1 }}>{formatTag(idea.tag)}</div>
      {riskLevel !== 'none' && (
        <div
          title={riskReasons}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            width: 'fit-content',
            margin: '2px 0 8px',
            padding: '3px 8px',
            borderRadius: 999,
            background: riskStyle.background,
            border: `1px solid ${riskStyle.border}`,
            color: riskStyle.color,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: .2,
          }}
        >
          {riskStyle.label}
        </div>
      )}
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{idea.title}</h3>
      <p style={{ fontSize: 13, color: '#999', lineHeight: 1.6, marginBottom: 12 }}>{idea.desc}</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {idea.keywords.map(k => (
          <span key={k} style={{ background: '#2a2a2a', color: '#888', fontSize: 11, padding: '3px 8px', borderRadius: 4 }}>{k}</span>
        ))}
      </div>
    </div>
  );
}
