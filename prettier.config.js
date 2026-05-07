/** @type {import("prettier").Config} */
module.exports = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  singleAttributePerLine: true,
  plugins: [
    '@trivago/prettier-plugin-sort-imports',
    'prettier-plugin-packagejson',
    'prettier-plugin-tailwindcss',
  ],
  importOrder: ['^node:', '<THIRD_PARTY_MODULES>', '^@repel/', '^[./]'],
  importOrderSeparation: false,
  importOrderSortSpecifiers: true,
};
