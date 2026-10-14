Component({
  properties: {
    user: { type: Object, value: {} },
    compact: { type: Boolean, value: false },
    selectable: { type: Boolean, value: false }
  },
  data: { avatarFailed: false },
  observers: {
    'user.avatarUrl': function() { this.setData({ avatarFailed: false }); }
  },
  methods: {
    onSelect() {
      if (!this.properties.selectable) return;
      const user = this.properties.user || {};
      const userId = user.userId || user.id;
      if (userId === undefined || userId === null || userId === '') return;
      this.triggerEvent('select', { userId });
    },
    onAvatarError() { this.setData({ avatarFailed: true }); }
  }
});
