(function () {
  var html = document.documentElement;
  var ua = navigator.userAgent || "";
  var isPcWeChat = /WindowsWechat|MacWechat|WeChatForWindows|WeChatForMac/i.test(ua);
  var isMobile = !isPcWeChat && /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
  if (!isMobile) return;

  html.classList.add("is-phone");

  var iframeW = 0;
  var iframeH = 0;
  var lastKey = "";
  var ios = /iPhone|iPad|iPod/i.test(ua);

  function deviceCssWidth() {
    var sw = screen.width || 0;
    var sh = screen.height || 0;
    var portrait = true;
    if (typeof window.orientation === "number") {
      portrait = Math.abs(window.orientation) !== 90;
    } else if (window.matchMedia) {
      portrait = window.matchMedia("(orientation: portrait)").matches;
    } else {
      portrait = (window.innerHeight || 1) >= (window.innerWidth || 0);
    }
    var w = portrait ? Math.min(sw, sh) || sw : Math.max(sw, sh) || sw;
    var dpr = window.devicePixelRatio || 1;
    if (w > 720 && dpr > 1) w = Math.round(w / dpr);
    if (w < 280) w = 360;
    if (w > 540) w = portrait ? 430 : 780;
    return w;
  }

  function resetStyles() {
    html.classList.remove("in-embed");
    html.style.zoom = "";
    html.style.transform = "";
    html.style.transformOrigin = "";
    html.style.width = "";
    html.style.height = "";
    html.style.overflow = "";
    html.style.removeProperty("--embed-w");
    html.style.removeProperty("--embed-h");
    html.style.removeProperty("--embed-scale");
    if (document.body) {
      document.body.style.width = "";
      document.body.style.height = "";
      document.body.style.minHeight = "";
      document.body.style.overflow = "";
    }
    lastKey = "";
  }

  function apply() {
    var layoutW = window.innerWidth || html.clientWidth || 0;
    var layoutH = window.innerHeight || html.clientHeight || 0;
    if (layoutW <= 0 || layoutH <= 0) return;

    if (html.classList.contains("in-embed") && iframeW > 0) {
      if (layoutW < iframeW * 0.9) {
        layoutW = iframeW;
        layoutH = iframeH || layoutH;
      } else {
        iframeW = layoutW;
        iframeH = layoutH;
      }
    } else {
      iframeW = layoutW;
      iframeH = layoutH;
    }

    var targetW = deviceCssWidth();
    if (layoutW <= targetW + 48) {
      if (html.classList.contains("in-embed")) resetStyles();
      return;
    }

    var scale = layoutW / targetW;
    if (scale < 1.08) {
      if (html.classList.contains("in-embed")) resetStyles();
      return;
    }

    var targetH = layoutH / scale;
    var key = targetW + "x" + targetH.toFixed(1) + "x" + scale.toFixed(4);
    if (key === lastKey) return;
    lastKey = key;

    html.classList.add("in-embed");
    html.style.setProperty("--embed-w", String(targetW));
    html.style.setProperty("--embed-h", String(targetH));
    html.style.setProperty("--embed-scale", String(scale));
    html.style.width = targetW + "px";
    html.style.height = targetH + "px";
    html.style.overflow = "hidden";
    html.style.transformOrigin = "0 0";

    if (!ios && "zoom" in html.style) {
      html.style.transform = "";
      html.style.zoom = String(scale);
    } else {
      html.style.zoom = "";
      html.style.transform = "scale(" + scale + ")";
    }

    if (document.body) {
      document.body.style.width = targetW + "px";
      document.body.style.height = targetH + "px";
      document.body.style.minHeight = targetH + "px";
      document.body.style.overflow = "hidden";
    }
  }

  apply();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  }
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", function () {
    iframeW = 0;
    iframeH = 0;
    resetStyles();
    html.classList.add("is-phone");
    setTimeout(apply, 220);
  });
})();
