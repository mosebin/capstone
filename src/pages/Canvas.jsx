import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import CanvasSidebar from '../components/CanvasSidebar';
import IdeaDetailPanel from '../components/IdeaDetailPanel';
import AxisSetupModal from './AxisModal';
import {
  AXIS_DEFINITIONS,
  buildCritiqueTopics,
  getEvaluationScore,
  getProjectContext,
  loadCanvasWorkspace,
  loadGeneratedIdeas,
  requestGptCritique,
  requestGptIdea,
  requestGptProjectThumbnail,
  requestFinalPlan,
  normalizeAxisId,
  saveCanvasWorkspace,
  saveGeneratedIdeas,
  saveProjectContext,
  toCanvasIdeas,
} from '../lib/gpt';
import { logEvent } from '../lib/eventLogger';
import { downloadTextFile, makeFinalPlanText, safeFinalPlanFileName } from '../lib/finalPlan';
import { saveFinalPlanDocument } from '../lib/firebase';
import { readIdeaDetailCache } from '../lib/ideaDetailCache';

const WORLD_W = 4000;
const WORLD_H = 3000;
const IDEA_CARD_W = 240;
const IDEA_CARD_H = 150;
const IDEA_MIN_CENTER_GAP = 560;
const CHILD_IDEA_INPUT_ENABLED = false;
const FIXED_IDEA_COUNT = 20;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const parseIdeaDraft = (text) => {
  const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const title = (lines[0] || '새 아이디어').slice(0, 32);
  const body = (lines.slice(1).join(' ') || lines[0] || '새 아이디어를 더 구체화하세요.').slice(0, 120);
  return { title, body };
};

const IDEAS = [
  { id: 1, tag: 'IMMERSIVE_TECH', stars: 5, title: '가상현실 기반 회고록', summary: '과거 공간을 VR로 복원해 몰입형 자서전 제작', desc: '사용자가 과거에 살던 동네나 소중한 장소를 가상 현실로 복원하여 직접 거닐며 회고하는 체험형 기록 방식. 음성 인식과 이미지 생성 AI를 결합하여 개인 기억을 입체적 공간으로 변환합니다.', keywords: ['#VR', '#Memory', '#SpatialAI'], wx: 2200, wy: 300, metrics: { feasibility: 65, userValue: 88, originality: 92, costEfficiency: 40, sustainability: 60, spaceEfficiency: 50, privacy: 70, community: 55 }, pros: ['감정적 몰입도 극대화', '고령층 전용 고부가가치', '차별화된 포지셔닝'], cons: ['VR 기기 보급률 한계', '높은 초기 개발 비용', '콘텐츠 제작 복잡성'], features: ['맞춤형 과거 공간 복원', '실시간 음성-데이터 변환'], goals: ['기억을 3차원 공간 경험으로 확장하여, 휘발되기 쉬운 개인의 역사를 더 정밀하게 보존', '가상 공간으로 구현되는 과정을 통해 노인 사용자가 삶의 의미를 재발견하고 심리적 만족감 경험', '자연스러운 행위만으로 고품질의 자서전 데이터를 구축'] },
  { id: 2, tag: 'URBAN_GARDEN', stars: 5, title: '도시 농업 공유 플랫폼', summary: '유휴 공간에서 이웃과 함께 식물을 재배·공유', desc: '0.9m × 1.5m 모듈 온실에 자동 급수, 보광 LED, 환기 팬이 내장되어 있어 도심 아파트에서도 토마토·허브를 연 3회 수확합니다. IoT 앱으로 상태를 모니터링합니다.', keywords: ['#UrbanFarming', '#Community', '#IoT'], wx: 1500, wy: 720, metrics: { feasibility: 70, userValue: 65, originality: 60, costEfficiency: 50, sustainability: 85, spaceEfficiency: 60, privacy: 40, community: 45 }, pros: ['지속가능한 도시 생태계', '커뮤니티 형성 촉진', '식량 자급률 향상'], cons: ['초기 인프라 비용', '관리 지속성 문제', '기상 의존도'], features: ['모듈형 스마트 온실 시스템', '이웃 농작물 공유·거래 플랫폼'], goals: ['도심 식물 재배 접근성 향상', '이웃 간 자원 순환 문화 형성', '도시 탄소 발자국 감소에 기여'] },
  { id: 3, tag: 'HEALTHY_SLEEP', stars: 5, title: '개인 맞춤 수면 코칭', summary: '웨어러블 기반 수면 분석 및 맞춤 개선 가이드', desc: '수면 패턴을 분석하여 최적의 수면 환경과 습관을 제안하는 웨어러블 연동 건강 관리 앱. 심박수·뇌파·체온 데이터를 통합하여 개인화된 수면 개선 프로그램을 제공합니다.', keywords: ['#SleepCare', '#HealthTech', '#Wearable'], wx: 2700, wy: 1200, metrics: { feasibility: 82, userValue: 78, originality: 55, costEfficiency: 68, sustainability: 70, spaceEfficiency: 90, privacy: 55, community: 30 }, pros: ['검증된 시장 수요', '반복 사용 유도', '데이터 축적 가치'], cons: ['웨어러블 의존성', '경쟁 서비스 포화', '개인정보 민감도'], features: ['웨어러블 수면 데이터 실시간 분석', '맞춤형 수면 루틴·환경 제안'], goals: ['개인 수면 패턴 정밀 분석', '건강한 수면 습관 정착 지원', '수면 관련 건강 위험 조기 감지'] },
  { id: 4, tag: 'MINDFUL_EATS', stars: 4, title: '명상 음식 추천 앱', summary: '기분과 신체 상태 기반 건강 식단 큐레이션', desc: '기분과 신체 상태에 맞춰 건강한 식단과 레시피를 제공하는 모바일 앱. 감정 로그와 영양 데이터를 결합해 스트레스 완화·집중력 향상에 특화된 음식을 추천합니다.', keywords: ['#Wellness', '#HealthyEating', '#MoodAI'], wx: 550, wy: 1450, metrics: { feasibility: 72, userValue: 60, originality: 65, costEfficiency: 75, sustainability: 68, spaceEfficiency: 88, privacy: 60, community: 42 }, pros: ['낮은 진입 비용', '일상 밀착형 서비스', '광고 수익 가능'], cons: ['음식 데이터 정확성', '개인화 한계', '식문화 차이 대응'], features: ['감정 기반 식단 큐레이션 AI', '영양 균형 분석 및 레시피 제공'], goals: ['일상 속 건강 식습관 정착', '감정과 식이의 연관성 인식 강화', '웰빙 라이프스타일 지원'] },
  { id: 5, tag: 'AI_STORYTELLER', stars: 5, title: '인공지능 스토리텔링', summary: '사용자 입력 기반 AI 창작물 자동 생성 도구', desc: '사용자의 입력을 바탕으로 창의적인 이야기나 글을 자동 생성해주는 AI 기반 콘텐츠 제작 도구. GPT 기반 엔진과 스타일 전이 기술을 활용해 소설·시나리오·시 등 다양한 포맷을 지원합니다.', keywords: ['#AI', '#CreativeWriting', '#GPT'], wx: 3000, wy: 380, metrics: { feasibility: 88, userValue: 82, originality: 75, costEfficiency: 70, sustainability: 65, spaceEfficiency: 92, privacy: 72, community: 58 }, pros: ['광범위한 사용자층', '빠른 출시 가능', 'API 수익화 용이'], cons: ['저작권 이슈', '품질 일관성', '기존 창작자와의 충돌'], features: ['GPT 기반 콘텐츠 자동 생성', '소설·시나리오·시 다양한 포맷 지원'], goals: ['창작 진입장벽 해소', 'AI 협업 창작 문화 정착', '개인 맞춤 스토리 아카이브 구축'] },
  { id: 6, tag: 'GREEN_FASHION', stars: 5, title: '친환경 패션 플랫폼', summary: '재활용 소재 기반 지속가능 패션 마켓플레이스', desc: '재활용 소재와 친환경 공정을 활용한 패션 제품을 소개하고 판매하는 마켓플레이스. 탄소 발자국 계산기와 소재 인증 시스템으로 투명한 구매 결정을 지원합니다.', keywords: ['#Sustainable', '#EcoFashion', '#Circular'], wx: 1300, wy: 450, metrics: { feasibility: 75, userValue: 72, originality: 68, costEfficiency: 55, sustainability: 92, spaceEfficiency: 70, privacy: 78, community: 65 }, pros: ['ESG 트렌드 수혜', '브랜드 차별화', '정부 지원 가능성'], cons: ['프리미엄 가격 저항', '공급망 관리 복잡성', '소비자 인식 변화 필요'], features: ['탄소 발자국 인증 시스템', '리사이클 소재 브랜드 큐레이션'], goals: ['패션 업계 지속가능성 촉진', '소비자 친환경 구매 인식 강화', '순환 경제 패션 생태계 구축'] },
  { id: 7, tag: 'SOUND_HEALING', stars: 4, title: '소리 치유 명상 앱', summary: '자연음과 음악 조합으로 스트레스 완화 명상 가이드', desc: '자연의 소리와 음악을 조합하여 스트레스 완화와 집중력 향상을 돕는 명상 가이드. 뇌파 동조 기술(바이노럴 비트)을 활용해 알파파·세타파 유도 프로그램을 제공합니다.', keywords: ['#Mindfulness', '#SoundTherapy', '#Binaural'], wx: 1960, wy: 1080, metrics: { feasibility: 80, userValue: 70, originality: 62, costEfficiency: 78, sustainability: 72, spaceEfficiency: 90, privacy: 82, community: 48 }, pros: ['개발 비용 낮음', '구독 모델 적합', '글로벌 확장 용이'], cons: ['수익화 한계', '경쟁 앱 다수', '과학적 근거 요구'], features: ['바이노럴 비트 음향 설계', '개인 맞춤 명상 세션 생성'], goals: ['일상 스트레스 빠른 완화', '수면 전 이완 루틴 형성', '정서적 안정감 지속 지원'] },
  { id: 8, tag: 'SENIOR_EDU', stars: 5, title: '노인 디지털 교육', summary: '고령층 맞춤 IT 리터러시 향상 학습 서비스', desc: '60대 이상 사용자를 위한 단계별 디지털 기기 활용 교육 플랫폼. 큰 글씨·음성 안내·가족 학습 연동 기능으로 스마트폰·금융 앱·영상통화를 쉽게 익힐 수 있도록 지원합니다.', keywords: ['#SeniorTech', '#DigitalLiteracy', '#Inclusion'], wx: 2900, wy: 200, metrics: { feasibility: 85, userValue: 90, originality: 58, costEfficiency: 72, sustainability: 78, spaceEfficiency: 88, privacy: 75, community: 80 }, pros: ['사회적 임팩트 대', '정부 지원 가능', '충성 사용자층'], cons: ['학습 속도 개인차', '지속 운영 비용', '콘텐츠 주기적 업데이트'], features: ['단계별 디지털 기기 교육 커리큘럼', '가족 연동 학습 진도 모니터링'], goals: ['디지털 격차 해소', '고령층 스마트 서비스 자립 지원', '세대 간 디지털 소통 증진'] },
  { id: 9, tag: 'AR_HISTORY', stars: 4, title: 'AR 기반 역사 투어', summary: '스마트폰으로 역사 장소를 증강현실로 탐험', desc: '스마트폰 카메라로 역사적 장소를 비추면 과거 모습이 AR로 오버레이되는 투어 가이드 앱. GPS 기반 트리거와 AI 복원 이미지를 결합하여 교육적 체험 여행을 제공합니다.', keywords: ['#AR', '#Heritage', '#EdTech'], wx: 1020, wy: 380, metrics: { feasibility: 68, userValue: 80, originality: 82, costEfficiency: 48, sustainability: 65, spaceEfficiency: 72, privacy: 68, community: 70 }, pros: ['관광산업 연계', '교육 기관 파트너십', '독창적 경험'], cons: ['콘텐츠 구축 비용', '배터리 소모 과다', '실내 GPS 정확도'], features: ['GPS 기반 AR 역사 오버레이', 'AI 복원 이미지 실시간 제공'], goals: ['역사 교육 몰입도 향상', '지역 문화유산 보존 인식 강화', '관광·교육 융합 경험 설계'] },
  { id: 10, tag: 'SMART_ENERGY', stars: 4, title: '스마트 홈 에너지 관리', summary: 'AI로 가정 에너지 소비를 자동 최적화', desc: 'AI가 가정의 전기 사용 패턴을 학습해 냉난방·조명을 자동 최적화하는 스마트 홈 플랫폼. 태양광 연동·전기요금 예측·이웃 간 에너지 거래 기능을 통합합니다.', keywords: ['#SmartHome', '#EnergyAI', '#Sustainability'], wx: 2550, wy: 1520, metrics: { feasibility: 78, userValue: 74, originality: 60, costEfficiency: 65, sustainability: 90, spaceEfficiency: 80, privacy: 50, community: 55 }, pros: ['전기요금 절감 직결', 'IoT 시장 성장', '탄소 크레딧 연계'], cons: ['스마트 기기 선결', '해킹 취약성', '설치 진입장벽'], features: ['AI 에너지 사용 패턴 학습', '태양광·그리드 연동 자동 최적화'], goals: ['가정 에너지 낭비 최소화', '탄소 중립 생활 실천 지원', '에너지 절감 데이터 시각화'] },
  { id: 11, tag: 'PLANT_SWAP', stars: 3, title: '커뮤니티 식물 교환', summary: '지역 주민 간 화분·씨앗 교환 소셜 플랫폼', desc: '지역 내 식물 애호가들이 화분·씨앗·삽목 등을 무료로 교환하는 하이퍼로컬 소셜 서비스. 식물 케어 팁 공유·이웃 나눔 인증 배지 시스템으로 커뮤니티를 활성화합니다.', keywords: ['#Community', '#PlantCare', '#Sharing'], wx: 340, wy: 860, metrics: { feasibility: 88, userValue: 58, originality: 55, costEfficiency: 85, sustainability: 80, spaceEfficiency: 82, privacy: 78, community: 90 }, pros: ['개발 비용 최소', '바이럴 성장 가능', '로컬 커뮤니티 강화'], cons: ['수익 모델 불명확', '규모 확장 한계', '계절 의존성'], features: ['하이퍼로컬 식물 교환 매칭', '식물 케어 커뮤니티 가이드'], goals: ['동네 자원 순환 문화 조성', '식물 기반 커뮤니티 연결 강화', '도시 녹지 확장 기여'] },
  { id: 12, tag: 'AI_HEALTH', stars: 5, title: 'AI 증상 분석 보조 앱', summary: '증상 입력 시 AI가 예비 진단 및 진료과 안내', desc: '사용자가 증상을 텍스트·음성으로 입력하면 AI가 가능한 질환을 분석하고 적절한 진료과와 응급 여부를 안내하는 헬스케어 보조 앱. 의료진 검토 시스템으로 신뢰도를 보완합니다.', keywords: ['#HealthAI', '#MedTech', '#Symptom'], wx: 2100, wy: 260, metrics: { feasibility: 62, userValue: 92, originality: 70, costEfficiency: 45, sustainability: 75, spaceEfficiency: 90, privacy: 45, community: 38 }, pros: ['의료 접근성 향상', '응급 대응 신속화', '빅데이터 가치'], cons: ['의료법 규제', '오진 리스크', '의료진 신뢰 확보'], features: ['텍스트·음성 증상 입력 AI 분석', '응급 여부 및 진료과 안내'], goals: ['의료 접근성 불평등 해소', '1차 의료 상담 효율화', '응급 상황 초기 대응 지원'] },
  { id: 13, tag: 'ZERO_WASTE', stars: 4, title: '제로웨이스트 장보기', summary: '포장재 없는 상품과 친환경 매장을 연결', desc: '소비자와 포장재 없는 상품·리필 스테이션·친환경 매장을 연결하는 제로웨이스트 쇼핑 가이드. 구매 이력 기반 탄소 절감량 시각화와 커뮤니티 챌린지 기능을 제공합니다.', keywords: ['#ZeroWaste', '#EcoShopping', '#Carbon'], wx: 1600, wy: 1400, metrics: { feasibility: 76, userValue: 68, originality: 65, costEfficiency: 70, sustainability: 92, spaceEfficiency: 85, privacy: 75, community: 68 }, pros: ['친환경 소비 트렌드', '파트너 매장 유치 용이', 'ESG 마케팅 가치'], cons: ['친환경 매장 수 제한', '사용자 행동 변화 필요', '수익 모델 약함'], features: ['포장재 없는 상품 매장 연결', '탄소 절감량 구매 이력 추적'], goals: ['쓰레기 없는 소비 문화 확산', '소비자 환경 행동 가시화', '친환경 매장 생태계 성장 지원'] },
  { id: 14, tag: 'PET_CARE', stars: 4, title: '반려동물 케어 플랫폼', summary: '건강관리·산책 매칭·진료 예약 올인원 서비스', desc: '반려동물의 건강 기록 관리·동네 산책 메이트 매칭·수의사 원격 상담·펫시터 예약까지 통합 제공하는 반려인 전용 플랫폼. AI 기반 증상 모니터링 기능을 포함합니다.', keywords: ['#PetTech', '#AnimalCare', '#Community'], wx: 2450, wy: 900, metrics: { feasibility: 84, userValue: 80, originality: 55, costEfficiency: 65, sustainability: 62, spaceEfficiency: 78, privacy: 65, community: 82 }, pros: ['반려인 시장 폭발 성장', '구독 수익 안정적', '커뮤니티 락인'], cons: ['수의사 네트워크 구축', '경쟁 앱 증가', '동물 데이터 표준화'], features: ['건강 기록·AI 증상 모니터링', '수의사 원격 상담·펫시터 매칭'], goals: ['반려동물 건강 관리 접근성 향상', '반려인 커뮤니티 신뢰 구축', '반려동물 의료 정보 표준화'] },
  { id: 15, tag: 'METAVERSE_ART', stars: 3, title: '메타버스 예술 전시', summary: '가상 갤러리에서 NFT 기반 예술 작품 전시·판매', desc: '신진 예술가들이 메타버스 공간에서 작품을 전시하고, 관람객이 아바타로 갤러리를 탐방하며 NFT로 구매하는 플랫폼. 물리적 갤러리와 연동한 하이브리드 전시 경험을 제공합니다.', keywords: ['#Metaverse', '#NFT', '#DigitalArt'], wx: 380, wy: 1680, metrics: { feasibility: 55, userValue: 65, originality: 85, costEfficiency: 42, sustainability: 50, spaceEfficiency: 88, privacy: 72, community: 75 }, pros: ['창작자 경제 활성화', '공간 제약 없음', 'NFT 신성장'], cons: ['메타버스 인프라 미성숙', '크립토 시장 변동성', '높은 기술 장벽'], features: ['메타버스 갤러리 전시 공간', 'NFT 기반 작품 거래 플랫폼'], goals: ['신진 예술가 전시 기회 확대', '예술 소비의 공간적 한계 해소', '디지털 예술 경제 생태계 형성'] },
  { id: 16, tag: 'LOCAL_CURRENCY', stars: 4, title: '지역화폐 플랫폼', summary: '지역 상권 활성화 블록체인 기반 화폐 서비스', desc: '지역 상권과 소비자를 연결하는 블록체인 기반 지역화폐 플랫폼. QR 코드 결제·지역 행사 참여 보상·상점 간 포인트 교환 기능으로 지역 경제 생태계를 구축합니다.', keywords: ['#LocalEconomy', '#Blockchain', '#FinTech'], wx: 1050, wy: 1560, metrics: { feasibility: 65, userValue: 72, originality: 62, costEfficiency: 55, sustainability: 78, spaceEfficiency: 82, privacy: 58, community: 88 }, pros: ['지자체 협력 가능', '상권 상생 가치', '소비 데이터 인사이트'], cons: ['블록체인 인식 저조', '규제 불확실성', '상점 온보딩 비용'], features: ['QR 코드 기반 지역화폐 결제', '지역 행사 참여 인센티브 시스템'], goals: ['지역 소상공인 매출 증대', '지역 경제 자립도 강화', '소비 데이터 기반 상권 분석 지원'] },
  { id: 17, tag: 'BIKE_SHARE', stars: 4, title: '스마트 공유 자전거', summary: '실시간 거치대 현황·추천 경로 자전거 공유 앱', desc: '도심 자전거 거치대 실시간 현황·최적 경로 추천·예약·반납 자동화를 제공하는 스마트 자전거 공유 앱. 전동 킥보드와 연계한 라스트마일 통합 이동 솔루션을 제공합니다.', keywords: ['#MicroMobility', '#SmartCity', '#LastMile'], wx: 3100, wy: 1350, metrics: { feasibility: 86, userValue: 74, originality: 50, costEfficiency: 70, sustainability: 88, spaceEfficiency: 75, privacy: 72, community: 65 }, pros: ['인프라 기구축', '탄소 저감 기여', '정부 스마트시티 예산'], cons: ['자전거 파손·분실', '계절 이용률 편차', '경쟁 서비스 포화'], features: ['실시간 거치대 현황 지도', '최적 경로·예약·반납 자동화'], goals: ['도심 교통 탄소 배출 저감', '라스트마일 이동 편의성 향상', '공유 모빌리티 데이터 인프라 구축'] },
  { id: 18, tag: 'EMOTION_DIARY', stars: 5, title: '감정 일기 AI 코치', summary: 'AI가 감정 패턴 분석 후 멘탈 케어 코칭 제공', desc: '매일 감정과 생각을 기록하면 AI가 패턴을 분석하여 스트레스 원인을 파악하고 인지행동치료(CBT) 기반 솔루션을 제안하는 멘탈 케어 앱. 감정 추이 시각화 대시보드를 포함합니다.', keywords: ['#MentalHealth', '#CBT', '#EmotionAI'], wx: 1850, wy: 460, metrics: { feasibility: 80, userValue: 85, originality: 72, costEfficiency: 68, sustainability: 70, spaceEfficiency: 88, privacy: 45, community: 52 }, pros: ['MZ세대 정서 공감', '구독 수익 확실', '사회적 가치 높음'], cons: ['개인정보 민감도 극도', '심리 전문가 협업 필요', '과의존 리스크'], features: ['CBT 기반 감정 패턴 분석 AI', '감정 추이 시각화 대시보드'], goals: ['일상 스트레스 원인 자기 인식', 'MZ세대 멘탈 헬스 케어 접근성 향상', '심리적 탄력성 회복 지원'] },
];

