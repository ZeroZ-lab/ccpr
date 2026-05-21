# Spec: Profile-centric Interactive Mode

**artifact_type:** software
**date:** 2026-05-21
**status:** final

## Background

用户使用 ccx 的实际流程：

1. **配置阶段（低频）** — 预建多个 profile（如 work / personal / backend），给每个 profile 装好插件，像"存档"
2. **使用阶段（高频）** — 到了开发目录，选一个 profile install 进去，像"读档"

## Problem

当前 area-centric 分层菜单导致：

1. **Profile 重复选择** — 不同 area 各选一次 profile
2. **层级太深** — 简单操作需钻 3 层
3. **Install 不在核心路径** — 高频操作被埋在二级菜单
4. **无上下文记忆** — 没有"当前 profile"概念

## Target Flow

```
ccx
  → Select profile (work / personal / backend / Create new... / Exit)

  → [work] 选择操作：
      ├─ Install        ← 高频，一键应用到当前项目
      ├─ Add plugin     ← 搜索 → 选择 → 加入当前 profile
      ├─ Remove plugin  ← 从当前 profile 移除
      ├─ List plugins   ← 显示当前 profile 的插件
      ├─ Search marketplace ← 搜索发现 → 可直接加到当前 profile
      ├─ Switch profile ← 换一个 profile
      ├─ Delete profile ← 删除（删当前则回到选择）
      └─ Exit
```

## Requirements

### R1: Profile 优先入口
- 进入交互模式第一步：选择 profile
- 显示已有 profile 列表 + "Create new..." 选项
- 无 profile 时自动引导创建
- 支持 Ctrl+C / ESC 退出

### R2: 当前 profile 上下文
- 选中后记住为"当前 profile"
- 菜单标题显示 `[profile-name]`
- 所有操作默认作用于当前 profile
- "Switch profile" 可切换到其他 profile（回到 R1 选择）

### R3: 单层操作菜单
- 选完 profile 后进入 while(true) 循环
- 所有操作在一个 p.select 中，不嵌套子 wizard
- 操作完成后自动回到菜单

### R4: Install 一级可达
- Install 是菜单第一个选项（高频操作）
- 直接 install 当前 profile，无需再次选择

### R5: Marketplace 搜索可加到当前 profile
- 搜索到 plugin 后，可选择直接加到当前 profile
- 搜索结果每个选项附带"加到 profile"操作

### R6: Profile 管理集成
- Switch → 回到 profile 选择
- Create → 新建后自动切为当前 profile
- Delete → 删除当前 profile → 回到 profile 选择；删除其他 → 不影响

## Out of Scope

- CLI 参数模式不变
- Profile 文件格式不变
- Plugin 安装机制（`claude plugin install`）不变

## Success Criteria

- Install 路径：选 profile → Install（2 步）
- Add plugin 路径：选 profile → Add plugin → 搜索选择（3 步）
- 不需要重复选择 profile
