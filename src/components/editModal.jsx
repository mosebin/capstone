import { useState } from 'react';
import { logEvent } from '../lib/eventLogger';

export default function EditModal({ idea, onSave, onClose }) {
  const [title, setTitle] = useState(idea.title);
  const [desc, setDesc] = useState(idea.desc);
  const inputBase = {
    width: '100%',
    background: '#2a2a2a',
    border: '1px solid #3a3a3a',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    padding: '10px 14px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a1a', borderRadius: 16, padding: 28, width: 460, border: '1px solid #333' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>내용 수정</div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>제목</div>
          <input value={title} onChange={e => setTitle(e.target.value)} style={inputBase} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>설명</div>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} style={{ ...inputBase, resize: 'none', lineHeight: 1.6 }} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 10, background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#b0b0b0', fontSize: 14, cursor: 'pointer' }}>취소</button>
          <button onClick={() => { logEvent('node_edit', { idea_id: idea.id }); onSave(title, desc); }} style={{ flex: 2, padding: '11px', borderRadius: 10, background: '#CBFF00', color: '#111', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer' }}>저장</button>
        </div>
      </div>
    </div>
  );
}
