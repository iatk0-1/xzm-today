# 分销模式 2.0 小程序改造方案

> 日期：2026-08-25  
> 开发分支：`dev2.0`  
> 后端依据：`xzm-backend/docs/plans/2026-08-25-distribution-v2-implementation-plan.md`

## 1. 前端硬规则

- 原始商品只能由目标商户内拥有 `PRODUCT_CREATE` 权限的成员创建；帮卖配置要求 `DISTRIBUTION_CONFIGURE` 权限。
- 平台角色、商户成员权限和分销卖家身份互相独立，前端不得继续用全局 `ADMIN/SELLER` 判断全部经营能力。
- 一期虽然只有默认商户，页面、缓存和请求也必须显式保留当前 `merchantId`，为多商户切换留好边界。
- 卖家只复制并编辑商品营销信息，不能上传原始商品。
- 卖家可以为每个源 SKU 单独设置分销销售价，售价必须大于等于该源 SKU 当前价格。
- SKU 价格可编辑；规格、尺码、条码、库存、库存池、套装结构和 SKU 图片全部只读。
- 顾客所见价格由后端返回的分销 SKU 售价决定。
- 商品/SKU 固定佣金和加价收益只作展示，订单最终收益以后端快照为准。
- 前端不得提交可信成交价、固定佣金或卖家归属。

## 2. 登录态重构

JWT 只携带稳定的平台角色；登录/用户信息接口另外返回商户成员关系、解析后的权限和卖家合作关系：

```javascript
{
  userId,
  platformRoles: ['USER'],
  memberships: [
    {
      merchantId: 1001,
      merchantName: '现在买',
      memberRoles: ['OWNER'],
      permissions: ['PRODUCT_CREATE', 'PRODUCT_UPDATE']
    }
  ],
  sellerProfile: {
    sellerId: 2001,
    shopCode: '不可枚举店铺码',
    status: 'active'
  },
  sellerPartnerships: [
    { merchantId: 1001, status: 'active' }
  ],
  nickname,
  avatarUrl,
  phone,
  isPhoneBound
}
```

`utils/auth.js` 增加：

```javascript
getPlatformRoles()
hasPlatformRole(role)
getMerchantMemberships()
hasMerchantPermission(merchantId, permission)
getSellerProfile()
getSellerPartnership(merchantId)
canUseSellerWorkbench(merchantId)
```

可短期保留 `isAdmin()` 兼容旧页面，但只能映射到“当前商户是否拥有后台所需权限”，不得继续表示全局管理员。所有新页面直接使用 `hasMerchantPermission()`；旧页面逐页消除 `userInfo.role === 'ADMIN'` 判断。

新增 `utils/merchant-context.js`，单独保存当前经营商户：

```javascript
{
  merchantId,
  merchantName,
  selectedAt
}
```

当前商户必须来自 `memberships`，不能接受任意本地 `merchantId`。账号被移出商户、权限刷新失败或商户被禁用时，立即清除上下文并返回工作台选择页。

## 3. 工作台入口与商户切换

- 有有效 `membership`：显示商户工作台；具体菜单按当前商户的 `permissions` 展示。
- 拥有多个有效商户成员关系：进入商户工作台前选择商户，并支持在工作台内切换。
- `seller_profile=active` 且目标商户合作关系为 `active`：显示该商户下的卖家工作台，包括分销选品、我的商品、归因订单、收益账单和店铺分享。
- 卖家与目标商户的合作关系为 `pending/disabled/rejected`：只展示该商户对应的状态和处理指引，不影响其在其他商户的合作。
- 普通用户：保持购物、订单、地址和客服能力。

一个账号可以同时是普通消费者、多个商户的成员和多个商户的分销卖家。商户工作台与卖家工作台分别保存上下文，进入一侧不能覆盖另一侧，更不能因为成为卖家就丢失普通用户功能。

## 4. 页面计划

