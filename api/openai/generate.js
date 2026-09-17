const readBody = async (request) => {
  if (request.body && typeof request.body === 'object') return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const envString = value => String(value || '').trim().replace(/^['"]|['"]$/g, '');

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const apiKey = envString(process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY);
  if (!apiKey) {
    response.status(503).json({ error: 'OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.' });
    return;
  }

  try {
    const { prompt, system, temperature = 0.7 } = await readBody(request);
    if (typeof prompt !== 'string' || !prompt.trim()) {
      response.status(400).json({ error: '생성 프롬프트가 필요합니다.' });
      return;
    }

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: envString(process.env.OPENAI_MODEL || process.env.VITE_OPENAI_MODEL || 'gpt-4o'),
        messages: [
          { role: 'system', content: system || 'You are a helpful assistant that responds only with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: Math.max(0, Math.min(2, Number(temperature) || 0.7)),
        response_format: { type: 'json_object' },
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      response.status(upstream.status).json({ error: data.error?.message || 'OpenAI API 요청에 실패했습니다.' });
      return;
    }

    response.status(200).json({ content: data.choices?.[0]?.message?.content || '' });
  } catch (error) {
    response.status(500).json({ error: error.message || 'AI 생성 중 오류가 발생했습니다.' });
  }
}
