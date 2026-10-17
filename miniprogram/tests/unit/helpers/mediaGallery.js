const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
module.exports = function setupGallery(properties = {}) {
  let definition;
  const events = [], previews = [], toasts = [];
  let pauses = 0;
  const windowInfo = { windowWidth: 375, windowHeight: 750 };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../components/mediaGallery/index.js'), 'utf8'), {
    Component: value => { definition = value; }, console,
    require: name => require(path.resolve(__dirname, '../../../components/mediaGallery', name)),
    wx: { getWindowInfo: () => windowInfo, createVideoContext: () => ({ pause() { pauses++; } }),
      previewImage: value => previews.push(value), showToast: value => toasts.push(value) }
  });
  const data = JSON.parse(JSON.stringify(definition.data));
  for (const [key, value] of Object.entries(definition.properties)) data[key] = value.value;
  Object.assign(data, properties);
  const instance = { ...definition.methods, data, setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); } };
  definition.lifetimes.attached.call(instance);
  return { instance, definition, events, previews, toasts, windowInfo, pauses: () => pauses };
};
