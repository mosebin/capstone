import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestGptKeywords, resetNewProjectDraft, saveProjectContext } from '../lib/gpt';
import { getTeamId } from '../lib/eventLogger';

const DOMAINS = ['Service Design', 'UX/UI & Product', 'Brand & Identity', 'Game Design', 'Space Design'];
const KEYWORD_COUNT = 10;
const FIXED_IDEA_COUNT = 20;

const SUGGEST_IDEAS = [
  '지속가능한 라이프스타일', 'AI 기반 개인화', '로컬 커뮤니티 연결',
  '디지털 헬스케어', '감성 기록 서비스', '도시 재생 플랫폼',
  '비대면 학습 경험', '크리에이터 경제', '노인 복지 기술', '제로웨이스트 소비',
];

const SkeletonChip = ({ width = 120 }) => (
  <span
    className="skeleton"
    style={{
      width,
      height: 31,
      borderRadius: 999,
      display: 'inline-block',
    }}
  />
);

/* ── Shared dropdown component ────────────────────────────────────────────── */
export function Dropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '12px 16px',
          background: '#2a2a2a', borderRadius: 8,
          color: '#fff', fontSize: 14, textAlign: 'left',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          border: `1px solid ${open ? '#CBFF00' : '#3a3a3a'}`,
          cursor: 'pointer', transition: 'border .15s',
        }}
      >
        <span>{value}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <path d="M4 6l4 4 4-4" stroke="#b0b0b0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: '#2a2a2a', borderRadius: 8, border: '1px solid #3a3a3a',
          zIndex: 20, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.5)',
        }}>
          {options.map(opt => (
            <div
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                padding: '10px 16px', fontSize: 14, cursor: 'pointer',
                color: opt === value ? '#CBFF00' : '#ccc',
                background: opt === value ? 'rgba(203,255,0,.08)' : 'transparent',
                transition: 'background .12s',
              }}
              onMouseEnter={e => { if (opt !== value) e.currentTarget.style.background = '#333'; }}
              onMouseLeave={e => { if (opt !== value) e.currentTarget.style.background = 'transparent'; }}
            >{opt}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function NewProject() {
  const [savedProject] = useState(() => {
    resetNewProjectDraft();
    return {};
  });
  const [projectId] = useState(() => {
    if (savedProject.projectId) return savedProject.projectId;
    const fallbackId = Math.random().toString(36).slice(2, 10);
    return `project-${Date.now()}-${fallbackId}`;
  });
  const [idea, setIdea]           = useState(savedProject.idea || '');
  const [domain, setDomain]       = useState(savedProject.domain || 'Service Design');
  const [selectedIdeas, setSelectedIdeas] = useState(Array.isArray(savedProject.selectedIdeas) ? savedProject.selectedIdeas : []);
  const [suggestIdeas, setSuggestIdeas] = useState(() => [
    ...new Set([...(savedProject.selectedIdeas || []), ...SUGGEST_IDEAS]),
  ]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles]         = useState(Array.isArray(savedProject.files) ? savedProject.files : []);
  const selectedIdeasRef = useRef(selectedIdeas);

  useEffect(() => {
    selectedIdeasRef.current = selectedIdeas;
  }, [selectedIdeas]);

  const toggleIdea = (tag) =>
    setSelectedIdeas(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  const [dragging, setDragging] = useState(false);
  const navigate = useNavigate();

  const addFiles = newFiles =>
    setFiles(prev => [...prev, ...newFiles.map(f => ({ name: f.name, size: `${Math.round((f.size || 1) / 1024 / 1024) || 1}MB` }))]);

  const removeFile = idx => setFiles(prev => prev.filter((_, i) => i !== idx));

  const handleIdeaChange = (e) => {
    const nextIdea = e.target.value;
    setIdea(nextIdea);
    if (!nextIdea.trim()) {
      setSuggestIdeas(SUGGEST_IDEAS);
      setSelectedIdeas(prev => prev.filter(tag => SUGGEST_IDEAS.includes(tag)));
      setKeywordsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const text = idea.trim();

    if (!text) {
      return () => { cancelled = true; };
    }

    const timer = setTimeout(async () => {
      setKeywordsLoading(true);
      setSuggestIdeas(selectedIdeasRef.current);
      try {
        const keywords = await requestGptKeywords({ text, domain });
        if (cancelled) return;
        setSuggestIdeas([
          ...new Set([...selectedIdeasRef.current, ...keywords]),
        ].slice(0, KEYWORD_COUNT + selectedIdeasRef.current.length));
      } catch (error) {
        if (!cancelled) {
          console.error('AI 추천 아이디어 생성 실패', error);
          setSuggestIdeas(selectedIdeasRef.current);
        }
      } finally {
        if (!cancelled) setKeywordsLoading(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [idea, domain]);

  const projectContext = useMemo(() => {
    return {
      ...savedProject,
      projectId,
      teamId: savedProject.teamId || getTeamId(),
      idea,
      domain,
      selectedIdeas,
      files,
      divergenceMode: 'fixed',
      divergenceModeLabel: '20개 고정',
      ideaCount: FIXED_IDEA_COUNT,
    };
  }, [savedProject, projectId, idea, domain, selectedIdeas, files]);

  useEffect(() => {
    const hasDraftContent = idea.trim() || selectedIdeas.length || files.length;
    if (!hasDraftContent) return undefined;
    const timer = setTimeout(() => {
      saveProjectContext({ ...projectContext, updatedAt: new Date().toISOString() });
    }, 150);
    return () => clearTimeout(timer);
  }, [files.length, idea, projectContext, selectedIdeas.length]);

  const goNext = () => {
    saveProjectContext({
      ...projectContext,
      divergenceMode: 'fixed',
      divergenceModeLabel: '20개 고정',
      ideaCount: FIXED_IDEA_COUNT,
      updatedAt: new Date().toISOString(),
    });
    setSubmitting(true);
    navigate('/divergence');
  };

  return (
    <div className="dot-bg" style={{ minHeight: 'calc(100vh - 100px)', width: '100%', padding: '40px 120px' }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: '#555', marginBottom: 12, letterSpacing: 1 }}>
        <span style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>MY PROJECTS</span>
        <span style={{ color: '#CBFF00', marginLeft: 8 }}>&gt; NEW PROJECTS</span>
      </div>

      <h1 style={{ fontSize: 36, fontWeight: 700, marginBottom: 8, letterSpacing: -0.9 }}>What will you create today?</h1>
      <p style={{ color: '#b0b0b0', fontSize: 14, lineHeight: 1.8, marginBottom: 32 }}>
        당신의 영감을 자유롭게 기술해주세요.<br />
        네오 노드가 당신의 창의적이고 체계적인 발상을 지원합니다.
      </p>

      {/* Idea textarea */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid #2a2a2a', position: 'relative' }}>
        <textarea
          value={idea}
          onChange={handleIdeaChange}
          placeholder="아이디어를 자유롭게 입력하세요..."
          style={{ width: '100%', minHeight: 120, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 15, resize: 'none', lineHeight: 1.6 }}
        />
      </div>

      {/* Domain + Persona row */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 1, background: '#1e1e1e', borderRadius: 12, padding: 24, border: '1px solid #2a2a2a' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#888', marginBottom: 16 }}>DESIGN DOMAIN</div>
          <Dropdown value={domain} options={DOMAINS} onChange={setDomain} />
        </div>

        <div style={{ flex: 1, background: '#1e1e1e', borderRadius: 12, padding: 24, border: '1px solid #2a2a2a' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#888', marginBottom: 16 }}>RECOMMEND IDEAS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {suggestIdeas.map((tag, index) => {
              const active = selectedIdeas.includes(tag);
              return (
                <button
                  key={`${tag}-${index}`}
                  onClick={() => toggleIdea(tag)}
                  style={{
                    padding: '6px 14px', borderRadius: 999, fontSize: 13,
                    background: active ? 'rgba(203,255,0,0.12)' : '#2a2a2a',
                    color: active ? '#CBFF00' : '#b0b0b0',
                    border: `1px solid ${active ? '#CBFF00' : '#3a3a3a'}`,
                    cursor: 'pointer', transition: 'all .15s',
                  }}
                >{tag}</button>
              );
            })}
            {keywordsLoading && [116, 138, 124, 152, 108, 132, 146, 118, 136, 126]
              .slice(suggestIdeas.length)
              .map((width, index) => (
                <SkeletonChip key={`keyword-skeleton-${index}`} width={width} />
              ))}
          </div>
        </div>
      </div>

      {/* Reference */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, padding: 24, marginBottom: 32, border: '1px solid #2a2a2a' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#888', marginBottom: 16 }}>REFERENCE</div>

        {/* If no files: drop zone fills full width; if files: side-by-side */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
          {/* Drop zone — full width when no files, 50% when files exist */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
            onClick={() => document.getElementById('file-input').click()}
            style={{
              flex: 1,
              minHeight: 120,
              border: `2px dashed ${dragging ? '#CBFF00' : '#444'}`,
              borderRadius: 10, padding: '28px 20px',
              textAlign: 'center', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'border .2s',
            }}
          >
            <input id="file-input" type="file" multiple style={{ display: 'none' }}
              onChange={e => addFiles(Array.from(e.target.files))} />
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <div style={{ color: '#aaa', fontSize: 14 }}>Drop file here or browse</div>
            <div style={{ color: '#555', fontSize: 12 }}>PDF, JPG, PNG up to 1GB</div>
          </div>

          {/* File list — 50% when files exist */}
          {files.length > 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center', minHeight: 120 }}>
              {files.map((f, i) => (
                <div key={i} style={{
                  background: '#2a2a2a', borderRadius: 8, padding: '12px 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  border: '1px solid #333',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="#CBFF00" strokeWidth="1.5" strokeLinejoin="round"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="#CBFF00" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    <span style={{ fontSize: 13, color: '#ddd' }}>{f.name}</span>
                    <span style={{ fontSize: 11, color: '#555' }}>{f.size}</span>
                  </div>
                  <button onClick={() => removeFile(i)} style={{ color: '#555', fontSize: 16, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <button
          onClick={goNext}
          disabled={submitting}
          style={{
            background: submitting ? '#6f7f24' : '#CBFF00', color: '#111', fontWeight: 700, fontSize: 16,
            padding: '16px 64px', borderRadius: 50, border: 'none', cursor: 'pointer',
            minWidth: 170,
          }}
          onMouseEnter={e => { if (!submitting) e.target.style.background = '#b8e600'; }}
          onMouseLeave={e => { if (!submitting) e.target.style.background = '#CBFF00'; }}
        >다음으로</button>
      </div>
    </div>
  );
}
