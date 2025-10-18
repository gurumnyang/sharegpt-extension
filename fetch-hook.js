// fetch-hook.js — intercept ChatGPT conversation fetch calls and adjust payload
(() => {
  const originalFetch = window.fetch;
  const TARGET_REGEX =
    /^https:\/\/chatgpt\.com\/backend-api\/(?:f\/)?conversation(?:$|[/?])/;

  function secondsSinceTopOfHourUtcMinus9() {
    const now = new Date();
    const tzMinus9 = new Date(now.getTime() - 9 * 60 * 60 * 1000);
    return tzMinus9.getUTCMinutes() * 60 + tzMinus9.getUTCSeconds();
  }

  function cloneInitFromRequest(request, init) {
    const cloned = { ...(init || {}) };
    if (!request) return cloned;

    if (cloned.method == null && request.method) cloned.method = request.method;

    if (cloned.headers == null && request.headers) {
      try {
        cloned.headers = new Headers(request.headers);
      } catch {
        cloned.headers = request.headers;
      }
    }

    if (cloned.credentials == null) cloned.credentials = request.credentials;
    if (cloned.mode == null) cloned.mode = request.mode;
    if (cloned.cache == null) cloned.cache = request.cache;
    if (cloned.redirect == null) cloned.redirect = request.redirect;
    if (cloned.referrer == null) cloned.referrer = request.referrer;
    if (cloned.referrerPolicy == null) cloned.referrerPolicy = request.referrerPolicy;
    if (cloned.integrity == null) cloned.integrity = request.integrity;
    if (cloned.keepalive == null) cloned.keepalive = request.keepalive;
    if (cloned.signal == null) cloned.signal = request.signal;

    return cloned;
  }

  window.fetch = async function (input, init) {
    let url = '';
    if (typeof input === 'string') url = input;
    else if (input instanceof Request) url = input.url;
    else if (input && typeof input.url === 'string') url = input.url;

    let requestInfo = input;
    let requestInit = init;

    try {
      if (url && TARGET_REGEX.test(url)) {
        const requestObj = input instanceof Request ? input : null;
        const baseInit = cloneInitFromRequest(requestObj, init);

        let method = baseInit.method || (requestObj && requestObj.method) || 'GET';
        method = typeof method === 'string' ? method.toUpperCase() : 'GET';

        if (method === 'POST') {
          let bodyText =
            typeof baseInit.body === 'string'
              ? baseInit.body
              : null;

          if (!bodyText && requestObj) {
            try {
              bodyText = await requestObj.clone().text();
            } catch {
              bodyText = null;
            }
          }

          if (typeof bodyText === 'string' && bodyText) {
            try {
              const payload = JSON.parse(bodyText);
              if (
                payload &&
                payload.client_contextual_info &&
                typeof payload.client_contextual_info === 'object'
              ) {
                const context = { ...payload.client_contextual_info };
                context.is_dark_mode = true;
                context.page_height = 980;
                context.page_width = 1862;
                context.pixel_ratio = 1.375;
                context.screen_height = 1152;
                context.screen_width = 2048;
                context.time_since_loaded = secondsSinceTopOfHourUtcMinus9();
                payload.client_contextual_info = context;

                baseInit.body = JSON.stringify(payload);
                baseInit.method = method;
                requestInfo = url;
                requestInit = baseInit;
              }
            } catch (error) {
              console.warn('[FetchHook] Failed to adjust conversation payload:', error);
            }
          }
        }
      }
    } catch (error) {
      console.warn('[FetchHook] Error preparing modified fetch request:', error);
    }

    return originalFetch.call(this, requestInfo, requestInit);
  };
})();
