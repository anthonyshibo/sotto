'use strict';

// Sotto — 阿里云 DashScope 实时翻译代理服务器
// 职责：在服务器端持有 DASHSCOPE_API_KEY，代理浏览器与 DashScope 之间的 WebSocket 通信。
// 浏览器发来：JSON 配置消息 + 二进制 PCM 音频块
// 浏览器收到：简化后的 JSON 事件（src.update / src.done / dst.done / turn.done / error）

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const DASHSCOPE_URL =
  'wss://dashscope.aliyuncs.com/api-ws/v1/realtime' +
  '?model=qwen3-livetranslate-flash-realtime';

// ── 启动校验 ──────────────────────────────────────────────────────────────────
if (!DASHSCOPE_API_KEY) {
  console.error('❌  请先设置环境变量 DASHSCOPE_API_KEY');
  process.exit(1);
}

// ── HTTP 服务器（供 nginx / 健康检查使用） ────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404).end();
});

// ── WebSocket 服务器 ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (clientWs, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[+] 浏览器已连接  ${ip}`);

  let dashWs = null;
  let dashReady = false;
  const audioQueue = [];   // DashScope 未就绪时缓存音频块，最多 50 块（5s）

  // ── 向浏览器发消息 ──────────────────────────────────────────────────────────
  const toClient = (obj) => {
    if (clientWs.readyState === WebSocket.OPEN)
      clientWs.send(JSON.stringify(obj));
  };

  // ── 向 DashScope 发消息 ────────────────────────────────────────────────────
  const toDash = (obj) => {
    if (dashWs?.readyState === WebSocket.OPEN)
      dashWs.send(JSON.stringify(obj));
  };

  // ── 发送音频块到 DashScope ─────────────────────────────────────────────────
  const forwardAudio = (pcmBuffer) => {
    toDash({
      event_id: `ev_${Date.now()}`,
      type:     'input_audio_buffer.append',
      audio:    pcmBuffer.toString('base64'),
    });
  };

  // ── 打开 DashScope 连接并配置会话 ─────────────────────────────────────────
  const openDashScope = (cfg) => {
    dashWs = new WebSocket(DASHSCOPE_URL, {
      headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    });

    dashWs.on('open', () => {
      console.log('[DashScope] 已连接，发送配置…');

      // session.update：配置语种、只要文本输出、开启原文转写
      toDash({
        event_id: `ev_${Date.now()}`,
        type:     'session.update',
        session: {
          modalities:          ['text'],   // 只要字幕，不要合成语音
          input_audio_format:  'pcm',
          input_audio_transcription: {
            model:    'qwen3-asr-flash-realtime',  // 开启：同时返回原文
            language: cfg.sourceLang === 'auto' ? 'en' : cfg.sourceLang,
          },
          translation: {
            language: cfg.targetLang,
          },
        },
      });

      dashReady = true;

      // 把等待中的音频块全部发出
      audioQueue.splice(0).forEach(forwardAudio);

      // 通知浏览器可以开始说话了
      toClient({ type: 'ready' });
    });

    dashWs.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      const t = event.type;
      console.log('[DashScope ←]', t);

      switch (t) {
        // 原文：流式 interim（stash 字段会随着识别推进而更新）
        case 'conversation.item.input_audio_transcription.text':
          toClient({ type: 'src.update', text: event.stash || '' });
          break;

        // 原文：本句识别完成，最终版本
        case 'conversation.item.input_audio_transcription.completed':
          toClient({ type: 'src.done', text: event.transcript || '' });
          break;

        // 译文：text-only 模式下，本句翻译完成
        case 'response.text.done':
          toClient({ type: 'dst.done', text: event.text || '' });
          break;

        // 一轮响应结束
        case 'response.done':
          toClient({ type: 'turn.done' });
          break;

        // DashScope 报错
        case 'error':
          toClient({ type: 'error', message: event.error?.message || 'DashScope error' });
          break;

        // 其余事件不转发，仅打印供调试
        default:
          break;
      }
    });

    dashWs.on('error', (err) => {
      console.error('[DashScope] 错误:', err.message);
      toClient({ type: 'error', message: 'DashScope 连接错误: ' + err.message });
    });

    dashWs.on('close', (code) => {
      console.log('[DashScope] 断开，code:', code);
      dashReady = false;
    });
  };

  // ── 处理浏览器消息 ─────────────────────────────────────────────────────────
  clientWs.on('message', (data, isBinary) => {
    if (!isBinary) {
      // 文本：JSON 配置消息
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type === 'config') {
        const cfg = {
          targetLang: msg.targetLang || 'zh',
          sourceLang: msg.sourceLang || 'en',
        };
        console.log('[Config]', cfg);
        openDashScope(cfg);
      }
    } else {
      // 二进制：PCM 音频块（16kHz, 16-bit, mono）
      if (dashReady) {
        forwardAudio(data);
      } else if (dashWs) {
        // DashScope 正在连接，临时入队
        if (audioQueue.length < 50) audioQueue.push(data);
      }
      // 还没开始连（没收到 config），直接丢弃
    }
  });

  clientWs.on('close', () => {
    console.log('[-] 浏览器断开');
    dashWs?.close();
  });

  clientWs.on('error', (err) => {
    console.error('[Browser WS] 错误:', err.message);
  });
});

// ── 启动 ──────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`✅  Sotto 代理服务器已启动`);
  console.log(`   监听端口   : ${PORT}`);
  console.log(`   健康检查   : http://localhost:${PORT}/health`);
  console.log(`   WebSocket  : ws://localhost:${PORT}`);
});
