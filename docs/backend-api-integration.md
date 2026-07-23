# xzm-today 后端 API 对接说明

> 对接仓库：`iatk0-1/xzm-today` ↔ `iatk0-1/xzm-backend`
> 源码分支：`develop`
> 核对日期：2026-07-21

本文说明小程序如何调用后端 API。完整的服务端接口清单见 `xzm-backend/docs/api/06-完整接口参考.md`；本文重点记录小程序侧的请求链路、功能入口和联调注意事项。

## 1. 基础地址

`miniprogram/utils/config.js` 当前配置：

```text
https://api-dev.xianzaimai.com/api/v1
```

页面和工具模块只能向 `api.js` 传 `/api/v1` 后面的相对路径，例如：

```js
api.get('/orders', { page: 1, size: 20 });
api.post('/cart/items', { skuId: '...', count: 1 });
```

本地联调地址为 `http://localhost:8080/api/v1`。切换环境时只改统一配置，不要在页面内写完整域名。

## 2. 统一请求链路

入口文件：`miniprogram/utils/api.js`。

一次普通请求按以下顺序执行：

1. 规范化 HTTP 方法、路径和数据。
2. 为 `POST`、`PUT`、`PATCH`、`DELETE` 自动生成 `Idempotency-Key`。
3. 若 Access Token 距离过期不足 5 分钟，先用 Refresh Token 调用 `POST /auth/refresh`。
4. 添加 `Authorization: Bearer <accessToken>` 和 JSON 请求头。
5. 遇到首次 `401` 时刷新 Token 并重试一次；再次失败则清理本地会话。
6. 只把 2xx 响应作为成功结果返回，其余状态转换为包含 `statusCode` 的错误对象。

同一时刻发生多个刷新请求时，`refreshPromise` 会合并并发刷新，避免重复换取 Token。

### 对应服务端约束

| 约束 | 小程序处理 | 服务端处理 |
|---|---|---|
| JWT | 自动添加 Bearer Token | `@RequiredRoles` 接口由 `AuthInterceptor` 校验 |
| 幂等 | 写操作自动生成唯一键 | 受限写接口由 `IdempotencyInterceptor` 校验，键保留 24 小时 |
| 大整数 ID | 按字符串保存和传递 | 所有 Java `Long` 输出为 JSON 字符串 |
| 时间 | 当普通字符串展示或转换 | 输出上海时区 `yyyy-MM-dd HH:mm:ss` |
| 错误 | 非 2xx 抛出错误对象 | 返回 `code`、`message`，校验错误可附带 `errors` |

## 3. 认证与会话

| 功能 | 接口 | 调用位置 |
|---|---|---|
| 小程序登录 | `POST /auth/miniapp/login` | `miniprogram/utils/auth.js` |
| 手机号登录 | `POST /auth/miniapp/phone-login` | 登录流程 |
| 绑定手机号 | `POST /auth/bind-phone`、`POST /users/me/phone/bind` | 认证、结算、个人资料页 |
| 刷新会话 | `POST /auth/refresh` | `api.js` 自动调用 |
| 获取资料 | `GET /users/me` | 用户页 |
| 修改资料 | `PUT /users/me/profile` | 编辑资料页 |

登录响应中的 `accessToken`、`refreshToken`、`expiresAt` 和 `refreshExpiresAt` 会写入微信本地存储。业务页面不应直接操作这些键，应通过 `api.js` 暴露的方法管理会话。

## 4. 文件上传

`api.uploadFile(url, filePath, formData, options)` 有两条链路：

- `/files/upload-wish` 和 `/files/upload-avatar`：默认先压缩图片，再尝试获取 COS 临时凭证并直传；直传失败后回退到后端 multipart 上传。
- 其他上传地址：直接使用 `wx.uploadFile` 调后端，例如物流 Excel 解析。

上传请求同样会提前刷新 Token，并在 `401` 后只重试一次。上传字段名固定为 `file`。

## 5. WebSocket 客服消息

聊天页从 API 地址推导 WebSocket 地址：

