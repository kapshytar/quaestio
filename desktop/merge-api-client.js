// ========== MERGE API CLIENT ==========
// Ported from Android MergeApiClient.kt

const MERGE_PROVIDERS = {
  CHATGPT: {
    id: 'chatgpt_api',
    title: 'ChatGPT API',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini'
  },
  DEEPSEEK: {
    id: 'deepseek_api',
    title: 'DeepSeek API',
    defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat'
  },
  GEMINI: {
    id: 'gemini_api',
    title: 'Gemini API',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash'
  },
  PERPLEXITY: {
    id: 'perplexity_api',
    title: 'Perplexity API',
    defaultEndpoint: 'https://api.perplexity.ai/chat/completions',
    defaultModel: 'sonar'
  },
  CLAUDE: {
    id: 'claude_api',
    title: 'Claude API',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-5-sonnet-latest'
  },
  OPENROUTER: {
    id: 'openrouter_api',
    title: 'OpenRouter API',
    defaultEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini'
  },
  HUGGINGFACE: {
    id: 'huggingface_api',
    title: 'Hugging Face API',
    defaultEndpoint: 'https://router.huggingface.co/v1/chat/completions',
    defaultModel: ''
  },
  CUSTOM: {
    id: 'custom_api',
    title: 'Custom OpenAI-Compatible',
    defaultEndpoint: '',
    defaultModel: ''
  }
};

const DEFAULT_MERGE_INSTRUCTIONS = `You are a neutral synthesis editor.
Write strictly in clean Markdown, with calm concise wording.

Formatting rules (mandatory):
- Keep structure exactly:
  - \`## Consensus\`
  - \`## Disagreements\` (include only if real disagreements exist)
  - \`## Practical Answer\`
- Use bullet lists with one idea per bullet.
- Do NOT use horizontal rules (---), "Download", or code fences unless user explicitly asked for code.
- For tables, output valid GitHub Markdown tables only:
  - header row
  - separator row with exactly one --- per column
  - consistent column count in all rows`;

class MergeApiClient {
  constructor() {
    this.provider = MERGE_PROVIDERS.CHATGPT;
    this.apiKey = '';
    this.endpoint = '';
    this.model = '';
    this.fallbackModels = [];
    this.providerConfigs = {};
    this.mergeInstructions = '';
    this.clarificationInstructions = '';
    this.mergeHistory = '';
    this.lastSourcePrompt = '';
    this.lastOriginalResponses = {};
    this.onLog = null; // (message, type, detail) => void — set by renderer
  }

  _log(message, type = 'info', detail = null) {
    if (typeof this.onLog === 'function') this.onLog(message, type, detail);
    console.log(`[MergeApiClient][${type}] ${message}`);
  }