const AXIS_KOREAN_LABELS = Object.fromEntries(AXIS_DEFINITIONS.map(axis => [axis.id, axis.name_ko]));

const INITIAL_SPACES = [
  { id: 1, name: '아이디어 공간 1', xAxis: 'feasibility', yAxis: 'usefulness' },
];

function getInitialSpaces(workspace) {
  if (Array.isArray(workspace?.spaces) && workspace.spaces.length) {
    return workspace.spaces;
  }
  const axes = getProjectContext().axes;
  return axes?.xAxis && axes?.yAxis
    ? [{ ...INITIAL_SPACES[0], xAxis: axes.xAxis, yAxis: axes.yAxis }]
    : INITIAL_SPACES;
}

function getInitialActiveSpaceId(spaces, workspace) {
  const spaceList = Array.isArray(spaces) ? spaces : [];
  const savedActiveSpace = spaceList.find(space => String(space.id) === String(workspace?.activeSpaceId));
  return savedActiveSpace?.id ?? spaceList[spaceList.length - 1]?.id ?? INITIAL_SPACES[0].id;
}

function buildInitialCanvasIdeas(workspace, generatedIdeas = [], activeSpaceId = null) {
  const initialSpaces = getInitialSpaces(workspace);
  const axis = getCurrentAxis(initialSpaces, activeSpaceId ?? getInitialActiveSpaceId(initialSpaces, workspace));
  if (Array.isArray(workspace?.ideas) && workspace.ideas.length) {
    if (workspace.layoutVersion !== 2 && workspace.layoutVersion !== 3) {
      const migrationSource = generatedIdeas.length ? generatedIdeas : workspace.ideas;
      const withoutLegacyPositions = migrationSource.map((idea) => {
        const next = { ...idea };
        delete next.wx;
        delete next.wy;
        next.stars = Number(next.stars) === 1 ? 1 : 0;
        next.showAiBadge = ['regenerated', 'whitespace'].includes(next.aiBadgeType);
        return next;
      });
      return placeIdeasOnAxis(toCanvasIdeas(withoutLegacyPositions, withoutLegacyPositions.length), axis);
    }
    const generatedById = new Map(generatedIdeas.map(idea => [idea.id, idea]));
    const restored = workspace.ideas.map((idea) => {
      const latest = generatedById.get(idea.id);
      const merged = latest ? { ...latest, ...idea } : idea;
      return {
        ...merged,
        stars: Number(merged.stars) === 1 ? 1 : 0,
        showAiBadge: ['regenerated', 'whitespace'].includes(merged.aiBadgeType),
      };
    });
    const restoredIds = new Set(restored.map(idea => idea.id));
    const missingIdeas = generatedIdeas.filter(idea => !restoredIds.has(idea.id));
    const mergedIdeas = missingIdeas.length
      ? [...restored, ...toCanvasIdeas(missingIdeas, missingIdeas.length)]
      : restored;
    return placeIdeasOnAxis(mergedIdeas, axis);
  }
  const ideaCount = generatedIdeas.length || FIXED_IDEA_COUNT;
  const sourceIdeas = generatedIdeas.length
    ? toCanvasIdeas(generatedIdeas, ideaCount)
    : IDEAS.map(idea => ({ ...idea, stars: 0 }));
  return placeIdeasOnAxis(sourceIdeas, axis);
}

const getCurrentAxis = (spaces, activeSpaceId = null) => {
  const spaceList = Array.isArray(spaces) ? spaces : [];
  const active = spaceList.find(space => String(space.id) === String(activeSpaceId));
  const current = active || spaceList[spaceList.length - 1] || INITIAL_SPACES[0];
  const xAxis = normalizeAxisId(current.xAxis, 'feasibility');
  const yAxis = normalizeAxisId(current.yAxis, 'usefulness');
  return {
    xAxis,
    yAxis,
  };
};

const getAxisPositionForIdea = (idea, currentAxis, occupiedIdeas = []) => {
  const xScore = clamp(getEvaluationScore(idea, currentAxis.xAxis), 0, 100);
  const yScore = clamp(getEvaluationScore(idea, currentAxis.yAxis), 0, 100);
  let wx = 180 + (xScore / 100) * (WORLD_W - 600);
  let wy = 160 + ((100 - yScore) / 100) * (WORLD_H - 460);
  const seed = String(idea.id || idea.title || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const overlaps = occupiedIdeas.some(item => Math.hypot(
      item.wx + IDEA_CARD_W / 2 - (wx + IDEA_CARD_W / 2),
      item.wy + IDEA_CARD_H / 2 - (wy + IDEA_CARD_H / 2),
    ) < IDEA_MIN_CENTER_GAP);
    if (!overlaps) break;
    const angle = seed * 0.17 + attempt * 0.9;
    const distance = 220 + Math.floor(attempt / 7) * 110;
    wx += Math.cos(angle) * distance;
    wy += Math.sin(angle) * distance;
  }

  return {
    wx: Math.round(clamp(wx, 80, WORLD_W - IDEA_CARD_W - 80)),
    wy: Math.round(clamp(wy, 80, WORLD_H - IDEA_CARD_H - 80)),
  };
};

function getAxisScorePosition(idea, currentAxis) {
  return {
    x_axis: currentAxis.xAxis,
    y_axis: currentAxis.yAxis,
    x: getEvaluationScore(idea, currentAxis.xAxis),
    y: getEvaluationScore(idea, currentAxis.yAxis),
  };
}

function placeIdeasOnAxis(sourceIdeas = [], currentAxis = getCurrentAxis(INITIAL_SPACES)) {
  const placed = [];
  return sourceIdeas.map((idea) => {
    const nextPosition = getAxisPositionForIdea(idea, currentAxis, placed);
    const scorePosition = getAxisScorePosition(idea, currentAxis);
    const nextIdea = {
      ...idea,
      ...nextPosition,
      position: scorePosition,
      axisPosition: {
        xAxis: currentAxis.xAxis,
        yAxis: currentAxis.yAxis,
        xScore: scorePosition.x,
        yScore: scorePosition.y,
        wx: nextPosition.wx,
        wy: nextPosition.wy,
        locked: true,
      },
      positionLocked: true,
    };
    placed.push(nextIdea);
    return nextIdea;
  });
}

function buildAxisLayout(axis, axisIdeas) {
  return {
    locked: true,
    xAxis: axis.xAxis,
    yAxis: axis.yAxis,
    generatedAt: new Date().toISOString(),
    positions: axisIdeas.map(idea => ({
      id: idea.id,
      title: idea.title,
      wx: idea.wx,
      wy: idea.wy,
      xScore: idea.axisPosition?.xScore ?? idea.position?.x,
      yScore: idea.axisPosition?.yScore ?? idea.position?.y,
    })),
  };
}

const getSemanticBounds = (idea, scale) => {
  const effective = IDEA_CARD_W * scale;
  if (effective < 70) return { x: idea.wx + 108, y: idea.wy + 52, width: 14, height: 14 };
  if (effective < 140) return { x: idea.wx, y: idea.wy, width: 200, height: 38 };
  if (effective < 200) return { x: idea.wx, y: idea.wy, width: 230, height: 72 };
  return { x: idea.wx, y: idea.wy, width: IDEA_CARD_W, height: IDEA_CARD_H };
};

