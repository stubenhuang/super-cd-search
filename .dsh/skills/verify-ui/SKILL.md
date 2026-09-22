---
name: verify-ui
description: "Super CD Search 的 UI 冒烟测试(playwright-core + 真实 Electron 跑 scripts/verify-ui.mjs,npm run verify:ui)。触发时机:git 提交界面代码【之前】——只要待提交改动(diff/staged files)涉及 src/renderer/**、i18n.tsx、任何 *.css、src/main/lan/mobile.ts,执行 git commit 前先加载本 skill 跑一次冒烟,全绿才提交,红了先修再提。用于提交前拦截界面回归、区分存量问题与新引入问题、断言与视觉验证。不在 npm test 内,发版前的最后一遍同样用它。"
---

# verify-ui — Super CD Search 界面冒烟

用真实 Electron 启动构建产物,断言界面关键结构并截图,防界面回归。断言全过 ≠ 界面没问题,必须看图。

## 触发时机:git 提交【之前】

界面改动先过冒烟再进 git 历史:

1. **`git commit` 之前**:看本次待提交改动(diff / staged files)是否命中触发范围;命中就先跑一次 `npm run verify:ui`,**全绿才提交**。
2. 有 FAIL 先别提交:先看 `artifacts/ui/console.log` 定位,再 `read_image` 看 `artifacts/ui/*.png`(断言过 ≠ 界面没问题,排版/遮挡只有看图知道);修完重跑到全绿再 commit。
3. 判断 FAIL 是不是本次改动引入:`git stash` 暂存改动(让工作区回到提交前状态)跑一遍基线——基线就红的是存量问题,可先记录(commit message / 说明里讲清)再提交;新引入的回归必须修掉才能进历史。

触发范围(待提交改动命中任意一个就执行第 1 步):`src/renderer/**`、`i18n.tsx`、任何 `*.css`、`src/main/lan/mobile.ts`。

## 怎么跑

- `npm run verify:ui` = 先 `npm run build`,再用 playwright-core 的 `_electron` 实验 API 启动真实 Electron 执行 `scripts/verify-ui.mjs`。
- 退出码:`0` 全部通过;`1` 至少一条 FAIL;`2` 缺构建产物等前置问题(先 `npm run build`)。
- 不在 `npm test` 里,发版前单独跑。
- 依赖锁死 `playwright-core ^1.63.0` + `Electron 41.x`,不要顺手升级。

## 看产物(每跑必做)

- **必须 `read_image` 看 `artifacts/ui/*.png`**:断言通过 ≠ 界面没问题,排版、遮挡、空白帧只有看图才知道。各截图覆盖范围见 `scripts/verify-ui.mjs` 头部注释(搜索页、石墨文档内嵌、手机端、局域网面板、设置面板、发布目标全流程、空态发布入口)。
- 先读 `artifacts/ui/console.log`:含主进程 stdout/stderr、渲染进程 console 与未捕获异常,每条 FAIL 的上下文都在里面,失败先看它再决定重跑。
- `artifacts/` 已 gitignore,产物不会误提交;失败时脚本非 0 退出且**保留全部产物**,别删,排查完再清。

## 安全与隔离

- 脚本用工作区内临时 profile(`artifacts/ui-profile`、`artifacts/ui-home`),每次运行先清空重建,**不碰真实 userData**(设置、日志、登录会话都不会被读写)。
- 预热数据(搜索缓存、发布目标配置)都在脚本内注入,不依赖网络,结果确定。

## 扩展检查

- 新增/改界面功能时,在 `scripts/verify-ui.mjs` 里补一条 `check(name, ok, detail)`;截图顺带用 `checkScreenshot` 校验非空白(≥ 5KB,小于基本是空帧)。
- 断言要钉在具体结构上(选择器、文案、boundingBox、computedStyle),避免重构后变成空断言;警惕用文本匹配打到错误元素(如 `.search-button` 与「搜索」tab 按钮)。

## 受限宿主注意事项

- 在受限宿主里跑应用,凡是应用自己 `spawn` Chrome 的场景(扫码登录 / 抓取 / 发布)需要 `SUPER_CD_CHROME_RESTRICTED=1` 才会附加 `--no-sandbox --use-mock-keychain`;`puppeteer.launch()` 的默认参数在这里不生效,否则会 SIGTRAP 秒退(macOS「Google Chrome 意外退出」)或弹钥匙串错误。
- `verify:ui` 脚本内部已给 Electron 进程设好该变量;手动 `npm start` 或调试时需要自行带上。
