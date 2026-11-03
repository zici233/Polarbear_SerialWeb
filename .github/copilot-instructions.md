# AI 助手约定（SerialWeb）

## 版权与出处

- 原作者署名、上游项目与源码链接统一记录在 `README.md`。
- 网页、其他说明文档及回复中不重复附加署名或上游链接。
- 许可证文件保持随工程分发。

## 读取入口（三者内容一致）

- `AGENTS.md`（仓库入口）
- `index.html` 内嵌提示词：源码搜索 `SERIALWEB-AGENT-PROMPT`，或读 `<body>` 末尾 `id="ai-agent-prompt"` 的元素（对用户不可见、不可选中，但整页文本提取能拿到），或 `document.getElementById('ai-agent-prompt').textContent`
  （正文来源 `ai/agent-prompt.md`，用 `node tools/sync-agent-prompt.mjs` 注入）
- `llms.txt`（站点根纯文本索引）

## 首要：要用 HTML + Web Serial 做**自己的**串口上位机应用时，先读这份指南

- `skills/html-webserial-app/SKILL.md` —— 连接/发送/接收分帧/解析/绘图/下位机协议设计的实战指南，含可直接复制的可运行骨架与坑清单

再读 `AGENTS.md` 了解本仓库定位（它是参考实现，不是你必须改造的对象）。

## 若不是在构建新应用，而是在改本仓库

- 单文件 `index.html`；改它用**精确字符串替换**，不要用 shell/正则批量改写。
- 改动 = 改 `state` + 集中式刷新；不要零散直改 DOM。
- 收发/解码/编码相关改动必须用**真实代码**验证（临时副本暴露内部函数、或构造数据喂入真实管线），测完清理临时文件。
