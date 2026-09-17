export const METRIC_KEYS = [
  'feasibility',
  'userValue',
  'originality',
  'costEfficiency',
  'sustainability',
  'spaceEfficiency',
  'privacy',
  'community',
];

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';

const clampMetric = (value) => Math.max(35, Math.min(95, Math.round(value)));
const hashScore = (text) => [...String(text || '')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

const AXIS_METRIC_ALIASES = {
  FEASIBILITY: 'feasibility',
  'USER VALUE': 'userValue',
  USER_VALUE: 'userValue',
  VALUE: 'userValue',
  ORIGINALITY: 'originality',
  INNOVATION: 'originality',
  COST_EFFICIENCY: 'costEfficiency',
  'COST EFFICIENCY': 'costEfficiency',
  SUSTAINABILITY: 'sustainability',
  SPACE_EFFICIENCY: 'spaceEfficiency',
  'SPACE EFFICIENCY': 'spaceEfficiency',
  PRIVACY: 'privacy',
  COMMUNITY: 'community',
};

const getAxisMetricKey = (axisName, fallback) => {
  const normalized = String(axisName || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
  return AXIS_METRIC_ALIASES[String(axisName || '').trim().toUpperCase()] || AXIS_METRIC_ALIASES[normalized] || fallback;
};

export function getProjectContext() {
  try {
    return JSON.parse(localStorage.getItem('neo-node-project-context') || '{}');
  } catch {
    return {};
  }
}

export function saveProjectContext(context) {
  localStorage.setItem('neo-node-project-context', JSON.stringify(context));
}

export function saveGeneratedIdeas(ideas) {
  localStorage.setItem('neo-node-generated-ideas', JSON.stringify(ideas));
}

export function loadGeneratedIdeas() {
  try {
    const ideas = JSON.parse(localStorage.getItem('neo-node-generated-ideas') || '[]');
    return Array.isArray(ideas) ? ideas : [];
  } catch {
    return [];
  }
}

function normalizeKeywords(keywords, fallback) {
  if (!Array.isArray(keywords) || !keywords.length) return fallback;
  return keywords.slice(0, 3).map(keyword => keyword.startsWith('#') ? keyword : `#${keyword}`);
}

function normalizeMetrics(metrics = {}, seed = 0) {
  return METRIC_KEYS.reduce((acc, key, index) => {
    acc[key] = clampMetric(Number(metrics[key]) || 58 + ((seed + index * 7) % 30));
    return acc;
  }, {});
}

function averageMetrics(ideas) {
  return METRIC_KEYS.reduce((acc, key) => {
    const total = ideas.reduce((sum, idea) => sum + (idea.metrics?.[key] || 60), 0);
    acc[key] = clampMetric(total / Math.max(ideas.length, 1) + (key === 'originality' ? 8 : 0));
    return acc;
  }, {});
}

export function makeFallbackIdea({ text, sourceIdeas = [], mode = 'generate', wx = 1800, wy = 900, projectContext = {} }) {
  const seed = hashScore(`${mode}-${text}-${projectContext.idea || ''}-${sourceIdeas.map(i => i.title).join('-')}`);
  const titles = sourceIdeas.map(i => i.title);
  const title = mode === 'combine' && sourceIdeas.length >= 2
    ? `${titles[0].slice(0, 7)} X ${titles[1].slice(0, 7)}`
    : String(text || projectContext.idea || '새로운 아이디어').trim().slice(0, 22);
  const summary = mode === 'combine'
    ? `${titles.join('와 ')}의 강점을 결합한 하위 아이디어`
    : `${title}을 프로젝트 주제에 맞게 확장한 서비스 아이디어`;

  return {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2)}-${seed}`,
    tag: mode === 'combine' ? 'AI_BONDING' : 'AI_IDEA',
    stars: 4 + (seed % 2),
    title,
    summary,
    desc: mode === 'combine'
      ? `${titles.join('와 ')}의 사용자 가치와 구현 방식을 연결해 새로운 경험 흐름을 만드는 하위 아이디어입니다.`
      : `${projectContext.idea || text || title}이라는 프로젝트 주제를 바탕으로 사용자의 실제 맥락에 맞춰 구체화한 아이디어입니다.`,
    keywords: mode === 'combine'
      ? ['#AI', '#Bonding', '#SubIdea']
      : ['#AI', '#Generated', `#Idea${(seed % 9) + 1}`],
    wx,
    wy,
    aiGenerated: true,
    showAiBadge: mode === 'combine',
    metrics: sourceIdeas.length ? averageMetrics(sourceIdeas) : normalizeMetrics({}, seed),
    pros: ['빠른 프로토타입 검증 가능', '프로젝트 주제와 연결성 높음', 'AI 기반 확장성이 있음'],
    cons: ['사용자 리서치로 세부 니즈 검증 필요', '초기 범위 조절 필요'],
    features: sourceIdeas.length
      ? ['두 아이디어의 핵심 기능 연결', 'AI 기반 하위 시나리오 생성']
      : ['입력 기반 아이디어 구체화', '핵심 기능 자동 제안'],
    goals: sourceIdeas.length
      ? ['서로 다른 아이디어의 장점을 한 실험안에서 검증', '새로운 하위 아이디어를 통해 기획 선택지를 확장']
      : ['초기 문장을 실행 가능한 서비스 개념으로 전환', '캔버스에서 바로 비교 가능한 형태로 아이디어 추가'],
  };
}

