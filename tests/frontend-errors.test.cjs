const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(response) {
  const elements = new Map();
  const messages = [];
  const context = vm.createContext({
    window: {},
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          value: '', style: {}, scrollHeight: 0,
          classList: { toggle() {} }, querySelector: () => null,
        });
        return elements.get(id);
      },
    },
    fetch: async () => response,
    URL: { createObjectURL: () => { throw new Error('A failed request must not create audio'); } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8'), context);
  context._renderBubble = () => {};
  context.appendMessage = (role, text) => messages.push({ role, text });
  return { context, elements, messages };
}

test('TTS service errors appear as readable text and release the send button', async () => {
  const f = fixture({ ok: false, status: 502, json: async () => ({ detail: 'Speech service returned empty audio.' }) });
  await f.context.sendTtsTest('Hello');
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].text, '⚠️ TTS error: Speech service returned empty audio.');
  assert.equal(f.elements.get('send-btn').disabled, false);
});

test('non-JSON service failures also release the send button', async () => {
  const f = fixture({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => { throw new Error('not JSON'); } });
  await f.context.sendTtsTest('Hello');
  assert.equal(f.messages[0].text, '⚠️ TTS error: Service Unavailable');
  assert.equal(f.elements.get('send-btn').disabled, false);
});
