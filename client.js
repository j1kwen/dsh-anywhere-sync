/**
 * dsh-anywhere-sync — Client half.
 *
 * Registers one settings section ("Anywhere Sync"). The page is a thin view over
 * `/anywhere-sync/api`: it never touches the filesystem and never receives the
 * token. Styles use only `--dsw-alias-*` theme tokens so light/dark switching
 * and future token renames degrade gracefully.
 */
window.__ModuleLoader__.load({
  id: 'dsh-anywhere-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-anywhere-sync'
    const API_PREFIX = 'anywhere-sync/api'
    const POLL_MS = 3500

    const zh = {
      nav: '配置同步',
      title: '配置同步',
      subtitle: '用 GitHub 私有仓库在多台电脑之间共享 Harness 配置、插件与插件设置；每一类内容都可以单独开关。',
      statusIdle: '读取中',
      statusNotConfigured: '未配置',
      statusGitMissing: '缺少 Git',
      statusRunning: '同步中',
      statusSynced: '已同步',
      statusConflicts: '有冲突',
      statusFailed: '上次失败',
      statusNever: '待首次同步',
      syncNow: '立即同步',
      uploadOnly: '仅上传',
      downloadOnly: '仅下载',
      syncing: '同步中…',
      repoCard: '同步仓库',
      repoCardHint: '私有仓库保存的是配置文本，不包含任何已安装的插件包或依赖。',
      repoUrl: '仓库地址',
      repoUrlPlaceholder: 'https://github.com/你的用户名/harness-config',
      branch: '分支',
      branchPlaceholder: 'main',
      token: '访问令牌',
      tokenPlaceholder: 'github_pat_… 或 ghp_…',
      tokenSaved: '已保存令牌',
      tokenEnv: '令牌来自环境变量',
      tokenHint: '令牌只保存在本机 $DSH_HOME/anywhere-sync/credentials.json（权限 0600），不会写进仓库，也不会返回给页面。需要 repo 权限。',
      createToken: '创建 GitHub 令牌',
      saveConnect: '保存并连接',
      testing: '连接中…',
      testConnection: '测试连接',
      clearToken: '清除令牌',
      clearTokenConfirm: '清除本机保存的访问令牌？仓库本身不会被修改。',
      connected: '已连接',
      repoPrivate: '私有',
      repoPublic: '公开',
      repoWritable: '可推送',
      repoReadOnly: '只读令牌',
      repoDefaultBranch: '默认分支',
      branchMissing: '远端没有这个分支。可用分支：',
      useBranch: '改用',
      itemsCard: '同步项',
      itemsCardHint: '只同步已开启的项目；关闭的项目会原样保留在仓库和本机。',
      itemPlugins: '插件清单',
      itemPluginsHint: 'package.json：已安装插件、版本与 bundle 启用列表；本机 link:/file: 依赖不会上传。',
      itemLocalPlugins: '本地插件源码',
      itemLocalPluginsHint: 'link:/file: 安装的插件代码（包括本插件自身）。拉取后写入本机对应目录；本机没有时会放进管理目录并加入依赖清单，需要时在插件页启用对应 bundle。',
      itemPluginConfig: '插件配置',
      itemPluginConfigHint: 'cordis.patch.yml：插件参数、模型选择、界面偏好等覆盖项。',
      itemLock: '依赖锁文件',
      itemLockHint: 'pnpm-lock.yaml 与 pnpm-workspace.yaml，保证各机器依赖版本一致；本机 link:/file: 条目同样不会上传。',
      itemProfileFiles: '其他 profile 文件',
      itemProfileFilesHint: 'profile 目录中的其余配置（预设、config.toml 等）。可能含密钥，默认关闭。',
      itemSkills: '技能',
      itemSkillsHint: '~/.agents/skills 与 .skill-lock.json，让各机器拥有同一套技能。',
      filesCount: '个文件',
      viewFiles: '查看文件',
      hideFiles: '收起',
      noFiles: '这一项还没有文件。',
      secretWarning: '疑似密钥的文件已自动排除，不会同步。',
      truncated: '文件过多，仅显示前 500 个。',
      autoCard: '自动同步',
      autoCardHint: '自动同步按固定间隔在后台拉取并推送；一台机器修改后，其他机器在下一次同步时生效。',
      autoSync: '定时同步',
      autoSyncHint: '按下面的间隔在后台同步。',
      interval: '间隔',
      everyMinutes: '分钟',
      syncOnStartup: '启动时同步',
      syncOnStartupHint: 'Harness 启动约 8 秒后自动同步一次。',
      autoInstall: '拉取后安装依赖',
      autoInstallHint: '插件清单或锁文件更新后，自动在 profile 中运行包管理器。',
      conflictMode: '冲突处理',
      conflictRemote: '远端优先',
      conflictLocal: '本地优先',
      conflictSkip: '保留冲突，稍后手动处理',
      conflictHint: '同一文件在多台机器上都被修改时使用。首次连接一台已有配置的机器时也按这个策略处理。',
      lastCard: '上次同步',
      lastCardHint: '这里只显示最近一次运行的结果。',
      neverSynced: '还没有同步记录。',
      pulled: '拉取',
      pushed: '推送',
      conflicts: '冲突',
      commit: '提交',
      durationSec: '耗时',
      backup: '覆盖前备份',
      installPendingTitle: '插件依赖尚未安装',
      installPendingHint: '插件清单或本地插件源码已从远端更新；安装依赖并重启 Harness 后才会加载新插件。',
      installNow: '安装依赖',
      installing: '安装中…',
      installOk: '依赖安装完成',
      installFailed: '依赖安装失败',
      installOutput: '安装输出',
      conflictTitle: '需要手动处理的冲突',
      conflictHint: '两边都改过同一个文件。选择保留哪一边；被覆盖的一边会先备份。',
      keepLocal: '用本地版本',
      keepRemote: '用远端版本',
      notConnectedHint: '先填写仓库地址和访问令牌，然后点「保存并连接」。仓库需要提前创建（建议设为私有）。',
      firstRunHint: '首次连接一台已有配置的机器时，默认采用「远端优先」，让本机并入共享配置；如果要让本机覆盖远端，请先把冲突处理改成「本地优先」。',
      errorTitle: '操作失败',
      retry: '重试',
      loading: '读取中…',
      savedNotice: '设置已保存。',
      connectedNotice: '连接成功。',
      syncStarted: '同步已开始，完成后这里会自动更新。',
      installStarted: '已开始安装依赖。',
      profileLabel: '当前 profile',
      instanceLabel: '实例',
      repoPathLabel: '本地镜像',
      skillsLabel: '技能目录',
      versionLabel: '版本',
      errNoConfig: '还没有配置仓库地址。',
      errGitMissing: '找不到 git，请先安装 Git 并确保在 PATH 中。',
      errAuth: '令牌无效或没有访问权限。',
      errTokenRequired: '访问私有仓库需要令牌。',
      errRepoNotFound: '找不到仓库，或令牌看不到它。请先在 GitHub 创建这个私有仓库。',
      errBranchMissing: '远端没有这个分支。',
      errBadBranch: '分支名不合法。',
      errBadRepoUrl: '仓库地址格式不正确。',
      errUnreachable: '无法连接远端仓库，请检查网络或地址。',
      errPushRejected: '远端在同步期间有了新提交，请重试。',
      errBusy: '另一个同步正在进行，请稍候。',
      errInstall: '依赖安装失败，请查看输出。',
      errInstallTimeout: '依赖安装超时。',
      errBackup: '覆盖前备份失败，已中止同步。',
      errWrite: '写入本地文件失败。',
      errForbidden: '这个请求被 Harness 拒绝（来源不受信任或登录已过期）。',
      errRateLimited: 'GitHub API 限流，请稍后再试。',
      errInternal: '内部错误。',
      errUnknown: '未知错误。',
      enabled: '已开启',
      disabled: '已关闭',
      yes: '是',
      no: '否',
      tokenNone: '未设置',
      showToken: '显示令牌',
      hideToken: '隐藏令牌',
      restartHint: '重启 Harness 后，新插件才会被加载。',
      errNotConflicted: '这个文件不在冲突列表中，可能已经处理。',
      errBadRequest: '请求参数不正确。',
      warnings: '同步提示',
      warnTooLarge: '超过 5 MiB，已跳过',
      warnUnreadable: '无法读取，已跳过',
      warnSecret: '疑似密钥，已排除',
      warnUnmapped: '无法映射到本机路径',
      warnManifestRefused: '远端删除了插件清单，已自动恢复',
      warnPushRetry: '远端有新提交，已重试',
      warnInventory: '读取本机文件失败',
      warnRegister: '本地插件注册失败',
      warnOther: '已跳过',
      localPluginsRegistered: '已注册本地插件',
      localPluginsRestart: '插件源码已更新，重启 Harness 后生效。',
    }

    const en = {
      nav: 'Config Sync',
      title: 'Config Sync',
      subtitle: 'Share Harness configuration, plugins and plugin settings across machines through a private GitHub repository. Every category can be enabled separately.',
      statusIdle: 'Loading',
      statusNotConfigured: 'Not configured',
      statusGitMissing: 'Git missing',
      statusRunning: 'Syncing',
      statusSynced: 'Up to date',
      statusConflicts: 'Conflicts',
      statusFailed: 'Last run failed',
      statusNever: 'Ready for first sync',
      syncNow: 'Sync now',
      uploadOnly: 'Upload only',
      downloadOnly: 'Download only',
      syncing: 'Syncing…',
      repoCard: 'Repository',
      repoCardHint: 'The private repository holds configuration text only — never installed packages or dependencies.',
      repoUrl: 'Repository URL',
      repoUrlPlaceholder: 'https://github.com/you/harness-config',
      branch: 'Branch',
      branchPlaceholder: 'main',
      token: 'Access token',
      tokenPlaceholder: 'github_pat_… or ghp_…',
      tokenSaved: 'Token saved',
      tokenEnv: 'Token from environment',
      tokenHint: 'The token stays on this machine in $DSH_HOME/anywhere-sync/credentials.json (mode 0600). It is never committed and never returned to the page. The repo scope is required.',
      createToken: 'Create a GitHub token',
      saveConnect: 'Save and connect',
      testing: 'Connecting…',
      testConnection: 'Test connection',
      clearToken: 'Clear token',
      clearTokenConfirm: 'Clear the token saved on this machine? The repository itself is not changed.',
      connected: 'Connected',
      repoPrivate: 'Private',
      repoPublic: 'Public',
      repoWritable: 'Push access',
      repoReadOnly: 'Read-only token',
      repoDefaultBranch: 'Default branch',
      branchMissing: 'The remote has no such branch. Available:',
      useBranch: 'Use',
      itemsCard: 'Sync items',
      itemsCardHint: 'Only enabled items sync. Disabled items stay untouched on both sides.',
      itemPlugins: 'Plugin manifest',
      itemPluginsHint: 'package.json: installed plugins, versions and the bundle enable list; machine-local link:/file: specs are not published.',
      itemLocalPlugins: 'Local plugin source',
      itemLocalPluginsHint: 'Source of link:/file: installed plugins (this plugin included). Pulls write into the matching directory here; otherwise a managed copy is created and registered as a dependency (enable its bundle in the Plugins page if needed).',
      itemPluginConfig: 'Plugin configuration',
      itemPluginConfigHint: 'cordis.patch.yml: plugin parameters, model choice, UI preferences.',
      itemLock: 'Dependency lock',
      itemLockHint: 'pnpm-lock.yaml and pnpm-workspace.yaml for identical dependency versions; machine-local link:/file: blocks are not published.',
      itemProfileFiles: 'Other profile files',
      itemProfileFilesHint: 'Remaining profile files such as presets and config.toml. May contain credentials; off by default.',
      itemSkills: 'Skills',
      itemSkillsHint: '~/.agents/skills and .skill-lock.json, so every machine has the same skills.',
      filesCount: 'files',
      viewFiles: 'View files',
      hideFiles: 'Hide',
      noFiles: 'This item has no files yet.',
      secretWarning: 'Files that look like credentials are excluded automatically.',
      truncated: 'Too many files; showing the first 500.',
      autoCard: 'Automatic sync',
      autoCardHint: 'Automatic sync pulls and pushes in the background. A change made on one machine lands on the others at their next sync.',
      autoSync: 'Scheduled sync',
      autoSyncHint: 'Sync in the background on the interval below.',
      interval: 'Interval',
      everyMinutes: 'minutes',
      syncOnStartup: 'Sync on startup',
      syncOnStartupHint: 'Run one sync about 8 seconds after Harness starts.',
      autoInstall: 'Install dependencies after pull',
      autoInstallHint: 'Run the package manager in the profile when the plugin manifest or lock file changes.',
      conflictMode: 'Conflict handling',
      conflictRemote: 'Remote wins',
      conflictLocal: 'Local wins',
      conflictSkip: 'Keep conflicts for manual review',
      conflictHint: 'Used when the same file changed on two machines. It also applies the first time a configured machine joins an existing repository.',
      lastCard: 'Last sync',
      lastCardHint: 'Only the most recent run is shown.',
      neverSynced: 'No sync has run yet.',
      pulled: 'Pulled',
      pushed: 'Pushed',
      conflicts: 'Conflicts',
      commit: 'Commit',
      durationSec: 'Duration',
      backup: 'Backup',
      installPendingTitle: 'Plugin dependencies are not installed',
      installPendingHint: 'The plugin manifest or local plugin source was updated from the remote. Install dependencies and restart Harness to load the changes.',
      installNow: 'Install dependencies',
      installing: 'Installing…',
      installOk: 'Dependencies installed',
      installFailed: 'Dependency install failed',
      installOutput: 'Install output',
      conflictTitle: 'Conflicts to resolve',
      conflictHint: 'Both sides changed the same file. Pick the side to keep; the overwritten side is backed up first.',
      keepLocal: 'Keep local',
      keepRemote: 'Keep remote',
      notConnectedHint: 'Enter a repository URL and access token, then choose Save and connect. Create the repository first (private is recommended).',
      firstRunHint: 'When joining a machine that already has configuration, the default "Remote wins" merges this machine into the shared setup. Choose "Local wins" first if this machine should overwrite the remote.',
      errorTitle: 'Operation failed',
      retry: 'Retry',
      loading: 'Loading…',
      savedNotice: 'Settings saved.',
      connectedNotice: 'Connected.',
      syncStarted: 'Sync started; this page updates when it finishes.',
      installStarted: 'Dependency install started.',
      profileLabel: 'Profile',
      instanceLabel: 'Instance',
      repoPathLabel: 'Local mirror',
      skillsLabel: 'Skills directory',
      versionLabel: 'Version',
      errNoConfig: 'No repository URL is configured yet.',
      errGitMissing: 'git was not found. Install Git and make sure it is on PATH.',
      errAuth: 'The token is invalid or lacks access.',
      errTokenRequired: 'A token is required for a private repository.',
      errRepoNotFound: 'Repository not found, or the token cannot see it. Create the private repository on GitHub first.',
      errBranchMissing: 'The remote has no such branch.',
      errBadBranch: 'That branch name is not valid.',
      errBadRepoUrl: 'That repository URL is not valid.',
      errUnreachable: 'Cannot reach the remote repository. Check the network or the URL.',
      errPushRejected: 'The remote received a new commit during the sync. Try again.',
      errBusy: 'Another sync is already running.',
      errInstall: 'Dependency install failed; see the output.',
      errInstallTimeout: 'Dependency install timed out.',
      errBackup: 'Backup before overwrite failed, so the sync was stopped.',
      errWrite: 'Writing a local file failed.',
      errForbidden: 'Harness refused this request (untrusted origin or expired login).',
      errRateLimited: 'GitHub API rate limit reached. Try again later.',
      errInternal: 'Internal error.',
      errUnknown: 'Unknown error.',
      enabled: 'On',
      disabled: 'Off',
      yes: 'yes',
      no: 'no',
      tokenNone: 'not set',
      showToken: 'Show token',
      hideToken: 'Hide token',
      restartHint: 'New plugins load after Harness restarts.',
      errNotConflicted: 'This file is not in the conflict list; it may already be resolved.',
      errBadRequest: 'The request parameters are not valid.',
      warnings: 'Sync notices',
      warnTooLarge: 'larger than 5 MiB, skipped',
      warnUnreadable: 'unreadable, skipped',
      warnSecret: 'looks like a credential, excluded',
      warnUnmapped: 'cannot be mapped to a local path',
      warnManifestRefused: 'remote deleted the manifest; restored',
      warnPushRetry: 'remote moved; retried',
      warnInventory: 'cannot read local files',
      warnRegister: 'local plugin registration failed',
      warnOther: 'skipped',
      localPluginsRegistered: 'Local plugins registered',
      localPluginsRestart: 'Plugin source updated; restart Harness to apply it.',
    }

    const DICTS = { zh, en }

    const ERROR_KEYS = {
      'no-config': 'errNoConfig',
      'git-missing': 'errGitMissing',
      'auth-failed': 'errAuth',
      'auth-required': 'errAuth',
      'token-required': 'errTokenRequired',
      'repo-not-found': 'errRepoNotFound',
      'branch-missing': 'errBranchMissing',
      'bad-branch': 'errBadBranch',
      'bad-repo-url': 'errBadRepoUrl',
      'remote-unreachable': 'errUnreachable',
      'push-rejected': 'errPushRejected',
      'push-failed': 'errPushRejected',
      'busy': 'errBusy',
      'install-failed': 'errInstall',
      'install-timeout': 'errInstallTimeout',
      'backup-failed': 'errBackup',
      'write-failed': 'errWrite',
      'forbidden': 'errForbidden',
      'rate-limited': 'errRateLimited',
      'internal': 'errInternal',
      'bad-request': 'errBadRequest',
      'not-conflicted': 'errNotConflicted',
      'unmapped-path': 'errWrite',
      'read-truncated': 'errWrite',
      'install-busy': 'errBusy',
    }

    const WARNING_KEYS = {
      'too-large': 'warnTooLarge',
      unreadable: 'warnUnreadable',
      'secret-excluded': 'warnSecret',
      'unmapped-path': 'warnUnmapped',
      'manifest-delete-refused': 'warnManifestRefused',
      'push-rejected-retry': 'warnPushRetry',
      'inventory-failed': 'warnInventory',
      'local-plugin-register-failed': 'warnRegister',
    }

    const PHASE_KEYS = {
      fetching: 'statusRunning',
      comparing: 'statusRunning',
      applying: 'statusRunning',
      pushing: 'statusRunning',
      installing: 'installing',
      resolving: 'statusRunning',
    }

    // ------------------------------------------------------------------ api

    function apiPath(path) {
      const relative = `${API_PREFIX}${path}`.replace(/^\/+/, '')
      if (typeof document === 'undefined') return `/${relative}`
      // Keep the query string: /files?item=… is what carries the item key.
      const url = new URL(relative, document.baseURI)
      return `${url.pathname}${url.search}`
    }

    async function api(path, body) {
      const options = body === undefined
        ? { cache: 'no-store', credentials: 'same-origin' }
        : {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
      let response
      try {
        response = await fetch(apiPath(path), options)
      } catch (error) {
        throw new Error(`network: ${String(error?.message ?? error)}`)
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        const failure = payload?.error ?? {}
        const error = new Error(typeof failure.message === 'string' && failure.message !== '' ? failure.message : `HTTP ${response.status}`)
        error.code = typeof failure.code === 'string' ? failure.code : `http-${response.status}`
        error.details = failure.details
        throw error
      }
      return payload.value
    }

    // ------------------------------------------------------------- helpers

    function formatBytes(bytes) {
      const value = typeof bytes === 'number' ? bytes : 0
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
      return `${(value / (1024 * 1024)).toFixed(1)} MB`
    }

    function shortPath(path) {
      const value = String(path ?? '')
      return value.length > 64 ? `…${value.slice(-63)}` : value
    }

    function relativeTime(iso, lang) {
      if (typeof iso !== 'string' || iso === '') return null
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return null
      const seconds = Math.round((Date.now() - at) / 1000)
      const zhText = lang === 'zh'
      if (seconds < 60) return zhText ? '刚刚' : 'just now'
      if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60)
        return zhText ? `${minutes} 分钟前` : `${minutes} min ago`
      }
      if (seconds < 86_400) {
        const hours = Math.floor(seconds / 3600)
        return zhText ? `${hours} 小时前` : `${hours} h ago`
      }
      const days = Math.floor(seconds / 86_400)
      return zhText ? `${days} 天前` : `${days} d ago`
    }

    function absoluteTime(iso, lang) {
      if (typeof iso !== 'string' || iso === '') return ''
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return iso
      try {
        return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
      } catch {
        return new Date(at).toLocaleString()
      }
    }

    // ----------------------------------------------------------- components

    function Card(props) {
      return h('section', { className: 'as-card' },
        h('div', { className: 'as-card-head' },
          h('div', null,
            h('h3', { className: 'as-card-title' }, props.title),
            props.hint === undefined ? null : h('p', { className: 'as-card-hint' }, props.hint)),
          props.aside === undefined ? null : h('div', { className: 'as-card-aside' }, props.aside)),
        props.children)
    }

    function Toggle(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked === true,
        'aria-label': props.label,
        className: `as-switch${props.checked === true ? ' as-on' : ''}`,
        disabled: props.disabled === true || props.busy === true,
        onClick: () => props.onChange(props.checked !== true),
      }, h('span', { className: 'as-knob' }))
    }

    function Row(props) {
      return h('div', { className: `as-row${props.last === true ? ' as-last' : ''}` },
        h('div', { className: 'as-row-main' },
          h('div', { className: 'as-row-title' }, props.title),
          props.hint === undefined ? null : h('div', { className: 'as-row-hint' }, props.hint),
          props.extra === undefined ? null : props.extra),
        h('div', { className: 'as-row-side' }, props.side))
    }

    function Field(props) {
      return h('label', { className: 'as-field' },
        h('span', { className: 'as-label' }, props.label),
        props.children,
        props.hint === undefined ? null : h('span', { className: 'as-hint' }, props.hint))
    }

    function Empty(props) {
      return h('p', { className: 'as-empty' }, props.children)
    }

    /**
     * Locale snapshot that works on both React 17 and 18.
     *
     * The Harness client normally provides `getSnapshot` + `subscribe` (React
     * 18's useSyncExternalStore), but a different Harness generation may expose
     * only `getLocale`. A missing hook or method must never crash the whole
     * settings section into a blank page.
     */
    function useLocaleSnapshot(locale) {
      const read = React.useCallback(() => {
        try {
          if (locale !== null && typeof locale === 'object') {
            if (typeof locale.getSnapshot === 'function') return locale.getSnapshot()
            if (typeof locale.getLocale === 'function') return locale.getLocale()
          }
        } catch (error) {
          try {
            console.warn('[anywhere-sync] locale snapshot failed', error)
          } catch {
            // Console may be unavailable.
          }
        }
        return { active: 'en' }
      }, [locale])
      const [snapshot, setSnapshot] = React.useState(read)
      React.useEffect(() => {
        if (locale === null || typeof locale !== 'object' || typeof locale.subscribe !== 'function') return undefined
        let unsubscribe
        try {
          unsubscribe = locale.subscribe(() => setSnapshot(read()))
        } catch (error) {
          try {
            console.warn('[anywhere-sync] locale subscribe failed', error)
          } catch {
            // Console may be unavailable.
          }
          return undefined
        }
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, [locale, read])
      return snapshot
    }

    function Section(props) {
      const locale = props.locale
      const localeSnap = useLocaleSnapshot(locale)
      const language = String(localeSnap?.active ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      const tr = React.useCallback((key) => DICTS[language][key] ?? DICTS.en[key] ?? key, [language])
      const errorText = React.useCallback((failure) => {
        const key = ERROR_KEYS[failure?.code]
        const headline = key === undefined ? tr('errUnknown') : tr(key)
        const detail = typeof failure?.message === 'string' ? failure.message : ''
        return detail === '' || detail === headline ? headline : `${headline}（${detail}）`
      }, [tr])

      const [status, setStatus] = React.useState(null)
      const [loadFailure, setLoadFailure] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [repoInput, setRepoInput] = React.useState('')
      const [branchInput, setBranchInput] = React.useState('main')
      const [tokenInput, setTokenInput] = React.useState('')
      const [tokenDirty, setTokenDirty] = React.useState(false)
      const [showToken, setShowToken] = React.useState(false)
      const [formReady, setFormReady] = React.useState(false)
      const [openItem, setOpenItem] = React.useState(null)
      const [fileList, setFileList] = React.useState(null)
      const [connection, setConnection] = React.useState(null)
      const fileRequest = React.useRef(0)

      const refresh = React.useCallback(async () => {
        try {
          const value = await api('/status')
          setStatus(value)
          setLoadFailure(null)
        } catch (error) {
          setLoadFailure({ code: error.code ?? 'internal', message: error.message })
        }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        let timer = null
        const tick = async () => {
          if (cancelled) return
          await refresh()
          if (!cancelled) timer = window.setTimeout(tick, POLL_MS)
        }
        void tick()
        return () => {
          cancelled = true
          if (timer !== null) window.clearTimeout(timer)
        }
      }, [refresh])

      // A success notice is transient; an error stays until the next action.
      React.useEffect(() => {
        if (notice === null || notice.tone !== 'ok' || Array.isArray(notice.branches)) return undefined
        const timer = window.setTimeout(() => setNotice(null), 5000)
        return () => window.clearTimeout(timer)
      }, [notice])

      // Fill the form once. A poll must never overwrite what the user is typing.
      React.useEffect(() => {
        if (status === null || formReady) return
        setRepoInput(status.repoUrl ?? '')
        setBranchInput(status.branch ?? 'main')
        setFormReady(true)
      }, [status, formReady])

      const commitSettings = React.useCallback(async (patch, successKey) => {
        setBusy('settings')
        setNotice(null)
        try {
          const value = await api('/config', patch)
          setStatus(value)
          if (typeof patch.repoUrl === 'string') setRepoInput(value.repoUrl ?? '')
          if (typeof patch.branch === 'string') setBranchInput(value.branch ?? 'main')
          if (successKey !== undefined) setNotice({ tone: 'ok', text: tr(successKey) })
          return value
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(error) })
          return null
        } finally {
          setBusy(null)
        }
      }, [errorText, tr])

      const saveAndConnect = React.useCallback(async () => {
        if (busy !== null) return
        setBusy('connect')
        setNotice(null)
        try {
          const targetBranch = branchInput.trim() !== '' ? branchInput.trim() : (status.branch || 'main')
          const info = await api('/connect', {
            repoUrl: repoInput,
            branch: targetBranch,
            ...(tokenDirty && tokenInput.trim() !== '' ? { token: tokenInput.trim() } : {}),
          })
          setConnection(info)
          if (info.branchExists === false && info.emptyRemote !== true) {
            setNotice({
              tone: 'warn',
              text: `${tr('branchMissing')} ${info.branches.join(', ') || '—'}`,
              branches: info.branches,
            })
            return
          }
          const value = await api('/config', {
            repoUrl: info.repoUrl,
            branch: info.branch,
            ...(tokenDirty && tokenInput.trim() !== '' ? { token: tokenInput.trim() } : {}),
          })
          setStatus(value)
          setRepoInput(value.repoUrl ?? '')
          setBranchInput(value.branch ?? 'main')
          setTokenInput('')
          setTokenDirty(false)
          setNotice({ tone: 'ok', text: `${tr('connectedNotice')} ${info.github?.fullName ?? info.repoUrl}` })
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(error) })
        } finally {
          setBusy(null)
        }
      }, [branchInput, busy, errorText, repoInput, status, tokenDirty, tokenInput, tr])

      const testConnection = React.useCallback(async () => {
        if (busy !== null) return
        setBusy('connect')
        setNotice(null)
        try {
          const targetBranch = branchInput.trim() !== '' ? branchInput.trim() : (status.branch || 'main')
          const info = await api('/connect', {
            repoUrl: repoInput,
            branch: targetBranch,
            ...(tokenDirty && tokenInput.trim() !== '' ? { token: tokenInput.trim() } : {}),
          })
          setConnection(info)
          setNotice({
            tone: info.branchExists === false && info.emptyRemote !== true ? 'warn' : 'ok',
            text: info.branchExists === false && info.emptyRemote !== true
              ? `${tr('branchMissing')} ${info.branches.join(', ') || '—'}`
              : tr('connectedNotice'),
          })
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(error) })
        } finally {
          setBusy(null)
        }
      }, [branchInput, busy, errorText, repoInput, status, tokenDirty, tokenInput, tr])

      const startSync = React.useCallback(async (mode) => {
        if (busy !== null) return
        setBusy('sync')
        setNotice(null)
        try {
          await api('/sync', { mode })
          setNotice({ tone: 'ok', text: tr('syncStarted') })
          await refresh()
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(error) })
        } finally {
          setBusy(null)
        }
      }, [busy, errorText, refresh, tr])

      const resolveConflict = React.useCallback(async (path, side) => {
        if (busy !== null) return
        setBusy(`resolve:${path}`)
        setNotice(null)
        try {
          await api('/resolve', { path, side })
          setNotice({ tone: 'ok', text: `${tr('savedNotice')} ${shortPath(path)}` })
          await refresh()
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(error) })
        } finally {
          setBusy(null)
        }
      }, [busy, errorText, refresh, tr])

      const installDependencies = React.useCallback(async () => {
        if (busy !== null) return
        setBusy('install')
        setNotice({ tone: 'ok', text: tr('installStarted') })
        try {
          const result = await api('/install', {})
          if (result?.ok === true) setNotice({ tone: 'ok', text: tr('installOk') })
          else setNotice({ tone: 'error', text: `${tr('installFailed')}${result?.output ? `: ${result.output.slice(-400)}` : ''}` })
          await refresh()
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(error) })
        } finally {
          setBusy(null)
        }
      }, [busy, errorText, refresh, tr])

      const clearToken = React.useCallback(async () => {
        if (busy !== null) return
        setBusy('token')
        setNotice(null)
        try {
          const value = await api('/config', { clearToken: true })
          setStatus(value)
          setTokenInput('')
          setTokenDirty(false)
          setNotice({ tone: 'ok', text: tr('savedNotice') })
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(error) })
        } finally {
          setBusy(null)
        }
      }, [busy, errorText, tr])

      const toggleItem = React.useCallback(async (item) => {
        await commitSettings({ items: { [item.id]: item.enabled !== true } })
        setOpenItem(null)
        setFileList(null)
      }, [commitSettings])

      const toggleFileList = React.useCallback(async (item) => {
        if (openItem === item.id) {
          fileRequest.current += 1
          setOpenItem(null)
          setFileList(null)
          return
        }
        const request = fileRequest.current + 1
        fileRequest.current = request
        setOpenItem(item.id)
        setFileList(null)
        try {
          const value = await api(`/files?item=${encodeURIComponent(item.id)}`)
          if (fileRequest.current === request) setFileList(value)
        } catch (error) {
          if (fileRequest.current !== request) return
          setNotice({ tone: 'error', text: errorText(error) })
        }
      }, [errorText, openItem])

      if (loadFailure !== null && status === null) {
        return h('section', { className: 'as-root' },
          h('style', null, CSS),
          h('div', { className: 'as-body' },
            h('div', { className: 'as-banner as-error', role: 'alert' }, errorText(loadFailure)),
            h('button', { type: 'button', className: 'as-btn', onClick: () => { void refresh() } }, tr('retry'))))
      }

      if (status === null) {
        return h('section', { className: 'as-root' },
          h('style', null, CSS),
          h('div', { className: 'as-body' }, h(Empty, null, tr('loading'))))
      }

      const running = status.running === true || busy === 'sync'
      const configured = status.repoConfigured === true
      const conflicts = Array.isArray(status.conflicts) ? status.conflicts : []
      const lastResult = status.lastResult
      const lastError = lastResult?.error ?? null
      const phase = status.phase ?? null
      const github = status.github ?? (connection?.github ?? null)
      const statusTone = !status.gitReady
        ? 'error'
        : !configured
          ? 'idle'
          : running
            ? 'busy'
            : lastError
              ? 'error'
              : conflicts.length > 0
                ? 'warn'
                : status.lastSyncAt
                  ? 'ok'
                  : 'idle'
      const statusLabel = !status.gitReady
        ? tr('statusGitMissing')
        : !configured
          ? tr('statusNotConfigured')
          : running
            ? (phase !== null && PHASE_KEYS[phase] !== undefined ? tr(PHASE_KEYS[phase]) : tr('statusRunning'))
            : lastError
              ? tr('statusFailed')
              : conflicts.length > 0
                ? tr('statusConflicts')
                : status.lastSyncAt
                  ? tr('statusSynced')
                  : tr('statusNever')

      const items = Array.isArray(status.items) ? status.items : []
      const itemMeta = {
        plugins: ['itemPlugins', 'itemPluginsHint'],
        localPlugins: ['itemLocalPlugins', 'itemLocalPluginsHint'],
        pluginConfig: ['itemPluginConfig', 'itemPluginConfigHint'],
        lock: ['itemLock', 'itemLockHint'],
        profileFiles: ['itemProfileFiles', 'itemProfileFilesHint'],
        skills: ['itemSkills', 'itemSkillsHint'],
      }

      return h('section', { className: 'as-root' },
        h('style', null, CSS),
        h('header', { className: 'as-head' },
          h('div', { className: 'as-title-row' },
            h('h2', { className: 'as-title' }, tr('title')),
            h('span', { className: `as-pill as-${statusTone}`, 'aria-live': 'polite' },
              h('span', { className: 'as-dot' }),
              statusLabel)),
          h('p', { className: 'as-sub' }, tr('subtitle')),
          h('div', { className: 'as-actions' },
            h('button', {
              type: 'button',
              className: 'as-btn as-primary',
              disabled: !configured || running || busy !== null || status.gitReady !== true,
              onClick: () => { void startSync('both') },
            }, running ? tr('syncing') : tr('syncNow')),
            h('button', {
              type: 'button',
              className: 'as-btn',
              disabled: !configured || running || busy !== null || status.gitReady !== true,
              onClick: () => { void startSync('push') },
            }, tr('uploadOnly')),
            h('button', {
              type: 'button',
              className: 'as-btn',
              disabled: !configured || running || busy !== null || status.gitReady !== true,
              onClick: () => { void startSync('pull') },
              }, tr('downloadOnly')))),
        h('div', { className: 'as-body' },
          loadFailure !== null
            ? h('div', { className: 'as-banner as-error', role: 'alert' }, errorText(loadFailure))
            : null,
          notice === null
            ? null
            : h('div', {
                className: `as-banner ${notice.tone === 'error' ? 'as-error' : notice.tone === 'warn' ? 'as-warn' : 'as-ok'}`,
                role: notice.tone === 'error' ? 'alert' : 'status',
              },
              h('span', { className: 'as-banner-text' }, notice.text),
              Array.isArray(notice.branches) && notice.branches.length > 0
                ? h('span', { className: 'as-banner-actions' },
                    notice.branches.slice(0, 6).map(branch => h('button', {
                      key: branch,
                      type: 'button',
                      className: 'as-btn as-btn-sm',
                      onClick: () => {
                        setBranchInput(branch)
                        setNotice(null)
                      },
                    }, `${tr('useBranch')} ${branch}`)))
                : null),

          !configured
            ? h('div', { className: 'as-banner as-info' },
                h('div', { className: 'as-banner-text' }, tr('notConnectedHint')),
                h('div', { className: 'as-banner-sub' }, tr('firstRunHint')))
            : null,

          h(Card, { title: tr('repoCard'), hint: tr('repoCardHint') },
            h('div', { className: 'as-grid' },
              h(Field, { label: tr('repoUrl') },
                h('input', {
                  className: 'as-input',
                  value: repoInput,
                  placeholder: tr('repoUrlPlaceholder'),
                  spellCheck: false,
                  autoComplete: 'off',
                  onChange: (event) => setRepoInput(event.target.value),
                })),
              h(Field, { label: tr('branch') },
                h('input', {
                  className: 'as-input',
                  value: branchInput,
                  placeholder: tr('branchPlaceholder'),
                  spellCheck: false,
                  autoComplete: 'off',
                  onChange: (event) => setBranchInput(event.target.value),
                }))),
            h('div', { className: 'as-grid' },
              h(Field, {
                label: tr('token'),
                hint: status.tokenSet
                  ? (status.tokenSource === 'env' ? tr('tokenEnv') : tr('tokenSaved'))
                  : undefined,
              },
                h('div', { className: 'as-token-row' },
                  h('input', {
                    className: 'as-input as-mono',
                    type: showToken ? 'text' : 'password',
                    value: tokenInput,
                    placeholder: status.tokenSet ? '••••••••••••' : tr('tokenPlaceholder'),
                    spellCheck: false,
                    autoComplete: 'off',
                    onChange: (event) => {
                      setTokenInput(event.target.value)
                      setTokenDirty(true)
                    },
                  }),
                  h('button', {
                    type: 'button',
                    className: 'as-btn as-btn-sm',
                    'aria-label': showToken ? tr('hideToken') : tr('showToken'),
                    title: showToken ? tr('hideToken') : tr('showToken'),
                    onClick: () => setShowToken(value => !value),
                  }, showToken ? '•••' : '👁'))),
              h('div', { className: 'as-token-side' },
                h('a', {
                  className: 'as-link',
                  href: 'https://github.com/settings/tokens/new?scopes=repo&description=DeepSeek%20Harness%20Config%20Sync',
                  target: '_blank',
                  rel: 'noreferrer noopener',
                }, tr('createToken')),
                status.tokenSet && status.tokenSource === 'file'
                  ? h('button', {
                      type: 'button',
                      className: 'as-link as-link-button',
                      disabled: busy !== null,
                      onClick: () => { if (window.confirm(tr('clearTokenConfirm'))) void clearToken() },
                    }, tr('clearToken'))
                  : null)),
            h('p', { className: 'as-hint as-hint-wide' }, tr('tokenHint')),
            h('div', { className: 'as-actions as-actions-tight' },
              h('button', {
                type: 'button',
                className: 'as-btn as-primary',
                disabled: busy !== null || repoInput.trim() === '',
                onClick: () => { void saveAndConnect() },
              }, busy === 'connect' ? tr('testing') : tr('saveConnect')),
              h('button', {
                type: 'button',
                className: 'as-btn',
                disabled: busy !== null || repoInput.trim() === '',
                onClick: () => { void testConnection() },
              }, tr('testConnection')),
              github !== null
                ? h('span', { className: 'as-meta' },
                    `${github.fullName} · ${github.private ? tr('repoPrivate') : tr('repoPublic')} · ${github.canPush ? tr('repoWritable') : tr('repoReadOnly')}`)
                : (status.repoUrl !== '' ? h('span', { className: 'as-meta' }, `${status.repoUrl} · ${status.branch}`) : null))),

          h(Card, { title: tr('itemsCard'), hint: tr('itemsCardHint') },
            items.map((item, index) => {
              const meta = itemMeta[item.id] ?? [item.id, undefined]
              return h('div', { key: item.id, className: 'as-item-block' },
                h(Row, {
                  last: index === items.length - 1 && openItem !== item.id,
                  title: h('span', { className: 'as-row-heading' },
                    h('span', null, tr(meta[0])),
                    h('span', { className: 'as-count' },
                      `${item.count} ${tr('filesCount')} · ${formatBytes(item.bytes)}`)),
                  hint: tr(meta[1] ?? ''),
                  extra: h('div', { className: 'as-item-actions' },
                    item.secretRisk === true
                      ? h('span', { className: 'as-tag as-tag-warn' }, tr('secretWarning'))
                      : null,
                    h('button', {
                      type: 'button',
                      className: 'as-link as-link-button',
                      onClick: () => { void toggleFileList(item) },
                    }, openItem === item.id ? tr('hideFiles') : tr('viewFiles'))),
                  side: h(Toggle, {
                    checked: item.enabled === true,
                    label: tr(meta[0]),
                    disabled: busy !== null,
                    onChange: () => { void toggleItem(item) },
                  }),
                }),
                openItem === item.id
                  ? h('div', { className: 'as-files' },
                      fileList === null
                        ? h('p', { className: 'as-empty' }, tr('loading'))
                        : fileList.files.length === 0
                          ? h('p', { className: 'as-empty' }, tr('noFiles'))
                          : h('ul', { className: 'as-file-list' },
                              fileList.files.map(file => h('li', { key: file.path, className: 'as-file' },
                                h('code', { className: 'as-file-path' }, shortPath(file.path)),
                                h('span', { className: 'as-file-size' }, formatBytes(file.size))))),
                      fileList !== null && fileList.truncated === true
                        ? h('p', { className: 'as-empty' }, tr('truncated'))
                        : null)
                  : null)
            })),

          h(Card, { title: tr('autoCard'), hint: tr('autoCardHint') },
            h(Row, {
              title: tr('autoSync'),
              hint: tr('autoSyncHint'),
              side: h('div', { className: 'as-inline' },
                h('select', {
                  className: 'as-select',
                  value: String(status.intervalMinutes ?? 15),
                  disabled: busy !== null || status.autoSync !== true,
                  onChange: (event) => { void commitSettings({ intervalMinutes: Number(event.target.value) }) },
                }, [5, 15, 30, 60, 120].map(minutes => h('option', { key: minutes, value: String(minutes) }, `${minutes} ${tr('everyMinutes')}`))),
                h(Toggle, {
                  checked: status.autoSync === true,
                  label: tr('autoSync'),
                  disabled: busy !== null,
                  onChange: (value) => { void commitSettings({ autoSync: value }) },
                })),
            }),
            h(Row, {
              title: tr('syncOnStartup'),
              hint: tr('syncOnStartupHint'),
              side: h(Toggle, {
                checked: status.syncOnStartup === true,
                label: tr('syncOnStartup'),
                disabled: busy !== null,
                onChange: (value) => { void commitSettings({ syncOnStartup: value }) },
              }),
            }),
            h(Row, {
              title: tr('autoInstall'),
              hint: tr('autoInstallHint'),
              side: h(Toggle, {
                checked: status.autoInstall === true,
                label: tr('autoInstall'),
                disabled: busy !== null,
                onChange: (value) => { void commitSettings({ autoInstall: value }) },
              }),
            }),
            h(Row, {
              last: true,
              title: tr('conflictMode'),
              hint: tr('conflictHint'),
              side: h('select', {
                className: 'as-select',
                value: status.conflictMode ?? 'remote',
                disabled: busy !== null,
                onChange: (event) => { void commitSettings({ conflictMode: event.target.value }) },
              },
                h('option', { value: 'remote' }, tr('conflictRemote')),
                h('option', { value: 'local' }, tr('conflictLocal')),
                h('option', { value: 'skip' }, tr('conflictSkip'))),
            })),

          h(Card, { title: tr('lastCard'), hint: tr('lastCardHint') },
            lastResult === null
              ? h(Empty, null, tr('neverSynced'))
              : h('div', null,
                  lastError !== null
                    ? h('div', { className: 'as-banner as-error', role: 'alert' }, errorText(lastError))
                    : h('div', { className: 'as-stats' },
                        h('span', { className: 'as-stat' }, h('b', null, String(lastResult.pulledTotal ?? lastResult.pulled?.length ?? 0)), ` ${tr('pulled')}`),
                        h('span', { className: 'as-stat' }, h('b', null, String(lastResult.pushedTotal ?? lastResult.pushed?.length ?? 0)), ` ${tr('pushed')}`),
                        h('span', { className: 'as-stat' }, h('b', null, String(lastResult.conflicts?.length ?? 0)), ` ${tr('conflicts')}`),
                        h('span', { className: 'as-stat' }, h('b', null, `${Math.max(0, Math.round((lastResult.durationMs ?? 0) / 100) / 10)}s`), ` ${tr('durationSec')}`),
                        typeof lastResult.commit === 'string'
                          ? h('span', { className: 'as-stat as-mono' }, `${tr('commit')} ${lastResult.commit.slice(0, 8)}`)
                          : null,
                        typeof lastResult.backup === 'string'
                          ? h('span', { className: 'as-stat' }, `${tr('backup')} ${lastResult.backup}`)
                          : null),
                  h('div', { className: 'as-timestamps' },
                    h('span', null, absoluteTime(lastResult.at, language)),
                    relativeTime(lastResult.at, language) === null ? null : h('span', null, `· ${relativeTime(lastResult.at, language)}`),
                    lastResult.pulled?.length > 0
                      ? h('details', { className: 'as-details' },
                          h('summary', null, tr('pulled')),
                          h('ul', { className: 'as-file-list' },
                            lastResult.pulled.slice(0, 50).map(entry => h('li', { key: `p-${entry.path}`, className: 'as-file' },
                              h('code', { className: 'as-file-path' }, shortPath(entry.path)),
                              h('span', { className: 'as-file-size' }, entry.action === 'delete' ? '−' : formatBytes(entry.size))))))
                      : null,
                    lastResult.pushed?.length > 0
                      ? h('details', { className: 'as-details' },
                          h('summary', null, tr('pushed')),
                          h('ul', { className: 'as-file-list' },
                            lastResult.pushed.slice(0, 50).map(entry => h('li', { key: `u-${entry.path}`, className: 'as-file' },
                              h('code', { className: 'as-file-path' }, shortPath(entry.path)),
                              h('span', { className: 'as-file-size' }, entry.action === 'delete' ? '−' : formatBytes(entry.size))))))
                      : null)),
            Array.isArray(lastResult?.localPluginsRegistered) && lastResult.localPluginsRegistered.length > 0
              ? h('div', { className: 'as-banner as-ok' },
                  h('div', { className: 'as-banner-text' },
                    h('b', null, tr('localPluginsRegistered')),
                    h('div', { className: 'as-banner-sub' }, lastResult.localPluginsRegistered.join(', ')),
                    h('div', { className: 'as-banner-sub' }, tr('localPluginsRestart'))))
              : null,
            status.pendingInstall === true
              ? h('div', { className: 'as-banner as-warn' },
                  h('div', { className: 'as-banner-text' },
                    h('b', null, tr('installPendingTitle')),
                    h('div', { className: 'as-banner-sub' }, tr('installPendingHint'))),
                  h('button', {
                    type: 'button',
                    className: 'as-btn as-primary',
                    disabled: busy !== null || running,
                    onClick: () => { void installDependencies() },
                  }, busy === 'install' || phase === 'installing' ? tr('installing') : tr('installNow')))
              : null,
            lastResult?.install !== undefined && lastResult.install !== null
              ? h('div', { className: `as-banner ${lastResult.install.ok === true ? 'as-ok' : 'as-error'}` },
                  h('div', { className: 'as-banner-text' },
                    h('b', null, lastResult.install.ok === true ? tr('installOk') : tr('installFailed')),
                    lastResult.install.ok === true
                      ? h('div', { className: 'as-banner-sub' }, tr('restartHint'))
                      : null,
                    lastResult.install.output
                      ? h('details', { className: 'as-details' },
                          h('summary', null, tr('installOutput')),
                          h('pre', { className: 'as-pre' }, String(lastResult.install.output).slice(-2000)))
                      : null))
              : null,
            conflicts.length > 0
              ? h('div', { className: 'as-conflicts' },
                  h('h4', { className: 'as-conflict-title' }, tr('conflictTitle')),
                  h('p', { className: 'as-hint' }, tr('conflictHint')),
                  conflicts.map(conflict => h('div', { key: conflict.path, className: 'as-conflict' },
                    h('code', { className: 'as-file-path' }, conflict.path),
                    h('div', { className: 'as-conflict-actions' },
                      h('button', {
                        type: 'button',
                        className: 'as-btn as-btn-sm',
                        disabled: busy !== null || running,
                        onClick: () => { void resolveConflict(conflict.path, 'local') },
                      }, tr('keepLocal')),
                      h('button', {
                        type: 'button',
                        className: 'as-btn as-btn-sm',
                        disabled: busy !== null || running,
                        onClick: () => { void resolveConflict(conflict.path, 'remote') },
                      }, tr('keepRemote'))))))
              : null),

          status.warnings !== undefined && status.warnings.length > 0
            ? h('details', { className: 'as-warnings' },
                h('summary', null, `${tr('warnings')} (${status.warningTotal ?? status.warnings.length})`),
                h('ul', { className: 'as-file-list' },
                  status.warnings.map((warning, index) => h('li', { key: `w-${index}`, className: 'as-file', title: warning.message ?? '' },
                    h('code', { className: 'as-file-path' }, shortPath(warning.repoPath || '—')),
                    h('span', { className: 'as-file-size' }, tr(WARNING_KEYS[warning.reason] ?? 'warnOther'))))))
            : null,

          h('footer', { className: 'as-footer' },
            h('span', null, `${tr('profileLabel')}: ${status.profile}`),
            h('span', null, `${tr('instanceLabel')}: ${status.instanceId}`),
            h('span', { className: 'as-mono' }, `${tr('repoPathLabel')}: ${status.dshHome}/anywhere-sync/repo`),
            h('span', { className: 'as-mono' }, `${tr('skillsLabel')}: ${status.skillsRoot}`))))
    }

    // --------------------------------------------------------------- styles

    const CSS = `
.as-root{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;line-height:20px}
.as-root *{box-sizing:border-box}
.as-head{display:flex;flex-direction:column;gap:6px;padding:0 4px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#e6e8eb);margin-bottom:10px}
.as-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.as-title{margin:0;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328)}
.as-sub{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5c6570);max-width:760px}
.as-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
.as-actions-tight{margin-top:10px}
.as-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 4px 48px;display:flex;flex-direction:column;gap:12px}
.as-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);border:1px solid var(--dsw-alias-border-l1,#e6e8eb);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#5c6570);white-space:nowrap}
.as-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#9aa1ab);flex:none}
.as-pill.as-ok .as-dot{background:var(--dsw-alias-state-success-primary,#18a058)}
.as-pill.as-warn .as-dot{background:var(--dsw-alias-state-warn-primary,#d98f00)}
.as-pill.as-error .as-dot{background:var(--dsw-alias-state-error-primary,#d03050)}
.as-pill.as-busy .as-dot{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4f7cff));animation:as-pulse 1.2s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.as-pill.as-busy .as-dot{animation:none}}
@keyframes as-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.as-card{border:1px solid var(--dsw-alias-border-l1,#e6e8eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;padding:14px 14px 6px;min-width:0}
.as-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px}
.as-card-title{margin:0;font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328)}
.as-card-hint{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5c6570);max-width:640px}
.as-card-aside{flex:none}
.as-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#e6e8eb)}
.as-row.as-last{border-bottom:none}
.as-row-main{min-width:0;flex:1}
.as-row-title{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2328)}
.as-row-heading{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.as-row-hint{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5c6570)}
.as-row-side{flex:none;display:flex;align-items:center;gap:8px;padding-top:1px}
.as-count{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#5c6570);background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:999px;padding:0 7px;white-space:nowrap}
.as-item-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}
.as-tag{font-size:11px;line-height:16px;border-radius:4px;padding:0 5px;white-space:nowrap}
.as-tag-warn{color:var(--dsw-alias-state-warn-primary,#d98f00);border:1px solid var(--dsw-alias-state-warn-primary,#d98f00)}
.as-item-block{min-width:0}
.as-files{border:1px dashed var(--dsw-alias-border-l1,#e6e8eb);border-radius:8px;padding:8px 10px;margin:0 0 11px;background:var(--dsw-alias-bg-layer-2,#fafafa);max-height:260px;overflow:auto}
.as-file-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.as-file{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:11px;line-height:17px}
.as-file-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary,#5c6570);overflow-wrap:anywhere;min-width:0}
.as-file-size{flex:none;color:var(--dsw-alias-label-secondary,#5c6570);font-size:11px}
.as-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-bottom:10px}
@media (max-width:640px){.as-grid{grid-template-columns:minmax(0,1fr)}}
.as-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.as-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5c6570)}
.as-input{width:100%;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d5d9de);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font:inherit;font-size:12px;outline:none}
.as-input:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#4f7cff));box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#4f7cff)) 22%, transparent)}
.as-input::placeholder{color:var(--dsw-alias-label-secondary,#5c6570);opacity:.7}
.as-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.as-token-row{display:flex;align-items:center;gap:8px}
.as-token-side{display:flex;align-items:flex-end;justify-content:flex-end;gap:12px;flex-wrap:wrap}
.as-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d5d9de);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.as-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-color:var(--dsw-alias-border-l2,#c9ced6)}
.as-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#4f7cff));outline-offset:2px}
.as-btn:disabled{opacity:.45;cursor:default}
.as-btn-sm{height:26px;padding:0 9px;font-size:11px;border-radius:6px}
.as-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4f7cff));border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4f7cff));color:var(--dsw-alias-label-primary-foreground,#fff)}
.as-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4f7cff)));border-color:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4f7cff)));color:var(--dsw-alias-label-primary-foreground,#fff);filter:none}
.as-link{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#4f7cff));font-size:12px;line-height:18px;text-decoration:none;background:none;border:none;padding:0;cursor:pointer;font-family:inherit}
.as-link:hover{text-decoration:underline}
.as-link-button{display:inline-flex;align-items:center}
.as-link-button:disabled{opacity:.45;cursor:default;text-decoration:none}
.as-hint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#5c6570)}
.as-hint-wide{margin:0 0 6px;max-width:720px}
.as-meta{font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#5c6570);overflow-wrap:anywhere}
.as-switch{position:relative;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d5d9de);background:var(--dsw-alias-bg-layer-2,#e9ecf1);padding:0;cursor:pointer;flex:none;transition:background-color 120ms ease,border-color 120ms ease}
.as-switch .as-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform 120ms ease}
.as-switch.as-on{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4f7cff));border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4f7cff))}
.as-switch.as-on .as-knob{background:var(--dsw-alias-label-primary-foreground,#fff);transform:translateX(14px)}
.as-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#4f7cff));outline-offset:2px}
.as-switch:disabled{opacity:.45;cursor:default}
.as-select{height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d5d9de);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font:inherit;font-size:12px;max-width:220px}
.as-select:disabled{opacity:.45}
.as-inline{display:flex;align-items:center;gap:8px}
.as-banner{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;border-radius:8px;padding:9px 11px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l1,#e6e8eb);background:var(--dsw-alias-bg-layer-2,#f5f6f8);color:var(--dsw-alias-label-primary,#1f2328)}
.as-banner-text{min-width:0;flex:1}
.as-banner-sub{font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#5c6570);margin-top:2px}
.as-banner-actions{display:flex;gap:6px;flex-wrap:wrap}
.as-error{border-color:var(--dsw-alias-state-error-primary,#d03050)}
.as-error .as-banner-text,.as-error{color:var(--dsw-alias-state-error-primary,#d03050)}
.as-warn{border-color:var(--dsw-alias-state-warn-primary,#d98f00)}
.as-ok{border-color:var(--dsw-alias-state-success-primary,#18a058)}
.as-info{border-style:dashed}
.as-stats{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 6px}
.as-stat{display:inline-flex;align-items:baseline;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5c6570);background:var(--dsw-alias-bg-layer-2,#f5f6f8);border-radius:6px;padding:2px 8px}
.as-stat b{color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}
.as-timestamps{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#5c6570);margin-bottom:4px}
.as-details{display:inline-block}
.as-details summary{cursor:pointer;color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#4f7cff));font-size:11px;line-height:17px;list-style:none}
.as-details summary::-webkit-details-marker{display:none}
.as-details summary:hover{text-decoration:underline}
.as-details[open] summary{margin-bottom:4px}
.as-pre{max-height:220px;overflow:auto;background:var(--dsw-alias-bg-layer-2,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,#e6e8eb);border-radius:6px;padding:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,#5c6570);margin:4px 0 0}
.as-conflicts{border-top:1px solid var(--dsw-alias-border-l1,#e6e8eb);margin-top:10px;padding-top:10px}
.as-conflict-title{margin:0 0 2px;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-state-warn-primary,#d98f00)}
.as-conflict{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#e6e8eb)}
.as-conflict:last-child{border-bottom:none}
.as-conflict-actions{display:flex;gap:6px;flex:none}
.as-empty{margin:8px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5c6570)}
.as-warnings{border:1px solid var(--dsw-alias-border-l1,#e6e8eb);border-radius:8px;padding:8px 11px;background:var(--dsw-alias-bg-layer-2,#fafafa);font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#5c6570)}
.as-warnings summary{cursor:pointer;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#5c6570)}
.as-warnings[open] summary{margin-bottom:4px}
.as-footer{display:flex;flex-wrap:wrap;gap:6px 14px;padding:2px 2px 8px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#5c6570);overflow-wrap:anywhere}
`

    /**
     * Keep a rendering failure inside the settings page instead of leaving the
     * section blank. The fallback is intentionally plain and bilingual so the
     * user can report the exact error even when the normal UI cannot render.
     */
    class SectionBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        try {
          console.error('[anywhere-sync] settings section crashed', error, info)
        } catch {
          // Console may be unavailable.
        }
      }

      render() {
        if (this.state.error === null) return this.props.children
        const message = String(this.state.error?.message ?? this.state.error)
        const stack = String(this.state.error?.stack ?? '')
        return h('section', { className: 'as-root' },
          h('style', null, CSS),
          h('div', { className: 'as-body' },
            h('div', { className: 'as-banner as-error', role: 'alert' },
              h('div', { className: 'as-banner-text' },
                h('b', null, 'Anywhere Sync 设置页渲染失败 / failed to render'),
                h('div', { className: 'as-banner-sub' }, message))),
            h('pre', { className: 'as-pre' }, stack),
            h('p', { className: 'as-empty' }, '请把上面的错误和浏览器控制台内容发给插件维护者。 / Send this error and the browser console to the maintainer.')))
      }
    }

    // ---------------------------------------------------------------- setup

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          console.info('[anywhere-sync] settings client 1.2.3 loaded')
        } catch {
          // Console may be unavailable.
        }
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'anywhere-sync: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'anywhere-sync',
          order: 45,
          label: () => t('nav'),
          locale: NS,
        }, (ownerProps) => h(SectionBoundary, null, h(Section, {
          close: ownerProps?.close,
          locale: ctx.locale,
        })))), 'anywhere-sync: settings section')
      },
    }
  },
})