function buildPrompt({ text, sourceIdeas = [], mode, projectContext, count }) {
  const sourceText = sourceIdeas.map((idea, index) => (
    `${index + 1}. ${idea.title}: ${idea.summary || idea.desc} / ${idea.desc || ''}`
  )).join('\n');
  const contextText = [
    `프로젝트 주제: ${projectContext.idea || text || '미정'}`,
    `디자인 도메인: ${projectContext.domain || 'Service Design'}`,
    `추천/관심 키워드: ${(projectContext.selectedIdeas || []).join(', ') || '없음'}`,
  ].join('\n');

  if (mode === 'list') {
    const domain = projectContext.domain || 'Service Design';
    const interestTags = (projectContext.selectedIdeas || []).join(', ');
    const domainFocus = {
      'Service Design':   '서비스 설계 · 사용자 여정 · 터치포인트 · 생태계 관점',
      'UX/UI & Product':  '인터랙션 · 정보 구조 · 화면 흐름 · 사용성 개선 관점',
      'Brand & Identity': '브랜드 경험 · 시각 언어 · 아이덴티티 · 감성 차별화 관점',
      'Game Design':      '게임 메카닉 · 보상 루프 · 몰입 설계 · 플레이어 동기 관점',
      'Space Design':     '공간 경험 · 동선 · 분위기 · 사람-환경 상호작용 관점',
    };
    return [
      '당신은 발산적 사고 전문가입니다.',
      '당신의 임무는 완성된 답을 주는 것이 아니라, 사용자가 사고의 편향과 인지적 고착을 넘어 평소라면 떠올리지 못했을 대안에 도달하도록, 의도적으로 넓고 다양한 아이디어의 점들을 찍는 것입니다.',
      '',
      '핵심 주제:',
      projectContext.idea || text || '미정',
      '',
      `이 주제를 출발점으로 삼아, 주제를 더 풍부하게 만드는 기능적 아이디어와 인접 영역으로 뻗어나가는 확장 아이디어를 섞어, 정확히 ${count}개의 하위 아이디어를 발산하세요.`,
      '각 아이디어는 부모 주제의 자식 노드입니다. 주제를 대체하는 별개 서비스가 아니라, 주제를 강화·확장·재해석하는 점들이어야 합니다.',
      '',
      `디자인 도메인: ${domain} (${domainFocus[domain] || domainFocus['Service Design']})`,
      interestTags ? `관심 키워드: ${interestTags}` : '',
      '',
      '【발산 규칙】',
      '· 고착 회피: 가장 먼저 떠오르는 뻔한 아이디어 3~4개에 머물지 마세요. 그 너머로 밀고 나가세요.',
      '· 다양성 강제: 아이디어들이 아래 4개 차원에서 골고루 분포해야 합니다.',
      '  - 구현 접근: 기술 / 서비스 / 제품 / 데이터 / 커뮤니티 / 제도·정책 / 오프라인·공간',
      '  - 타깃 사용자: 핵심 사용자 외에 주변·소외·전문가·B2B 등으로 확장',
      '  - 가치 제안: 효율 / 정서 / 건강 / 경제성 / 재미 / 지속가능성 / 사회적 연결',
      '  - 혁신 수준: 점진적 개선부터 파괴적·실험적 발상까지',
      '· 군집 방지: 서로 의미가 겹치는 아이디어를 반복하지 마세요. 두 개가 같은 클러스터로 묶일 것 같으면 하나를 더 먼 영역으로 옮기세요.',
      '· 화이트 스페이스 확보: 안전한 아이디어만 만들지 마세요. 일부는 의도적으로 비주류·고위험·고혁신 영역에 배치하세요.',
      '',
      '=== 출력 형식 (JSON 배열만, 마크다운 없이) ===',
      '[',
      '  {',
      '    "title": "한글 제목 (간결, 12자 내외)",',
      '    "titleEn": "Short English Label",',
      '    "summary": "카드에 들어갈 한 줄 요약 — 어떤 사람이 어떤 문제를 어떻게 해결하는지 (30자 내외)",',
      '    "description": "상세 설명 (2~3문장, 무엇을·누구에게·왜)",',
      '    "tags": ["키워드1", "키워드2"],',
      '    "category": "CLUSTER_LABEL_EN",',
      '    "scores": { "feasibility": 0~100, "innovation": 0~100, "userValue": 0~100, "marketPotential": 0~100 }',
      '  }',
      ']',
    ].filter(Boolean).join('\n');
  }

  if (mode === 'keywords') {
    return [
      '사용자의 새 프로젝트 입력을 바탕으로 추천 아이디어 키워드 10개를 JSON 배열만으로 생성하세요.',
      '각 항목은 6~14자 정도의 한국어 짧은 명사구로 작성하고, #은 붙이지 마세요.',
      '너무 일반적인 단어보다 서비스 기획에 바로 쓸 수 있는 구체적인 방향을 제안하세요.',
      contextText,
      `사용자 입력: ${text || projectContext.idea || ''}`,
    ].join('\n');
  }

  return [
    mode === 'combine'
      ? '당신은 서로 다른 영역의 개념을 창의적으로 충돌시켜 새로운 시너지를 만드는 Cross-Pollination 전문 디자이너입니다.'
      : '한국어 아이디어 캔버스 앱에서 사용할 새 아이디어를 JSON만으로 생성하세요.',
    '필드는 title, summary, desc, keywords, features, goals, pros, cons, metrics를 포함하세요.',
    'keywords는 #으로 시작하는 2-3개 문자열, metrics는 feasibility,userValue,originality,costEfficiency,sustainability,spaceEfficiency,privacy,community 숫자 0-100입니다.',
    contextText,
    mode === 'combine'
      ? [
        '다음 두 아이디어의 장점과 메커니즘이 시너지를 내는 제3의 통합 아이디어를 만드세요.',
        '단순히 A도 있고 B도 있는 앱은 피하고, 한 아이디어의 특성이 다른 아이디어의 문제를 해결하는 지렛대가 되는 과정을 설명하세요.',
        `결합 대상:\n${sourceText}`,
      ].join('\n')
      : `사용자 입력을 바탕으로 새 아이디어를 만드세요: ${text}`,
  ].join('\n');
}

