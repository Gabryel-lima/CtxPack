/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // Runtime-only stub so files that `import * as vscode from "vscode"`
    // (for types and for calls inside functions our tests never invoke) can
    // still be required outside the real VS Code extension host.
    '^vscode$': '<rootDir>/test/__mocks__/vscode.js'
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }]
  }
};
