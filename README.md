# 高德地图去广告 · Surge 模块

移除高德地图 iOS App 的开屏广告、首页推广卡片与红点、首页/我的页整段营销卡、AI 推荐流、搜索热词与结果推广、消息横幅、导航插播、打车页营销弹窗。

纯 **脚本改写响应体**，不做域名级拦截，不碰地图与导航的正常接口。

## 安装

Surge → 首页 → 模块 → 安装新模块 → 粘贴：

```
https://raw.githubusercontent.com/carrotluo5/surge-amap-adblock/main/amap.sgmodule
```

装好后确认：

1. 模块列表里出现「高德地图去广告」且已启用
2. Surge → 工具 → 证书 已安装并被系统信任（模块会自动把 `m5.amap.com, m5-zb.amap.com, sns.amap.com, oss.amap.com, ai.amap.com` 追加进 MITM 主机名）
3. 杀掉高德重开

## 原理

Surge 的 URL Rewrite **只有 header / 302 / 307 / reject 四种**，没有 Loon 的 `reject-dict`。所以本模块不拦请求，而是用 `type=http-response` 脚本把响应体里的广告字段剪掉、或把整个响应体置空 `{}`。

覆盖 45 条接口，按 host 分成 5 条 script：

| 脚本 | host | 覆盖内容 |
|---|---|---|
| 高德地图去广告-主接口 | m5.amap.com | 首页卡片与地图图层、开屏、推荐瀑布流、搜索热词/联想/结果、POI 详情、消息通知、导航插播、打车/公交、酒店页、profile 页 |
| 高德地图去广告-消息 | sns.amap.com | 消息盒子 |
| 高德地图去广告-打车 | m5-zb.amap.com | 打车订单页、营销弹窗 |
| 高德地图去广告-横幅 | oss.amap.com | 横幅列表 |
| 高德地图去广告-AI推荐流 | ai.amap.com | 首页 AI 流（SSE 文本流）、探索页 AI 流 |

**必须按 host 拆开**：Surge 的 `pattern` 是整条 URL 的正则，host 与 path 有绑定关系，合成一条会误伤或漏匹配。

## 首页与我的页：按位置整段截断

这两个页面不是「删掉某几个广告字段」，而是**从某张卡开始，它和它下面的全部不要**：

- **首页**：`cardList` 顺序遍历，命中「空气清新的车 / 叫一辆 / 臭车」的叫车卡即截断，只保留它上面的卡。
- **我的页**：`cardList` 顺序遍历，命中「达人任务」即截断，只保留它上面的卡。
- **首页 AI 流**：SSE 逐行处理，命中叫车行起内容全部丢弃；若叫车卡与「常去地点」挤在同一行，做模块级清理只留常去地点那一个模块。**服务端自己的终止帧原样保留**，不自己补假帧（见下节）。

两处截断都带**兜底白名单**：万一哪天文案改了、关键词没命中，不会把整页清空，而是退回已知安全的白名单卡片（首页：继续导航 / 常去地点 / 登录卡；我的页：订单 / 入口行 / 语音车标 / 足迹）。

> ⚠️ 首页顶部工具栏（公交地铁、骑行、打车…）在叫车卡**上方**，属保留区。所以 `/ws/shield/scene/recommend` **没有**放进整包置空名单——放进去会把工具栏一起清掉。

## 两个线上 bug 的根因与修法

这两个 bug 都是「本地 mock 测不出来、只有真机才暴露」的类型，记录在这里免得再踩。

### 一、首页「网络不畅，请稍后重试」

**现象**：首页「探索本地」六个入口卡下面出现一个转圈图标 + 「网络不畅，请稍后重试」。

**根因**：推荐瀑布流（`/ws/info_bff/contentFeed`、`/ws/info_bff/ContentCenter`）的模块被置成了空数组：

```js
wf.data.list = [];   // ❌
```

高德把「有模块容器但 list 为空」判定成**加载失败**，于是渲染成重试占位。

**修法**：把整个模块删掉，让 App 认为压根没有这个区域：

```js
nuke(obj?.data?.modules, ["waterfall", "feed", "contentFeed", "waterfallList"]);
nuke(obj?.data, ["waterfall", "feed", "contentFeed", "waterfallList"]);
// 兜底：任何「有容器但 list 为空」的模块都删掉
```

**同类隐患**：AI 推荐流（SSE）也有一样的问题。旧逻辑命中叫车卡后 `cut=true`，循环末尾自己拼一个 `data: {"exist_risk":false,"is_done":true}` 当终止帧。但 App 认的是**服务端发的那一帧**（带 `id:` 的完整帧），伪造帧格式对不上就判加载失败，同样弹「网络不畅」。

修法改成**不截断流**：用 `pending` 数组暂存 `event:`/`id:`/空行，跟随后面第一条 `data:` 行一起决定去留；服务端自己的终止帧（含 `"is_done"` 或 `exist_risk`）原样保留，连它前面的 `event:` 行一起 push。探索页 AI 流同理，只留原流终止帧。