function buildCritiquePrompt({ idea, projectContext, userNote = '' }) {
  return [
    '당신은 서비스 기획안을 정밀 검증하고 고도화하는 수석 디자인 방법론 전문가입니다.',
    '',
    'Context:',
    `- Selected Idea Details: ${JSON.stringify(idea)}`,
    `- Target Domain: ${projectContext.domain || 'Service Design'}`,
    `- User Note: ${userNote || '없음'}`,
    '',
    'Task:',
    '선택된 아이디어를 디자인 도메인 전문가 관점에서 비판적이고 논리적으로 크리틱하세요.',
    '',
    'Constraint:',
    '1. 칭찬보다 검증해야 할 가정, UX 리스크, 구현 리스크, 도메인 적합성을 우선 분석하세요.',
    '2. 사용자의 사고를 확장할 수 있도록 구체적 대안 또는 질문을 포함하세요.',
    '3. JSON 배열만 반환하세요. 각 항목은 130자 이내의 한국어 문장입니다.',
    '',
    'Output Format:',
    '["크리틱 문장 1", "크리틱 문장 2", "크리틱 문장 3"]',
  ].join('\n');
}

function makeFallbackKeywords(text = '', domain = 'Service Design') {
  const normalized = text.trim();
  if (!normalized) {
    return [
      '지속가능한 라이프스타일', 'AI 기반 개인화', '로컬 커뮤니티 연결',
      '디지털 헬스케어', '감성 기록 서비스', '도시 재생 플랫폼',
      '비대면 학습 경험', '크리에이터 경제', '노인 복지 기술', '제로웨이스트 소비',
    ];
  }

  const dictionary = [
    { test: /노인|고령|시니어|치매|회고|기억/, values: ['노인 회고 기록', '인지 건강 케어', '가족 연결 서비스', '추억 아카이브', '음성 기반 기록'] },
    { test: /환경|친환경|제로|지속|재활용|탄소/, values: ['탄소 절감 행동', '제로웨이스트 소비', '순환 자원 플랫폼', '친환경 인증', '리필 스테이션'] },
    { test: /교육|학습|수업|학생|튜터/, values: ['맞춤 학습 코칭', '실습형 교육 경험', 'AI 튜터링', '학습 동기 설계', '진도 추적 대시보드'] },
    { test: /건강|수면|운동|병원|멘탈|감정/, values: ['건강 루틴 코칭', '감정 패턴 분석', '수면 환경 개선', '예방 케어 서비스', '웨어러블 연동'] },
    { test: /공간|도시|지역|동네|커뮤니티/, values: ['지역 커뮤니티 연결', '공간 기반 큐레이션', '동네 자원 공유', '하이퍼로컬 매칭', '도시 문제 해결'] },
    { test: /창작|스토리|콘텐츠|글|영상|디자인/, values: ['AI 창작 보조', '스토리텔링 자동화', '콘텐츠 큐레이션', '크리에이터 워크플로', '브랜드 서사 생성'] },
  ];
  const matched = dictionary.flatMap(item => item.test.test(normalized) ? item.values : []);
  const domainHints = {
    'UX/UI & Product': ['사용자 여정 개선', '인터랙션 프로토타입'],
    'Brand & Identity': ['브랜드 경험 설계', '정체성 시각화'],
    'Game Design': ['몰입형 플레이', '보상 루프 설계'],
    'Space Design': ['공간 경험 동선', '체험형 전시'],
    'Service Design': ['서비스 여정 설계', '접점 경험 개선'],
  };
  return [...new Set([
    ...matched,
    ...(domainHints[domain] || domainHints['Service Design']),
    'AI 기반 개인화',
    '사용자 데이터 활용',
    '프로토타입 검증',
    '커뮤니티 참여',
  ])].slice(0, 10);
}