  async merge(responses, isClarification = false, clarificationText = '', previousSummary = '', onPartial = null) {
    // Save BEFORE building config so config.originalResponses is always up to date
    if (!isClarification && Object.keys(responses).length > 0) {
      this.lastOriginalResponses = responses;
    }

    const config = {
      provider: this.provider,
      apiKey: this.apiKey,
      endpoint: this.endpoint || this.provider.defaultEndpoint,
      model: this.model || this.provider.defaultModel,
      fallbackModels: this.fallbackModels,
      instructions: this.mergeInstructions || DEFAULT_MERGE_INSTRUCTIONS,
      clarificationInstructions: this.clarificationInstructions,
      sourcePrompt: this.lastSourcePrompt,
      isClarification: isClarification,
      clarificationText: clarificationText,
      previousSummary: previousSummary,
      originalResponses: this.lastOriginalResponses || {},
      onPartial: typeof onPartial === 'function' ? onPartial : null
    };

    const prompt = this.buildPrompt(config, responses);

    const systemPrompt = config.isClarification
      ? (config.clarificationInstructions || 'You are a helpful assistant continuing a conversation. Respond naturally and helpfully.')
      : 'Synthesize multi-model output.';

    // For clarification: build chat history with original scraped responses as context
    const chatHistory = config.isClarification
      ? this.buildClarificationHistory(config.previousSummary, config.originalResponses, config.sourcePrompt)
      : null;

    // Log the full outgoing payload
    const messages = this._buildMessagesPreview(systemPrompt, chatHistory, prompt, config);
    this._log(
      `→ ${isClarification ? 'Follow-up' : 'Merge'} → POST ${config.endpoint}  [${config.model}]`,
      'send',
      { endpoint: config.endpoint, model: config.model, messages }
    );

    try {
      let result;
      if (config.provider.id === 'claude_api') {
        result = await this.callClaude(config, prompt, systemPrompt, chatHistory);
      } else if (config.provider.id === 'gemini_api') {
        result = await this.callGemini(config, prompt, systemPrompt, chatHistory);
      } else {
        result = await this.callOpenAiWithFallbacks(config, prompt, systemPrompt, chatHistory);
      }

      const fullResponse = this.appendMetadata(result, config.provider);
      this._log(`← OK  [${result.modelUsed || config.model}]  ${fullResponse.length} chars`, 'recv', fullResponse);
      return { success: true, text: fullResponse };
    } catch (error) {
      this._log(`✗ ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  // Build a preview of the messages array for debug logging (masks api key)
  _buildMessagesPreview(systemPrompt, chatHistory, prompt, config) {
    const msgs = [{ role: 'system', content: systemPrompt }];
    if (chatHistory && chatHistory.length > 0) msgs.push(...chatHistory);
    msgs.push({ role: 'user', content: prompt });
    return msgs;
  }

  // Build clarification chat history: original responses as context + conversation turns
  buildClarificationHistory(historyStr, originalResponses, sourcePrompt) {
    // Parse history first — starts with "Assistant: <summary>..."
    const historyMsgs = this.parseHistoryToMessages(historyStr);

    const hasOriginal = originalResponses && Object.keys(originalResponses).length > 0;
    const responsesBlock = hasOriginal
      ? Object.entries(originalResponses)
          .map(([model, text]) => `### ${model}\n${text.slice(0, 4000)}`)
          .join('\n\n')
      : null;

    const messages = [];

    // user: original user question + scraped LLM responses as context
    if (responsesBlock) {
      const originalQuestionPrefix = sourcePrompt
        ? `The user's original question was: "${sourcePrompt}"\n\nHere are the AI model responses to that question:\n\n`
        : `Here are the original AI model responses to synthesize:\n\n`;
      messages.push({
        role: 'user',
        content: `${originalQuestionPrefix}${responsesBlock}\n\n(Your first task, shown below, was to synthesize these responses — identifying consensus and disagreements, and presenting a unified answer.)`
      });
    } else if (sourcePrompt) {
      messages.push({
        role: 'user',
        content: `The user's original question was: "${sourcePrompt}"\n\n(Your first task, shown below, was to synthesize all AI responses to that question — identifying consensus and disagreements, and presenting a unified answer.)`
      });
    }

    // Merge the first Assistant turn (the synthesis) with the context reply,
    // so we never get two assistant messages in a row.
    // historyMsgs[0] is always role:assistant (the synthesis result)
    let firstAssistantContent = historyMsgs.length > 0 && historyMsgs[0].role === 'assistant'
      ? historyMsgs[0].content
      : null;

    if (firstAssistantContent) {
      messages.push({ role: 'assistant', content: firstAssistantContent });
      // Append the rest of the conversation (User/Assistant turns after the first synthesis)
      messages.push(...historyMsgs.slice(1));
    } else {
      // No synthesis yet — just push all history
      messages.push(...historyMsgs);
    }

    return messages;
  }

  // Parse "User: ...\n\nAssistant: ..." history string into [{role, content}] array
  // Drops the last entry if it's a User turn (it will be sent as the current prompt)
  parseHistoryToMessages(historyStr) {
    if (!historyStr) return [];
    const messages = [];
    const parts = historyStr.split(/\n\n(?=User:|Assistant:)/);
    for (const part of parts) {
      if (part.startsWith('User:')) {
        messages.push({ role: 'user', content: part.slice('User:'.length).trim() });
      } else if (part.startsWith('Assistant:')) {
        messages.push({ role: 'assistant', content: part.slice('Assistant:'.length).trim() });
      }
    }
    // If history already ends with the user's latest message, drop it (sent separately as prompt)
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      messages.pop();
    }
    return messages;
  }

  buildPrompt(config, responses) {
    if (config.isClarification) {
      // Just the latest user message — history is passed as proper chat turns
      return config.clarificationText;
    }

    const languageRule = config.sourcePrompt
      ? `Write output in the same language as this original user question: "${config.sourcePrompt}".`
      : 'Write output in the dominant language used in the source responses.';

    return `${config.instructions}

${languageRule}

Responses:
${Object.entries(responses).map(([model, text]) => `### ${model}\n${text.slice(0, 6000)}\n`).join('\n')}`;
  }

  async callOpenAiWithFallbacks(config, prompt, systemPrompt, chatHistory = null) {
    const models = [config.model, ...this.parseFallbackModels(config.fallbackModels)].filter(m => m);
    let lastError = null;
    const attempted = [];

    for (const model of models) {
      attempted.push(model);
      try {
        console.log(`[MergeApiClient] Trying model: ${model}`);
        if (typeof config.onPartial === 'function') config.onPartial('');
        const result = await this.callOpenAi(config, prompt, model, systemPrompt, chatHistory);
        return { ...result, attemptedModels: attempted };
      } catch (error) {
        lastError = error;
        const canRetry = this.isRateLimitedError(error);
        console.warn(`[MergeApiClient] Model ${model} failed: ${error.message}, canRetry=${canRetry}`);
        if (!canRetry || model === models[models.length - 1]) {
          throw error;
        }
      }
    }
    throw lastError || new Error('All fallback models failed');
  }

  async callOpenAi(config, prompt, model, systemPrompt, chatHistory = null) {
    // Build messages: system + history (if any) + current user message
    const messages = [{ role: 'system', content: systemPrompt }];
    if (chatHistory && chatHistory.length > 0) {
      messages.push(...chatHistory);
    }
    messages.push({ role: 'user', content: prompt });

    const payload = {
      model: model,
      messages: messages,
      temperature: 0.2,
      stream: true
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    };

    // OpenRouter extra headers
    if (config.provider.id === 'openrouter_api') {
      headers['HTTP-Referer'] = 'https://github.com/kvitaliq-maker/chat-aggregator-android';
      headers['X-Title'] = 'Verity';
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`HTTP ${response.status}: ${errData.error?.message || 'Request failed'}`);
    }

    const data = await this.readSseJsonStream(response, (json) => {
      const chunk = json?.choices?.[0]?.delta?.content;
      return typeof chunk === 'string' ? chunk : '';
    }, config.onPartial);
    const text = data.text.trim();
    if (!text) throw new Error('Empty response from provider');

    return {
      text: text,
      modelUsed: data.modelUsed || model
    };
  }

