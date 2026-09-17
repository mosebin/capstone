function normalizeCell(value) {
  return String(value || '작성된 내용 없음').replace(/\s*\n+\s*/g, ' / ').trim();
}

export function getIdeaReferenceNumber(report = {}, focusIdea = null) {
  const index = (report.ideas || []).findIndex(idea => idea.id === focusIdea?.id);
  return index >= 0 ? index + 1 : focusIdea?.id || '미정';
}

export function makeFinalPlanText({ report = {}, focusIdea = null, plan = {} }) {
  const referenceNumber = getIdeaReferenceNumber(report, focusIdea);
  const rows = [
    ['아이디어명', `${plan.ideaName || focusIdea?.title || '최종 선택 아이디어'} (참고 번호: ${referenceNumber})`],
    ['한 줄 요약', plan.oneSentenceSummary],
    ['문제/니즈 정의', plan.problemDefinition],
    ['타겟 사용자', plan.targetUser],
    ['핵심 기능/실행 방식', plan.coreFeatures],
    ['차별화 포인트', plan.differentiation],
    ['기대 효과/가치', plan.expectedEffect],
  ];
  return rows.map(([label, value]) => `| ${label} | ${normalizeCell(value)} |`).join('\n');
}

export function safeFinalPlanFileName(name) {
  return String(name || 'neo-node-final-plan').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

export function downloadTextFile(text, fileName) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