export async function requestGeminiKeywords({ text, domain = 'Service Design', projectContext = {} }) {
  const fallback = makeFallbackKeywords(text, domain);
  const parsed = await requestGeminiJson(buildPrompt({
    text,
    mode: 'keywords',
    projectContext: { ...projectContext, idea: text, domain },
  }));
  if (!Array.isArray(parsed)) return fallback;
  const keywords = parsed
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.replace(/^#+/, '').trim())
    .slice(0, 10);
  return keywords.length ? keywords : fallback;
}

export async function requestGeminiCritique({ idea, userNote = '', projectContext = getProjectContext() }) {
  const fallback = [
    `"${idea?.title || '선택 아이디어'}"는 핵심 가치가 보이지만, 실제 사용자가 반복적으로 사용할 이유가 충분히 검증되어야 합니다.`,
    '초기 구현 범위를 줄이고, 가장 위험한 사용자 가정 1개를 먼저 프로토타입으로 확인하는 것이 좋습니다.',
    '도메인 특성상 데이터 수집, 개인정보, 오프라인 접점, 운영 비용 중 어떤 제약이 가장 큰 병목인지 명확히 해야 합니다.',
  ];
  const parsed = await requestGeminiJson(buildCritiquePrompt({ idea, userNote, projectContext }));
  if (!Array.isArray(parsed)) return fallback;
  const messages = parsed.filter(item => typeof item === 'string' && item.trim()).slice(0, 5);
  return messages.length ? messages : fallback;
}

async function requestGeminiJson(prompt) {
  if (!GEMINI_API_KEY) return null;
  try {
    const isNewFormat = GEMINI_API_KEY.startsWith('AQ.');
    const url = isNewFormat
      ? `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
      : `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(isNewFormat ? { 'x-goog-api-key': GEMINI_API_KEY } : {}),
    };
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) {
      console.warn(`[Gemini] ${response.status} ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json\n?|```/g, '').trim();
    const match = clean.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    return JSON.parse(match ? match[0] : clean);
  } catch {
    return null;
  }
}

export async function requestGeminiIdea({ text, sourceIdeas = [], mode = 'generate', wx, wy, projectContext = getProjectContext() }) {
  const fallback = makeFallbackIdea({ text, sourceIdeas, mode, wx, wy, projectContext });
  const parsed = await requestGeminiJson(buildPrompt({ text, sourceIdeas, mode, projectContext }));
  if (!parsed || Array.isArray(parsed)) return fallback;
  return {
    ...fallback,
    ...parsed,
    id: fallback.id,
    wx,
    wy,
    aiGenerated: false,
    showAiBadge: false,
    tag: mode === 'combine' ? 'AI_BONDING' : (parsed.tag || fallback.tag),
    stars: parsed.stars || fallback.stars,
    metrics: normalizeMetrics({ ...fallback.metrics, ...(parsed.metrics || {}) }, hashScore(parsed.title)),
    keywords: normalizeKeywords(parsed.keywords, fallback.keywords),
    features: Array.isArray(parsed.features) && parsed.features.length ? parsed.features : fallback.features,
    goals: Array.isArray(parsed.goals) && parsed.goals.length ? parsed.goals : fallback.goals,
    pros: Array.isArray(parsed.pros) && parsed.pros.length ? parsed.pros : fallback.pros,
    cons: Array.isArray(parsed.cons) && parsed.cons.length ? parsed.cons : fallback.cons,
  };
}

