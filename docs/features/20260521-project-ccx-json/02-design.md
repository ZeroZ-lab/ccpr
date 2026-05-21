# Project-level Plugin Manifest — Design

artifact_type: software
design_decision: required (lightweight — CLI interaction design, no visual)

## Design References

| Source | Pattern | Adopt/Reject |
|--------|---------|-------------|
| Existing `addPlugin()` (L314-333) | 搜索过滤 + multiselect 交互模式 | Adopt — `ccx init` 复用相同模式 |
| Existing `executeProfile()` (L486-515) | spinner + 逐个安装 + 计数 | Adopt — 提取共享函数 |
| asdf `.tool-versions` | 单文件、当前目录、无递归 | Adopt — 定位策略 |
| Lefthook `lefthook init` | init 命令生成配置文件 | Adopt — 命令模式 |

## Key Design Decisions

### KD-1: 安装逻辑共享

**问题**: `executeProfile()` 和项目配置安装的安装循环完全相同，如何避免重复？

**决策**: 提取 `installPlugins(plugins: string[])` 函数，`executeProfile()` 和新函数 `executeProjectConfig()` 都调用它。

**理由**: 安装循环（spinner + 逐个 execFileSync + 计数）是纯逻辑，无 profile/project 语义差异。提取后 `executeProfile()` 变为 3 行：读 profile → 调用 `installPlugins` → 打印结果。

### KD-2: 项目配置读写

**问题**: `.ccx.json` 格式 `{ plugins: [...] }` 和 profile 格式 `{ name, plugins }` 不同。复用还是独立？

**决策**: 新增 `readProjectConfig()` 和 `writeProjectConfig()` 独立函数。

**理由**: `.ccx.json` 没有 `name` 字段，读自当前目录而非 `~/.ccx/profiles/`，验证规则不同。复用 `readProfile()` 需要特殊分支，反而增加复杂度。

```
readProjectConfig()
├── 读 process.cwd() + "/.ccx.json"
├── 解析 JSON，验证 plugins 数组
├── 返回 string[]
└── 错误时 process.exit(1)

writeProjectConfig(plugins: string[])
├── JSON.stringify({ plugins }, null, 2) + "\n"
└── 写入 process.cwd() + "/.ccx.json"
```

### KD-3: `ccx init` 交互流程

```
ccx init
├── 检查 .ccx.json 是否已存在
│   ├── 存在 → confirm 覆盖？ → 取消则退出
│   └── 不存在 → 继续
├── getAllPlugins() 获取 marketplace 列表
│   ├── 无插件 → 允许手动输入 plugin 名（text input，逗号分隔）
│   └── 有插件 → 搜索过滤（如 >10 个）→ multiselect
├── writeProjectConfig(selectedPlugins)
└── p.log.success
```

**关键细节**:
- marketplace 无插件时不阻塞 — 允许用户手动输入名称（场景：private plugin 不在 marketplace）
- multiselect `required: false` — 允许创建空配置（`[]`）
- 搜索过滤复用 `addPlugin()` 的模式（>10 个时先 text 搜索）

### KD-4: `ccx install` 无参数路由

**当前代码** (L657-661):
```
case "install":
  if (!args[1]) { missingArg("Profile name is required.", ...) }
  await executeProfile(args[1]);
```

**改为**:
```
case "install":
  if (!args[1]) { await executeProjectConfig(); return; }
  await executeProfile(args[1]);
```

`executeProjectConfig()`:
```
├── 检查 process.cwd()/.ccx.json 是否存在
│   ├── 不存在 → p.log.error("No .ccx.json found. Run `ccx init` to create one.")
│   └── 存在 → readProjectConfig()
├── plugins 为空 → p.log.warn("No plugins in .ccx.json.")
└── installPlugins(plugins)
```

### KD-5: 常量和位置

```typescript
const PROJECT_CONFIG_FILE = ".ccx.json";
```

新函数在代码中的位置：
- `PROJECT_CONFIG_FILE` 常量 → L16 附近（其他常量旁边）
- `readProjectConfig()` / `writeProjectConfig()` → `readProfile()` 之后
- `installPlugins()` → `executeProfile()` 重构
- `executeProjectConfig()` → `executeProfile()` 之后
- `initProjectConfig()` → `executeProjectConfig()` 之后

### KD-6: printHelp() 更新

新增两行：
```
  ccx init                       Create .ccx.json for current project
  ccx install                    Install plugins from .ccx.json
```

插入位置：`ccx install <profile>` 行之后。

## 不做清单

- ~~Interactive mode 中集成 init~~ — init 是一次性操作，不需要进入 TUI 循环
- ~~`.ccx.json` schema 验证（`$schema` 字段）~~ — MVP 不需要
- ~~`.ccx.json` 中放描述/版本等元数据~~ — 只做 plugins
- ~~`ccx install` 从 interactive mode 调用~~ — 保持两套机制正交

## Assumptions

1. `.ccx.json` 总是在 `process.cwd()` — 不递归查找父目录
2. `claude plugin install` 对已安装的 plugin 是幂等的 — 不需要先检查是否已装
3. Marketplace 数据和 `getAllPlugins()` 足够支持 init 场景
