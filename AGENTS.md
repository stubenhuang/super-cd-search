## 思维方式
> 不清楚的地方要随时提问, 不要猜测, 可以渐进式提问
> 客观理性, 不要讨好任何人

## 项目定位

Super CD Search 面向 **CD 卖家**：按目录号批量查询多平台 CD 信息，聚合详情、比价、LLM 补全并导出 Excel。

## 日志规范

- 主进程统一用 `logger`（`src/main/logger.ts`），禁止直接 `console.*`。
- 级别：`debug` < `info` < `warn` < `error`。
- 格式：`logger.debug('module.tag', 'message', { meta })`。
- 开发默认 `debug`，打包默认 `info`；支持 `--log-level=debug` 和 `SUPER_CD_LOG_LEVEL`。
- 敏感信息（key/token/cookie）必须脱敏，长内容自动截断。
- 渲染进程日志用 `window.electronAPI.log(level, tag, message, meta)`。

## 测试规范

- 框架：Vitest，测试放在 `tests/*.test.ts`。
- Electron 依赖通过 `tests/setup.ts` mock。
- 纯函数必须直接单测，网络/浏览器逻辑用 mock。
- 覆盖率阈值：语句/分支/函数/行 ≥ 70%。
- 命令：
  - `npm test`
  - `npm run test:coverage`
  - `npm run typecheck`
