Component({
  properties: { saving: Boolean, problem: String, warnings: Array, conflict: Boolean, canReload: Boolean },
  methods: {
    reload() { if (!this.data.saving) this.triggerEvent('reload'); },
    latest() { if (!this.data.saving) this.triggerEvent('latest'); }
  }
});