```text
wss://api-dev.xianzaimai.com/ws/chat?token=<accessToken>
```

WebSocket 只接收服务端推送。发送文本、图片或商品卡片仍走以下 HTTP 接口：

- `POST /conversations/start`
- `POST /conversations/start-from-order`
- `GET /conversations/{id}`
- `GET /conversations/{id}/messages`
- `POST /conversations/{id}/messages`
- `POST /conversations/{id}/messages/image`
- `POST /conversations/{id}/read`

## 6. 功能与接口族

| 小程序功能 | 主要接口前缀 | 主要页面/模块 |
|---|---|---|
| 商品、搜索、标签、档口、尺码 | `/products`、`/tags`、`/stalls`、`/sizes` | 首页、搜索、商品详情、商品管理、直播发布 |
| 购物车与结算 | `/cart`、`/orders` | 购物车、结算、订单列表与详情 |
| 售后 | `/after-sales` | 售后申请、用户售后详情、管理端售后列表与详情 |
| 直播 | `/live-sessions`、`/live-products` | 直播列表、详情、发布 |
| 管理端销售 | `/admin/sales` | 销售统计、商品销售明细 |
| 管理端订单 | `/admin/orders-manage` | 订单管理、退款、解绑面单 |
| 库存与拣货 | `/sku-inventory`、`/stocks`、`/picking-list` | SKU 库存、拣货单、采购单 |
| 发货与物流 | `/shipments`、`/merge-groups`、`/logistics`、`/waybills` | 手工发货、部分发货、合单、打印、批量物流 |
| 客服消息 | `/conversations`、`/ws/chat` | 消息列表、聊天页 |
| 许愿池与草稿 | `/wishes`、`/drafts` | 市场、许愿详情、发布许愿、商品草稿 |

## 7. 联调检查清单

- 确认页面传入的是相对路径，没有重复拼接 `/api/v1`。
- 所有 Snowflake ID 都按字符串处理，禁止 `Number(id)`、数学运算或隐式数值排序。
- 受限写接口必须经过 `api.js`，避免遗漏 `Authorization` 或 `Idempotency-Key`。
- `GET` 查询优先通过 `data` 参数传递；若直接拼接查询串，必须使用 `encodeURIComponent`。
- multipart 上传字段名保持为 `file`，并确认接口所需的其他 formData 字段。
- WebSocket Token 过期后需要重新连接；HTTP 自动刷新不会自动替换已建立连接的查询参数。
- 分页起始值不完全统一：多数业务列表从 `1` 开始，许愿池和部分 Spring 分页接口从 `0` 开始，按完整接口参考执行。

## 8. 已确认的契约风险

以下项目来自当前源码核对，不代表已经修复：

1. 搜索历史单项删除：小程序调用 `api.delete('/users/me/usage/searches', { keyword })`，服务端却使用 `@RequestParam String keyword`。应把关键字放到查询串，或把后端改为接收 JSON body。
2. 浏览器 CORS：后端允许方法中缺少 `PATCH`，当前微信小程序不依赖浏览器 CORS，但 Web/H5 客户端调用购物车或商品状态 PATCH 接口时，预检会失败。
3. 公开接口边界：`/system/cos-diag`、`/waybills` 及其打印标记接口当前没有 `@RequiredRoles`。上线前应确认是否确实需要公开。
4. 回调验签：支付、物流、消息和内容安全回调是公开入口，生产环境必须开启并验证对应签名或回调令牌。
5. 敏感配置：后端配置和小程序配置中存在不应长期硬编码的凭据或标识。应迁移到环境变量/安全配置中心，并轮换已经暴露的密钥；文档不得复制具体值。

## 9. 服务端错误格式

普通错误：

```json
{
  "code": "BAD_REQUEST",
  "message": "错误说明"
}
```

字段校验错误：

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "errors": [
    { "field": "fieldName", "message": "invalid value" }
  ]
}
```

常用状态码：`400` 参数错误、`401` 未认证、`403` 角色不足、`404` 资源不存在、`409` 状态或幂等冲突。