const FALLBACK_SEEDS = [
  { title: '몰입형 회고 경험', desc: '하루나 한 주를 시각적으로 돌아볼 수 있는 인터랙티브 회고 서비스다. 감정, 성취, 실수를 타임라인으로 정리해 자기 이해와 성장을 돕는다.' },
  { title: '지역 커뮤니티 연결', desc: '같은 동네 사람들이 재능, 물건, 정보를 나눌 수 있는 하이퍼로컬 매칭 플랫폼이다. 온라인 연결이 오프라인 만남으로 이어지도록 설계해 이웃 신뢰를 높인다.' },
  { title: 'AI 개인화 도우미', desc: '사용자의 패턴과 맥락을 학습해 맞춤 제안을 제공하는 AI 어시스턴트다. 반복적인 결정 피로를 줄이고 일상을 더 효율적으로 만든다.' },
  { title: '감정 기반 기록', desc: '텍스트, 사진, 음성으로 감정 상태를 기록하고 패턴을 분석하는 앱이다. 감정 언어를 키워드로 분류해 자기 인식과 정신 건강을 지원한다.' },
  { title: '세대 연결 플랫폼', desc: '청년과 노년이 기술과 경험을 교환하는 세대 간 멘토링 서비스다. 디지털 격차를 줄이면서 세대 상호 이해를 높인다.' },
  { title: '건강 루틴 코칭', desc: '사용자의 생활 패턴을 분석해 지속 가능한 건강 루틴을 제안하는 코칭 서비스다. 목표 설정부터 습관 추적까지 무리 없이 실천할 수 있도록 돕는다.' },
  { title: '지속가능 생활 서비스', desc: '일상 속 탄소 발자국을 줄이기 위한 실천 가이드와 친환경 대안을 제공한다. 환경 친화적 선택을 쉽고 재미있게 만들어 지속적인 참여를 유도한다.' },
  { title: '공간 기반 큐레이션', desc: '사용자의 위치와 맥락에 맞는 장소, 콘텐츠, 경험을 큐레이션하는 서비스다. 지역 정보와 개인 취향을 결합해 발견의 즐거움을 제공한다.' },
  { title: '창작 지원 도구', desc: '글, 그림, 음악 등 다양한 창작 과정을 돕는 AI 협업 도구다. 아이디어 발산부터 완성까지 창작자의 작업 흐름에 자연스럽게 통합된다.' },
  { title: '사용자 여정 개선', desc: '복잡한 서비스에서 사용자가 겪는 불편 지점을 찾아 개선하는 UX 지원 서비스다. 여정 지도 작성과 데이터 분석으로 핵심 개선 기회를 발견한다.' },
  { title: '데이터 기반 추천', desc: '사용자 행동 데이터를 학습해 최적의 콘텐츠, 제품, 경험을 추천하는 엔진이다. 명시적 선호와 암묵적 패턴을 결합해 추천 정확도를 높인다.' },
  { title: '생활 루틴 자동화', desc: '반복되는 일상 업무를 자동화해 시간과 인지 부담을 줄이는 서비스다. 사용자의 루틴을 학습하고 상황에 맞게 자동 실행하도록 설계한다.' },
  { title: '가족 협업 서비스', desc: '가족 구성원이 일정, 할 일, 추억을 함께 관리할 수 있는 프라이빗 협업 툴이다. 세대 차이를 고려한 UI로 모든 가족이 편하게 사용할 수 있다.' },
  { title: '오프라인 접점 강화', desc: '디지털 서비스와 현실 경험을 연결해 오프라인에서도 일관된 브랜드 경험을 제공한다. QR, NFC, 위치 기반 트리거로 온오프라인 경계를 허무는 서비스다.' },
  { title: '실시간 피드백', desc: '사용자 행동이나 창작물에 즉각적인 피드백을 제공하는 실시간 분석 서비스다. 지연 없는 피드백 루프로 학습 속도와 결과물 품질을 높인다.' },
  { title: '개인 기록 아카이브', desc: '사진, 메모, 영수증, 대화 기록 등 일상의 모든 조각을 체계적으로 보관한다. AI 태깅과 검색 기능으로 필요한 기억을 언제든 꺼낼 수 있다.' },
  { title: '참여형 커뮤니티', desc: '공동 목표를 가진 사람들이 함께 도전하고 결과를 공유하는 커뮤니티 플랫폼이다. 투명한 진척 공유와 상호 응원이 장기적인 참여 동기를 만든다.' },
  { title: '감성 인터페이스', desc: '사용자의 감정 상태에 따라 색조, 콘텐츠, 인터랙션이 변하는 감성 반응형 UI다. 기능 너머 정서적 연결감을 중심에 두는 경험 설계를 지향한다.' },
  { title: '접근성 개선', desc: '시각, 청각, 운동 장애를 가진 사용자도 불편 없이 이용할 수 있는 서비스를 설계한다. WCAG 기준을 넘어 실제 사용자 맥락에 맞는 접근성 경험을 구현한다.' },
  { title: '지역 자원 매칭', desc: '지역 내 유휴 자원(공간, 도구, 기술)과 필요한 사람을 연결하는 공유 플랫폼이다. 자원 낭비를 줄이고 지역 경제 순환을 활성화한다.' },
  { title: '구독형 케어', desc: '사용자의 상황에 맞게 주기적으로 맞춤 서비스를 제공하는 케어 구독 모델이다. 반응적 요청이 아닌 선제적 케어로 삶의 질을 높인다.' },
  { title: '맞춤형 알림', desc: '사용자가 필요할 때 딱 필요한 정보만 전달하는 스마트 알림 시스템이다. 알림 피로를 최소화하면서 중요한 순간에 정확히 개입한다.' },
  { title: '행동 변화 설계', desc: '원하는 습관을 형성하도록 심리 원리 기반의 단계적 행동 변화 프로그램을 제공한다. 작은 성공 경험을 쌓아 지속 가능한 변화를 만들어간다.' },
  { title: '리워드 챌린지', desc: '목표 달성에 따라 포인트, 뱃지, 특전을 제공하는 게임화된 동기 부여 시스템이다. 혼자 하기 어려운 목표를 커뮤니티와 함께 이겨내는 챌린지 구조를 가진다.' },
  { title: '전문가 연결', desc: '특정 분야의 전문가와 일반 사용자를 연결하는 온디맨드 자문 플랫폼이다. 짧은 상담부터 장기 멘토링까지 다양한 연결 방식을 지원한다.' },
  { title: '상황 인식 서비스', desc: '사용자의 위치, 시간, 행동을 파악해 문맥에 맞는 서비스를 자동 제공한다. 능동적 입력 없이도 상황에 최적화된 경험을 만든다.' },
  { title: '콘텐츠 자동 생성', desc: '사용자 데이터와 AI를 결합해 개인화된 콘텐츠를 자동으로 생성하는 서비스다. 반복 작업을 줄이고 창의적 가치에 집중할 수 있는 시간을 만든다.' },
  { title: '경험 데이터 시각화', desc: '사용자의 행동, 감정, 성과 데이터를 직관적인 시각화로 제공하는 대시보드다. 숫자를 넘어 의미 있는 인사이트를 쉽게 이해하도록 디자인된다.' },
  { title: '온보딩 코칭', desc: '새로운 서비스를 처음 접하는 사용자가 빠르게 가치를 경험하도록 단계별로 안내한다. 개인 목표와 수준에 맞게 온보딩 경로를 동적으로 조정한다.' },
  { title: '공유형 마켓플레이스', desc: '개인이 가진 물건, 기술, 공간을 다른 사람과 거래하거나 빌릴 수 있는 P2P 마켓이다. 신뢰 기반 거래 시스템으로 안전한 공유 경제를 실현한다.' },
  { title: '협업형 기록', desc: '팀이 함께 아이디어, 결정, 진행 과정을 기록하고 공유하는 협업 문서 툴이다. 비동기 커뮤니케이션을 지원해 원격 팀의 협업 효율을 높인다.' },
  { title: '마이크로 러닝', desc: '바쁜 일상 속에서 5분 이내의 짧은 학습 모듈로 지식을 쌓는 마이크로 러닝 플랫폼이다. 스낵형 콘텐츠와 반복 학습으로 장기 기억 형성을 돕는다.' },
  { title: '공간 체험 설계', desc: '전시, 팝업, 매장 공간의 사람-환경 상호작용을 설계하는 공간 경험 서비스다. 동선, 감각 요소, 감정 흐름을 고려해 기억에 남는 공간 경험을 만든다.' },
  { title: '안전 모니터링', desc: '가정, 직장, 공공장소의 안전 위험 요소를 실시간으로 감지하고 알림을 보내는 시스템이다. 사고를 사전에 예방하고 위기 상황에 신속 대응할 수 있도록 지원한다.' },
  { title: '프라이버시 보호', desc: '사용자 데이터를 최소 수집하고 투명하게 관리하는 프라이버시 중심 서비스 설계다. 데이터 주권을 사용자에게 돌려주면서도 개인화 경험을 제공한다.' },
  { title: '세대 간 연결', desc: '서로 다른 세대가 공통 관심사를 통해 이어지는 문화 교류 플랫폼이다. 각 세대의 강점을 나누며 사회적 고립을 줄이고 유대감을 형성한다.' },
  { title: '빠른 검증 도구', desc: '초기 아이디어나 프로토타입을 빠르게 실제 사용자에게 테스트하는 린 검증 툴이다. 낮은 비용으로 가장 위험한 가정을 빠르게 확인하는 실험을 지원한다.' },
  { title: '맞춤 템플릿', desc: '사용자의 목적과 스타일에 맞는 문서, 디자인, 프로세스 템플릿을 제공하는 서비스다. 처음부터 시작하는 부담을 줄이고 빠른 시작을 가능하게 한다.' },
  { title: 'AI 상담 흐름', desc: '사용자의 상황과 감정을 파악해 공감적이고 맞춤화된 상담을 제공하는 AI 서비스다. 전문 상담사 연결 전 초기 지원과 안전망 역할을 한다.' },
  { title: '프로토타입 실험', desc: '빠른 프로토타입 제작과 반복 실험을 지원하는 린 개발 도구다. 가설 설정부터 결과 분석까지 실험 사이클을 단축해 혁신 속도를 높인다.' },
  { title: '브랜드 경험 확장', desc: '오프라인, 온라인, 소셜 미디어에서 일관된 브랜드 경험을 설계하는 전략 서비스다. 모든 접점에서 브랜드 가치를 일관되게 전달하는 통합 경험을 만든다.' },
];

