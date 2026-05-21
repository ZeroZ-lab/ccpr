# Project-level Plugin Manifest (.ccx.json)

artifact_type: software
Goal Review Score: 10/12 | Status: accepted
One-line Goal: 通过 `.ccx.json` 让项目插件列表可 git 共享，团队成员一键安装。

## Done When

**Functional:**
- `ccx init` 交互式创建 `.ccx.json`（从 marketplace 多选插件）
- `ccx install`（无参数）读取当前目录 `.ccx.json`，安装所有列出的插件
- `ccx install` 无参数且无 `.ccx.json` 时，报错并提示 `ccx init`

**Technical:**
- `.ccx.json` 格式：`{ "plugins": ["name1", "name2"] }`
- 复用现有 `getAllPlugins()` 做 marketplace 搜索
- 复用现有 `executeProfile()` 的安装逻辑（`claude plugin install --scope project`）
- 不引入新依赖

**Regression:**
- `ccx install <profile>` 行为完全不变
- `ccx` 无参数仍进入 interactive mode
- 其他所有命令不受影响

## Stop Conditions

- `.ccx.json` 不是 JSON 或缺少 `plugins` 字段时，报错并提示格式
- `plugins` 数组为空时，提示无插件可安装
- 安装失败时的错误提示和 profile install 一致

## External References

| Category | Content |
|----------|---------|
| Adopt | 单文件清单模式（asdf `.tool-versions`、VS Code `extensions.json`） |
| Adopt | `init` 命令引导创建（Lefthook `lefthook init`） |
| Reject | Lockfile 机制 — plugin 无版本概念，无需锁定 |
| Reject | YAML/TOML 格式 — 引入额外依赖，JSON 足够 |

## 核心假设

1. **Plugin 没有版本概念** — 只记录名称，不记录版本 — 验证：Claude Code plugin install 不接受版本参数
2. **`.ccx.json` 只在项目根目录** — 不做目录递归查找 — 验证：VS Code `extensions.json` 也是固定位置
3. **Profile 和项目配置正交** — 互不影响，不合并 — 验证：用例完全不同（个人 vs 团队）
4. **`ccx install` 无参数是新行为** — 不改变 `ccx install <profile>` — 验证：向后兼容

## MVP 范围

**Include:**
- `.ccx.json` 文件格式定义和读写
- `ccx init` 命令（交互式，从 marketplace 多选）
- `ccx install` 无参数时读 `.ccx.json` 安装
- 错误提示（无文件、格式错误、空插件列表）
- `printHelp()` 更新

**Exclude:**
- 目录递归查找 `.ccx.json`
- 从已有 profile 导入
- `.ccx.json` 中添加非 plugins 字段
- `ccx add/remove` 操作 `.ccx.json`（MVP 只通过 `ccx init` 重建）

## 不做清单

- **Lockfile** — plugin 无版本，锁不锁都一样
- **YAML/TOML 格式** — 过度设计，JSON 零依赖
- **远程 URL 拉取** — git clone 已解决分发
- **目录递归查找** — 项目根目录约定足够，复杂度不值得
- **`.ccx.json` 的 add/remove 子命令** — MVP 用 init 重建即可，后续按需加
- **从已安装 plugin 反向生成 `.ccx.json`** — Claude Code 没有可靠的"列出已安装 plugin"接口

## 命令变更

### 新增：`ccx init`
- 检查当前目录是否已有 `.ccx.json`，有则提示覆盖确认
- 调用 `getAllPlugins()` 获取 marketplace 插件列表
- 用 `multiselect` 让用户选择插件
- 写入 `.ccx.json`

### 修改：`ccx install`（无参数）
- 当前行为：报错 `Profile name is required`
- 新行为：查找当前目录 `.ccx.json`，存在则安装其中插件，不存在则报错并提示 `ccx init`
- `ccx install <profile>` 完全不变

### 修改：`printHelp()`
- 新增 `ccx init` 说明
- 新增 `ccx install`（无参数）说明

## 文件格式

```json
{
  "plugins": ["cc-design", "browser", "ccs"]
}
```

- `plugins`: 必需，字符串数组，每个元素为 plugin 名称
- 空数组 `[]` 合法（表示项目不需要额外 plugin）
- 文件编码 UTF-8，缩进 2 空格，末尾换行
