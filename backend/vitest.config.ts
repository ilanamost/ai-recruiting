import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Test-only value for signing/verifying JWT access tokens (src/lib/auth.ts)
    // — never used outside this test run. The real JWT_SECRET lives in
    // backend/.env (see .env.example's comment), not in this repo.
    env: {
      JWT_SECRET: 'test-only-jwt-secret-do-not-use-in-production',
      // Hard guarantee that no test can reach the live Claude API
      // (.plan/029 Step 8: "Mock the Claude call — no test may hit the live
      // API"). Tests mock src/scoring and src/analysis, but POST /api/resume
      // now calls analysis on the upload path, so a developer machine with
      // ANTHROPIC_API_KEY exported would otherwise leak a real call out of any
      // upload test that forgot the mock. An empty key makes `new Anthropic()`
      // throw before a request is ever built — which the upload path already
      // degrades to "unclassified".
      ANTHROPIC_API_KEY: ''
    }
  }
})
