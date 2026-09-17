import { useState } from 'react';
import Icon from './Icon';

export default function ProjectCard({ project, onClick, isNew = false }) {
  const [hover, setHover] = useState(false);

  if (isNew) {
    return (
      <div
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          borderRadius: 12,
          width: 300,
          height: 200,
          background: '#1a1a1a',
          border: `1px solid ${hover ? '#CBFF00' : '#666'}`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: 'pointer', transition: 'border .2s',
        }}
      >
        <Icon name="add" size={40} color={hover ? '#CBFF00' : '#b0b0b0'} />
        <div style={{ fontSize: 14, color: hover ? '#CBFF00' : '#b0b0b0', transition: 'color .2s' }}>New Project</div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 12,
        overflow: 'hidden',
        background: '#1a1a1a',
        cursor: 'pointer',
        position: 'relative',
        width: 300,
        height: 200,
        transition: 'box-shadow .2s',
        boxShadow: hover ? '0 0 0 1.5px #CBFF00' : '0 0 0 1px #2a2a2a',
      }}
    >
      <img
        src={project.img}
        alt={project.title}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%', objectFit: 'cover',
          transition: 'transform .35s ease',
          transform: hover ? 'scale(1.04)' : 'scale(1)',
        }}
      />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        transition: 'opacity .3s',
        opacity: hover ? 0.2 : 0.75,
      }} />

      <div style={{
        position: 'absolute', top: 12, left: 16,
        fontSize: 12, color: '#b0b0b0',
        transition: 'opacity .3s', opacity: hover ? 0 : 1,
      }}>{project.category}</div>

      <button style={{
        position: 'absolute', top: 8, right: 10,
        color: '#aaa', fontSize: 18, background: 'none', border: 'none', zIndex: 2,
      }}>⋮</button>

      <div style={{
        position: 'absolute', left: 0, right: 0,
        bottom: hover ? 0 : -72,
        height: 72,
        background: '#fff',
        borderRadius: '0 0 12px 12px',
        padding: '12px 16px',
        transition: 'bottom .28s ease',
        zIndex: 3,
      }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#111', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {project.title}
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>{project.date}</div>
      </div>

      <div style={{
        position: 'absolute', bottom: 16, left: 16,
        transition: 'opacity .2s',
        opacity: hover ? 0 : 1,
        zIndex: 2,
      }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#fff', marginBottom: 4 }}>{project.title}</div>
        <div style={{ fontSize: 12, color: '#b0b0b0' }}>{project.date}</div>
      </div>
    </div>
  );
}
