# ccx

## 项目信息
- npm 包名: @guanmu/ccprofile
- CLI 命令: ccx

## 发布流程
1. 先提交所有代码改动
2. bump package.json version
3. commit + push
4. gh release create（npm 自动发布）

## 代码规范
- 全局包管理用 bun
- UI 用 @clack/prompts，保持简洁

## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The tracker uses the five default triage role names. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository with a root `CONTEXT.md` and system-wide ADRs under `docs/adr/`. See `docs/agents/domain.md`.
