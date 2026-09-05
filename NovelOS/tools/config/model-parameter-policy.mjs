// Route-specific compatibility rules, reviewed 2026-09-05. See model-parameter-compatibility.md.
export function checkModelParameters(model = {}) {
  const name = String(model.modelName || '').toLowerCase();
  const failures = [];
  if (/^feelfish\/gpt-5\.6-(luna|terra)$/.test(name)) {
    for (const key of ['temperature', 'top_p', 'top_logprobs']) {
      if (Object.hasOwn(model, key)) failures.push(`UNSUPPORTED_${key.toUpperCase()}`);
    }
    if (model.reasoningEffort !== undefined && !['low', 'medium', 'high', 'xhigh'].includes(model.reasoningEffort)) failures.push('INVALID_REASONING_EFFORT');
  }
  if (/^feelfish\/glm-5\.3(-flash)?$/.test(name)) {
    if (model.enableThinkingMode === false) failures.push('THINKING_CANNOT_BE_DISABLED');
    if (model.reasoningEffort !== undefined && !['low', 'high', 'max'].includes(model.reasoningEffort)) failures.push('INVALID_REASONING_EFFORT');
    if (model.temperature !== undefined && !(typeof model.temperature === 'number' && model.temperature >= 0 && model.temperature <= 1)) failures.push('INVALID_TEMPERATURE');
  }
  if (name === 'feelfish/kimi-k3') {
    if (model.enableThinkingMode === false) failures.push('THINKING_CANNOT_BE_DISABLED');
    if (model.reasoningEffort !== undefined && model.reasoningEffort !== 'max') failures.push('HOST_UNSUPPORTED_REASONING_EFFORT');
  }
  if (/^feelfish\/deepseek-v4-(flash|pro)$/.test(name)) {
    if (model.reasoningEffort !== undefined && !['low', 'high', 'max'].includes(model.reasoningEffort)) failures.push('INVALID_REASONING_EFFORT');
    if (model.temperature !== undefined && !(typeof model.temperature === 'number' && model.temperature >= 0 && model.temperature <= 2)) failures.push('INVALID_TEMPERATURE');
  }
  return failures;
}
