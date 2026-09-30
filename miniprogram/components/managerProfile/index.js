Component({
  properties: {
    user: { type: Object, value: {} },
    compact: { type: Boolean, value: false }
  },
  data: { avatarFailed: false },
  observers: {
    'user.avatarUrl': function() { this.setData({ avatarFailed: false }); }
  },
  methods: {
    onAvatarError() { this.setData({ avatarFailed: true }); }
  }
});
