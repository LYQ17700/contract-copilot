/**
 * Stub Provider：让 A/B 在 OCR 完成前就能联调整条链路。
 * 返回内容带明确标记，绝不伪装成真实识别结果。
 *
 * @owner 后端 B
 */
export function stubProvider() {
  return {
    name: 'stub',
    async recognize(buffer, { documentId } = {}) {
      const custom = process.env.OCR_STUB_TEXT;
      return {
        text: custom || [
          '房屋租赁合同（OCR 占位文本）',
          '出租方（甲方）：示例公寓管理有限公司',
          '第一条 押金与租金',
          '月租金人民币2000元，押金6000元，一次性支付全年租金。',
          '第二条 违约责任',
          '乙方提前退租的，押金不予退还。'
        ].join('\n'),
        confidence: 0,
        notices: ['OCR_PROVIDER=stub：当前返回的是占位文本，仅用于联调，不能用于演示结论。设置 OCR_STUB_TEXT 可自定义。'],
        bytes: buffer.length,
        documentId
      };
    }
  };
}
