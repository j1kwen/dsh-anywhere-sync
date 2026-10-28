# Anywhere Sync · 配置同步

[![CI](https://github.com/j1kwen/dsh-anywhere-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/j1kwen/dsh-anywhere-sync/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/j1kwen/dsh-anywhere-sync)](LICENSE)

![Anywhere Sync](assets/icon-180.png)

用**一个私有 Git 仓库**在多台电脑之间共享 Harness 的 profile 配置、插件清单、插件设置、依赖锁、本地插件源码与技能。每一类内容都可以单独开关；一台机器修改后，其他机器在下一次同步时生效。

[English README](README.md)

设置入口：**设置 → 配置同步**（`settings.section`）。

## 安装

要求：带 Web UI 的 DeepSeek Harness、Node.js 20+、本机有 `git`。

```bash
dsh plugin --profile desktop add j1kwen/dsh-anywhere-sync
```

安装后重启 Harness，打开 **设置 → 配置同步**。

也可以从本地目录或 Release 的 tarball 安装：

```bash
dsh plugin --profile desktop add /path/to/dsh-anywhere-sync
# 或在插件管理器中选择最新 Release 的 dsh-anywhere-sync.tgz
```

仓库声明了 `dsh.bundle` 和 `cordis.patch.yml`，因此可以作为一个 bundle 安装。

## 同步项

| 项目 | 本机来源 | 仓库路径 | 默认 |
| --- | --- | --- | --- |
| 插件清单 | `<profile>/package.json` | `profile/<profile>/package.json` | 开 |
| 本地插件源码 | `link:` / `file:` / 绝对路径依赖的插件目录 | `local-plugins/<包名>/…` | 开 |
| 插件配置 | `<profile>/cordis.patch.yml` | `profile/<profile>/cordis.patch.yml` | 开 |
| 依赖锁文件 | `<profile>/pnpm-lock.yaml`、`pnpm-workspace.yaml` | 同左 | 开 |
| 其他 profile 文件 | profile 目录中的其余配置文件（预设、`config.toml` 等） | `profile/<profile>/…` | 关 |
| 技能 | `~/.agents/skills/`、`~/.agents/.skill-lock.json` | `skills/…` | 关 |

关闭的项目在两边都不会被读取、写入或删除。疑似密钥的文件（`.env*`、`*credential*`、`*secret*`、`id_rsa*`、`*.pem`、`.npmrc`、`config.toml` 等）即使开启“其他 profile 文件”也会被排除。

**本机路径不会外传。** `package.json` 与 `pnpm-lock.yaml` 在同步前会被投影成“可移植形式”：`link:`、`file:`、`workspace:` 以及绝对路径依赖（包括本插件自己的 `link:` 安装）不会写进仓库，对应的 bundle 条目也会一并移除。拉到远端清单时采用合并而不是覆盖，各机器保留自己的本地链接。换机器后第一次安装依赖时，包管理器会按本机清单把链接条目补回锁文件。

**插件本身也会同步。** “本地插件源码”会读取 profile 里所有 `link:`/`file:`/绝对路径依赖的插件目录，把代码（不含 `node_modules`、`.git`、疑似密钥文件）放到仓库的 `local-plugins/<包名>/`。拉取时：

- 本机已经有这个本地依赖 → 直接写回它的源目录；
- 本机没有 → 写入 `$DSH_HOME/anywhere-sync/local-plugins/<包名>`，并自动在 profile 清单里加上 `link:` 依赖，随后安装依赖；需要启用为 Harness 插件时，在插件页把对应的 bundle 打开一次（插件本体的 bundle 在首次安装时就已经存在）；
- 插件代码更新后需要重启 Harness 才会加载。

所以本插件自己也会出现在“本地插件源码”里：在一台机器上改代码并同步，另一台机器拉到后会更新自己的安装目录。新机器仍需先安装一次本插件，才能进入设置页完成首次同步。

## 开始使用

1. 在 GitHub 创建一个**私有**仓库（可以勾选 “Add a README” 初始化 `main` 分支）。
2. 创建 Personal Access Token（classic 的 `repo` scope，或 fine-grained 的 Contents: Read and write）。界面里的“创建 GitHub 令牌”按钮会打开对应页面。
3. 打开 **设置 → 配置同步**，填写仓库地址（`owner/repo` 或 `https://github.com/owner/repo`）、分支和令牌，点 **保存并连接**。
4. 点 **立即同步**。第一次同步后，在另一台机器安装本插件并重复第 3 步即可拉取同一套配置。
5. 打开 **定时同步**（默认 15 分钟）或 **启动时同步**，让“一处修改，多处生效”自动完成。

拉取到新的插件清单或锁文件后，页面会提示安装依赖；默认会自动在 profile 中运行包管理器。插件代码本身要在 Harness 重启后才会加载。

## 冲突与数据安全

- 每次写盘前把将被覆盖的文件复制到 `$DSH_HOME/anywhere-sync/backups/<时间戳>/`，只保留最近 10 份。
- 同步基于三方比较（本机 / 远端 / 上次同步的哈希），只有真正“两边都改过”的同一文件才算冲突。
- 冲突策略：**远端优先**（默认，适合新机器并入共享配置）、**本地优先**、**保留冲突**（在页面逐个选择保留哪一边）。
- 每次推送只 `git add` 本次实际修改的路径，仓库里其他 profile 或其他工具的文件不会被碰。
- 推送前先 fetch；如果远端在同步期间又前进，会重新计算并重试一次，绝不 force push。
- 删除会传播：本机删除一个已同步的文件，下一次同步会从仓库删除它（反向同理）。

## 从旧同步工具迁移

本插件不读取、也不修改 `~/.dsh/dsh-sync` 里的配置或令牌（那是别的工具的数据）。如果你之前用过其它同步工具，建议**新建一个私有仓库**：旧工具通常把文件放在 `plugins/<profile>/`，本插件使用 `profile/<profile>/`，混在同一个仓库里会出现两套目录。首次接入前先确认“冲突处理”策略，再点“立即同步”。

## 安全边界

- 令牌只保存在 `$DSH_HOME/anywhere-sync/credentials.json`（权限 `0600`），通过 `GIT_ASKPASS` 临时环境变量交给 git，**不写入仓库、不写进 URL、不返回给浏览器**。
- 也可以通过环境变量提供令牌（按优先级）：`ANYWHERE_SYNC_TOKEN`、`GH_TOKEN`、`GITHUB_TOKEN`。
- HTTP 接口挂在 `/anywhere-sync/api`，复用 Harness Connection 的 Host/Origin 与登录校验；没有该服务时只接受 loopback。修改类请求还要求同源 `Origin`。
- 插件不读取、不同步 `~/.dsh/.credentials.yaml`、会话记录或工作区文件。
- 需要本机安装 `git`；依赖安装优先使用启动器发布的包管理器，否则使用 PATH 上的 `pnpm`。
- 面向 macOS / Linux / Windows；CI 在 Linux + Node 20/22 上运行离线引擎与 HTTP 测试，Windows 路径处理使用 Node 的 `path` API，但未经 CI 覆盖。
- 没有遥测、统计或除配置的 Git 远端之外的外发请求。

## 工作方式

```text
fetch origin <branch> → reset --hard（本地镜像 = 远端真相）
   ↓ 逐文件三方比较 hash(local) / hash(remote) / hash(base)
   ├─ 只有本地变 → 写入镜像，commit，push
   ├─ 只有远端变 → 写入本机（先备份）
   └─ 两边都变   → 按策略处理，或列为冲突
   ↓ 更新 base 哈希
```

状态在 `$DSH_HOME/anywhere-sync/state.json`，配置在 `config.json`，仓库镜像在 `repo/`。当前同步的 profile 就是插件所在的那个 profile，界面会显示 profile 名。

## 智能体工具

插件同时注册 `anywhere_sync` 工具，参数 `action` 为 `status` / `sync` / `pull` / `push` / `install`。它调用与界面完全相同的 Host 实现，不能修改仓库地址、同步项或读取令牌。

## 自测

```bash
npm run verify
```

两个脚本不依赖 Harness，也不访问网络：

```bash
node scripts/engine-test.mjs   # 本地裸仓库：推送/拉取/冲突/删除/多机器/本地链接投影/本地插件源码注册
node scripts/http-test.mjs     # HTTP 路由：鉴权、参数校验、启动与轮询
```

GitHub Actions 在每次 push 和 PR 上运行同样的检查（Node 20/22）。

## 发布与签名

- Release 由 GitHub Actions 从**签名的 tag** 构建，发布 `dsh-anywhere-sync.tgz` 与 `SHA256SUMS`；
- tarball 带 Sigstore build provenance，校验和文件带 keyless Sigstore 签名
  （`SHA256SUMS.sigstore.json`）：

  ```bash
  sha256sum -c SHA256SUMS
  gh attestation verify dsh-anywhere-sync.tgz --repo j1kwen/dsh-anywhere-sync
  cosign verify-blob --bundle SHA256SUMS.sigstore.json \
    --certificate-identity-regexp 'https://github.com/j1kwen/dsh-anywhere-sync/.github/workflows/release.yml@refs/tags/.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    SHA256SUMS
  ```

- 提交和 tag 使用维护者注册的 SSH signing key 签名，GitHub 会显示 Verified。

## 排障

如果安装后 **设置 → 配置同步** 是空白：

1. 重启 Harness。Client bundle 在启动时缓存；在 Harness 运行时从 Git 地址安装插件，浏览器端可能尚未加载。
2. 升级到 1.2.3 或更高版本。渲染错误现在会显示在页面上（含堆栈），而不是留下空白；浏览器控制台也会打印已加载的客户端版本。
3. 如果仍然报错，请把页面上的错误、浏览器控制台输出和 Harness 版本一起反馈。

## 已知限制

- 只同步“文本文件”，单文件上限 5 MiB；超限文件会跳过并在状态里报告。
- 不安装/卸载插件包本身，只同步清单与锁文件，然后调用包管理器。
- 新拉取的本地插件只注册依赖，不自动启用 bundle（避免在包尚未安装时挂载导致启动失败）。
- `profileFiles` 与 `skills` 默认关闭；确认可以离开本机后再开启。
- 不处理 git 子模块、LFS 或仓库历史清理。
- 无浏览器自动化时，页面的视觉验证需要人工在浅色/深色主题下各看一次；接口、同步引擎与槽位注册已自动验证。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
