function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function showEmptyToast(label) {
  wx.showToast({
    title: label ? '没有可复制的' + label : '没有可复制内容',
    icon: 'none'
  });
}

function copyText(value, label) {
  var text = normalizeText(value);
  if (!text) {
    showEmptyToast(label);
    return;
  }

  wx.setClipboardData({
    data: text,
    success: function() {
      wx.showToast({
        title: (label || '内容') + '已复制',
        icon: 'success'
      });
    }
  });
}

function buildRecipientText(info) {
  info = info || {};
  var name = normalizeText(info.name || info.recipientName);
  var phone = normalizeText(info.phone || info.recipientPhone);
  var address = normalizeText(info.address || info.recipientAddress);
  return [
    [name, phone].filter(Boolean).join(' '),
    address
  ].filter(Boolean).join('\n');
}

function copyRecipient(info) {
  copyText(buildRecipientText(info), '收货信息');
}

module.exports = {
  copyText: copyText,
  copyRecipient: copyRecipient,
  buildRecipientText: buildRecipientText
};
