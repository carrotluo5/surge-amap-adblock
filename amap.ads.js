/*
 * 高德地图去广告 —— Surge http-response 脚本
 * ------------------------------------------------------------------
 * 适配：Surge iOS 6.x / Surge Mac 6.x
 * 触发：见 amap.sgmodule 的 [Script] 段
 * 逻辑：按 $request.url 分派，逐字段删除广告/推广/营销模块；
 *       整包为广告的接口直接返回 {}；
 *       未命中的接口原样返回。
 *
 * 出处与致谢：
 *   字段级分支逻辑来自 RuCu6（https://github.com/RuCu6/QuanX）的 amap.js，
 *   经 ddgksf2013（墨鱼手记）整理，版本 2024-09-03；字段名与分支保持原样。
 *   EMPTY_OUT 空包分支为本模块新增，用于替代 Loon 专有的 reject-dict。
 *
 * 说明：
 *   - 只处理 JSON 响应；非 JSON 原样放行。
 *   - 全部字段访问使用可选链，字段缺失不会抛错。
 *   - 若 JSON.parse 抛错，Surge 捕获异常并原样返回响应。
 * ------------------------------------------------------------------
 */

const EMPTY_OUT = [
  "/ws/aos/main/page/product/list",
  "/ws/faas/amap-navigation/card-service-car-end",
  "/ws/faas/amap-navigation/card-service-route-plan",
  "/ws/shield/search_poi/tips_adv",
  "/ws/banner/lists/",
  "/ws/faas/amap-navigation/main-page-assets",
  "/ws/faas/amap-navigation/main-page-location",
  "/ws/faas/amap-navigation/ridewalk-end-fc",
  "/ws/mapapi/hint_text/offline_data",
  "/ws/message/notice/list",
  "/ws/shield/search/new_hotword",
  "/ws/valueadded/weather/v2",
  "/ws/msgbox/pull_mp",
  "/ws/boss/order/car/king_toolbox_car_bubble",
  "/ws/boss/tips/onscene_visual_optimization",
];

// 2024-09-03 21:40

