const api = require('../../utils/api');
const auth = require('../../utils/auth');
const autoSearch = require('../../utils/autoSearch');
const { getErrorMessage } = require('../../utils/error');
const createSalesPage = require('../../utils/salesPage');

const { data, onLoad, onUnload, ...methods } = createSalesPage(
  { api, auth, autoSearch, getErrorMessage }, { managerView: true }
);

Component({
  properties: { managerId: { type: String, value: '' } },
  data,
  lifetimes: {
    attached() { if (this.data.managerId) this._ready = onLoad.call(this); },
    detached() {
      onUnload.call(this);
      this.productRequestId = (this.productRequestId || 0) + 1;
      this.overviewRequestId = (this.overviewRequestId || 0) + 1;
      this.filteredOverviewRequestId = (this.filteredOverviewRequestId || 0) + 1;
    }
  },
  methods: {
    ...methods,
    refreshSales() { return this.onListPullDownRefresh(); }
  }
});