const makeFallbackListItems = (count) => Array.from({ length: count }, (_, index) => {
  const seed = FALLBACK_SEEDS[index % FALLBACK_SEEDS.length];
  return {
    title: seed.title,
    desc: seed.desc,
    keywords: ['#AI', '#Service'],
    stars: 0,
  };
});

const normalizeGeneratedListIdea = (idea, index, fallbackItems) => {
  const fb = fallbackItems[index % fallbackItems.length];
  const rawScores = idea?.scores || {};
  const rawMetrics = idea?.metrics || {};
  const title = idea?.title || fb.title;
  const desc = idea?.summary || idea?.desc || fb.desc;

  return {
    id: index + 1,
    tag: (idea?.category || idea?.tag || idea?.titleEn || title || `IDEA_${index + 1}`)
      .replace(/[^A-Za-z0-9가-힣]+/g, '_').toUpperCase().slice(0, 22),
    title,
    desc,
    description: idea?.description || idea?.desc || '',
    summary: desc,
    keywords: normalizeKeywords(idea?.tags || idea?.keywords, ['#AI', '#Generated']),
    stars: 0,
    metrics: normalizeMetrics({
      feasibility: rawScores.feasibility ?? rawMetrics.feasibility,
      userValue: rawScores.userValue ?? rawMetrics.userValue,
      originality: rawScores.innovation ?? rawMetrics.originality,
      costEfficiency: rawScores.marketPotential ?? rawMetrics.costEfficiency,
      sustainability: rawMetrics.sustainability,
      spaceEfficiency: rawMetrics.spaceEfficiency,
      privacy: rawMetrics.privacy,
      community: rawMetrics.community,
    }, hashScore(title || index)),
    aiGenerated: true,
  };
};

