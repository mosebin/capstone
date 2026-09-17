import Icon from './Icon';

function MenuButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '10px 14px',
        background: 'none',
        border: 'none',
        textAlign: 'left',
        fontSize: 13,
        color: '#ccc',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#2a2a2a'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      {children}
    </button>
  );
}

export default function IdeaMenu({ onClose, onEdit, onRegenerate }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 36,
        right: 0,
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 10,
        padding: '6px 0',
        zIndex: 50,
        minWidth: 180,
        boxShadow: '0 8px 24px rgba(0,0,0,.5)',
      }}
    >
      <MenuButton onClick={() => { onEdit(); onClose(); }}>
        <Icon name="edit" size={16} />
        내용 수정
      </MenuButton>

      <MenuButton onClick={() => { onRegenerate(); onClose(); }}>
        <Icon name="autorenew" size={16} />
        재생성하기
      </MenuButton>
    </div>
  );
}
