export const config = {
  maxDuration: 60,
};

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
    const { prompt, size = '1024x1024', quality = 'low' } = await readBody(request);
    if (typeof prompt !== 'string' || !prompt.trim()) {
      response.status(400).json({ error: '이미지 생성 프롬프트가 필요합니다.' });
      return;
    }

    const upstream = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: envString(process.env.OPENAI_IMAGE_MODEL || process.env.VITE_OPENAI_IMAGE_MODEL || 'gpt-image-1'),
        prompt,
        n: 1,
        size,
        quality,
        background: 'opaque',
        output_format: 'png',
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      response.status(upstream.status).json({ error: data.error?.message || 'OpenAI 이미지 생성 요청에 실패했습니다.' });
      return;
    }

    const image = data.data?.[0] || {};
    if (image.b64_json) {
      response.status(200).json({ image: `data:image/png;base64,${image.b64_json}` });
      return;
    }
    if (image.url) {
      response.status(200).json({ image: image.url });
      return;
    }

    response.status(502).json({ error: 'OpenAI 이미지 응답 형식이 올바르지 않습니다.' });
  } catch (error) {
    response.status(500).json({ error: error.message || 'AI 이미지 생성 중 오류가 발생했습니다.' });
  }
}