const getConnectionPoints = (from, to, scale) => {
  const fromBounds = getSemanticBounds(from, scale);
  const toBounds = getSemanticBounds(to, scale);
  const fromCenter = { x: fromBounds.x + fromBounds.width / 2, y: fromBounds.y + fromBounds.height / 2 };
  const toCenter = { x: toBounds.x + toBounds.width / 2, y: toBounds.y + toBounds.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (dx === 0 && dy === 0) return { start: fromCenter, end: toCenter };
  const getEdgePoint = (center, bounds, directionX, directionY) => {
    const tx = directionX ? (bounds.width / 2) / Math.abs(directionX) : Infinity;
    const ty = directionY ? (bounds.height / 2) / Math.abs(directionY) : Infinity;
    const ratio = Math.min(tx, ty);
    return { x: center.x + directionX * ratio, y: center.y + directionY * ratio };
  };
  return {
    start: getEdgePoint(fromCenter, fromBounds, dx, dy),
    end: getEdgePoint(toCenter, toBounds, -dx, -dy),
  };
};

const getVisibleBounds = (items) => {
  if (!items.length) return { minX: 0, maxX: WORLD_W, minY: 0, maxY: WORLD_H, width: WORLD_W, height: WORLD_H };
  const xs = items.flatMap(item => [item.wx, item.wx + IDEA_CARD_W]);
  const ys = items.flatMap(item => [item.wy, item.wy + IDEA_CARD_H]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

const getAreaForCluster = (items, id, label) => {
  const bounds = getVisibleBounds(items);
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;
  const maxCornerDistance = Math.max(
    0,
    ...items.flatMap(item => ([
      Math.hypot(item.wx - centerX, item.wy - centerY),
      Math.hypot(item.wx + IDEA_CARD_W - centerX, item.wy - centerY),
      Math.hypot(item.wx - centerX, item.wy + IDEA_CARD_H - centerY),
      Math.hypot(item.wx + IDEA_CARD_W - centerX, item.wy + IDEA_CARD_H - centerY),
    ])),
  );
  const diameter = clamp(maxCornerDistance * 2 + 140, 420, 1500);

  return {
    id,
    label,
    wx: clamp(centerX - diameter / 2, 0, WORLD_W - diameter),
    wy: clamp(centerY - diameter / 2, 0, WORLD_H - diameter),
    width: diameter,
    height: diameter,
    rotate: 0,
    color: '#CBFF00',
  };
};

const buildPositionClusters = (items) => {
  if (items.length < 2) return [];
  const clusterCount = clamp(Math.ceil(items.length / 5), 2, 7);
  const sorted = [...items].sort((a, b) => (a.wx + a.wy) - (b.wx + b.wy));
  let centroids = Array.from({ length: clusterCount }, (_, index) => {
    const seed = sorted[Math.floor((index / Math.max(1, clusterCount - 1)) * (sorted.length - 1))];
    return { x: seed.wx + IDEA_CARD_W / 2, y: seed.wy + IDEA_CARD_H / 2 };
  });

  let clusters = [];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    clusters = centroids.map(() => []);
    items.forEach((idea) => {
      const x = idea.wx + IDEA_CARD_W / 2;
      const y = idea.wy + IDEA_CARD_H / 2;
      const nearestIndex = centroids.reduce((nearest, centroid, index) => {
        const dist = Math.hypot(x - centroid.x, y - centroid.y);
        return dist < nearest.dist ? { index, dist } : nearest;
      }, { index: 0, dist: Infinity }).index;
      clusters[nearestIndex].push(idea);
    });
    centroids = clusters.map((cluster, index) => {
      if (!cluster.length) return centroids[index];
      return {
        x: cluster.reduce((sum, idea) => sum + idea.wx + IDEA_CARD_W / 2, 0) / cluster.length,
        y: cluster.reduce((sum, idea) => sum + idea.wy + IDEA_CARD_H / 2, 0) / cluster.length,
      };
    });
  }

  return clusters
    .filter(cluster => cluster.length >= 2)
    .sort((a, b) => {
      const aStats = getClusterStats(a);
      const bStats = getClusterStats(b);
      return aStats.cy - bStats.cy || aStats.cx - bStats.cx || b.length - a.length;
    });
};

const getClusterStats = (items) => {
  const cx = items.reduce((sum, item) => sum + item.wx + IDEA_CARD_W / 2, 0) / Math.max(items.length, 1);
  const cy = items.reduce((sum, item) => sum + item.wy + IDEA_CARD_H / 2, 0) / Math.max(items.length, 1);
  const radius = Math.max(
    0,
    ...items.map(item => Math.hypot((item.wx + IDEA_CARD_W / 2) - cx, (item.wy + IDEA_CARD_H / 2) - cy)),
  );
  return { cx, cy, radius };
};

const getAxisKoreanLabel = (axisName, fallback) => (
  AXIS_KOREAN_LABELS[normalizeAxisId(axisName, axisName)] ||
  fallback
);

const getScoreBand = (score) => {
  if (score < 35) return '낮음';
  if (score > 65) return '높음';
  return '중간';
};

const getWhitespaceAxisTarget = (area, currentAxis) => {
  const cardX = area.wx + area.width / 2 - IDEA_CARD_W / 2;
  const cardY = area.wy + area.height / 2 - IDEA_CARD_H / 2;
  const xScore = Math.round(clamp(((cardX - 180) / (WORLD_W - 600)) * 100, 0, 100));
  const yScore = Math.round(clamp(100 - ((cardY - 160) / (WORLD_H - 460)) * 100, 0, 100));
  return {
    xAxis: currentAxis.xAxis,
    yAxis: currentAxis.yAxis,
    xLabel: getAxisKoreanLabel(currentAxis.xAxis, currentAxis.xAxis),
    yLabel: getAxisKoreanLabel(currentAxis.yAxis, currentAxis.yAxis),
    xScore,
    yScore,
    xBand: getScoreBand(xScore),
    yBand: getScoreBand(yScore),
  };
};

const getNumericBand = (score) => {
  const start = Math.min(80, Math.floor(score / 20) * 20);
  return `${start}-${Math.min(100, start + 20)}`;
};

const withWhitespaceAxisEvaluation = (idea, target) => {
  const nextEvaluations = { ...(idea.evaluations || {}) };
  nextEvaluations[target.xAxis] = {
    ...(nextEvaluations[target.xAxis] || {}),
    score: target.xScore,
    band: getNumericBand(target.xScore),
    reasoning: `화이트 스페이스 위치에 맞춰 ${target.xLabel} ${target.xBand} 영역으로 배치했습니다.`,
  };
  nextEvaluations[target.yAxis] = {
    ...(nextEvaluations[target.yAxis] || {}),
    score: target.yScore,
    band: getNumericBand(target.yScore),
    reasoning: `화이트 스페이스 위치에 맞춰 ${target.yLabel} ${target.yBand} 영역으로 배치했습니다.`,
  };
  return {
    ...idea,
    evaluations: nextEvaluations,
    position: {
      x_axis: target.xAxis,
      y_axis: target.yAxis,
      x: target.xScore,
      y: target.yScore,
    },
    axisPosition: {
      xAxis: target.xAxis,
      yAxis: target.yAxis,
      xScore: target.xScore,
      yScore: target.yScore,
      locked: true,
    },
  };
};

const getPositionClusterName = (items, currentAxis) => {
  const { cx, cy, radius } = getClusterStats(items);
  const xState = cx < WORLD_W * 0.42 ? 'low' : cx > WORLD_W * 0.58 ? 'high' : 'mid';
  const yState = cy < WORLD_H * 0.42 ? 'high' : cy > WORLD_H * 0.58 ? 'low' : 'mid';
  const xLabel = getAxisKoreanLabel(currentAxis?.xAxis, 'X축');
  const yLabel = getAxisKoreanLabel(currentAxis?.yAxis, 'Y축');

  let base = '균형 있게 비교할 아이디어';
  if (xState === 'high' && yState === 'high') base = `바로 검토할 핵심 후보`;
  else if (xState === 'high' && yState === 'low') base = `${xLabel}은 좋지만 ${yLabel} 보완 필요`;
  else if (xState === 'low' && yState === 'high') base = `${yLabel}은 좋지만 ${xLabel} 보완 필요`;
  else if (xState === 'low' && yState === 'low') base = '다시 다듬어야 할 아이디어';
  else if (xState === 'mid' && yState === 'high') base = `${yLabel}이 강한 아이디어`;
  else if (xState === 'mid' && yState === 'low') base = `${yLabel}을 키워야 할 아이디어`;
  else if (xState === 'high' && yState === 'mid') base = `${xLabel}이 강한 아이디어`;
  else if (xState === 'low' && yState === 'mid') base = `${xLabel}을 키워야 할 아이디어`;

  if (radius < 280) return `${base} · 서로 비슷함`;
  if (radius > 760) return `${base} · 넓게 퍼짐`;
  return base;
};

const findWhitespaceAreas = (items) => {
  if (!items.length) return [];
  const bounds = getVisibleBounds(items);
  const margin = 320;
  const minX = Math.max(0, bounds.minX - margin);
  const maxX = Math.min(WORLD_W - 360, bounds.maxX + margin);
  const minY = Math.max(0, bounds.minY - margin);
  const maxY = Math.min(WORLD_H - 260, bounds.maxY + margin);
  const cols = 5;
  const rows = 4;
  const cellW = Math.max(260, (maxX - minX) / cols);
  const cellH = Math.max(220, (maxY - minY) / rows);

  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cx = minX + col * cellW + cellW / 2;
      const cy = minY + row * cellH + cellH / 2;
      const count = items.filter(item => Math.abs(item.wx + 120 - cx) < cellW * 0.55 && Math.abs(item.wy + 70 - cy) < cellH * 0.55).length;
      const nearest = Math.min(...items.map(item => Math.hypot(item.wx + 120 - cx, item.wy + 70 - cy)));
      const edgePenalty = (row === 0 || row === rows - 1 || col === 0 || col === cols - 1) ? 90 : 0;
      cells.push({ cx, cy, count, nearest, score: nearest - count * 180 - edgePenalty });
    }
  }

  const candidates = cells
    .filter(cell => cell.count <= 1 && cell.nearest > 360)
    .sort((a, b) => b.score - a.score);
  const selected = candidates.reduce((areas, candidate) => {
    if (areas.length >= 3) return areas;
    const overlaps = areas.some(area => (
      Math.abs(area.cx - candidate.cx) < 460 && Math.abs(area.cy - candidate.cy) < 340
    ));
    return overlaps ? areas : [...areas, candidate];
  }, []);

  return selected
    .map((cell, index) => ({
      id: `whitespace-${index}`,
      label: index === 0 ? 'WHITE SPACE' : 'LOW DENSITY',
      wx: clamp(cell.cx - 190, 40, WORLD_W - 420),
      wy: clamp(cell.cy - 130, 40, WORLD_H - 300),
      width: 380,
      height: 260,
      rotate: 0,
      color: '#FF005C',
    }));
};

/* ── Glassmorphism (Figma 정확한 값)
     Glass Background : rgba(26,26,26,alpha)
     Glass Outline    : #666666 → #353535 → #666666 (180deg, border-box)
   ─────────────────────────────────────────────────────────────────── */
const glass = (alpha = 0.2, blur = 12) => ({
  background:
    `rgba(26,26,26,${alpha}) padding-box, ` +
    `linear-gradient(180deg, #666666 0%, #353535 50%, #666666 100%) border-box`,
  border: '1.5px solid transparent',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
  backdropFilter: `blur(${blur}px)`,
  WebkitBackdropFilter: `blur(${blur}px)`,
});

/* ── SVG 아이콘 ────────────────────────────────────────────────────────────── */
const EditIcon   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>;
const RegenIcon  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const PlanIcon   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const TrashIcon  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
const AiIcon     = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/></svg>;
const ZoomOutIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M8 11h6"/><path d="M16.5 16.5 21 21"/></svg>;
const ZoomInIcon  = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6"/><path d="M16.5 16.5 21 21"/></svg>;

/* ── 헬퍼 컴포넌트 ─────────────────────────────────────────────────────────── */
function StarRating({ count, size = 11, color = '#CBFF00' }) {
  return (
    <span title={count ? '즐겨찾기됨' : '즐겨찾기 안 됨'} style={{ color: count ? color : '#3b3b3b', fontSize: size, lineHeight: 1 }}>★</span>
  );
}

function ConnectionHandles({ onDragStart, small = false, active = false }) {
  const size = small ? 8 : 12;
  const dot = small ? 3 : 5;
  const common = {
    position: 'absolute',
    top: '50%',
    borderRadius: '50%',
    transform: 'translateY(-50%)',
    cursor: 'crosshair',
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    padding: 0,
    background: '#111',
    border: '2px solid #FFB800',
  };
  const handleStyle = (side) => ({
    ...common,
    [side]: -size / 2,
    boxShadow: active
      ? '0 0 0 7px rgba(255,184,0,.34), 0 0 18px rgba(255,184,0,.56)'
      : '0 0 0 1px rgba(255,184,0,.18), 0 0 8px rgba(255,184,0,.24)',
  });
  const inner = {
    width: dot,
    height: dot,
    borderRadius: '50%',
    background: '#111',
  };

  return (
    <>
      <button
        type="button"
        title="결합 시작점"
        data-combine-handle="true"
        onMouseDown={onDragStart}
        style={handleStyle('left')}
      >
        <span style={inner} />
      </button>
      <button
        type="button"
        title="결합 도착점"
        data-combine-handle="true"
        onMouseDown={onDragStart}
        style={handleStyle('right')}
      >
        <span style={inner} />
      </button>
    </>
  );
}

/* ── 시맨틱 줌 카드 (좌측 outline 포함) ──────────────────────────────────── */
function IdeaCard({ idea, isSelected, isCombineCandidate, showConnectionHandles, onClick, onDragStart, onCombineDragStart, onHover, scale, childInput, onChildInputChange, onChildSubmit, isGeneratingChild, isUnionMode = false, isHovered = false }) {
  const effective = 240 * scale;

  const active = isSelected || isCombineCandidate || (isUnionMode && isHovered);
  const favorite = Number(idea.stars) > 0;
  const isChildIdea = Boolean(idea.isChildIdea);
  const dimmed = isUnionMode && !active;
  const accentColor = favorite ? '#CBFF00' : active ? '#FFB800' : '#4a4a4a';
  const leftBorder  = `3px solid ${accentColor}`;
  const otherBorder = favorite || active ? `1px solid ${accentColor}` : '1px solid #2a2a2a';
  const titleColor = '#fff';
  const starColor = '#CBFF00';
  const cardBackground = isChildIdea
    ? active ? '#151515' : '#101010'
    : active ? '#1e1e1e' : '#1a1a1a';
  const cardShadow = active ? '0 0 22px rgba(255,184,0,.2)' : 'none';
  const riskLevel = ['medium', 'high'].includes(idea.risk?.level) ? idea.risk.level : null;
  const riskColor = riskLevel === 'high' ? '#ff7070' : '#FFB800';
  const handleDragStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCombineDragStart?.(idea.id, e);
  };

  if (effective < 70) {
    return (
      <div data-idea="true" data-idea-id={idea.id} onClick={onClick} onMouseDown={onDragStart} onMouseEnter={() => onHover?.(idea.id)} onMouseLeave={() => onHover?.(null)} title={idea.title} style={{
        position: 'absolute', left: idea.wx + 108, top: idea.wy + 52,
        width: 14, height: 14, borderRadius: '50%',
        background: dimmed ? '#333' : accentColor,
        border: `2px solid ${dimmed ? '#444' : accentColor}`,
        boxShadow: active ? '0 0 10px rgba(255,184,0,.65)' : 'none',
        opacity: dimmed ? 0.32 : 1,
        cursor: 'pointer', zIndex: favorite || active ? 10 : 5,
      }}>
        {showConnectionHandles && <ConnectionHandles onDragStart={handleDragStart} active={isCombineCandidate} small />}
      </div>
    );
  }

  if (effective < 140) {
    return (
      <div data-idea="true" data-idea-id={idea.id} onClick={onClick} onMouseDown={onDragStart} onMouseEnter={() => onHover?.(idea.id)} onMouseLeave={() => onHover?.(null)} style={{
        position: 'absolute', left: idea.wx, top: idea.wy, width: 200,
        background: cardBackground,
        borderRadius: 8,
        borderTop: otherBorder, borderRight: otherBorder, borderBottom: otherBorder, borderLeft: leftBorder,
        opacity: dimmed ? 0.28 : 1,
        filter: dimmed ? 'grayscale(1)' : 'none',
        padding: '7px 11px', cursor: 'pointer', zIndex: favorite || active ? 10 : 5,
        boxShadow: cardShadow,
      }}>
        {showConnectionHandles && <ConnectionHandles onDragStart={handleDragStart} active={isCombineCandidate} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!isChildIdea && idea.showAiBadge && <span style={{ color: '#CBFF00', display: 'flex' }}><AiIcon /></span>}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isChildIdea ? (idea.desc || idea.summary || idea.title) : idea.title}</div>
        </div>
      </div>
    );
  }

  if (effective < 200) {
    return (
      <div data-idea="true" data-idea-id={idea.id} onClick={onClick} onMouseDown={onDragStart} onMouseEnter={() => onHover?.(idea.id)} onMouseLeave={() => onHover?.(null)} style={{
        position: 'absolute', left: idea.wx, top: idea.wy, width: 230,
        background: cardBackground,
        borderRadius: 9,
        borderTop: otherBorder, borderRight: otherBorder, borderBottom: otherBorder, borderLeft: leftBorder,
        padding: '10px 14px', cursor: 'pointer', zIndex: favorite || active ? 10 : 5,
        opacity: dimmed ? 0.28 : 1,
        filter: dimmed ? 'grayscale(1)' : 'none',
        boxShadow: cardShadow,
      }}>
        {showConnectionHandles && <ConnectionHandles onDragStart={handleDragStart} active={isCombineCandidate} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          {!isChildIdea && idea.showAiBadge && <span style={{ color: '#CBFF00', display: 'flex' }}><AiIcon /></span>}
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{isChildIdea ? (idea.desc || idea.summary || idea.title) : idea.title}</div>
        </div>
        {!isChildIdea && <div style={{ fontSize: 10, color: '#666', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{idea.summary}</div>}
      </div>
    );
  }

  return (
    <div data-idea="true" data-idea-id={idea.id} onClick={onClick} onMouseDown={onDragStart} onMouseEnter={() => onHover?.(idea.id)} onMouseLeave={() => onHover?.(null)} style={{
      position: 'absolute', left: idea.wx, top: idea.wy, width: 240,
      background: cardBackground,
      borderRadius: 10,
      borderTop: otherBorder, borderRight: otherBorder, borderBottom: otherBorder, borderLeft: leftBorder,
      padding: 16, cursor: 'pointer',
      opacity: dimmed ? 0.28 : 1,
      filter: dimmed ? 'grayscale(1)' : 'none',
      boxShadow: active ? cardShadow : '0 0 10px rgba(0,0,0,.18)',
      zIndex: favorite || active ? 10 : 5,
    }}>
      {showConnectionHandles && <ConnectionHandles onDragStart={handleDragStart} active={isCombineCandidate} />}
      {isChildIdea ? (
        <p style={{ fontSize: 13, color: '#d7d7d7', lineHeight: 1.6, margin: 0, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{idea.desc || idea.summary || idea.title}</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <StarRating count={idea.stars} color={starColor} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {riskLevel && <span title={(idea.risk?.reasons || []).join('\n')} style={{ color: riskColor, fontSize: 10, fontWeight: 900 }}>RISK</span>}
              {idea.showAiBadge && <span style={{ color: '#CBFF00', display: 'flex' }}><AiIcon /></span>}
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#555', margin: '4px 0 2px', letterSpacing: 1 }}>{idea.tag}</div>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 5, color: titleColor }}>{idea.title}</h4>
          <p style={{ fontSize: 11, color: '#888', lineHeight: 1.5, marginBottom: 8 }}>{idea.summary}</p>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(idea.keywords || []).map(k => (
              <span key={k} style={{ background: '#2a2a2a', color: active ? '#FFB800' : '#888', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>{k}</span>
            ))}
          </div>
        </>
      )}
      {CHILD_IDEA_INPUT_ENABLED && isSelected && (
        <form
          data-overlay="true"
          onClick={e => e.stopPropagation()}
          onSubmit={e => { e.preventDefault(); onChildSubmit?.(); }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 'calc(100% + 10px)',
            height: 42,
            ...glass(0.42, 14),
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px 0 14px',
            zIndex: 18,
            gap: 8,
          }}
        >
          <input
            value={childInput}
            disabled={isGeneratingChild}
            onChange={e => onChildInputChange?.(e.target.value)}
            placeholder="떠오르는 하위 아이디어를 추가하세요"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#fff',
              fontSize: 11,
            }}
          />
          <button
            type="submit"
            disabled={isGeneratingChild || !childInput.trim()}
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              border: 'none',
              background: childInput.trim() && !isGeneratingChild ? '#CBFF00' : '#333',
              color: childInput.trim() && !isGeneratingChild ? '#111' : '#777',
              cursor: childInput.trim() && !isGeneratingChild ? 'pointer' : 'default',
              fontWeight: 900,
            }}
          >
            ✓
          </button>
        </form>
      )}
    </div>
  );
}

