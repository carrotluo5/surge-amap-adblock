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
- **首页 AI 流**：SSE 逐行处理，命中叫车行的位置起截断；若叫车卡与「常去地点」挤在同一行，做模块级清理只留常去地点那一个模块；结尾补 `data: {"exist_risk":false,"is_done":true}` 让流正常收尾。

两处截断都带**兜底白名单**：万一哪天文案改了、关键词没命中，不会把整页清空，而是退回已知安全的白名单卡片（首页：继续导航 / 常去地点 / 登录卡；我的页：订单 / 入口行 / 语音车标 / 足迹）。

> ⚠️ 首页顶部工具栏（公交地铁、骑行、打车…）在叫车卡**上方**，属保留区。所以 `/ws/shield/scene/recommend` **没有**放进整包置空名单——放进去会把工具栏一起清掉。

## 关键实现点

- 脚本用 IIFE 包裹，保证 `$done()` **只被调用一次**（先 `$done` 再继续执行会触发多次回调）
- 非 JSON / 空 body / `undefined` body 一律 `$done({})` 原样放行
- 开屏广告不是删除，而是把 `display_time` 置 0、`start_time`/`end_time` 推到 2090 年（删了会崩）
- 正则每个分支都带路径边界 `([?&\/]|$)`，避免 `/sug` 误吃 `/sug2`；以 `/` 结尾的分支（如 `/ws/banner/lists/`）不再追加边界
- **整包置空（EMPTY_OUT）判定放在 JSON.parse 之后的最前面**：否则 `/faas/amap-navigation/main-page-assets` 这类路径会被更宽的 `main-page` 分支抢先命中，导致置空失效
- **AI 推荐流是 SSE 文本流，不是 JSON**：必须在 JSON 解析之前单独分支处理，逐行解析 `data: {...}`

## 验证

- 脚本逻辑：在**真机 Surge JS 引擎**里用 `evaluate_script` 注入 mock 的 `$request`/`$response` 跑完整脚本，12 个场景全部符合预期（首页截断 / 首页兜底 / 我的页截断 / 我的页兜底 / SSE 同行 / SSE 分行 / 探索页置空 / 瀑布流清空 / 整包置空 / 非 JSON 放行 / 无 body 放行 / 工具栏保留）
- 正则：在真机引擎里 `new RegExp(pat).test(url)`，45 条目标 URL 全 HIT，7 条负例（`restapi.amap.com`、`www.amap.com`、`amap.com.evil.com`、`m5.amap.com/wsx/...` 等）全 MISS
- 模块：`list_scripts` 确认 5 条脚本已注册且 enabled

## 已知限制

- 只覆盖已验证存在的接口。高德换接口后需要补路径
- 若某条响应体超过 `max-size=1048576`（1MB）会被跳过——这是为了避免 iOS Network Extension 内存超限
- 与其它高德模块同时启用可能冲突（Surge 每个响应只跑第一条匹配的脚本）
- 底部 tab（首页/探索/长按说话/打车/我的）与搜索页分类行（美食/酒店/景点门票…）在任何响应体里都没有，属原生渲染，脚本改不了

## 出处

脚本字段级逻辑改写自 RuCu6 / ddgksf2013 的公开实现（原地址 `RuCu6/QuanX/Scripts/amap.js` 现已 404，现存镜像 `lugu123/Loon/Scripts/Amap_remove_ads.js`）。Loon 专有的 16 条 `reject-dict` 路径在本模块里改为「整包置空」等效实现。首页 AI 流与我的页新 key 参考了 `yisaings/surge` 的 2026-11 抓包结论。
