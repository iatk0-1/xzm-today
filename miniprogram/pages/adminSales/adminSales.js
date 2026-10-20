const api = require('../../utils/api');
const auth = require('../../utils/auth');
const autoSearch = require('../../utils/autoSearch');
const { getErrorMessage } = require('../../utils/error');
const createSalesPage = require('../../utils/salesPage');

Page(createSalesPage({ api, auth, autoSearch, getErrorMessage }));
