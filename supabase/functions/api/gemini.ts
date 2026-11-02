// Gemini (Google AI) does the planning work: bracket formats, seeding, schedules, texts and suggestions.
// Every answer is JSON that the caller checks; when the AI is unavailable the callers fall back to plain rules.
import { settings, UserError } from './common.ts';

// Several models are tried in turn: the newest ones are often overloaded, the lite ones answer fast.
// app_settings can put others first: gemini_model (one) or gemini_models (comma separated).
const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
const TRY_NEXT = new Set([404, 429, 500, 502, 503, 504]);

export class AiUnavailable extends UserError {}

export async function askJson<T>(system: string, input: unknown, schema: Record<string, unknown>, temperature = 0.4): Promise<T> {
  const cfg = await settings(['gemini_api_key', 'gemini_model', 'gemini_models']);
  const key = Deno.env.get('GEMINI_API_KEY')?.trim() || cfg.gemini_api_key;
  if (!key) throw new AiUnavailable('The AI assistant is not set up yet.');
  const preferred = [cfg.gemini_model, ...(cfg.gemini_models ?? '').split(',')].map((m) => m?.trim()).filter(Boolean);
  for (const model of new Set([...preferred, ...MODELS])) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: typeof input === 'string' ? input : JSON.stringify(input) }] }],
          generationConfig: { temperature, responseMimeType: 'application/json', responseJsonSchema: schema },
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('gemini', model, res.status, JSON.stringify(data).slice(0, 300));
        if (TRY_NEXT.has(res.status)) continue;
        break;
      }
      const parts: { text?: string; thought?: boolean }[] = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      return JSON.parse(text) as T;
    } catch (error) {
      console.warn('gemini failed', model, String(error));
    }
  }
  throw new AiUnavailable('The AI assistant is busy right now. Please try again in a minute.');
}
