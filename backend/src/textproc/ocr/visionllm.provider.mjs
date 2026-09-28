import { config } from '../../config/index.mjs';
import { NotImplementedError, UpstreamError } from '../../domain/errors.mjs';

/**
 * 视觉大模型 OCR（拍照/扫描件效果最好，也是兜底方案）。
 *
 * @owner 后端 B
 * @todo(后端B-3) 与 Pod2 联调：确认 base64 体积上限、超时与重试；评估能否直接返回带坐标的条款结构
 */
export function visionLlmProvider() {
  const apiKey = process.env.VISION_LLM_KEY || process.env.CONTRACT_COPILOT_LLM_KEY;
  const baseUrl = (process.env.VISION_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.VISION_LLM_MODEL || 'gpt-5-vision';
  return {
    name: 'vision-llm',
    async recognize(buffer) {
      if (!apiKey) throw new NotImplementedError('未配置 VISION_LLM_KEY（或 CONTRACT_COPILOT_LLM_KEY）', '后端 B');
      const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '逐字提取图片中的合同文字，保留条款编号与换行，不要解释、不要补全。' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,' + buffer.toString('base64') } }
              ]
            }
          ]
        })
      });
      if (!res.ok) throw new UpstreamError('vision-llm', '视觉模型调用失败 HTTP ' + res.status);
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new UpstreamError('vision-llm', '视觉模型返回内容为空');
      return { text: String(text).trim(), confidence: null, notices: ['文字由视觉模型转写，未经逐字校对，重要合同请人工复核'] };
    }
  };
}
