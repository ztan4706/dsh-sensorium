# Changelog

版本号 `MAJOR.MINOR.PATCH`：不兼容变更 / 新增 / 修补。

## 0.0.1 — 2026-10-24

首个公开版本。

- 打包为单个 npm 包 `dsh-sensorium`：一段 patch、十条 insert，装一次十感就位。
- 十个感官：workspace_pulse、time_sense、affect_core、need_tension、expression_bias、
  silence_gate、residue_trace、unresolved_weight、body、face。
- 三个有状态的感官自带钟（脉搏 2 分钟、需求与情绪 5 分钟），按 30 分钟格积分，
  首次启动用文件 mtime 回填 24 小时。
- `dialogue.jsonl`：监听 `agent/inbox/claimed`，真实对话影响连接与刺激。
- 默认 workspace 依次取 `config.workspace` → `SENSORIUM_WORKSPACE` → `process.cwd()`；
  落到 profile 目录时在 console 里给一句提醒。
- 跨感官回归测试 `tests/selftest.mjs`，装配冒烟 `tests/apply-smoke.mjs`。
- `docs/兼容性.md`：插件组合互相影响的可能性、隔离测试结果、使用者自查清单。