(function () {
  const url = $request.url;
  const raw = $response.body;

  // 任何分支抛错都原样放行：绝不能因为脚本异常把响应弄坏或让广告漏过判定
  try {

  // ---- AI 推荐流（SSE，非 JSON）：首页按行手术 ----
  if (url.indexOf("ai.amap.com") !== -1 && url.indexOf("/ai_rec/") !== -1) {
    if (!raw) {
      return $done({});
    }
    // 探索页 AI 流：只留原流里的终止帧，内容帧全丢。
    // 注意：终止帧必须是服务端原样的那一帧，自己拼一个假的会让 App 判为加载失败。
    if (url.indexOf("/ai_rec/home_explore") !== -1) {
      const keep = raw
        .split("\n")
        .filter((l) => l.indexOf("\"is_done\"") !== -1 || l.indexOf("exist_risk") !== -1);
      return $done({ body: keep.join("\n") + "\n" });
    }
    // 首页 AI 流：从「帮我叫一辆空气清新的车」那一帧起，内容全部清掉。
    //
    // 这里以前是「截断流 + 自己补一个终止帧」，结果首页会显示「网络不畅，请稍后重试」：
    // App 拿不到服务端原来那一帧 is_done，就把这半截 SSE 判成加载失败并弹重试。
    // 现在改成：内容帧照删，但服务端自己的终止帧原样保留，流结构是完整的。
    const lines = raw.split("\n");
    const out = [];
    const pending = []; // 暂存 event:/id:/空行，跟着下一条 data 行一起决定去留
    let cut = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf("data:") !== 0) {
        pending.push(line);
        continue;
      }
      const isTerminal = line.indexOf('"is_done"') !== -1 || line.indexOf("exist_risk") !== -1;
      if (isTerminal) {
        // 终止帧：连同它前面的 event:/空行一起原样保留
        for (const p of pending) out.push(p);
        pending.length = 0;
        out.push(line);
        continue;
      }
      let j;
      try {
        j = JSON.parse(line.slice(5));
      } catch (e) {
        if (!cut) {
          for (const p of pending) out.push(p);
          pending.length = 0;
          out.push(line);
        } else {
          pending.length = 0;
        }
        continue;
      }
      const comp = j.component || {};
      const inner = comp.data && comp.data.data;
      // AI 思考过程行：整行丢弃
      if (comp.type === "loading" || comp.think_type || (inner && inner.sub_type === "think")) {
        pending.length = 0;
        continue;
      }
      const isTaxi =
        line.indexOf("空气清新的车") !== -1 ||
        line.indexOf("叫一辆") !== -1 ||
        line.indexOf('"PmtContainer"') !== -1;
      if (isTaxi) {
        cut = true;
      }
      if (cut) {
        const mods = inner && inner.modules;
        if (mods && isTaxi) {
          // 叫车卡与「常去地点」可能挤在同一帧：只留含常去地点的模块
          for (const k of Object.keys(mods)) {
            let t = "";
            try {
              t = JSON.stringify(mods[k] || {});
            } catch (e) {
              t = "";
            }
            if (t.indexOf("常去地点") === -1) {
              delete mods[k];
            }
          }
          for (const p of pending) out.push(p);
          pending.length = 0;
          // 沿用原行的前缀（"data: " 带空格或 "data:" 不带），不自己重排
          out.push(line.slice(0, 5) + " " + JSON.stringify(j));
        } else {
          pending.length = 0; // 叫车卡本身及它下面的内容帧全部丢弃
        }
        continue;
      }
      for (const p of pending) out.push(p);
      pending.length = 0;
      out.push(line);
    }
    for (const p of pending) out.push(p);
    return $done({ body: out.join("\n") });
  }

  // 无 body / 非 JSON（HTML、图片、纯文本）一律原样放行
  if (!raw || !/^\s*[\{\[]/.test(raw)) {
    return $done({});
  }

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return $done({});
  }

  // 整包都是广告/推广资源的接口，直接返回空对象（等价 Loon 的 reject-dict）
  // 必须放在最前面：否则会被下面更宽的 includes 分支抢先命中而漏掉置空
  if (EMPTY_OUT.some((p) => url.includes(p))) {
    return $done({ body: "{}" });
  }

  if (url.includes("/aos/perception/publicTravel/beforeNavi")) {
    if (obj?.data?.common_data?.bus_plan_bottom_event?.data?.length > 0) {
      // 公交出行 底部卡路里数值
      obj.data.common_data.bus_plan_bottom_event.data = [];
    }
    if (obj?.data?.common_data?.bus_plan_segment_event?.data?.length > 0) {
      // 公交出行 中转站 卡路里数值
      obj.data.common_data.bus_plan_segment_event.data = [];
    }
    // 导航选择路线页面 左上角动图
    if (obj?.data?.front_end?.assistant?.length > 0) {
      obj.data.front_end.assistant = [];
    }
  } else if (url.includes("/boss/car/order/content_info")) {
    // 打车页面
    if (obj?.data?.lubanData?.skin?.dataList?.length > 0) {
      // oss营销皮肤
      obj.data.lubanData.skin.dataList = [];
    }
  } else if (url.includes("/boss/order_web/friendly_information")) {
    // 打车页面
    const items = ["banners", "carouselTips", "integratedBanners", "integratedTips", "skins", "skinAndTips", "tips"];
    if (obj?.data?.["105"]) {
      for (let i of items) {
        delete obj.data["105"][i];
      }
    }
  } else if (url.includes("/bus/plan/integrate")) {
    // 公交列表
    if (obj?.data?.banner_lists?.data?.length > 0) {
      // 公交列表 顶部滚动横图
      obj.data.banner_lists.data = [];
    }
    if (obj?.data?.banner_lists?.tips?.length > 0) {
      obj.data.banner_lists.tips = [];
    }
    if (obj?.data?.mixed_plans?.data?.taxiPlans?.length > 0) {
      // 公交列表 推广打车出行
      obj.data.mixed_plans.data.taxiPlans = [];
    }
  } else if (url.includes("/c3frontend/af-hotel/page/main")) {
    // 酒店/民宿 景区门票 火车/飞机
    if (obj?.data?.modules?.CouponPortalCard) {
      // 横幅推广
      delete obj.data.modules.CouponPortalCard;
    }
    if (obj?.data?.modules?.CouponWidget) {
      // 右下角活动悬浮窗
      delete obj.data.modules.CouponWidget;
    }
    if (obj?.data?.modules?.recommended_list) {
      // 高德建议
      delete obj.data.modules.recommended_list;
    }
    if (obj?.data?.modules?.user_filter_card) {
      const items = [
        "banner", // 大横幅
        "bannerList", // 滚动横幅推广
        "service_data", // 全网比价 退订便捷 入住保障 资质规则
        "sug_items_data" // 高德建议
      ];
      if (obj?.data?.modules?.user_filter_card?.data) {
        for (let i of items) {
          delete obj.data.modules.user_filter_card.data[i];
        }
        if (obj?.data?.modules?.user_filter_card?.data?.search_button_data?.rightbgText) {
          // 查询按钮右上角角标
          delete obj.data.modules.user_filter_card.data.search_button_data.rightbgText;
        }
      }
    }
  } else if (url.includes("/c3frontend/af-launch/page/main")) {
    // 步行导航结束推广卡片
    if (obj?.data?.modules?.C1EndNaviEngine?.data) {
      obj.data.modules.C1EndNaviEngine.data = {};
    }
  } else if (url.includes("/faas/amap-navigation/card-service-plan-home")) {
    // 路线规划页
    if (obj?.data?.children?.length > 0) {
      // 有schema参数的为推广
      obj.data.children = obj.data.children.filter((i) => !i.hasOwnProperty("schema"));
    }
  } else if (url.includes("/faas/amap-navigation/main-page-aiqs")) {
    // 首页地图图层：只删酒店与营销类图标，其余保留
    if (obj?.data?.mapBizList?.length > 0) {
      const DROP_ICONS = {
        SddTileOffsiteHotel: 1,
        OffsiteHotel: 1, // 酒店
        "淄博烧烤POI": 1,
        sdd_tile_HotSpring_SKU: 1,
        StarbucksStreetSend: 1,
        CategoryYoungRecommend: 1,
        MerchantGuidance: 1,
        RandomPoints: 1,
        Personalise: 1,
        Onsite: 1,
        Offsite: 1,
        Hqyc: 1,
        UGCHotEventCard: 1,
        UGCGovCard: 1,
        RenderCPTHouse: 1,
        Kids: 1,
        Winter: 1,
        SpringV2: 1,
        Covid: 1,
        CovidMerge: 1,
        Epidemic: 1
      };
      obj.data.mapBizList = obj.data.mapBizList.filter((i) => !DROP_ICONS[i?.dataKey]);
    }
  } else if (url.includes("/faas/amap-navigation/main-page")) {
    // 首页：从「帮我叫一辆空气清新的车」那张卡开始（含它本身）往下全部去掉
    if (obj?.data?.cardList?.length > 0) {
      const kept = [];
      let hit = false;
      for (const card of obj.data.cardList) {
        let text = "";
        try {
          text = JSON.stringify(card);
        } catch (e) {
          text = "";
        }
        if (
          text.indexOf("空气清新的车") !== -1 ||
          text.indexOf("叫一辆") !== -1 ||
          text.indexOf("臭车") !== -1
        ) {
          hit = true;
          break; // 命中叫车推广卡，它和它下面的都不要
        }
        kept.push(card);
      }
      if (hit) {
        obj.data.cardList = kept;
      } else {
        // 没命中（文案改了/接口结构变了）：退回白名单，至少保证营销卡不出现
        obj.data.cardList = obj.data.cardList.filter(
          (i) =>
            i?.dataKey === "ContinueNavigationCard" || // 继续导航
            i?.dataKey === "FrequentLocation" || // 常去地点
            i?.dataKey === "LoginCard" // 登陆卡片
        );
      }
    }
    if (obj?.data?.mapBizList?.length > 0) {
      obj.data.mapBizList = obj.data.mapBizList.filter(
        (i) => i?.dataKey === "FindCarVirtualCard" // 显示关联车辆位置
      );
    }
  } else if (url.includes("/info_bff/contentFeed") || url.includes("/info_bff/ContentCenter")) {
    // 首页内容流：天气卡、打车优惠券、扫街榜瀑布、问问 AI、关注/推荐/附近 tab 与达人卡
    //
    // 两个坑，都踩过：
    // 1) 只把 modules.xxx.data.list 置空 —— App 会把「有模块容器但数据为空」判成
    //    加载失败，在首页渲染「网络不畅，请稍后重试」。
    // 2) 只删 modules 里的键 —— App 的渲染清单是 data.regions，regions 里还留着
    //    waterfall / recommendUser，App 就会拿本地缓存的模块继续渲染，
    //    于是卡片「重新出现」。所以 regions 必须一起清空。
    if (obj && obj.data && typeof obj.data === "object") {
      obj.data.modules = {};
      obj.data.regions = {};
    }
  } else if (url.includes("/perception/drive/routeInfo")) {
    // 导航详情页
    if (obj?.data?.tbt?.event?.length > 0) {
      obj.data.tbt.event = obj.data.tbt.event.filter((i) => !/ads-\d+/.test(i?.dynamic_id_s));
    }
    if (obj?.data?.front_end) {
      if (obj?.data?.front_end?.guide_tips?.length > 0) {
        // 音乐底栏
        obj.data.front_end.guide_tips = obj.data.front_end.guide_tips.filter((i) => i?.biz_type !== "music");
      }
      if (obj?.data?.front_end?.assistant) {
        // 助手皮肤
        delete obj.data.front_end.assistant;
      }
      if (obj?.data?.front_end?.download?.length > 0) {
        // 导航插播语音广告
        obj.data.front_end.download = obj.data.front_end.download.filter((i) => !/ads-\d+/.test(i?.dynamic_id_s));
      }
    }
  } else if (url.includes("/perception/drive/routePlan")) {
    // 路线规划页
    const items = [
      "assistant", // 左上角悬浮动图
      "global_guide_data",
      "route_search",
      "start_button_tips" // 开始导航 悬浮提示 全国车道级
    ];
    if (obj?.data?.front_end) {
      for (let i of items) {
        delete obj.data.front_end[i];
      }
    }
    if (obj?.data?.tbt?.event?.length > 0) {
      // 导航插播语音广告
      obj.data.tbt.event = obj.data.tbt.event.filter((i) => !/ads-\d+/.test(i?.dynamic_id_s));
    }
    if (obj?.data?.front_end?.download?.length > 0) {
      // 导航插播语音广告
      obj.data.front_end.download = obj.data.front_end.download.filter((i) => !/ads-\d+/.test(i?.dynamic_id_s));
    }
  } else if (url.includes("/promotion-web/resource")) {
    // 打车页面
    const items = [
      "alpha", // 出行优惠套餐
      "banner",
      "bravo", // 第三方推广 喜马拉雅月卡
      "bubble",
      "charlie", // 横版推广 单单立减 领专属优惠 体验问卷
      "icon",
      "other",
      "popup",
      "push", // 顶部通知 发单立享优惠
      "tips"
    ];
    if (obj?.data) {
      for (let i of items) {
        delete obj.data[i];
      }
    }
  } else if (url.includes("/sharedtrip/taxi/order_detail_car_tips")) {
    // 打车页
    if (obj.data?.carTips?.data?.popupInfo) {
      delete obj.data.carTips.data.popupInfo;
    }
  } else if (url.includes("/shield/dsp/profile/index/nodefaasv3")) {
    // 我的页面：从「达人任务」那张卡开始（含它本身）往下全部去掉
    if (obj?.data?.cardList?.length > 0) {
      const kept = [];
      let hit = false;
      for (const card of obj.data.cardList) {
        let text = "";
        try {
          text = JSON.stringify(card);
        } catch (e) {
          text = "";
        }
        if (text.indexOf("达人任务") !== -1) {
          hit = true;
          break; // 命中「达人任务」，它和它下面的都不要
        }
        kept.push(card);
      }
      // 兜底：万一没命中关键词，退回白名单，至少保证营销卡不出现
      if (!hit) {
        obj.data.cardList = obj.data.cardList.filter(
          (i) =>
            i?.dataKey === "MyOrderCard" ||
            i?.dataKey === "MineNewBEntranceCardV4" ||
            i?.dataKey === "MineNewVirtualAssetCardV3" ||
            i?.dataKey === "MineNewFootprintCard"
        );
      } else {
        obj.data.cardList = kept;
      }
    }
    if (obj?.data?.tipData) {
      delete obj.data.tipData;
    }
    // 足迹
    // if (obj.data.footPrintV2) {
    //   delete obj.data.footPrintV2;
    // }
    // 成就勋章 lv1见习达人
    if (obj?.data?.memberInfo) {
      delete obj.data.memberInfo;
    }
    if (obj?.data?.topMixedCard) {
      // 顶部足迹、贡献卡片
      delete obj.data.topMixedCard;
    }
  } else if (url.includes("/shield/frogserver/aocs/updatable/")) {
    // 整体图层
    const items = [
      "Naviendpage_Searchwords",
      "SplashScreenControl",
      "TipsTaxiButton", // 选路线页面 打车图标
      "amapCoin",
      "favorites_info", // 收藏夹顶部横图推广
      "feedback_banner", // 店主专属通道
      "footprint", // 足迹
      "his_input_tip",
      "home_business_position_config", // 首页右上角动图
      "hotel_activity",
      "hotel_fillin_opt",
      "hotel_loop",
      // "hotel_portal", // 附近-酒店-页面布局
      "hotel_tipsicon",
      "hotsaleConfig", // 酒店限时抢购
      "landing_page_info", // 发现吃喝玩乐好去处
      "map_weather_switch", // 天气
      "maplayers", // 赏花地图
      "navi_end", // 导航结束 领油滴
      "nearby_business_popup",
      "nearby_map_entry_guide",
      "nearby_map_pull_down_guide",
      "operation_layer", // 首页右上角图层
      "poi_rec",
      "preword",
      "route_banner", // 搜索路线 免费抽机票
      "routeresult_banner",
      "search_homepage",
      "search_keyword",
      "search_moni",
      "search_perf",
      "search_poi_recommend",
      "search_service_adcode",
      "search_word",
      "sportsGroupConfig",
      "sportsHealthConfig",
      "sportsHomeConfig",
      "sportsRouteConfig",
      "sportsTaskConfig",
      "sports_walk",
      "small_biz_b2b_kb", // 入驻高德
      "small_biz_case", // 推广
      "small_biz_fun",
      "small_biz_index",
      "small_biz_news",
      "splashscreen",
      "splashview_config",
      "sur_bar", // 十一特惠
      "taxi_activity", // 打车活动
      "testflight_adiu",
      "tf_remind", // tf测试版
      "tips_bar_black_list",
      "vip"
    ];
    if (obj?.data) {
      for (let i of items) {
        if (obj?.data?.[i]) {
          obj.data[i] = { status: 1, version: "", value: "" };
        }
      }
    }
  } else if (url.includes("/shield/search/common/coupon/info")) {
    if (obj?.data) {
      obj.data = {};
    }
  } else if (url.includes("/shield/search/nearbyrec_smart")) {
    // 附近页面
    const items = ["head", "search_hot_words", "feed_rec"];
    if (obj?.data?.modules?.length > 0) {
      if (obj?.data?.modules?.length > 0) {
        obj.data.modules = obj.data.modules.filter((i) => items?.includes(i));
      }
    }
  } else if (url.includes("/shield/search/poi/detail")) {
    // 搜索结果 模块详情
    const items = [
      "CouponBanner", // 高德红包
      // "anchor",
      "adv_compliance_info", // 服务提供方
      "adv_gift",
      // "base_info",
      "bigListBizRec", // 周边景点推荐 三张景点大图
      "bottomDescription", // 底部描述 高德酒店 全网比价
      // "brand_introduction",
      "brand_shop_bar",
      // "brand_story",
      "checkIn",
      "check_in", // 足迹打卡
      "cityCardFeed", // 景点卡片
      // "cityPhoto", // 城市照片
      "city_discount", // 专业老师在线答疑
      "claim", // 立即认领 管理店铺
      "co_branded_card",
      "collector_guide", // 游玩的图文指南
      "common_coupon_bar", // 领券条幅 新客专享 省钱卡
      "common_coupon_card", // 优惠券卡片
      // "companyInfo", // 简介
      "comprehensiveEditEntrance", // 编辑地点信息
      // "consultancy",
      "contributor", // 地点贡献
      // "coupon_allowance",
      // "coupon_entrance",
      "cpt_service_shop", //买卖二手房
      // "craftsman_entry",
      // "crowd_index", // 人流量情况
      "dayTripList", // 热门一日游
      // "detailFeedCommodity",
      // "detail_bottom_shop_service",
      "discount_commodity", // 优惠团购
      "divergentRecommendModule", // 你可能还喜欢
      // "evaluate", // 高德出行评分
      // "events",
      "everyOneToSee", // 大家还在看
      "feedback", // 问题反馈
      "first_surround_estate_tab", // 周边小区
      // "floor_guide_second", // 楼层导览
      // "footer_logo",
      // "foreclosurehouse",
      // "gallery_info", // 现场照片
      // "ggc_entry",
      // "hkfMiniPortal", // 订票页面 飞机 火车 汽车
      "horizontalGoodsShelf",
      "hotPlay", // 热门玩法
      "hot_new_house_estate",
      "hot_shop",
      "hotelCoupon",
      "hotelList", // 热门酒店
      "hotelMustRead", // 订房必读
      // "hotelRooms", // 酒店所有房间
      // "hourHotelRooms", // 钟点房
      "houseList",
      "houseOfficeBrandIntroduction",
      "houseOfficeInfo",
      "houseOfficeNotice",
      "houseOfficeService",
      "house_apart_info",
      "house_buying_agent",
      "house_coupon",
      "house_cp_clues",
      "house_cpt_coupon",
      "house_cpt_grab",
      "house_price",
      "house_rent_sale_agency",
      // "human_traffic", // 人流量情况 有统计图
      "image_banner",
      "kaMarketingCampaign", // 附近品牌动态
      "kaProductMixServiceShelf", // 骑手送药上门
      "ka_not_enter", // 移动办卡 套餐服务
      "legSameIndustryRecEntrance", // 全城最热景点推荐
      "legal_document", // 房源法律信息
      "listBizRec_1",
      "listBizRec_2", // 周边餐饮
      "matrix_banner", // 高德车服
      "merchantSettlement", // 商家店铺管理
      "membership", // 高德菲住卡 会员项目
      "mini_hook_shelf", // 购票迷你模块
      "movie_info", // 优惠购票 景点宣传片
      "multi_page_anchor", // 二级导航菜单 门票 评论 推荐
      // "navbarMore", // 右上角三点
      "nearbyGoodCar", // 附近热门新车
      "nearbyRecommendModule", // 周边推荐
      "nearby_house",
      "nearby_new_house_estate",
      "nearby_office_estate",
      "nearby_old_sell_estate",
      "nearby_play_rec", // 附近玩乐项目
      "newGuest", // 新客专享
      "newRelatedRecommends", // 探索周边
      "new_operation_banner", // 精选活动 高德的推广
      "newsellhouse",
      // "normal_nav_bar", // 右上角图标 客服 反馈
      // "notification",
      "officerenthouse",
      "officesellhouse",
      "official_account", // 其他平台官方账号
      "oldsellhouse",
      // "opentime", // 营业时间
      "operation_banner", // 横版图片推广
      "operator_card",
      "packageShelf", // 附近酒景推荐
      "parentBizRec",
      "parentPoiRecEntrance", // 所在商圈
      "platformCustomerCommonModule", // 众安保险赔付
      "platformCustomerComplianceInfo", // 保险公司信息
      "poiDetailWaterFeed", // 附近景点瀑布流 新
      "poiDetailWaterFeedTitle", // 更多人气好去处 新
      "poster_banner",
      // "poi_intercept",
      "portal_entrance", // 高德旅游版块 引流到旅游频道
      // "question_answer_card", // 问问 地点附近的热门问题
      "quickLink", // 地点详情页图标 酒店 景点 热榜
      "relatedRecommends", // 附近同类型酒店
      // "realtorRealStep",
      "renthouse",
      "rentsaleagencyv2",
      "rentsaleagencyv3",
      "rentsalehouse",
      "residentialOwners", // 小区业主
      "reviews", // 用户评价
      // "roomSelect", // 选择订房日期 悬浮菜单
      "sameIndustryRecommendModule",
      "sameIndustry2RecommendModule",
      // "same_price_new_estate",
      "scenic_coupon", // 优惠券过期提示
      "scenic_filter", // 购票悬浮菜单 可定明日 随时退
      // "scenic_guide",
      // "scenic_helper", // 景区助手 开放时间 旺季 淡季
      // "scenic_knowledge",
      "scenic_lifeservices", // 吃住购娱 餐厅 购物
      "scenic_mustplay", // 必游景点 四张景点大图
      // "scenic_parking",
      "scenic_play_guide", // 景区攻略 游玩攻略 交通攻略
      "scenic_recommend", // 景点建议
      // "scenic_route",
      // "scenic_route_intelligent", // 推荐游玩线路
      // "scenic_service",
      // "scenic_ski", // 滑雪攻略 雪道数量 设施及服务
      // "scenic_story",
      // "scenic_ticket", // 购票
      // "scenic_ticket_activity", // 购票活动
      "scenic_voice", // 语音讲解 付费的项目
      "searchPlaMap", // 周边推荐
      "second_surround_estate_tab", // 周边房产
      "service_shop", // 中介门店
      // "shop_news",
      "smallListBizRec", // 周边热门酒店
      "smallOrListBizRec",
      "surroundHouseTab", //周边房源
      "surroundOldSellHouse", // 同城二手房
      "surroundRentHouse", // 附近租房
      "surround_facility",
      "surround_facility_new",
      "surround_house_tab",
      "surround_oldsellhouse",
      "surround_renthouse",
      "surround_rentoffice",
      "surround_selloffice",
      "thirdparty_info", // 第三方信息
      // "traffic", // 交通出行 地铁站 公交站 停车场
      "travelGuideRec", // 人气景点 路线 购票
      "uploadBar",
      "upload_bar", // 上传照片
      "verification", // 商家已入驻
      // "video",
      "waistRecEntrance", // 更多人气好去处
      "waterFallFeed", // 附近景点瀑布流
      "waterFallFeedTitle" // 更多人气好去处
    ];
    if (obj?.data?.modules) {
      for (let i of items) {
        delete obj.data.modules[i];
      }
    }
  } else if (url.includes("/shield/search_bff/hotword")) {
    // 搜索框 热榜logo
    if (obj?.data?.headerHotWord?.length > 0) {
      obj.data.headerHotWord = [];
    }
  } else if (url.includes("/shield/search_business/process/marketingOperationStructured")) {
    // 详情页 顶部优惠横幅
    if (obj?.data?.tipsOperationLocation) {
      delete obj.data.tipsOperationLocation;
    }
    if (obj?.data?.resourcePlacement) {
      delete obj.data.resourcePlacement;
    }
  } else if (url.includes("/shield/search_poi/homepage")) {
    // 首页 搜索框历史记录 推广标签
    if (obj?.history_tags) {
      delete obj.history_tags;
    }
  } else if (url.includes("/shield/search_poi/search/sp") || url.includes("/shield/search_poi/mps")) {
    if (obj?.data?.list_data) {
      let list = obj.data.list_data.content[0];
      // 详情页 底部 房产推广
      if (list?.hookInfo) {
        let hookData = list.hookInfo.data;
        if (hookData?.header) {
          delete hookData.header;
        }
        if (hookData?.house_info) {
          delete hookData.house_info;
        }
      }
      // 详情页 底部 订酒店
      if (list?.map_bottom_bar?.hotel) {
        delete list.map_bottom_bar.hotel;
      }
      if (list?.poi?.item_info?.tips_bottombar_button?.hotel) {
        delete list.poi.item_info.tips_bottombar_button.hotel;
      }
      // 地图优惠推广
      if (list?.map?.main_point) {
        delete list.map.main_point;
      }
      if (list?.tips_operation_info) {
        delete list.tips_operation_info;
      }
      if (list?.bottom?.bottombar_button?.hotel) {
        delete list.bottom.bottombar_button.hotel;
      }
      // 搜索页 顶部卡片
      if (list?.card?.card_id === "SearchCardBrand" && list?.item_type === "brandAdCard") {
        delete list.card;
      }
      if (list?.card?.card_id === "NearbyGroupBuy" && list?.item_type === "toplist") {
        delete list.card;
      }
      if (list?.card?.card_id === "ImageBanner" && list?.item_type === "ImageBanner") {
        delete list.card;
      }
    } else if (obj?.data?.district?.poi_list) {
      // 搜索列表详情页
      let poi = obj.data.district.poi_list[0];
      // 订票横幅
      if (poi?.transportation) {
        delete poi.transportation;
      }
      // 景点门票 酒店特惠 特色美食 休闲玩乐
      if (poi?.feed_rec_tab) {
        delete poi.feed_rec_tab;
      }
    } else if (obj?.data?.modules) {
      if (obj?.data?.modules?.not_parse_result?.data?.list_data) {
        let list = obj.data.modules.not_parse_result.data.list_data.content[0];
        // 详情页 底部 房产推广
        if (list?.hookInfo) {
          let hookData = list.hookInfo.data;
          if (hookData?.header) {
            delete hookData.header;
          }
          if (hookData?.house_info) {
            delete hookData.house_info;
          }
        }
        // 详情页 底部 订酒店
        if (list?.map_bottom_bar?.hotel) {
          delete list.map_bottom_bar.hotel;
        }
        if (list?.poi?.item_info?.tips_bottombar_button?.hotel) {
          delete list.poi.item_info.tips_bottombar_button.hotel;
        }
        // 地图优惠推广
        if (list?.map?.main_point) {
          delete list.map.main_point;
        }
        // 左上角动图推广
        if (list?.tips_operation_info) {
          delete list.tips_operation_info;
        }
        if (list?.bottom?.bottombar_button?.hotel) {
          delete list.bottom.bottombar_button.hotel;
        }
      }
      if (obj?.data?.modules?.list_data?.data) {
        // 搜索列表
        let list = obj.data.modules.list_data.data;
        if (list?.content?.length > 0) {
          // brandAdCard广告卡片 toplist_al人气榜单 高德指南
          list.content = list.content.filter((i) => !["brandAdCard", "toplist_al"]?.includes(i?.item_type));
        }
      }
    }
  } else if (url.includes("/shield/search_poi/sug")) {
    if (obj?.tip_list) {
      let newLists = [];
      if (obj?.tip_list?.length > 0) {
        for (let item of obj.tip_list) {
          if (
            ["12"]?.includes(item?.tip?.datatype_spec) ||
            ["ad", "poi_ad", "toplist"]?.includes(item?.tip?.result_type) ||
            ["ad", "exct_query_sug_merge_theme", "query_sug_merge_theme", "sp"]?.includes(item?.tip?.task_tag)
          ) {
            continue;
          } else {
            newLists.push(item);
          }
        }
        obj.tip_list = newLists;
      }
    } else if (obj?.city_list) {
      let newLists = [];
      if (obj?.city_list?.length > 0) {
        for (let item of obj.city_list) {
          let newTips = [];
          if (item?.tip_list?.length > 0) {
            for (let ii of item.tip_list) {
              if (["12"]?.includes(ii?.tip?.datatype_spec)) {
                continue;
              } else if (["ad", "poi_ad"]?.includes(ii?.tip?.result_type)) {
                continue;
              } else {
                newTips.push(ii);
              }
            }
            item.tip_list = newTips;
          }
          newLists.push(item);
        }
        obj.city_list = newLists;
      }
    }
  } else if (url.includes("/shield/search_poi/tips_operation_location")) {
    // 搜索页面 底部结果上方窄横幅
    if (obj?.data?.coupon) {
      delete obj.data.coupon;
    }
    const items = [
      "belt",
      "common_float_bar",
      "common_image_banner",
      "coupon_discount_float_bar",
      "coupon_float_bar",
      "discount_coupon",
      "image_cover_bar",
      "mood_coupon_banner",
      "operation_brand",
      "promotion_wrap_card",
      "tips_top_banner"
    ];
    if (obj?.data?.modules) {
      for (let i of items) {
        delete obj.data.modules[i];
      }
    }
  } else if (url.includes("/valueadded/alimama/splash_screen")) {
    // 开屏广告：直接把广告数组清空。
    // 原来照抄 Loon 的「把 creative[0].start_time 改成 2090 年」，但只要某次下发的
    // 广告结构里没有 creative[0] 就会抛 TypeError，整个脚本作废、原响应直通 → 广告照播。
    // 这就是「十来次里偶发一次开屏广告」的根因。
    if (obj?.data) {
      const kill = (item) => {
        try {
          if (item && item.set && item.set.setting) {
            item.set.setting.display_time = 0;
          }
          if (item && Array.isArray(item.creative) && item.creative[0]) {
            item.creative[0].start_time = 3818332800;
            item.creative[0].end_time = 3818419199;
          }
        } catch (e) {}
      };
      if (Array.isArray(obj.data.ad)) {
        obj.data.ad.forEach(kill);
        obj.data.ad = [];
      }
      if (Array.isArray(obj.data.ads)) {
        obj.data.ads.forEach(kill);
        obj.data.ads = [];
      }
    }
  }

    $done({ body: JSON.stringify(obj) });
  } catch (e) {
    $done({});
  }
})();
