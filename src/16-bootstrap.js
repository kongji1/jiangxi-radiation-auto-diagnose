  let bootstrapped = false;
  function scheduleLoginRecovery() {
    if (loginRecoveryTimer) clearTimeout(loginRecoveryTimer);
    if (pageWindow().location.pathname !== '/login') return;
    loginRecoveryTimer = setTimeout(() => {
      loginRecoveryTimer = null;
      if (pageWindow().location.pathname !== '/login') return;
      // 不在这里弹出密码框：密码只允许当前页面会话临时使用。
      // 仅当用户已在当前会话输入过密码时自动重试，避免登录路由切换反复打断页面。
      const canRetry = !!directPassword;
      developerLog('登录路由恢复等待', {
        source: 'route-guard',
        canRetry,
        hasAuthCookie: !!readCookie('Auth'),
        directLoginConfigured: !!(directLoginConfig().enabled && directLoginConfig().username)
      }, { force: true });
      if (canRetry) {
        bootstrapped = false;
        bootstrap();
      }
    }, 1200);
  }
  function watchRoute() {
    const path = pageWindow().location.pathname;
    let changed = false;
    if (path !== lastObservedPath) {
      const previous = lastObservedPath; lastObservedPath = path;
      changed = true;
      maintainFinalEntryPendingRoute(path, previous);
      developerLog('路由变化', { source: 'route-guard', from: previous || '(初始)', to: path }, { force: true });
      if (!isMonitorRoute(path)) {
        stopRuntime('route-exit');
        // 允许 /login -> /radiation 时重新走一次初始化和会话检查。
        // 旧逻辑保留 bootstrapped=true，登录路由回来后只重启定时器，
        // 会跳过一次必要的直接登录/身份恢复检查。
        bootstrapped = false;
        if (path === '/login') scheduleLoginRecovery();
      }
    }
    // SPA 从诊断页返回列表时 bootstrapped 仍为 true，但 stopRuntime 已经
    // 清掉了所有定时器、Observer 和运行状态。必须在每次真正回到列表页时
    // 重建运行时，否则第一次进入成功后后续候选永远不会再被处理。
    if (isMonitorRoute(path) && changed) {
      if (!bootstrapped) bootstrap();
      else {
        headerObserver = new MutationObserver(attachToHeaderSettings);
        if (document.body) headerObserver.observe(document.body, { childList: true, subtree: true });
        attachToHeaderSettings();
        developerLog('运行时重启', { source: 'route-guard', reason: '返回待诊断列表' }, { force: true });
        start({ preserveDiagnosisLock: true });
      }
    }
  }
  const bootstrap = async () => {
    // 门户跳转到影像页时，Vue 可能先替换文档再触发 DOMContentLoaded；
    // 登录页也需要启动，用于第二次以后直接协议登录。
    const currentUrl = pageWindow().location;
    if (currentUrl.host === '10.10.94.90:22100' || !['/login', '/radiation', '/radiation/report'].includes(currentUrl.pathname)) {
      return;
    }
    if (bootstrapped) return;
    bootstrapped = true;
    // 先完成同源协议登录，再启动列表探测；未启用时保持原有登录流程。
    // 允许从 /radiation 直接触发协议登录：用户未主动打开 /login 时，
    // 只要配置了账号，仍然可以完成登录后继续启动列表；/setting/profile 等其它路由不触发。
    const directLoginRoute = currentUrl.pathname === '/login' || currentUrl.pathname === '/radiation';
    if (directLoginRoute && directLoginConfig().enabled && String(directLoginConfig().username || '').trim() && !readCookie('Auth')) {
      const ok = await ensureDirectLogin();
      if (ok && currentUrl.pathname === '/login') {
        pageWindow().location.replace('/radiation');
        return;
      }
    }
    if (currentUrl.pathname === '/login') return;
    headerObserver = new MutationObserver(attachToHeaderSettings);
    if (document.body) headerObserver.observe(document.body, { childList: true, subtree: true });
    attachToHeaderSettings();
    // 直接打开诊断页时无法证明右侧待诊断列表已经挂载；先保守锁住入口，
    // 待业务行出现后由 entryDiagnosisLockActive 决定是否释放。
    if (currentUrl.pathname === '/radiation/report') diagnosisActive = true;
    start({ preserveDiagnosisLock: currentUrl.pathname === '/radiation/report' });
  };
  lastObservedPath = pageWindow().location.pathname;
  routeWatchTimer = setInterval(watchRoute, 1000);
  window.addEventListener('popstate', watchRoute);
  window.addEventListener('hashchange', watchRoute);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
})();
