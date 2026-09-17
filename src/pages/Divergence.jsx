import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Dropdown } from './NewProject';
import EditModal from '../components/editModal';
import FixedBottomBar from '../components/fixedBottomBar';
import Node from '../components/node';
import NodeSkeleton from '../components/nodeSkeleton';
import { logEvent } from '../lib/eventLogger';
import {
  getProjectContext,
  loadGeneratedIdeas,
  requestGptIdea,
  requestGptIdeaList,
  saveGeneratedIdeas,
  saveGeneratedIdeasLocally,
  shouldRefreshLocalFallbackIdeas,
} from '../lib/gpt';

const SORT_OPTIONS = ['가나다순', '즐겨찾기순'];
const FIXED_IDEA_COUNT = 20;
const MAX_RENDER_SAVE_CHECKS = 10;
const normalizeIdeasForDisplay = (sourceIdeas) => sourceIdeas.map(idea => ({
  ...idea,
  stars: Number(idea.stars) === 1 ? 1 : 0,
  showAiBadge: ['regenerated', 'whitespace'].includes(idea.aiBadgeType),
}));
const normalizeIdeaTag = (idea, index) => {
  if (idea.tag && idea.tag !== 'AI_IDEA') return idea.tag;
  return String(idea.title || `IDEA_${index + 1}`)
    .replace(/[^A-Za-z0-9가-힣]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
    .slice(0, 18) || `IDEA_${index + 1}`;
};
const compactIdeaSignature = (idea) => [
  idea?.title,
  idea?.desc,
  idea?.tag,
  ...(idea?.keywords || []),
].join('|').replace(/\s+/g, '').toLowerCase();
const FORMULAIC_REGENERATION_PATTERN = /재생성하세요|기존\s*설명|기존\s*태그|빠르게\s*검증하는\s*서비스\s*아이디어|아이디어를\s*프로젝트\s*주제에\s*맞게/;
const stripTitleQuotes = value => String(value || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
const isWeakRegeneratedIdea = (generated, originalSignature) => {
  const signature = compactIdeaSignature(generated);
  const text = [generated?.title, generated?.summary, generated?.desc].filter(Boolean).join(' ');
  return !generated?.title
    || !generated?.desc
    || signature === originalSignature
    || FORMULAIC_REGENERATION_PATTERN.test(text);
};

function exportDivergenceExcel(ideas) {
  const rows = ideas.map((idea) => ({
    id: idea.id,
    title: idea.title,
    description: idea.desc || idea.summary,
    tag: idea.tag,
    stars: idea.stars || 0,
    keywords: (idea.keywords || []).join(', '),
    type: idea.showAiBadge ? 'AI 재생성' : '발산',
    risk_level: idea.risk?.level || 'none',
    risk_reasons: (idea.risk?.reasons || []).join(' / '),
    ...Object.fromEntries(
      Object.entries(idea.evaluations || {}).flatMap(([key, value]) => ([
        [`evaluations.${key}.score`, value?.score],
        [`evaluations.${key}.band`, value?.band],
        [`evaluations.${key}.reasoning`, value?.reasoning],
      ])),
    ),
  }));
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  try {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ideas');
    XLSX.writeFile(workbook, `neo-node-divergence-${timestamp}.xlsx`);
    logEvent('divergence_export_excel', { count: rows.length, format: 'xlsx' });
  } catch (error) {
    console.warn('Excel export failed. Falling back to JSON.', error);
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `neo-node-divergence-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    logEvent('divergence_export_excel', { count: rows.length, format: 'json_fallback' });
  }
}

/* ── 페이지 ─────────────────────────────────────────────────────────────── */
export default function Divergence() {
  const [ideas,    setIdeas]    = useState([]);
  const [sort,     setSort]     = useState('가나다순');
  const [editingId,setEditingId]= useState(null);
  const [loading,  setLoading]  = useState(true);
  const [generationError, setGenerationError] = useState('');
  const [regeneratingIds, setRegeneratingIds] = useState(() => new Set());
  const ideaGridRef = useRef(null);
  const lastSavedIdeasSignatureRef = useRef('');
  const navigate = useNavigate();

  const generateFreshIdeas = useCallback(async ({ cancelledRef = null } = {}) => {
    setLoading(true);
    setIdeas([]);
    setGenerationError('');
    try {
      const context = getProjectContext();
      const progressiveIdeas = [];
      const normalizeProgressIdea = (idea, index) => ({
        ...idea,
        id: index + 1,
        tag: normalizeIdeaTag(idea, index),
        aiGenerated: true,
        showAiBadge: false,
        stars: 0,
      });
      const generatedIdeas = await requestGptIdeaList({
        count: FIXED_IDEA_COUNT,
        projectContext: { ...context, ideaCount: FIXED_IDEA_COUNT },
        onProgress: (idea, index) => {
          if (cancelledRef?.current) return;
          const normalized = normalizeProgressIdea(idea, index);
          progressiveIdeas[index] = normalized;
          const visibleIdeas = progressiveIdeas.filter(Boolean);
          setIdeas(visibleIdeas);
          saveGeneratedIdeasLocally(visibleIdeas);
        },
      });
      if (cancelledRef?.current) return;

      const normalizedIdeas = generatedIdeas.map(normalizeProgressIdea);
      setIdeas(normalizedIdeas);
      void saveGeneratedIdeas(normalizedIdeas);
    } catch (error) {
      console.warn('Failed to generate divergence ideas', error);
      if (!cancelledRef?.current) {
        setGenerationError(error?.message || '아이디어 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      if (!cancelledRef?.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };

    const loadIdeas = async () => {
      const savedIdeas = await loadGeneratedIdeas();
      if (cancelledRef.current) return;
      if (savedIdeas.length === FIXED_IDEA_COUNT && !shouldRefreshLocalFallbackIdeas(savedIdeas)) {
        setIdeas(normalizeIdeasForDisplay(savedIdeas));
        setLoading(false);
        return;
      }

      await generateFreshIdeas({ cancelledRef });
    };

    loadIdeas();
    return () => { cancelledRef.current = true; };
  }, [generateFreshIdeas]);

  useEffect(() => {
    if (loading || !ideas.length || regeneratingIds.size) return undefined;

    const ideasSignature = JSON.stringify(ideas);
    if (lastSavedIdeasSignatureRef.current === ideasSignature) return undefined;

    let cancelled = false;
    let frameId = 0;
    let checkCount = 0;

    const saveAfterIdeasRender = () => {
      if (cancelled) return;

      checkCount += 1;
      const renderedIdeaCount = ideaGridRef.current?.querySelectorAll('[data-divergence-idea-node="true"]').length || 0;
      const allIdeasRendered = renderedIdeaCount >= ideas.length;

      if (!allIdeasRendered && checkCount < MAX_RENDER_SAVE_CHECKS) {
        frameId = window.requestAnimationFrame(saveAfterIdeasRender);
        return;
      }

      lastSavedIdeasSignatureRef.current = ideasSignature;
      void saveGeneratedIdeas(ideas);
    };

    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(saveAfterIdeasRender);
    });

    return () => {
      cancelled = true;
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [ideas, loading, regeneratingIds]);

  const updateStars = (id, stars) => setIdeas(prev => prev.map(i => i.id === id ? { ...i, stars: stars ? 1 : 0 } : i));
  const updateIdea  = (id, title, desc) => setIdeas(prev => prev.map(i => i.id === id ? { ...i, title, desc } : i));
  const regenerateIdea = async (idea) => {
    logEvent('node_regenerate', { idea_id: idea.id });
    setRegeneratingIds(prev => new Set([...prev, idea.id]));
    const originalSignature = compactIdeaSignature(idea);
    const buildRegenerateText = (attempt) => [
      `교체 대상 아이디어: ${idea.title}`,
      `설명: ${idea.desc}`,
      `키워드: ${[idea.tag, ...(idea.keywords || [])].filter(Boolean).join(', ')}`,
      '위 아이디어를 더 구체적이고 차별적인 완전히 새로운 서비스 기획으로 대체하세요.',
      '제목에 따옴표를 쓰지 말고, 기존 제목/설명 문장을 재사용하지 마세요.',
      attempt > 0 ? '직전 결과가 기존 아이디어와 비슷하거나 형식적이었습니다. 사용자 상황과 핵심 기능을 완전히 다른 방향으로 다시 만드세요.' : '',
    ].filter(Boolean).join('\n');

    try {
      let generated = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        generated = await requestGptIdea({
          text: buildRegenerateText(attempt),
          sourceIdeas: [idea],
          mode: 'regenerate',
          projectContext: getProjectContext(),
          temperature: 0.95,
          bypassCircuit: true,
        });
        if (!isWeakRegeneratedIdea(generated, originalSignature)) break;
      }

      const title = stripTitleQuotes(generated.title);
      const desc = String(generated.desc || generated.summary || '').trim();
      setIdeas(prev => prev.map(item => item.id === idea.id ? {
        ...item,
        ...generated,
        id: item.id,
        title: title || item.title,
        desc: desc || item.desc,
        tag: generated.tag || normalizeIdeaTag(generated, idea.id),
        keywords: Array.isArray(generated.keywords) && generated.keywords.length ? generated.keywords : item.keywords,
        stars: item.stars ? 1 : 0,
        aiGenerated: true,
        showAiBadge: true,
        aiBadgeType: 'regenerated',
      } : item));
    } finally {
      setRegeneratingIds(prev => {
        const next = new Set(prev);
        next.delete(idea.id);
        return next;
      });
    }
  };

  const goAxis = () => {
    saveGeneratedIdeas(ideas);
    navigate('/axis-modal');
  };

  const sorted = [...ideas].sort((a, b) => {
    if (sort === '즐겨찾기순') return (b.stars || 0) - (a.stars || 0);
    if (sort === '가나다순') return a.title.localeCompare(b.title);
    return a.id - b.id;
  });

  const editingIdea = ideas.find(i => i.id === editingId);

  return (
    <div className="dot-bg" style={{ minHeight: 'calc(100vh - 100px)', width: '100%', padding: '40px 120px 120px' }}>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 12, letterSpacing: 1 }}>
        <span style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>MY PROJECTS</span>
        <span style={{ color: '#CBFF00', marginLeft: 8 }}>&gt; NEW PROJECTS</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 36, fontWeight: 700, marginBottom: 8, letterSpacing: -0.9 }}>Which one do you like?</h1>
          <p style={{ color: '#b0b0b0', fontSize: 14, lineHeight: 1.8 }}>
            입력한 기준에 따라 {FIXED_IDEA_COUNT}개의 아이디어가 생성됩니다.<br />
            마음에 드는 아이디어를 고르고, 마음껏 편집하세요.
          </p>
          {generationError && (
            <p style={{ color: '#ff8a8a', fontSize: 13, fontWeight: 700, margin: '10px 0 0' }}>
              {generationError}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 140 }}>
            <Dropdown value={sort} options={SORT_OPTIONS} onChange={setSort} />
          </div>
          <button
            type="button"
            onClick={() => exportDivergenceExcel(sorted)}
            style={{
              padding: '12px 18px', borderRadius: 10,
              background: '#CBFF00', color: '#111', border: 'none',
              cursor: 'pointer', fontWeight: 700, fontSize: 13,
            }}
          >엑셀로 다운로드</button>
        </div>
      </div>

      <div ref={ideaGridRef} style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 20,
        alignItems: 'stretch',
      }}>
        {sorted.map(idea => (
          regeneratingIds.has(idea.id) ? (
            <NodeSkeleton key={idea.id} data-divergence-idea-node="true" />
          ) : (
            <Node
              key={idea.id}
              data-divergence-idea-node="true"
              idea={idea}
              isSelected={false}
              onStarsChange={(stars) => updateStars(idea.id, stars)}
              onEdit={() => setEditingId(idea.id)}
              onRegenerate={() => regenerateIdea(idea)}
            />
          )
        ))}
        {loading && Array.from({ length: Math.max(0, FIXED_IDEA_COUNT - ideas.length) }).map((_, index) => (
          <NodeSkeleton key={`skeleton-${index}`} />
        ))}
      </div>

      <FixedBottomBar loading={loading} onNext={goAxis} />

      {/* 편집 모달 */}
      {editingIdea && (
        <EditModal
          idea={editingIdea}
          onSave={(title, desc) => { updateIdea(editingIdea.id, title, desc); setEditingId(null); }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
