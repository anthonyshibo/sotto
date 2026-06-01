# 同传字幕 · 网页 MVP

麦克风收音 → OpenAI 实时翻译 → 双语字幕。翻译时屏幕保持常亮，停止后恢复。

## 文件结构

```
realtime-translate/
├── index.html        前端（用户看到的全部界面）
├── api/
│   └── session.js    迷你后端：用你的 key 换取短期密钥（唯一的后端）
└── README.md         本文件
```

## 跑起来分四步（约一杯咖啡的时间）

### 1. 拿一个 OpenAI API key
到 platform.openai.com 创建一个 API key（形如 `sk-...`）。
账户里要有余额，验证阶段花不了几毛钱（翻译约 $0.034/分钟 + 原文转写 $0.017/分钟）。

### 2. 部署到 Vercel（免费、自动 HTTPS）
最省事的方式，二选一：

**A. 用命令行**
```bash
npm i -g vercel          # 装一次就行
cd realtime-translate
vercel                   # 跟着提示走，几下回车
vercel env add OPENAI_API_KEY   # 粘贴你的 key（选 Production + Preview）
vercel --prod            # 正式发布，拿到一个 https 网址
```

**B. 用网页**
把这个文件夹推到一个 GitHub 仓库 → 打开 vercel.com → New Project → 导入这个仓库 →
在 Settings → Environment Variables 里加一条 `OPENAI_API_KEY` = 你的 key → Deploy。

> ⚠️ key 只填到 Vercel 的环境变量里，**绝不要写进代码**。前端永远拿不到它。

### 3. 在 iPhone 上打开
用 Safari 打开 Vercel 给你的那个 `https://xxx.vercel.app` 网址：
1. 点中间的圆按钮，允许麦克风权限。
2. **用这台手机外放**播放一个英文视频（YouTube、播客都行）。
3. 麦克风听到声音 → 屏幕上就会滚动出现"英文原文 + 中文翻译"。

### 4. （可选）存成 App
Safari 里点分享 → 添加到主屏幕，就有了一个像 App 的图标，全屏打开。

## 两条必须知道的 iOS 注意事项

- **屏幕常亮需要 iOS 18.4 以上**。在"添加到主屏幕"的独立模式下，更早的系统有个
  系统级 bug 会让常亮失效（屏幕照样自己灭）。在 Safari 标签页里测一般没这问题，
  但存成 App 后请用 18.4+ 的机器。
- **必须外放，别戴耳机**。麦克风靠"听见手机扬声器的声音"工作，戴耳机就听不到了。

## 调试

打开桌面 Chrome 的开发者工具（或 Mac Safari 连 iPhone 调试），控制台里
`[oai] ...` 会打印收到的每一个事件。如果原文不显示、只有译文，多半是原文转写
那段没生效，对照 `api/session.js` 里的 `transcription` 配置检查一下。

## 这一版有意没做的事（验证够用，先别加）

- 没做多人、没做覆盖在别的 App 上的浮窗、没做锁屏后台。
- 译文语音默认静音（你要的是字幕）；底部有个开关想听可以打开。
- 切换目标语言后需要重新点一次开始（每个会话固定一个目标语言）。
