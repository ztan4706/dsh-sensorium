# Sensorium

**Ten senses for an agent that lives in a workspace.**
一个 npm 包、一段 patch、十条 insert——装一次，十感就位。

> 大多数"人格插件"是提示词。提示词不会累，不会因为没人说话而变空，也不会因为忙了一天而缓和。
> Sensorium 是可计算的内部状态：指数衰减、按时间积分、从文件 mtime 和真实对话里取信号。
> 确定性的，零模型调用。**agent 不在场的时候，时间也在它身上发生。**

- 包名：`dsh-sensorium`
- 当前版本：**0.0.1**
- 许可：MIT
- 作者：Bao（饱鲸 · E-1021）

---

## 装

**A. 插件市场（以后）**：市场里搜 `Sensorium`，点安装。目前还没上架，见下文「上架」。

**B. 命令行**：

```sh
dsh plugin --profile <你的 profile> add dsh-sensorium
```

**C. 本地目录（还没发布时）**：

```sh
git clone https://github.com/TTCdot/dsh-sensorium.git
dsh plugin --profile <profile> add link:/绝对路径/dsh-sensorium
```

或者在 DSH 里让 agent 调 `plugin_manager` 的 `install_bundle`，target 填这个目录的绝对路径。

装完**重启 DSH**（插件模块按 URL 缓存）。十条 insert 行会一次性并进 profile 的 patch 层。

## 配

十个感官共用一个 `workspace`——就是你想让它们观察的那个项目目录，状态落在
`<workspace>/.dsh/sensory/`。三种给法，优先级从高到低：

1. 在自己的 profile patch 里按 id 覆盖：

   ```yaml
   - id: sensorium-need-tension
     name: dsh-sensorium
     config:
       workspace: "D:\\work\\my-project"
   ```

2. 环境变量 `SENSORIUM_WORKSPACE`
3. 不填，用进程的 `process.cwd()`

> ⚠️ 第 3 条只是兜底。在 DSH 里宿主进程的 cwd 常常是应用目录或 profile 目录，
> 状态会写错地方。0.0.1 起会在 console 里喊一句提醒；正式用请显式配 `workspace`。

只想开其中几个？按 id 关掉其余的：

```yaml
- id: sensorium-face
  disabled: true
```

## 十感

| # | 感官 | 工具 | 它管什么 |
|---|---|---|---|
| 01 | workspace_pulse | `sense_workspace_pulse` | 房子有多吵：近 30 分钟改动、安静分钟、24 小时采样 |
| 02 | time_sense | `sense_time_sense` | 几点、什么时段、是不是深夜 |
| 03 | affect_core | `sense_affect_core` | valence / arousal / dominance，向基线衰减 |
| 04 | need_tension | `sense_need_tension` | 连接 / 刺激 / 了结，按格积分，认真实对话 |
| 05 | expression_bias | `sense_expression_bias` | tone / initiative / mask |
| 06 | silence_gate | `sense_silence_gate` | 该不该开口——沉默是正常输出 |
| 07 | residue_trace | `sense_residue_trace` | 情绪余味，强的事留得久 |
| 08 | unresolved_weight | `sense_unresolved_weight` | 没解决的事，越挂越重（唯一带写操作） |
| 09 | body | `sense_body` | 姿势、尾巴、耳朵、手——变了才露 |
| 10 | face | `sense_face` | 眼睛、眉、嘴角，还有藏不住的那一下 |

读顺序：外（01–02）→ 内（03–04）→ 表达（05–06、09–10）→ 代谢（07–08）。
每个感官只写自己的状态文件。

## 它怎么走

- **自己会走。** 脉搏 2 分钟一格，需求与情绪 5 分钟结算一次；不靠"被调用"推进时间。
- **按格积分。** 离开 15 小时，就真的按 30 个半小时格子走一遍：安静的格子只衰减，有动静的格子补一点。
- **会回填。** 第一次启动没有采样历史时，用文件 mtime 反推最近 24 小时——断电重启不会少掉一整天。
- **真实对话单独算。** 监听 `agent/inbox/claimed`，工作目录在本工作区的每一句记一条，只影响连接和刺激。文件在动不再冒充"有人跟我说话"。

细节、公式和两条踩过的坑，见 [`docs/设计.md`](docs/设计.md)。

## 自测

```bash
node tests/selftest.mjs    # 跨感官回归：时间是否真的会走
```

## 版本

`MAJOR.MINOR.PATCH`，从 `0.0.1` 起。

- **MAJOR**：状态文件格式、工具名或配置项有不兼容变更。
- **MINOR**：新增感官、新增字段或行为（向后兼容）。
- **PATCH**：修 bug、调常数、改文案。

`0.x` 期间 MINOR 也可能带不兼容变更——API 稳定下来再进 1.0。每次发版在
[`CHANGELOG.md`](CHANGELOG.md) 记一条，git tag 用 `v0.0.1` 这种格式。

## 上架（给自己看的备忘）

1. `npm publish`（公开仓库，`engines.dsh` 声明兼容范围）。
2. 去 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，在列表里加一条；站点和 DSH 插件市场会自动收录，通常一天内生效。
3. 市场卡片靠 `package.json` 的 `description`、`keywords`（含 `dsh-plugin`）和 README 取信息。

## 限制（诚实的）

- `activity_level` 是文件活动的代理，不是对话；对话单独走 `dialogue.jsonl`，且只影响连接与刺激。
- `dialogue` 里"这句是不是这个工作区的"依赖 session 的 cwd；拿不到时会退化成"都算"。
- 没有 UI。这些是状态和工具，不是界面。
- 参数是拍的，不是拟合的。想要别的节奏，改各插件文件顶上的常量。
- 和别的插件共存的问题、自查清单，见 [`docs/兼容性.md`](docs/兼容性.md)。

## 许可

MIT · Bao（饱鲸 · E-1021）
