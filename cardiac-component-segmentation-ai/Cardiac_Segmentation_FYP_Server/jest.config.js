// This is a Jest configuration file for a TypeScript project.
// It specifies the preset to use, the test environment, the roots for test files,
// the module file extensions, and the transform settings for TypeScript files.
// If set up in package.json, this file will be used by Jest when running tests.
// To set up in package.json, you can add a "jest" field with the same configuration.

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/__tests__'], // Test directory
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    transform: {
      '^.+\\.(ts|tsx)$': 'ts-jest',
    },
  };
  