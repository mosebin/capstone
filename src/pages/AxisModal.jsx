import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axisFramework from '../lib/axis.json';
import {
  getProjectContext,
  ensureIdeasAxisEvaluation,
  loadGeneratedIdeas,
  requestGptIdeaList,
  requestGptQuadrants,
  saveCanvasWorkspace,
  saveGeneratedIdeas,
  saveProjectContext,
  toCanvasIdeas,
} from '../lib/gpt';
import { getTeamId, logEvent } from '../lib/eventLogger';

const AXES = axisFramework.axes;
const FIXED_IDEA_COUNT = 20;
const SELECTABLE_AXES = AXES.filter(axis => axis.axis_type !== 'gate');
const PAIRINGS = axisFramework.recommended_spatial_pairings.pairings;
const DEFAULT_PAIRING = PAIRINGS[0];

const QUADRANT_PRESETS = {
  'feasibility:novelty': {
    high_high: '실행 가능한 혁신안',
    high_low: '빠른 실행 후보',
    low_high: '혁신적 장기 과제',
    low_low: '개선 또는 보류',
  },
  'feasibility:usefulness': {
    high_high: '최우선 실행안',
    high_low: '여력 있을 때 실행',
    low_high: '투자 검토 대상',
    low_low: '보류 후보',
  },
  'novelty:usefulness': {
    high_high: '가치 있는 혁신안',
    high_low: '차별적이나 가치 낮음',
    low_high: '유용한 경쟁안',
    low_low: '문제부터 재정의',
  },
};

const LEGACY_AXIS_ALIASES = {
  innovation: 'novelty',
  originality: 'novelty',
  user_value: 'usefulness',
  value: 'usefulness',
};

const normalizeAxisId = (value, fallback) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_|_$/g, '');
  const resolved = LEGACY_AXIS_ALIASES[normalized] || normalized;
  return SELECTABLE_AXES.some(axis => axis.id === resolved) ? resolved : fallback;
};

const axisLabel = axis => axis ? `${axis.name_ko}  ${axis.name_en}` : '';

