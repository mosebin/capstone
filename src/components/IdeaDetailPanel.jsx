import { useEffect, useRef, useState } from 'react';
import { getProjectContext, requestGptDetailItem } from '../lib/gpt';
import { readIdeaDetailCache, writeIdeaDetailCache } from '../lib/ideaDetailCache';

const DETAIL_PANEL_MIN_WIDTH = 320;
const DETAIL_PANEL_MAX_WIDTH = 640;

const glass = (alpha = 0.2, blur = 12) => ({
  background:
    `rgba(26,26,26,${alpha}) padding-box, ` +
    'linear-gradient(180deg, #666666 0%, #353535 50%, #666666 100%) border-box',
  border: '1.5px solid transparent',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
  backdropFilter: `blur(${blur}px)`,
  WebkitBackdropFilter: `blur(${blur}px)`,
});

function StarToggle({ active, onToggle, size = 17 }) {
  return (
    <button
      type="button"
      title={active ? '즐겨찾기 해제' : '즐겨찾기'}
      onClick={onToggle}
      style={{
        width: size + 12,
        height: size + 12,
        borderRadius: 8,
        border: `1px solid ${active ? 'rgba(203,255,0,.5)' : '#333'}`,
        background: active ? 'rgba(203,255,0,.12)' : '#1f1f1f',
        color: active ? '#CBFF00' : '#555',
        fontSize: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      ★
    </button>
  );
}

const toConciseLine = (item) => {
  const raw = typeof item === 'string' ? item : `${item?.name || ''} ${item?.desc || ''}`;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  return normalized.length > 42 ? `${normalized.slice(0, 42).replace(/[,.!?;:\s]+$/, '')}…` : normalized;
};

const conciseList = (items, limit = 3) => (items || []).slice(0, limit).map(toConciseLine).filter(Boolean);

const normalizeDetail = (idea, detail = {}) => {
  const keepEditableLists = detail.detailSource === 'user_editable';
  return {
    description: detail.description || idea.desc,
    pros: conciseList(keepEditableLists ? detail.pros : [], 8),
    cons: conciseList(keepEditableLists ? detail.cons : [], 8),
    features: conciseList(keepEditableLists ? detail.features : [], 8),
    goals: conciseList(keepEditableLists ? detail.goals : [], 8),
    detailSource: 'user_editable',
  };
};

const getInitialDetail = idea => normalizeDetail(idea, readIdeaDetailCache(getProjectContext(), idea) || undefined);

function InlineInput({ placeholder, initialValue = '', onSave, onCancel }) {
  const [text, setText] = useState(initialValue);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(text); if (e.key === 'Escape') onCancel(); }}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, background: '#2a2a2a', border: '1px solid #CBFF00', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
      />
      <button onClick={() => onSave(text)} style={{ background: '#CBFF00', color: '#111', border: 'none', borderRadius: 6, padding: '8px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>✓</button>
      <button onClick={onCancel} style={{ background: '#2a2a2a', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '8px 10px', cursor: 'pointer', fontSize: 14 }}>✕</button>
    </div>
  );
}

function DetailItemMenu({ value, icon, active, onToggle, onEdit, onDelete, tone = 'feature' }) {
  const menuRef = useRef(null);
  const accent = tone === 'pro' ? '#79d986' : tone === 'con' ? '#ff8c8c' : '#CBFF00';
  const textColor = tone === 'pro' ? '#bfe8c4' : tone === 'con' ? '#e8bcbc' : tone === 'goal' ? '#ccc' : '#fff';
  const isCompact = ['goal', 'pro', 'con'].includes(tone);

  useEffect(() => {
    if (!active) return undefined;
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) onToggle(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [active, onToggle]);

  return (
    <div
      style={{
        minWidth: 0,
        background: '#1e1e1e',
        borderRadius: 10,
        padding: '10px 10px 10px 14px',
        fontSize: isCompact ? 12 : 13,
        color: textColor,
        lineHeight: tone === 'goal' ? 1.6 : 1.45,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        borderTop: '1px solid #2a2a2a',
        borderRight: '1px solid #2a2a2a',
        borderBottom: '1px solid #2a2a2a',
        borderLeft: isCompact ? `3px solid ${accent}` : '1px solid #2a2a2a',
        overflowWrap: 'anywhere',
        wordBreak: 'keep-all',
      }}
    >
      <span style={{ color: accent, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{value}</span>
      <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          type="button"
          aria-label="항목 메뉴"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(!active);
          }}
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            border: '1px solid transparent',
            background: active ? '#2c2c2c' : 'transparent',
            color: active ? '#CBFF00' : '#777',
            cursor: 'pointer',
            lineHeight: 1,
            fontSize: 17,
          }}
        >
          ⋮
        </button>
        {active && (
          <div
            style={{
              position: 'absolute',
              top: 28,
              right: 0,
              zIndex: 30,
              minWidth: 92,
              padding: 6,
              borderRadius: 10,
              background: '#252525',
              border: '1px solid #3a3a3a',
              boxShadow: '0 14px 34px rgba(0,0,0,0.42)',
            }}
          >
            <button type="button" onClick={onEdit} style={{ width: '100%', padding: '8px 9px', border: 'none', borderRadius: 7, background: 'transparent', color: '#ddd', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}>수정</button>
            <button type="button" onClick={onDelete} style={{ width: '100%', padding: '8px 9px', border: 'none', borderRadius: 7, background: 'transparent', color: '#ff8585', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}>삭제</button>
          </div>
        )}
      </div>
    </div>
  );
}

const clampPanelWidth = (value) => {
  const viewportMax = typeof window === 'undefined'
    ? DETAIL_PANEL_MAX_WIDTH
    : Math.max(DETAIL_PANEL_MIN_WIDTH, Math.min(DETAIL_PANEL_MAX_WIDTH, window.innerWidth - 360));
  return Math.round(Math.min(Math.max(value, DETAIL_PANEL_MIN_WIDTH), viewportMax));
};

function SkeletonLine({ width = '100%', height = 12, radius = 7 }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, flexShrink: 0 }} />;
}