function CombineSkeletonCard({ skeleton, scale }) {
  const effective = IDEA_CARD_W * scale;
  if (effective < 70) {
    return (
      <span
        aria-label="결합 아이디어 생성 중"
        className="skeleton combine-skeleton-dot"
        style={{ position: 'absolute', left: skeleton.wx + 108, top: skeleton.wy + 52, width: 14, height: 14, borderRadius: '50%', zIndex: 8 }}
      />
    );
  }

  const compact = effective < 140;
  const medium = !compact && effective < 200;
  const width = compact ? 200 : medium ? 230 : 240;
  const sourceLabel = (skeleton.sourceTitles || []).map(title => title.slice(0, 8)).join(' + ');
  return (
    <div
      className="combine-skeleton-card"
      aria-label="결합 아이디어 생성 중"
      aria-busy="true"
      style={{
      position: 'absolute', left: skeleton.wx, top: skeleton.wy, width,
      padding: compact ? '8px 11px' : medium ? '11px 14px' : 16,
      borderRadius: compact ? 8 : 10,
      background: 'rgba(30,30,30,.94)', border: '1px solid rgba(203,255,0,.34)',
      borderLeft: '3px solid #CBFF00', boxShadow: '0 0 28px rgba(203,255,0,.14)',
      zIndex: 8, boxSizing: 'border-box', pointerEvents: 'none',
      transition: 'left .34s ease, top .34s ease',
    }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: compact ? 0 : 9 }}>
        <div style={{ minWidth: 0, color: '#8ca72d', fontSize: compact ? 9 : 10, fontWeight: 800, letterSpacing: .8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sourceLabel || '선택한 아이디어'}
        </div>
        <span className="combine-generating-dot" />
      </div>
      {!compact && <div className="skeleton" style={{ width: '62%', height: medium ? 11 : 14, borderRadius: 6, marginBottom: 9 }} />}
      {!compact && <div className="skeleton" style={{ width: '92%', height: 9, borderRadius: 5, marginBottom: medium ? 0 : 7 }} />}
      {!compact && !medium && <div className="skeleton" style={{ width: '72%', height: 9, borderRadius: 5 }} />}
      <div style={{ color: '#CBFF00', fontSize: compact ? 9 : 10, fontWeight: 750, marginTop: compact ? 0 : 11, whiteSpace: 'nowrap' }}>
        {skeleton.phase === 'positioning' ? '생성 위치를 조정하는 중…' : '결합 아이디어 생성 중…'}
      </div>
    </div>
  );
}

/* ── 공간 패널 (높이: 콘텐츠 기반 동적) ─────────────────────────────────── */
function WhitespaceIdeaSkeletonCard({ skeleton, scale }) {
  const effective = IDEA_CARD_W * scale;
  if (effective < 70) {
    return (
      <span
        aria-label="공백 아이디어 생성 중"
        className="skeleton whitespace-skeleton-dot"
        style={{ position: 'absolute', left: skeleton.wx + 108, top: skeleton.wy + 52, width: 14, height: 14, borderRadius: '50%', zIndex: 9 }}
      />
    );
  }

  const compact = effective < 140;
  const medium = !compact && effective < 200;
  const width = compact ? 200 : medium ? 230 : 240;
  const height = compact ? 38 : medium ? 72 : IDEA_CARD_H;

  return (
    <div
      className="whitespace-skeleton-card"
      aria-label="AI 공백 아이디어 생성 중"
      aria-busy="true"
      style={{
        position: 'absolute', left: skeleton.wx, top: skeleton.wy,
        width, height, padding: compact ? '8px 11px' : medium ? '10px 14px' : 16,
        borderRadius: compact ? 8 : 10,
        background: 'linear-gradient(135deg, rgba(255,0,92,.12), rgba(26,26,26,.96) 68%)',
        border: '1px solid rgba(255,0,92,.42)', borderLeft: '3px solid #FF005C',
        zIndex: 9, pointerEvents: 'none', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: compact ? 0 : medium ? 7 : 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ color: '#FF4C8D', display: 'flex', flexShrink: 0 }}><AiIcon /></span>
          <span style={{ color: '#d76b92', fontSize: compact ? 9 : 10, fontWeight: 800, letterSpacing: .9, whiteSpace: 'nowrap' }}>{compact ? 'AI 생성 중…' : 'WHITE_SPACE'}</span>
        </div>
        <span className="whitespace-generating-dot" />
      </div>
      {!compact && <div className="skeleton" style={{ width: '64%', height: medium ? 11 : 14, borderRadius: 6, marginBottom: 8 }} />}
      {!compact && <div className="skeleton" style={{ width: '91%', height: 9, borderRadius: 5, marginBottom: medium ? 0 : 7 }} />}
      {!compact && !medium && <div className="skeleton" style={{ width: '73%', height: 9, borderRadius: 5 }} />}
      {!compact && !medium && (
        <div style={{ display: 'flex', gap: 5, marginTop: 12 }}>
          {[42, 54, 46].map(widthValue => <div key={widthValue} className="skeleton" style={{ width: widthValue, height: 17, borderRadius: 5 }} />)}
        </div>
      )}
      {!compact && <div style={{ position: 'absolute', left: 16, bottom: medium ? 7 : 10, color: '#FF4C8D', fontSize: 10, fontWeight: 750, whiteSpace: 'nowrap' }}>
        이 위치에 AI 아이디어를 생성하는 중…
      </div>}
    </div>
  );
}

function SpacePanel({ spaces, activeSpaceId, onSelectSpace, onAddSpace, onClose }) {
  return (
    <div data-overlay="true" style={{
      position: 'absolute', left: 112, top: 32,
      width: 300,
      maxHeight: 'calc(100% - 60px)',
      ...glass(0.45, 16),
      borderRadius: 12,
      display: 'flex', flexDirection: 'column', zIndex: 28,
      animation: 'toolPanelIn .2s ease-out both',
    }}>
      <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>공간</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', fontSize: 18, lineHeight: 1 }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {spaces.map(space => {
          const isActive = String(space.id) === String(activeSpaceId);
          return (
          <button
            key={space.id}
            type="button"
            onClick={() => onSelectSpace(space.id)}
            style={{
              width: '100%',
              background: '#1e1e1e',
              borderRadius: 10,
              padding: '14px 16px',
              border: `1px solid ${isActive ? '#CBFF00' : '#2a2a2a'}`,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{space.name}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#555' }}>가로축</span>
                <span style={{ color: '#CBFF00', fontWeight: 600 }}>{space.xAxis}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#555' }}>세로축</span>
                <span style={{ color: '#CBFF00', fontWeight: 600 }}>{space.yAxis}</span>
              </div>
            </div>
          </button>
          );
        })}
      </div>

      <div style={{ padding: '14px 16px', borderTop: '1px solid #2a2a2a', flexShrink: 0 }}>
        <button onClick={onAddSpace} style={{
          width: '100%', padding: '11px', borderRadius: 8,
          background: 'transparent', border: '1px dashed #555',
          color: '#b0b0b0', fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'border .15s, color .15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#CBFF00'; e.currentTarget.style.color = '#CBFF00'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.color = '#b0b0b0'; }}
        >
          <span style={{ fontSize: 16 }}>＋</span> 새로운 공간 생성하기
        </button>
      </div>
    </div>
  );
}

function createCritiqueConversationState(ideaId) {
  const topics = buildCritiqueTopics().map((topic, index) => ({
    ...topic,
    status: index === 0 ? 'active' : 'pending',
  }));
  return {
    ideaId,
    topics,
    currentTopicKey: topics[0]?.key || null,
    turnsOnCurrentTopic: 0,
    messages: [],
    completed: false,
  };
}

function getActiveCritiqueTopic(state) {
  if (!state || state.completed) return null;
  return state.topics.find(topic => topic.key === state.currentTopicKey) || state.topics.find(topic => topic.status === 'active') || null;
}

function transitionCritiqueConversationState(state, response, nextMessages) {
  if (!state) return state;
  const currentTopic = getActiveCritiqueTopic(state);
  if (!currentTopic) return { ...state, messages: nextMessages, completed: true };

  if (response.topicStatus !== 'resolved') {
    return {
      ...state,
      turnsOnCurrentTopic: state.turnsOnCurrentTopic + 1,
      messages: nextMessages,
    };
  }

  const pendingTopics = state.topics.filter(topic => topic.status === 'pending');
  const requestedNext = pendingTopics.find(topic => topic.key === response.nextTopicKey);
  const nextTopic = requestedNext || pendingTopics[0] || null;
  const topics = state.topics.map(topic => {
    if (topic.key === currentTopic.key) return { ...topic, status: 'resolved' };
    if (nextTopic && topic.key === nextTopic.key) return { ...topic, status: 'active' };
    return topic;
  });

  return {
    ...state,
    topics,
    currentTopicKey: nextTopic?.key || null,
    turnsOnCurrentTopic: 0,
    messages: nextMessages,
    completed: !nextTopic,
  };
}