export async function requestGeminiIdeaList({ count = 9, projectContext = getProjectContext(), onProgress } = {}) {
  const fallbackItems = makeFallbackListItems(count);

  if (typeof onProgress === 'function') {
    const results = new Array(count);
    let nextIndex = 0;
    const workerCount = Math.min(4, count);

    const runWorker = async () => {
      while (nextIndex < count) {
        const index = nextIndex;
        nextIndex += 1;
        const prompt = `${buildPrompt({
          text: `${projectContext.idea || ''}\n\n중복 없이 ${count}개 중 ${index + 1}번째 아이디어를 생성하세요.`,
          mode: 'list',
          projectContext,
          count: 1,
        })}\n\n추가 지시: 이 응답은 전체 ${count}개 중 ${index + 1}번째 카드입니다. 앞선 카드와 겹치지 않도록 다른 타깃, 가치, 구현 접근을 택하세요.`;
        const parsed = await requestGeminiJson(prompt);
        const raw = Array.isArray(parsed) ? parsed[0] : Array.isArray(parsed?.ideas) ? parsed.ideas[0] : null;
        const idea = normalizeGeneratedListIdea(raw || fallbackItems[index], index, fallbackItems);
        results[index] = idea;
        onProgress(idea, index, count);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, runWorker));
    return results.filter(Boolean);
  }

  const prompt = buildPrompt({ text: projectContext.idea, mode: 'list', projectContext, count });
  const parsed = await requestGeminiJson(prompt);
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.ideas) ? parsed.ideas : [];
  const base = [...items, ...fallbackItems].slice(0, count).map((idea, index) => {
    const fb = fallbackItems[index];
    return {
      title: idea.title || fb.title,
      desc: idea.summary || idea.desc || fb.desc,
      description: idea.description || idea.desc || '',
      keywords: idea.tags || idea.keywords || fb.keywords,
      category: idea.category || idea.tag || '',
      titleEn: idea.titleEn || '',
      scores: idea.scores || {},
      metrics: idea.metrics || {},
      stars: 0,
    };
  });

  return base.slice(0, count).map((idea, index) => normalizeGeneratedListIdea(idea, index, fallbackItems));
}