还有个细节：重写 `data:` 行时必须沿用原前缀。`"data:" + json` 会丢掉冒号后的空格，`"data: {...}"` 变成 `"data:{...}"`，部分 SSE 解析器会因此判帧非法。正确写法：

```js
out.push(line.slice(0, 5) + " " + JSON.stringify(j));
```

### 二、十来次里偶发一次开屏广告

**根因**：开屏分支照抄 Loon 的写法：

```js
item.set.setting.display_time = 0;
item.creative[0].start_time = 3818332800;   // ❌ 没有 creative[0] 就抛错
item.creative[0].end_time = 3818419199;
```

只要某次下发的广告结构里没有 `creative[0]`，就抛 TypeError。**脚本一抛错，Surge 就把原响应原样放行** —— 广告照播。这就是「十来次里偶发一次」的来源：大多数下发有 `creative[0]`，偶尔没有。

**修法**：两层防护

1. 逐层判空 + `try/catch` 包住，再把 `data.ad` / `data.ads` 整个数组清空（`= []`）
2. **脚本最外层加全局 `try/catch`**：任何分支抛错都 `$done({})` 原样放行，绝不把响应弄坏

```js
(function () {
  const url = $request.url;
  const raw = $response.body;
  try {
    // ...全部逻辑...
    $done({ body: JSON.stringify(obj) });
  } catch (e) {
    $done({});
  }
})();
```

> 这条经验通用：**在 Surge 脚本里，任何未捕获的异常都等于「模块失效」**。宁可少删一点，也不能让脚本抛错。

## 关键实现点

- 脚本用 IIFE 包裹，保证 `$done()` **只被调用一次**（先 `$done` 再继续执行会触发多次回调）
- 非 JSON / 空 body / `undefined` body 一律 `$done({})` 原样放行
- 开屏广告：先逐层判空改 `display_time=0` / `start_time`·`end_time` 推到 2090 年，再把 `data.ad` / `data.ads` 整个数组清空。**必须判空**，否则结构异常时抛 TypeError（见下节）
- 正则每个分支都带路径边界 `([?&\/]|$)`，避免 `/sug` 误吃 `/sug2`；以 `/` 结尾的分支（如 `/ws/banner/lists/`）不再追加边界
- **整包置空（EMPTY_OUT）判定放在 JSON.parse 之后的最前面**：否则 `/faas/amap-navigation/main-page-assets` 这类路径会被更宽的 `main-page` 分支抢先命中，导致置空失效
- **AI 推荐流是 SSE 文本流，不是 JSON**：必须在 JSON 解析之前单独分支处理，逐行解析 `data: {...}`

## 验证

- 脚本逻辑：本地 node 跑 14 项场景全 PASS（首页截断/兜底、我的页截断/兜底、SSE 保留终止帧、SSE 内容帧丢弃、SSE 帧结构完整、探索页只留终止帧、无终止帧时不造假帧、思考行丢弃、splash 无 creative 不崩、瀑布流删模块、非 JSON 放行、空 body 放行）
- **真机 Surge JS 引擎**用 `evaluate_script` 注入 mock 的 `$request`/`$response` 复核关键场景，输出与本地一致
- 正则：在真机引擎里 `new RegExp(pat).test(url)`，45 条目标 URL 全 HIT，7 条负例（`restapi.amap.com`、`www.amap.com`、`amap.com.evil.com`、`m5.amap.com/wsx/...` 等）全 MISS
- 模块：`list_scripts` 确认 5 条脚本已注册且 enabled

## 已知限制

- 只覆盖已验证存在的接口。高德换接口后需要补路径
- 若某条响应体超过 `max-size=1048576`（1MB）会被跳过——这是为了避免 iOS Network Extension 内存超限
- 与其它高德模块同时启用可能冲突（Surge 每个响应只跑第一条匹配的脚本）
- 首页偶发的「网络不畅」若仍出现，说明占位来自本文档未覆盖的接口，需要抓包补路径（Surge 6 的 MCP 没有响应体回读通道，`get_captured_body` 恒返回 `Data does not exist`）
- 底部 tab（首页/探索/长按说话/打车/我的）与搜索页分类行（美食/酒店/景点门票…）在任何响应体里都没有，属原生渲染，脚本改不了

## 出处

脚本字段级逻辑改写自 RuCu6 / ddgksf2013 的公开实现（原地址 `RuCu6/QuanX/Scripts/amap.js` 现已 404，现存镜像 `lugu123/Loon/Scripts/Amap_remove_ads.js`）。Loon 专有的 16 条 `reject-dict` 路径在本模块里改为「整包置空」等效实现。首页 AI 流与我的页新 key 参考了 `yisaings/surge` 的 2026-11 抓包结论。