```text
pages/sellerApply/sellerApply                 卖家申请和审核状态
pages/sellerWorkbench/sellerWorkbench         卖家工作台
pages/distributionCatalog/distributionCatalog 分销选品池
pages/distributionProduct/distributionProduct 帮卖规则确认
pages/sellerProductList/sellerProductList     我的分销商品
pages/sellerProductEdit/sellerProductEdit     编辑营销信息和逐 SKU 售价
pages/sellerOrderList/sellerOrderList         归因订单
pages/sellerIncome/sellerIncome               固定佣金、加价收益和结算明细
pages/sellerShop/sellerShop                   店铺资料和分享

pages/merchantSelect/merchantSelect           商户选择与切换
pages/merchantWorkbench/merchantWorkbench     按权限展示商户经营菜单
pages/adminSellerList/adminSellerList         当前商户卖家审核/禁用（旧路由名可暂保留）
pages/adminDistribution/adminDistribution     当前商户帮卖开关和双模式固定佣金
pages/adminIncome/adminIncome                 当前商户收益对账和结算
```

路由文件名一期可兼容现有 `admin*` 命名，但页面概念和接口必须改为“当前商户 + 权限”，后续再做无业务风险的目录改名。

## 5. 帮卖流程

```text
卖家工作台
  -> 选择已建立合作关系的商户
  -> 分销选品池
  -> 查看源商品、当前佣金模式、SKU 实际佣金、实时价格和库存
  -> 点击帮卖
  -> 后端生成默认下架的商品副本
  -> 编辑商品营销信息和每个 SKU 的分销售价
  -> 预览每个 SKU 的顾客价与预计单件收益
  -> 上架
```

预览公式：

```text
SKU 加价收益 = distributionSalePrice - sourceSkuPrice
SKU 模式预计收益 = 当前 SKU 固定佣金 + SKU 加价收益
商品模式预计收益 = 商品统一固定佣金 + SKU 加价收益
```

## 6. 卖家商品编辑页

可编辑控件：

- 商品名称、封面、轮播图、穿搭图、详情图和视频。
- 商品描述、护理说明、温馨提示、标签和排序。
- 每个 SKU 的分销销售价。
- 上架/下架状态。

SKU 区域只开放价格输入框，其余信息只读。每行展示：

- 规格、尺码、条码。
- SKU 图片。
- 源商品当前价格（只读）。
- 当前 SKU 实际固定佣金（只读，后端根据商品佣金模式解析）。
- 分销销售价（可编辑，且不得低于源价格）。
- 当前可售库存。
- 当前 SKU 加价收益。

页面通过独立接口提交 `skuPrices: [{ sourceSkuId, salePrice }]`。不得提交规格、尺码、条码、SKU 图片、库存、套装结构和固定佣金字段；即使页面被篡改，后端也必须再次拒绝越权字段。

源 SKU 调价后：

- 原价上涨超过分销售价：对应行标红并显示“售价低于最新原价，请调价”，禁止商品上架和下单。
- 原价下降：保留卖家原分销售价，实时展示增加后的差价收益。
- 源 SKU 禁用或删除：对应行只读显示“已失效”。

## 7. 店铺上下文

新增 `utils/store-context.js`：

```javascript
{
  shopCode,
  sellerId,
  shopName,
  enteredAt
}
```

分享路径：

```text
/pages/index/index?shopCode=不可枚举店铺码
```

规则：

1. 后端校验店铺码和卖家状态。
2. 有效时保存店铺上下文并加载该卖家商品。
3. 无效或禁用时清除上下文，回到主商家首页。
4. 商品详情再次校验商品属于当前店铺。
5. 购物车保存销售商品 ID 和源 SKU ID，最终归因由后端商品血缘确定。

## 8. 购物车与结算

- 一期同一订单只允许同一卖家来源。
- 不同卖家商品按店铺分组并分别结算，不能静默混单。
- 提交订单不再传可信 `salePrice`。
- 后端价格变化时返回明确错误和最新价格，前端展示确认后重新结算。
- 订单确认页展示销售店铺、主商家履约提示、原价与加价后成交价。

请求项：

```javascript
{
  productId: '销售商品ID',
  skuId: '源SKU ID',
  qty: 1,
  bundleConfig: [],
  remark: ''
}
```

## 9. 收益展示

卖家收益页分开显示：

- 固定佣金。
- 佣金模式（商品统一/SKU 单独）。
- 加价收益。
- 总收益。
- 已冲回固定佣金。
- 已冲回加价收益。
- 待生效、冻结、可结算、已结算状态。

订单明细展示下单快照，不用当前商品配置回算历史收益。

## 10. 商户商品与分销管理页

当前商户的原商品增加分销设置，页面进入和保存都要求 `DISTRIBUTION_CONFIGURE`：

