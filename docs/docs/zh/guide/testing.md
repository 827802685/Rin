# 测试指南

本文档提供 Rin 项目中测试的全面指南。

## 概述

Rin 为客户端和服务端使用不同的测试框架：

- **客户端**: [Vitest](https://vitest.dev/) 配合 jsdom 环境进行 React 组件测试
- **服务端**: [Bun 原生测试运行器](https://bun.sh/docs/cli/test) 配合内存 SQLite 数据库

## 运行测试

请按工作区运行各自的测试（完整命令见下面的「客户端测试」「服务端测试」小节）：

```bash
cd server && bun run test   # Bun 原生运行器，无需构建
cd client && bun run test   # Vitest + jsdom
bun run test:server         # 在仓库根目录跑同一套服务端测试
```

### 为什么不要在根目录跑 `bun run test`

根目录的 `test` 脚本就是 `bun test`，它会扫描**所有**工作区，并在没有 jsdom 的情况下用
`bun:test` 去跑客户端的 Vitest 文件。当前代码库实测：收集到 781 条用例、24 条失败，失败项全部
是 DOM / 剪贴板 / localStorage 相关，用 `cd client && bun run test` 都能通过。CI 之所以没踩这个坑，
是因为 `.github/workflows/test.yml` 用 `working-directory: ./server` 和 `./client` 分别执行，
从未调用过根命令。`bun run test:coverage` 同理，请使用各工作区下的同名脚本。

### 客户端测试

```bash
cd client

# 运行一次测试
bun run test

# 监视模式运行测试
bun run test:watch

# 运行测试并生成覆盖率报告
bun run test:coverage
```

### 服务端测试

```bash
cd server

# 运行一次测试
bun run test

# 运行测试并生成覆盖率报告
bun run test:coverage
```

## 测试结构

### 客户端测试

位置：`client/src/**/__tests__/*.test.ts`

```typescript
// 客户端测试示例
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyComponent } from '../components/MyComponent';

describe('MyComponent', () => {
  it('应该正确渲染', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### 服务端测试

位置：
- 单元测试：`server/src/**/__tests__/*.test.ts`
- 集成测试：`server/tests/integration/*.test.ts`
- 安全测试：`server/tests/security/*.test.ts`

```typescript
// 服务端测试示例
import { describe, it, expect } from 'bun:test';
import { myFunction } from '../utils/myFunction';

describe('myFunction', () => {
  it('应该返回正确结果', () => {
    const result = myFunction('input');
    expect(result).toBe('expected output');
  });
});
```

## 编写测试

### 客户端测试

1. **组件测试**：单独测试 React 组件
2. **API 客户端测试**：测试 HTTP 客户端和 API 调用
3. **工具函数测试**：测试辅助函数

示例：
```typescript
import { describe, it, expect } from 'vitest';
import { apiClient } from '../api/client';

describe('API Client', () => {
  it('应该处理 API 错误', async () => {
    const result = await apiClient.get('/nonexistent');
    expect(result.error).toBeDefined();
    expect(result.error?.status).toBe(404);
  });
});
```

### 服务端测试

1. **服务测试**：测试服务中的业务逻辑
2. **路由测试**：测试 API 端点
3. **工具函数测试**：测试辅助函数

使用数据库的示例：
```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { createMockDB } from '../../tests/fixtures';

describe('FeedService', () => {
  let db: any;

  beforeEach(() => {
    const mockDB = createMockDB();
    db = mockDB.db;
  });

  it('应该创建 feed', async () => {
    // 使用模拟数据库进行测试
  });
});
```

## 测试夹具

服务端测试使用夹具来设置模拟数据：

- `server/tests/fixtures/index.ts` - 模拟数据库和环境设置
- `server/tests/test-api-client.ts` - 用于测试的类型安全 API 客户端

## 覆盖率

覆盖率目前**不能直接运行**：

- **客户端**：`cd client && bun run test:coverage`（即 `vitest run --coverage`）会直接退出并报
  `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'`。需要先安装该 provider，
  装上之后报告输出到 `client/coverage/`。
- **服务端**：`cd server && bun run test:coverage`（即 `bun test --coverage`）只在终端打印覆盖率
  表格。Bun 不会生成 `lcov.info`，Vitest 的默认 reporter（text / html / clover / cobertura）同样
  不会，因此 `.github/workflows/test.yml` 里上传 `./server/coverage/lcov.info` 和
  `./client/coverage/lcov.info` 的 Codecov 步骤指向的是当前任何命令都不会产出的文件。

日常只需要跑各工作区的 `bun run test`，它与覆盖率工具链无关。

## CI/CD 集成

测试在以下情况自动运行：
- 每次推送到 `main` 或 `trunk` 分支
- 针对这些分支的每个 Pull Request
- 分成 `test-server` 与 `test-client` 两个 job（见 `.github/workflows/test.yml`），各自再跟一个本工作区的
  类型检查；客户端 job 还会额外执行一次前端构建

但同名文件里有两个 job 并不像它的名字那样工作，判断 CI 红/绿之前值得先知道：

- `format-check` 执行根目录的 `bun run format:check`，它展开为 `turbo format:check`。没有任何工作区
  定义 `format` 脚本，prettier 也不在依赖里，于是 turbo 报告“0 tasks”并以 0 退出——这个 job 永远是绿的。
- `coverage` 执行根目录的 `bun run test:coverage`，也就是上面说的错误 glob，会在客户端 DOM 用例上失败，
  除非改成各工作区下的同名命令。

详细信息请参阅 [GitHub Actions 工作流](./deploy.mdx#github-actions-工作流)。

## 最佳实践

1. **为新功能编写测试**：每个新功能都应该包含测试
2. **测试边界情况**：包括错误条件和边界情况的测试
3. **使用描述性名称**：测试描述应该清楚说明正在测试什么
4. **保持测试独立**：每个测试都应该能够独立运行
5. **模拟外部依赖**：为外部 API 和服务使用模拟

## 故障排除

### 客户端测试失败

```bash
# 清除缓存并重新安装依赖
rm -rf client/node_modules
bun install
```

### 服务端测试失败

```bash
# 确保你在 server 目录中
cd server
bun test
```

### 覆盖率未生成

确保你在测试配置中配置了覆盖率报告器。

## 其他资源

- [Vitest 文档](https://vitest.dev/guide/)
- [Bun 测试运行器](https://bun.sh/docs/cli/test)
- [Testing Library](https://testing-library.com/docs/)
