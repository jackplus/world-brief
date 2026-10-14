# 观澜 · 环球资讯看板

静态网页，早晚两次聚合环球财经、国际时事和 AI。手机、平板和电脑共用一个公开网址，不需要本地电脑开机。

访问：**https://jackplus.github.io/world-brief/** · [云端更新记录](https://github.com/jackplus/world-brief/actions/workflows/update.yml)

## 本地运行

需要 Node.js 22 或更新版本。

```sh
npm ci --ignore-scripts
npm test
npm run update
npm run dev
```

打开 http://127.0.0.1:4173 。不配置密钥也可以运行，展示原文标题和最多180字符的来源摘录。没有新闻的分类显示空状态，不使用旧闻凑数。数据更新失败时原有内容保留。

## GitHub Pages 部署

1. 将本项目作为独立公开仓库推送到 GitHub，默认分支为 `main`。
2. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
3. 在 **Settings → Secrets and variables → Actions** 添加 Secret `GEMINI_API_KEY`。请使用具有免费额度的 Gemini API 项目；不启用付费计费。不要把密钥写入代码、网页或提交记录。
4. 默认模型为 `gemini-3.8-flash`。如账号不支持，可通过仓库 Variable `GEMINI_MODEL` 改成账号可用的免费文本模型。模型、配额和地区可用性以 [Gemini 官方文档](https://ai.google.dev/gemini-api/docs/pricing) 为准。
5. 进入 **Actions → Update and publish brief → Run workflow**，运行一次。成功后即可访问 Pages 地址。

未配置密钥、免费额度耗尽或模型结果未通过校验时，自动降级为原文模式。付费 API 账号是否产生费用由账号计费设置决定；本程序不启用搜索增强、不会自动开通付费服务。

工作流每天 UTC 00:00、12:00（北京时间08:00、20:00）运行，也支持手动运行。GitHub 调度可能延迟，页面展示实际采集成功时间。公开仓库60天无活动时定时工作流可能被停用；正常更新会产生数据提交。[GitHub 调度说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 页面与更新行为

- 最近24小时每类最多8条；AI 模式按重要性排序并合并事件，无密钥时按时间选取并交错展示各类。
- 页面加载、切回前台以及停留期间每5分钟检查新版本。有新一期时显示按钮，读者点击后替换内容，以免自动替换打断阅读位置。
- 最近7个北京时间自然日各保留最新一期供网页回看，同一天晚版覆盖当天的早版入口；源仓库保留历史生成文件以便审计。
- 本期内容超过24小时会提示过期；网络请求失败保留已经读取的页面。
- 所有外链仅接受 HTTP/HTTPS，新闻文字使用 `textContent` 渲染；不会执行来源文本中的 HTML 或指令。

## 来源与内容限制

编辑 `sources.json` 后提交即可调整来源，每项包含 `id`、`name`、`category`（`finance` / `politics` / `ai`）、`url`、`homepage`、`enabled`、`policy`，可选 `titleOnly`。应先验证订阅源和展示许可再启用。

- **BBC 国际 / 财经**：非商业 RSS 阅读，保留显著署名及原始链接，仅使用订阅摘要，不抓取正文。[BBC 使用条款](https://www.bbc.co.uk/usingthebbc/terms-of-use/)
- **美联储**：官方公告 RSS；初次探测出现403，后续实际采集成功。不绕过访问限制，失败时在页面标明。
- **Hugging Face**：官方平台订阅包含社区文章，页面如实标明来源；默认仅使用标题和链接，不转载正文或摘要，AI 仅翻译标题。
- **中新网国际 / 财经**：已登记官方目录中的端点，默认关闭。2026-10-14 已逐一验证两个 XML 端点均返回 HTTP 200、有效 RSS 和30条内容；目录页声明摘编需授权，公开展示授权尚未取得，不因可以下载就启用摘要转载。

当前来源覆盖偏国际，中国新闻来源仍需补充已确认可公开展示的订阅源。AI 不自行检索或补全事实，只能使用提供的标题和摘录；争议性消息保留归属。自动校验可以限制来源和结构，但不能保证摘要事实准确，仍需抽查原文。

## 数据与验证

`public/data/index.json` 是读取入口，引用不可变的 `editions/*.json`，每份简报包括 `schemaVersion`、`generatedAt`、`coverageStart`、`coverageEnd`、`mode`、`notice`、`sourceStatus`、`items`。事件包含类别、标题、摘要、发布时间、模式和来源数组。先写简报再原子替换索引，校验失败不改索引。

`npm test` 覆盖时间窗口、时区、RSS/Atom、重复链接、模型限流/非法输出、标题模式、来源部分/全部失败和七日归档。`node scripts/stage.mjs` 将网页及索引引用的七天数据放入 `dist/`，不包括脚本或配置密钥。

发布后还需查看一次真正由 `schedule` 触发的工作流，确认自动调度；手动运行成功不代表定时触发已验收。GitHub Actions 默认发送失败通知，可在个人通知设置中调整。网站超过24小时无更新也会给出可见提示。

## 本次验收记录（2026-10-14）

- 15项 Node 数据与失败处理测试通过。
- Chrome 桌面1440px和手机390px验证通过：分类、历史切换、更新提示、不移动阅读位置、断网保留、过期/空状态、文字安全渲染。浏览器脚本为 `test/browser.py`，需要 Python Playwright 和本机 Chrome；截图保存在已忽略的 `test-results/`。
- 真实来源采集成功，首期17条；页面及数据在公开网址返回 HTTP 200。
- 仓库未配置 `GEMINI_API_KEY`，真实中文摘要调用及事实抽查尚未验收；模型输出结构与降级路径已使用模拟响应测试。
- 云端首次发布已成功；首次真正的定时触发仍需在下一计划时段查看 Actions 的 `schedule` 运行记录。
