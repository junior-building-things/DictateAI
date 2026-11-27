const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

// Exercise the real module with only the desktop commands replaced.
const source = readFileSync(path.join(__dirname, "../src/lib/vocabLearn.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function learner(overrides = {}) {
  const added = [];
  const checked = [];
  const ordinary = new Set(["fully", "can't", "dec", "implemented", "comment", "issue"]);
  const commands = {
    getVocabulary: async () => [],
    filterUnknownVocabularyTerms: async (terms) => {
      checked.push(...terms);
      return terms.filter((term) => !ordinary.has(term.toLowerCase().replaceAll("\u2019", "'")));
    },
    addVocabularyTerm: async (...args) => added.push(args),
    ...overrides,
  };
  const context = {
    exports: {},
    require: (name) => {
      assert.equal(name, "./commands");
      return commands;
    },
    console: { log() {} },
  };
  vm.runInNewContext(compiled, context);
  return { ...context.exports, added, checked };
}

for (const [before, after] of [
  ["full", "fully"],
  ["can", "can't"],
  ["can", "can\u2019t"],
  ["deck", "Dec"],
  ["implement", "implemented"],
  ["common", "comment"],
  ["issued", "issue"],
  ["implement", "Implemented"],
]) {
  test(`does not auto-add ordinary correction ${before} -> ${after}`, async () => {
    const app = learner();
    await app.learnNewVocabTerms(`Please check ${before} in this message`, `Please check ${after} in this message`);
    assert.deepEqual(app.added, []);
    assert.deepEqual(app.checked, [after]);
  });
}

test("capitalization does not bypass the existing common-word filter", () => {
  const app = learner();
  assert.deepEqual(Array.from(app.extractCorrections("Please check hear in this message", "Please check Here in this message", [])), []);
});

test("still learns unfamiliar names and jargon without metadata", async () => {
  const app = learner();
  await app.learnNewVocabTerms("Please ask Shunade about ByteClowd today", "Please ask Sinead about ByteCloud today");
  assert.deepEqual(app.added, [
    ["Sinead", null, null, "learned"],
    ["ByteCloud", null, null, "learned"],
  ]);
});

test("does not add anything if the dictionary check fails", async () => {
  const app = learner({ filterUnknownVocabularyTerms: async () => { throw new Error("Unavailable"); } });
  await app.learnNewVocabTerms("Please ask Shunade about this today", "Please ask Sinead about this today");
  assert.deepEqual(app.added, []);
});

test("does not query the dictionary for existing terms", async () => {
  const app = learner({ getVocabulary: async () => [{ term: "sinead" }] });
  await app.learnNewVocabTerms("Please ask Shunade about this today", "Please ask Sinead about this today");
  assert.deepEqual(app.added, []);
  assert.deepEqual(app.checked, []);
});

test("ignores punctuation, capitalization, insertions, and deletions", () => {
  const app = learner();
  for (const [before, after] of [
    ["Please ask Sinead today.", "please ask Sinead today!"],
    ["Please ask Sinead today", "Please also ask Sinead today"],
    ["Please also ask Sinead today", "Please ask Sinead today"],
  ]) {
    assert.deepEqual(Array.from(app.extractCorrections(before, after, [])), []);
  }
});

test("ignores unrelated rewording", () => {
  const app = learner();
  assert.deepEqual(Array.from(app.extractCorrections("Please check the cat today", "Please check the dog today", [])), []);
});

test("finds a uniquely matched correction inside a larger field", () => {
  const app = learner();
  const original = "Please ask Shunade about ByteCloud today";
  const edited = "Earlier notes are unrelated. Please ask Sinead about ByteCloud today. More unrelated notes follow here.";
  assert.deepEqual(Array.from(app.extractCorrections(original, edited, [])), ["Sinead"]);
});

test("does not compare unrelated surrounding text when the dictation is unchanged", () => {
  const app = learner();
  const original = "Please ask Shunade about this today";
  assert.deepEqual(Array.from(app.extractCorrections(original, `Sinead has other plans. ${original}`, [])), []);
});

test("skips tied matches rather than guessing which passage was dictated", () => {
  const app = learner();
  const original = "Please ask Shunade about this today";
  const edited = "Please ask Sinead about this today. Please ask Sinead about this today.";
  assert.deepEqual(Array.from(app.extractCorrections(original, edited, [])), []);
});

test("skips a low-overlap rewrite even when substitutions alone look small", () => {
  const app = learner();
  const original = "Ask Shunade about launch plans today";
  const edited = "Ask Sinead about a different topic later";
  assert.deepEqual(Array.from(app.extractCorrections(original, edited, [])), []);
});

test("skips a low-confidence larger field instead of diffing all of it", () => {
  const app = learner();
  const original = "Ask Shunade about launch plans today";
  const edited = "Notify Sinead about a completely different unrelated topic later tonight";
  assert.deepEqual(Array.from(app.extractCorrections(original, edited, [])), []);
});