  async callClaude(config, prompt, systemPrompt, chatHistory = null) {
    const messages = [];
    if (chatHistory && chatHistory.length > 0) {
      messages.push(...chatHistory);
    }
    messages.push({ role: 'user', content: prompt });

    const payload = {
      model: config.model || 'claude-3-5-sonnet-latest',
      max_tokens: 1200,
      system: systemPrompt,
      messages: messages,
      stream: true
    };

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`HTTP ${response.status}: ${errData.error?.message || 'Request failed'}`);
    }

    const data = await this.readSseJsonStream(response, (json) => {
      const deltaText = json?.delta?.text;
      return typeof deltaText === 'string' ? deltaText : '';
    }, config.onPartial);
    const text = data.text.trim();
    if (!text) throw new Error('Empty response from Claude');

    return {
      text: text,
      modelUsed: data.modelUsed || config.model
    };
  }

  async readSseJsonStream(response, getChunkText, onPartial = null) {
    if (!response.body) {
      throw new Error('Streaming response body is unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalText = '';
    let modelUsed = '';

    const processSseBlock = (block) => {
      const lines = block.split('\n');
      let dataLines = [];
      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length === 0) return;
      const dataStr = dataLines.join('\n');
      if (!dataStr || dataStr === '[DONE]') return;

      try {
        const json = JSON.parse(dataStr);
        if (!modelUsed && typeof json.model === 'string') modelUsed = json.model;
        const chunk = getChunkText(json);
        if (chunk) {
          finalText += chunk;
          if (typeof onPartial === 'function') onPartial(finalText);
        }
      } catch (_) {
        // ignore malformed partial chunks
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');

      let splitIdx = buffer.indexOf('\n\n');
      while (splitIdx !== -1) {
        const block = buffer.slice(0, splitIdx);
        buffer = buffer.slice(splitIdx + 2);
        processSseBlock(block);
        splitIdx = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode().replace(/\r/g, '');
    if (buffer.trim()) {
      const trailingBlocks = buffer.split('\n\n');
      trailingBlocks.forEach(processSseBlock);
    }

    return {
      text: finalText,
      modelUsed
    };
  }

  async callGemini(config, prompt, systemPrompt, chatHistory = null) {
    const model = config.model || 'gemini-2.0-flash';
    const endpoint = `${config.endpoint.replace(/\/$/, '')}/models/${model}:generateContent?key=${config.apiKey}`;

    // Gemini uses 'user'/'model' roles (not 'assistant')
    const contents = [];
    if (chatHistory && chatHistory.length > 0) {
      for (const msg of chatHistory) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.2
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data.error?.message || 'Request failed'}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response from Gemini');

    return {
      text: text,
      modelUsed: data.modelVersion || model
    };
  }

  appendMetadata(result, provider) {
    const attempted = result.attemptedModels || [result.modelUsed];
    const fallbackUsed = attempted.length > 1;

    return `${result.text.trim()}

---
Merge provider: \`${provider.id}\`
LLM used: \`${result.modelUsed}\`
Fallback used: \`${fallbackUsed ? 'yes' : 'no'}\`
Attempted models: \`${attempted.join(' -> ')}\``;
  }

  parseFallbackModels(raw) {
    if (!raw) return [];
    return raw.split(/[,\n;]/).map(m => m.trim()).filter(m => m);
  }

  isRateLimitedError(error) {
    const msg = (error.message || '').toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
  }

  _emptyProviderConfig() {
    return {
      apiKey: '',
      endpoint: '',
      model: '',
      fallbackModels: ''
    };
  }

  _setActiveProviderFields(providerId) {
    const cfg = this.providerConfigs[providerId] || this._emptyProviderConfig();
    this.apiKey = cfg.apiKey || '';
    this.endpoint = cfg.endpoint || '';
    this.model = cfg.model || '';
    this.fallbackModels = cfg.fallbackModels || '';
  }

  setProviderById(providerId) {
    this.provider = Object.values(MERGE_PROVIDERS).find(p => p.id === providerId) || MERGE_PROVIDERS.CHATGPT;
    this._setActiveProviderFields(this.provider.id);
  }

  _providerConfigFromInputs(providerId = this.provider.id) {
    const apiKeyInput = document.getElementById('merge-api-key');
    const endpointInput = document.getElementById('merge-endpoint');
    const modelInput = document.getElementById('merge-model');
    const fallbackInput = document.getElementById('merge-fallback-models');

    let apiKey = apiKeyInput?.value.trim() || '';
    let endpoint = endpointInput?.value.trim() || '';
    let model = modelInput?.value.trim() || '';
    let fallbackModels = fallbackInput?.value.trim() || '';

    // OpenRouter + HuggingFace convenience:
    // allow "model1, model2" or newline-separated models directly in the Model field.
    const modelSupportsInlineFallbacks = ['openrouter_api', 'huggingface_api'].includes(providerId);
    if (modelSupportsInlineFallbacks) {
      const parsedModelList = this.parseFallbackModels(model);
      const fallbackFieldEmpty = !String(fallbackModels || '').trim();

      if (parsedModelList.length > 1 && fallbackFieldEmpty) {
        model = parsedModelList[0];
        fallbackModels = parsedModelList.slice(1).join(', ');
      }
    }

    return { apiKey, endpoint, model, fallbackModels };
  }

  saveFormForProvider(providerId) {
    if (!providerId) return;
    this.providerConfigs[providerId] = this._providerConfigFromInputs(providerId);
  }

  hasAnyConfiguredApiKey() {
    const providerConfigs = this.providerConfigs && typeof this.providerConfigs === 'object'
      ? Object.values(this.providerConfigs)
      : [];

    return providerConfigs.some(cfg => String(cfg?.apiKey || '').trim().length > 0);
  }

  // Config persistence
  saveConfig() {
    const providerSelect = document.getElementById('merge-provider');
    const instructionsInput = document.getElementById('merge-instructions');
    const clarificationInstructionsInput = document.getElementById('clarification-instructions');

    if (providerSelect) {
      this.provider = Object.values(MERGE_PROVIDERS).find(p => p.id === providerSelect.value) || MERGE_PROVIDERS.CHATGPT;
    }

    const currentProviderConfig = this._providerConfigFromInputs(this.provider.id);
    this.providerConfigs[this.provider.id] = currentProviderConfig;
    this._setActiveProviderFields(this.provider.id);

    if (instructionsInput) this.mergeInstructions = instructionsInput.value.trim();
    if (clarificationInstructionsInput) this.clarificationInstructions = clarificationInstructionsInput.value.trim();

    const config = {
      version: 2,
      providerId: this.provider.id,
      providerConfigs: this.providerConfigs,
      mergeInstructions: this.mergeInstructions,
      clarificationInstructions: this.clarificationInstructions
    };
    localStorage.setItem('merge-config', JSON.stringify(config));
  }

  loadConfig() {
    const saved = localStorage.getItem('merge-config');
    if (!saved) return;

    try {
      const config = JSON.parse(saved);

      // Backward compatibility: upgrade legacy flat config into per-provider map.
      if (config.providerConfigs && typeof config.providerConfigs === 'object') {
        this.providerConfigs = { ...config.providerConfigs };
      } else {
        const legacyProviderId = config.providerId || MERGE_PROVIDERS.CHATGPT.id;
        this.providerConfigs = {
          [legacyProviderId]: {
            apiKey: config.apiKey || '',
            endpoint: config.endpoint || '',
            model: config.model || '',
            fallbackModels: config.fallbackModels || ''
          }
        };
      }

      this.provider = Object.values(MERGE_PROVIDERS).find(p => p.id === config.providerId) || MERGE_PROVIDERS.CHATGPT;
      this._setActiveProviderFields(this.provider.id);
      this.mergeInstructions = config.mergeInstructions || '';
      this.clarificationInstructions = config.clarificationInstructions || '';
    } catch (e) {
      console.error('[MergeApiClient] Failed to load config:', e);
    }
  }
}

// Global instance
window.mergeApiClient = new MergeApiClient();
