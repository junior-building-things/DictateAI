const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

function load(relativePath, overrides = {}) {
  const source = readFileSync(path.join(__dirname, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = {
    exports: {},
    require: (name) => overrides[name] ?? require(name),
  };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const catalog = load("../src/lib/modelCatalog.ts");
const controls = load("../src/components/Dropdown.tsx");

// Render the real page and dropdowns with only app state and desktop services replaced.
function screen(initialModels = {}) {
  const models = {
    speechProvider: catalog.DEFAULT_SPEECH_PROVIDER,
    speechModel: catalog.defaultSpeechModel(catalog.DEFAULT_SPEECH_PROVIDER),
    rewriteProvider: catalog.DEFAULT_REWRITE_PROVIDER,
    rewriteModel: catalog.defaultRewriteModel(catalog.DEFAULT_REWRITE_PROVIDER),
    ...initialModels,
  };
  const dropdowns = [];
  const { Models } = load("../src/app/pages/Models.tsx", {
    "../../components/Dropdown": {
      ...controls,
      Dropdown: (props) => {
        dropdowns.push(props);
        return React.createElement(controls.Dropdown, props);
      },
    },
    "../../lib/commands": {},
    "../../lib/utils": load("../src/lib/utils.ts"),
    "../../lib/modelCatalog": catalog,
    "../../components/LocalModelCard": { __esModule: true, default: () => null },
    "../../lib/i18n": { useI18n: () => ({ t: (key) => key }) },
    "../../lib/store": {
      useAppStore: () => ({
        models,
        setModels: async (updates) => Object.assign(models, updates),
      }),
    },
  });
  return {
    models,
    dropdowns,
    render: () => {
      dropdowns.length = 0;
      return renderToStaticMarkup(React.createElement(Models));
    },
  };
}

for (const [kind, providers, getOptions, index] of [
  ["speech", catalog.speechProviderOptions, catalog.getSpeechModelOptions, 0],
  ["rewrite", catalog.rewriteProviderOptions, catalog.getRewriteModelOptions, 1],
]) {
  for (const provider of providers) {
    for (const option of getOptions(provider)) {
      test(`${kind} selector displays ${provider} ${option.label} after selection and reload`, () => {
        const app = screen();
        app.render();
        const value = `${provider}::${option.setting}`;
        app.dropdowns[index].onChange(value);

        for (const current of [app, screen(app.models)]) {
          const markup = current.render();
          const dropdown = current.dropdowns[index];
          assert.equal(dropdown.value, value);
          const selected = dropdown.options.find((entry) => entry.value === dropdown.value);
          assert.equal(selected.label, `${provider} \u2014 ${option.label}`);
          assert(markup.includes(`${provider} \u2014 ${option.label}`));
        }
      });
    }
  }
}
