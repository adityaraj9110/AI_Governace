const pricing = require('./pricing.json');

/**
 * Calculate the cost of an LLM API call in USD.
 * @param {string} model - Model identifier (e.g., 'gemini-2.0-flash')
 * @param {number} promptTokens - Number of input tokens
 * @param {number} completionTokens - Number of output tokens
 * @returns {{ cost: number, inputCost: number, outputCost: number, model: string, provider: string }}
 */
function calculateCost(model, promptTokens, completionTokens) {
  const modelPricing = pricing[model];

  if (!modelPricing) {
    return {
      cost: 0,
      inputCost: 0,
      outputCost: 0,
      model,
      provider: 'unknown',
      error: `No pricing data for model: ${model}`
    };
  }

  const inputCost = (promptTokens / 1_000_000) * modelPricing.input;
  const outputCost = (completionTokens / 1_000_000) * modelPricing.output;

  return {
    cost: parseFloat((inputCost + outputCost).toFixed(6)),
    inputCost: parseFloat(inputCost.toFixed(6)),
    outputCost: parseFloat(outputCost.toFixed(6)),
    model,
    provider: modelPricing.provider
  };
}

/**
 * Get pricing info for a model.
 * @param {string} model
 * @returns {{ input: number, output: number, provider: string } | null}
 */
function getModelPricing(model) {
  return pricing[model] || null;
}

/**
 * Get all supported models.
 * @returns {string[]}
 */
function getSupportedModels() {
  return Object.keys(pricing);
}

/**
 * Get models grouped by provider.
 * @returns {Object<string, string[]>}
 */
function getModelsByProvider() {
  const grouped = {};
  for (const [model, info] of Object.entries(pricing)) {
    if (!grouped[info.provider]) grouped[info.provider] = [];
    grouped[info.provider].push(model);
  }
  return grouped;
}

module.exports = { calculateCost, getModelPricing, getSupportedModels, getModelsByProvider };
