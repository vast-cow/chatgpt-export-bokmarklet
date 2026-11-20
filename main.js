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
        return '*[画像：エクスポート未対応]*';
      }

      if (/file|canvas|artifact/.test(part.content_type || '')) {
        return `*[添付ファイル：${
          part.name || part.filename || 'ファイル'
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
      fail('ChatGPT のページで実行してください。');
    }

    const match = location.pathname.match(
      /(?:^|\/)c\/([a-zA-Z0-9_-]{8,})(?:\/|$)/
    );

    const share = location.pathname.match(
      /(?:^|\/)share\/([a-zA-Z0-9_-]{8,})(?:\/|$)/
    );

    const type = match ? 'conversation' : share ? 'share' : null;

    log('ページ診断', {
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
        '会話IDをURLから取得できませんでした。' +
        '保存済みの会話（/c/...）を開いてください。'
      );
    }

    // セッション情報取得
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
      warn('session APIの取得に失敗', { name: e.name });
    }

    // 認証情報はログに出力しない
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

    // 会話API
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
          'HTTP 429：アクセス制限中のため再試行を停止しました。'
        );
      }
    }

    if (!responseData) {
      fail(
        `会話APIにアクセスできません（最終HTTP ${lastStatus}）。`
      );
    }

    // 会話ツリー解析
    const conv = responseData.conversation || responseData;
    const mapping = conv.mapping;

    if (!mapping || typeof mapping !== 'object') {
      log('レスポンス構造', {
        keys: Object.keys(conv).slice(0, 20)
      });

      fail('APIの応答に mapping がありません。');
    }

    log('会話データ', {
      mappingCount: Object.keys(mapping).length,
      hasCurrentNode: Boolean(conv.current_node),
      titleCharacters: (conv.title || '').length
    });

    // 現在の分岐を辿る
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

    // メッセージ抽出
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

    log('抽出結果', {
      chainMessages: chain.length,
      exportedMessages: turns.length,
      users: turns.filter(t => t.role === 'user').length,
      assistants: turns.filter(t => t.role === 'assistant').length
    });

    if (!turns.length) {
      fail(
        'APIからメッセージを取得できましたが、' +
        '本文を抽出できませんでした。'
      );
    }

    // Markdown生成
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

    // ダウンロード
    const filename = (
      title
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .slice(0, 100) || 'chatgpt'
    ) + '.md';

    const blob = new Blob(
      [markdown],
      { type: 'text/markdown;charset=utf-8' }
    );

    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = downloadUrl;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

    log('ダウンロード開始', {
      messages: turns.length,
      bytes: blob.size
    });

  } catch (e) {
    console.error(PREFIX, 'エラー:', e.message);

    alert(
      `${e.message}\n\n` +
      `Console の ${PREFIX} を確認してください。`
    );
  }
})();