function DetailPanelSkeleton() {
  return (
    <div
      aria-label="상세 정보 불러오는 중"
      aria-busy="true"
      style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20, boxSizing: 'border-box' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <SkeletonLine width={44} height={11} />
        <SkeletonLine />
        <SkeletonLine width="82%" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SkeletonLine width={78} height={11} />
        <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
          {[0, 1].map(column => (
            <div key={column} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[0, 1, 2].map(row => <SkeletonLine key={row} height={38} radius={8} />)}
            </div>
          ))}
        </div>
      </div>

      {[0, 1].map(section => (
        <div key={section} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonLine width={section === 0 ? 96 : 68} height={11} />
          {[0, 1, 2].map(row => <SkeletonLine key={row} height={40} radius={8} />)}
        </div>
      ))}
    </div>
  );
}

export default function IdeaDetailPanel({ idea, onExpand, width = 400, onWidthChange, onToggleStar, onIdeaUpdate }) {
  const [detail, setDetail] = useState(() => getInitialDetail(idea));
  const [loading] = useState(false);
  const [pros, setPros] = useState(() => getInitialDetail(idea).pros);
  const [cons, setCons] = useState(() => getInitialDetail(idea).cons);
  const [features, setFeatures] = useState(() => getInitialDetail(idea).features);
  const [goals, setGoals] = useState(() => getInitialDetail(idea).goals);
  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);
  const [generatingList, setGeneratingList] = useState(null);
  const [generationError, setGenerationError] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);

  const commitDetailPatch = (patch) => {
    const next = normalizeDetail(idea, {
      ...detail,
      pros,
      cons,
      features,
      goals,
      ...patch,
    });
    setDetail(next);
    writeIdeaDetailCache(getProjectContext(), idea, { ...next, detailSource: 'user_editable' });
    onIdeaUpdate?.({
      desc: next.description,
      description: next.description,
      pros: next.pros,
      cons: next.cons,
      features: next.features,
      goals: next.goals,
    });
    return next;
  };
  const updateProCon = (type, nextItems) => {
    const field = type === 'pro' ? 'pros' : 'cons';
    if (type === 'pro') setPros(nextItems);
    else setCons(nextItems);
    commitDetailPatch({ [field]: nextItems });
  };
  const saveDescription = (text) => {
    const description = String(text || '').replace(/\s+/g, ' ').trim();
    if (description) commitDetailPatch({ description });
    setEditingDescription(false);
  };
  const saveProCon = (type, text) => {
    const line = toConciseLine(text);
    if (line) {
      const currentItems = type === 'pro' ? pros : cons;
      const nextItems = editing?.type === type
        ? currentItems.map((item, index) => index === editing.index ? line : item)
        : [...currentItems, line];
      updateProCon(type, nextItems);
    }
    setAdding(null);
    setEditing(null);
    setActiveMenu(null);
  };
  const deleteProCon = (type, indexToDelete) => {
    const currentItems = type === 'pro' ? pros : cons;
    updateProCon(type, currentItems.filter((_, index) => index !== indexToDelete));
    setActiveMenu(null);
  };
  const generateProCon = async (type) => {
    if (generatingList) return;
    setGenerationError('');
    setGeneratingList(type);
    try {
      const currentItems = type === 'pro' ? pros : cons;
      const nextLine = await requestGptDetailItem({
        type,
        idea: {
          ...idea,
          desc: detail.description,
          pros,
          cons,
          features,
          goals,
        },
        existingItems: currentItems,
        projectContext: getProjectContext(),
      });
      updateProCon(type, [...currentItems, nextLine]);
      setAdding(null);
      setEditing(null);
      setActiveMenu(null);
    } catch (error) {
      setGenerationError(error.message || 'AI 생성에 실패했습니다.');
    } finally {
      setGeneratingList(null);
    }
  };
  const generateFeatureGoal = async (type) => {
    if (generatingList) return;
    setGenerationError('');
    setGeneratingList(type);
    try {
      const currentItems = type === 'feature' ? features : goals;
      const nextLine = await requestGptDetailItem({
        type,
        idea: {
          ...idea,
          desc: detail.description,
          pros,
          cons,
          features,
          goals,
        },
        existingItems: currentItems,
        projectContext: getProjectContext(),
      });
      if (type === 'feature') {
        const nextFeatures = [...features, nextLine];
        setFeatures(nextFeatures);
        commitDetailPatch({ features: nextFeatures });
      } else {
        const nextGoals = [...goals, nextLine];
        setGoals(nextGoals);
        commitDetailPatch({ goals: nextGoals });
      }
      setAdding(null);
      setEditing(null);
      setActiveMenu(null);
    } catch (error) {
      setGenerationError(error.message || 'AI 생성에 실패했습니다.');
    } finally {
      setGeneratingList(null);
    }
  };
  const saveFeature = (text) => {
    const line = toConciseLine(text);
    if (line) {
      const nextFeatures = editing?.type === 'feature'
        ? features.map((item, index) => index === editing.index ? line : item)
        : [...features, line];
      setFeatures(nextFeatures);
      commitDetailPatch({ features: nextFeatures });
    }
    setAdding(null);
    setEditing(null);
    setActiveMenu(null);
  };
  const saveGoal = (text) => {
    const line = toConciseLine(text);
    if (line) {
      const nextGoals = editing?.type === 'goal'
        ? goals.map((item, index) => index === editing.index ? line : item)
        : [...goals, line];
      setGoals(nextGoals);
      commitDetailPatch({ goals: nextGoals });
    }
    setAdding(null);
    setEditing(null);
    setActiveMenu(null);
  };
  const deleteFeature = (indexToDelete) => {
    const nextFeatures = features.filter((_, index) => index !== indexToDelete);
    setFeatures(nextFeatures);
    commitDetailPatch({ features: nextFeatures });
    setActiveMenu(null);
  };
  const deleteGoal = (indexToDelete) => {
    const nextGoals = goals.filter((_, index) => index !== indexToDelete);
    setGoals(nextGoals);
    commitDetailPatch({ goals: nextGoals });
    setActiveMenu(null);
  };
  const handleResizePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event) => {
      onWidthChange?.(clampPanelWidth(startWidth + startX - event.clientX));
    };
    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  return (
    <div style={{ width: clampPanelWidth(width), minWidth: DETAIL_PANEL_MIN_WIDTH, maxWidth: DETAIL_PANEL_MAX_WIDTH, flexShrink: 0, position: 'relative', marginTop: 12, ...glass(0.88, 20), borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', animation: 'detailPanelIn .24s ease-out both' }}>
      <div
        data-overlay="true"
        onPointerDown={handleResizePointerDown}
        title="상세 패널 너비 조절"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 10,
          cursor: 'col-resize',
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'none',
        }}
      >
        <span style={{ width: 2, height: 52, borderRadius: 999, background: 'rgba(203,255,0,0.34)' }} />
      </div>
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: '#CBFF00', letterSpacing: 2, marginBottom: 6 }}>{idea.tag}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 6, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{idea.title}</div>
        <StarToggle active={Number(idea.stars) > 0} onToggle={() => onToggleStar?.()} size={17} />
      </div>

      {loading ? <DetailPanelSkeleton /> : <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20, boxSizing: 'border-box' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#CBFF00' }}>설명</div>
            <button
              type="button"
              aria-label="설명 수정"
              title="설명 수정"
              onClick={() => setEditingDescription(true)}
              style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #333', background: '#242424', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
            >
              ✎
            </button>
          </div>
          {editingDescription ? (
            <InlineInput
              initialValue={detail.description}
              placeholder="설명을 입력하세요..."
              onSave={saveDescription}
              onCancel={() => setEditingDescription(false)}
            />
          ) : (
            <p style={{ fontSize: 13, color: '#ccc', lineHeight: 1.8, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{detail.description}</p>
          )}
        </div>

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#79d986' }}>장점</div>
              </div>
              {pros.map((p, i) => (
                editing?.type === 'pro' && editing.index === i ? (
                  <InlineInput
                    key={`pro-edit-${i}`}
                    initialValue={p}
                    placeholder="장점을 입력하세요..."
                    onSave={text => saveProCon('pro', text)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <DetailItemMenu
                    key={`${p}-${i}`}
                    value={p}
                    icon="+"
                    tone="pro"
                    active={activeMenu === `pro-${i}`}
                    onToggle={open => setActiveMenu(open ? `pro-${i}` : null)}
                    onEdit={() => { setEditing({ type: 'pro', index: i }); setActiveMenu(null); }}
                    onDelete={() => deleteProCon('pro', i)}
                  />
                )
              ))}
              {adding === 'pro' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <InlineInput placeholder="장점을 입력하세요..." onSave={text => saveProCon('pro', text)} onCancel={() => setAdding(null)} />
                  <button type="button" onClick={() => generateProCon('pro')} disabled={generatingList === 'pro'} style={{ background: '#202620', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#bfe8c4', border: '1px solid rgba(121,217,134,.28)', cursor: generatingList === 'pro' ? 'wait' : 'pointer', fontWeight: 700 }}>{generatingList === 'pro' ? 'AI 생성 중...' : 'AI로 장점 생성'}</button>
                </div>
              ) : <button type="button" aria-label="장점 추가" onClick={() => { setEditing(null); setAdding('pro'); }} style={{ width: '100%', background: '#1e1e1e', borderRadius: 10, padding: '10px 14px', fontSize: 18, color: '#79d986', border: '1px dashed rgba(121,217,134,.45)', cursor: 'pointer' }}>+</button>}
            </div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#ff8c8c' }}>단점</div>
              </div>
              {cons.map((c, i) => (
                editing?.type === 'con' && editing.index === i ? (
                  <InlineInput
                    key={`con-edit-${i}`}
                    initialValue={c}
                    placeholder="단점을 입력하세요..."
                    onSave={text => saveProCon('con', text)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <DetailItemMenu
                    key={`${c}-${i}`}
                    value={c}
                    icon="-"
                    tone="con"
                    active={activeMenu === `con-${i}`}
                    onToggle={open => setActiveMenu(open ? `con-${i}` : null)}
                    onEdit={() => { setEditing({ type: 'con', index: i }); setActiveMenu(null); }}
                    onDelete={() => deleteProCon('con', i)}
                  />
                )
              ))}
              {adding === 'con' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <InlineInput placeholder="단점을 입력하세요..." onSave={text => saveProCon('con', text)} onCancel={() => setAdding(null)} />
                  <button type="button" onClick={() => generateProCon('con')} disabled={generatingList === 'con'} style={{ background: '#2a2020', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#e8bcbc', border: '1px solid rgba(255,140,140,.26)', cursor: generatingList === 'con' ? 'wait' : 'pointer', fontWeight: 700 }}>{generatingList === 'con' ? 'AI 생성 중...' : 'AI로 단점 생성'}</button>
                </div>
              ) : <button type="button" aria-label="단점 추가" onClick={() => { setEditing(null); setAdding('con'); }} style={{ width: '100%', background: '#1e1e1e', borderRadius: 10, padding: '10px 14px', fontSize: 18, color: '#ff8c8c', border: '1px dashed rgba(255,140,140,.42)', cursor: 'pointer' }}>+</button>}
            </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#ddd', marginBottom: 12 }}>서비스 상세 기능</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {features.map((f, index) => (
              editing?.type === 'feature' && editing.index === index ? (
                <InlineInput
                  key={`feature-edit-${index}`}
                  initialValue={f}
                  placeholder="기능을 입력하세요..."
                  onSave={saveFeature}
                  onCancel={() => setEditing(null)}
                />
              ) : (
	                <DetailItemMenu
	                  key={`${f}-${index}`}
	                  value={f}
	                  icon="▦"
	                  active={activeMenu === `feature-${index}`}
	                  onToggle={open => setActiveMenu(open ? `feature-${index}` : null)}
	                  onEdit={() => { setEditing({ type: 'feature', index }); setActiveMenu(null); }}
	                  onDelete={() => deleteFeature(index)}
	                />
              )
            ))}
            {adding === 'feature'
              ? <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <InlineInput placeholder="기능을 입력하세요..." onSave={saveFeature} onCancel={() => setAdding(null)} />
                  <button type="button" onClick={() => generateFeatureGoal('feature')} disabled={generatingList === 'feature'} style={{ background: '#202620', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#d8f0b0', border: '1px solid rgba(203,255,0,.24)', cursor: generatingList === 'feature' ? 'wait' : 'pointer', fontWeight: 700 }}>{generatingList === 'feature' ? 'AI 생성 중...' : 'AI로 기능 생성'}</button>
                </div>
              : <button onClick={() => setAdding('feature')} style={{ background: '#1e1e1e', borderRadius: 10, padding: '10px 14px', fontSize: 18, color: '#555', border: '1px dashed #333', cursor: 'pointer' }}>+</button>
            }
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#ddd', marginBottom: 12 }}>서비스 목표</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {goals.map((g, index) => (
              editing?.type === 'goal' && editing.index === index ? (
                <InlineInput
                  key={`goal-edit-${index}`}
                  initialValue={g}
                  placeholder="목표를 입력하세요..."
                  onSave={saveGoal}
                  onCancel={() => setEditing(null)}
                />
              ) : (
	                <DetailItemMenu
	                  key={`${g}-${index}`}
	                  value={g}
	                  icon="•"
	                  tone="goal"
	                  active={activeMenu === `goal-${index}`}
	                  onToggle={open => setActiveMenu(open ? `goal-${index}` : null)}
	                  onEdit={() => { setEditing({ type: 'goal', index }); setActiveMenu(null); }}
	                  onDelete={() => deleteGoal(index)}
	                />
              )
            ))}
            {adding === 'goal'
              ? <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <InlineInput placeholder="목표를 입력하세요..." onSave={saveGoal} onCancel={() => setAdding(null)} />
                  <button type="button" onClick={() => generateFeatureGoal('goal')} disabled={generatingList === 'goal'} style={{ background: '#202620', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#d8f0b0', border: '1px solid rgba(203,255,0,.24)', cursor: generatingList === 'goal' ? 'wait' : 'pointer', fontWeight: 700 }}>{generatingList === 'goal' ? 'AI 생성 중...' : 'AI로 목표 생성'}</button>
                </div>
              : <button onClick={() => setAdding('goal')} style={{ background: '#1e1e1e', borderRadius: 10, padding: '10px 14px', fontSize: 18, color: '#555', border: '1px dashed #333', cursor: 'pointer' }}>+</button>
            }
          </div>
        </div>
      </div>}

      {generationError && (
        <div role="alert" style={{ margin: '0 20px 10px', padding: '10px 12px', borderRadius: 9, background: 'rgba(255,90,90,.1)', border: '1px solid rgba(255,120,120,.3)', color: '#ffaaaa', fontSize: 12, lineHeight: 1.5 }}>
          {generationError}
        </div>
      )}
      <div style={{ padding: '14px 20px max(24px, calc(env(safe-area-inset-bottom) + 18px))', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
	        {idea.isChildIdea
	          ? <div style={{ color: '#777', fontSize: 12, lineHeight: 1.5, textAlign: 'center' }}>하위 아이디어는 수동 메모로 관리됩니다.</div>
	          : loading
	          ? <SkeletonLine height={45} radius={10} />
	          : <button onClick={onExpand} style={{ width: '100%', background: '#CBFF00', color: '#111', fontWeight: 700, fontSize: 14, padding: '13px', marginBottom: 10, borderRadius: 10, border: 'none', cursor: 'pointer' }}>
	              AI 크리틱 시작하기
	            </button>
        }
      </div>
    </div>
  );
}
