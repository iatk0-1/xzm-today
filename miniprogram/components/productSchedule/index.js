const { beijingParts, buildSchedule } = require('../../utils/productSchedule');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    schedule: { type: Object, value: null },
    busy: { type: Boolean, value: false },
    hint: { type: String, value: '确认后请保存商品，定时设置才会生效' },
    allowCancel: { type: Boolean, value: true }
  },
  data: { date: '', time: '', minDate: '', status: 'on' },
  observers: {
    visible(value) {
      if (!value) return;
      const current = this.data.schedule;
      const valid = current && !current.cancelled && (!current.state || current.state === 'pending');
      const parts = beijingParts(valid ? Date.parse(current.executeAt) : Date.now() + 60 * 60 * 1000);
      this.setData({ ...parts, minDate: beijingParts().date, status: valid ? current.status : 'on' });
    }
  },
  methods: {
    stopPropagation() {},
    close() { if (!this.data.busy) this.triggerEvent('close'); },
    changeDate(e) { this.setData({ date: e.detail.value }); },
    changeTime(e) { this.setData({ time: e.detail.value }); },
    selectStatus(e) {
      if (!this.data.busy) this.setData({ status: e.currentTarget.dataset.status });
    },
    confirm() {
      if (this.data.busy) return;
      try {
        this.triggerEvent('confirm', buildSchedule(this.data.date, this.data.time, this.data.status));
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    },
    cancelSchedule() {
      if (!this.data.busy) this.triggerEvent('confirm', { cancelled: true });
    }
  }
});
