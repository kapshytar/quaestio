(function registerExtractLatestAssistantRawScript(global) {
  // Perf: throttle re-entrant calls. This script is re-injected fresh on every
  // native evaluateJavascript() call (no module-level state survives between
  // calls), so the throttle cache must live on `global` (window) instead.
  const THROTTLE_MS = 700;

  function run(payload) {
    const cache = (global.__verityExtractCache = global.__verityExtractCache || { lastResult: null, lastTs: 0, lastKey: '' });
    const key = JSON.stringify({
      serviceId: String(payload?.serviceId || ''),
      sourcePrompt: String(payload?.sourcePrompt || ''),
      compactDiagnostics: payload?.compactDiagnostics === true
    });
    const now = Date.now();
    if (cache.lastResult !== null && cache.lastKey === key && (now - cache.lastTs) < THROTTLE_MS) {
      return cache.lastResult;
    }
    const result = runUncached(payload);
    cache.lastResult = result;
    cache.lastTs = now;
    cache.lastKey = key;
    return result;
  }

  function runUncached(payload) {
    try {
      const serviceId = String(payload?.serviceId || '');
      const sourcePrompt = String(payload?.sourcePrompt || '');
      const compactDiagnostics = payload?.compactDiagnostics === true;
      const MAX_HTML_SNAPSHOT_CHARS = 1500000;
      const MAX_NODE_HTML_CHARS = 250000;

      // Debug: log sourcePrompt length for troubleshooting
      console.log(`[extractRaw] serviceId=${serviceId} sourcePromptLen=${sourcePrompt.length}`);

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

      function truncateHtml(value, limit) {
        const text = String(value || '');
        if (text.length <= limit) return text;
        return text.slice(0, limit) + '\n<!-- truncated -->';
      }

      function safeOuterHtml(el, limit = MAX_NODE_HTML_CHARS) {
        if (!el || typeof el.outerHTML !== 'string') return '';
        return truncateHtml(el.outerHTML, limit);
      }

      function normalizeMathText(value) {
        return String(value || '')
          .replace(/\\text\{([^}]*)\}/g, '$1')
          .replace(/\\circ/g, '°')
          .replace(/\\pm/g, '±')
          .replace(/\s+/g, ' ')
          .trim();
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
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
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
        if (tag === 'P') return Array.from(el.childNodes || []).map(extractInlineText).join('');
        return Array.from(el.childNodes || []).map(extractInlineText).join('');
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

      function extractStructuredText(rootEl) {
        if (!rootEl) return '';
        const parts = [];
        const blockTags = new Set([
          'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
          'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV',
          'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'UL'
        ]);

        function pushNewline() {
          const last = parts.length > 0 ? parts[parts.length - 1] : '';
          if (!String(last).endsWith('\n')) parts.push('\n');
        }

        function walk(node) {
          if (!node) return;
          if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.textContent || '');
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node;
          if (shouldSkipElement(el)) return;
          if (el !== rootEl && !visible(el)) return;

          const tag = (el.tagName || '').toUpperCase();
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
        return normalizeInlineText(t).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
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
          t.includes('window.__')
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

      function hasPromptEchoShape(candidateFlat) {
        const candidate = String(candidateFlat || '').trim().toLowerCase();
        if (candidate.length < 80) return false;
        if (/^[\u2E3B#\-\s]+/.test(candidate) && /(что я хочу получить|что я хочу|вопрос|схема, которую я пытаюсь построить|но сейчас есть несколько проблем|у меня сейчас такой сетап)/i.test(candidate)) {
          return true;
        }
        return false;
      }

      // Detect if a candidate's text starts with the user's prompt (prompt-echo wrapper)
      // This happens when the scraper picks a combined prompt+response container (e.g. Gemini)
      function containsPromptEcho(candidateFlat, sourcePromptText) {
        const candidate = String(candidateFlat || '');
        if (candidate.length < 80) return false;
        if (hasPromptEchoShape(candidate)) return true;
        if (!sourcePromptText || sourcePromptText.length < 30) return false;
        const source = sourcePromptText.toLowerCase().replace(/\s+/g, ' ').trim();
        const head = candidate.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, Math.min(candidate.length, 300));

        // Check if head starts with prompt content (with some tolerance for prefix like "⸻")
        // Strip common dividers from head first
        const strippedHead = head.replace(/^[\u2E3B_#\-\s]+/, '').trim();

        // Check: does the text start with the prompt's first words?
        const sourceFirstWords = source.split(/\s+/).slice(0, 10).join(' ');
        const headFirstWords = strippedHead.split(/\s+/).slice(0, 10).join(' ');
        if (sourceFirstWords.length >= 30 && headFirstWords === sourceFirstWords) return true;

        // Check: is the prompt's first 150 chars contained in head's first 200 chars?
        const sourcePrefix = source.slice(0, 150);
        const headPrefix = strippedHead.slice(0, 200);
        if (sourcePrefix.length >= 60 && headPrefix.includes(sourcePrefix)) return true;
        if (headPrefix.length >= 60 && sourcePrefix.includes(headPrefix)) return true;

        return false;
      }

      function summarizeCandidate(candidate, selectorHint = '', extra = {}) {
        return {
          selector_hint: selectorHint,
          tag: candidate.el?.tagName || '',
          class_name: candidate.el?.className || '',
          top: Math.round(candidate.top || 0),
          bottom: Math.round(candidate.bottom || 0),
          flat_length: candidate.flat.length,
          raw_length: candidate.raw.length,
          structure: candidate.structure,
          metrics: candidate.metrics,
          fragment_only: isFragmentOnly(candidate.metrics, candidate.flat.length),
          preview: candidate.flat.slice(0, 240),
          ...extra
        };
      }

      function findNearestPromptCandidate(selectedCandidate) {
        if (!selectedCandidate?.el) return null;
        const userSelectors = [
          '[data-message-author-role="user"]',
          '[data-testid*="user"]',
          '[class*="user"][class*="message"]',
          '[class*="query"]',
          '[class*="request"]',
          'user-query'
        ];

        const candidates = [];
        const seen = new Set();
        userSelectors.forEach((sel) => {
          try {
            document.querySelectorAll(sel).forEach((el) => {
              if (seen.has(el)) return;
              seen.add(el);
              if (!visible(el)) return;
              if (isComposerElement(el)) return;
              const relation = el.compareDocumentPosition(selectedCandidate.el);
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
                bottom: rect.bottom
              });
            });
          } catch (_) { }
        });

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
          const aDistance = Math.abs((selectedCandidate.top || 0) - a.bottom);
          const bDistance = Math.abs((selectedCandidate.top || 0) - b.bottom);
          if (aDistance !== bDistance) return aDistance - bDistance;
          if (b.bottom !== a.bottom) return b.bottom - a.bottom;
          return b.flat.length - a.flat.length;
        });

        return candidates[0];
      }

      const selectorEntries = [
        ['[data-testid*="conversation-turn"]', '[data-testid*="conversation-turn"]'],
        ['[data-testid*="message-content"]', '[data-testid*="message-content"]'],
        ['[data-message-author-role="assistant"]', '[data-message-author-role="assistant"]'],
        ['[data-testid*="assistant"]', '[data-testid*="assistant"]'],
        ['[class*="assistant"]', '[class*="assistant"]'],
        ['[class*="response"]', '[class*="response"]'],
        ['[class*="answer"]', '[class*="answer"]'],
        ['[class*="message"]', '[class*="message"]']
      ];

      if (serviceId === 'perplexity') selectorEntries.unshift(['div[class*="prose"]', 'div[class*="prose"]']);
      if (serviceId === 'gemini') selectorEntries.unshift(['response-container', 'response-container'], ['model-response', 'model-response']);
      if (serviceId === 'grok') selectorEntries.unshift(['[class*="message-bubble"]', '[class*="message-bubble"]'], ['div[id^="response-"]', 'div[id^="response-"]']);

      const candidates = [];
      selectorEntries.forEach(([sel, hint]) => {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            if (!visible(el)) return;
            if (isComposerElement(el)) return;
            const raw = extractStructuredText(el);
            const flat = flatText(raw);
            if (flat.length < 20 || isMetadataLikeText(flat)) return;
            const rect = el.getBoundingClientRect();
            const metrics = computeStructureMetrics(raw);
            candidates.push({
              el,
              raw,
              flat,
              bottom: rect.bottom,
              top: rect.top,
              metrics,
              structure: structureScore(metrics),
              selectorHint: hint
            });
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
          candidates.push({
            el,
            raw,
            flat,
            bottom: rect.bottom,
            top: rect.top,
            metrics,
            structure: structureScore(metrics),
            selectorHint: 'article,div:fallback'
          });
        });
      }

      if (candidates.length === 0) {
        const diagnostics = {
          service_id: serviceId,
          page_url: location.href,
          document_title: document.title || '',
          candidate_count: 0,
          pruned_count: 0,
          pool_count: 0,
          no_candidate_reason: 'no-candidates',
          candidates: [],
          selected: null,
          selected_html: '',
          parent_html: '',
          page_html: compactDiagnostics ? '' : truncateHtml(document.documentElement?.outerHTML || '', MAX_HTML_SNAPSHOT_CHARS)
        };
        return JSON.stringify({
          raw: null,
          diagnostics
        });
      }

      // Filter out candidates that are clearly prompt-echo wrappers.
      // These are combined containers (prompt + response) where the DOM picked
      // the outer wrapper instead of the response-only inner element.
      const promptEchoThreshold = 0.4;
      const cleanCandidates = candidates.filter((c) => {
        if (containsPromptEcho(c.flat, sourcePrompt)) return false;
        if (!(sourcePrompt && sourcePrompt.length >= 50)) return true;
        const promptFlat = sourcePrompt.toLowerCase().replace(/\s+/g, ' ').trim();
        const candidateHead = c.flat.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, Math.min(c.flat.length, 300));
        const strippedHead = candidateHead.replace(/^[\u2E3B_#\-\s]+/, '').trim();
        const promptPrefix = promptFlat.slice(0, Math.min(promptFlat.length, 200));
        if (promptPrefix.length < 40) return true;
        if (strippedHead.includes(promptPrefix)) return false;
        const promptWords = promptFlat.split(/\s+/).slice(0, 15).join(' ');
        const headWords = strippedHead.split(/\s+/).slice(0, 15).join(' ');
        if (promptWords.length >= 40 && headWords === promptWords) return false;
        return true;
      });

      const pruned = cleanCandidates.filter((candidate) => {
        return !cleanCandidates.some((other) => {
          if (other === candidate) return false;
          if (!other.el.contains(candidate.el)) return false;
          if (other.flat.length < 120) return false;
          if (candidate.flat.length >= other.flat.length * 0.8) return false;
          return Math.abs(other.bottom - candidate.bottom) <= 180;
        });
      });

      const source = pruned.length > 0 ? pruned : cleanCandidates;
      const maxBottom = source.reduce((acc, c) => Math.max(acc, c.bottom), -Infinity);
      const nearBottom = source.filter((c) => c.bottom >= maxBottom - 260);
      const pool = nearBottom.length > 0 ? nearBottom : source;

      // Debug: count how many prompt-echo candidates were filtered
      const echoCount = candidates.length - cleanCandidates.length;

      const ranked = pool.map((candidate) => {
        const childPeers = pool.filter((other) => {
          if (other === candidate) return false;
          if (!candidate.el.contains(other.el)) return false;
          if (other.flat.length < 40) return false;
          return Math.abs(other.bottom - candidate.bottom) <= 260;
        });
        const containsPeer = childPeers.length > 0;
        const fragmentOnly = isFragmentOnly(candidate.metrics, candidate.flat.length);
        const promptEcho = containsPromptEcho(candidate.flat, sourcePrompt);
        const hasRicherChild = childPeers.some((other) => other.structure >= candidate.structure + 20);
        const richerParent = pool.find((other) => {
          if (other === candidate) return false;
          if (!other.el.contains(candidate.el)) return false;
          if (other.flat.length < candidate.flat.length * 1.35) return false;
          return other.structure >= candidate.structure;
        });
        return { candidate, containsPeer, fragmentOnly, promptEcho, hasRicherChild, richerParent };
      });

      ranked.sort((a, b) => {
        if (a.fragmentOnly !== b.fragmentOnly) return a.fragmentOnly ? 1 : -1;
        if (a.promptEcho !== b.promptEcho) return a.promptEcho ? 1 : -1;
        if (!!a.richerParent !== !!b.richerParent) return a.richerParent ? 1 : -1;
        if (a.hasRicherChild !== b.hasRicherChild) return a.hasRicherChild ? 1 : -1;
        if (b.candidate.structure !== a.candidate.structure) return b.candidate.structure - a.candidate.structure;
        if (b.candidate.flat.length !== a.candidate.flat.length) return b.candidate.flat.length - a.candidate.flat.length;
        if (b.candidate.bottom !== a.candidate.bottom) return b.candidate.bottom - a.candidate.bottom;
        if (b.candidate.top !== a.candidate.top) return b.candidate.top - a.candidate.top;
        if (a.containsPeer !== b.containsPeer) return a.containsPeer ? 1 : -1;
        return 0;
      });

      const selectedWrapped = ranked[0];
      const selected = selectedWrapped.candidate;

      // Stay close to desktop behavior: prefer the richest non-echo, non-fragment
      // candidate before giving up and falling back to copy extraction.
      let finalWrapped = selectedWrapped;
      const nonEchoNonFragment = ranked.find((entry) => !entry.promptEcho && !entry.fragmentOnly);
      if ((selectedWrapped.promptEcho || selectedWrapped.fragmentOnly) && nonEchoNonFragment) {
        finalWrapped = nonEchoNonFragment;
      } else if (selectedWrapped.promptEcho) {
        const nonEcho = ranked.find((entry) => !entry.promptEcho);
        if (nonEcho) {
          finalWrapped = nonEcho;
        }
      } else if (selectedWrapped.fragmentOnly) {
        const nonFragment = ranked.find((entry) => !entry.fragmentOnly);
        if (nonFragment) {
          finalWrapped = nonFragment;
        }
      }

      const finalSelected = finalWrapped.candidate;

      const promptCandidate = findNearestPromptCandidate(finalSelected);
      const candidateDiagnostics = ranked.slice(0, 12).map((entry, index) =>
        summarizeCandidate(entry.candidate, entry.candidate.selectorHint, {
          rank: index + 1,
          contains_peer: entry.containsPeer,
          has_richer_child: entry.hasRicherChild,
          richer_parent: !!entry.richerParent
        })
      );

      return JSON.stringify({
        raw: finalSelected.raw,
        diagnostics: {
          service_id: serviceId,
          page_url: location.href,
          document_title: document.title || '',
          candidate_count: candidates.length,
          pruned_count: source.length,
          pool_count: pool.length,
          fallback_used: pruned.length === 0,
          selected: summarizeCandidate(finalSelected, finalSelected.selectorHint, {
            html_length: (finalSelected.el?.outerHTML || '').length,
            parent_html_length: (finalSelected.el?.parentElement?.outerHTML || '').length,
            prompt_echo: finalWrapped.promptEcho || false
          }),
          prompt_candidate: promptCandidate ? {
            text: promptCandidate.flat,
            top: Math.round(promptCandidate.top || 0),
            bottom: Math.round(promptCandidate.bottom || 0),
            html_length: (promptCandidate.el?.outerHTML || '').length
          } : null,
          candidates: compactDiagnostics ? candidateDiagnostics.slice(0, 4) : candidateDiagnostics,
          selected_html: compactDiagnostics ? '' : safeOuterHtml(finalSelected.el),
          parent_html: compactDiagnostics ? '' : safeOuterHtml(finalSelected.el?.parentElement),
          page_html: compactDiagnostics ? '' : truncateHtml(document.documentElement?.outerHTML || '', MAX_HTML_SNAPSHOT_CHARS)
        }
      });
    } catch (e) {
      return JSON.stringify({
        raw: null,
        diagnostics: {
          service_id: String(payload?.serviceId || ''),
          page_url: location.href,
          document_title: document.title || '',
          no_candidate_reason: e?.message || String(e || 'unknown-error'),
          candidates: [],
          selected: null,
          selected_html: '',
          parent_html: '',
          page_html: ''
        }
      });
    }
  }

  global.VeritySharedExtractLatestAssistantRaw = {
    run,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
