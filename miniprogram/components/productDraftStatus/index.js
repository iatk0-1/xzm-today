Component({
  properties: { count: { type: Number, value: 0 }, saved: String, dirty: Boolean,
    saving: Boolean, problem: String, warnings: Array, conflict: Boolean, canReload: Boolean },
  methods: {
    open() { if (!this.data.saving) this.triggerEvent('open'); },
    reload() { this.triggerEvent('reload'); },
    latest() { this.triggerEvent('latest'); }
  }
});