export async function requestGeminiAxisPlacement({ ideas, xAxis, yAxis, onProgress } = {}) {
  const WORLD_W = 3600;
  const WORLD_H = 2600;
  const MARGIN_X = 200;
  const MARGIN_Y = 200;

  const summaries = ideas.map(idea => ({
    id: idea.id,
    title: idea.title,
    summary: idea.summary || idea.desc || '',
  }));

  const prompt = [
    '당신은 아이디어 배치 전문가입니다.',
    `아래 아이디어 목록을 두 개의 축 기준으로 각각 0~100 점수를 부여해주세요.`,
    '',
    `X축 기준 (높을수록 오른쪽): ${xAxis}`,
    `Y축 기준 (높을수록 위쪽): ${yAxis}`,
    '',
    '평가 원칙:',
    '· 점수가 0~100 전 범위에 고르게 분포되도록 변별력 있게 평가하세요.',
    '· 모든 점수가 50 근처에 몰리지 않도록 주의하세요.',
    '· X축과 Y축은 독립적으로 평가하세요.',
    '',
    '아이디어 목록:',
    JSON.stringify(summaries),
    '',
    '출력 형식 (JSON 배열만, 마크다운 없이):',
    '[{"id": 1, "xScore": 75, "yScore": 42}, ...]',
  ].join('\n');

  const parsed = await requestGeminiJson(prompt);
  const scores = Array.isArray(parsed) ? parsed : [];

  const scoreMap = {};
  scores.forEach(item => {
    if (item.id != null) {
      scoreMap[item.id] = {
        xScore: Math.max(0, Math.min(100, Number(item.xScore) || 50)),
        yScore: Math.max(0, Math.min(100, Number(item.yScore) || 50)),
      };
    }
  });

  const placed = [];
  return ideas.map((idea, index) => {
    const s = scoreMap[idea.id] ?? { xScore: 30 + (index * 13) % 60, yScore: 25 + (index * 17) % 65 };
    const angle = index * 2.399963;
    const jitter = 80 + (index % 9) * 25;

    let wx = MARGIN_X + (s.xScore / 100) * WORLD_W + Math.cos(angle) * jitter;
    let wy = MARGIN_Y + ((100 - s.yScore) / 100) * WORLD_H + Math.sin(angle) * jitter;

    for (let attempt = 0; attempt < 14; attempt++) {
      const close = placed.find(p => Math.hypot(p.wx - wx, p.wy - wy) < 300);
      if (!close) break;
      const pushAngle = angle + attempt * 0.88;
      wx += Math.cos(pushAngle) * 200;
      wy += Math.sin(pushAngle) * 200;
    }

    wx = Math.round(Math.max(80, Math.min(3840, wx)));
    wy = Math.round(Math.max(80, Math.min(2860, wy)));
    placed.push({ wx, wy });
    onProgress?.(index + 1, ideas.length);

    return { ...idea, wx, wy };
  });
}

export function toCanvasIdeas(ideas, count = 40) {
  const sourceIdeas = ideas.length >= count ? ideas : [
    ...ideas,
    ...Array.from({ length: count - ideas.length }, (_, index) => makeFallbackIdea({
      text: `확장 아이디어 ${index + 1}`,
      projectContext: getProjectContext(),
    })),
  ];
  const projectContext = getProjectContext();
  const xMetric = getAxisMetricKey(projectContext.axes?.xAxis, 'feasibility');
  const yMetric = getAxisMetricKey(projectContext.axes?.yAxis, 'userValue');
  const originX = 80;
  const originY = 80;
  const spanX = 3740;
  const spanY = 2800;
  const placed = [];

  return sourceIdeas.slice(0, count).map((idea, index) => {
    const metrics = normalizeMetrics(idea.metrics, hashScore(idea.title || index));
    const xScore = metrics[xMetric] ?? 55;
    const yScore = metrics[yMetric] ?? 55;
    const band = index % 10;
    const ring = Math.floor(index / 10);
    const angle = index * 2.399963 + ring * 0.72;
    const jitter = 260 + band * 56;
    let wx = originX + (xScore / 100) * spanX + Math.cos(angle) * jitter + ((index % 4) - 1.5) * 130;
    let wy = originY + ((100 - yScore) / 100) * spanY + Math.sin(angle) * jitter + ((Math.floor(index / 4) % 4) - 1.5) * 130;

    for (let attempt = 0; attempt < 18; attempt += 1) {
      const close = placed.find(point => Math.hypot(point.wx - wx, point.wy - wy) < 500);
      if (!close) break;
      const pushAngle = angle + attempt * 0.85;
      wx += Math.cos(pushAngle) * 210;
      wy += Math.sin(pushAngle) * 210;
    }

    wx = Math.round(Math.max(80, Math.min(3840, wx)));
    wy = Math.round(Math.max(80, Math.min(2860, wy)));
    placed.push({ wx, wy });

    const full = makeFallbackIdea({
      text: idea.title,
      projectContext,
      wx,
      wy,
    });
    return {
      ...full,
      ...idea,
      id: idea.id || full.id,
      tag: idea.tag || full.tag,
      title: idea.title || full.title,
      desc: idea.desc || idea.summary || full.desc,
      summary: idea.summary || idea.desc || full.summary,
      keywords: (idea.keywords?.length ? idea.keywords : null) || full.keywords,
      stars: idea.stars ?? 0,
      wx: idea.wx ?? wx,
      wy: idea.wy ?? wy,
      metrics,
      pros: idea.pros || full.pros,
      cons: idea.cons || full.cons,
      features: idea.features || full.features,
      goals: idea.goals || full.goals,
      aiGenerated: idea.aiGenerated ?? false,
      showAiBadge: idea.showAiBadge ?? false,
    };
  });
}
