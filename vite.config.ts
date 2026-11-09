import { defineConfig } from "vite-plus";
import core from "ultracite/oxlint/core";
import antiSlop from "ultracite/oxlint/anti-slop";

/**
 * Matches module declarations and calls without spacing local call groups.
 */
const topLevelUnit = {
  selector:
    'Program > :matches(ExportNamedDeclaration, ExportDefaultDeclaration, FunctionDeclaration, ClassDeclaration, TSTypeAliasDeclaration, TSInterfaceDeclaration, TSEnumDeclaration, TSModuleDeclaration, VariableDeclaration, ExpressionStatement[expression.type="CallExpression"])',
};

/**
 * Matches direct and yielded Effect logs, including piped log annotations.
 */
const effectLogStatement = {
  selector:
    'ExpressionStatement:matches([expression.type="CallExpression"], [expression.type="YieldExpression"]):has(CallExpression[callee.type="MemberExpression"][callee.object.name="Effect"][callee.property.name=/^log(Trace|Debug|Info|Warning|Error|Fatal)?$/])',
};

export default defineConfig({
  fmt: {
    ignorePatterns: [".agents/**", "bun.lock"],
    jsdoc: { commentLineStrategy: "multiline", lineWrappingStyle: "balance" },
  },
  lint: {
    extends: [core, antiSlop],
    // spikes/ is throwaway R&D outside the tsconfig program; see spikes/README.md.
    ignorePatterns: ["dist/**", ".agents/**", "spikes/**"],
    jsPlugins: ["./tools/lint/plugin.mjs", "@stylistic/eslint-plugin"],
    // `vp check` runs type-aware rules and the type check only when both are enabled.
    // https://viteplus.dev/guide/check
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // `Schema.TaggedError<Self>()(tag, fields)` is a class factory, not a thrown error. The
        // rule misreads the `*Error` callee and its autofix corrupts the `extends` clause.
        files: ["src/issue.ts"],
        rules: { "unicorn/throw-new-error": "off" },
      },
      {
        // These tests import bun:test, and the changeset check imports node: modules, from plain
        // JavaScript. The type-aware checker does not load those types for an .mjs file; the
        // tests still run under bun test.
        files: ["tools/**/*.test.mjs", "tools/changeset/*.mjs"],
        rules: {
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-call": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-unsafe-return": "off",
        },
      },
    ],
    rules: {
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", next: topLevelUnit, prev: "*" },
        { blankLine: "always", next: "*", prev: topLevelUnit },
        {
          blankLine: "always",
          next: "const",
          // Effect generator calls are wrapped in yield expressions.
          prev: {
            selector:
              'ExpressionStatement:matches([expression.type="CallExpression"], [expression.type="YieldExpression"][expression.argument.type="CallExpression"])',
          },
        },
        { blankLine: "always", next: "return", prev: "*" },
        { blankLine: "always", next: "*", prev: "if" },
        { blankLine: "always", next: "*", prev: effectLogStatement },
      ],
      // Related Effect schemas and errors form one cohesive module.
      "max-classes-per-file": "off",
      // Effect adapters return existing promises without introducing async wrappers.
      "typescript/promise-function-async": "off",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "workspace/kebab-case-paths": "error",
      "workspace/no-built-in-try-catch": "error",
    },
  },
  // The published entry point. Effect stays external because it is a peer dependency.
  pack: {
    dts: true,
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
  },
  // Library tests run on Vitest with @effect/vitest. The lint-rule tests in tools/ import
  // bun:test and run under `bun test`; `bun run test` runs both.
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
