/**
 * ChatGPT Markdown Export Bookmarklet
 *
 * Based in part on:
 * ChatGPT Markdown Export
 * https://github.com/thekester/chatgpt-export
 *
 * Original author: Avenel Théophile
 * Original license: MIT
 * Copyright (c) 2026 Avenel Théophile
 *
 * Adapted for standalone bookmarklet usage.
 * Includes custom Markdown export and TOC generation.
 *
 * SPDX-License-Identifier: MIT
 * See LICENSE for the complete license text.
 */
(async () => {
  'use strict';

  const PREFIX = '[ChatGPT MD Export]';
  const log = (...args) => console.log(PREFIX, ...args);
  const warn = (...args) => console.warn(PREFIX, ...args);
  const fail = message => { throw new Error(message); };

  function reportError(error) {
    console.error(PREFIX, 'Error:', error.message);

    alert(
      `${error.message}\n\n` +
      `Check the console for ${PREFIX}.`
    );
  }

  function copyMarkdown(markdown, attempt) {
    const previousFocus = document.activeElement;
    let textarea = null;
    let stage = 'prepare-textarea';
    let copyState;

    const readCopyState = () => ({
      userActivation: navigator.userActivation?.isActive ?? null,
      documentHasFocus: document.hasFocus(),
      textareaHasFocus: textarea !== null && document.activeElement === textarea,
      hasSelection: textarea !== null && textarea.selectionEnd > textarea.selectionStart
    });

    try {
      textarea = document.createElement('textarea');
      textarea.value = markdown;
      textarea.readOnly = true;
      textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(textarea);

      stage = 'focus-textarea';
      textarea.focus({ preventScroll: true });

      stage = 'select-text';
      textarea.select();

      stage = 'exec-command';
      copyState = readCopyState();
      const copied = document.execCommand('copy');
      if (!copied) {
        warn('Clipboard copy failed', {
          attempt,
          reason: 'exec-command-returned-false',
          ...copyState
        });
      }
      return copied;
    } catch (error) {
      warn('Clipboard copy failed', {
        attempt,
        reason: 'exception',
        stage,
        errorName: error?.name ?? null,
        ...(copyState ?? readCopyState())
      });
      return false;
    } finally {
      textarea?.remove();
      previousFocus?.focus?.({ preventScroll: true });
    }
  }

  function showCopyRetry(onRetry) {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Markdown copy failed');
    dialog.style.cssText =
      'margin:auto;padding:1rem;border:1px solid CanvasText;background:Canvas;color:CanvasText';

    const message = document.createElement('p');
    message.textContent = 'If the retry fails, the Markdown will download as a file.';
    message.style.marginBottom = '0.75rem';

    const retry = document.createElement('button');
    retry.textContent = 'Retry Copy';
    retry.style.cssText = 'all:revert;margin-inline-end:0.5rem';
    retry.addEventListener('click', () => {
      if (!dialog.open) return;
      dialog.close();
      onRetry();
    });

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'all:revert';
    cancel.addEventListener('click', () => dialog.close());

    dialog.append(message, retry, cancel);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function extractMessage(message) {
    const c = message.content || {};

    if (c.content_type === 'code' && typeof c.text === 'string') {
      const fence = '`'.repeat(
        Math.max(
          3,
          ...[...c.text.matchAll(/`+/g)].map(m => m[0].length + 1)
        )
      );

      return `${fence}${c.language || ''}\n${c.text}\n${fence}`;
    }

    const parts = Array.isArray(c.parts) ? c.parts : [];

    const body = parts.map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';

      if (typeof part.text === 'string') return part.text;

      if (part.content_type === 'image_asset_pointer') {
        return '*[Image: export not supported]*';
      }

      if (/file|canvas|artifact/.test(part.content_type || '')) {
        return `*[Attachment: ${
          part.name || part.filename || 'file'
        }]*`;
      }

      return '';
    }).filter(Boolean).join('\n\n');

    return (body || (typeof c.text === 'string' ? c.text : ''))
      .replace(/\uE200entity\uE202(.*?)\uE201/g, (_, json) => {
        try {
          return String(JSON.parse(json)[1] ?? '');
        } catch {
          return '';
        }
      })
      .replace(/\uE200[^\uE201]*\uE201/g, '')
      .trim();
  }

  try {
    if (!['chatgpt.com', 'chat.openai.com'].includes(location.hostname)) {
      fail('Run this on a ChatGPT page.');
    }

    const match = location.pathname.match(
      /(?:^|\/)c\/([a-zA-Z0-9_-]{8,})(?:\/|$)/
    );

    const share = location.pathname.match(
      /(?:^|\/)share\/([a-zA-Z0-9_-]{8,})(?:\/|$)/
    );

    const type = match ? 'conversation' : share ? 'share' : null;

    log('Page diagnostics', {
      type: type || 'unknown',
      mainCount: document.querySelectorAll('main').length,
      articleCount: document.querySelectorAll('article').length,
      iframeCount: document.querySelectorAll('iframe').length,
      mainCharacters: (
        document.querySelector('main')?.innerText || ''
      ).length
    });

    if (!type) {
      fail(
        'Could not get a conversation ID from the URL. ' +
        'Open a saved conversation (/c/...).'
      );
    }

    // Get session information.
    let session = null;

    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'include',
        cache: 'no-store'
      });

      log('session API', { status: response.status });

      if (response.ok) {
        session = await response.json();
      }
    } catch (e) {
      warn('Failed to fetch session API', { name: e.name });
    }

    // Do not log authentication credentials.
    const token = session?.accessToken;
    const accountId =
      session?.account?.id ||
      session?.activeAccount?.id ||
      null;

    const variants = [];

    if (token && accountId) {
      variants.push({
        label: 'bearer+account',
        headers: {
          Authorization: `Bearer ${token}`,
          'ChatGPT-Account-ID': accountId
        }
      });
    }

    if (token) {
      variants.push({
        label: 'bearer',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    }

    variants.push({
      label: 'cookie',
      headers: {}
    });

    // Conversation API.
    const id = match ? match[1] : share[1];

    const endpoint = type === 'share'
      ? `/backend-api/share/${encodeURIComponent(id)}`
      : `/backend-api/conversation/${encodeURIComponent(id)}`;

    let responseData = null;
    let lastStatus = null;

    for (const variant of variants) {
      const response = await fetch(endpoint, {
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...variant.headers
        }
      });

      lastStatus = response.status;

      log('conversation API', {
        method: variant.label,
        status: response.status
      });

      if (response.ok) {
        responseData = await response.json();
        break;
      }

      if (response.status === 429) {
        fail(
          'HTTP 429: Access is rate-limited. Stopping retries.'
        );
      }
    }

    if (!responseData) {
      fail(
        `Could not access the conversation API (final HTTP ${lastStatus}).`
      );
    }

    // Parse the conversation tree.
    const conv = responseData.conversation || responseData;
    const mapping = conv.mapping;

    if (!mapping || typeof mapping !== 'object') {
      log('Response structure', {
        keys: Object.keys(conv).slice(0, 20)
      });

      fail('The API response does not contain a mapping.');
    }

    log('Conversation data', {
      mappingCount: Object.keys(mapping).length,
      hasCurrentNode: Boolean(conv.current_node),
      titleCharacters: (conv.title || '').length
    });

    // Follow the current branch.
    const chain = [];
    const visited = new Set();

    let current = conv.current_node;

    while (
      current &&
      mapping[current] &&
      !visited.has(current)
    ) {
      visited.add(current);

      if (mapping[current].message) {
        chain.push(mapping[current].message);
      }

      current = mapping[current].parent;
    }

    chain.reverse();

    // Extract messages.
    const turns = chain.flatMap(message => {
      const role = message.author?.role;

      if (role !== 'user' && role !== 'assistant') {
        return [];
      }

      if (message.metadata?.is_visually_hidden_from_conversation) {
        return [];
      }

      if (message.recipient && message.recipient !== 'all') {
        return [];
      }

      if (
        message.metadata?.channel === 'analysis' ||
        message.channel === 'analysis'
      ) {
        return [];
      }

      const body = extractMessage(message);

      return body ? [{ role, body }] : [];
    });

    log('Extraction results', {
      chainMessages: chain.length,
      exportedMessages: turns.length,
      users: turns.filter(t => t.role === 'user').length,
      assistants: turns.filter(t => t.role === 'assistant').length
    });

    if (!turns.length) {
      fail(
        'Messages were retrieved from the API, but their text could not be extracted.'
      );
    }

    // Generate Markdown.
    const title = conv.title || 'ChatGPT conversation';
    const source = `${location.origin}${location.pathname}`;

    const markdown = [
      `# ${title}`,
      '',
      `Source: ${source}`,
      '',
      ...turns.flatMap(turn => [
        turn.role === 'user' ? '## User' : '## ChatGPT',
        '',
        turn.body,
        ''
      ])
    ].join('\n').trimEnd() + '\n';

    const blob = new Blob(
      [markdown],
      { type: 'text/markdown;charset=utf-8' }
    );

    const download = () => {
      const filename = (
        title
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
          .slice(0, 100) || 'chatgpt'
      ) + '.md';
      const link = document.createElement('a');
      const downloadUrl = URL.createObjectURL(blob);

      try {
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
      }

      log('Download started', {
        messages: turns.length,
        bytes: blob.size
      });
    };

    // Blob.size measures the UTF-8 bytes of the exported text.
    if (blob.size > 512 * 1024) {
      download();
    } else if (!copyMarkdown(markdown, 'initial')) {
      showCopyRetry(() => {
        try {
          if (!copyMarkdown(markdown, 'retry')) download();
        } catch (error) {
          reportError(error);
        }
      });
    }

  } catch (error) {
    reportError(error);
  }
})();
