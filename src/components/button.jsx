export default function Button({ children, disabled = false, onClick, variant = 'primary', style = {} }) {
  const isPrimary = variant === 'primary';
  const baseBackground = disabled ? '#6f7f24' : isPrimary ? '#CBFF00' : '#2a2a2a';
  const hoverBackground = isPrimary ? '#b8e600' : '#343434';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: baseBackground,
        color: isPrimary ? '#111' : '#f2f2f2',
        fontWeight: 700,
        fontSize: 16,
        padding: '16px 64px',
        borderRadius: '12px',
        border: isPrimary ? 'none' : '1px solid #3a3a3a',
        cursor: disabled ? 'default' : 'pointer',
        minWidth: 170,
        pointerEvents: 'auto',
        boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
        ...style,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = hoverBackground; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = baseBackground; }}
    >
      {children}
    </button>
  );
}
