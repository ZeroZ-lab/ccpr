# Project-level Plugin Manifest — Plan

artifact_type: software
plan_topology: serial（单文件，无并行安全区间）
estimated_size: S（~100 行新代码 + ~20 行重构）

## 前置假设

1. `claude plugin install` 对已安装的 plugin 幂等 — 不需要先检查
2. Marketplace `getAllPlugins()` 可能返回空数组 — init 需要兜底
3. `process.cwd()` 就是项目根目录 — 不做目录递归

## 文件变更范围

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/index.ts` | 修改 | 所有新逻辑 |
| `test/cli.test.mjs` | 修改 | 新增测试用例 |

## 任务

### T1: 基础设施 — 常量 + 读写函数 + 安装逻辑提取

**修改文件**: `src/index.ts`

**步骤**:
1. L16 附近新增常量: `const PROJECT_CONFIG_FILE = ".ccx.json";`
2. 新增 `readProjectConfig(): string[]`
   - 读取 `process.cwd()/.ccx.json`
   - 解析 JSON，验证 `plugins` 数组
   - 返回 `string[]`，错误时 `process.exit(1)`
3. 新增 `writeProjectConfig(plugins: string[]): void`
   - `JSON.stringify({ plugins }, null, 2) + "\n"` 写入 `process.cwd()/.ccx.json`
4. 从 `executeProfile()` (L497-514) 提取 `installPlugins(plugins: string[])`
   - spinner + 逐个安装 + 计数逻辑移入新函数
   - `executeProfile()` 改为: 读 profile → 调用 `installPlugins(data.plugins)`

**验收标准**:
- `tsc` 编译通过
- `executeProfile()` 行为不变（手动验证: `ccx install <profile>` 仍正常）

**验证**:
```bash
bun run src/index.ts profiles  # 列出现有 profiles，确认无报错
bun run src/index.ts install <existing-profile>  # 确认安装行为不变
```

---

### T2: `ccx install` 无参数 — 从 .ccx.json 安装

**修改文件**: `src/index.ts`

**步骤**:
1. 新增 `executeProjectConfig(): Promise<void>`
   - 检查 `.ccx.json` 是否存在 → 不存在报错 "No .ccx.json found. Run `ccx init` to create one."
   - `readProjectConfig()` → plugins 为空提示 "No plugins in .ccx.json." → 有插件调用 `installPlugins()`
2. 修改 `main()` switch `install` case (L656-661):
   ```
   // 旧: if (!args[1]) { missingArg(...); return; }
   // 新: if (!args[1]) { await executeProjectConfig(); return; }
   ```

**验收标准**:
- 无 `.ccx.json` 时: `ccx install` 报错 + 提示 `ccx init`
- 有 `.ccx.json` 含插件时: 安装所有插件
- `ccx install <profile>` 行为完全不变

**验证**:
```bash
cd /tmp && bun run /path/to/src/index.ts install
# 预期: "No .ccx.json found. Run `ccx init` to create one."

echo '{"plugins":["test"]}' > /tmp/.ccx.json && cd /tmp && bun run /path/to/src/index.ts install
# 预期: 尝试安装 test plugin（可能失败但流程正确）

bun run src/index.ts install <existing-profile>
# 预期: 行为不变
```

---

### T3: `ccx init` 命令 + help 更新

**修改文件**: `src/index.ts`

**步骤**:
1. 新增 `initProjectConfig(): Promise<void>`
   - 检查 `.ccx.json` 存在 → confirm 覆盖
   - `getAllPlugins()`:
     - 有插件 → 搜索过滤(>10 时) → multiselect (`required: false`)
     - 无插件 → text input 手动输入（逗号分隔）
   - `writeProjectConfig(selected)`
   - 提示成功
2. `main()` switch 新增 `case "init":`
   ```
   case "init":
     await initProjectConfig();
     break;
   ```
3. `printHelp()` 新增两行（在 `ccx install <profile>` 行之后）:
   ```
     ccx init                       Create .ccx.json for current project
     ccx install                    Install plugins from .ccx.json
   ```

**验收标准**:
- `ccx init` 交互式创建 `.ccx.json`
- 已有 `.ccx.json` 时提示覆盖确认
- marketplace 无插件时允许手动输入
- `ccx --help` 显示新命令

**验证**:
```bash
cd /tmp && rm -f .ccx.json && bun run /path/to/src/index.ts init
# 预期: 交互式选择插件 → 生成 .ccx.json

cat /tmp/.ccx.json
# 预期: {"plugins":["..."]}

bun run /path/to/src/index.ts init
# 鐭期: 提示覆盖

bun run src/index.ts --help
# 预期: 包含 init 和 install (无参数) 说明
```

---

### T4: 集成测试

**修改文件**: `test/cli.test.mjs`

**步骤**:
1. 新增: `ccx install` 无参数 + 无 `.ccx.json` → 报错含 "ccx init"
2. 新增: `ccx install` 无参数 + `.ccx.json` plugins 为空 → 提示无插件
3. 新增: `ccx install` 无参数 + `.ccx.json` 格式错误 → 报错
4. 新增: `ccx --help` 包含 "init" 和 "Install plugins from .ccx.json"

**注意**: `ccx init` 是交互式命令，spawnSync 无法测试（同现有 `ccx` 无参数）。只测非交互路径。

**验收标准**:
- 4 个新测试全部通过
- 原有测试不受影响

**验证**:
```bash
node test/cli.test.mjs
# 预期: 所有测试通过，无 assertion error
```

---

### T5: 构建验证

**步骤**:
1. `tsc` 编译
2. 完整流程手动验证: `ccx init` → `ccx install` → 检查 `.ccx.json` 内容
3. 回归验证: `ccx install <profile>` 行为正常

**验收标准**:
- `tsc` 无错误
- 完整 init → install 流程可用
- 现有功能无回归

**验证**:
```bash
tsc
node dist/index.js init
cat .ccx.json
node dist/index.js install
node dist/index.js --help
```

---

## 检查点

| 检查点 | 在任务后 | 验证内容 |
|--------|---------|---------|
| CP-1 | T1 | tsc 编译 + install <profile> 不回归 |
| CP-2 | T2 | install 无参数的新行为正确 |
| CP-3 | T3 | init → install 完整流程可用 |
| CP-4 | T4 | 测试通过 |