function AxisSelect({ label, value, otherValue, axis, open, onToggle, onSelect }) {
  return (
    <section style={{
      position: 'relative',
      border: '1px solid #2b2b2b',
      borderRadius: 14,
      background: '#181818',
      padding: 16,
      minHeight: 142,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ color: '#aaa', fontSize: 15 }}>{label}</strong>
        <span style={{ color: '#999', fontSize: 13 }}>0 – 100</span>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%',
          minHeight: 54,
          padding: '0 14px',
          borderRadius: 10,
          border: `1.5px solid ${open ? '#8fab21' : '#333'}`,
          background: '#242424',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
          <strong style={{ fontSize: 18, lineHeight: 1.1, color: '#f5f5f5', whiteSpace: 'nowrap' }}>{axis?.name_ko}</strong>
          <span style={{ fontSize: 13, color: '#8f8f8f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{axis?.name_en}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ color: '#aaa', fontSize: 18, lineHeight: 1 }}>{open ? '⌃' : '⌄'}</span>
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          left: 16,
          right: 16,
          top: 86,
          zIndex: 2000,
          maxHeight: 360,
          overflowY: 'auto',
          borderRadius: 12,
          border: '1px solid #303030',
          background: '#1d1d1d',
          boxShadow: '0 26px 60px rgba(0,0,0,.58)',
          padding: 10,
        }}>
          {SELECTABLE_AXES.map(option => {
            const selected = option.id === value;
            const usedByOtherAxis = option.id === otherValue;
            const activeColor = selected ? '#CBFF00' : '#f1f1f1';

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderRadius: 9,
                  background: selected ? 'rgba(203,255,0,.12)' : 'transparent',
                  color: activeColor,
                  cursor: 'pointer',
                  textAlign: 'left',
                  padding: '10px 12px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 14,
                  alignItems: 'center',
                }}
              >
                <span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
                    <strong style={{ fontSize: 15 }}>{option.name_ko}</strong>
                    <span style={{ color: selected ? '#b8c985' : '#909090', fontSize: 12 }}>{option.name_en}</span>
                  </span>
                  <span style={{ display: 'block', color: '#9a9a9a', fontSize: 12, lineHeight: 1.45 }}>{option.operational_definition.summary}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {usedByOtherAxis && <span style={{ padding: '4px 7px', borderRadius: 7, background: '#2f2f2f', color: '#ffd65a', fontSize: 11 }}>사용 중</span>}
                  {selected && <span style={{ color: '#CBFF00', fontSize: 18 }}>✓</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p style={{ color: '#aaa', fontSize: 13, lineHeight: 1.55, margin: '12px 0 0' }}>{axis?.operational_definition.summary}</p>
    </section>
  );
}

export default function AxisModal({ onConfirm, onClose } = {}) {
  const [savedContext] = useState(getProjectContext);
  const [xAxis, setXAxis] = useState(() => normalizeAxisId(savedContext.axes?.xAxis, DEFAULT_PAIRING.x));
  const [yAxis, setYAxis] = useState(() => normalizeAxisId(savedContext.axes?.yAxis, DEFAULT_PAIRING.y));
  const [openSelect, setOpenSelect] = useState(null);
  const [quadrantInfo, setQuadrantInfo] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const navigate = useNavigate();

  const xAxisData = AXES.find(axis => axis.id === xAxis);
  const yAxisData = AXES.find(axis => axis.id === yAxis);
  const activePairing = useMemo(
    () => PAIRINGS.find(pairing => pairing.x === xAxis && pairing.y === yAxis),
    [xAxis, yAxis],
  );
  const fallbackQuadrants = useMemo(() => ({
    ...(QUADRANT_PRESETS[`${xAxis}:${yAxis}`] || {
      high_high: `${xAxisData?.name_ko || 'X축'} 높은 ${yAxisData?.name_ko || 'Y축'} 후보`,
      high_low: `${xAxisData?.name_ko || 'X축'} 중심 후보`,
      low_high: `${yAxisData?.name_ko || 'Y축'} 중심 후보`,
      low_low: '개선 또는 보류',
    }),
    rationale: activePairing?.rationale || `${xAxisData?.name_ko || 'X축'}과 ${yAxisData?.name_ko || 'Y축'}의 높고 낮음을 교차해 아이디어의 전략적 위치를 구분합니다.`,
  }), [activePairing, xAxis, yAxis, xAxisData, yAxisData]);
  const quadrantKey = `${xAxis}:${yAxis}`;
  const quadrantLabels = quadrantInfo?.key === quadrantKey ? quadrantInfo.data : fallbackQuadrants;

  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, []);

  useEffect(() => {
    if (!generating) return undefined;
    const timer = setInterval(() => {
      setProgress(prev => Math.min(prev + Math.max(2, Math.round((96 - prev) * 0.16)), 96));
    }, 260);
    return () => clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    let cancelled = false;
    if (!xAxisData || !yAxisData) return () => { cancelled = true; };

    requestGptQuadrants({ xAxis: xAxisData, yAxis: yAxisData, projectContext: savedContext, fallback: fallbackQuadrants })
      .then(result => { if (!cancelled) setQuadrantInfo({ key: quadrantKey, data: result }); });
    return () => { cancelled = true; };
  }, [xAxisData, yAxisData, savedContext, fallbackQuadrants, quadrantKey]);

  const closeModal = () => {
    if (typeof onClose === 'function') onClose();
    else navigate(-1);
  };

  const assignAxis = (target, axisId) => {
    if (target === 'x') {
      if (axisId === yAxis) setYAxis(xAxis);
      setXAxis(axisId);
    } else {
      if (axisId === xAxis) setXAxis(yAxis);
      setYAxis(axisId);
    }
    setOpenSelect(null);
  };

  const applyPreset = (pairing) => {
    setXAxis(pairing.x);
    setYAxis(pairing.y);
    setOpenSelect(null);
  };

  const startCanvas = async () => {
    if (generating || !xAxis || !yAxis) return;
    setGenerating(true);
    setProgress(10);
    try {
      const savedContext = getProjectContext();
      if (typeof onConfirm === 'function') {
        void saveProjectContext({ ...savedContext, axes: { xAxis, yAxis } });
        setProgress(100);
        onConfirm({ xAxis, yAxis });
        return;
      }
      const projectId = savedContext.projectId || `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const title = String(savedContext.title || savedContext.idea || '진행 중인 프로젝트').trim() || '진행 중인 프로젝트';
      const projectContext = {
        ...savedContext,
        projectId,
        title,
        input: savedContext.input ?? savedContext.idea ?? '',
        teamId: savedContext.teamId || getTeamId(),
        ideaCount: FIXED_IDEA_COUNT,
        axes: { xAxis, yAxis },
      };
      void saveProjectContext(projectContext);
      setProgress(28);
      const savedIdeas = await loadGeneratedIdeas(projectId, { remote: false });
      setProgress(42);
      const rawIdeas = savedIdeas.length
        ? savedIdeas
        : await requestGptIdeaList({ count: FIXED_IDEA_COUNT, projectContext: { ...projectContext, ideaCount: FIXED_IDEA_COUNT }, evaluateWithAi: false });
      setProgress(62);
      const ideas = await ensureIdeasAxisEvaluation(rawIdeas, projectContext, 4, { allowAi: false });
      setProgress(78);
      const canvasIdeas = toCanvasIdeas(ideas, ideas.length || FIXED_IDEA_COUNT);
      const axisLayout = {
        locked: true,
        xAxis,
        yAxis,
        generatedAt: new Date().toISOString(),
        positions: canvasIdeas.map(idea => ({
          id: idea.id,
          title: idea.title,
          wx: idea.wx,
          wy: idea.wy,
          xScore: idea.axisPosition?.xScore ?? idea.position?.x,
          yScore: idea.axisPosition?.yScore ?? idea.position?.y,
        })),
      };
      logEvent('axis_change', { x_axis: xAxis, y_axis: yAxis });
      void saveGeneratedIdeas(canvasIdeas);
      void saveCanvasWorkspace({
        layoutVersion: 3,
        positionMode: 'axis-fixed',
        projectId,
        projectTitle: title,
        projectInput: projectContext.input,
        axes: { xAxis, yAxis },
        axisLayout,
        ideas: canvasIdeas,
        selectedIdeaId: null,
        zoom: 90,
        offset: null,
        deletedIds: [],
        spaces: [{ id: 1, name: '아이디어 공간 1', xAxis, yAxis }],
        groupLabels: [],
        groupAreas: [],
        groupingEnabled: false,
        ideaLinks: [],
        generatedAt: new Date().toISOString(),
        stats: {
          totalIdeas: canvasIdeas.length,
          aiGenerated: canvasIdeas.filter(idea => idea.aiGenerated || idea.showAiBadge).length,
          links: 0,
          deleted: 0,
        },
      });
      setProgress(100);
      navigate('/canvas');
    } catch (error) {
      console.warn('Failed to start canvas', error);
      setProgress(0);
    } finally {
      setGenerating(false);
    }
  };

  const quadrants = [
    { label: quadrantLabels.low_high, condition: `${yAxisData?.name_ko} 높음 · ${xAxisData?.name_ko} 낮음`, left: 0, top: 0 },
    { label: quadrantLabels.high_high, condition: `${yAxisData?.name_ko} 높음 · ${xAxisData?.name_ko} 높음`, left: 50, top: 0, highlight: true },
    { label: quadrantLabels.low_low, condition: `${yAxisData?.name_ko} 낮음 · ${xAxisData?.name_ko} 낮음`, left: 0, top: 50 },
    { label: quadrantLabels.high_low, condition: `${yAxisData?.name_ko} 낮음 · ${xAxisData?.name_ko} 높음`, left: 50, top: 50 },
  ];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      background: 'rgba(0,0,0,.78)',
      backdropFilter: 'blur(8px)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: 'min(1240px, calc(100% - 48px))',
        maxHeight: '92vh',
        overflow: 'visible',
        background: '#151515',
        border: '1px solid #303030',
        borderRadius: 18,
        boxShadow: '0 28px 90px rgba(0,0,0,.6)',
        display: 'flex',
        flexDirection: 'column',
      }}>
      <header style={{ flex: '0 0 auto', padding: '30px 34px 24px', borderBottom: '1px solid #262626', position: 'relative' }}>
        <h2 style={{ fontSize: 28, margin: '0 0 7px', letterSpacing: 0, lineHeight: 1.1 }}>Set the Axis</h2>
        <p style={{ margin: 0, color: '#aaa', fontSize: 15 }}>평가 기준을 X, Y축에 배치해 아이디어의 위치와 사분면 의미를 결정합니다.</p>
        <button
          type="button"
          aria-label="닫기"
          onClick={closeModal}
          style={{
            position: 'absolute',
            top: 18,
            right: 18,
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '1px solid #2d2d2d',
            background: '#222',
            color: '#fff',
            fontSize: 22,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </header>

      <main style={{ position: 'relative', zIndex: 100, flex: 1, minHeight: 0, overflow: 'visible', padding: '24px 34px 28px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '520px minmax(420px, 1fr)', gap: 24, alignItems: 'start' }}>
          <section>
            <div style={{
              position: 'relative',
              minHeight: 410,
              height: 410,
              borderRadius: 14,
              overflow: 'hidden',
              background: '#111',
              border: '1px solid #2d2d2d',
            }}>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}>
                <div style={{ borderRight: '1px solid #262626', borderBottom: '1px solid #262626' }} />
                <div style={{ borderBottom: '1px solid #262626', background: 'rgba(203,255,0,.035)' }} />
                <div style={{ borderRight: '1px solid #262626' }} />
                <div />
              </div>
              {quadrants.map(item => (
                <div
                  key={`${item.left}-${item.top}`}
                  style={{
                    position: 'absolute',
                    left: `${item.left}%`,
                    top: `${item.top}%`,
                    width: '50%',
                    height: '50%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 28,
                    boxSizing: 'border-box',
                    textAlign: 'center',
                  }}
                >
                  <strong style={{ color: item.highlight ? '#CBFF00' : '#f5f5f5', fontSize: 14, lineHeight: 1.35 }}>{item.label}</strong>
                  <span style={{ color: '#8b8b8b', fontSize: 11, lineHeight: 1.45, marginTop: 6 }}>{item.condition}</span>
                </div>
              ))}
              <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translate(-42%, -50%) rotate(-90deg)', color: '#CBFF00', fontSize: 12, fontWeight: 800, letterSpacing: .4, whiteSpace: 'nowrap' }}>
                Y · {axisLabel(yAxisData)} ↑
              </div>
              <div style={{ position: 'absolute', right: 18, bottom: 14, color: '#CBFF00', fontSize: 12, fontWeight: 800, letterSpacing: .4 }}>
                X · {xAxisData?.name_en} →
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>추천 프리셋</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap', overflow: 'visible', paddingBottom: 2 }}>
                {PAIRINGS.map(pairing => {
                  const pairX = AXES.find(axis => axis.id === pairing.x);
                  const pairY = AXES.find(axis => axis.id === pairing.y);
                  const active = xAxis === pairing.x && yAxis === pairing.y;
                  return (
                    <button
                      key={`${pairing.x}-${pairing.y}`}
                      type="button"
                      onClick={() => applyPreset(pairing)}
                      style={{
                        border: `1px solid ${active ? '#CBFF00' : '#343434'}`,
                        background: active ? '#CBFF00' : '#242424',
                        color: active ? '#111' : '#ddd',
                        borderRadius: 999,
                        padding: '8px 12px',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flex: '0 0 auto',
                      }}
                    >
                      {pairX?.name_ko || pairing.x} × {pairY?.name_ko || pairing.y}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 44 }}>
            <AxisSelect
              label="X · 가로축"
              value={xAxis}
              otherValue={yAxis}
              axis={xAxisData}
              open={openSelect === 'x'}
              onToggle={() => setOpenSelect(openSelect === 'x' ? null : 'x')}
              onSelect={axisId => assignAxis('x', axisId)}
            />
            <button
              type="button"
              onClick={() => { setXAxis(yAxis); setYAxis(xAxis); setOpenSelect(null); }}
              style={{
                alignSelf: 'center',
                margin: '-32px 0 -32px',
                width: 38,
                height: 38,
                padding: 0,
                borderRadius: '50%',
                border: '1px solid #303030',
                background: '#181818',
                color: '#bbb',
                fontSize: 20,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="X축과 Y축 바꾸기"
              title="X축과 Y축 바꾸기"
            >
              ⇅
            </button>
            <AxisSelect
              label="Y · 세로축"
              value={yAxis}
              otherValue={xAxis}
              axis={yAxisData}
              open={openSelect === 'y'}
              onToggle={() => setOpenSelect(openSelect === 'y' ? null : 'y')}
              onSelect={axisId => assignAxis('y', axisId)}
            />
          </section>
        </div>
      </main>

      <footer style={{
        position: 'relative',
        zIndex: 1,
        flex: '0 0 auto',
        minHeight: 76,
        borderTop: '1px solid #262626',
        background: '#151515',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 34px',
        boxSizing: 'border-box',
      }}>
        <p style={{ color: '#858585', fontSize: 13, margin: 0 }}>X와 Y에 같은 기준을 고르면 두 축이 자동으로 교체됩니다.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={closeModal}
            disabled={generating}
            style={{
              minWidth: 86,
              height: 46,
              borderRadius: 10,
              border: 'none',
              background: '#2a2a2a',
              color: '#fff',
              fontSize: 15,
              fontWeight: 800,
              cursor: generating ? 'default' : 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={startCanvas}
            disabled={generating || !xAxis || !yAxis}
            style={{
              position: 'relative',
              overflow: 'hidden',
              minWidth: 128,
              height: 46,
              borderRadius: 10,
              border: 'none',
              background: generating ? '#3a4318' : '#CBFF00',
              color: '#111',
              fontSize: 16,
              fontWeight: 900,
              cursor: generating ? 'default' : 'pointer',
            }}
          >
            {generating && <span style={{ position: 'absolute', inset: 0, width: `${progress}%`, background: '#CBFF00', transition: 'width .24s ease' }} />}
            <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <img src="/streamline_magic-wand-2-solid.png" alt="" style={{ width: 16, height: 16, filter: 'brightness(0)' }} />
              {generating ? `${progress}%` : '시작하기'}
            </span>
          </button>
        </div>
      </footer>
      </div>
    </div>
  );
}
