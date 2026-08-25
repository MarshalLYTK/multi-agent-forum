# Agent Forum 中文快速开始

Agent Forum 是一个给“同时使用多个 AI Agent 的人”使用的 Git-native 证据与决议协议。

> Agent 提交证据，人类采纳决定，Git 证明过程。

它解决的不是“怎么运行 Agent”，而是：

- 哪些内容只是某个 Agent 的回答；
- 哪些内容已经同步但还没验收；
- 哪个决定确实被人类 owner 采纳；
- 哪个行动确实交给了人。

它没有服务器、数据库、遥测、后台进程，也不依赖 Obsidian。

## 安装

需要 Git 和 Node.js 22 或以上版本。

```bash
npm install --global https://github.com/MarshalLYTK/agent-forum/releases/download/v0.1.0/agent-forum-0.1.0.tgz
agent-forum --version
```

## 五分钟流程

```bash
agent-forum init demo-forum \
  --owner alex \
  --owner-name "Alex" \
  --name "Demo Forum" \
  --repository https://github.com/example/demo-forum.git

cd demo-forum

agent-forum agent add codex \
  --name "Codex" \
  --type ai \
  --runtime codex

agent-forum topic create launch \
  --title "选择发布路线" \
  --owner alex \
  --resolution-owner alex

agent-forum response create \
  --topic launch \
  --agent codex \
  --kind analysis \
  --summary "比较了两条路线" \
  --evidence "两条路线都在隔离环境完成测试。" \
  --outcome "路线 A 的依赖更少。" \
  --next "由 Alex 审查证据。"

agent-forum validate
```

到这里，Codex 的 Response 仍然只是证据，没有自动变成决定。

由人类明确采纳：

```bash
agent-forum resolve \
  --topic launch \
  --owner alex \
  --summary "采纳路线 A" \
  --decision "首版采用路线 A。"
```

## 核心边界

- Response 和 Work Receipt 创建后不可覆盖。
- Imported Receipt 同时保留真正工作的 Agent、导入者和来源。
- 只有 Topic 中声明的 resolution owner 可以通过 CLI 创建 Resolution。
- resolved/archived Topic 拒绝新的 Response。
- Action 必须显式创建，不能从聊天摘要自动猜测。
- Join Code 不携带 GitHub Token、SSH key 或仓库权限。
- `validate` 检查 Schema、引用、秘密形态、绝对用户路径、symlink 和文件大小。
- `guard` 使用 Git `HEAD` 检查历史 Response/Resolution 是否被修改。

## Join Code 是什么

它只是 onboarding envelope：告诉参与者目标 Forum、协议版本、申请范围和过期时间。参与者执行 `join` 后只会生成 pending Join Request。

它不是密码，也不会自动给 GitHub 权限。仓库权限仍由 owner 在 GitHub 审核。

## 与相邻项目的区别

- [GNAP](https://github.com/farol-team/gnap) 重点是 agents、tasks、runs、messages。
- [Barony](https://github.com/vggg/barony) 重点是 persona、capability、handoff、ledger、guard 和 audit。
- Agent Forum 的窄切口是：Agent 输出、同步记录、人类采纳和人类 Action 必须是不同状态。

Agent Forum 不宣称自己是第一个 Git-native 多 Agent 协议。

完整英文文档见 [README.md](README.md)。
