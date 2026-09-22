---
name: release-flow
description: "Super CD Search 发版流程:用户说「发布新版本」时一次做完 测试 → bump → tag → 等 CI → release note。版本号以 git tag 为唯一事实源,CI(.github/workflows/build-release.yml,on: push tags v*)用 tag 回写 package.json 版本后双平台打包并更新 latest.yml。触发时机:用户要求发布新版本、为某批改动打 tag 出包、或要求写/更新 release note 时。"
---

# release-flow — Super CD Search 发版

用户说「发布新版本」就一次做完:**测试 → bump → tag → 等 CI → release note**。不要只做一半等用户催。

## 唯一事实源:tag

- 版本号以 **tag 为唯一事实源**,不是 `package.json`。CI(`.github/workflows/build-release.yml`,`on: push tags v*`)从 tag 取版本(`v` 前缀去掉)回写 `package.json` 后再打包。
- tag 必须是 `vX.Y.Z` 形式;带 `-` 的(如 `v1.2.3-beta.1`)会被 CI 标记为 prerelease。

## 1. 发布前检查

- `npm test`、`npm run typecheck` 必须过。
- 本次改动涉及界面(`src/renderer/**`、`i18n.tsx`、`*.css`、`src/main/lan/mobile.ts`)还要跑界面冒烟——触发时机与规则见 skill `verify-ui`(提交前就该跑过,这里是最后再确认一遍)。

## 2. bump 与提交

- `npm version <X.Y.Z> --no-git-tag-version`(只改 `package.json`/lockfile,不自动提交、不自动打 tag)。
- version bump 与本次改动进**同一个提交**,然后 `git push origin main`。

## 3. 打 tag 并推送

- `git tag v<X.Y.Z>` && `git push origin v<X.Y.Z>`。
- **不要重复推同一 tag**(CI 会重跑、Release 冲突);**不要改动已发布的 tag**(历史版本不可变)。

## 4. 等 CI

- CI 顺序:先建空 Release(`create-release` job)→ Windows / macOS 并行构建打包 → 校验版本并更新 `release/latest.yml` → 上传产物。
- **双平台都成功,且 Release 里能看到 macOS / Windows 安装包与 `latest*.yml`,才算发布完成**;任何一平台红都要排查后处理(修代码只能发新 patch tag,不要动已推的 tag)。

## 5. Release note

- 内容:讲**本次 tag 与上一个 tag 的差异**,用户视角中文(修了什么、体验有什么变化),别贴 commit 列表了事。
- 取差异:先 `git log --oneline <上一个tag>..HEAD`,配合 diff 归纳。
- 草稿存 `artifacts/release-notes-v<版本>.md`(已 gitignore,不会误提交)。

## 回写 GitHub(无 gh CLI)

- 环境里**没有 `gh`**,用 token:在 `~/.zshrc` 的 `GH_TOKEN`,先 `. ~/.zshrc` 再调 API。
- `PATCH /releases/tags/<tag>` 会 404:要先 `GET /releases/tags/<tag>` 拿到 release **id**,再对 `/releases/<id>` PATCH body。
- **禁止明文回显/提交 token**;禁止用空正文覆盖已有 release note(先 GET 看原内容,合并/替换都要有实质内容)。

## 红线

- 不要本地 `npm run dist` / `pack` 出包——安装包一律由 CI 双平台产出,保证 `latest*.yml` 与产物一致。
- 不要重复推同一 tag,不要改动/删除已发布的 tag。
- 没看到双平台产物 + `latest*.yml` 之前,不要告诉用户「发布完成」。
