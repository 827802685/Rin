# Testing Guide

This document provides a comprehensive guide to testing in the Rin project.

## Overview

Rin uses different testing frameworks for the client and server:

- **Client**: [Vitest](https://vitest.dev/) with jsdom environment for React component testing
- **Server**: [Bun's native test runner](https://bun.sh/docs/cli/test) with in-memory SQLite database

## Running Tests

Run each workspace's own suite — see the Client Tests and Server Tests sections below, or the
one-liners:

```bash
cd server && bun run test   # Bun's runner, no build step
cd client && bun run test   # Vitest with jsdom
bun run test:server         # the same server suite, from the repository root
```

### Why not `bun run test` at the root

The root `test` script is `bun test`, which globs **every** workspace and runs the
client's Vitest files under `bun:test` without jsdom. On the current checkout it
collects 781 tests and reports 24 failures — all of them DOM / clipboard /
localStorage cases that pass with `cd client && bun run test`. CI avoids this by
running `bun run test` with `working-directory: ./server` and `./client` in
separate jobs, so the root command is never exercised. The same applies to
`bun run test:coverage`.

### Client Tests

```bash
cd client

# Run tests once
bun run test

# Run tests in watch mode
bun run test:watch

# Run tests with coverage
bun run test:coverage
```

### Server Tests

```bash
cd server

# Run tests once
bun run test

# Run tests with coverage
bun run test:coverage
```

## Test Structure

### Client Tests

Location: `client/src/**/__tests__/*.test.ts`

```typescript
// Example client test
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyComponent } from '../components/MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### Server Tests

Locations:
- Unit tests: `server/src/**/__tests__/*.test.ts`
- Integration tests: `server/tests/integration/*.test.ts`
- Security tests: `server/tests/security/*.test.ts`

```typescript
// Example server test
import { describe, it, expect } from 'bun:test';
import { myFunction } from '../utils/myFunction';

describe('myFunction', () => {
  it('should return correct result', () => {
    const result = myFunction('input');
    expect(result).toBe('expected output');
  });
});
```

## Writing Tests

### Client Testing

1. **Component Tests**: Test React components in isolation
2. **API Client Tests**: Test the HTTP client and API calls
3. **Utility Tests**: Test helper functions

Example:
```typescript
import { describe, it, expect } from 'vitest';
import { apiClient } from '../api/client';

describe('API Client', () => {
  it('should handle API errors', async () => {
    const result = await apiClient.get('/nonexistent');
    expect(result.error).toBeDefined();
    expect(result.error?.status).toBe(404);
  });
});
```

### Server Testing

1. **Service Tests**: Test business logic in services
2. **Router Tests**: Test API endpoints
3. **Utility Tests**: Test helper functions

Example with database:
```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { createMockDB } from '../../tests/fixtures';

describe('FeedService', () => {
  let db: any;

  beforeEach(() => {
    const mockDB = createMockDB();
    db = mockDB.db;
  });

  it('should create a feed', async () => {
    // Test with mock database
  });
});
```

## Test Fixtures

Server tests use fixtures for mock data:

- `server/tests/fixtures/index.ts` - Mock database and environment setup
- `server/tests/test-api-client.ts` - Type-safe API client for tests

## Coverage

Coverage is **not** ready to run out of the box:

- **Client**: `cd client && bun run test:coverage` (`vitest run --coverage`) exits with
  `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'`. Install that provider
  first; with it present the report goes to `client/coverage/`.
- **Server**: `cd server && bun run test:coverage` (`bun test --coverage`) prints a coverage
  table to the terminal. Bun does not emit an `lcov.info` file, and Vitest's default reporter
  list (text / html / clover / cobertura) does not either, so `.github/workflows/test.yml`'s
  Codecov step — which uploads `./server/coverage/lcov.info` and `./client/coverage/lcov.info` —
  points at files no current command produces.

Plain test runs (`bun run test` in either workspace) need none of the above and are the
commands to rely on.

## CI/CD Integration

Tests run automatically on:
- Every push to the `main` or `trunk` branches
- Every Pull Request targeting those branches
- As separate `test-server` / `test-client` jobs (see `.github/workflows/test.yml`), each
  followed by that workspace's type check; the client job additionally builds the frontend

Two jobs in that file do not do what their names suggest, and are worth knowing before
you trust a green/red check:

- `format-check` runs the root `bun run format:check`, which expands to `turbo format:check`.
  No workspace defines a `format` script and prettier is not a dependency, so turbo reports
  "0 tasks" and exits 0 — the job is always green.
- `coverage` runs the root `bun run test:coverage`, i.e. the broken glob described above, so
  it fails on client DOM tests unless the invocation is switched to the per-workspace commands.

See [GitHub Actions Workflows](./deploy.mdx#github-actions-workflows) for details.

## Best Practices

1. **Write tests for new features**: Every new feature should include tests
2. **Test edge cases**: Include tests for error conditions and boundary cases
3. **Use descriptive names**: Test descriptions should clearly state what is being tested
4. **Keep tests independent**: Each test should be able to run independently
5. **Mock external dependencies**: Use mocks for external APIs and services

## Troubleshooting

### Client Tests Failing

```bash
# Clear cache and reinstall dependencies
rm -rf client/node_modules
bun install
```

### Server Tests Failing

```bash
# Ensure you're in the server directory
cd server
bun test
```

### Coverage Not Generated

Make sure you have the coverage reporter configured in your test config.

## Additional Resources

- [Vitest Documentation](https://vitest.dev/guide/)
- [Bun Test Runner](https://bun.sh/docs/cli/test)
- [Testing Library](https://testing-library.com/docs/)
