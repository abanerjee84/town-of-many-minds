/**
 * Provider boundary for the council. Every adapter receives the same frozen
 * system/user messages and returns the same normalized reply, so changing a
 * model cannot change the simulation or parser contract.
 */
const providers = new Map();

function completionURL(endpoint) {
  const base = String(endpoint || '/lm/v1').replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

export function createOpenAICompatibleProvider(options = {}) {
  const id = options.id || 'openai-compatible';
  const label = options.label || id;
  return {
    id,
    label,
    kind: 'openai-compatible',
    async complete({ endpoint, model, messages, temperature = 0, maxTokens = 160, signal } = {}) {
      const fetcher = options.fetch || globalThis.fetch;
      if (typeof fetcher !== 'function') throw new Error('no fetch implementation is available');
      const response = await fetcher(completionURL(endpoint || options.endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        signal,
        body: JSON.stringify({
          ...(model || options.model ? { model: model || options.model } : {}),
          temperature,
          max_tokens: maxTokens,
          messages
        })
      });
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240); } catch { /* preserve the HTTP status */ }
        throw new Error(`HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
      }
      const data = await response.json();
      return {
        text: data?.choices?.[0]?.message?.content || '',
        model: data?.model || model || options.model || id,
        usage: data?.usage || null,
        raw: data
      };
    }
  };
}

export function normalizeLLMProvider(provider, fallback = createOpenAICompatibleProvider()) {
  if (typeof provider === 'function') return { id: provider.id || 'custom', label: provider.label || provider.id || 'custom', complete: provider };
  if (provider && typeof provider.complete === 'function') {
    return { id: provider.id || provider.name || 'custom', label: provider.label || provider.name || provider.id || 'custom', ...provider };
  }
  return fallback;
}

export function registerLLMProvider(provider, id = null) {
  const normalized = normalizeLLMProvider(provider);
  const key = id || normalized.id;
  if (!key) throw new Error('LLM provider requires an id');
  normalized.id = key;
  providers.set(key, normalized);
  return normalized;
}

export function getLLMProvider(id) {
  return providers.get(id) || null;
}

export function listLLMProviders() {
  return [...providers.values()].map((p) => ({ id: p.id, label: p.label || p.id }));
}

export function resolveLLMProvider(provider, options = {}) {
  if (typeof provider === 'string') {
    const registered = getLLMProvider(provider);
    if (!registered) throw new Error(`unknown LLM provider: ${provider}`);
    return registered;
  }
  if (provider) return normalizeLLMProvider(provider);
  return createOpenAICompatibleProvider(options);
}

registerLLMProvider(createOpenAICompatibleProvider({
  id: 'openai-compatible',
  label: 'OpenAI-compatible endpoint'
}));