/* ── Canvas 메인 ─────────────────────────────────────────────────────────── */
export default function Canvas() {
  const [ideas,         setIdeas]         = useState([]);
  const [canvasLoading, setCanvasLoading] = useState(true);
  const [selectedIdea,  setSelectedIdea]  = useState(null);
  const [detailPanelWidth, setDetailPanelWidth] = useState(400);
  const [showCritic,    setShowCritic]    = useState(false);
  const [criticInput,   setCriticInput]   = useState('');
  const [criticMessages,setCriticMessages]= useState([]);
  const [criticConversationState, setCriticConversationState] = useState(null);
  const [criticLoading, setCriticLoading] = useState(false);
  const [criticPosition, setCriticPosition] = useState(null);
  const [criticSize, setCriticSize] = useState({ width: 500, height: 430 });
  const [zoom,          setZoom]          = useState(90);
  const [offset,        setOffset]        = useState({ x: -300, y: -100 });
  const [deletedIds,    setDeletedIds]    = useState(() => new Set());
  const [hoveredAction, setHoveredAction] = useState(null);
  const [showAxisModal, setShowAxisModal] = useState(false);
  const [spaces,        setSpaces]        = useState(() => getInitialSpaces(null));
  const [activeSpaceId, setActiveSpaceId] = useState(() => getInitialActiveSpaceId(getInitialSpaces(null), null));
  const [groupLabels,   setGroupLabels]   = useState([]);
  const [groupAreas,    setGroupAreas]    = useState([]);
  const [groupingEnabled, setGroupingEnabled] = useState(false);
  const [groupRevision, setGroupRevision] = useState(0);
  const [ideaLinks,     setIdeaLinks]     = useState([]);
  const [combineIds,    setCombineIds]    = useState([]);
  const [combineDrag,   setCombineDrag]   = useState(null);
  const [hoveredIdea,   setHoveredIdea]   = useState(null);
  const [isGenerating,  setIsGenerating]  = useState(false);
  const [planGenerating, setPlanGenerating] = useState(false);
  const [projectCompleting, setProjectCompleting] = useState(false);
  const [generatingWhitespaceIds, setGeneratingWhitespaceIds] = useState(() => new Set());
  const [whitespaceSkeletons, setWhitespaceSkeletons] = useState([]);
  const [combineSkeletons, setCombineSkeletons] = useState([]);
  const [axisRelayoutProgress, setAxisRelayoutProgress] = useState(null);
  /* 툴바 & 패널 상태 */
  const [activeTool,    setActiveTool]    = useState('cursor'); // lifted from CanvasSidebar
  const [activePanel,   setActivePanel]   = useState(null);    // 'space' | null
  /* 하단 입력바 확장 */
  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputClosing, setInputClosing] = useState(false);
  const [inputText,     setInputText]     = useState('');
  const [childInput,    setChildInput]    = useState('');

  const isPanning   = useRef(false);
  const panStart    = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const viewportRef = useRef(null);
  const criticPanelRef = useRef(null);
  const childIdeaCounterRef = useRef(0);
  const criticScrollRef = useRef(null);
  const criticStateRef = useRef(null);
  const criticDragRef = useRef(null);
  const criticResizeRef = useRef(null);
  const analysisRunRef = useRef(0);
  const relayoutTimerRef = useRef([]);
  const zoomRef     = useRef(90);
  const offsetRef   = useRef({ x: -300, y: -100 });
  const centeredView = useRef(false);
  const viewportLogReadyRef = useRef(false);
  const navigate    = useNavigate();

  const openSeedInput = useCallback(() => {
    setInputClosing(false);
    setInputExpanded(true);
  }, []);

  const closeSeedInput = useCallback(() => {
    if (!inputExpanded) return;
    setInputExpanded(false);
    setInputClosing(true);
    window.setTimeout(() => setInputClosing(false), 220);
  }, [inputExpanded]);

  const setCriticState = useCallback((updater) => {
    setCriticConversationState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      criticStateRef.current = next;
      return next;
    });
  }, []);

  const clearRelayoutTimers = useCallback(() => {
    relayoutTimerRef.current.forEach(timer => window.clearTimeout(timer));
    relayoutTimerRef.current = [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hydrateCanvas = async () => {
      setCanvasLoading(true);
      const [workspace, generatedIdeas] = await Promise.all([
        loadCanvasWorkspace(),
        loadGeneratedIdeas(),
      ]);
      if (cancelled) return;
      const nextSpaces = getInitialSpaces(workspace);
      const nextActiveSpaceId = getInitialActiveSpaceId(nextSpaces, workspace);
      const nextIdeas = buildInitialCanvasIdeas(workspace, generatedIdeas, nextActiveSpaceId);
      const nextZoom = Number(workspace?.zoom) || 90;
      const nextOffset = workspace?.offset || { x: -300, y: -100 };
      setIdeas(nextIdeas);
      setSelectedIdea(workspace?.selectedIdeaId ?? null);
      setZoom(nextZoom);
      setOffset(nextOffset);
      zoomRef.current = nextZoom;
      offsetRef.current = nextOffset;
      centeredView.current = Boolean(workspace?.offset);
      setDeletedIds(new Set(workspace?.deletedIds || []));
      setSpaces(nextSpaces);
      setActiveSpaceId(nextActiveSpaceId);
      setGroupLabels(workspace?.groupLabels || []);
      setGroupAreas([2, 3].includes(workspace?.layoutVersion) ? (workspace?.groupAreas || []) : []);
      setGroupingEnabled(Boolean(workspace?.groupingEnabled));
      setIdeaLinks(workspace?.ideaLinks || []);
      setCanvasLoading(false);
    };
    hydrateCanvas();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
    offsetRef.current = offset;
  }, [zoom, offset]);

  useEffect(() => {
    if (canvasLoading) return undefined;
    if (!viewportLogReadyRef.current) {
      viewportLogReadyRef.current = true;
      return undefined;
    }
    const timer = setTimeout(() => {
      logEvent('viewport_change', { zoom, offset });
    }, 500);
    return () => clearTimeout(timer);
  }, [canvasLoading, zoom, offset]);

  useEffect(() => {
    const container = criticScrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [criticMessages, criticLoading]);

  useEffect(() => {
    if (canvasLoading) return undefined;
    const timer = setTimeout(() => {
      const projectContext = getProjectContext();
      const axis = getCurrentAxis(spaces, activeSpaceId);
      const visibleWorkspaceIdeas = ideas.filter(idea => !deletedIds.has(idea.id));
      saveCanvasWorkspace({
        layoutVersion: 3,
        positionMode: 'axis-fixed',
        projectTitle: projectContext.title || projectContext.idea || '진행 중인 프로젝트',
        projectInput: projectContext.input ?? projectContext.idea ?? '',
        axes: axis,
        axisLayout: buildAxisLayout(axis, ideas),
        ideas,
        selectedIdeaId: selectedIdea,
        zoom,
        offset,
        deletedIds: [...deletedIds],
        spaces,
        activeSpaceId,
        groupLabels,
        groupAreas,
        groupingEnabled,
        ideaLinks,
      });
      saveGeneratedIdeas(visibleWorkspaceIdeas);
    }, 180);
    return () => clearTimeout(timer);
  }, [activeSpaceId, canvasLoading, ideas, selectedIdea, zoom, offset, deletedIds, spaces, groupLabels, groupAreas, groupingEnabled, ideaLinks]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => () => clearRelayoutTimers(), [clearRelayoutTimers]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || centeredView.current) return;
    const centerWorld = () => {
      const rect = el.getBoundingClientRect();
      const scaleValue = zoomRef.current / 100;
      const nextOffset = {
        x: rect.width / 2 - (WORLD_W / 2) * scaleValue,
        y: rect.height / 2 - (WORLD_H / 2) * scaleValue,
      };
      centeredView.current = true;
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
    };
    const frame = requestAnimationFrame(centerWorld);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.target.closest?.('[data-critic-panel]')) return;
      e.preventDefault();
      const rect     = el.getBoundingClientRect();
      const mx       = e.clientX - rect.left;
      const my       = e.clientY - rect.top;
      const oldScale = zoomRef.current / 100;
      const newZoom  = Math.max(20, Math.min(200, zoomRef.current - e.deltaY * 0.05));
      const newScale = newZoom / 100;
      const { x: ox, y: oy } = offsetRef.current;
      setZoom(newZoom);
      setOffset({
        x: mx - (mx - ox) * (newScale / oldScale),
        y: my - (my - oy) * (newScale / oldScale),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleMouseDown = useCallback(e => {
    if (e.target.closest('[data-combine-handle]')) return;
    if (e.target.closest('[data-idea]') || e.target.closest('aside') || e.target.closest('[data-overlay]')) return;
    setSelectedIdea(null);
    setActivePanel(null);
    setActiveTool('cursor');
    closeSeedInput();
    setShowCritic(false);
    setCombineIds([]);
    isPanning.current   = true;
    panStart.current    = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offsetRef.current };
    if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
  }, [closeSeedInput]);

  const getPointerWorld = useCallback((event) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const viewportX = event.clientX - (rect?.left || 0);
    const viewportY = event.clientY - (rect?.top || 0);
    const currentScale = zoomRef.current / 100;

    return {
      wx: (viewportX - offsetRef.current.x) / currentScale,
      wy: (viewportY - offsetRef.current.y) / currentScale,
    };
  }, []);

  const addIdea = useCallback((idea, parentIds = [], options = {}) => {
    const axis = getCurrentAxis(spaces, activeSpaceId);
    const asChildIdea = options.asChildIdea ?? Boolean(parentIds.length);
    const nextIdea = parentIds.length
      ? { ...idea, parentIds, isChildIdea: asChildIdea, showAiBadge: false, aiGenerated: false }
      : idea;
    setIdeas(prev => placeIdeasOnAxis([...prev, nextIdea], axis));
    if (parentIds.length) {
      setIdeaLinks(prev => [...prev, ...parentIds.map(from => ({ from, to: nextIdea.id }))]);
    }
    setSelectedIdea(nextIdea.id);
  }, [activeSpaceId, spaces]);

  const combineIdeas = useCallback(async (ids) => {
    const sources = ids.map(id => ideas.find(idea => idea.id === id)).filter(Boolean);
    if (sources.length < 2 || isGenerating) return;
    logEvent('node_combine', { source_ids: ids });
    setIsGenerating(true);
    const skeletonId = `combine-${Date.now()}`;
    const current = getCurrentAxis(spaces, activeSpaceId);
    const previewEvaluations = {
      [current.xAxis]: { score: sources.reduce((sum, source) => sum + getEvaluationScore(source, current.xAxis), 0) / sources.length },
      [current.yAxis]: { score: sources.reduce((sum, source) => sum + getEvaluationScore(source, current.yAxis), 0) / sources.length },
    };
    const previewPosition = getAxisPositionForIdea({ id: skeletonId, evaluations: previewEvaluations }, current, ideas);
    setCombineSkeletons(prev => [...prev, {
      id: skeletonId,
      ...previewPosition,
      parentIds: ids,
      sourceTitles: sources.map(source => source.title),
      phase: 'generating',
    }]);

    try {
      const [idea] = await Promise.all([
        requestGptIdea({
          text: '선택된 두 아이디어를 결합한 새로운 하위 아이디어',
          sourceIdeas: sources,
          mode: 'combine',
          ...previewPosition,
        }),
        new Promise(resolve => setTimeout(resolve, 700)),
      ]);
      const finalPosition = getAxisPositionForIdea(idea, current, ideas);
      setCombineSkeletons(prev => prev.map(item => (
        item.id === skeletonId ? { ...item, ...finalPosition, phase: 'positioning' } : item
      )));
      await new Promise(resolve => setTimeout(resolve, 360));
      addIdea({ ...idea, ...finalPosition, parentIds: ids, isChildIdea: false, stars: 0, showAiBadge: false }, ids, { asChildIdea: false });
      setCombineIds([]);
      setActiveTool('cursor');
    } finally {
      setCombineSkeletons(prev => prev.filter(item => item.id !== skeletonId));
      setIsGenerating(false);
    }
  }, [activeSpaceId, addIdea, ideas, isGenerating, spaces]);

  const handleMouseMove = useCallback(e => {
    if (combineDrag) {
      const current = getPointerWorld(e);
      setCombineDrag(prev => prev ? { ...prev, current } : prev);
      return;
    }
    if (!isPanning.current) return;
    setOffset({ x: offsetStart.current.x + e.clientX - panStart.current.x, y: offsetStart.current.y + e.clientY - panStart.current.y });
  }, [combineDrag, getPointerWorld]);

  const handleMouseUp = useCallback((e) => {
    if (combineDrag) {
      const target = e.target.closest('[data-idea-id]');
      const targetIdea = target
        ? ideas.find(idea => String(idea.id) === target.dataset.ideaId)
        : null;
      const targetId = targetIdea?.id ?? null;
      const ids = targetId && targetId !== combineDrag.fromId ? [combineDrag.fromId, targetId] : [];
      setCombineDrag(null);
      setCombineIds(ids);
      if (ids.length === 2) combineIdeas(ids);
      return;
    }
    isPanning.current = false;
    if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
  }, [combineDrag, combineIdeas, ideas]);

  const scale      = zoom / 100;
  const dotSpacing = 24 * scale;
  const bgX        = ((offset.x % dotSpacing) + dotSpacing) % dotSpacing;
  const bgY        = ((offset.y % dotSpacing) + dotSpacing) % dotSpacing;
  const selected   = ideas.find(i => i.id === selectedIdea && !deletedIds.has(i.id));
  const visibleIdeas = useMemo(() => ideas.filter(i => !deletedIds.has(i.id)), [ideas, deletedIds]);
  const currentAxis = useMemo(() => getCurrentAxis(spaces, activeSpaceId), [activeSpaceId, spaces]);
  const getIdeaWithSessionDetail = useCallback((idea) => {
    if (!idea) return idea;
    const cachedDetail = readIdeaDetailCache(getProjectContext(), idea) || {};
    const keepEditableLists = cachedDetail.detailSource === 'user_editable';
    const hasField = field => Object.prototype.hasOwnProperty.call(cachedDetail, field);
    const nextPros = keepEditableLists && hasField('pros') ? cachedDetail.pros || [] : [];
    const nextCons = keepEditableLists && hasField('cons') ? cachedDetail.cons || [] : [];
    const nextFeatures = keepEditableLists && hasField('features') ? cachedDetail.features || [] : [];
    const nextGoals = keepEditableLists && hasField('goals') ? cachedDetail.goals || [] : [];
    const nextDescription = cachedDetail.description || idea.description || idea.desc || '';
    return {
      ...idea,
      desc: nextDescription || idea.desc,
      description: nextDescription,
      pros: nextPros,
      cons: nextCons,
      features: nextFeatures,
      goals: nextGoals,
      detailPanel: {
        description: nextDescription,
        pros: nextPros,
        cons: nextCons,
        features: nextFeatures,
        goals: nextGoals,
      },
    };
  }, []);
  const positionGroupAreas = useMemo(() => {
    if (!groupingEnabled) return [];
    return buildPositionClusters(visibleIdeas).map((items, index) => (
      getAreaForCluster(items, `position-${groupRevision}-${index}`, `${getPositionClusterName(items, currentAxis)} (${items.length})`)
    ));
  }, [currentAxis, groupRevision, groupingEnabled, visibleIdeas]);
  const visibleGroupAreas = groupingEnabled ? positionGroupAreas : groupAreas;

  // 노드 액션 버튼 뷰포트 좌표
  const actionPos = selected ? {
    x: (selected.wx + 252) * scale + offset.x,
    y: selected.wy * scale + offset.y,
  } : null;

  const nodeActions = selected?.isChildIdea ? [
    { key: 'edit',   label: '수정하기', color: '#ccc',    icon: <EditIcon /> },
    { key: 'delete', label: '삭제하기', color: '#ff7070', icon: <TrashIcon /> },
  ] : [
    { key: 'edit',   label: '수정하기',           color: '#ccc',    icon: <EditIcon /> },
    { key: 'regen',  label: '재생성하기',          color: '#ccc',    icon: <RegenIcon /> },
    { key: 'plan',   label: planGenerating ? '기획안 생성 중...' : '최종기획안 생성하기', color: '#CBFF00', icon: <PlanIcon /> },
    { key: 'delete', label: '삭제하기',            color: '#ff7070', icon: <TrashIcon /> },
  ];

  const startAxisRelayout = useCallback((nextAxis) => {
    clearRelayoutTimers();
    setAxisRelayoutProgress(8);
    setSelectedIdea(null);
    setGroupingEnabled(false);
    setGroupLabels([]);
    setGroupAreas([]);
    setCombineDrag(null);
    setCombineIds([]);
    setCombineSkeletons([]);
    setWhitespaceSkeletons([]);
    setGeneratingWhitespaceIds(new Set());
    relayoutTimerRef.current = [
      window.setTimeout(() => setAxisRelayoutProgress(32), 90),
      window.setTimeout(() => {
        setIdeas(prev => placeIdeasOnAxis(prev, nextAxis));
        setAxisRelayoutProgress(70);
      }, 150),
      window.setTimeout(() => setAxisRelayoutProgress(100), 360),
      window.setTimeout(() => setAxisRelayoutProgress(null), 620),
    ];
  }, [clearRelayoutTimers]);

  const handleSelectSpace = useCallback((spaceId) => {
    const nextSpace = spaces.find(space => String(space.id) === String(spaceId));
    if (!nextSpace) return;
    const nextAxis = {
      xAxis: normalizeAxisId(nextSpace.xAxis, currentAxis.xAxis),
      yAxis: normalizeAxisId(nextSpace.yAxis, currentAxis.yAxis),
    };
    setActiveSpaceId(nextSpace.id);
    startAxisRelayout(nextAxis);
    logEvent('axis_change', { x_axis: nextAxis.xAxis, y_axis: nextAxis.yAxis, space_id: nextSpace.id });
    void saveProjectContext({ ...getProjectContext(), axes: nextAxis });
  }, [currentAxis.xAxis, currentAxis.yAxis, spaces, startAxisRelayout]);

  const handleAddSpace = ({ name, xAxis, yAxis }) => {
    const nextAxis = {
      xAxis: normalizeAxisId(xAxis, currentAxis.xAxis),
      yAxis: normalizeAxisId(yAxis, currentAxis.yAxis),
    };
    setShowAxisModal(false);
    const maxNumericId = spaces.reduce((max, space) => Math.max(max, Number(space.id) || 0), 0);
    const nextId = Math.max(maxNumericId, spaces.length) + 1;
    const nextSpace = { id: nextId, name: name || `아이디어 공간 ${nextId}`, ...nextAxis };
    setSpaces(prev => [...prev, nextSpace]);
    setActiveSpaceId(nextId);
    startAxisRelayout(nextAxis);
    logEvent('axis_change', { x_axis: nextAxis.xAxis, y_axis: nextAxis.yAxis, space_id: nextId });
    void saveProjectContext({ ...getProjectContext(), axes: nextAxis });
  };

  /* 툴 변경 — CanvasSidebar에서 올라옴 */
  const handleToolChange = (key) => {
    if (key === 'group') {
      handleGroupByPosition();
      setActiveTool('cursor');
      setActivePanel(null);
      return;
    }
    setActiveTool(key);
    if (key === 'space') { setActivePanel(null); handleFindWhitespace(); }
    else if (key === 'union') { setActivePanel(null); setCombineIds(selectedIdea ? [selectedIdea] : []); }
    else { setActivePanel(null); setCombineIds([]); }
  };

  /* 공간 이동 토글 */
  const handleSpaceClick = () => {
    setActivePanel(prev => prev === 'space' ? null : 'space');
    if (activeTool !== 'cursor') setActiveTool('cursor');
  };

  const getViewportCenterWorld = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      wx: Math.round(((rect?.width || 1200) / 2 - offset.x) / scale - 120),
      wy: Math.round(((rect?.height || 800) / 2 - offset.y) / scale - 70),
    };
  };

  const handleCreateIdea = async () => {
    const text = inputText.trim();
    if (!text || isGenerating) return;
    setIsGenerating(true);
    const parent = selected;
    const draft = parseIdeaDraft(text);
    if (parent) {
      const siblingCount = ideaLinks.filter(link => link.from === parent.id).length;
      childIdeaCounterRef.current += 1;
      const childIdea = {
        id: `child-${parent.id}-${childIdeaCounterRef.current}`,
        tag: 'SUB_IDEA',
        title: draft.title,
        summary: draft.body.slice(0, 35),
        desc: draft.body,
        keywords: [],
        stars: 0,
        wx: Math.round(clamp(parent.wx + 280, 40, WORLD_W - IDEA_CARD_W - 40)),
        wy: Math.round(clamp(parent.wy + 28 + siblingCount * 86, 40, WORLD_H - IDEA_CARD_H - 40)),
        parentIds: [parent.id],
        isChildIdea: true,
        aiGenerated: false,
        showAiBadge: false,
        pros: parent.pros || [],
        cons: parent.cons || [],
        features: [],
        goals: [],
      };
      addIdea(childIdea, [parent.id]);
      logEvent('node_add', { idea_id: childIdea.id, method: 'child_from_input' });
      setInputText('');
      closeSeedInput();
      setIsGenerating(false);
      return;
    }
    const position = parent
      ? { wx: parent.wx, wy: parent.wy + 260 }
      : getViewportCenterWorld();
    const idea = await requestGptIdea({
      text,
      sourceIdeas: parent ? [parent] : [],
      mode: 'generate',
      ...position,
    });
    const current = getCurrentAxis(spaces, activeSpaceId);
    const finalPosition = parent ? position : getAxisPositionForIdea(idea, current, ideas);
    const nextIdea = {
      ...idea,
      ...finalPosition,
      title: draft.title,
      summary: draft.body.slice(0, 35),
      desc: draft.body,
      showAiBadge: false,
      stars: 0,
    };
    addIdea(nextIdea, parent ? [parent.id] : []);
    logEvent('node_add', { idea_id: nextIdea.id, method: parent ? 'child_from_input' : 'manual_input' });
    setInputText('');
    closeSeedInput();
    setIsGenerating(false);
  };

  const handleCreateChildIdea = async () => {
    const text = childInput.trim();
    const parent = selected;
    if (!text || !parent || isGenerating) return;
    setIsGenerating(true);
    const siblingCount = ideaLinks.filter(link => link.from === parent.id).length;
    childIdeaCounterRef.current += 1;
    const wx = Math.round(clamp(parent.wx + 280, 40, WORLD_W - IDEA_CARD_W - 40));
    const wy = Math.round(clamp(parent.wy + 28 + siblingCount * 86, 40, WORLD_H - IDEA_CARD_H - 40));
    const idea = {
      id: `child-${parent.id}-${childIdeaCounterRef.current}`,
      tag: 'SUB_IDEA',
      title: text.slice(0, 32),
      summary: text.slice(0, 35),
      desc: text,
      keywords: [],
      stars: 0,
      wx,
      wy,
      parentIds: [parent.id],
      isChildIdea: true,
      aiGenerated: false,
      showAiBadge: false,
      pros: parent.pros || [],
      cons: parent.cons || [],
      features: [],
      goals: [],
    };
    addIdea({ ...idea, showAiBadge: false }, [parent.id]);
    logEvent('node_add', { idea_id: idea.id, method: 'child' });
    setChildInput('');
    setIsGenerating(false);
  };

  const handleGroupByPosition = () => {
    analysisRunRef.current += 1;
    logEvent('group_view', { run_id: analysisRunRef.current, state: 'on' });
    setGroupRevision(analysisRunRef.current);
    setGroupingEnabled(true);
    setGroupLabels([]);
    setGroupAreas([]);
    setSelectedIdea(null);
  };

  const handleFindWhitespace = () => {
    analysisRunRef.current += 1;
    const runId = analysisRunRef.current;
    logEvent('whitespace_view', { run_id: runId, state: 'on' });
    const whitespaceAreas = findWhitespaceAreas(visibleIdeas).map(area => ({
      ...area,
      id: `${area.id}-run-${runId}`,
    }));
    setGroupingEnabled(false);
    setGroupLabels([]);
    setGroupAreas(whitespaceAreas);
    setActiveTool('cursor');
    setSelectedIdea(null);
  };

  const handleWriteWhitespace = () => {
    setSelectedIdea(null);
    openSeedInput();
    setInputText('');
  };

  const handleGenerateWhitespaceIdea = async (area) => {
    if (generatingWhitespaceIds.has(area.id)) return;
    logEvent('whitespace_fill', { area_id: area.id });
    setGeneratingWhitespaceIds(prev => new Set([...prev, area.id]));
    const wx = Math.round(area.wx + area.width / 2 - 120);
    const wy = Math.round(area.wy + area.height / 2 - 70);
    const target = getWhitespaceAxisTarget(area, currentAxis);
    const nearestIdeas = [...visibleIdeas]
      .sort((a, b) => (
        Math.hypot(a.wx + IDEA_CARD_W / 2 - (wx + IDEA_CARD_W / 2), a.wy + IDEA_CARD_H / 2 - (wy + IDEA_CARD_H / 2)) -
        Math.hypot(b.wx + IDEA_CARD_W / 2 - (wx + IDEA_CARD_W / 2), b.wy + IDEA_CARD_H / 2 - (wy + IDEA_CARD_H / 2))
      ))
      .slice(0, 6);
    const whitespacePrompt = [
      '현재 캔버스의 화이트 스페이스를 채우는 새 서비스 아이디어를 생성하세요.',
      `이 위치는 X축 ${target.xLabel} ${target.xBand}(${target.xScore}/100), Y축 ${target.yLabel} ${target.yBand}(${target.yScore}/100) 영역입니다.`,
      `반드시 이 점수대에 어울리는 아이디어여야 합니다. 예: ${target.xLabel}이 낮으면 구현/속성 부담이 낮은 방향, 높으면 해당 축의 강점이 뚜렷한 방향으로 설계하세요.`,
      `현재 주변 아이디어와 겹치지 않되, 빈 영역을 보완하는 역할을 해야 합니다.`,
    ].join('\n');
    const skeletonId = `whitespace-skeleton-${area.id}-${Date.now()}`;
    setWhitespaceSkeletons(prev => [...prev, { id: skeletonId, wx, wy }]);
    try {
      const [idea] = await Promise.all([
        requestGptIdea({
          text: whitespacePrompt,
          sourceIdeas: nearestIdeas,
          mode: 'whitespace',
          wx,
          wy,
          projectContext: {
            ...getProjectContext(),
            axes: currentAxis,
            whitespaceTarget: target,
          },
          temperature: 0.9,
          bypassCircuit: true,
        }),
        new Promise(resolve => setTimeout(resolve, 650)),
      ]);
      const positionedIdea = withWhitespaceAxisEvaluation(idea, target);
      addIdea({
        ...positionedIdea,
        stars: 0,
        tag: positionedIdea.tag || 'WHITE_SPACE',
        keywords: Array.isArray(positionedIdea.keywords) && positionedIdea.keywords.length
          ? positionedIdea.keywords
          : ['#Whitespace', '#Opportunity'],
        showAiBadge: true,
        aiBadgeType: 'whitespace',
      });
      logEvent('node_add', { idea_id: idea.id, method: 'whitespace' });
      setGroupAreas(prev => prev.filter(item => item.id !== area.id));
    } finally {
      setWhitespaceSkeletons(prev => prev.filter(item => item.id !== skeletonId));
      setGeneratingWhitespaceIds(prev => {
        const next = new Set(prev);
        next.delete(area.id);
        return next;
      });
    }
  };

  const handleRegenerateSelected = async () => {
    if (!selected || isGenerating) return;
    setIsGenerating(true);
    const idea = await requestGptIdea({
      text: `${selected.title} 아이디어를 더 구체적이고 차별화되게 재생성`,
      sourceIdeas: [selected],
      mode: 'generate',
      wx: selected.wx,
      wy: selected.wy,
    });
    logEvent('node_regenerate', { idea_id: selected.id });
    setIdeas(prev => placeIdeasOnAxis(prev.map(item => (
      item.id === selected.id
        ? { ...idea, id: selected.id, stars: selected.stars ? 1 : 0, aiGenerated: true, showAiBadge: true, aiBadgeType: 'regenerated' }
        : item
    )), currentAxis));
    setIsGenerating(false);
  };

  const handleDeleteSelected = () => {
    if (!selectedIdea) return;
    logEvent('node_delete', { idea_id: selectedIdea });
    setDeletedIds(prev => new Set([...prev, selectedIdea]));
    setSelectedIdea(null);
  };

  const handleToggleSelectedStar = () => {
    if (!selectedIdea) return;
    setIdeas(prev => prev.map(idea => (
      idea.id === selectedIdea ? { ...idea, stars: Number(idea.stars) > 0 ? 0 : 1 } : idea
    )));
  };

  const handleUpdateSelectedIdea = useCallback((patch) => {
    if (!selectedIdea || !patch || typeof patch !== 'object') return;
    setIdeas(prev => prev.map(idea => (
      idea.id === selectedIdea ? { ...idea, ...patch } : idea
    )));
  }, [selectedIdea]);

  const handleCombineDragStart = (id, e) => {
    const source = ideas.find(idea => idea.id === id);
    if (!source || isGenerating) return;
    const point = { wx: source.wx + 120, wy: source.wy + 70 };
    setCombineIds([id]);
    setCombineDrag({
      fromId: id,
      start: point,
      current: getPointerWorld(e),
    });
  };

  const handleIdeaClick = (id) => {
    logEvent('node_click', { idea_id: id });
    if (activeTool === 'union') {
      setSelectedIdea(id === selectedIdea ? null : id);
      return;
    }
    setSelectedIdea(id === selectedIdea ? null : id);
    setCriticMessages([]);
    setCriticState(null);
  };

  const handleRunCritique = async (note = '', options = {}) => {
    const rawTarget = selected || [...visibleIdeas].sort((a, b) => (b.stars || 0) - (a.stars || 0))[0];
    const target = getIdeaWithSessionDetail(rawTarget);
    if (!target || criticLoading) return;
    const baseState = options.state || criticStateRef.current || createCritiqueConversationState(target.id);
    const currentTopic = getActiveCritiqueTopic(baseState);
    if (!currentTopic) {
      setCriticState({ ...baseState, completed: true });
      return;
    }
    const trimmedNote = note.trim();
    const conversation = options.conversation ?? baseState.messages;
    const userMessage = trimmedNote
      ? { role: 'user', text: trimmedNote, topicKey: currentTopic.key, topicLabel: currentTopic.label }
      : null;
    if (trimmedNote) {
      setCriticMessages(prev => [...prev, userMessage]);
    }
    setCriticLoading(true);
    const response = await requestGptCritique({
      idea: target,
      userNote: trimmedNote,
      conversation,
      currentTopic,
      projectContext: getProjectContext(),
    });
    const critiqueMessage = {
      role: 'assistant',
      kind: 'critique',
      topicKey: currentTopic.key,
      topicLabel: currentTopic.label,
      text: [response.reflection, response.critique].filter(Boolean).join('\n\n'),
    };
    const questionMessage = {
      role: 'assistant',
      kind: 'question',
      topicKey: currentTopic.key,
      topicLabel: currentTopic.label,
      text: response.question,
    };
    const nextMessages = [
      ...baseState.messages,
      ...(userMessage ? [userMessage] : []),
      critiqueMessage,
      questionMessage,
    ];
    const nextState = transitionCritiqueConversationState(baseState, response, nextMessages);
    setCriticState(nextState);
    setCriticMessages(prev => [...prev, critiqueMessage]);
    await new Promise(resolve => setTimeout(resolve, 360));
    setCriticMessages(prev => [
      ...prev,
      questionMessage,
      ...(nextState.completed ? [{
        role: 'assistant',
        kind: 'complete',
        topicKey: 'complete',
        topicLabel: '완료',
        text: '크리틱 완료. 네 가지 논점을 모두 검토했습니다.',
      }] : []),
    ]);
    setCriticLoading(false);
  };

  const handleOpenCritic = () => {
    const target = selected || [...visibleIdeas].sort((a, b) => (b.stars || 0) - (a.stars || 0))[0];
    if (target) logEvent('ai_eval_view', { idea_id: target.id });
    const viewport = viewportRef.current;
    if (!criticPosition && viewport) {
      setCriticPosition({
        x: Math.max(20, (viewport.clientWidth - criticSize.width) / 2),
        y: Math.max(20, viewport.clientHeight - criticSize.height - 12),
      });
    }
    const initialState = createCritiqueConversationState(target?.id);
    setCriticState(initialState);
    setCriticMessages([]);
    setShowCritic(true);
    closeSeedInput();
    setActivePanel(null);
    setActiveTool('cursor');
    handleRunCritique('', { conversation: [], state: initialState });
  };

  const handleCriticDragStart = (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const panel = criticPanelRef.current;
    const viewport = viewportRef.current;
    if (!panel || !viewport) return;
    const panelRect = panel.getBoundingClientRect();
    criticDragRef.current = {
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleCriticDragMove = (event) => {
    const drag = criticDragRef.current;
    const panel = criticPanelRef.current;
    const viewport = viewportRef.current;
    if (!drag || !panel || !viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    setCriticPosition({
      x: clamp(event.clientX - viewportRect.left - drag.offsetX, 12, Math.max(12, viewport.clientWidth - panel.offsetWidth - 12)),
      y: clamp(event.clientY - viewportRect.top - drag.offsetY, 12, Math.max(12, viewport.clientHeight - panel.offsetHeight - 12)),
    });
  };

  const handleCriticDragEnd = (event) => {
    criticDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCriticWheel = (event) => {
    const container = criticScrollRef.current;
    if (!container) return;
    if (event.target === container || container.contains(event.target)) return;
    container.scrollTop += event.deltaY;
  };

  const handleCriticResizeStart = (event) => {
    if (event.button !== 0) return;
    const panel = criticPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    criticResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleCriticResizeMove = (event) => {
    const resize = criticResizeRef.current;
    const viewport = viewportRef.current;
    const panel = criticPanelRef.current;
    if (!resize || !viewport || !panel) return;
    const viewportRect = viewport.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const maxWidth = Math.max(340, viewportRect.right - panelRect.left - 12);
    const maxHeight = Math.max(320, viewportRect.bottom - panelRect.top - 12);
    setCriticSize({
      width: clamp(resize.startWidth + event.clientX - resize.startX, 340, maxWidth),
      height: clamp(resize.startHeight + event.clientY - resize.startY, 320, maxHeight),
    });
  };

  const handleCriticResizeEnd = (event) => {
    criticResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const makeCanvasReportSnapshot = (projectContext, axis, focusIdea = null, extra = {}) => ({
    layoutVersion: 3,
    positionMode: 'axis-fixed',
    projectTitle: projectContext.title || projectContext.idea || '진행 중인 프로젝트',
    projectInput: projectContext.input ?? projectContext.idea ?? '',
    axes: axis,
    axisLayout: buildAxisLayout(axis, visibleIdeas),
    ideas: visibleIdeas,
    selectedIdeaId: selectedIdea,
    zoom,
    offset,
    deletedIds: [...deletedIds],
    links: ideaLinks,
    spaces,
    activeSpaceId,
    groupLabels,
    groupAreas,
    groupingEnabled,
    ideaLinks,
    criticIdea: focusIdea,
    generatedAt: new Date().toISOString(),
    stats: {
      totalIdeas: visibleIdeas.length,
      aiGenerated: visibleIdeas.filter(idea => idea.aiGenerated || idea.showAiBadge).length,
      links: ideaLinks.length,
      deleted: deletedIds.size,
    },
    ...extra,
  });

  const handleCompleteProject = async () => {
    if (projectCompleting) return;
    setProjectCompleting(true);
    const projectContext = getProjectContext();
    const axis = getCurrentAxis(spaces, activeSpaceId);
    const focusIdea = selected || [...visibleIdeas].sort((a, b) => (b.stars || 0) - (a.stars || 0))[0] || null;
    try {
      const thumbnail = await requestGptProjectThumbnail({
        projectContext,
        ideas: visibleIdeas,
      });
      const completedAt = new Date().toISOString();
      const completedContext = {
        ...projectContext,
        status: 'done',
        img: thumbnail,
        thumbnail,
        completedAt,
        title: projectContext.title || projectContext.idea || '완료된 프로젝트',
      };
      const report = makeCanvasReportSnapshot(projectContext, axis, focusIdea, {
        status: 'done',
        completedAt,
        projectThumbnail: thumbnail,
      });
      await Promise.all([
        saveProjectContext(completedContext),
        saveGeneratedIdeas(visibleIdeas),
        saveCanvasWorkspace(report),
      ]);
      navigate('/dashboard');
    } catch (error) {
      console.warn('Failed to complete project', error);
      navigate('/dashboard');
    } finally {
      setProjectCompleting(false);
    }
  };

  const goDashboard = async () => {
    if (planGenerating) return;
    const projectContext = getProjectContext();
    const axis = getCurrentAxis(spaces, activeSpaceId);
    const focusIdea = selected || [...visibleIdeas].sort((a, b) => (b.stars || 0) - (a.stars || 0))[0] || null;
    const report = makeCanvasReportSnapshot(projectContext, axis, focusIdea);
    void saveCanvasWorkspace(report);

    if (!focusIdea) {
      navigate('/dashboard');
      return;
    }

    setPlanGenerating(true);
    try {
      const topIdeas = [...visibleIdeas]
        .filter(idea => idea.id !== focusIdea.id)
        .sort((a, b) => (b.stars || 0) - (a.stars || 0))
        .slice(0, 3);
      const plan = await requestFinalPlan({
        idea: focusIdea,
        projectContext,
        referenceIdeas: topIdeas,
      });
      const text = makeFinalPlanText({ report, focusIdea, plan });
      downloadTextFile(text, `${safeFinalPlanFileName(plan.ideaName || focusIdea.title)}.txt`);
      if (projectContext.projectId) {
        void saveFinalPlanDocument(projectContext.projectId, {
          ...plan,
          text,
          ideaId: focusIdea.id,
          ideaTitle: focusIdea.title,
          projectTitle: report.projectTitle,
        }).catch(error => {
          console.warn('Failed to save final plan to Firebase', error);
        });
      }
      navigate('/dashboard');
    } finally {
      setPlanGenerating(false);
    }
  };

  const activeCriticTopic = getActiveCritiqueTopic(criticConversationState);
  const criticComplete = Boolean(criticConversationState?.completed);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 80px)', overflow: 'hidden', width: '100%', position: 'relative' }}>
      <style>{`
        @keyframes detailPanelIn {
          from { opacity: 0; transform: translateX(28px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes toolPanelIn {
          from { opacity: 0; transform: translateX(-12px) scale(.98); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes seedBoxIn {
          from { opacity: 0; transform: translateX(-50%) translateY(18px) scale(.94); filter: blur(6px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes seedBoxOut {
          from { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); filter: blur(0); }
          to { opacity: 0; transform: translateX(-50%) translateY(20px) scale(.82); filter: blur(8px); }
        }
        @keyframes seedPillIn {
          from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(.88); filter: blur(5px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes criticTyping {
          0%, 60%, 100% { opacity: .28; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-4px); }
        }
        @keyframes combineSkeletonAppear {
          from { opacity: 0; transform: translateY(10px) scale(.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes combineSkeletonPulse {
          0%, 100% { box-shadow: 0 0 18px rgba(203,255,0,.1); }
          50% { box-shadow: 0 0 38px rgba(203,255,0,.28); }
        }
        @keyframes combineDotPulse {
          0%, 100% { opacity: .38; box-shadow: 0 0 0 0 rgba(203,255,0,.35); }
          50% { opacity: 1; box-shadow: 0 0 0 8px rgba(203,255,0,0); }
        }
        @keyframes combineLinkFlow {
          to { stroke-dashoffset: -22; }
        }
        @keyframes analysisAreaRefresh {
          from { opacity: 0; filter: blur(7px); }
          to { opacity: 1; filter: blur(0); }
        }
        @keyframes whitespaceSkeletonPulse {
          0%, 100% { box-shadow: 0 0 18px rgba(255,0,92,.12); }
          50% { box-shadow: 0 0 42px rgba(255,0,92,.34); }
        }
        @keyframes whitespaceDotPulse {
          0%, 100% { opacity: .4; box-shadow: 0 0 0 0 rgba(255,0,92,.42); }
          50% { opacity: 1; box-shadow: 0 0 0 8px rgba(255,0,92,0); }
        }
        .combine-skeleton-card {
          animation: combineSkeletonAppear .25s ease-out both, combineSkeletonPulse 1.8s ease-in-out .25s infinite;
        }
        .combine-skeleton-dot,
        .combine-generating-dot {
          background: #CBFF00;
          animation: combineDotPulse 1.15s ease-in-out infinite;
        }
        .combine-generating-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .combine-preview-link {
          animation: combineLinkFlow .8s linear infinite;
        }
        .whitespace-skeleton-card {
          animation: combineSkeletonAppear .25s ease-out both, whitespaceSkeletonPulse 1.65s ease-in-out .25s infinite;
        }
        .whitespace-skeleton-dot,
        .whitespace-generating-dot {
          background: #FF005C;
          animation: whitespaceDotPulse 1.15s ease-in-out infinite;
        }
        .whitespace-generating-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .zoom-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 12px;
          border-radius: 999px;
          background: linear-gradient(90deg, #CBFF00 0%, #CBFF00 var(--zoom-fill), #36393d var(--zoom-fill), #36393d 100%);
          outline: none;
        }
        .zoom-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 0;
          height: 0;
        }
        .zoom-slider::-moz-range-thumb {
          width: 0;
          height: 0;
          border: 0;
        }
        .canvas-viewport {
          --canvas-bottom-safe: max(32px, calc(env(safe-area-inset-bottom) + 24px));
        }
        .axis-x-labels {
          position: absolute;
          top: clamp(30px, 4vh, 44px);
          left: 0;
          right: 0;
          height: 22px;
          z-index: 20;
          pointer-events: none;
        }
        .axis-x-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #fff;
          letter-spacing: 0;
        }
        .axis-x-label.is-start {
          position: absolute;
          left: clamp(116px, 8vw, 152px);
          font-size: 11px;
          opacity: .72;
        }
        .axis-x-label.is-center {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          text-align: center;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0;
        }
        .axis-x-label.is-end {
          position: absolute;
          right: clamp(44px, 5vw, 80px);
          text-align: right;
          font-size: 11px;
          opacity: .72;
        }
        .axis-y-labels {
          position: absolute;
          top: clamp(80px, 12vh, 128px);
          right: clamp(10px, 1.2vw, 18px);
          bottom: clamp(124px, 16vh, 172px);
          width: 32px;
          z-index: 20;
          pointer-events: none;
        }
        .axis-y-label {
          position: absolute;
          left: 50%;
          max-width: min(62vh, 520px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #fff;
          transform: translate(-50%, -50%) rotate(90deg);
        }
        .axis-y-label.is-high {
          top: 8%;
          font-size: 11px;
          letter-spacing: 0;
          opacity: .72;
        }
        .axis-y-label.is-center {
          top: 50%;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0;
        }
        .axis-y-label.is-low {
          top: 92%;
          font-size: 11px;
          letter-spacing: 0;
          opacity: .72;
        }
      `}</style>

      {/* ── 뷰포트 ───────────────────────────────────────────────────────── */}
      <div
        ref={viewportRef}
        className="canvas-viewport"
        style={{ flex: 1, position: 'relative', cursor: 'grab', overflow: 'hidden' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* 인피니티 도트 배경 */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, #333 1px, transparent 1px)', backgroundSize: `${dotSpacing}px ${dotSpacing}px`, backgroundPosition: `${bgX}px ${bgY}px` }} />

        {/* 축 레이블 */}
        <div className="axis-x-labels">
          <span className="axis-x-label is-start">LOW {currentAxis.xAxis}</span>
          <span className="axis-x-label is-center">{currentAxis.xAxis}</span>
          <span className="axis-x-label is-end">HIGH {currentAxis.xAxis}</span>
        </div>
        <div className="axis-y-labels">
          <div className="axis-y-label is-high">HIGH {currentAxis.yAxis}</div>
          <div className="axis-y-label is-center">{currentAxis.yAxis}</div>
          <div className="axis-y-label is-low">LOW {currentAxis.yAxis}</div>
        </div>

        {/* 월드 */}
        <div style={{ position: 'absolute', transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: '0 0', width: WORLD_W, height: WORLD_H, zIndex: 1 }}>
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.22)' }} />
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.22)' }} />
          {visibleGroupAreas.map(area => {
            const color = area.color || '#CBFF00';
            const isWhitespace = color === '#FF005C';
            const isAreaGenerating = generatingWhitespaceIds.has(area.id);
            if (isWhitespace) {
              if (isAreaGenerating) return null;
              return (
                <div
                  key={area.id}
                  data-overlay="true"
                  style={{
                    position: 'absolute',
                    left: area.wx,
                    top: area.wy,
                    width: area.width,
                    height: area.height,
                    borderRadius: 18,
                    background: 'radial-gradient(circle at 50% 48%, rgba(255,0,92,0.18), rgba(255,0,92,0.08) 34%, rgba(255,0,92,0.02) 72%, rgba(255,0,92,0) 100%)',
                    boxShadow: '0 0 90px rgba(255,0,92,0.18)',
                    pointerEvents: 'auto',
                    zIndex: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 18,
                    animation: 'analysisAreaRefresh .32s ease-out both',
                  }}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <div style={{
                    width: 58,
                    height: 58,
                    borderRadius: 12,
                    background: '#FF005C',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 18px 48px rgba(255,0,92,0.32)',
                  }}>
                    <img src="/humbleicons_exclamation.svg" alt="" style={{ width: 30, height: 30, filter: 'brightness(0) invert(1)' }} />
                  </div>
                  <div style={{ color: '#f4dce6', fontSize: 18, fontWeight: 700, lineHeight: 1.4, textAlign: 'center', letterSpacing: -0.4 }}>
                    이 영역은 비어있습니다.<br />
                    노드를 추가하여 탐색하세요.
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => handleWriteWhitespace(area)}
                      style={{
                        height: 48,
                        minWidth: 160,
                        borderRadius: 7,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#1d1f1f',
                        color: '#fff',
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                      }}
                    >
                      <EditIcon /> 직접 작성하기
                    </button>
                    <button
                      type="button"
                      disabled={isAreaGenerating}
                      onClick={() => handleGenerateWhitespaceIdea(area)}
                      style={{
                        height: 48,
                        minWidth: 160,
                        borderRadius: 7,
                        border: 'none',
                        background: '#FF005C',
                        color: '#fff',
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: isAreaGenerating ? 'default' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                      }}
                    >
                      <AiIcon /> {isAreaGenerating ? '생성 중...' : '생성하기'}
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={area.id}
                style={{
                  position: 'absolute',
                  left: area.wx,
                  top: area.wy,
                  width: area.width,
                  height: area.height,
                  borderRadius: '50%',
                  border: `1.5px dashed ${isWhitespace ? 'rgba(255,0,92,0.9)' : 'rgba(203,255,0,0.78)'}`,
                  background: isWhitespace ? 'rgba(255,0,92,0.07)' : 'rgba(203,255,0,0.032)',
                  boxShadow: isWhitespace
                    ? '0 0 42px rgba(255,0,92,0.16), inset 0 0 80px rgba(255,0,92,0.06)'
                    : '0 0 30px rgba(203,255,0,0.08), inset 0 0 62px rgba(203,255,0,0.034)',
                  transform: `rotate(${area.rotate}deg)`,
                  transformOrigin: '50% 50%',
                  pointerEvents: 'none',
                  zIndex: 1,
                  animation: 'analysisAreaRefresh .32s ease-out both',
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: '50%',
                  top: 18,
                  transform: `translateX(-50%) rotate(${-area.rotate}deg)`,
                  color,
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: 1.2,
                  whiteSpace: 'nowrap',
                }}>
                  {area.label}
                </div>
              </div>
            );
          })}
          <svg width={WORLD_W} height={WORLD_H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible', zIndex: 2 }}>
            {ideaLinks.map((link, index) => {
              const from = ideas.find(idea => idea.id === link.from);
              const to = ideas.find(idea => idea.id === link.to);
              if (!from || !to || deletedIds.has(from.id) || deletedIds.has(to.id)) return null;
              const { start, end } = getConnectionPoints(from, to, scale);
              const midX = (start.x + end.x) / 2;
              return (
                <path
                  key={`${link.from}-${link.to}-${index}`}
                  d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeOpacity="0.9"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {combineSkeletons.flatMap(skeleton => (skeleton.parentIds || []).map((parentId, index) => {
              const from = ideas.find(idea => idea.id === parentId);
              if (!from || deletedIds.has(from.id)) return null;
              const { start, end } = getConnectionPoints(from, skeleton, scale);
              const midX = (start.x + end.x) / 2;
              return (
                <path
                  key={`${skeleton.id}-${parentId}-${index}`}
                  className="combine-preview-link"
                  d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                  fill="none"
                  stroke="#CBFF00"
                  strokeWidth="2"
                  strokeDasharray="7 8"
                  strokeLinecap="round"
                  strokeOpacity="0.72"
                  vectorEffect="non-scaling-stroke"
                />
              );
            }))}
            {combineDrag && (
              <path
                d={`M ${combineDrag.start.wx} ${combineDrag.start.wy} C ${combineDrag.start.wx + 180} ${combineDrag.start.wy}, ${combineDrag.current.wx - 180} ${combineDrag.current.wy}, ${combineDrag.current.wx} ${combineDrag.current.wy}`}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeOpacity="1"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {groupLabels.map(group => (
            <div key={group.id} style={{ position: 'absolute', left: group.wx, top: group.wy, color: '#CBFF00', fontSize: 13, fontWeight: 700, letterSpacing: 1.2, zIndex: 3 }}>
              {group.label}
            </div>
          ))}
          {combineSkeletons.map(skeleton => (
            <CombineSkeletonCard key={skeleton.id} skeleton={skeleton} scale={scale} />
          ))}
          {whitespaceSkeletons.map(skeleton => (
            <WhitespaceIdeaSkeletonCard key={skeleton.id} skeleton={skeleton} scale={scale} />
          ))}
          {visibleIdeas.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              isSelected={idea.id === selectedIdea}
              isCombineCandidate={combineIds.includes(idea.id)}
              showConnectionHandles={activeTool === 'union'}
              onClick={() => handleIdeaClick(idea.id)}
              onCombineDragStart={handleCombineDragStart}
              onHover={setHoveredIdea}
              isUnionMode={activeTool === 'union'}
              isHovered={hoveredIdea === idea.id}
              childInput={idea.id === selectedIdea ? childInput : ''}
              onChildInputChange={setChildInput}
              onChildSubmit={handleCreateChildIdea}
              isGeneratingChild={isGenerating}
              scale={scale}
            />
          ))}
        </div>

        {/* 좌측 툴바 */}
        <CanvasSidebar
          activeTool={activeTool}
          onToolChange={handleToolChange}
          showSpacePanel={activePanel === 'space'}
          onSpaceClick={handleSpaceClick}
          onCompleteProject={() => { void handleCompleteProject(); }}
          completeLoading={projectCompleting}
        />

        {/* 공간 패널 */}
        {activePanel === 'space' && (
          <SpacePanel
            spaces={spaces}
            activeSpaceId={activeSpaceId}
            onSelectSpace={handleSelectSpace}
            onAddSpace={() => setShowAxisModal(true)}
            onClose={() => setActivePanel(null)}
          />
        )}

        {/* 노드 액션 버튼 (뷰포트 좌표) */}
        {actionPos && (
          <div data-overlay="true" style={{ position: 'absolute', left: actionPos.x, top: actionPos.y, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 25 }}>
            {nodeActions.map(action => (
              <div key={action.key} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button
                  disabled={action.key === 'plan' && planGenerating}
                  onMouseEnter={() => setHoveredAction(action.key)}
                  onMouseLeave={() => setHoveredAction(null)}
                  onClick={() => {
	                    if (action.key === 'plan')   void goDashboard();
	                    if (action.key === 'regen')  handleRegenerateSelected();
	                    if (action.key === 'edit')   { setInputText(selected?.title || ''); openSeedInput(); }
	                    if (action.key === 'delete') handleDeleteSelected();
	                  }}
                  style={{ width: 36, height: 36, borderRadius: '50%', background: `rgba(26,26,26,0.5) padding-box, linear-gradient(180deg, #666666 0%, #353535 50%, #666666 100%) border-box`, border: '1px solid transparent', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', cursor: action.key === 'plan' && planGenerating ? 'default' : 'pointer', opacity: action.key === 'plan' && planGenerating ? .62 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: action.color, transition: 'background .15s' }}
                >
                  {action.icon}
                </button>
                {hoveredAction === action.key && (
                  <div style={{ position: 'absolute', left: 44, top: '50%', transform: 'translateY(-50%)', background: '#111', color: action.color, fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 6, border: `1px solid ${action.color}30`, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 30 }}>
                    {action.label}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 확장 크리틱 */}
        {showCritic && (
          <div
            ref={criticPanelRef}
            data-overlay="true"
            data-critic-panel="true"
            onWheel={handleCriticWheel}
            style={{
              position: 'absolute',
              left: criticPosition?.x ?? '50%',
              top: criticPosition?.y ?? 'auto',
              bottom: criticPosition ? 'auto' : 'calc(var(--canvas-bottom-safe) + 74px)',
              transform: criticPosition ? 'none' : 'translateX(-50%)',
              width: criticSize.width,
              height: criticSize.height,
              minWidth: 340,
              minHeight: 320,
              maxWidth: 'calc(100% - 24px)',
              maxHeight: 'calc(100% - 24px)',
              ...glass(0.72, 18), borderRadius: 14, zIndex: 50,
              boxSizing: 'border-box', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 22px 72px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.06)',
            }}
          >
            <div
              onPointerDown={handleCriticDragStart}
              onPointerMove={handleCriticDragMove}
              onPointerUp={handleCriticDragEnd}
              onPointerCancel={handleCriticDragEnd}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 18px', borderBottom: '1px solid rgba(255,255,255,.08)', cursor: 'move', touchAction: 'none', flexShrink: 0 }}
            >
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 750, margin: 0 }}>AI 크리틱</h3>
                <span style={{ color: '#777', fontSize: 10 }}>
                  {criticComplete ? '크리틱 완료' : `현재 논점 · ${activeCriticTopic?.label || '준비 중'}`}
                </span>
              </div>
              <button onClick={() => setShowCritic(false)} style={{ color: '#888', fontSize: 16, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
            <div ref={criticScrollRef} style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '16px 18px' }}>
              {criticConversationState?.topics?.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                  {criticConversationState.topics.map(topic => {
                    const active = topic.status === 'active';
                    const resolved = topic.status === 'resolved';
                    return (
                      <span
                        key={topic.key}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 999,
                          background: active ? 'rgba(203,255,0,.16)' : resolved ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.04)',
                          border: `1px solid ${active ? 'rgba(203,255,0,.42)' : resolved ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.08)'}`,
                          color: active ? '#CBFF00' : resolved ? '#aaa' : '#666',
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: .2,
                        }}
                      >
                        {resolved ? '✓ ' : ''}{topic.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {criticMessages.map((message, index) => {
                const isUser = message.role === 'user';
                const isQuestion = message.kind === 'question';
                const isComplete = message.kind === 'complete';
                return (
                  <div key={`${message.role}-${index}`} style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '88%', minWidth: 0 }}>
                    <div style={{ color: isUser ? '#8ca72d' : isQuestion ? '#CBFF00' : '#777', fontSize: 9, fontWeight: 800, letterSpacing: .8, margin: '0 5px 4px', textAlign: isUser ? 'right' : 'left' }}>
                      {isUser ? 'YOU' : isComplete ? 'AI CRITIC · DONE' : `AI CRITIC${message.topicLabel ? ` · ${message.topicLabel}` : ''}`}
                    </div>
                    <div style={{
                      background: isUser ? 'rgba(203,255,0,.12)' : isQuestion ? 'rgba(203,255,0,.08)' : isComplete ? 'rgba(255,255,255,.06)' : '#292929',
                      border: `1px solid ${isUser ? 'rgba(203,255,0,.28)' : isQuestion ? 'rgba(203,255,0,.34)' : '#383838'}`,
                      borderRadius: isUser ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                      padding: '11px 13px', color: isUser ? '#eaff9c' : isQuestion ? '#eefcc5' : '#d0d0d0',
                      fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-line', overflowWrap: 'anywhere',
                    }}>{message.text}</div>
                  </div>
                );
              })}
              {criticLoading && (
                <div style={{ alignSelf: 'flex-start' }}>
                  <div style={{ color: '#777', fontSize: 9, fontWeight: 800, letterSpacing: .8, margin: '0 5px 4px' }}>AI CRITIC</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: 66, height: 38, padding: '0 13px', borderRadius: '12px 12px 12px 3px', background: '#292929', border: '1px solid #383838', boxSizing: 'border-box' }}>
                    {[0, 1, 2].map(index => <span key={index} style={{ width: 6, height: 6, borderRadius: '50%', background: '#CBFF00', animation: 'criticTyping 1.1s ease-in-out infinite', animationDelay: `${index * .16}s` }} />)}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 18px 16px', background: '#242424', borderRadius: 24, padding: '8px 10px 8px 16px', border: '1px solid #393939', flexShrink: 0 }}>
              <input
                value={criticInput}
                onChange={e => setCriticInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && criticInput.trim() && !criticLoading && !criticComplete) {
                    handleRunCritique(criticInput);
                    setCriticInput('');
                  }
                }}
                disabled={criticComplete}
                placeholder={criticComplete ? '크리틱이 완료되었습니다' : criticLoading ? 'AI가 답변을 작성하고 있어요…' : 'AI 크리틱과 대화하세요...'}
                style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 13 }}
              />
              <button
                onClick={() => { if (criticInput.trim() && !criticComplete) { handleRunCritique(criticInput); setCriticInput(''); } }}
                disabled={criticLoading || criticComplete || !criticInput.trim()}
                style={{ width: 30, height: 30, borderRadius: '50%', background: criticInput.trim() && !criticLoading && !criticComplete ? '#CBFF00' : '#3a3a3a', color: criticInput.trim() && !criticLoading && !criticComplete ? '#111' : '#777', fontSize: 14, border: 'none', cursor: criticInput.trim() && !criticLoading && !criticComplete ? 'pointer' : 'default' }}
              >↑</button>
            </div>
            <div
              role="separator"
              aria-label="크리틱 채팅창 크기 조절"
              aria-orientation="horizontal"
              title="드래그해 크기 조절"
              onPointerDown={handleCriticResizeStart}
              onPointerMove={handleCriticResizeMove}
              onPointerUp={handleCriticResizeEnd}
              onPointerCancel={handleCriticResizeEnd}
              style={{
                position: 'absolute', right: 0, bottom: 0, width: 24, height: 24,
                cursor: 'nwse-resize', touchAction: 'none', zIndex: 3,
                background: 'linear-gradient(135deg, transparent 48%, rgba(203,255,0,.34) 49%, rgba(203,255,0,.34) 55%, transparent 56%, transparent 66%, rgba(203,255,0,.7) 67%, rgba(203,255,0,.7) 73%, transparent 74%)',
              }}
            />
          </div>
        )}

        {/* 하단 입력바 — 클릭 시 확장 */}
        {(inputExpanded || inputClosing) ? (
          <div data-overlay="true" style={{ position: 'absolute', bottom: 'var(--canvas-bottom-safe)', left: '50%', transform: 'translateX(-50%)', width: 'min(860px, 80%)', zIndex: 30, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: inputClosing ? 'none' : 'auto', animation: `${inputClosing ? 'seedBoxOut .22s ease-in both' : 'seedBoxIn .32s cubic-bezier(.16,1,.3,1) both'}` }}>
	            <div style={{ color: '#aaa', fontSize: 13, lineHeight: 1.5 }}>첫 줄은 제목, 다음 줄부터는 본문으로 저장됩니다.</div>
            <div style={{
              position: 'relative',
              ...glass(0.42, 22),
              background: 'linear-gradient(135deg, rgba(52,55,58,.72), rgba(22,24,26,.6)) padding-box, linear-gradient(135deg, rgba(255,255,255,.34), rgba(203,255,0,.28), rgba(255,255,255,.1)) border-box',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12), inset 0 0 0 1px rgba(255,255,255,.035), 0 22px 70px rgba(0,0,0,.42), 0 0 34px rgba(203,255,0,.06)',
              borderRadius: 16,
            }}>
              <textarea
                autoFocus
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') closeSeedInput();
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleCreateIdea();
                }}
	                placeholder={'아이디어 제목\n아이디어 본문을 입력하세요'}
	                style={{ width: '100%', minHeight: 120, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 15, padding: '18px 70px 18px 20px', resize: 'none', lineHeight: 1.7, boxSizing: 'border-box' }}
              />
              <button
                onClick={handleCreateIdea}
                disabled={isGenerating || !inputText.trim()}
                style={{ position: 'absolute', bottom: 14, right: 14, width: 44, height: 44, borderRadius: '50%', background: inputText.trim() ? '#CBFF00' : '#333', color: inputText.trim() ? '#111' : '#777', border: 'none', cursor: inputText.trim() ? 'pointer' : 'default', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .18s, color .18s' }}
              >{isGenerating ? '…' : '✓'}</button>
            </div>
          </div>
        ) : (
          <div data-overlay="true" style={{ position: 'absolute', bottom: 'var(--canvas-bottom-safe)', left: '50%', transform: 'translateX(-50%)', width: 'min(480px, calc(100% - 40px))', zIndex: 30, animation: 'seedPillIn .3s cubic-bezier(.16,1,.3,1) both' }}>
            <div onClick={openSeedInput} style={{
              background: 'rgba(26,26,26,0.2) padding-box, linear-gradient(180deg, #666666 0%, #353535 50%, #666666 100%) border-box',
              border: '1.5px solid transparent',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              height: 58,
              borderRadius: 999,
              padding: '0 23px',
              display: 'flex',
              alignItems: 'center',
              cursor: 'text',
              boxSizing: 'border-box',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), 0 12px 42px rgba(0,0,0,.18)',
              transition: 'transform .22s ease, box-shadow .22s ease, background .22s ease',
            }}>
              <span style={{ flex: 1, color: '#b0b0b0', fontSize: 16 }}>아이디어를 입력하세요...</span>
            </div>
          </div>
        )}

        {/* 줌 컨트롤 */}
        <div data-overlay="true" style={{
          position: 'absolute',
          bottom: 'var(--canvas-bottom-safe)',
          right: 20,
          width: 280,
          height: 60,
          borderRadius: 999,
          background: 'rgba(17,17,17,0.78)',
          border: '2px solid rgba(176,176,176,0.28)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.38), inset 0 0 0 1px rgba(255,255,255,0.04)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          boxSizing: 'border-box',
        }}>
          <button onClick={() => setZoom(z => Math.max(20, z - 10))} style={{ color: '#bdbdbd', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, flexShrink: 0, padding: 0 }} title="줌 아웃"><ZoomOutIcon /></button>
          <input
            className="zoom-slider"
            type="range"
            min={20}
            max={200}
            value={zoom}
            onChange={e => setZoom(+e.target.value)}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              cursor: 'pointer',
              '--zoom-fill': `${((zoom - 20) / 180) * 100}%`,
            }}
          />
          <button onClick={() => setZoom(z => Math.min(200, z + 10))} style={{ color: '#bdbdbd', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, flexShrink: 0, padding: 0 }} title="줌 인"><ZoomInIcon /></button>
          <span style={{
            minWidth: 56,
            height: 36,
            borderRadius: 999,
            background: '#33363a',
            color: '#CBFF00',
            fontSize: 18,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            letterSpacing: 0,
          }}>{Math.round(zoom)}%</span>
        </div>

        {axisRelayoutProgress !== null && (
          <div
            data-overlay="true"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 90,
              background: 'rgba(0,0,0,0.58)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
            }}
          >
            <div style={{
              width: 280,
              padding: '24px 26px',
              borderRadius: 10,
              background: 'rgba(20,20,20,0.88)',
              border: '1px solid rgba(203,255,0,0.28)',
              boxShadow: '0 24px 70px rgba(0,0,0,0.42)',
            }}>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, marginBottom: 14 }}>축에 맞춰 재배치 중</div>
              <div style={{ color: '#CBFF00', fontSize: 32, fontWeight: 850, marginBottom: 16 }}>{axisRelayoutProgress}%</div>
              <div style={{ height: 7, borderRadius: 999, background: '#303030', overflow: 'hidden' }}>
                <div style={{ width: `${axisRelayoutProgress}%`, height: '100%', borderRadius: 999, background: '#CBFF00', transition: 'width .18s ease-out' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 우측 상세 패널 ───────────────────────────────────────────────── */}
      {selected && (
        <IdeaDetailPanel
          key={`${selected.id}-${currentAxis.xAxis}-${currentAxis.yAxis}`}
          idea={selected}
          onExpand={handleOpenCritic}
          width={detailPanelWidth}
          onWidthChange={setDetailPanelWidth}
          onToggleStar={handleToggleSelectedStar}
          onIdeaUpdate={handleUpdateSelectedIdea}
        />
      )}

      {/* ── 축 설정 모달 ─────────────────────────────────────────────────── */}
      {showAxisModal && <AxisSetupModal onConfirm={handleAddSpace} onClose={() => setShowAxisModal(false)} />}
    </div>
  );
}
