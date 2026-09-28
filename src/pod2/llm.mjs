import { SYSTEM_PROMPT, userPrompt } from './prompts.mjs';
import { kbEntry } from './kb.mjs';

export function llmConfig() {
  const apiKey = process.env.CONTRACT_COPILOT_LLM_KEY || (process.env.CONTRACT_COPILOT_LLM === '1' ? process.env.OPENAI_API_KEY : undefined);
  if (!apiKey) return { enabled: false, reason: '未设置 CONTRACT_COPILOT_LLM_KEY（或 CONTRACT_COPILOT_LLM=1 + OPENAI_API_KEY），本次仅使用离线规则引擎。' };
  return {
    enabled: true,
    apiKey,
    baseUrl: (process.env.CONTRACT_COPILOT_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.CONTRACT_COPILOT_LLM_MODEL || 'gpt-5.2'
  };
}

export async function enrich({ clauses, facts, kbIds }) {
  const config = llmConfig();
  if (!config.enabled) return { added: [], notice: config.reason, model: null };
  const digest = Array.from(new Set([...(kbIds || []), 'MFZ-496', 'MFZ-497', 'MFZ-585', 'MFZ-712', 'MFZ-713', 'MFZ-725', 'MFZ-731', 'BHQ-6']))
    .map((id) => kbEntry(id))
    .filter(Boolean)
    .map((e) => e.id + ' | ' + e.source + ' ' + e.article + ' | ' + e.text)
    .join('\n');
  const body = {
    model: config.model,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt({ clauses, kbDigest: digest, facts }) }
    ]
  };
  try {
    const res = await fetch(config.baseUrl + '/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { added: [], notice: '大模型调用失败（HTTP ' + res.status + '），已回退到离线规则引擎。', model: config.model };
    const json = await res.json();
    const text = typeof json.output_text === 'string' ? json.output_text : JSON.stringify(json.output ?? json);
    const parsed = JSON.parse(text.replace(/^[\s\S]*?(\[)/, '$1').replace(/(\])[\s\S]*$/, '$1'));
    const added = parsed
      .filter((item) => item && item.quote)
      .map((item) => ({
        id: 'LLM-' + (item.clause_id || 'x') + '-' + Math.random().toString(36).slice(2, 7),
        ruleId: item.rule_hint || 'LLM-ADHOC',
        name: item.name || item.rule_hint || '模型补充提示',
        category: '模型补充',
        severity: ['high', 'mid', 'low'].includes(item.severity) ? item.severity : 'mid',
        clauseId: item.clause_id,
        clauseHeading: (clauses.find((c) => c.id === item.clause_id) || {}).heading || '（未定位）',
        evidence: item.quote,
        plain: item.plain || '',
        why: item.why || '',
        fix: item.fix || '',
        citations: (item.kb_ids || []).map((id) => ({ via: 'llm', entry: kbEntry(id) })).filter((c) => c.entry),
        source: 'llm'
      }));
    return { added, notice: '已接入 ' + config.model + '，补充 ' + added.length + ' 条模型结论（同样通过原文校验）。', model: config.model };
  } catch (error) {
    return { added: [], notice: '大模型不可用（' + error.message + '），已回退到离线规则引擎。', model: config.model };
  }
}