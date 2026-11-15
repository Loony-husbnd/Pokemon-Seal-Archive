// Proelium 배틀 기록 수집기 — Cloudflare Worker + KV
//  배포:  cd tools/log-collector && npx wrangler kv namespace create LOGS   (나온 id 를 wrangler.toml 에 넣는다)
//         npx wrangler deploy   → 나온 주소를 저장소 변수 LOG_ENDPOINT 에 넣으면 다음 배포부터 전송이 켜진다
//  내려받기: GET /export?key=<ADMIN_KEY>  (npx wrangler secret put ADMIN_KEY 로 비밀키 설정) → JSON Lines
const MAX_BYTES = 512 * 1024;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (req.method === 'GET' && url.pathname === '/export') {
      if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return new Response('forbidden', { status: 403 });
      const lines = []; let cursor;
      do {
        const page = await env.LOGS.list({ prefix: 'b:', cursor });
        for (const k of page.keys) lines.push(await env.LOGS.get(k.name));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return new Response(lines.filter(Boolean).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
    }

    if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS });
    const body = await req.text();
    if (body.length > MAX_BYTES) return new Response('too large', { status: 413, headers: CORS });
    let log;
    try { log = JSON.parse(body); } catch (e) { return new Response('bad json', { status: 400, headers: CORS }); }
    // 형식 검사: 우리 앱이 보낸 기록처럼 생긴 것만 저장한다
    if (log.schema !== 1 || typeof log.id !== 'string' || log.id.length > 64 || !Array.isArray(log.steps) || !Array.isArray(log.parties) || !log.result) {
      return new Response('invalid', { status: 422, headers: CORS });
    }
    await env.LOGS.put('b:' + log.at + ':' + log.id, JSON.stringify(log));   // 같은 id 를 다시 보내도 같은 키라 중복되지 않는다
    return new Response('ok', { headers: CORS });
  },
};
