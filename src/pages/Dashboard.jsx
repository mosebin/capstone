import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProjectContext, loadCanvasWorkspace, loadGeneratedIdeas, requestFinalPlan, toCanvasIdeas } from '../lib/gpt';
import { downloadTextFile, makeFinalPlanText, safeFinalPlanFileName } from '../lib/finalPlan';
import { readIdeaDetailCache } from '../lib/ideaDetailCache';

async function readCanvasReport() {
  const [workspace, generated] = await Promise.all([
    loadCanvasWorkspace(),
    loadGeneratedIdeas(),
  ]);
  if (Array.isArray(workspace?.ideas) && workspace.ideas.length) {
    const links = workspace.links || workspace.ideaLinks || [];
    return {
      ...workspace,
      links,
      stats: workspace.stats || {
        totalIdeas: workspace.ideas.length,
        aiGenerated: workspace.ideas.filter(idea => idea.aiGenerated || idea.showAiBadge).length,
        links: links.length,
        deleted: workspace.deletedIds?.length || 0,
      },
    };
  }

  const ideas = generated.length ? toCanvasIdeas(generated, 40) : [];
  return {
    ideas,
    links: [],
    spaces: [{ name: '아이디어 공간 1', xAxis: getProjectContext().axes?.xAxis || 'FEASIBILITY', yAxis: getProjectContext().axes?.yAxis || 'USER VALUE' }],
    criticIdea: ideas.sort((a, b) => (b.stars || 0) - (a.stars || 0))[0] || null,
    stats: { totalIdeas: ideas.length, aiGenerated: ideas.filter(idea => idea.aiGenerated || idea.showAiBadge).length, links: 0, deleted: 0 },
  };
}

function StarRating({ count }) {
  return (
    <span title={count ? '즐겨찾기됨' : '즐겨찾기 안 됨'} style={{ color: count ? '#CBFF00' : '#444', fontSize: 15 }}>★</span>
  );
}

