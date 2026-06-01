// /api/session.js
//
// 作用：在服务器端用你的真 API key，向 OpenAI 换取一个"短期客户端密钥"
// (client secret)，再把这个短期密钥发给浏览器。
// 这样你的真 key 永远不会出现在前端代码里，不会泄漏。
//
// 这是整个项目唯一需要的后端，就干这一件事。

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "服务器没配置 OPENAI_API_KEY 环境变量" });
    return;
  }

  // Vercel 会自动解析 JSON body，这里兜底处理一下字符串情况
  const body =
    typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const targetLanguage = body.targetLanguage || "zh"; // 默认翻成中文

  try {
    const r = await fetch(
      "https://api.openai.com/v1/realtime/translations/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            model: "gpt-realtime-translate",
            audio: {
              input: {
                // 开启原文转写：这一行是"双语显示"的关键。
                // 不开的话只能拿到译文，拿不到原文。
                transcription: { model: "gpt-realtime-whisper" },
              },
              output: { language: targetLanguage },
            },
          },
        }),
      }
    );

    const data = await r.json();
    // data.value 就是要发给浏览器的短期密钥
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
};
