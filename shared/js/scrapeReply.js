(function registerScrapeReplyScript(global) {
  function run(payload) {
    try {
      const serviceId = String(payload?.serviceId || '');
      const sourcePrompt = String(payload?.sourcePrompt || '');

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
          .replace(/\s+/g, ' ')
          .trim();
      }

      function extractInlineText(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = (node.tagName || '').toUpperCase();
        if (tag === 'BR') return '\n';
        if (tag === 'CODE') return '`' + normalizeInlineText(node.textContent) + '`';
        if (tag === 'A') return normalizeInlineText(node.textContent || node.href || '');
        return Array.from(node.childNodes || []).map(extractInlineText).join('');
      }

      function extractStructuredText(rootEl) {
        if (!rootEl) return '';
        const parts = [];
        const blockTags = new Set([
          'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER',
          'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
          'PRE', 'BLOCKQUOTE', 'HR'
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
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
          if (!visible(el) && el !== rootEl) return;

          if (tag === 'BR') {
            parts.push('\n');
            return;
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

      function findPromptAnchor() {
        const target = promptText(sourcePrompt);
        if (!target) return null;
        const selectors = [
          '[data-message-author-role="user"]',
          '[data-testid*="user"]',
          '[class*="user"]',
          'article',
          'div'
        ];
        const seen = new Set();
        let best = null;

        function scorePrompt(raw) {
          const text = promptText(raw);
          if (!text) return 0;
          if (text === target) return 1000 + text.length;
          if (text.includes(target)) return 800 + target.length;
          if (target.includes(text) && text.length >= Math.min(80, target.length)) return 600 + text.length;
          return 0;
        }

        selectors.forEach((sel) => {
          try {
            document.querySelectorAll(sel).forEach((el) => {
              if (seen.has(el)) return;
              seen.add(el);
              if (!visible(el)) return;
              if (isComposerElement(el)) return;
              const raw = extractStructuredText(el);
              const score = scorePrompt(raw);
              if (!score) return;
              const rect = el.getBoundingClientRect();
              const candidate = { el, score, top: rect.top, bottom: rect.bottom };
              if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.bottom > best.bottom)) {
                best = candidate;
              }
            });
          } catch (_) {}
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
          } catch (_) {}
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
        const selectors = [
          '[data-message-author-role="user"]',
          '[data-testid*="user"]',
          '[class*="user"]',
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
              candidates.push({ el, raw, flat, top: rect.top, bottom: rect.bottom });
            });
          } catch (_) {}
        });

        if (candidates.length === 0) return null;
        const latestBottom = candidates.reduce((best, candidate) => Math.max(best, candidate.bottom), Number.NEGATIVE_INFINITY);
        const recent = candidates.filter((candidate) => candidate.bottom >= latestBottom - 320);
        const pool = recent.length > 0 ? recent : candidates;
        pool.sort((a, b) => {
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

      function buildSuccess(candidate) {
        const promptCandidate = findPromptCandidateForReply(candidate?.el);
        return JSON.stringify({
          success: true,
          text: candidate?.raw || '',
          document_title: document.title || '',
          prompt_candidate: summarizePromptCandidate(promptCandidate)
        });
      }

      const selectors = [
        '[data-testid*="conversation-turn"]',
        '[data-testid*="message-content"]',
        '[data-message-author-role="assistant"]',
        '[data-testid*="assistant"]',
        '[class*="assistant"]',
        '[class*="response"]',
        '[class*="answer"]',
        '[class*="message"]'
      ];
      if (serviceId === 'perplexity') selectors.unshift('div[class*="prose"]');
      if (serviceId === 'gemini') selectors.unshift('model-response', 'response-container');
      if (serviceId === 'grok') selectors.unshift('div[id^="response-"]', '[class*="message-bubble"]');

      const candidates = [];
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
        } catch (_) {}
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
          return buildSuccess(exactReply);
        }
        const promptAnchor = findPromptAnchor();
        if (promptAnchor) {
          const following = candidates.filter((candidate) => {
            const relation = promptAnchor.el.compareDocumentPosition(candidate.el);
            return !!(relation & Node.DOCUMENT_POSITION_FOLLOWING);
          });
          if (following.length > 0) {
            const firstTop = following.reduce((acc, c) => Math.min(acc, c.top), Infinity);
            const scoped = following.filter((candidate) => candidate.top <= firstTop + 320);
            const promptPool = scoped.length > 0 ? scoped : following;
            promptPool.sort((a, b) => {
              if (a.top !== b.top) return a.top - b.top;
              if (a.bottom !== b.bottom) return a.bottom - b.bottom;
              return b.flat.length - a.flat.length;
            });
            return buildSuccess(promptPool[0]);
          }
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

        return buildSuccess(wrapped[0].candidate);
      }

      pool.sort((a, b) => {
        if (b.flat.length !== a.flat.length) return b.flat.length - a.flat.length;
        return b.bottom - a.bottom;
      });
      return buildSuccess(pool[0]);
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