- 是否允许帮卖。
- 佣金模式选择：商品统一佣金或逐 SKU 佣金。
- 商品模式展示一个统一佣金输入框。
- SKU 模式按 SKU 展示佣金输入框，规格、图片和原价用于辅助配置且只读。
- 当前源 SKU 最低价和佣金合法性提示。
- 当前帮卖卖家数。
- 强制停止关联分销商品。

拥有对应商户权限的成员修改源价格、规格、库存或 SKU 图片后，卖家端下次查询实时反映；卖家只保留独立销售价，不产生规格、图片或库存副本。

所有商户经营请求显式带当前商户：

```text
POST /api/v1/merchants/{merchantId}/products
PUT  /api/v1/merchants/{merchantId}/products/{productId}/distribution-setting
GET  /api/v1/merchants/{merchantId}/distribution/sellers
```

切换商户后必须清空上一商户的商品列表、筛选条件和分页缓存，重新按新 `merchantId` 请求，避免页面串数据。收到 403、成员失效或商户禁用响应时刷新用户信息和成员关系，不只弹错误后停留在旧页面。

## 11. 前端实施顺序

1. 升级登录缓存为 `platformRoles + memberships + sellerProfile + sellerPartnerships`。
2. 新增商户上下文、商户选择/切换和 `hasMerchantPermission()`，逐页替换全局管理员判断。
3. 增加卖家申请、按商户展示合作状态和卖家工作台入口。
4. 增加商户卖家审核及商品/SKU 双模式固定佣金设置。
5. 增加按合作商户隔离的分销池、帮卖和卖家商品编辑页。
6. 商品详情读取源 SKU，开放逐 SKU 售价输入，其余 SKU 字段只读。
7. 增加店铺上下文和分享归因。
8. 改造购物车、后端定价交互和按卖家拆单。
9. 增加卖家订单、固定佣金和加价收益页面。
10. 完成平台身份、商户权限、多商户切换、价格、库存、分享和退款回归测试。

## 12. 验收重点

- 卖家页面只允许编辑 SKU 分销售价，没有规格、库存、SKU 图片编辑入口。
- 分销售价低于源 SKU 当前价格或伪造价格请求会收到中文错误提示。
- 原 SKU 涨价超过分销售价后，该 SKU 明确提示待调价并停止销售。
- 原 SKU 降价后，卖家售价保持不变，差价收益实时重算。
- 原 SKU 图片和库存变化后，分销端实时一致。
- 一个账号属于多个商户时可正确切换，页面、请求和缓存不会串商户数据。
- `PLATFORM_ADMIN` 未加入商户时看不到也无法调用该商户经营能力。
- 成员被禁用、移除或权限变化后，刷新用户信息即可生效，不依赖旧 JWT 中的商户权限。
- 同一卖家在不同商户的合作状态、选品池、分销商品、订单和收益互相隔离。
- 不同卖家商品不会进入同一订单。
- 固定佣金、加价收益和退款冲回展示与后端台账一致。
- 商品统一佣金和逐 SKU 佣金切换后，表单校验、卖家预览和订单收益口径一致。

## 13. 实施进度

> 更新时间：2026-08-31

| 步骤 | 状态 | 已完成成果 | 验证/遗留问题 |
|---|---|---|---|
| 1-3 | 进行中 | 登录缓存、商户上下文、商户选择、卖家申请和状态工作台已接通 | Node 权限测试通过；真实登录和开发者工具页面切换待联调 |
| 4 | 未开始 | 商户经营工作台已按权限展示入口 | 卖家审核和双模式佣金配置页面待实现 |
| 5-6 | 进行中 | 选品、帮卖、卖家商品列表及受限编辑已落地；仅 SKU 售价可写 | 后端价格边界测试和前端语法检查通过；图片上传体验待完善 |
| 7 | 进行中 | 订单与购物车已透传 `shopCode`、商户和分销卖家上下文 | 店铺首页分享入口待完善 |
| 8 | 已完成 | 购物车及结算页按商户/卖家来源分组；跨来源自动拆成独立订单，先建单再逐笔支付；部分失败不会重复创建已建订单 | 10 条 Node 单测、JS 语法和 WXML 标签配对通过；多次微信支付弹窗纳入上线前人工回归 |
| 9-10 | 未开始 | 无 | 等待后端收益台账和全量回归阶段 |
