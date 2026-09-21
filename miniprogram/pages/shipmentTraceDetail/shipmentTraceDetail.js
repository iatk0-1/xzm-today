const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    shipmentId: '',
    orderId: '',
    trace: null,
    isLoading: true
  },

  onLoad: function(options) {
    const shipmentId = options.shipmentId || '';
    const orderId = options.orderId || '';
    if (!shipmentId) {
      wx.showToast({ title: '缺少发货单参数', icon: 'none' });
      return;
    }

    this.setData({
      shipmentId,
      orderId
    });
    this.loadTrace(shipmentId);
  },

  loadTrace: async function(shipmentId) {
    wx.showLoading({ title: '加载中...' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const trace = await api.get(`/shipments/${shipmentId}/trace`);
      const nodes = (trace.nodes || []).map((node, index) => ({
        ...node,
        descriptionSegments: this.parseTraceDescription(node.description),
        timeDisplay: this.formatTime(node.time),
        isLatest: index === 0
      }));
      const statusTextDisplay = this.formatTraceStatus(trace.statusText);

      this.setData({
        trace: {
          ...trace,
          statusTextDisplay,
          statusTextSegments: statusTextDisplay ? this.parseTraceDescription(statusTextDisplay) : [],
          message: this.formatTraceMessage(trace.message),
          nodes
        },
        isLoading: false
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      this.setData({ isLoading: false });
      wx.showToast({ title: '加载物流失败', icon: 'none' });
    }
  },

  formatTime: function(raw) {
    if (!raw) return '';
    try {
      var d = new Date(raw);
      if (isNaN(d.getTime())) {
        return String(raw);
      }
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
        + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch (e) {
      return String(raw);
    }
  },

  formatTraceMessage: function(message) {
    const messageMap = {
      'trace refreshed from carrier': '物流信息已从承运商更新',
      'trace loaded from local events': '物流信息来自本地记录'
    };
    return messageMap[message] || message || '';
  },

  formatTraceStatus: function(statusText) {
    return String(statusText || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  },

  // 把物流描述中的手机号、座机号和 400 电话拆成可点击片段。
  parseTraceDescription: function(description) {
    const text = String(description || '');
    const phonePattern = /(?:1[3-9]\d{9}|0\d{2,3}[-－]?\d{7,8}|400[-－]?\d{3}[-－]?\d{4})/g;
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = phonePattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          type: 'text',
          text: text.slice(lastIndex, match.index)
        });
      }

      segments.push({
        type: 'phone',
        text: match[0],
        value: match[0].replace(/[^\d+]/g, '')
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({
        type: 'text',
        text: text.slice(lastIndex)
      });
    }

    return segments.length > 0 ? segments : [{ type: 'text', text }];
  },

  handleTraceSegmentTap: function(e) {
    if (e.currentTarget.dataset.type !== 'phone') return;

    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;

    wx.showActionSheet({
      itemList: ['呼叫', '复制号码', '添加到手机通讯录'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.makePhoneCall({
            phoneNumber: phone
          });
          return;
        }

        if (res.tapIndex === 1) {
          clipboard.copyText(phone, '电话号码');
          return;
        }

        if (res.tapIndex === 2) {
          if (typeof wx.addPhoneContact !== 'function') {
            wx.showToast({ title: '当前微信版本不支持添加联系人', icon: 'none' });
            return;
          }

          const trace = this.data.trace || {};
          wx.addPhoneContact({
            firstName: this.getExpressName(trace.expressCode) || '物流联系人',
            mobilePhoneNumber: phone,
            remark: trace.expressNo ? `物流单号 ${trace.expressNo}` : '物流联系人',
            success: () => {
              wx.showToast({ title: '已打开联系人页面', icon: 'success' });
            },
            fail: (err) => {
              if (!err || !String(err.errMsg || '').includes('cancel')) {
                wx.showToast({ title: '打开联系人失败', icon: 'none' });
              }
            }
          });
        }
      }
    });
  },

  getExpressName: function(expressCode) {
    const nameMap = {
      ZTO: '中通快递',
      YTO: '圆通速递',
      STO: '申通快递',
      YD: '韵达速递',
      YUNDA: '韵达速递',
      SF: '顺丰速运',
      JD: '京东物流',
      EMS: 'EMS',
      BEST: '百世快递'
    };
    return nameMap[expressCode] || expressCode || '-';
  },

  copyExpressNo: function() {
    const trace = this.data.trace || {};
    clipboard.copyText(trace.expressNo, '快递单号');
  }
});
