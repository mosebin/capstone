export default function NodeSkeleton({ style, ...props }) {
  return (
    <div {...props} style={{
      background: '#1a1a1a',
      borderRadius: 12,
      padding: 20,
      border: '1px solid #2a2a2a',
      borderLeft: '3px solid rgba(203,255,0,0.18)',
      minHeight: 178,
      ...style,
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        <span className="skeleton" style={{ width: 18, height: 18, borderRadius: '50%', display: 'block' }} />
      </div>
      <div className="skeleton" style={{ width: 110, height: 12, borderRadius: 6, marginBottom: 10 }} />
      <div className="skeleton" style={{ width: '72%', height: 22, borderRadius: 8, marginBottom: 12 }} />
      <div className="skeleton" style={{ width: '100%', height: 12, borderRadius: 6, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: '86%', height: 12, borderRadius: 6, marginBottom: 18 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="skeleton" style={{ width: 56, height: 20, borderRadius: 4, display: 'block' }} />
        <span className="skeleton" style={{ width: 84, height: 20, borderRadius: 4, display: 'block' }} />
      </div>
    </div>
  );
}
