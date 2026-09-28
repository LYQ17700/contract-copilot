import { kbMeta } from './kb.mjs';

const SEV = { high: { label: '高', rank: 3 }, mid: { label: '中', rank: 2 }, low: { label: '低', rank: 1 } };

const FACT_LABEL = [
  ['monthlyRent', '月租金（元）'],
  ['deposit', '押金（元）'],
  ['depositMonths', '押金折合月数'],
  ['prepaidMonths', '单次预付租金月数'],
  ['leaseYears', '约定租期（年）'],
  ['penaltyDailyRate', '逾期违约金日费率'],
  ['landlordDailyAmount', '房东逾期每日赔付（元）'],
  ['elecPrice', '电费单价（元/度）']
];

export function buildReport({ document: doc, findings, stats, facts, grade, notices }) {
  const kb = kbMeta();
  const byCategory = new Map();
  findings.forEach((f) => {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category).push(f);
  });
  const md = [];
  md.push('# 合同避坑报告');
  md.push('');
  md.push('- 文件：' + doc.filename + '（解析引擎 ' + doc.engine + '，' + doc.pageCount + ' 页，' + doc.clauses.length + ' 个条款）');
  md.push('- 生成时间：' + new Date().toLocaleString('zh-CN', { hour12: false }));
  md.push('- 风险总评：**' + grade.level + ' · ' + grade.label + '**（风险分 ' + stats.score + '）');
  md.push('- 命中风险条款：' + findings.length + ' 处（高 ' + findings.filter((f) => f.severity === 'high').length + ' / 中 ' + findings.filter((f) => f.severity === 'mid').length + ' / 低 ' + findings.filter((f) => f.severity === 'low').length + '）');
  md.push('- 可信校验：' + stats.verified + ' 处已通过「原文引用 + 法条引用」双校验，' + stats.needsReview + ' 处待人工复核');
  md.push('');
  md.push('## 一、关键条款抽取');
  md.push('');
  md.push('| 项目 | 识别结果 |');
  md.push('| --- | --- |');
  FACT_LABEL.forEach(([key, label]) => {
    md.push('| ' + label + ' | ' + (facts[key] === null || facts[key] === undefined ? '未识别' : facts[key]) + ' |');
  });
  md.push('');
  md.push('## 二、风险清单（按原文顺序）');
  for (const finding of findings) {
    md.push('');
    md.push('### [' + (SEV[finding.severity]?.label || '?') + '] ' + finding.name + '　（' + finding.clauseHeading + '）');
    md.push('');
    md.push('- 合同原文：> ' + finding.evidence);
    md.push('- 这意味着：' + finding.plain);
    md.push('- 为什么是坑：' + finding.why);
    md.push('- 建议改法：' + finding.fix);
    md.push('- 依据：');
    finding.citations.forEach((c) => {
      md.push('  - ' + c.entry.source + ' ' + c.entry.article + '（' + c.entry.topic + '；检索方式：' + (c.via === 'rule' ? '规则绑定' : 'BM25 语义检索') + (c.entry.review === 'pending' ? '；⚠ 法条序号待专家复核' : '') + '）');
    });
    if (finding.status !== 'verified') md.push('  - ⚠ 可信校验未通过，需人工复核');
  }
  md.push('');
  md.push('## 三、按类别汇总');
  md.push('');
  md.push('| 类别 | 命中数 | 最高等级 |');
  md.push('| --- | --- | --- |');
  for (const [cat, list] of byCategory) {
    const top = list.slice().sort((a, b) => (SEV[b.severity]?.rank || 0) - (SEV[a.severity]?.rank || 0))[0];
    md.push('| ' + cat + ' | ' + list.length + ' | ' + (SEV[top.severity]?.label || '') + ' |');
  }
  md.push('');
  md.push('## 四、待复核与局限');
  md.push('');
  if (stats.pendingExpertReview.length) md.push('- 以下法条条号尚未由共享资源池的法学专家复核：' + stats.pendingExpertReview.join('、'));
  if (stats.needsReview) md.push('- ' + stats.needsReview + ' 条命中结果未通过自动校验，已标记为待人工复核，不作为结论使用。');
  (notices || []).forEach((n) => md.push('- 提示：' + n));
  md.push('- 本报告为产品演示输出，基于规则库 + 检索增强生成，不构成法律意见；重大合同请咨询执业律师。');
  md.push('');
  md.push('---');
  md.push('知识库：' + kb.meta.name + '（' + kb.size + ' 条）｜规则库：' + stats.ruleCount + ' 条｜模型：' + (stats.model || '离线规则引擎（未接入大模型）'));
  return { markdown: md.join('\n') };
}