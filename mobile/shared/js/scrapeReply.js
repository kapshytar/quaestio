(function registerScrapeReplyScript(global) {
  function run(payload) {
    try {
      const serviceId = String(payload?.serviceId || '');
      const sourcePrompt = String(payload?.sourcePrompt || '');
      const rawReplyOverride = String(payload?.rawReplyOverride || '');

      function visible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      }

      function normalizeText(t) {
        return String(t || '')
          .replace(/\r/g, '')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }

      function normalizeInlineText(t) {
        return String(t || '')
          .replace(/\r/g, '')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
      }

      function normalizeMathText(value) {
        return String(value || '')
          .replace(/\\text\{([^}]*)\}/g, '$1')
          .replace(/\\circ/g, '°')
          .replace(/\\pm/g, '±')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function tableToMarkdown(tableEl) {
        const rows = Array.from(tableEl.querySelectorAll('tr'))
          .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => normalizeInlineText(extractInlineText(cell))))
          .filter((row) => row.some((cell) => cell.length > 0));
        if (rows.length < 2) return '';
        const colCount = rows.reduce((acc, row) => Math.max(acc, row.length), 0);
        if (colCount < 2) return '';

        const esc = (value) => String(value || '').replace(/\|/g, '\\|');
        const pad = (row) => {
          const out = row.slice(0, colCount);
          while (out.length < colCount) out.push('');
          return out;
        };

        const header = pad(rows[0]);
        const body = rows.slice(1).map(pad);
        const sep = Array(colCount).fill('---');

        const lines = [];
        lines.push('| ' + header.map(esc).join(' | ') + ' |');
        lines.push('| ' + sep.join(' | ') + ' |');
        body.forEach((row) => lines.push('| ' + row.map(esc).join(' | ') + ' |'));
        return lines.join('\n');
      }

      function shouldSkipElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (['BUTTON', 'SVG', 'PATH', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'MAT-ICON', 'USER-QUERY'].includes(tag)) return true;
        if (el.getAttribute('aria-hidden') === 'true') return true;
        const className = String(el.className || '');
        return /table-footer|action-button|copy-button|buttons-container|response-container-header|response-container-footer/i.test(className)
          || !!el.closest('.table-footer, [hide-from-message-actions]');
      }

      function extractInlineText(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node;
        if (shouldSkipElement(el)) return '';
        if (el.classList?.contains('math-inline') || el.classList?.contains('katex') || (el.tagName || '').toUpperCase() === 'MATH') {
          const math = el.getAttribute('data-math')
            || el.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent
            || el.querySelector?.('annotation')?.textContent;
          if (math) return normalizeMathText(math);
        }
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'BR') return '\n';
        if (tag === 'STRONG' || tag === 'B') return '**' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '**';
        if (tag === 'EM' || tag === 'I') return '*' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '*';
        if (tag === 'CODE' && !el.closest('pre')) return '`' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '`';
        if (tag === 'A') return normalizeInlineText(el.textContent || el.href || '');
        if (tag === 'P') return Array.from(el.childNodes || []).map(extractInlineText).join('');
        return Array.from(el.childNodes || []).map(extractInlineText).join('');
      }

      function extractStructuredText(rootEl) {
        if (!rootEl) return '';
        const parts = [];
        const blockTags = new Set([
          'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
          'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV',
          'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'UL'
        ]);

        function pushNewline() {
          if (parts.length === 0) return;
          if (!String(parts[parts.length - 1]).endsWith('\n')) parts.push('\n');
        }

        function walk(node) {
          if (!node) return;

          if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.nodeValue || '');
            return;
          }

          if (node.nodeType !== Node.ELEMENT_NODE) return;

          const el = node;
          const tag = (el.tagName || '').toUpperCase();
          if (shouldSkipElement(el)) return;
          if (!visible(el) && el !== rootEl) return;

          if (tag === 'BR') {
            parts.push('\n');
            return;
          }

          if (tag === 'TABLE') {
            const md = tableToMarkdown(el);
            if (md) {
              pushNewline();
              parts.push(md);
              parts.push('\n');
              return;
            }
          }

          if (tag === 'HR') {
            pushNewline();
            parts.push('---');
            pushNewline();
            return;
          }

          if (tag === 'BLOCKQUOTE') {
            pushNewline();
            const text = normalizeText(el.innerText || el.textContent || '');
            text.split('\n').forEach((line) => parts.push(`> ${line}\n`));
            pushNewline();
            return;
          }

          if (tag === 'PRE') {
            pushNewline();
            const codeEl = el.querySelector('code');
            const lang = (codeEl?.className || '').match(/language-(\w+)/)?.[1] || '';
            parts.push('```' + lang + '\n');
            Array.from((codeEl || el).childNodes || []).forEach(walk);
            if (!String(parts[parts.length - 1]).endsWith('\n')) parts.push('\n');
            parts.push('```');
            pushNewline();
            return;
          }

          if (tag === 'STRONG' || tag === 'B') {
            parts.push('**');
            Array.from(el.childNodes || []).forEach(walk);
            parts.push('**');
            return;
          }

          if (tag === 'EM' || tag === 'I') {
            parts.push('*');
            Array.from(el.childNodes || []).forEach(walk);
            parts.push('*');
            return;
          }

          if (tag === 'CODE' && !el.closest('pre')) {
            parts.push('`');
            Array.from(el.childNodes || []).forEach(walk);
            parts.push('`');
            return;
          }

          const headingMatch = tag.match(/^H([1-6])$/);
          if (headingMatch) {
            pushNewline();
            parts.push('#'.repeat(parseInt(headingMatch[1], 10)) + ' ');
            Array.from(el.childNodes || []).forEach(walk);
            pushNewline();
            return;
          }

          if (tag === 'LI') {
            pushNewline();
            let depth = 0;
            let parent = el.parentElement;
            while (parent) {
              const parentTag = (parent.tagName || '').toUpperCase();
              if (parentTag === 'UL' || parentTag === 'OL') depth += 1;
              if (parent === rootEl) break;
              parent = parent.parentElement;
            }
            const indent = '  '.repeat(Math.max(0, depth - 1));
            const parentTag = (el.parentElement?.tagName || '').toUpperCase();
            parts.push(indent);
            if (parentTag === 'OL') {
              const idx = Array.from(el.parentElement.children).indexOf(el) + 1;
              parts.push(idx + '. ');
            } else {
              parts.push('- ');
            }
            const nestedLists = [];
            const inlineSegments = [];
            Array.from(el.childNodes || []).forEach((child) => {
              if (child?.nodeType === Node.ELEMENT_NODE) {
                const childTag = (child.tagName || '').toUpperCase();
                if (childTag === 'UL' || childTag === 'OL') {
                  nestedLists.push(child);
                  return;
                }
              }
              const segment = extractInlineText(child);
              if (segment) inlineSegments.push(segment);
            });
            parts.push(inlineSegments.join('').trim());
            pushNewline();
            nestedLists.forEach((child) => walk(child));
            return;
          }

          const isBlock = blockTags.has(tag);
          if (isBlock) pushNewline();
          Array.from(el.childNodes || []).forEach(walk);
          if (isBlock) pushNewline();
        }

        walk(rootEl);
        const structured = normalizeText(parts.join(''));
        if (structured) return structured;
        return normalizeText(rootEl.innerText || rootEl.textContent);
      }

      function flatText(t) {
        return normalizeInlineText(t).replace(/\s+/g, ' ').trim();
      }

      function promptText(t) {
        return flatText(t).toLowerCase();
      }

      function promptFuzzyKey(value) {
        return promptText(value)
          .replace(/[`"'“”‘’«»]/g, '')
          .replace(/[?!.,:;…]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function boundedLevenshtein(a, b, maxDistance) {
        const left = String(a || '');
        const right = String(b || '');
        if (left === right) return 0;
        if (!left.length) return right.length;
        if (!right.length) return left.length;
        if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

        let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
        for (let i = 1; i <= left.length; i += 1) {
          const current = [i];
          let minInRow = current[0];
          for (let j = 1; j <= right.length; j += 1) {
            const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
            const value = Math.min(
              previous[j] + 1,
              current[j - 1] + 1,
              previous[j - 1] + substitutionCost
            );
            current.push(value);
            if (value < minInRow) minInRow = value;
          }
          if (minInRow > maxDistance) return maxDistance + 1;
          previous = current;
        }
        return previous[right.length];
      }

      function fuzzyPromptMatchScore(targetRaw, candidateRaw) {
        const target = promptFuzzyKey(targetRaw);
        const candidate = promptFuzzyKey(candidateRaw);
        if (!target || !candidate) return 0;
        if (target === candidate) return 500 + candidate.length;

        const maxLength = Math.max(target.length, candidate.length);
        if (maxLength < 4 || maxLength > 64) return 0;

        const maxDistance = maxLength <= 12 ? 2 : (maxLength <= 24 ? 3 : 4);
        const distance = boundedLevenshtein(target, candidate, maxDistance);
        if (distance > maxDistance) return 0;

        const similarity = 1 - (distance / maxLength);
        if (maxLength <= 16 && similarity >= 0.84) return 400 + Math.round(similarity * 100);
        if (maxLength <= 32 && similarity >= 0.9) return 350 + Math.round(similarity * 100);
        return 0;
      }

      function escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }

      function assistantHeaderPattern() {
        if (serviceId === 'gemini') return '(?:gemini said)';
        if (serviceId === 'grok') return '(?:grok said)';
        if (serviceId === 'chatgpt') return '(?:chatgpt said)';
        if (serviceId === 'claude') return '(?:claude said)';
        return '(?:assistant said|chatgpt said|claude said|gemini said|grok said)';
      }

      function extractEmbeddedPromptText(value) {
        const text = normalizeText(value);
        if (!text) return '';
        const assistantPattern = assistantHeaderPattern();
        const patterns = [
          new RegExp(
            '(?:^|\\n)(?:#{1,6}\\s*)?(?:you said|вы сказали)\\s*:?\\s*\\n?([\\s\\S]*?)(?:\\n(?:#{1,6}\\s*)?'
            + assistantPattern + '\\b[:\\s-]*)',
            'i'
          ),
          new RegExp(
            '^(?:#{1,6}\\s*)?(?:you said|вы сказали)\\s*:?\\s*([\\s\\S]*?)(?:\\n(?:#{1,6}\\s*)?'
            + assistantPattern + '\\b[:\\s-]*)',
            'i'
          )
        ];
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match?.[1]) {
            return normalizeText(match[1]);
          }
        }
        return '';
      }

      function promptComparableText(value) {
        return extractEmbeddedPromptText(value) || String(value || '');
      }

      function promptScoreForCurrentSource(value, allowFuzzy = true) {
        const target = promptText(sourcePrompt);
        const candidate = promptText(promptComparableText(value));
        if (!target || !candidate) return 0;
        if (candidate === target) return 1000 + candidate.length;
        if (candidate.includes(target)) return 800 + target.length;
        if (target.includes(candidate) && candidate.length >= Math.min(80, target.length)) return 600 + candidate.length;
        if (!allowFuzzy) return 0;
        return fuzzyPromptMatchScore(sourcePrompt, promptComparableText(value));
      }

      function promptMatchesCurrentSource(value) {
        const target = promptText(sourcePrompt);
        const candidate = promptText(promptComparableText(value));
        if (!target || !candidate) return false;
        if (candidate === target) return true;
        if (candidate.includes(target)) return true;
        if (target.includes(candidate) && candidate.length >= Math.min(80, target.length)) return true;
        return fuzzyPromptMatchScore(sourcePrompt, promptComparableText(value)) > 0;
      }

      function dropMetadataLine(line) {
        const value = String(line || '').trim().toLowerCase();
        if (!value) return false;
        return (
          value === 'source' ||
          value === 'share' ||
          value === 'edit' ||
          value === 'retry' ||
          value === 'copy' ||
          value === 'regenerate' ||
          value === 'open sidebar' ||
          value === 'reply...' ||
          value === 'temporary chat' ||
          value === 'incognito chat' ||
          value === 'tools' ||
          value === 'fast' ||
          value === 'open' ||
          value.startsWith('model:') ||
          value.includes('window.__') ||
          value.includes('can make mistakes') ||
          value.includes('please double-check responses') ||
          value.includes('check important info') ||
          value.includes('see cookie preferences') ||
          value === 'opens in a new window' ||
          /^www\.[^\s]+$/.test(value) ||
          /^\d[\d,.]*\s*(?:s|sec|secs|second|seconds)$/.test(value) ||
          /^\d+(?:[.,]\d+)?\s*s\s+fast\b.*$/.test(value) ||
          /^\d+\s+sources?$/.test(value)
        );
      }

      function stripPromptEchoWrapper(raw) {
        // Detect and remove combined prompt+response wrapper.
        // Structure: ⸻ (U+2E3B) → prompt text → (⸻) → actual response
        const trimmed = String(raw || '').trim();
        if (!trimmed) return raw;

        // Only trigger on ⸻ (Gemini/ChatGPT combined container)
        if (!/^\u2E3B/.test(trimmed)) return raw;

        // Split on ⸻ characters
        const parts = trimmed.split('\u2E3B').map(s => s.trim()).filter(Boolean);
        if (parts.length < 2) return raw;

        // Last part may contain prompt section headers + actual response
        const lastPart = parts[parts.length - 1];
        const lines = lastPart.split('\n');

        if (!sourcePrompt || sourcePrompt.length < 30) {
          // No prompt to compare against — can't safely strip
          // Return empty so quality check fails and fallback kicks in
          return '';
        }

        const promptFlat = flatText(sourcePrompt).toLowerCase();
        let responseStartIdx = -1;

        for (let i = 0; i < lines.length; i++) {
          const line = normalizeInlineText(lines[i] || '').trim();
          if (!line || line.length < 10) continue;
          const lineFlat = line.toLowerCase();

          // Skip lines that look like prompt content
          if (promptFlat.length >= 40) {
            // Check if this line is contained in the prompt
            const maxLineLen = Math.min(lineFlat.length, 150);
            const lineSnippet = lineFlat.slice(0, maxLineLen);
            if (promptFlat.includes(lineSnippet) && lineFlat.length < 200) continue;
          }

          // Skip prompt section headers
          if (/^(что я хочу|вопрос|хочу получить|схема,|проблема|хочу построить|как вообще|вопрос\s*$)/i.test(line)) continue;
          if (/^\s*[•\-\*]\s*(codex|qwen|claude|openclaw|opencode)\s/i.test(line)) continue;

          // Found a line that doesn't match prompt — this is the response
          responseStartIdx = i;
          break;
        }

        if (responseStartIdx >= 0) {
          const response = normalizeText(lines.slice(responseStartIdx).join('\n'));
          if (response.length > 60) return response;
        }

        // No response found — entire text was prompt. Return empty so
        // quality check fails and the collector falls back to copy extraction.
        return '';
      }

      function hasPromptEchoShape(text) {
        const normalized = normalizeText(text);
        if (!normalized || normalized.length < 80) return false;
        if (!/^\u2E3B/.test(normalized)) return false;
        return /(у меня сейчас такой сетап|но сейчас есть несколько проблем|что я хочу получить|схема, которую я пытаюсь построить|вопрос)/i.test(normalized);
      }

      function sanitizeScrapedReply(raw) {
        let text = normalizeText(raw);
        if (!text) return '';
        const isIOSWebKit = /iphone|ipad|ipod/i.test(navigator.userAgent || '');

        // Strip prompt-echo wrapper BEFORE any other cleanup.
        // The ⸻ wrapper appears for Gemini and ChatGPT when the DOM picks the
        // combined prompt+response container. Only trigger when text actually starts
        // with the ⸻ divider (U+2E3B).
        if (/^\u2E3B/.test(text)) {
          text = normalizeText(stripPromptEchoWrapper(text));
        }

        const prompt = normalizeInlineText(sourcePrompt);
        const escapedPrompt = prompt ? escapeRegex(prompt) : '';
        if (escapedPrompt) {
          text = text.replace(new RegExp('^\\s*' + escapedPrompt + '[\\s:"\'\\-]*\\n?', 'i'), '').trim();
          text = text.replace(new RegExp('^(?:#{1,6}\\s*)?you said\\s*:?\\s*' + escapedPrompt + '[\\s:"\'\\-]*\\n?', 'i'), '').trim();
          text = text.replace(new RegExp('^you said\\s+' + escapedPrompt + '[\\s:"\'\\-]*', 'i'), '').trim();
        }

        text = text.replace(/^(?:#{1,6}\s*)?you said\s*:?\s*\n?/i, '').trim();

        if (serviceId === 'gemini') {
          text = text.replace(/^conversation with gemini\s*/i, '');
          text = text.replace(/\byou said\b[\s\S]*?\bgemini said\b[:\s-]*/i, '');
          text = text.replace(/^(?:#{1,6}\s*)?gemini said\b[:\s-]*/im, '');
          text = text.replace(/^(?:you said|вы сказали)\s*$/im, '');
          text = text.replace(/^(?:gemini said)\s*$/im, '');
          text = text.replace(/opens in a new window[^\n]*/ig, '');
          text = text.trim();
        }

        if (serviceId === 'grok' && escapedPrompt) {
          text = text.replace(new RegExp('^\\s*' + escapedPrompt + '\\s*\\n?', 'i'), '').trim();
          text = text.replace(/\n\d[\d,.]*\s*(?:s|sec|secs|second|seconds)?\s*$/im, '');
          text = text.replace(/\n(?:thinking|reasoning)\s*$/im, '');
          text = text.trim();
        }

        text = text.replace(/\s+\d+(?:[.,]\d+)?\s*s\s+fast\b[\s\S]*$/i, '').trim();

        if (sourcePrompt) {
          const lines = text.split('\n');
          while (lines.length > 0 && !String(lines[0] || '').trim()) lines.shift();
          const firstLine = normalizeInlineText(lines[0] || '');
          const secondLine = normalizeInlineText(lines[1] || '');
          const firstTwo = normalizeInlineText([lines[0], lines[1]].filter(Boolean).join(' '));
          const secondIsPunctuation = /^[?!.,:;…-]+$/.test(secondLine);

          if (promptMatchesCurrentSource(firstTwo)) {
            lines.splice(0, secondIsPunctuation ? 2 : 1);
          } else if (promptMatchesCurrentSource(firstLine)) {
            lines.splice(0, secondIsPunctuation ? 2 : 1);
          }
          while (lines.length > 0 && !String(lines[0] || '').trim()) lines.shift();
          text = normalizeText(lines.join('\n'));
        }

        if (isIOSWebKit && ['claude', 'gemini', 'grok'].includes(serviceId) && sourcePrompt) {
          const promptFlat = flatText(sourcePrompt).toLowerCase();
          const rawLines = text.split('\n');
          let removedChars = 0;

          function lineLooksLikePromptEcho(value) {
            const normalized = normalizeInlineText(value).toLowerCase();
            if (!normalized || normalized.length < 12) return false;
            if (normalized === '---' || normalized === '⸻') return true;
            if (normalized.startsWith('#### you said')) return true;
            if (normalized.startsWith('you said')) return true;
            if (normalized.startsWith('вы сказали')) return true;
            return promptFlat.includes(normalized);
          }

          while (rawLines.length > 0) {
            const line = String(rawLines[0] || '');
            if (!lineLooksLikePromptEcho(line)) break;
            removedChars += line.length;
            rawLines.shift();
          }

          if (removedChars >= 80) {
            text = normalizeText(rawLines.join('\n'));
          }
        }

        const lines = text.split('\n');
        const cleaned = [];
        let pendingBlank = false;
        for (const rawLine of lines) {
          const line = String(rawLine || '').replace(/\t/g, '  ').replace(/[ \t]+$/g, '');
          const compact = line.replace(/[ \t]+/g, ' ').trim();
          if (dropMetadataLine(compact)) continue;
          if (!compact) {
            if (cleaned.length > 0) pendingBlank = true;
            continue;
          }
          if (pendingBlank) {
            cleaned.push('');
            pendingBlank = false;
          }
          cleaned.push(line);
        }

        text = normalizeText(cleaned.join('\n'));
        return text;
      }

      function isQualityReply(text) {
        const normalized = normalizeText(text);
        if (!normalized || flatText(normalized).length < 20) return false;
        if (hasPromptEchoShape(normalized)) return false;

        const flat = flatText(normalized).toLowerCase();
        if (flat.length < 180 && /\b(glasp|searched the web|fetching from)\b/i.test(flat)) return false;
        const promptFlat = flatText(sourcePrompt).toLowerCase();
        if (promptFlat) {
          if (flat === promptFlat) return false;
          if (flat.length < promptFlat.length * 1.5 && flat.includes(promptFlat)) return false;
          if (flat.length >= 120 && promptFlat.includes(flat)) return false;
          const head = flat.slice(0, Math.min(flat.length, 240));
          if (head.length >= 120 && promptFlat.startsWith(head)) return false;

          // Reject if text starts with prompt content (surviving sanitization)
          // Check first ~200 chars of text against start of prompt
          const textStart = flat.slice(0, Math.min(flat.length, 200));
          const promptStart = promptFlat.slice(0, Math.min(promptFlat.length, 200));
          if (textStart.length >= 80 && promptStart.includes(textStart)) return false;
          if (textStart.length >= 80 && textStart.includes(promptStart)) return false;

          // Fuzzy check: does the text start with the prompt's first few words?
          const promptWords = promptFlat.split(/\s+/).slice(0, 12).join(' ');
          const textWords = flat.split(/\s+/).slice(0, 12).join(' ');
          if (promptWords.length >= 40 && textWords === promptWords) return false;
        }

        // Fragment-only detection: reject single table/list/code that's too short
        const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
        const tableLines = lines.filter((l) => /^\|.*\|$/.test(l.trim()));
        const listLines = lines.filter((l) => /^\s*[-*+]\s+\S/.test(l.trim()) || /^\s*\d+[.)]\s+\S/.test(l.trim()));
        const codeFences = normalized.match(/^```/gm) || [];
        const flatLength = flat.length;

        const isSingleTable = tableLines.length >= 2 && lines.length <= tableLines.length + 1 && flatLength < 1200;
        const isSingleList = listLines.length > 0 && lines.length <= listLines.length + 1 && flatLength < 1200;
        const isSingleCode = codeFences.length >= 2 && lines.length <= 4 && flatLength < 1200;
        const isShortCsvFragment = serviceId === 'grok'
          && flatLength < 1500
          && lines.length >= 2
          && lines.length <= 12
          && lines.every((line) => line.includes(','))
          && !lines.some((line) => /[.!?]$/.test(line.trim()));

        // Note: CSV-only (raw comma-separated) is NOT treated as fragment —
        // Grok legitimately sends comparison tables as CSV, and they ARE valid replies.

        if (isSingleTable || isSingleList || isSingleCode || isShortCsvFragment) return false;

        return true;
      }

      function isComposerElement(el) {
        if (!el) return false;
        return !!el.closest('textarea, [contenteditable="true"], [role="textbox"], [data-testid*="composer"]');
      }

      function isMetadataLikeText(text) {
        const t = (text || '').toLowerCase();
        if (!t) return true;
        return (
          t === 'share' ||
          t === 'edit' ||
          t === 'retry' ||
          t === 'copy' ||
          t === 'regenerate' ||
          t.startsWith('model:') ||
          t.includes('window.__') ||
          t.includes('can make mistakes') ||
          t.includes('please double-check') ||
          t.includes('check important info')
        );
      }

      function countMatches(text, regex) {
        const match = String(text || '').match(regex);
        return match ? match.length : 0;
      }

      function computeStructureMetrics(raw) {
        const text = String(raw || '');
        const lines = text.split('\n');
        return {
          headingCount: countMatches(text, /^#{1,6}\s+/gm),
          unorderedCount: countMatches(text, /^\s*[-*+]\s+\S/gm),
          orderedCount: countMatches(text, /^\s*\d+[.)]\s+\S/gm),
          tableLineCount: countMatches(text, /^\|.*\|$/gm),
          codeFenceCount: countMatches(text, /^```/gm),
          blankLineCount: countMatches(text, /^\s*$/gm),
          lineCount: lines.filter((line) => line.trim().length > 0).length
        };
      }

      function structureScore(metrics) {
        return (
          metrics.headingCount * 30 +
          metrics.unorderedCount * 12 +
          metrics.orderedCount * 12 +
          metrics.tableLineCount * 8 +
          metrics.codeFenceCount * 16 +
          metrics.blankLineCount * 2 +
          metrics.lineCount
        );
      }

      function isFragmentOnly(metrics, flatLength) {
        const hasSingleTable = metrics.tableLineCount >= 2 && metrics.lineCount <= metrics.tableLineCount + 1;
        const hasSingleList = (metrics.unorderedCount + metrics.orderedCount) > 0 && metrics.lineCount <= (metrics.unorderedCount + metrics.orderedCount) + 1;
        const hasSingleCode = metrics.codeFenceCount >= 2 && metrics.lineCount <= 4;
        return flatLength < 1200 && (hasSingleTable || hasSingleList || hasSingleCode);
      }

      function findPromptAnchor() {
        if (!promptText(sourcePrompt)) return null;
        const selectors = [
          '[data-message-author-role="user"]',
          '[data-testid*="user"]',
          '[data-testid*="prompt"]',
          '[data-testid*="query"]',
          '[class*="user-query"]',
          '[class*="query-text"]',
          '[class*="prompt"]',
          '[class*="user"]',
          'user-query',
          'query-entry',
          'message-content',
          'article',
          'div'
        ];
        const seen = new Set();
        let best = null;
        // Perf short-circuit: collect exact/includes matches first (cheap, no
        // Levenshtein). Only fall back to the O(n*m) fuzzy pass over remaining
        // elements when no exact match was found at all.
        const fuzzyCandidates = [];

        selectors.forEach((sel) => {
          try {
            document.querySelectorAll(sel).forEach((el) => {
              if (seen.has(el)) return;
              seen.add(el);
              if (!visible(el)) return;
              if (isComposerElement(el)) return;
              const raw = extractStructuredText(el);
              const score = promptScoreForCurrentSource(raw, false);
              if (!score) {
                fuzzyCandidates.push(el);
                return;
              }
              const rect = el.getBoundingClientRect();
              const metrics = computeStructureMetrics(raw);
              const candidate = { el, raw, flat: flatText(raw), score, top: rect.top, bottom: rect.bottom, metrics, structure: structureScore(metrics) };
              if (
                !best ||
                candidate.score > best.score ||
                (candidate.score === best.score && candidate.flat.length < best.flat.length) ||
                (candidate.score === best.score && candidate.flat.length === best.flat.length && candidate.bottom > best.bottom)
              ) {
                best = candidate;
              }
            });
          } catch (_) { }
        });

        if (best) return best;

        fuzzyCandidates.forEach((el) => {
          try {
            if (!visible(el)) return;
            if (isComposerElement(el)) return;
            const raw = extractStructuredText(el);
            const score = promptScoreForCurrentSource(raw, true);
            if (!score) return;
            const rect = el.getBoundingClientRect();
            const metrics = computeStructureMetrics(raw);
            const candidate = { el, raw, flat: flatText(raw), score, top: rect.top, bottom: rect.bottom, metrics, structure: structureScore(metrics) };
            if (
              !best ||
              candidate.score > best.score ||
              (candidate.score === best.score && candidate.flat.length < best.flat.length) ||
              (candidate.score === best.score && candidate.flat.length === best.flat.length && candidate.bottom > best.bottom)
            ) {
              best = candidate;
            }
          } catch (_) { }
        });

        return best;
      }

      function findChatGptReplyAfterPrompt() {
        const promptAnchor = findPromptAnchor();
        if (!promptAnchor) return null;
        const target = promptText(sourcePrompt);
        const selectors = [
          '[data-message-author-role="assistant"]',
          '[data-testid*="assistant"]',
          '[class*="assistant"]'
        ];
        const seen = new Set();
        const candidates = [];

        selectors.forEach((sel) => {
          try {
            document.querySelectorAll(sel).forEach((el) => {
              if (seen.has(el)) return;
              seen.add(el);
              if (!visible(el)) return;
              if (isComposerElement(el)) return;
              const relation = promptAnchor.el.compareDocumentPosition(el);
              if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) return;
              const raw = extractStructuredText(el);
              const flat = flatText(raw);
              const lower = promptText(raw);
              if (flat.length < 20) return;
              if (!lower || lower === target || lower.includes(target)) return;
              const rect = el.getBoundingClientRect();
              const metrics = computeStructureMetrics(raw);
              candidates.push({ el, raw, flat, top: rect.top, bottom: rect.bottom, structure: structureScore(metrics) });
            });
          } catch (_) { }
        });

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => {
          if (a.top !== b.top) return a.top - b.top;
          if (b.structure !== a.structure) return b.structure - a.structure;
          return b.flat.length - a.flat.length;
        });
        return candidates[0];
      }

      function findPromptCandidateForReply(selectedEl) {
        if (!selectedEl) return null;
        const selectedRect = selectedEl.getBoundingClientRect ? selectedEl.getBoundingClientRect() : null;
        const selectors = [
          '[data-message-author-role="user"]',
          '[data-testid*="user"]',
          '[data-testid*="prompt"]',
          '[data-testid*="query"]',
          '[class*="user-query"]',
          '[class*="query-text"]',
          '[class*="prompt"]',
          '[class*="user"]',
          'user-query',
          'query-entry',
          'message-content',
          'article',
          'div'
        ];
        const seen = new Set();
        const candidates = [];

        selectors.forEach((sel) => {
          try {
            document.querySelectorAll(sel).forEach((el) => {
              if (seen.has(el)) return;
              seen.add(el);
              if (!visible(el)) return;
              if (isComposerElement(el)) return;
              if (el === selectedEl) return;
              const relation = el.compareDocumentPosition(selectedEl);
              if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) return;
              const raw = extractStructuredText(el);
              const flat = flatText(raw);
              if (flat.length < 6 || isMetadataLikeText(flat)) return;
              const rect = el.getBoundingClientRect();
              candidates.push({
                el,
                raw,
                flat,
                top: rect.top,
                bottom: rect.bottom,
                score: sourcePrompt ? promptScoreForCurrentSource(raw) : 0,
                distance: selectedRect ? Math.abs((selectedRect.top || 0) - rect.bottom) : Number.POSITIVE_INFINITY
              });
            });
          } catch (_) { }
        });

        if (candidates.length === 0) return null;
        if (sourcePrompt) {
          const matched = candidates.filter((candidate) => candidate.score > 0);
          if (matched.length > 0) {
            matched.sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              if (a.distance !== b.distance) return a.distance - b.distance;
              if (b.bottom !== a.bottom) return b.bottom - a.bottom;
              if (b.top !== a.top) return b.top - a.top;
              return b.flat.length - a.flat.length;
            });
            return matched[0];
          }
        }
        const nearestDistance = candidates.reduce((best, candidate) => Math.min(best, candidate.distance), Number.POSITIVE_INFINITY);
        const nearby = Number.isFinite(nearestDistance)
          ? candidates.filter((candidate) => candidate.distance <= nearestDistance + 240)
          : candidates;
        const latestBottom = nearby.reduce((best, candidate) => Math.max(best, candidate.bottom), Number.NEGATIVE_INFINITY);
        const recent = nearby.filter((candidate) => candidate.bottom >= latestBottom - 320);
        const pool = recent.length > 0 ? recent : nearby;
        pool.sort((a, b) => {
          if (a.distance !== b.distance) return a.distance - b.distance;
          if (b.bottom !== a.bottom) return b.bottom - a.bottom;
          if (b.top !== a.top) return b.top - a.top;
          return b.flat.length - a.flat.length;
        });
        return pool[0];
      }

      function summarizePromptCandidate(candidate) {
        if (!candidate || !candidate.raw) return null;
        return {
          text: candidate.raw,
          top: Math.round(candidate.top || 0),
          bottom: Math.round(candidate.bottom || 0),
          html_length: (candidate.el?.outerHTML || '').length
        };
      }

      function summarizeReplyPreview(candidate) {
        if (!candidate || !candidate.raw) return '';
        return sanitizeScrapedReply(candidate.raw).slice(0, 260) || normalizeText(candidate.raw).slice(0, 260);
      }

      function summarizeCandidateDecision(entry, result, index) {
        const candidate = entry?.candidate || entry;
        const meta = entry?.meta || {};
        const embeddedPrompt = extractEmbeddedPromptText(candidate?.raw || '');
        const promptCandidate = result?.prompt_candidate || null;
        const promptCandidateText = promptCandidate && typeof promptCandidate.text === 'string'
          ? normalizeText(promptCandidate.text).slice(0, 160)
          : '';
        return {
          index: index + 1,
          success: !!result?.success,
          error: String(result?.error || ''),
          preview: summarizeReplyPreview(candidate),
          top: Math.round(candidate?.top || 0),
          bottom: Math.round(candidate?.bottom || 0),
          structure: candidate?.structure || 0,
          flat_length: String(candidate?.flat || '').length,
          embedded_prompt: embeddedPrompt ? normalizeText(embeddedPrompt).slice(0, 160) : '',
          embedded_prompt_score: promptScoreForCurrentSource(candidate?.raw || ''),
          prompt_candidate: promptCandidateText,
          contains_peer: !!meta.containsPeer,
          fragment_only: !!meta.fragmentOnly,
          richer_parent: !!meta.richerParent,
          richer_child: !!meta.hasRicherChild
        };
      }

      function attachCandidateTrace(result, traces) {
        if (!result || !Array.isArray(traces) || traces.length === 0) return result;
        return Object.assign({}, result, {
          candidate_trace: traces.slice(0, 6)
        });
      }

      function buildResult(candidate, requirePromptMatch) {
        const isIOSWebKit = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
        const debug = {
          raw_preview: (candidate?.raw || '').slice(0, 80),
          raw_len: (candidate?.raw || '').length,
          raw_starts_dash: /^\u2E3B/.test((candidate?.raw || '').trim())
        };
        const embeddedPrompt = extractEmbeddedPromptText(candidate?.raw || '');
        const promptCandidate = embeddedPrompt
          ? {
            el: candidate?.el,
            raw: embeddedPrompt,
            top: candidate?.top || 0,
            bottom: candidate?.bottom || 0
          }
          : findPromptCandidateForReply(candidate?.el);
        // ingest-parity: STRIP_PROMPT_REPLY_WRAPPER (sister rule: reply freshness)
        // If we DID extract a prompt candidate and it does not match the current
        // source prompt, the selected reply is stale -- reject regardless of
        // platform. The previous WebKit-wide bypass let chatgpt/gemini on iOS
        // ingest assistant blocks from earlier questions in the same chat
        // (observed in S180: first Collect Now grabbed the prior answer because
        // the new one was still generating). The bypass below now only applies
        // to the "no candidate extracted at all" case, which is the original
        // Angular custom-element issue on Safari/WebKit.
        const allowWebKitMissingCandidate = isIOSWebKit && ['chatgpt', 'gemini'].includes(serviceId);
        if (sourcePrompt && promptCandidate?.raw && !promptMatchesCurrentSource(promptCandidate.raw)) {
          return {
            success: false,
            error: 'Selected reply belongs to a previous prompt',
            document_title: document.title || '',
            prompt_candidate: summarizePromptCandidate(promptCandidate),
            selected_reply_preview: summarizeReplyPreview(candidate),
            debug_trace: debug
          };
        }
        // Gemini removed from this list: conversation URL already scopes context (URL contains conversation ID).
        // Requiring a DOM prompt candidate fails on Safari/WebKit where Angular custom elements (user-query)
        // are not always accessible the same way as in Chromium.
        // ChatGPT/Gemini on iPhone/WebKit can expose a stale "You said" block as the nearest user node
        // even when the selected reply is current, so do not hard-require DOM prompt scope there.
        const requireScopedPromptCandidate = requirePromptMatch || (sourcePrompt && ['chatgpt', 'grok'].includes(serviceId) && !allowWebKitMissingCandidate);
        if (sourcePrompt && requireScopedPromptCandidate && !promptCandidate) {
          return {
            success: false,
            error: 'No prompt candidate found for selected reply',
            document_title: document.title || '',
            selected_reply_preview: summarizeReplyPreview(candidate),
            debug_trace: debug
          };
        }
        const cleanedText = sanitizeScrapedReply(candidate?.raw || '');
        debug.after_sanitize_len = cleanedText.length;
        debug.after_sanitize_preview = cleanedText.slice(0, 80);
        if (!cleanedText || flatText(cleanedText).length < 20 || isMetadataLikeText(cleanedText)) {
          return {
            success: false,
            error: 'Sanitized reply is empty',
            document_title: document.title || '',
            prompt_candidate: summarizePromptCandidate(promptCandidate),
            selected_reply_preview: summarizeReplyPreview(candidate),
            debug_trace: debug
          };
        }
        if (!isQualityReply(cleanedText)) {
          return {
            success: false,
            error: 'Sanitized reply echoes prompt',
            document_title: document.title || '',
            prompt_candidate: summarizePromptCandidate(promptCandidate),
            selected_reply_preview: summarizeReplyPreview(candidate)
          };
        }
        return {
          success: true,
          text: cleanedText,
          document_title: document.title || '',
          prompt_candidate: summarizePromptCandidate(promptCandidate)
        };
      }

      function buildSuccess(candidate, requirePromptMatch) {
        return JSON.stringify(buildResult(candidate, requirePromptMatch));
      }

      function buildOverrideResult(rawReply) {
        const debugTrace = {
          raw_override_preview: (rawReply || '').slice(0, 120),
          raw_override_len: (rawReply || '').length,
          raw_starts_dash: /^\u2E3B/.test((rawReply || '').trim()),
          source_prompt_preview: (sourcePrompt || '').slice(0, 80),
        };
        const cleanedText = sanitizeScrapedReply(rawReply);
        debugTrace.after_sanitize_len = cleanedText.length;
        debugTrace.after_sanitize_preview = cleanedText.slice(0, 120);
        if (!cleanedText || flatText(cleanedText).length < 20 || isMetadataLikeText(cleanedText)) {
          return JSON.stringify({
            success: false,
            error: 'Sanitized reply is empty',
            document_title: document.title || '',
            selected_reply_preview: normalizeText(rawReply).slice(0, 260),
            debug_trace: debugTrace
          });
        }
        debugTrace.quality_result = isQualityReply(cleanedText);
        if (!isQualityReply(cleanedText)) {
          return JSON.stringify({
            success: false,
            error: 'Sanitized reply echoes prompt',
            document_title: document.title || '',
            selected_reply_preview: normalizeText(rawReply).slice(0, 260),
            debug_trace: debugTrace
          });
        }
        debugTrace.final_len = cleanedText.length;
        debugTrace.final_preview = cleanedText.slice(0, 120);
        return JSON.stringify({
          success: true,
          text: cleanedText,
          document_title: document.title || '',
          prompt_candidate: null,
          debug_trace: debugTrace
        });
      }

      function chooseSuccessfulCandidate(candidates, requirePromptMatch) {
        const pool = Array.isArray(candidates) ? candidates : [];
        let fallbackFailure = null;
        const traces = [];
        for (let index = 0; index < pool.length; index += 1) {
          const entry = pool[index];
          const candidate = entry?.candidate || entry;
          const result = buildResult(candidate, requirePromptMatch);
          traces.push(summarizeCandidateDecision(entry, result, index));
          if (result?.success) return attachCandidateTrace(result, traces);
          if (!fallbackFailure) fallbackFailure = result;
        }
        return attachCandidateTrace(fallbackFailure || {
          success: false,
          error: 'No valid reply candidate found',
          document_title: document.title || ''
        }, traces);
      }

      function findReplyAfterPromptFromCandidates(candidates, promptAnchor) {
        if (!promptAnchor || !promptAnchor.el) return null;
        const following = candidates.filter((candidate) => {
          const relation = promptAnchor.el.compareDocumentPosition(candidate.el);
          return !!(relation & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        if (following.length === 0) return null;
        const firstTop = following.reduce((acc, candidate) => Math.min(acc, candidate.top), Infinity);
        const scoped = following.filter((candidate) => candidate.top <= firstTop + 360);
        const pool = scoped.length > 0 ? scoped : following;
        pool.sort((a, b) => {
          if (a.top !== b.top) return a.top - b.top;
          if (b.structure !== a.structure) return b.structure - a.structure;
          if (b.flat.length !== a.flat.length) return b.flat.length - a.flat.length;
          return b.bottom - a.bottom;
        });
        return pool[0];
      }

      const selectors = [
        '[data-testid*="conversation-turn"]',
        '[data-testid*="message-content"]',
        '[data-message-author-role="assistant"]',
        '[data-testid*="assistant"]',
        '[class*="assistant"]',
        '[class*="response"]',
        '[class*="answer"]',
        '[class*="message"]',
        'article'
      ];
      if (serviceId === 'perplexity') selectors.unshift('div[class*="prose"]');
      if (serviceId === 'claude') selectors.unshift('article', '[class*="prose"]');
      if (serviceId === 'gemini') selectors.unshift('model-response', 'response-container');
      if (serviceId === 'grok') selectors.unshift('div[id^="response-"]', '[class*="message-bubble"]');

      const candidates = [];
      if (rawReplyOverride.trim()) {
        return buildOverrideResult(rawReplyOverride);
      }
      selectors.forEach((sel) => {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            if (!visible(el)) return;
            if (isComposerElement(el)) return;
            const raw = extractStructuredText(el);
            const flat = flatText(raw);
            if (flat.length < 20 || isMetadataLikeText(flat)) return;
            const rect = el.getBoundingClientRect();
            const metrics = computeStructureMetrics(raw);
            candidates.push({ el, raw, flat, bottom: rect.bottom, top: rect.top, metrics, structure: structureScore(metrics) });
          });
        } catch (_) { }
      });

      if (candidates.length === 0) {
        Array.from(document.querySelectorAll('article, div')).filter(visible).forEach((el) => {
          if (isComposerElement(el)) return;
          const raw = extractStructuredText(el);
          const flat = flatText(raw);
          if (flat.length < 20 || isMetadataLikeText(flat)) return;
          const rect = el.getBoundingClientRect();
          const metrics = computeStructureMetrics(raw);
          candidates.push({ el, raw, flat, bottom: rect.bottom, top: rect.top, metrics, structure: structureScore(metrics) });
        });
      }

      if (candidates.length === 0) {
        return JSON.stringify({ success: false, error: 'No reply found', document_title: document.title || '' });
      }

      if (serviceId === 'chatgpt') {
        const exactReply = findChatGptReplyAfterPrompt();
        if (exactReply) {
          return buildSuccess(exactReply, true);
        }
      }

      const pruned = candidates.filter((candidate) => {
        return !candidates.some((other) => {
          if (other === candidate) return false;
          if (!other.el.contains(candidate.el)) return false;
          if (other.flat.length < 120) return false;
          if (candidate.flat.length >= other.flat.length * 0.8) return false;
          return Math.abs(other.bottom - candidate.bottom) <= 180;
        });
      });

      const source = pruned.length > 0 ? pruned : candidates;
      const promptAnchor = sourcePrompt ? findPromptAnchor() : null;
      if (promptAnchor) {
        const promptReply = findReplyAfterPromptFromCandidates(source, promptAnchor);
        if (promptReply) {
          const directResult = chooseSuccessfulCandidate([promptReply], true);
          if (directResult?.success) {
            return JSON.stringify(directResult);
          }
        }
        const anchorEmbeddedPrompt = extractEmbeddedPromptText(promptAnchor.raw || '');
        if (anchorEmbeddedPrompt && promptMatchesCurrentSource(anchorEmbeddedPrompt)) {
          const anchorResult = chooseSuccessfulCandidate([promptAnchor], true);
          if (anchorResult?.success) {
            return JSON.stringify(anchorResult);
          }
        }
      }

      if (sourcePrompt) {
        const promptMatchedCandidates = source.filter((candidate) => {
          const embeddedPrompt = extractEmbeddedPromptText(candidate.raw);
          if (embeddedPrompt && promptMatchesCurrentSource(embeddedPrompt)) return true;
          const promptCandidate = findPromptCandidateForReply(candidate.el);
          return !!(promptCandidate?.raw && promptMatchesCurrentSource(promptCandidate.raw));
        });
        if (promptMatchedCandidates.length > 0) {
          promptMatchedCandidates.sort((a, b) => {
            if (b.structure !== a.structure) return b.structure - a.structure;
            if (b.flat.length !== a.flat.length) return b.flat.length - a.flat.length;
            if (b.bottom !== a.bottom) return b.bottom - a.bottom;
            return b.top - a.top;
          });
          return JSON.stringify(chooseSuccessfulCandidate(promptMatchedCandidates, true));
        }
      }

      const maxBottom = source.reduce((acc, c) => Math.max(acc, c.bottom), -Infinity);
      const nearBottom = source.filter((c) => c.bottom >= maxBottom - 260);
      const pool = nearBottom.length > 0 ? nearBottom : source;

      const isGeminiOrGrok = serviceId === 'gemini' || serviceId === 'grok';
      if (isGeminiOrGrok) {
        const wrapped = pool.map((candidate) => {
          const childPeers = pool.filter((other) => {
            if (other === candidate) return false;
            if (!candidate.el.contains(other.el)) return false;
            if (other.flat.length < 40) return false;
            return Math.abs(other.bottom - candidate.bottom) <= 260;
          });
          const containsPeer = childPeers.length > 0;
          const fragmentOnly = isFragmentOnly(candidate.metrics, candidate.flat.length);
          const hasRicherChild = childPeers.some((other) => other.structure >= candidate.structure + 20);
          const richerParent = pool.find((other) => {
            if (other === candidate) return false;
            if (!other.el.contains(candidate.el)) return false;
            if (other.flat.length < candidate.flat.length * 1.35) return false;
            return other.structure >= candidate.structure;
          });
          return { candidate, containsPeer, fragmentOnly, hasRicherChild, richerParent };
        });

        wrapped.sort((a, b) => {
          if (a.fragmentOnly !== b.fragmentOnly) return a.fragmentOnly ? 1 : -1;
          if (!!a.richerParent !== !!b.richerParent) return a.richerParent ? 1 : -1;
          if (a.hasRicherChild !== b.hasRicherChild) return a.hasRicherChild ? 1 : -1;
          if (b.candidate.structure !== a.candidate.structure) return b.candidate.structure - a.candidate.structure;
          if (b.candidate.flat.length !== a.candidate.flat.length) return b.candidate.flat.length - a.candidate.flat.length;
          if (b.candidate.bottom !== a.candidate.bottom) return b.candidate.bottom - a.candidate.bottom;
          if (b.candidate.top !== a.candidate.top) return b.candidate.top - a.candidate.top;
          if (a.containsPeer !== b.containsPeer) return a.containsPeer ? 1 : -1;
          return 0;
        });

        return JSON.stringify(chooseSuccessfulCandidate(wrapped, false));
      }

      if (serviceId === 'claude') {
        const claudePool = source
          .slice()
          .sort((a, b) => {
            if (b.bottom !== a.bottom) return b.bottom - a.bottom;
            if (b.structure !== a.structure) return b.structure - a.structure;
            if (b.flat.length !== a.flat.length) return b.flat.length - a.flat.length;
            return b.top - a.top;
          });
        return JSON.stringify(chooseSuccessfulCandidate(claudePool, false));
      }

      pool.sort((a, b) => {
        if (b.flat.length !== a.flat.length) return b.flat.length - a.flat.length;
        return b.bottom - a.bottom;
      });
      return JSON.stringify(chooseSuccessfulCandidate(pool, false));
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error?.message || String(error),
        document_title: document.title || ''
      });
    }
  }

  global.VeritySharedScrapeReply = {
    run,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