function keywordCounts(ideas) {
  const counts = {};
  ideas.forEach(idea => {
    (idea.keywords || []).forEach(keyword => {
      counts[keyword] = (counts[keyword] || 0) + 1;
    });
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

const DETAIL_SECTIONS = [
  { key: 'pros', label: '장점', color: '#79d986' },
  { key: 'cons', label: '단점', color: '#ff8c8c' },
  { key: 'features', label: '서비스 상세 기능', color: '#ddd' },
  { key: 'goals', label: '서비스 목표', color: '#CBFF00' },
];

function getIdeaDetailForDashboard(idea) {
  const cached = readIdeaDetailCache(getProjectContext(), idea) || {};
  const panel = idea?.detailPanel || {};
  const getList = (field) => {
    if (Array.isArray(cached[field])) return cached[field];
    if (Array.isArray(panel[field])) return panel[field];
    if (Array.isArray(idea?.[field])) return idea[field];
    return [];
  };
  return {
    description: cached.description || panel.description || idea?.description || idea?.desc || idea?.summary || '',
    pros: getList('pros'),
    cons: getList('cons'),
    features: getList('features'),
    goals: getList('goals'),
  };
}

function DetailListPreview({ detail }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, color: '#bbb', fontSize: 13, lineHeight: 1.75 }}>
        {detail.description || '작성된 설명이 없습니다.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
        {DETAIL_SECTIONS.map(section => {
          const items = detail[section.key] || [];
          return (
            <div key={section.key} style={{ minWidth: 0 }}>
              <div style={{ color: section.color, fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{section.label}</div>
              {items.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map((item, index) => (
                    <div key={`${section.key}-${index}`} style={{ color: '#aaa', fontSize: 12, lineHeight: 1.55, padding: '8px 10px', background: '#181818', border: '1px solid #2a2a2a', borderRadius: 7 }}>
                      {item}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#555', fontSize: 12, padding: '8px 0' }}>아직 작성된 내용이 없습니다.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [expandedRow, setExpandedRow] = useState(null);
  const [report, setReport] = useState({ ideas: [], links: [], spaces: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [planDownloading, setPlanDownloading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    readCanvasReport()
      .then(nextReport => {
        if (!cancelled) setReport(nextReport);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);
  const ideas = report.ideas || [];
  const topIdeas = [...ideas].sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 3);
  const keywords = keywordCounts(ideas);
  const focusIdea = report.criticIdea || topIdeas[0];
  const activeSpace = (report.spaces || []).find(space => String(space.id) === String(report.activeSpaceId));
  const axes = activeSpace || report.spaces?.[report.spaces.length - 1] || {};

  const downloadPlan = async () => {
    if (!focusIdea || planDownloading) return;
    setPlanDownloading(true);
    try {
      const plan = await requestFinalPlan({
        idea: focusIdea,
        projectContext: getProjectContext(),
        referenceIdeas: topIdeas.filter(idea => idea.id !== focusIdea.id),
      });
      const text = makeFinalPlanText({ report, focusIdea, plan });
      downloadTextFile(text, `${safeFinalPlanFileName(plan.ideaName || focusIdea?.title)}.txt`);
    } finally {
      setPlanDownloading(false);
    }
  };

  return (
    <div className="dot-bg" style={{ minHeight: 'calc(100vh - 100px)', width: '100%', padding: '40px 120px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>Activity Report</h1>
          <p style={{ color: '#aaa', fontSize: 14 }}>{loading ? 'Firestore에서 활동 데이터를 불러오는 중입니다.' : '캔버스에서의 탐색, 평가, 결합 활동을 바탕으로 최종 방향을 요약합니다.'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => navigate('/canvas')} style={{ background: '#1a1a1a', color: '#ddd', fontWeight: 700, fontSize: 13, padding: '11px 20px', borderRadius: 8, border: '1px solid #444', cursor: 'pointer' }}>
            캔버스 보기
          </button>
          <button onClick={downloadPlan} disabled={!focusIdea || planDownloading} style={{ background: '#CBFF00', color: '#111', fontWeight: 800, fontSize: 13, padding: '11px 20px', borderRadius: 8, border: 'none', cursor: focusIdea && !planDownloading ? 'pointer' : 'default', opacity: focusIdea && !planDownloading ? 1 : .62 }}>
            {planDownloading ? '기획안 생성 중...' : '최종 기획안 생성'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: '아이디어 노드', value: `${ideas.length}개`, sub: '도출된 전체 아이디어' },
          { label: '결합/하위 연결', value: `${report.links?.length || 0}개`, sub: '아이디어 간 관계' },
          { label: 'AI 생성 흔적', value: `${report.stats?.aiGenerated || 0}개`, sub: '결합/재생성 기반' },
          { label: '설정 축', value: `${axes.xAxis || 'FEASIBILITY'}`, sub: axes.yAxis || 'USER VALUE' },
        ].map(item => (
          <div key={item.label} style={{ background: '#1a1a1a', borderRadius: 10, padding: '20px 22px', border: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{item.label}</div>
            <div style={{ fontSize: 25, fontWeight: 800, color: '#fff' }}>{item.value}</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>{item.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#1a1a1a', borderRadius: 12, padding: '22px 26px', marginBottom: 24, border: '1px solid #2a2a2a', lineHeight: 1.75 }}>
        <div style={{ fontSize: 12, color: '#CBFF00', fontWeight: 800, letterSpacing: 1.2, marginBottom: 8 }}>FINAL DIRECTION</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{focusIdea?.title || '핵심 아이디어 없음'}</div>
        <div style={{ color: '#bbb', fontSize: 14 }}>
          사용자의 캔버스 활동은 상위 평가 아이디어와 연결된 하위 노드를 중심으로 수렴했습니다. 주요 키워드는 {keywords.slice(0, 4).map(([key]) => <strong key={key} style={{ color: '#FFB800', margin: '0 4px' }}>{key}</strong>)} 입니다.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 34 }}>
        {topIdeas.map(idea => (
          <div key={idea.id} style={{ background: idea.stars ? 'linear-gradient(135deg, rgba(203,255,0,.1), #1a1a1a 60%)' : '#1a1a1a', borderRadius: 12, padding: 20, border: `1px solid ${idea.stars ? '#CBFF00' : '#2a2a2a'}` }}>
            <StarRating count={idea.stars || 0} />
            <div style={{ fontSize: 10, color: '#666', margin: '8px 0 4px', letterSpacing: 1 }}>{idea.tag}</div>
            <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>{idea.title}</h3>
            <p style={{ fontSize: 12, color: '#999', lineHeight: 1.6, marginBottom: 12 }}>{idea.desc || idea.summary}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(idea.keywords || []).map(keyword => (
                <span key={keyword} style={{ background: '#2a2a2a', color: '#FFB800', fontSize: 11, padding: '3px 8px', borderRadius: 4 }}>{keyword}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>도출된 모든 아이디어</h2>
      <div style={{ background: '#1a1a1a', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 120px 2fr 140px', padding: '14px 24px', borderBottom: '1px solid #2a2a2a', fontSize: 13, fontWeight: 700, color: '#aaa' }}>
          <span>아이디어</span>
          <span>즐겨찾기</span>
          <span>키워드</span>
          <span>상태</span>
        </div>
        {ideas.map((idea, index) => (
          <div key={idea.id || index}>
            <div onClick={() => setExpandedRow(expandedRow === index ? null : index)} style={{ display: 'grid', gridTemplateColumns: '2fr 120px 2fr 140px', padding: '15px 24px', borderBottom: '1px solid #202020', cursor: 'pointer', background: expandedRow === index ? '#202020' : 'transparent' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{idea.title}</span>
              <StarRating count={idea.stars || 0} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{(idea.keywords || []).map(keyword => <span key={keyword} style={{ background: '#2a2a2a', color: '#777', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>{keyword}</span>)}</div>
              <span style={{ color: idea.showAiBadge ? '#CBFF00' : '#888', fontSize: 12 }}>{idea.showAiBadge ? 'AI 결합/재생성' : '발산 아이디어'}</span>
            </div>
            {expandedRow === index && (
              <div style={{ padding: '14px 24px 18px', color: '#aaa', fontSize: 13, lineHeight: 1.7, borderBottom: '1px solid #202020' }}>
                <DetailListPreview detail={getIdeaDetailForDashboard(idea)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
