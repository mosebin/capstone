import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const readRequestBody = request => new Promise((resolve, reject) => {
  let body = ''
  request.on('data', chunk => {
    body += chunk
    if (body.length > 100_000) reject(new Error('Request body is too large.'))
  })
  request.on('end', () => resolve(body))
  request.on('error', reject)
})

const sendJson = (response, status, payload) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

const openAiProxy = env => ({
  name: 'openai-api-proxy',
  configureServer(server) {
    server.middlewares.use('/api/openai/generate', async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' })
        return
      }
      const apiKey = String(env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || '').trim().replace(/^['"]|['"]$/g, '')
      if (!apiKey) {
        sendJson(response, 503, { error: 'OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.' })
        return
      }
      try {
        const { prompt, system, temperature = 0.7 } = JSON.parse(await readRequestBody(request))
        if (typeof prompt !== 'string' || !prompt.trim()) {
          sendJson(response, 400, { error: '생성 프롬프트가 필요합니다.' })
          return
        }
        const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: String(env.OPENAI_MODEL || env.VITE_OPENAI_MODEL || 'gpt-4o').trim().replace(/^['"]|['"]$/g, ''),
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            temperature: Math.max(0, Math.min(2, Number(temperature) || 0.7)),
            response_format: { type: 'json_object' },
          }),
        })
        const data = await upstream.json().catch(() => ({}))
        if (!upstream.ok) {
          sendJson(response, upstream.status, { error: data.error?.message || 'OpenAI API 요청에 실패했습니다.' })
          return
        }
        sendJson(response, 200, { content: data.choices?.[0]?.message?.content || '' })
      } catch (error) {
        sendJson(response, 500, { error: error.message || 'AI 생성 중 오류가 발생했습니다.' })
      }
    })

    server.middlewares.use('/api/openai/image', async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' })
        return
      }
      const apiKey = String(env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || '').trim().replace(/^['"]|['"]$/g, '')
      if (!apiKey) {
        sendJson(response, 503, { error: 'OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.' })
        return
      }
      try {
        const { prompt, size = '1024x1024', quality = 'low' } = JSON.parse(await readRequestBody(request))
        if (typeof prompt !== 'string' || !prompt.trim()) {
          sendJson(response, 400, { error: '이미지 생성 프롬프트가 필요합니다.' })
          return
        }
        const model = String(env.OPENAI_IMAGE_MODEL || env.VITE_OPENAI_IMAGE_MODEL || 'gpt-image-1').trim().replace(/^['"]|['"]$/g, '')
        const upstream = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            prompt,
            n: 1,
            size,
            quality,
            background: 'opaque',
            output_format: 'png',
          }),
        })
        const data = await upstream.json().catch(() => ({}))
        if (!upstream.ok) {
          sendJson(response, upstream.status, { error: data.error?.message || 'OpenAI 이미지 생성 요청에 실패했습니다.' })
          return
        }
        const image = data.data?.[0] || {}
        if (image.b64_json) {
          sendJson(response, 200, { image: `data:image/png;base64,${image.b64_json}` })
          return
        }
        if (image.url) {
          sendJson(response, 200, { image: image.url })
          return
        }
        sendJson(response, 502, { error: 'OpenAI 이미지 응답 형식이 올바르지 않습니다.' })
      } catch (error) {
        sendJson(response, 500, { error: error.message || 'AI 이미지 생성 중 오류가 발생했습니다.' })
      }
    })
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), openAiProxy(env)],
    build: {
      target: 'chrome103',
      cssTarget: 'chrome103',
    },
  }
})
